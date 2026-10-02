(() => {
  'use strict';
  const { api, connect, esc, barChart } = window.YFSH;

  const TOKEN_KEY = 'yfsh:presenterToken';
  const app = document.getElementById('app');

  let token = localStorage.getItem(TOKEN_KEY);
  let config = null;
  let view = 'login'; // login | list | control
  let sessions = [];
  let baseUrl = location.origin;
  let code = codeFromPath();
  let state = null;
  let joinUrl = '';
  let socket = null;
  let connStatus = 'reconnecting';
  let toastTimer = null;

  function codeFromPath() {
    const m = location.pathname.match(/^\/p\/([A-Za-z0-9]{4})$/);
    return m ? m[1].toUpperCase() : null;
  }

  const auth = () => ({ token });

  // ----- boot ---------------------------------------------------------------

  async function boot() {
    config = await api('GET', '/api/config');
    if (token) {
      try { await api('GET', '/api/auth/check', undefined, auth()); }
      catch { token = null; localStorage.removeItem(TOKEN_KEY); }
    }
    if (!token) { view = 'login'; return render(); }
    if (code) return openSession(code);
    return showList();
  }

  async function showList() {
    view = 'list';
    code = null;
    if (socket) { socket.close(); socket = null; }
    history.replaceState(null, '', '/presenter');
    const res = await api('GET', '/api/sessions', undefined, auth());
    sessions = res.sessions;
    baseUrl = res.baseUrl;
    render();
  }

  async function openSession(c) {
    code = c;
    view = 'control';
    history.replaceState(null, '', `/p/${code}`);
    try {
      const res = await api('GET', `/api/sessions/${code}/presenter-state`, undefined, auth());
      state = res.state;
      joinUrl = res.joinUrl;
    } catch (err) {
      toast(err.message);
      return showList();
    }
    render();
    if (socket) socket.close();
    socket = connect({
      code,
      role: 'presenter',
      token,
      onState: (s) => { state = s; render(); },
      onStatus: (s) => { connStatus = s; render(); if (s === 'gone') showList(); },
    });
  }

  // ----- actions ------------------------------------------------------------

  async function call(method, url, body) {
    try {
      return await api(method, url, body, auth());
    } catch (err) {
      if (err.status === 401) { token = null; localStorage.removeItem(TOKEN_KEY); view = 'login'; render(); }
      toast(err.message);
      throw err;
    }
  }

  const act = {
    async login(form) {
      const password = form.password.value;
      try {
        const res = await api('POST', '/api/auth/login', { password });
        token = res.token;
        localStorage.setItem(TOKEN_KEY, token);
        if (code) openSession(code); else showList();
      } catch (err) {
        toast(err.message);
      }
    },
    logout() {
      token = null;
      localStorage.removeItem(TOKEN_KEY);
      if (socket) { socket.close(); socket = null; }
      view = 'login';
      render();
    },
    async create(form) {
      const res = await call('POST', '/api/sessions', { name: form.name.value });
      openSession(res.code);
    },
    slide(n) { return call('POST', `/api/sessions/${code}/slide`, { slide: n }); },
    delta(d) { return call('POST', `/api/sessions/${code}/slide`, { delta: d }); },
    activity(id, action, extra = {}) { return call('POST', `/api/sessions/${code}/activities/${id}`, { action, ...extra }); },
    end() { return call('POST', `/api/sessions/${code}/end`); },
    resume() { return call('POST', `/api/sessions/${code}/resume`); },
    async reset() {
      const confirm = prompt(`Reset ALL responses for this session and go back to slide 1?\nType the session code (${code}) to confirm.`);
      if (confirm === null) return;
      await call('POST', `/api/sessions/${code}/reset`, { confirm });
      toast('Session reset.');
    },
    async remove() {
      const confirm = prompt(`Delete this session for good? Students will lose access.\nType the session code (${code}) to confirm.`);
      if (confirm === null) return;
      await call('DELETE', `/api/sessions/${code}`, { confirm });
      toast('Session deleted.');
      showList();
    },
    copy(text) {
      navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast('Could not copy'));
    },
  };

  function toast(message) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2500);
  }

  // ----- rendering ----------------------------------------------------------

  function render() {
    if (view === 'login') app.innerHTML = renderLogin();
    else if (view === 'list') app.innerHTML = renderList();
    else app.innerHTML = renderControl();
    bind();
  }

  function renderLogin() {
    return `<div class="login card stack">
      ${window.YFSHLogo.html({ size: 'md' })}
      <div>
        <div class="kicker muted">Presenter</div>
        <h1>Sign in</h1>
        <p class="muted">Controls are private. Students only need the session code.</p>
      </div>
      <form data-form="login">
        <label class="field"><span class="label">Presenter password</span>
          <input class="input" type="password" name="password" autocomplete="current-password" required autofocus></label>
        <button class="btn block" type="submit">Sign in</button>
      </form>
    </div>`;
  }

  function renderList() {
    return `<div class="top">${window.YFSHLogo.html({ size: 'sm' })}<h1>Sessions</h1><span class="spacer"></span>
      <a class="btn ghost small" href="/demo" target="_blank">Snack demo ↗</a>
      <button class="btn ghost small" data-act="logout">Sign out</button></div>
    <div class="grid">
      <div class="card">
        <h3>New session</h3>
        <p class="muted">Make a separate session for rehearsal so the real one starts clean.</p>
        <form data-form="create" class="row">
          <input class="input" name="name" placeholder="e.g. Rehearsal, or School visit — Oct 10" maxlength="60" style="flex:1 1 220px">
          <button class="btn" type="submit">Create</button>
        </form>
      </div>
      <div class="card span-all">
        <h3>Existing sessions</h3>
        ${sessions.length ? sessions.map((s) => `<div class="session-row">
          <span class="code">${esc(s.code)}</span>
          <strong>${esc(s.name)}</strong>
          <span class="muted">${s.participants} joined · slide ${s.slide}${s.ended ? ' · ended' : ''}</span>
          <span class="faint">${new Date(s.createdAt).toLocaleString()}</span>
          <span class="spacer"></span>
          <button class="btn small" data-open="${esc(s.code)}">Open controls</button>
        </div>`).join('') : '<p class="muted">No sessions yet.</p>'}
      </div>
    </div>`;
  }

  function statusPill(status) {
    const label = { pending: 'Not opened', open: 'OPEN', closed: 'Closed' }[status] || status;
    return `<span class="pill status-${status}">${label}</span>`;
  }

  function renderControl() {
    if (!state) return '<div class="card"><p class="muted">Loading session…</p></div>';
    const s = state;
    const slide = config.slides[s.slide - 1];
    const poll = s.activities.poll, feature = s.activities.feature, card = s.activities.card;
    const A = config.activities;
    const connPill = connStatus === 'live' ? '<span class="pill live">Live</span>' : '<span class="pill warn">Reconnecting…</span>';
    const shortUrl = joinUrl.replace(/^https?:\/\//, '').replace(/\/a\//, '/');

    return `
    <div class="top">
      ${window.YFSHLogo.html({ size: 'sm' })}
      <button class="btn ghost small" data-act="list">← Sessions</button>
      <h1>${esc(s.name)}</h1>
      <span class="code">${esc(s.code)}</span>
      ${connPill}
      ${s.ended ? '<span class="pill danger">Ended</span>' : ''}
      <span class="spacer"></span>
      <button class="btn ghost small" data-act="logout">Sign out</button>
    </div>

    <div class="grid">
      <div class="card">
        <div class="row" style="align-items:flex-start">
          <img class="qr" src="/api/sessions/${s.code}/qr.svg" alt="QR code to join">
          <div class="stack" style="flex:1 1 180px">
            <div><div class="stat-label">Short join link</div><div class="join-url">${esc(shortUrl)}</div></div>
            <div class="row">
              <button class="btn small" data-copy="${esc(joinUrl)}">Copy link</button>
              <button class="btn ghost small" data-copy="${esc(s.code)}">Copy code</button>
            </div>
          </div>
        </div>
        <div class="row" style="margin-top:14px">
          <div><div class="stat">${s.participantCount}</div><div class="stat-label">joined</div></div>
          <div><div class="stat">${s.connected ?? 0}</div><div class="stat-label">online now</div></div>
        </div>
      </div>

      <div class="card">
        <h3>Screens</h3>
        <div class="stack">
          <a class="btn block" href="/x/${s.code}" target="_blank">Open projector view ↗</a>
          <a class="btn ghost block" href="/x/${s.code}?mode=activity" target="_blank">Projector: activity panel only ↗</a>
          <a class="btn ghost block" href="/a/${s.code}" target="_blank">Preview the audience view ↗</a>
          <a class="btn ghost block" href="/demo" target="_blank">Snack demo (all branches) ↗</a>
        </div>
        <p class="faint" style="margin-top:10px">Use the activity-only projector beside an external slide deck. Arrow keys change slides on the projector only while you’re signed in there.</p>
      </div>

      <div class="card span-all">
        <div class="row">
          <button class="btn ghost" data-delta="-1" ${s.slide <= 1 ? 'disabled' : ''}>◀ Previous</button>
          <div style="flex:1 1 200px">
            <div class="stat-label">Slide ${s.slide} of ${s.slideCount}</div>
            <div class="current-slide">${esc(slide.title)}</div>
            <div class="muted">${esc(slide.hint || '')}</div>
          </div>
          <button class="btn" data-delta="1" ${s.slide >= s.slideCount ? 'disabled' : ''}>Next ▶</button>
        </div>
        <div class="slides">
          ${config.slides.map((sl) => `<button class="slide-btn ${sl.n === s.slide ? 'current' : ''}" data-slide="${sl.n}">
            <span class="n">${sl.n}</span>${esc(sl.title)}
            ${sl.activity ? `<span class="hint">${esc(A[sl.activity].title)}</span>` : ''}
          </button>`).join('')}
        </div>
      </div>

      <div class="card activity">
        <h3>1 · ${esc(A.poll.title)} ${statusPill(poll.status)}</h3>
        <p class="muted">${esc(A.poll.question)}</p>
        <div class="row">
          ${poll.status === 'open'
            ? '<button class="btn" data-activity="poll" data-action="close">Close poll</button>'
            : `<button class="btn" data-activity="poll" data-action="open" ${s.ended ? 'disabled' : ''}>${poll.status === 'closed' ? 'Reopen' : 'Open'} poll</button>`}
          ${poll.revealed
            ? '<button class="btn ghost" data-activity="poll" data-action="hide">Hide results</button>'
            : '<button class="btn ghost" data-activity="poll" data-action="reveal">Reveal results</button>'}
        </div>
        <p class="stat-label" style="margin-top:14px">${poll.total} response${poll.total === 1 ? '' : 's'} · ${poll.revealed ? 'showing on projector' : 'hidden from projector'}</p>
        ${barChart(A.poll.choices, poll.counts, poll.total)}
      </div>

      <div class="card activity">
        <h3>2 · ${esc(A.feature.title)} ${statusPill(feature.status)}</h3>
        <p class="muted">${esc(A.feature.question)}</p>
        <div class="row">
          ${feature.status === 'open'
            ? '<button class="btn" data-activity="feature" data-action="close">Close voting</button>'
            : `<button class="btn" data-activity="feature" data-action="open" ${s.ended ? 'disabled' : ''}>${feature.status === 'closed' ? 'Reopen' : 'Open'} voting</button>`}
          ${feature.revealed
            ? '<button class="btn ghost" data-activity="feature" data-action="hide">Hide winner</button>'
            : '<button class="btn ghost" data-activity="feature" data-action="reveal">Reveal winner</button>'}
        </div>
        <p class="stat-label" style="margin-top:14px">${feature.total} vote${feature.total === 1 ? '' : 's'} · ${feature.revealed ? 'winner showing' : 'winner hidden'}</p>
        ${barChart(A.feature.choices, feature.counts, feature.total)}
        ${renderWinner(feature, A.feature)}
      </div>

      <div class="card activity">
        <h3>3 · ${esc(A.card.title)} ${statusPill(card.status)}</h3>
        <p class="muted">${esc(A.card.prompt)}</p>
        <div class="row">
          ${card.status === 'open'
            ? '<button class="btn" data-activity="card" data-action="close">Close form</button>'
            : `<button class="btn" data-activity="card" data-action="open" ${s.ended ? 'disabled' : ''}>${card.status === 'closed' ? 'Reopen' : 'Open'} form</button>`}
        </div>
        <div class="row" style="margin-top:14px">
          <div><div class="stat">${card.completed}</div><div class="stat-label">cards completed</div></div>
        </div>
        <p class="faint">Card text stays on each student’s phone. Only the count reaches the server.</p>
      </div>

      <div class="card danger-zone span-all">
        <h3>Session</h3>
        <div class="row">
          ${s.ended
            ? '<button class="btn" data-act="resume">Resume session</button>'
            : '<button class="btn ghost" data-act="end">End session (students keep their cards)</button>'}
          <span class="spacer"></span>
          <button class="btn danger small" data-act="reset">Reset all responses…</button>
          <button class="btn danger small" data-act="remove">Delete session…</button>
        </div>
      </div>
    </div>`;
  }

  function renderWinner(feature, def) {
    if (feature.total === 0) return '<p class="faint" style="margin-top:12px">No votes yet.</p>';
    if (!feature.tie) {
      return `<div class="notice" style="margin-top:14px">Leading: <strong>${esc(def.choices[feature.winner])}</strong>
        ${feature.revealed ? ` · <a href="/demo?branch=${config.demoBranches[feature.winner].key}" target="_blank">open this demo branch ↗</a>` : ''}</div>`;
    }
    return `<div class="notice warn" style="margin-top:14px">
      <strong>It’s a tie.</strong> Pick the winner:
      <div class="row tie-pick">
        ${feature.leaders.map((i) => `<button class="btn small ${feature.winnerOverride === i ? '' : 'ghost'}" data-activity="feature" data-action="setWinner" data-choice="${i}">${esc(def.choices[i])}</button>`).join('')}
        ${feature.winnerOverride !== null ? '<button class="btn ghost small" data-activity="feature" data-action="setWinner" data-choice="null">Clear</button>' : ''}
      </div>
      ${feature.winner !== null && feature.revealed ? `<p style="margin:10px 0 0">Showing: <strong>${esc(def.choices[feature.winner])}</strong> · <a href="/demo?branch=${config.demoBranches[feature.winner].key}" target="_blank">open this demo branch ↗</a></p>` : ''}
    </div>`;
  }

  // ----- events -------------------------------------------------------------

  function bind() {
    app.querySelectorAll('form[data-form]').forEach((form) => {
      form.addEventListener('submit', (e) => { e.preventDefault(); act[form.dataset.form](form); });
    });
    app.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const name = b.dataset.act;
      if (name === 'list') return showList();
      act[name]();
    }));
    app.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openSession(b.dataset.open)));
    app.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => act.copy(b.dataset.copy)));
    app.querySelectorAll('[data-slide]').forEach((b) => b.addEventListener('click', () => act.slide(Number(b.dataset.slide))));
    app.querySelectorAll('[data-delta]').forEach((b) => b.addEventListener('click', () => act.delta(Number(b.dataset.delta))));
    app.querySelectorAll('[data-activity]').forEach((b) => b.addEventListener('click', () => {
      const extra = {};
      if (b.dataset.choice !== undefined) extra.choice = b.dataset.choice === 'null' ? null : Number(b.dataset.choice);
      act.activity(b.dataset.activity, b.dataset.action, extra);
    }));
  }

  document.addEventListener('keydown', (e) => {
    if (view !== 'control' || e.target.matches('input, textarea')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') act.delta(1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') act.delta(-1);
  });

  boot().catch((err) => { app.innerHTML = `<div class="card"><p class="notice danger">${esc(err.message)}</p></div>`; });
})();
