'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Minimal .env loader so local runs don't need an extra dependency.
function loadDotEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

loadDotEnv(path.join(__dirname, '..', '.env'));

let presenterPassword = process.env.PRESENTER_PASSWORD || null;
if (!presenterPassword && !process.env.VERCEL) {
  // Local convenience only. On a serverless host a random password would differ
  // per instance, so there the login explains how to set one instead.
  presenterPassword = crypto.randomBytes(6).toString('base64url');
  console.warn('\n[auth] PRESENTER_PASSWORD is not set. Using a temporary password for this run:');
  console.warn(`[auth]   ${presenterPassword}`);
  console.warn('[auth] Set PRESENTER_PASSWORD in .env or your host settings for a stable password.\n');
}

module.exports = {
  presenterPassword,
  PORT: Number(process.env.PORT) || 3000,
  HOST: process.env.HOST || '0.0.0.0',
};
