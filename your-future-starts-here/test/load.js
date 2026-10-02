'use strict';

// Load test: N simulated students go through the whole flow at the same time
// (join → sign-in → poll → mistake answer → card) while also polling state,
// against the real HTTP app. Then it checks that nothing was lost.
//
//   node test/load.js [students=1000] [store=redis|memory]
//
// The Redis store runs against the fake Upstash server, so this measures the
// app's own logic and correctness under concurrency, not the network.

const http = require('http');
const { createApp } = require('../server/app');
const { MemoryStore } = require('../server/store-memory');
const { RedisStore } = require('../server/store-redis');
const { Upstash } = require('../server/upstash');
const { startFakeUpstash } = require('./fake-upstash');

const N = Number(process.argv[2]) || 1000;
const KIND = process.argv[3] || 'redis';

http.globalAgent.maxSockets = Infinity;

async function main() {
  let fake = null;
  let store;
  if (KIND === 'redis') {
    fake = await startFakeUpstash();
    store = new RedisStore(new Upstash({ url: fake.url, token: fake.token }));
  } else {
    store = new MemoryStore();
  }
  const server = http.createServer(createApp({ store, presenterPassword: null, presenterPath: 'secret' }));
  server.maxConnections = 10000;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const timings = [];
  let failures = 0;
  const failureReasons = {};
  const call = async (method, url, body) => {
    const t = Date.now();
    const res = await fetch(base + url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    timings.push(Date.now() - t);
    if (res.status >= 400) {
      failures++;
      failureReasons[res.status] = (failureReasons[res.status] || 0) + 1;
    }
    return res;
  };

  // The bare domain: everyone lands in the same live session.
  const first = await call('GET', '/');
  const code = first.headers.get('location').slice(3);

  const expected = { poll: [0, 0, 0, 0, 0], feature: [0, 0, 0, 0] };
  const started = Date.now();
  await Promise.all(Array.from({ length: N }, async (_, i) => {
    const landed = await call('GET', '/');
    if (landed.headers.get('location') !== `/a/${code}`) { failures++; failureReasons.wrongSession = (failureReasons.wrongSession || 0) + 1; }
    const join = await (await call('POST', `/api/sessions/${code}/join`, {})).json();
    const pid = join.pid;
    await call('POST', `/api/sessions/${code}/profile`, { pid, name: `Student ${i}`, school: `School ${i % 7}`, email: `s${i}@school.ph` });
    const pollChoice = i % 5;
    await call('POST', `/api/sessions/${code}/vote/poll`, { pid, choice: pollChoice });
    expected.poll[pollChoice]++;
    await call('GET', `/api/sessions/${code}/state`);
    const featureChoice = i % 4;
    await call('POST', `/api/sessions/${code}/vote/feature`, { pid, choice: featureChoice });
    expected.feature[featureChoice]++;
    await call('POST', `/api/sessions/${code}/card-complete`, { pid });
    await call('GET', `/api/sessions/${code}/state`);
  }));
  const elapsed = Date.now() - started;

  const state = (await (await fetch(`${base}/api/sessions/${code}/state`)).json()).state;
  const profiles = (await (await fetch(`${base}/api/sessions/${code}/profiles`, { headers: { Authorization: 'Bearer secret' } })).json()).profiles;
  timings.sort((a, b) => a - b);
  const pct = (p) => timings[Math.min(timings.length - 1, Math.floor((p / 100) * timings.length))];

  const checks = {
    participants: [state.participantCount, N],
    signUps: [profiles.length, N],
    pollVotes: [JSON.stringify(state.activities.poll.counts), JSON.stringify(expected.poll)],
    mistakeAnswers: [JSON.stringify(state.activities.feature.counts), JSON.stringify(expected.feature)],
    cards: [state.activities.card.completed, N],
  };
  console.log(`\n${N} students, ${KIND} store — ${timings.length} requests in ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`latency ms: p50 ${pct(50)}, p95 ${pct(95)}, p99 ${pct(99)}, max ${timings[timings.length - 1]}`);
  console.log(`failed requests: ${failures}`, failures ? failureReasons : '');
  let ok = failures === 0;
  for (const [name, [got, want]] of Object.entries(checks)) {
    const pass = String(got) === String(want);
    ok = ok && pass;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: ${got}${pass ? '' : ` (expected ${want})`}`);
  }

  await new Promise((r) => server.close(r));
  if (fake) await fake.close();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
