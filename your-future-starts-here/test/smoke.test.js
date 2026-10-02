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
      assert.equal(a.data.state.focus, 'waiting');
      const before = await state();
      assert.equal(before.participantCount, 2);

      // Voting is rejected while the poll is still closed
      assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: a.data.pid, choice: 0 })).status, 409);

      await json('POST', `/api/sessions/${code}/activities/poll`, { action: 'open' }, true);
      const sa = await state();
      const sb = await state();
      assert.equal(sa.focus, 'poll');
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

      // Counts stay hidden from the room until revealed
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
      assert.equal(again.data.state.focus, 'poll');
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
      await json('POST', `/api/sessions/${code}/slide`, { slide: 6 }, true);
      await json('POST', `/api/sessions/${code}/activities/feature`, { action: 'open' }, true);
      await json('POST', `/api/sessions/${code}/vote/feature`, { pid: a.data.pid, choice: 0 });
      await json('POST', `/api/sessions/${code}/vote/feature`, { pid: b.data.pid, choice: 1 });
      await json('POST', `/api/sessions/${code}/activities/feature`, { action: 'close' }, true);
      await json('POST', `/api/sessions/${code}/activities/feature`, { action: 'reveal' }, true);

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
  });
}
