'use strict';

// Runs the shared acceptance checks against the Convex store, with the real
// Convex functions executed in-process by convex-test (no network needed).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');

const { createApp } = require('../server/app');
const { ConvexStore } = require('../server/store-convex');

async function convexHarness() {
  const { convexTest } = await import('convex-test');
  const convexDir = path.join(__dirname, '..', 'convex');
  const schema = (await import(pathToFileURL(path.join(convexDir, 'schema.js')).href)).default;
  const modules = {
    './sessions.js': () => import(pathToFileURL(path.join(convexDir, 'sessions.js')).href),
    './schema.js': () => import(pathToFileURL(path.join(convexDir, 'schema.js')).href),
    // convex-test locates the functions root from a _generated entry; the app
    // calls functions through anyApi, so no real generated code is needed.
    './_generated/api.js': async () => ({}),
  };
  return convexTest(schema, modules);
}

test.describe('convex store', () => {
  let server;
  let base;
  let store;
  let token;
  let code;

  const json = async (method, url, body, auth) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  const state = async () => (await json('GET', `/api/sessions/${code}/state`)).data.state;

  test.before(async () => {
    const t = await convexHarness();
    store = new ConvexStore({ query: (ref, args) => t.query(ref, args), mutation: (ref, args) => t.mutation(ref, args) });
    server = http.createServer(createApp({ store, presenterPassword: 'test-password' }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  test.after(async () => {
    await new Promise((r) => server.close(r));
  });

  test('sessions, votes, results and sign-in work end to end on Convex', async () => {
    token = (await json('POST', '/api/auth/login', { password: 'test-password' })).data.token;
    assert.ok(token);
    const created = await json('POST', '/api/sessions', { name: 'Convex rehearsal' }, true);
    assert.equal(created.status, 201);
    code = created.data.code;
    assert.equal((await json('GET', '/api/sessions', undefined, true)).data.storage, 'convex');

    const a = await json('POST', `/api/sessions/${code}/join`, {});
    const b = await json('POST', `/api/sessions/${code}/join`, {});
    assert.equal(a.data.state.activities.poll.status, 'open');
    assert.equal((await state()).participantCount, 2);

    assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: a.data.pid, choice: 0 })).status, 200);
    assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: a.data.pid, choice: 2 })).status, 200);
    assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: b.data.pid, choice: 2 })).status, 200);
    assert.deepEqual((await state()).activities.poll.counts, [0, 0, 2, 0, 0]);

    await json('POST', `/api/sessions/${code}/activities/poll`, { action: 'close' }, true);
    assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: b.data.pid, choice: 1 })).status, 409);
    const again = await json('POST', `/api/sessions/${code}/join`, { pid: a.data.pid });
    assert.equal(again.data.my.poll, 2);

    // Feature tie and presenter pick
    await json('POST', `/api/sessions/${code}/vote/feature`, { pid: a.data.pid, choice: 0 });
    await json('POST', `/api/sessions/${code}/vote/feature`, { pid: b.data.pid, choice: 1 });
    assert.equal((await state()).activities.feature.tie, true);
    assert.equal((await json('POST', `/api/sessions/${code}/activities/feature`, { action: 'setWinner', choice: 2 }, true)).status, 400);
    assert.equal((await json('POST', `/api/sessions/${code}/activities/feature`, { action: 'setWinner', choice: 1 }, true)).status, 200);
    assert.equal((await state()).activities.feature.winner, 1);

    // Cards and sign-in
    const card1 = await json('POST', `/api/sessions/${code}/card-complete`, { pid: a.data.pid });
    assert.equal(card1.data.duplicate, false);
    assert.equal((await json('POST', `/api/sessions/${code}/card-complete`, { pid: a.data.pid })).data.duplicate, true);
    assert.equal((await state()).activities.card.completed, 1);
    assert.equal((await json('POST', `/api/sessions/${code}/profile`, { pid: a.data.pid, name: 'Maria', school: 'QC High', email: 'bad' })).status, 400);
    const prof = await json('POST', `/api/sessions/${code}/profile`, { pid: a.data.pid, name: ' Maria Santos ', school: 'QC High', email: 'Maria@Example.PH' });
    assert.equal(prof.status, 200);
    assert.equal(prof.data.state.profileCount, 1);
    await json('POST', `/api/sessions/${code}/profile`, { pid: a.data.pid, name: 'Maria Santos', school: 'QC Science High', email: 'maria@example.ph' });
    assert.equal((await state()).profileCount, 1);
    const list = await json('GET', `/api/sessions/${code}/profiles`, undefined, true);
    assert.deepEqual(list.data.profiles.map((p) => [p.name, p.school, p.email]), [['Maria Santos', 'QC Science High', 'maria@example.ph']]);
    assert.equal((await json('POST', `/api/sessions/${code}/join`, { pid: a.data.pid })).data.my.registered, true);

    // Live pointer, end/resume, reset, delete
    assert.equal((await fetch(`${base}/join`, { redirect: 'manual' })).headers.get('location'), `/a/${code}`);
    await json('POST', `/api/sessions/${code}/live`, undefined, true);
    assert.equal((await json('GET', '/api/sessions', undefined, true)).data.live, code);
    await json('POST', `/api/sessions/${code}/end`, undefined, true);
    assert.equal((await state()).ended, true);
    await json('POST', `/api/sessions/${code}/resume`, undefined, true);
    assert.equal((await state()).ended, false);
    assert.equal((await json('POST', `/api/sessions/${code}/reset`, { confirm: code }, true)).status, 200);
    const reset = await state();
    assert.equal(reset.participantCount, 0);
    assert.equal(reset.profileCount, 0);
    assert.equal(reset.activities.poll.total, 0);
    assert.equal((await json('DELETE', `/api/sessions/${code}`, { confirm: code }, true)).status, 200);
    assert.equal((await json('GET', `/api/sessions/${code}/state`)).status, 404);
    assert.equal((await json('GET', '/api/sessions', undefined, true)).data.live, null);
  });

  test('a visit with no session creates one (zero-setup) on Convex', async () => {
    const first = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(first.status, 302);
    assert.match(first.headers.get('location'), /^\/a\/[A-HJ-NP-Z2-9]{4}$/);
  });
});
