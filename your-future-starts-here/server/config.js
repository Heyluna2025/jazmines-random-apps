'use strict';

const fs = require('fs');
const path = require('path');

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

// Presenter controls are open unless a password is set. Set PRESENTER_PASSWORD
// in the host's environment to require a sign-in.
const presenterPassword = process.env.PRESENTER_PASSWORD || null;
if (!presenterPassword && !process.env.VERCEL) {
  console.log('[auth] Presenter controls are open (set PRESENTER_PASSWORD to require a sign-in).');
}

// The controls live at /c/<PRESENTER_PATH>, an address nobody can guess.
// Change it any time by setting PRESENTER_PATH in the host's environment.
const presenterPath = (process.env.PRESENTER_PATH || 'exqi9dmadqqr').replace(/[^A-Za-z0-9_-]/g, '');

module.exports = {
  presenterPassword,
  presenterPath,
  PORT: Number(process.env.PORT) || 3000,
  HOST: process.env.HOST || '0.0.0.0',
};
