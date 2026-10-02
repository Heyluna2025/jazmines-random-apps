'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { WebSocketServer, WebSocket } = require('ws');
const { SessionStore, StoreError } = require('./sessions');
const { SLIDES, ACTIVITIES, DEMO_BRANCHES } = require('./slides');

loadDotEnv(path.join(__dirname, '..', '.env'));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'sessions.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const BROADCAST_DELAY_MS = 200; // coalesce bursts of votes into one push per room

let PRESENTER_PASSWORD = process.env.PRESENTER_PASSWORD;
if (!PRESENTER_PASSWORD) {
  PRESENTER_PASSWORD = crypto.randomBytes(6).toString('base64url');
  console.warn('\n[auth] PRESENTER_PASSWORD is not set. Using a temporary password for this run:');
  console.warn(`[auth]   ${PRESENTER_PASSWORD}`);
  console.warn('[auth] Set PRESENTER_PASSWORD in .env or your host settings for a stable password.\n');
}

const store = new SessionStore(DATA_FILE);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '10kb' }));

// ---------------------------------------------------------------------------
// Helpers

function publicBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
}

function joinUrl(req, code) {
  return `${publicBaseUrl(req)}/a/${code}`;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

function requirePresenter(req, res, next) {
  if (!store.hasToken(bearer(req))) return res.status(401).json({ error: 'Presenter sign-in required.' });
  next();
}

function codeParam(req, res, next) {
  const code = String(req.params.code || '').toUpperCase();
  if (!SessionStore.isCode(code)) return res.status(404).json({ error: 'Session not found. Check the code and try again.' });
  req.sessionCode = code;
  next();
}

const wrap = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (err) {
    if (err instanceof StoreError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
};

// Login attempts are limited per IP so the presenter password can't be brute-forced.
const loginAttempts = new Map();
function loginLimiter(req, res, next) {
  const now = Date.now();
  const key = req.ip;
  const entry = loginAttempts.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 15 * 60 * 1000;
  }
  if (entry.count >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  entry.count++;
  loginAttempts.set(key, entry);
  next();
}

// ---------------------------------------------------------------------------
// Pages

const sendPage = (file) => (req, res) => res.sendFile(path.join(PUBLIC_DIR, file));

app.get('/a/:code', sendPage('audience/index.html'));
app.get(['/presenter', '/p/:code'], sendPage('presenter/index.html'));
app.get('/x/:code', sendPage('projector/index.html'));
app.get('/demo', sendPage('demo/index.html'));
app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: '1h' }));

// Short join link printed beside the QR code: https://host/CODE
app.get('/:code', (req, res, next) => {
  const code = String(req.params.code).toUpperCase();
  if (!SessionStore.isCode(code)) return next();
  res.redirect(302, `/a/${code}`);
});

// ---------------------------------------------------------------------------
// Public API (audience + projector)

app.get('/api/config', (req, res) => {
  res.json({ slides: SLIDES, activities: ACTIVITIES, demoBranches: DEMO_BRANCHES });
});

app.get('/api/sessions/:code/state', codeParam, wrap((req, res) => {
  const state = store.publicState(req.sessionCode);
  if (!state) throw new StoreError(404, 'Session not found. Check the code and try again.');
  res.json({ state, joinUrl: joinUrl(req, req.sessionCode) });
}));

app.post('/api/sessions/:code/join', codeParam, wrap((req, res) => {
  const { pid, my } = store.join(req.sessionCode, req.body && req.body.pid);
  res.json({ pid, my, state: store.publicState(req.sessionCode) });
}));

app.post('/api/sessions/:code/vote/:activity', codeParam, wrap((req, res) => {
  const body = req.body || {};
  const result = store.vote(req.sessionCode, req.params.activity, body.pid, body.choice);
  res.json({ ok: true, ...result });
}));

app.post('/api/sessions/:code/card-complete', codeParam, wrap((req, res) => {
  const result = store.completeCard(req.sessionCode, (req.body || {}).pid);
  res.json({ ok: true, ...result });
}));

app.get('/api/sessions/:code/qr.svg', codeParam, async (req, res) => {
  if (!store.get(req.sessionCode)) return res.status(404).type('text').send('Session not found');
  try {
    const svg = await QRCode.toString(joinUrl(req, req.sessionCode), {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#1f1150', light: '#ffffff' },
    });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  } catch (err) {
    console.error(err);
    res.status(500).type('text').send('Could not build QR code');
  }
});

// ---------------------------------------------------------------------------
// Presenter API

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const password = String((req.body || {}).password || '');
  if (!password || !safeEqual(password, PRESENTER_PASSWORD)) {
    return res.status(401).json({ error: 'Wrong password.' });
  }
  const token = crypto.randomBytes(24).toString('base64url');
  store.addToken(token);
  res.json({ token });
});

app.get('/api/auth/check', requirePresenter, (req, res) => res.json({ ok: true }));

app.get('/api/sessions', requirePresenter, (req, res) => {
  res.json({ sessions: store.list(), baseUrl: publicBaseUrl(req) });
});

