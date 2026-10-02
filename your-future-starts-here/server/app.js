'use strict';

// The HTTP app. Runs the same way as a long-lived Node server (server/index.js)
// and as a Vercel function (api/index.js); only the store differs.

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const S = require('./sessions');
const { SLIDES, ACTIVITIES, DEMO_BRANCHES } = require('./slides');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ON_VERCEL = Boolean(process.env.VERCEL);

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function createApp({ store, presenterPassword }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // Vercel's Node runtime may already have parsed the JSON body; parse it ourselves otherwise.
  const jsonBody = express.json({ limit: '10kb' });
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    let parsed;
    try { parsed = req.body; } catch { return res.status(400).json({ error: 'Bad request body.' }); }
    if (parsed === undefined) return jsonBody(req, res, next);
    if (typeof parsed !== 'object' || parsed === null || Buffer.isBuffer(parsed)) req.body = {};
    next();
  });

  // ----- helpers -----------------------------------------------------------

  const publicBaseUrl = (req) => {
    if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    return `${proto}://${req.get('host')}`;
  };
  const joinUrl = (req, code) => `${publicBaseUrl(req)}/a/${code}`;
  const bearer = (req) => {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  };
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  const storageInfo = () => ({ storage: store.kind, ephemeral: store.kind === 'memory' && ON_VERCEL });

  const requirePresenter = wrap(async (req, res, next) => {
    if (!(await store.hasToken(bearer(req)))) return res.status(401).json({ error: 'Presenter sign-in required.' });
    next();
  });

  const codeParam = (req, res, next) => {
    const code = String(req.params.code || '').toUpperCase();
    if (!S.isCode(code)) return res.status(404).json({ error: S.notFound().message });
    req.sessionCode = code;
    next();
  };

  // Destructive actions require the session code typed back as confirmation.
  const requireConfirm = (req, res, next) => {
    const confirm = String((req.body || {}).confirm || '').toUpperCase();
    if (confirm !== req.sessionCode) return res.status(400).json({ error: 'Type the session code to confirm.' });
    next();
  };

  // ----- pages (the Node server; on Vercel these are rewrites in vercel.json)

  const sendPage = (file) => (req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
  app.get('/a/:code', sendPage('audience/index.html'));
  app.get(['/presenter', '/p/:code'], sendPage('presenter/index.html'));
  app.get('/x/:code', sendPage('projector/index.html'));
  app.get('/demo', sendPage('demo/index.html'));
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: '1h' }));

  // Short join link printed beside the QR code: https://host/CODE
  app.get('/:code', (req, res, next) => {
    const code = String(req.params.code).toUpperCase();
    if (!S.isCode(code)) return next();
    res.redirect(302, `/a/${code}`);
  });

  // ----- public API (audience + projector) ---------------------------------

  app.get('/api/config', (req, res) => {
    res.set('Cache-Control', 'public, max-age=60, s-maxage=3600');
    res.json({ slides: SLIDES, activities: ACTIVITIES, demoBranches: DEMO_BRANCHES });
  });

  app.get('/api/sessions/:code/state', codeParam, wrap(async (req, res) => {
    const s = await store.getSession(req.sessionCode);
    if (!s) throw S.notFound();
    // Phones poll this every couple of seconds. The edge serves it for one second,
    // so the function (and Redis) see about one request per second per room.
    res.set('Cache-Control', 'public, max-age=0, s-maxage=1');
    res.json({ state: S.publicState(s), joinUrl: joinUrl(req, s.code) });
  }));

  app.post('/api/sessions/:code/join', codeParam, noStore, wrap(async (req, res) => {
    const { pid, my, snapshot } = await store.join(req.sessionCode, (req.body || {}).pid);
    res.json({ pid, my, state: S.publicState(snapshot) });
  }));

  app.post('/api/sessions/:code/vote/:activity', codeParam, noStore, wrap(async (req, res) => {
    const body = req.body || {};
    const { choice, snapshot } = await store.vote(req.sessionCode, req.params.activity, body.pid, body.choice);
    res.json({ ok: true, choice, state: S.publicState(snapshot) });
  }));

  app.post('/api/sessions/:code/card-complete', codeParam, noStore, wrap(async (req, res) => {
    const { duplicate, snapshot } = await store.completeCard(req.sessionCode, (req.body || {}).pid);
    res.json({ ok: true, completed: true, duplicate, state: S.publicState(snapshot) });
  }));

  app.get('/api/sessions/:code/qr.svg', codeParam, wrap(async (req, res) => {
    if (!(await store.getSession(req.sessionCode))) return res.status(404).type('text').send('Session not found');
    const svg = await QRCode.toString(joinUrl(req, req.sessionCode), {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#1f1150', light: '#ffffff' },
    });
    res.set('Cache-Control', 'public, max-age=300, s-maxage=86400').type('image/svg+xml').send(svg);
  }));

  // ----- presenter API -----------------------------------------------------

  app.post('/api/auth/login', noStore, wrap(async (req, res) => {
    if (!presenterPassword) {
      return res.status(503).json({ error: 'The presenter password is not set on the server. Add PRESENTER_PASSWORD in your host settings (Vercel: Settings → Environment Variables), then redeploy.' });
    }
    const attempts = await store.loginAttempt(req.ip || 'unknown');
    if (attempts > 10) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const password = String((req.body || {}).password || '');
    if (!password || !safeEqual(password, presenterPassword)) return res.status(401).json({ error: 'Wrong password.' });
    const token = crypto.randomBytes(24).toString('base64url');
    await store.addToken(token);
    res.json({ token });
  }));

  app.get('/api/auth/check', noStore, requirePresenter, (req, res) => res.json({ ok: true, ...storageInfo() }));

  app.get('/api/sessions', noStore, requirePresenter, wrap(async (req, res) => {
    res.json({ sessions: await store.listSessions(), baseUrl: publicBaseUrl(req), ...storageInfo() });
  }));

  app.post('/api/sessions', noStore, requirePresenter, wrap(async (req, res) => {
    const s = await store.createSession((req.body || {}).name);
    res.status(201).json({ code: s.code, joinUrl: joinUrl(req, s.code) });
  }));

  app.get('/api/sessions/:code/presenter-state', noStore, requirePresenter, codeParam, wrap(async (req, res) => {
    const s = await store.getSession(req.sessionCode);
    if (!s) throw S.notFound();
    res.json({ state: S.presenterState(s), joinUrl: joinUrl(req, s.code), ...storageInfo() });
  }));

  app.post('/api/sessions/:code/slide', noStore, requirePresenter, codeParam, wrap(async (req, res) => {
    const body = req.body || {};
    let target;
    if (body.slide !== undefined) target = Number(body.slide);
    else {
      const s = await store.getSession(req.sessionCode);
      if (!s) throw S.notFound();
      target = s.slide + Number(body.delta || 0);
    }
    const s = await store.setSlide(req.sessionCode, Math.min(Math.max(target, 1), SLIDES.length));
    res.json({ ok: true, slide: s.slide });
  }));

  app.post('/api/sessions/:code/activities/:id', noStore, requirePresenter, codeParam, wrap(async (req, res) => {
    const body = req.body || {};
    await store.setActivity(req.sessionCode, req.params.id, body.action, body);
    res.json({ ok: true });
  }));

  app.post('/api/sessions/:code/end', noStore, requirePresenter, codeParam, wrap(async (req, res) => {
    await store.endSession(req.sessionCode);
    res.json({ ok: true });
  }));

  app.post('/api/sessions/:code/resume', noStore, requirePresenter, codeParam, wrap(async (req, res) => {
    await store.resumeSession(req.sessionCode);
    res.json({ ok: true });
  }));

  app.post('/api/sessions/:code/reset', noStore, requirePresenter, codeParam, requireConfirm, wrap(async (req, res) => {
    await store.resetSession(req.sessionCode);
    res.json({ ok: true });
  }));

  app.delete('/api/sessions/:code', noStore, requirePresenter, codeParam, requireConfirm, wrap(async (req, res) => {
    await store.deleteSession(req.sessionCode);
    res.json({ ok: true });
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof S.StoreError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'Bad request body.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}

module.exports = { createApp };
