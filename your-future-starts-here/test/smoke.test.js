'use strict';

// End-to-end checks against the real HTTP app, run once per store (in-memory
// and Redis via a fake Upstash server). Covers the acceptance criteria that
// can be verified without a browser: phones see presenter changes on their
// next poll, votes replace rather than duplicate, closed activities reject
// submissions server-side, presenter auth, state restoration on rejoin, and
// the caching rules that make polling cheap on Vercel.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { createApp } = require('../server/app');
const { MemoryStore } = require('../server/store-memory');
const { RedisStore } = require('../server/store-redis');
const { Upstash } = require('../server/upstash');
const { startFakeUpstash } = require('./fake-upstash');

for (const kind of ['memory', 'redis']) {
  test.describe(`${kind} store`, () => {
    let server;
    let base;
    let store;
    let fake;
    let token;
    let code;

    const json = async (method, url, body, auth) => {
      const res = await fetch(base + url, {
        method,
        headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, headers: res.headers, data: await res.json().catch(() => ({})) };
    };
    const state = async () => (await json('GET', `/api/sessions/${code}/state`)).data.state;

    test.before(async () => {
      if (kind === 'redis') {
        fake = await startFakeUpstash();
        store = new RedisStore(new Upstash({ url: fake.url, token: fake.token }));
      } else {
        store = new MemoryStore({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yfsh-')), 'sessions.json') });
      }
      server = http.createServer(createApp({ store, presenterPassword: 'test-password' }));
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${server.address().port}`;
    });

    test.after(async () => {
      await new Promise((r) => server.close(r));
      await store.close();
      if (fake) await fake.close();
    });

    test('presenter must sign in; session codes do not grant control', async () => {
      assert.equal((await json('GET', '/api/sessions')).status, 401);
      assert.equal((await json('POST', '/api/auth/login', { password: 'wrong' })).status, 401);
      const login = await json('POST', '/api/auth/login', { password: 'test-password' });
      assert.equal(login.status, 200);
      token = login.data.token;

      const created = await json('POST', '/api/sessions', { name: 'Rehearsal' }, true);
      assert.equal(created.status, 201);
      code = created.data.code;
      assert.match(code, /^[A-HJ-NP-Z2-9]{4}$/);
      assert.equal(created.data.joinUrl, `${base}/a/${code}`);

      const list = await json('GET', '/api/sessions', undefined, true);
      assert.equal(list.data.sessions[0].code, code);
      assert.equal(list.data.storage, kind);

      // Audience endpoints never accept presenter actions
      assert.equal((await json('POST', `/api/sessions/${code}/slide`, { slide: 2 })).status, 401);
      assert.equal((await json('POST', `/api/sessions/${code}/activities/poll`, { action: 'open' })).status, 401);
      assert.equal((await json('GET', `/api/sessions/${code}/presenter-state`)).status, 401);
      assert.equal((await json('GET', '/api/sessions/ZZZZ/state')).status, 404);
    });

    test('two phones see presenter changes on their next poll; votes replace rather than duplicate', async () => {
      const a = await json('POST', `/api/sessions/${code}/join`, {});
      const b = await json('POST', `/api/sessions/${code}/join`, {});
      assert.notEqual(a.data.pid, b.data.pid);
      assert.equal(a.data.state.activities.poll.status, 'open', 'everything is open from the start');
      assert.equal(a.data.state.activities.poll.revealed, true);
      const before = await state();
      assert.equal(before.participantCount, 2);

      // Voting is rejected while the poll is closed, and resumes when reopened
      await json('POST', `/api/sessions/${code}/activities/poll`, { action: 'close' }, true);
      assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: a.data.pid, choice: 0 })).status, 409);
      await json('POST', `/api/sessions/${code}/activities/poll`, { action: 'open' }, true);
      const sa = await state();
      const sb = await state();
      assert.equal(sa.activities.poll.status, 'open');
      assert.equal(sb.activities.poll.status, 'open');
      assert.ok(sa.version > before.version, 'version moves forward so phones re-render');

      // Phone A votes twice: only the latest counts. Phone B votes once.
      const first = await json('POST', `/api/sessions/${code}/vote/poll`, { pid: a.data.pid, choice: 0 });
      assert.equal(first.status, 200);
      assert.equal(first.data.state.activities.poll.total, 1);
      assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: a.data.pid, choice: 2 })).status, 200);
      assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: b.data.pid, choice: 2 })).status, 200);
      assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: b.data.pid, choice: 9 })).status, 400);
      assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: 'nope', choice: 1 })).status, 400);

      const pres = await json('GET', `/api/sessions/${code}/presenter-state`, undefined, true);
      assert.deepEqual(pres.data.state.activities.poll.counts, [0, 0, 2, 0, 0]);
      assert.equal(pres.data.state.activities.poll.total, 2);

      // Counts are visible by default; a presenter can hide them for a guided talk
      assert.deepEqual((await state()).activities.poll.counts, [0, 0, 2, 0, 0]);
      await json('POST', `/api/sessions/${code}/activities/poll`, { action: 'hide' }, true);
      const hidden = await state();
      assert.equal(hidden.activities.poll.counts, null);
      assert.equal(hidden.activities.poll.total, 2);
      await json('POST', `/api/sessions/${code}/activities/poll`, { action: 'reveal' }, true);
      assert.deepEqual((await state()).activities.poll.counts, [0, 0, 2, 0, 0]);

      // Closing rejects new submissions server-side
      await json('POST', `/api/sessions/${code}/activities/poll`, { action: 'close' }, true);
      assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: b.data.pid, choice: 1 })).status, 409);

      // Rejoining with the same pid restores the earlier answer and the current focus
      const again = await json('POST', `/api/sessions/${code}/join`, { pid: a.data.pid });
      assert.equal(again.data.pid, a.data.pid);
      assert.equal(again.data.my.poll, 2);
      assert.equal(again.data.state.participantCount, 2);
    });

    test('students sign in with name, school and email; the presenter can download the list', async () => {
      const a = await json('POST', `/api/sessions/${code}/join`, {});
      assert.equal(a.data.my.registered, false);
      assert.equal((await json('POST', `/api/sessions/${code}/profile`, { pid: a.data.pid, name: 'Maria', school: 'QC High', email: 'not-an-email' })).status, 400);
      assert.equal((await json('POST', `/api/sessions/${code}/profile`, { pid: a.data.pid, name: '', school: 'QC High', email: 'm@x.ph' })).status, 400);
      const ok = await json('POST', `/api/sessions/${code}/profile`, { pid: a.data.pid, name: ' Maria Santos ', school: 'QC High', email: 'Maria@Example.PH' });
      assert.equal(ok.status, 200);
      assert.equal(ok.data.name, 'Maria Santos');
      assert.equal(ok.data.state.profileCount, 1);
      // Re-submitting updates rather than duplicates
      await json('POST', `/api/sessions/${code}/profile`, { pid: a.data.pid, name: 'Maria Santos', school: 'QC Science High', email: 'maria@example.ph' });
      assert.equal((await state()).profileCount, 1);
      const again = await json('POST', `/api/sessions/${code}/join`, { pid: a.data.pid });
      assert.equal(again.data.my.registered, true);
      assert.equal(again.data.my.name, 'Maria Santos');

      // Only the presenter sees the list; public state carries just the count
      assert.equal((await json('GET', `/api/sessions/${code}/profiles`)).status, 401);
      const list = await json('GET', `/api/sessions/${code}/profiles`, undefined, true);
      assert.deepEqual(list.data.profiles.map((p) => [p.name, p.school, p.email]), [['Maria Santos', 'QC Science High', 'maria@example.ph']]);
      const csv = await fetch(`${base}/api/sessions/${code}/profiles.csv`, { headers: { Authorization: `Bearer ${token}` } });
      assert.match(csv.headers.get('content-type'), /text\/csv/);
      assert.match(await csv.text(), /"Maria Santos","QC Science High","maria@example.ph"/);
      assert.equal(JSON.stringify((await json('GET', `/api/sessions/${code}/state`)).data).includes('maria@example.ph'), false);
    });

    test('public state is edge-cacheable for a second; presenter data is never cached', async () => {
      const pub = await fetch(`${base}/api/sessions/${code}/state`);
      assert.match(pub.headers.get('cache-control'), /s-maxage=1(,|$)/);
      const pres = await fetch(`${base}/api/sessions/${code}/presenter-state`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(pres.headers.get('cache-control'), 'no-store');
      const qr = await fetch(`${base}/api/sessions/${code}/qr.svg`);
      assert.match(qr.headers.get('cache-control'), /s-maxage=86400/);
    });

    test('feature vote: tie needs a presenter pick, winner shows after reveal', async () => {
      const a = await json('POST', `/api/sessions/${code}/join`, {});
      const b = await json('POST', `/api/sessions/${code}/join`, {});
      // Guided-talk shape for the big screen: close the card so focus follows the vote
      await json('POST', `/api/sessions/${code}/activities/card`, { action: 'close' }, true);
      await json('POST', `/api/sessions/${code}/slide`, { slide: 6 }, true);
      await json('POST', `/api/sessions/${code}/vote/feature`, { pid: a.data.pid, choice: 0 });
      await json('POST', `/api/sessions/${code}/vote/feature`, { pid: b.data.pid, choice: 1 });
      await json('POST', `/api/sessions/${code}/activities/feature`, { action: 'close' }, true);

      let pub = await state();
      assert.equal(pub.focus, 'feature');
      assert.equal(pub.activities.feature.tie, true);
      assert.equal(pub.activities.feature.winner, null);

      // Only a tied leader can be chosen
      assert.equal((await json('POST', `/api/sessions/${code}/activities/feature`, { action: 'setWinner', choice: 2 }, true)).status, 400);
      assert.equal((await json('POST', `/api/sessions/${code}/activities/feature`, { action: 'setWinner', choice: 1 }, true)).status, 200);
      pub = await state();
      assert.equal(pub.activities.feature.winner, 1);
      const pres = await json('GET', `/api/sessions/${code}/presenter-state`, undefined, true);
      assert.equal(pres.data.state.activities.feature.winnerOverride, 1);
      assert.deepEqual(pres.data.state.activities.feature.leaders, [0, 1]);

      // Winner stays visible on slide 7, waiting screen on slide 8, next/previous clamp
      await json('POST', `/api/sessions/${code}/slide`, { delta: 1 }, true);
      assert.equal((await state()).focus, 'feature');
      await json('POST', `/api/sessions/${code}/slide`, { slide: 8 }, true);
      assert.equal((await state()).focus, 'waiting');
      const clamped = await json('POST', `/api/sessions/${code}/slide`, { slide: 11 }, true);
      assert.equal(clamped.data.slide, 10, 'out-of-range slides clamp instead of failing');
      assert.equal((await json('POST', `/api/sessions/${code}/slide`, { slide: 'abc' }, true)).status, 400);
      await json('POST', `/api/sessions/${code}/slide`, { slide: 8 }, true);
    });

    test('cards: completion is deduplicated, text never reaches the server, ending keeps cards', async () => {
      const a = await json('POST', `/api/sessions/${code}/join`, {});
      await json('POST', `/api/sessions/${code}/slide`, { slide: 9 }, true);
      assert.equal((await json('POST', `/api/sessions/${code}/card-complete`, { pid: a.data.pid })).status, 409);
      await json('POST', `/api/sessions/${code}/activities/card`, { action: 'open' }, true);
      assert.equal((await state()).focus, 'card');

      const first = await json('POST', `/api/sessions/${code}/card-complete`, { pid: a.data.pid, who: 'should be ignored' });
      assert.equal(first.status, 200);
      assert.equal(first.data.duplicate, false);
      assert.equal(first.data.state.activities.card.completed, 1);
      const second = await json('POST', `/api/sessions/${code}/card-complete`, { pid: a.data.pid });
      assert.equal(second.data.duplicate, true);
      const pub = await json('GET', `/api/sessions/${code}/state`);
      assert.equal(pub.data.state.activities.card.completed, 1);
      assert.equal(JSON.stringify(pub.data).includes('should be ignored'), false);
      assert.equal((await json('POST', `/api/sessions/${code}/join`, { pid: a.data.pid })).data.my.cardCompleted, true);

      await json('POST', `/api/sessions/${code}/end`, undefined, true);
      const ended = await state();
      assert.equal(ended.ended, true);
      assert.equal(ended.focus, 'ended');
      assert.equal(ended.activities.card.status, 'closed');
      assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: a.data.pid, choice: 1 })).status, 409);
      // A phone that already completed its card still gets "duplicate", not an error
      assert.equal((await json('POST', `/api/sessions/${code}/card-complete`, { pid: a.data.pid })).data.duplicate, true);
      await json('POST', `/api/sessions/${code}/resume`, undefined, true);
      assert.equal((await state()).ended, false);
    });

    test('reset and delete require the code typed back', async () => {
      assert.equal((await json('POST', `/api/sessions/${code}/reset`, { confirm: 'nope' }, true)).status, 400);
      assert.equal((await json('POST', `/api/sessions/${code}/reset`, { confirm: code }, true)).status, 200);
      const pub = await state();
      assert.equal(pub.slide, 1);
      assert.equal(pub.participantCount, 0);
      assert.equal(pub.activities.poll.total, 0);
      assert.equal(pub.activities.card.completed, 0);
      assert.equal((await json('DELETE', `/api/sessions/${code}`, { confirm: code }, true)).status, 200);
      assert.equal((await json('GET', `/api/sessions/${code}/state`)).status, 404);
      assert.equal((await json('GET', '/api/sessions', undefined, true)).data.sessions.length, 0);
    });

    test('QR code and short link resolve to the audience page', async () => {
      const created = await json('POST', '/api/sessions', { name: 'QR' }, true);
      const c = created.data.code;
      const qr = await fetch(`${base}/api/sessions/${c}/qr.svg`);
      assert.equal(qr.status, 200);
      assert.match(qr.headers.get('content-type'), /svg/);
      const short = await fetch(`${base}/${c}`, { redirect: 'manual' });
      assert.equal(short.status, 302);
      assert.equal(short.headers.get('location'), `/a/${c}`);
      const page = await fetch(`${base}/a/${c}`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /audience\.js/);
    });

    test('the bare domain and /join open the live session', async () => {
      const where = async (p = '/') => {
        const res = await fetch(base + p, { redirect: 'manual' });
        assert.equal(res.status, 302);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        return res.headers.get('location');
      };
      const a = await json('POST', '/api/sessions', { name: 'A' }, true);
      await new Promise((r) => setTimeout(r, 5));
      const b = await json('POST', '/api/sessions', { name: 'B' }, true);
      assert.equal(await where('/'), `/a/${b.data.code}`, 'newest open session by default');
      assert.equal(await where('/join'), `/a/${b.data.code}`);

      assert.equal((await json('POST', `/api/sessions/${a.data.code}/live`, undefined, true)).status, 200);
      assert.equal((await json('POST', `/api/sessions/${a.data.code}/live`)).status, 401);
      assert.equal(await where(), `/a/${a.data.code}`);
      assert.equal((await json('GET', '/api/sessions/live', undefined, true)).data.code, a.data.code);
      const pres = await json('GET', `/api/sessions/${a.data.code}/presenter-state`, undefined, true);
      assert.equal(pres.data.state.isLive, true);
      assert.equal(pres.data.state.staticJoinUrl, base);
      assert.equal((await json('GET', '/api/sessions', undefined, true)).data.live, a.data.code);

      await json('POST', `/api/sessions/${a.data.code}/end`, undefined, true);
      assert.equal(await where(), `/a/${b.data.code}`, 'an ended live session falls back to the newest open one');

      // Everything ended: late scans still land on the live session's ending
      for (const s of (await json('GET', '/api/sessions', undefined, true)).data.sessions) {
        if (!s.ended) await json('POST', `/api/sessions/${s.code}/end`, undefined, true);
      }
      assert.equal(await where(), `/a/${a.data.code}`);
      await json('DELETE', `/api/sessions/${a.data.code}`, { confirm: a.data.code }, true);
      assert.equal((await json('GET', '/api/sessions', undefined, true)).data.live, null, 'deleting the live session clears the pointer');
      const enter = await fetch(`${base}/enter?nolive=1`);
      assert.equal(enter.status, 200);
      assert.match(await enter.text(), /Session code/);
    });
  });
}

test.describe('private controls address (PRESENTER_PATH)', () => {
  let server;
  let base;
  let store;

  test.before(async () => {
    store = new MemoryStore();
    server = http.createServer(createApp({ store, presenterPassword: null, presenterPath: 'secret123' }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  test.after(async () => {
    await new Promise((r) => server.close(r));
    await store.close();
  });

  test('controls only answer at /c/<secret>, and the secret is the API credential', async () => {
    assert.equal((await fetch(`${base}/presenter`)).status, 404);
    assert.equal((await fetch(`${base}/c/wrong`)).status, 404);
    const page = await fetch(`${base}/c/secret123`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /presenter\.js/);

    assert.equal((await fetch(`${base}/api/sessions`)).status, 401);
    assert.equal((await fetch(`${base}/api/sessions`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    const ok = await fetch(`${base}/api/auth/check`, { headers: { Authorization: 'Bearer secret123' } });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json().then((d) => [d.authRequired, d.privatePath]), [false, true]);

    // Students are unaffected
    const first = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(first.status, 302);
    const code = first.headers.get('location').slice(3);
    assert.equal((await fetch(`${base}/api/sessions/${code}/state`)).status, 200);
  });
});

test.describe('hardening', () => {
  let server;
  let base;
  let store;

  test.before(async () => {
    store = new MemoryStore();
    server = http.createServer(createApp({ store, presenterPassword: null, presenterPath: 'secret123', writeLimit: 5 }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  test.after(async () => {
    await new Promise((r) => server.close(r));
    await store.close();
  });

  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  test('security headers on pages and API', async () => {
    for (const url of ['/enter', '/api/config', '/c/secret123']) {
      const res = await fetch(base + url);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', url);
      assert.equal(res.headers.get('x-frame-options'), 'DENY', url);
      assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/, url);
    }
    assert.equal((await fetch(`${base}/c/secret123`)).headers.get('x-robots-tag'), 'noindex, nofollow');
  });

  test('sign-up CSV neutralises spreadsheet formulas', async () => {
    const first = await fetch(`${base}/`, { redirect: 'manual' });
    const code = first.headers.get('location').slice(3);
    const join = await (await post(`/api/sessions/${code}/join`, {})).json();
    await post(`/api/sessions/${code}/profile`, { pid: join.pid, name: '=HYPERLINK("http://evil","x")', school: '+1+1', email: 'a@b.ph' });
    const csv = await (await fetch(`${base}/api/sessions/${code}/profiles.csv`, { headers: { Authorization: 'Bearer secret123' } })).text();
    assert.match(csv, /"'=HYPERLINK\(""http:\/\/evil"",""x""\)","'\+1\+1","a@b.ph"/);
  });

  test('public writes are rate limited per IP', async () => {
    const first = await fetch(`${base}/join`, { redirect: 'manual' });
    const code = first.headers.get('location').slice(3);
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await post(`/api/sessions/${code}/join`, {})).status);
    assert.equal(statuses.includes(429), true, `got ${statuses}`);
    // Reads are not limited
    assert.equal((await fetch(`${base}/api/sessions/${code}/state`)).status, 200);
  });
});

test.describe('open mode (no PRESENTER_PASSWORD)', () => {
  let server;
  let base;
  let store;

  test.before(async () => {
    store = new MemoryStore();
    server = http.createServer(createApp({ store, presenterPassword: null }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  test.after(async () => {
    await new Promise((r) => server.close(r));
    await store.close();
  });

  test('works with zero setup: no sign-in, a session appears on first visit', async () => {
    const check = await fetch(`${base}/api/auth/check`);
    assert.equal(check.status, 200);
    assert.equal((await check.json()).authRequired, false);
    const config = await (await fetch(`${base}/api/config`)).json();
    assert.deepEqual(config.social.links.map((l) => l.label), ['Instagram', 'Facebook', 'TikTok']);

    const first = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(first.status, 302);
    const location = first.headers.get('location');
    assert.match(location, /^\/a\/[A-HJ-NP-Z2-9]{4}$/);
    const code = location.slice(3);

    // Presenter endpoints open without a token and land on the same session
    const live = await fetch(`${base}/api/sessions/live`);
    assert.equal(live.status, 200);
    assert.equal((await live.json()).code, code);
    const list = await (await fetch(`${base}/api/sessions`)).json();
    assert.equal(list.sessions.length, 1);
    assert.equal(list.live, code);
    const arrival = (await (await fetch(`${base}/api/sessions/${code}/state`)).json()).state;
    assert.equal(arrival.activities.poll.status, 'open', 'poll open on arrival');
    assert.equal(arrival.activities.feature.status, 'open');
    assert.equal(arrival.activities.card.status, 'open');
    const close = await fetch(`${base}/api/sessions/${code}/activities/poll`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'close' }),
    });
    assert.equal(close.status, 200);
    assert.equal((await (await fetch(`${base}/api/sessions/${code}/state`)).json()).state.activities.poll.status, 'closed');

    // Second visit reuses the session rather than creating another
    assert.equal((await fetch(`${base}/join`, { redirect: 'manual' })).headers.get('location'), `/a/${code}`);
    assert.equal((await (await fetch(`${base}/api/sessions`)).json()).sessions.length, 1);
  });
});
