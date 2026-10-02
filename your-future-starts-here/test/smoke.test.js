'use strict';

// End-to-end checks against a real server on a random port. Covers the
// acceptance criteria that can be verified without a browser:
// live updates to two clients, vote replacement, server-side rejection of
// closed activities, presenter auth, and state restoration on rejoin.

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.PRESENTER_PASSWORD = 'test-password';
process.env.DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yfsh-')), 'sessions.json');
process.env.PORT = '0';

const { server, wss, store } = require('../server/index.js');
const WebSocket = require('ws');

let base;
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

function nextState(ws) {
  return new Promise((resolve) => {
    ws.once('message', (d) => resolve(JSON.parse(d).state));
  });
}

function openSocket(role, extra = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?code=${code}&role=${role}${extra}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  for (const client of wss.clients) client.terminate();
  wss.close();
  store.saveNow();
  await new Promise((r) => server.close(r));
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
  assert.match(code, /^[A-Z2-9]{4}$/);
  assert.equal(created.data.joinUrl, `${base}/a/${code}`);

  // Audience endpoints never accept presenter actions
  assert.equal((await json('POST', `/api/sessions/${code}/slide`, { slide: 2 })).status, 401);
  assert.equal((await json('POST', `/api/sessions/${code}/activities/poll`, { action: 'open' })).status, 401);
  // Presenter socket is refused without a token
  await assert.rejects(openSocket('presenter'));
});

test('two phones receive presenter changes live, votes replace rather than duplicate', async () => {
  const a = await json('POST', `/api/sessions/${code}/join`, {});
  const b = await json('POST', `/api/sessions/${code}/join`, {});
  assert.notEqual(a.data.pid, b.data.pid);
  assert.equal(a.data.state.focus, 'waiting');

  const wsA = await openSocket('audience');
  const wsB = await openSocket('audience');
  const projector = await openSocket('projector');
  await Promise.all([nextState(wsA), nextState(wsB), nextState(projector)]); // initial state

  // Voting is rejected while the poll is still closed
  const early = await json('POST', `/api/sessions/${code}/vote/poll`, { pid: a.data.pid, choice: 0 });
  assert.equal(early.status, 409);

  const waitA = nextState(wsA), waitB = nextState(wsB);
  await json('POST', `/api/sessions/${code}/activities/poll`, { action: 'open' }, true);
  const [sa, sb] = await Promise.all([waitA, waitB]);
  assert.equal(sa.focus, 'poll');
  assert.equal(sb.activities.poll.status, 'open');

  // Phone A votes twice: only the latest counts. Phone B votes once.
  assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: a.data.pid, choice: 0 })).status, 200);
  assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: a.data.pid, choice: 2 })).status, 200);
  assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: b.data.pid, choice: 2 })).status, 200);
  assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: b.data.pid, choice: 9 })).status, 400);

  const pres = await json('GET', `/api/sessions/${code}/presenter-state`, undefined, true);
  assert.deepEqual(pres.data.state.activities.poll.counts, [0, 0, 2, 0, 0]);
  assert.equal(pres.data.state.activities.poll.total, 2);

  // Counts stay hidden from the room until revealed
  const pub = await json('GET', `/api/sessions/${code}/state`);
  assert.equal(pub.data.state.activities.poll.counts, null);
  assert.equal(pub.data.state.activities.poll.total, 2);

  const waitP = nextState(projector);
  await json('POST', `/api/sessions/${code}/activities/poll`, { action: 'reveal' }, true);
  const revealed = await waitP;
  assert.deepEqual(revealed.activities.poll.counts, [0, 0, 2, 0, 0]);

  // Closing rejects new submissions server-side
  await json('POST', `/api/sessions/${code}/activities/poll`, { action: 'close' }, true);
  const late = await json('POST', `/api/sessions/${code}/vote/poll`, { pid: b.data.pid, choice: 1 });
  assert.equal(late.status, 409);

  // Rejoining with the same pid restores the earlier answer and the current focus
  const again = await json('POST', `/api/sessions/${code}/join`, { pid: a.data.pid });
  assert.equal(again.data.pid, a.data.pid);
  assert.equal(again.data.my.poll, 2);
  assert.equal(again.data.state.participantCount, 2);

  wsA.close(); wsB.close(); projector.close();
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

  let pub = await json('GET', `/api/sessions/${code}/state`);
  assert.equal(pub.data.state.focus, 'feature');
  assert.equal(pub.data.state.activities.feature.tie, true);
  assert.equal(pub.data.state.activities.feature.winner, null);

  // Only a tied leader can be chosen
  assert.equal((await json('POST', `/api/sessions/${code}/activities/feature`, { action: 'setWinner', choice: 2 }, true)).status, 400);
  assert.equal((await json('POST', `/api/sessions/${code}/activities/feature`, { action: 'setWinner', choice: 1 }, true)).status, 200);
  pub = await json('GET', `/api/sessions/${code}/state`);
  assert.equal(pub.data.state.activities.feature.winner, 1);

  // Winner stays visible on slide 7, waiting screen on slide 8
  await json('POST', `/api/sessions/${code}/slide`, { slide: 7 }, true);
  assert.equal((await json('GET', `/api/sessions/${code}/state`)).data.state.focus, 'feature');
  await json('POST', `/api/sessions/${code}/slide`, { slide: 8 }, true);
  assert.equal((await json('GET', `/api/sessions/${code}/state`)).data.state.focus, 'waiting');
});

test('cards: completion is deduplicated, text never reaches the server, session end keeps focus', async () => {
  const a = await json('POST', `/api/sessions/${code}/join`, {});
  await json('POST', `/api/sessions/${code}/slide`, { slide: 9 }, true);
  assert.equal((await json('POST', `/api/sessions/${code}/card-complete`, { pid: a.data.pid })).status, 409);
  await json('POST', `/api/sessions/${code}/activities/card`, { action: 'open' }, true);
  assert.equal((await json('GET', `/api/sessions/${code}/state`)).data.state.focus, 'card');

  const first = await json('POST', `/api/sessions/${code}/card-complete`, { pid: a.data.pid, who: 'should be ignored' });
  assert.equal(first.status, 200);
  assert.equal(first.data.duplicate, false);
  const second = await json('POST', `/api/sessions/${code}/card-complete`, { pid: a.data.pid });
  assert.equal(second.data.duplicate, true);
  const pub = await json('GET', `/api/sessions/${code}/state`);
  assert.equal(pub.data.state.activities.card.completed, 1);
  assert.equal(JSON.stringify(pub.data).includes('should be ignored'), false);

  await json('POST', `/api/sessions/${code}/end`, undefined, true);
  const ended = await json('GET', `/api/sessions/${code}/state`);
  assert.equal(ended.data.state.ended, true);
  assert.equal(ended.data.state.focus, 'ended');
  assert.equal((await json('POST', `/api/sessions/${code}/vote/poll`, { pid: a.data.pid, choice: 1 })).status, 409);
});

test('reset and delete require the code typed back', async () => {
  assert.equal((await json('POST', `/api/sessions/${code}/reset`, { confirm: 'nope' }, true)).status, 400);
  assert.equal((await json('POST', `/api/sessions/${code}/reset`, { confirm: code }, true)).status, 200);
  const pub = await json('GET', `/api/sessions/${code}/state`);
  assert.equal(pub.data.state.slide, 1);
  assert.equal(pub.data.state.participantCount, 0);
  assert.equal((await json('DELETE', `/api/sessions/${code}`, { confirm: code }, true)).status, 200);
  assert.equal((await json('GET', `/api/sessions/${code}/state`)).status, 404);
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