app.post('/api/sessions', requirePresenter, wrap((req, res) => {
  const s = store.create((req.body || {}).name);
  res.status(201).json({ code: s.code, joinUrl: joinUrl(req, s.code) });
}));

app.get('/api/sessions/:code/presenter-state', requirePresenter, codeParam, wrap((req, res) => {
  const state = store.presenterState(req.sessionCode);
  if (!state) throw new StoreError(404, 'Session not found. Check the code and try again.');
  state.connected = connectedAudience(req.sessionCode);
  res.json({ state, joinUrl: joinUrl(req, req.sessionCode) });
}));

app.post('/api/sessions/:code/slide', requirePresenter, codeParam, wrap((req, res) => {
  const body = req.body || {};
  const current = store.require(req.sessionCode).slide;
  const target = body.slide !== undefined ? Number(body.slide) : current + Number(body.delta || 0);
  const s = store.setSlide(req.sessionCode, Math.min(Math.max(target, 1), SLIDES.length));
  res.json({ ok: true, slide: s.slide });
}));

app.post('/api/sessions/:code/activities/:id', requirePresenter, codeParam, wrap((req, res) => {
  const body = req.body || {};
  store.setActivity(req.sessionCode, req.params.id, body.action, body);
  res.json({ ok: true });
}));

app.post('/api/sessions/:code/end', requirePresenter, codeParam, wrap((req, res) => {
  store.end(req.sessionCode);
  res.json({ ok: true });
}));

app.post('/api/sessions/:code/resume', requirePresenter, codeParam, wrap((req, res) => {
  store.resume(req.sessionCode);
  res.json({ ok: true });
}));

// Destructive actions require the session code typed back as confirmation.
function requireConfirm(req, res, next) {
  const confirm = String((req.body || {}).confirm || '').toUpperCase();
  if (confirm !== req.sessionCode) return res.status(400).json({ error: 'Type the session code to confirm.' });
  next();
}

app.post('/api/sessions/:code/reset', requirePresenter, codeParam, requireConfirm, wrap((req, res) => {
  store.reset(req.sessionCode);
  res.json({ ok: true });
}));

app.delete('/api/sessions/:code', requirePresenter, codeParam, requireConfirm, wrap((req, res) => {
  store.delete(req.sessionCode);
  res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---------------------------------------------------------------------------
// WebSocket: one room per session; every change pushes fresh state to the room.

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') return socket.destroy();
  const code = (url.searchParams.get('code') || '').toUpperCase();
  const role = url.searchParams.get('role') === 'presenter' ? 'presenter' : (url.searchParams.get('role') === 'projector' ? 'projector' : 'audience');
  if (!SessionStore.isCode(code) || !store.get(code)) return socket.destroy();
  if (role === 'presenter' && !store.hasToken(url.searchParams.get('token'))) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.sessionCode = code;
    ws.role = role;
    ws.isAlive = true;
    wss.emit('connection', ws, req);
  });
});

function connectedAudience(code) {
  let n = 0;
  for (const c of wss.clients) if (c.sessionCode === code && c.role === 'audience' && c.readyState === WebSocket.OPEN) n++;
  return n;
}

function stateMessage(code, role) {
  if (role === 'presenter') {
    const state = store.presenterState(code);
    if (!state) return JSON.stringify({ type: 'gone' });
    state.connected = connectedAudience(code);
    return JSON.stringify({ type: 'state', state });
  }
  const state = store.publicState(code);
  return state ? JSON.stringify({ type: 'state', state }) : JSON.stringify({ type: 'gone' });
}

const pendingBroadcast = new Map();
function scheduleBroadcast(code) {
  if (pendingBroadcast.has(code)) return;
  pendingBroadcast.set(code, setTimeout(() => {
    pendingBroadcast.delete(code);
    broadcast(code);
  }, BROADCAST_DELAY_MS));
}

function broadcast(code) {
  const messages = { audience: stateMessage(code, 'audience'), presenter: stateMessage(code, 'presenter') };
  messages.projector = messages.audience;
  for (const client of wss.clients) {
    if (client.sessionCode !== code || client.readyState !== WebSocket.OPEN) continue;
    client.send(messages[client.role]);
  }
}

store.onChange = scheduleBroadcast;

wss.on('connection', (ws) => {
  ws.send(stateMessage(ws.sessionCode, ws.role));
  if (ws.role === 'audience') scheduleBroadcast(ws.sessionCode);
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    if (String(data) === 'ping') ws.send('pong');
  });
  ws.on('close', () => {
    if (ws.role === 'audience') scheduleBroadcast(ws.sessionCode);
  });
  ws.on('error', () => {});
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
heartbeat.unref(); // the listening server keeps the process alive, not this timer

// ---------------------------------------------------------------------------

function shutdown() {
  clearInterval(heartbeat);
  store.saveNow();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Your Future Starts Here — listening on http://localhost:${PORT}`);
    console.log(`  Audience join page:  /  (or /a/CODE)`);
    console.log(`  Presenter controls:  /presenter`);
    console.log(`  Projector view:      /x/CODE`);
    console.log(`  Snack demo:          /demo`);
  });
}

module.exports = { app, server, store, wss };

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
