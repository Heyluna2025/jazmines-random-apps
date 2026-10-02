(() => {
  'use strict';
  const { api, connect, esc, barChart } = window.YFSH;

  const code = (location.pathname.split('/')[2] || '').toUpperCase();
  const params = new URLSearchParams(location.search);
  const activityMode = params.get('mode') === 'activity';
  const showFooterQr = params.get('qr') !== '0';
  const stage = document.getElementById('stage');

  let config = null;
  let state = null;
  let joinUrl = `${location.origin}/a/${code}`;
  let connStatus = 'reconnecting';

  if (activityMode) document.body.classList.add('activity-mode');

  async function boot() {
    try {
      const [cfg, res] = await Promise.all([api('GET', '/api/config'), api('GET', `/api/sessions/${code}/state`)]);
      config = cfg;
      state = res.state;
      joinUrl = res.joinUrl || joinUrl;
    } catch (err) {
      stage.innerHTML = `<div class="card"><h1>${esc(err.message)}</h1><p class="muted">Open the projector from the presenter page.</p></div>`;
      return;
    }
    render();
    connect({
      code,
      role: 'projector',
      onState: (s) => { state = s; render(); },
      onStatus: (s) => { connStatus = s; render(); },
    });
  }

  const shortUrl = () => joinUrl.replace(/^https?:\/\//, '').replace(/\/a\//, '/');
  // Lets the big join link wrap only after the host, never mid-word.
  const shortUrlHtml = () => {
    const su = shortUrl();
    const slash = su.indexOf('/');
    return slash < 0 ? esc(su) : `${esc(su.slice(0, slash))}<wbr>${esc(su.slice(slash))}`;
  };

  function render() {
    if (!state) return;
    const slide = config.slides[state.slide - 1];
    const panel = renderPanel(slide);
    stage.innerHTML = `
      <div class="brand-bar">${window.YFSHLogo.html({ size: 'inherit' })}<span>AI and the Future of Work</span><span class="spacer"></span>
        ${connStatus === 'live' ? '' : '<span class="pill warn">Reconnecting…</span>'}</div>
      <div class="slide ${panel ? '' : 'no-panel'}">
        <div class="slide-text">
          ${slide.kicker ? `<div class="kicker">${esc(slide.kicker)}</div>` : ''}
          <h1>${esc(slide.title)}</h1>
          ${slide.lines ? `<div class="lines">${slide.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>` : ''}
          ${slide.columns ? `<div class="columns">${slide.columns.map((c) => `<div class="card"><h2>${esc(c.title)}</h2><p>${esc(c.text)}</p></div>`).join('')}</div>` : ''}
        </div>
        ${panel ? `<div class="panel">${panel}</div>` : ''}
      </div>
      <div class="footer">
        ${showFooterQr && state.slide !== 1 && !state.ended ? `<img class="mini-qr" src="/api/sessions/${code}/qr.svg" alt=""><span>Join:</span><span class="url">${esc(shortUrl())}</span>` : ''}
        <span class="pill">${state.participantCount} joined</span>
        <span class="slide-num">${state.slide} / ${state.slideCount}</span>
      </div>`;
  }

  function renderPanel(slide) {
    const A = config.activities;
    const act = state.activities;
    if (state.ended) {
      return `<div class="card center thanks">${window.YFSHLogo.html({ size: 'inherit' })}
        <div class="count">${act.card.completed}</div><div class="count-label">first small projects started today</div>
        <p class="muted" style="margin-top:1em">Thank you! 💜</p></div>`;
    }
    const focus = activityMode ? focusForActivityMode() : slide.activity;

    if (focus === 'poll') {
      const p = act.poll;
      if (p.revealed) {
        return `<div class="card"><div class="question">${esc(A.poll.question)}</div>
          ${barChart(A.poll.choices, p.counts, p.total)}
          <p class="count-label" style="margin-top:1em">${p.total} answer${p.total === 1 ? '' : 's'}</p></div>`;
      }
      if (state.slide === 1 || p.status === 'open' || activityMode) {
        return `<div class="card">
          <div class="join-big">
            <img class="qr" src="/api/sessions/${code}/qr.svg" alt="QR code to join">
            <div>
              <div class="kicker">Scan to join</div>
              <div class="url">${shortUrlHtml()}</div>
              <div class="kicker" style="margin-top:1em">or enter code</div>
              <div class="code">${esc(code)}</div>
            </div>
          </div>
          <div class="row" style="margin-top:2vmin;gap:2vmin;align-items:baseline">
            <span class="count">${p.total}</span>
            <span class="count-label">${p.status === 'open' ? 'answers so far' : p.status === 'closed' ? 'answers · poll closed' : 'answers · poll opens soon'}</span>
          </div>
        </div>`;
      }
      return `<div class="card center"><div class="count">${p.total}</div><div class="count-label">answers · results coming up</div></div>`;
    }

    if (focus === 'feature') {
      const f = act.feature;
      if (f.revealed) {
        const winner = f.winner !== null
          ? `<div class="winner-box"><div class="label">We’re building</div><div class="value">${esc(A.feature.choices[f.winner])}</div></div>`
          : `<div class="winner-box"><div class="label">It’s a tie</div><div class="value">Jazmine picks!</div></div>`;
        return `<div class="card">${winner}<div style="margin-top:2vmin">${barChart(A.feature.choices, f.counts, f.total)}</div></div>`;
      }
      return `<div class="card"><div class="question">${esc(A.feature.question)}</div>
        <div class="bars">${A.feature.choices.map((c, i) => `<div class="bar-row"><div class="bar-label">${i + 1}. ${esc(c)}</div></div>`).join('')}</div>
        <div class="row" style="margin-top:2vmin;gap:2vmin;align-items:baseline">
          <span class="count">${f.total}</span>
          <span class="count-label">${f.status === 'open' ? 'votes so far · vote on your phone' : f.status === 'closed' ? 'votes · voting closed' : 'votes · voting opens soon'}</span>
        </div></div>`;
    }

    if (focus === 'card') {
      const c = act.card;
      return `<div class="card center">
        <div class="question">${esc(A.card.prompt)}</div>
        <div class="count">${c.completed}</div>
        <div class="count-label">cards completed</div>
        <p class="muted" style="margin-top:1em">${c.status === 'open' ? 'Fill in your card on your phone.' : state.slide >= 10 ? 'Save your card. Show it to someone this week.' : 'Opening soon.'}</p>
      </div>`;
    }
    return null;
  }

  // Activity-only mode (used beside an external deck) mirrors what phones show.
  function focusForActivityMode() {
    const f = state.focus;
    if (f === 'waiting') return 'poll';
    return f;
  }

  // Arrow keys change slides only when this browser is signed in as presenter.
  const token = localStorage.getItem('yfsh:presenterToken');
  if (token) {
    document.addEventListener('keydown', (e) => {
      const delta = e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ' ? 1 : e.key === 'ArrowLeft' || e.key === 'PageUp' ? -1 : 0;
      if (!delta) return;
      e.preventDefault();
      api('POST', `/api/sessions/${code}/slide`, { delta }, { token }).catch(() => {});
    });
  }

  boot();
})();
