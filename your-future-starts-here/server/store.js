'use strict';

const path = require('path');
const { MemoryStore } = require('./store-memory');
const { RedisStore } = require('./store-redis');
const { ConvexStore } = require('./store-convex');
const { Upstash } = require('./upstash');

// The Convex deployment URL: CONVEX_URL if set, otherwise derived from the
// deploy key Vercel's Convex integration provides ("prod:name|secret").
function convexUrl(env) {
  if (env.CONVEX_URL) return env.CONVEX_URL.replace(/\/+$/, '');
  const key = env.CONVEX_DEPLOY_KEY || '';
  const m = key.match(/^(?:prod|dev|preview):([a-z0-9-]+)\|/i);
  return m ? `https://${m[1]}.convex.cloud` : null;
}

// Picks the store from the environment: Convex, then Upstash Redis, then the
// in-process store with a JSON file.
function createStore(env = process.env) {
  const convex = convexUrl(env);
  if (convex && env.CONVEX_DEPLOY_KEY) {
    const { ConvexHttpClient } = require('convex/browser');
    const client = new ConvexHttpClient(convex);
    // The functions are internal; the deploy key is what lets this server call them.
    client.setAdminAuth(env.CONVEX_DEPLOY_KEY);
    return new ConvexStore(client);
  }
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new RedisStore(new Upstash({ url, token }));
  const file = env.DATA_FILE || (env.VERCEL ? '/tmp/yfsh-sessions.json' : path.join(__dirname, '..', 'data', 'sessions.json'));
  return new MemoryStore({ file });
}

module.exports = { createStore, convexUrl };
