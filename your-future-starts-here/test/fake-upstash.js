'use strict';

// Just enough of the Upstash Redis REST API to exercise the Redis store in
// tests: one command per POST /, a batch per POST /pipeline, bearer auth.

const http = require('http');

function createDb() {
  const data = new Map(); // key -> { type, value }

  const get = (key, type) => {
    const e = data.get(key);
    if (!e) return null;
    if (e.type !== type) throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    return e.value;
  };
  const ensure = (key, type, make) => {
    let e = data.get(key);
    if (!e) { e = { type, value: make() }; data.set(key, e); }
    else if (e.type !== type) throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    return e.value;
  };

  const commands = {
    EXISTS: (...keys) => keys.filter((k) => data.has(k)).length,
    DEL: (...keys) => keys.reduce((n, k) => n + (data.delete(k) ? 1 : 0), 0),
    EXPIRE: (key) => (data.has(key) ? 1 : 0),
    INCR: (key) => {
      const v = Number(get(key, 'string') || 0) + 1;
      data.set(key, { type: 'string', value: String(v) });
      return v;
    },
    HSET: (key, ...pairs) => {
      const h = ensure(key, 'hash', () => new Map());
      let added = 0;
      for (let i = 0; i < pairs.length; i += 2) {
        if (!h.has(pairs[i])) added++;
        h.set(pairs[i], pairs[i + 1]);
      }
      return added;
    },
    HSETNX: (key, field, value) => {
      const h = ensure(key, 'hash', () => new Map());
      if (h.has(field)) return 0;
      h.set(field, value);
      return 1;
    },
    HGET: (key, field) => { const h = get(key, 'hash'); return h && h.has(field) ? h.get(field) : null; },
    HGETALL: (key) => { const h = get(key, 'hash'); return h ? [...h.entries()].flat() : []; },
    HLEN: (key) => { const h = get(key, 'hash'); return h ? h.size : 0; },
    HINCRBY: (key, field, by) => {
      const h = ensure(key, 'hash', () => new Map());
      const v = Number(h.get(field) || 0) + Number(by);
      h.set(field, String(v));
      return v;
    },
    SADD: (key, ...members) => {
      const s = ensure(key, 'set', () => new Set());
      let added = 0;
      for (const m of members) if (!s.has(m)) { s.add(m); added++; }
      return added;
    },
    SISMEMBER: (key, member) => { const s = get(key, 'set'); return s && s.has(member) ? 1 : 0; },
    SCARD: (key) => { const s = get(key, 'set'); return s ? s.size : 0; },
    ZADD: (key, score, member) => {
      const z = ensure(key, 'zset', () => new Map());
      const isNew = !z.has(member);
      z.set(member, Number(score));
      return isNew ? 1 : 0;
    },
    ZREM: (key, ...members) => { const z = get(key, 'zset'); return z ? members.reduce((n, m) => n + (z.delete(m) ? 1 : 0), 0) : 0; },
    ZREVRANGE: (key, start, stop) => {
      const z = get(key, 'zset');
      if (!z) return [];
      const sorted = [...z.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
      const end = Number(stop) < 0 ? sorted.length + Number(stop) + 1 : Number(stop) + 1;
      return sorted.slice(Number(start), end);
    },
  };

  return (command) => {
    const [name, ...args] = command;
    const fn = commands[String(name).toUpperCase()];
    if (!fn) throw new Error(`ERR unknown command '${name}'`);
    return fn(...args.map(String));
  };
}

function startFakeUpstash() {
  const exec = createDb();
  const token = 'fake-upstash-token';
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const run = (command) => {
        try { return { result: exec(command) }; } catch (err) { return { error: err.message }; }
      };
      const payload = JSON.parse(body || '[]');
      const out = req.url === '/pipeline' ? payload.map(run) : run(payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      token,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

module.exports = { startFakeUpstash, createDb };
