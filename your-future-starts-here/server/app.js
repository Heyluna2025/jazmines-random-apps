'use strict';

// The HTTP app. Runs the same way as a long-lived Node server (server/index.js)
// and as a Vercel function (api/index.js); only the store differs.

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const S = require('./sessions');
const { SLIDES, ACTIVITIES, DEMO_BRANCHES, SOCIAL, GUIDE, WELCOME, REGISTER, OFFER, PATHS } = require('./slides');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ON_VERCEL = Boolean(process.env.VERCEL);

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Spreadsheet apps run cells that start with = + - @ (or tab/CR) as formulas.
// Prefix them so a sign-up named "=HYPERLINK(...)" stays plain text in Excel.
function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

// Limits on the public write endpoints, per server instance. Two counters:
// per phone (participant id) to stop one device hammering, and a very high
// per-network cap so a whole school on one Wi-Fi is never blocked — it only
// stops scripted floods.
function rateLimiter({ perPhone, perNetwork, windowMs }) {
  const hits = new Map();
  const over = (key, limit, now) => {
    let entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
      if (hits.size > 20000) for (const [k, e] of hits) if (now > e.resetAt) hits.delete(k);
    }
    entry.count += 1;
    return entry.count > limit ? entry : null;
  };
  return (req, res, next) => {
    const now = Date.now();
    const pid = req.body && typeof req.body.pid === 'string' ? req.body.pid.slice(0, 64) : null;
    const hit = (pid && over(`p:${pid}`, perPhone, now)) || over(`n:${req.ip || 'unknown'}`, perNetwork, now);
    if (hit) {
      res.set('Retry-After', String(Math.ceil((hit.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Wait a moment and try again.' });
    }
    next();
  };
}

const DEFAULT_PRESENTER_PATH = 'exqi9dmadqqr';

function createApp({ store, presenterPassword, presenterPath = null, phoneLimit = 60, networkLimit = 30000 }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  const authRequired = Boolean(presenterPassword);
  const publicWrites = rateLimiter({ perPhone: phoneLimit, perNetwork: networkLimit, windowMs: 60 * 1000 });

  // Baseline security headers for everything the app serves.
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    next();
  });

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

  // Presenter calls carry either a sign-in token (when a password is set) or
  // the secret path itself (when the controls live at /c/<path>).
  const requirePresenter = wrap(async (req, res, next) => {
    const token = bearer(req);
    if (authRequired) {
      if (!(await store.hasToken(token))) return res.status(401).json({ error: 'Presenter sign-in required.' });
      return next();
    }
    if (presenterPath && !(token && safeEqual(token, presenterPath))) return res.status(401).json({ error: 'Presenter controls are at a private address.' });
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

  // The session the bare domain, /join and the presenter page open: the one
  // marked live while it runs, else the newest open one, else the live one even
  // after it ended (so late scans see the ending, not an empty room). With no
  // session at all, one is created so the app works with zero setup.
  async function resolveJoin({ create = false } = {}) {
    const live = await store.getLive();
    const liveSession = live ? await store.getSession(live) : null;
    if (liveSession && !liveSession.ended) return liveSession.code;
    const open = (await store.listSessions()).find((s) => !s.ended);
    if (open) return open.code;
    if (liveSession) return liveSession.code;
    if (!create) return null;
    const s = await store.createSession('Live session');
    await store.setLive(s.code);
    return s.code;
  }

  // ----- pages (the Node server; on Vercel these are rewrites in vercel.json)

  const sendPage = (file) => (req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
  const toLive = wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const code = await resolveJoin({ create: true });
    res.redirect(302, code ? `/a/${code}` : '/enter?nolive=1');
  });
  app.get('/', toLive);
  app.get('/join', toLive);
  app.get('/enter', sendPage('enter.html'));
  app.get('/a/:code', sendPage('audience/index.html'));
  const presenterPage = (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    if (presenterPath && !(req.params.slug && safeEqual(req.params.slug, presenterPath))) return res.status(404).type('text').send('Not found');
    res.sendFile(path.join(PUBLIC_DIR, 'presenter/index.html'));
  };
  app.get('/c/:slug', presenterPage);
  app.get(['/presenter', '/p/:code'], (req, res) => {
    if (presenterPath) return res.status(404).type('text').send('Not found');
    presenterPage(req, res);
  });
  app.get('/x/:code', sendPage('projector/index.html'));
  app.get('/demo', sendPage('demo/index.html'));
  // Pages, scripts and styles revalidate on every load so phones never mix an
  // old script with new content; fonts never change and can cache for a year.
  app.use(express.static(PUBLIC_DIR, {
    index: false,
    setHeaders: (res, filePath) => {
      res.set('Cache-Control', /\.woff2$/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }));

  // Short join link printed beside the QR code: https://host/CODE
  app.get('/:code', (req, res, next) => {
    const code = String(req.params.code).toUpperCase();
    if (!S.isCode(code)) return next();
    res.redirect(302, `/a/${code}`);
  });

  // ----- public API (audience + projector) ---------------------------------

  app.get('/api/config', (req, res) => {
    res.set('Cache-Control', 'public, max-age=60, s-maxage=3600');
    res.json({ slides: SLIDES, activities: ACTIVITIES, demoBranches: DEMO_BRANCHES, social: SOCIAL, guide: GUIDE, welcome: WELCOME, register: REGISTER, offer: OFFER, paths: PATHS });
  });

  app.get('/api/sessions/:code/state', codeParam, wrap(async (req, res) => {
    const s = await store.getSession(req.sessionCode);
    if (!s) throw S.notFound();
    // Phones poll this every couple of seconds. The edge serves it for one second,
    // so the function (and Redis) see about one request per second per room.
    res.set('Cache-Control', 'public, max-age=0, s-maxage=1');
    res.json({ state: S.publicState(s), joinUrl: joinUrl(req, s.code) });
  }));

  app.post('/api/sessions/:code/join', publicWrites, codeParam, noStore, wrap(async (req, res) => {
    const { pid, my, snapshot } = await store.join(req.sessionCode, (req.body || {}).pid);
    res.json({ pid, my, state: S.publicState(snapshot) });
  }));

  app.post('/api/sessions/:code/vote/:activity', publicWrites, codeParam, noStore, wrap(async (req, res) => {
    const body = req.body || {};
    const { choice, snapshot } = await store.vote(req.sessionCode, req.params.activity, body.pid, body.choice);
    res.json({ ok: true, choice, state: S.publicState(snapshot) });
  }));

  app.post('/api/sessions/:code/profile', publicWrites, codeParam, noStore, wrap(async (req, res) => {
    const body = req.body || {};
    const { profile, snapshot } = await store.setProfile(req.sessionCode, body.pid, body);
    res.json({ ok: true, name: profile.name, state: S.publicState(snapshot) });
  }));

  app.get('/api/sessions/:code/profiles', noStore, requirePresenter, codeParam, wrap(async (req, res) => {
    res.json({ profiles: await store.listProfiles(req.sessionCode) });
  }));

  app.get('/api/sessions/:code/profiles.csv', noStore, requirePresenter, codeParam, wrap(async (req, res) => {
    const rows = await store.listProfiles(req.sessionCode);
    const csv = ['Name,School,Email,Joined', ...rows.map((p) => [p.name, p.school, p.email, new Date(p.at).toISOString()].map(csvCell).join(','))].join('\r\n');
    res.type('text/csv').set('Content-Disposition', `attachment; filename="participants-${req.sessionCode}.csv"`).send(`﻿${csv}`);
  }));

  app.post('/api/sessions/:code/card-complete', publicWrites, codeParam, noStore, wrap(async (req, res) => {
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
    if (!authRequired) return res.json({ token: null, authRequired: false });
    const attempts = await store.loginAttempt(req.ip || 'unknown');
    if (attempts > 10) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const password = String((req.body || {}).password || '');
    if (!password || !safeEqual(password, presenterPassword)) return res.status(401).json({ error: 'Wrong password.' });
    const token = crypto.randomBytes(24).toString('base64url');
    await store.addToken(token);
    res.json({ token });
  }));

  app.get('/api/auth/check', noStore, requirePresenter, (req, res) => res.json({
    ok: true,
    authRequired,
    privatePath: Boolean(presenterPath),
    defaultPath: presenterPath === DEFAULT_PRESENTER_PATH,
    ...storageInfo(),
  }));

  // The session the presenter page opens by default (same rule as the bare domain).
  app.get('/api/sessions/live', noStore, requirePresenter, wrap(async (req, res) => {
    res.json({ code: await resolveJoin({ create: true }) });
  }));

  app.get('/api/sessions', noStore, requirePresenter, wrap(async (req, res) => {
    res.json({
      sessions: await store.listSessions(),
      baseUrl: publicBaseUrl(req),
      live: await store.getLive(),
      staticJoinUrl: publicBaseUrl(req),
      ...storageInfo(),
    });
  }));

  app.post('/api/sessions/:code/live', noStore, requirePresenter, codeParam, wrap(async (req, res) => {
    if (!(await store.getSession(req.sessionCode))) throw S.notFound();
    await store.setLive(req.sessionCode);
    res.json({ ok: true, live: req.sessionCode });
  }));

  app.post('/api/sessions', noStore, requirePresenter, wrap(async (req, res) => {
    const s = await store.createSession((req.body || {}).name);
    res.status(201).json({ code: s.code, joinUrl: joinUrl(req, s.code) });
  }));

  app.get('/api/sessions/:code/presenter-state', noStore, requirePresenter, codeParam, wrap(async (req, res) => {
    const s = await store.getSession(req.sessionCode);
    if (!s) throw S.notFound();
    const state = S.presenterState(s);
    state.isLive = (await store.getLive()) === s.code;
    state.staticJoinUrl = publicBaseUrl(req);
    res.json({ state, joinUrl: joinUrl(req, s.code), ...storageInfo() });
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
