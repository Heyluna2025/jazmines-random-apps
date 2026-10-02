'use strict';

const path = require('path');
const { MemoryStore } = require('./store-memory');
const { RedisStore } = require('./store-redis');
const { Upstash } = require('./upstash');

// Redis when the host provides one (Vercel's Storage tab injects either pair
// of variables), otherwise the in-process store with a JSON file.
function createStore(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new RedisStore(new Upstash({ url, token }));
  const file = env.DATA_FILE || (env.VERCEL ? '/tmp/yfsh-sessions.json' : path.join(__dirname, '..', 'data', 'sessions.json'));
  return new MemoryStore({ file });
}

module.exports = { createStore };
