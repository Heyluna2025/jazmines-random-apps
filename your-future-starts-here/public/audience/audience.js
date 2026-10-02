(() => {
  'use strict';
  const { api, apiRetry, poll, codeFromLocation, esc } = window.YFSH;

  const code = codeFromLocation();
  const app = document.getElementById('app');
  const conn = document.getElementById('conn');

  const PID_KEY = 'yfsh:pid';
  const CARD_KEY = `yfsh:card:${code}`;
  const DRAFT_KEY = `yfsh:draft:${code}`;
  const SENT_KEY = `yfsh:cardSent:${code}`;

  let pid = localStorage.getItem(PID_KEY);
  let config = null;
  let poller = null;
  let state = null;
  let my = { poll: null, feature: null, cardCompleted: false };
  let card = readJson(CARD_KEY);
  let draft = readJson(DRAFT_KEY) || {};
  const ui = { pollPick: null, pollEditing: false, featurePick: null, featureEditing: false, busy: false, notice: null, imageUrl: null };

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  }

  // ----- boot ---------------------------------------------------------------

  async function boot() {
    if (!code) return fatal('That link is missing a session code.', true);
    try {
      const [cfg, joined] = await Promise.all([
        apiRetry('GET', '/api/config'),
        apiRetry('POST', `/api/sessions/${code}/join`, { pid }),
      ]);
      config = cfg;
      pid = joined.pid;
      localStorage.setItem(PID_KEY, pid);
      my = joined.my;
      state = joined.state;
    } catch (err) {
      return fatal(err.status === 404 ? 'Session not found. Check the code on the big screen.' : 'Could not reach the session. Check your connection and try again.', err.status === 404);
    }
    render();
    poller = poll({
      url: `/api/sessions/${code}/state`,
      interval: 2000,
      initial: state,
      onState: (s) => { state = s; render(); },
      onStatus: setConn,
    });
  }

  function setConn(status) {
    if (status === 'live') { conn.textContent = 'Live'; conn.className = 'pill live'; }
    else if (status === 'gone') { conn.textContent = 'Session removed'; conn.className = 'pill danger'; }
    else { conn.textContent = 'Reconnecting…'; conn.className = 'pill warn'; }
  }

  function fatal(message, offerHome) {
    conn.textContent = 'Offline';
    conn.className = 'pill danger';
    app.innerHTML = `<div class="card wait">
      <div class="big-emoji">😕</div>
      <h2>${esc(message)}</h2>
      ${offerHome ? '<a class="btn" href="/">Enter a code</a>' : '<button class="btn" onclick="location.reload()">Try again</button>'}
    </div>`;
  }

  // ----- rendering ----------------------------------------------------------

  function render() {
    if (!state) return;
    const focus = state.focus;
    let html;
    if (focus === 'ended') html = renderEnded();
    else if (focus === 'card') html = renderCard();
    else if (focus === 'feature') html = renderFeature();
    else if (focus === 'poll') html = renderPoll();
    else html = renderWaiting();
    app.innerHTML = (ui.notice ? `<div class="notice ${ui.notice.kind || ''}">${esc(ui.notice.text)}</div>` : '') + html;
    bind();
  }

  function renderWaiting() {
    return `<div class="card wait">
      <div class="big-emoji">👀</div>
      <h1>Look at the big screen</h1>
      <p class="muted">${esc(state.slideTitle)}</p>
      <p class="faint">The next activity will show up here by itself.</p>
    </div>`;
  }

  function choiceList(choices, picked) {
    return `<div class="choices">${choices.map((c, i) =>
      `<button type="button" class="choice ${picked === i ? 'selected' : ''}" data-pick="${i}" aria-pressed="${picked === i}">
        <span class="dot"></span><span>${esc(c)}</span></button>`).join('')}</div>`;
  }

  function renderPoll() {
    const a = config.activities.poll;
    const st = state.activities.poll;
    if (my.poll !== null && !ui.pollEditing) {
      return `<div class="card wait">
        <div class="big-emoji">🎉</div>
        <h1>You’re in! Look at the big screen.</h1>
        <p class="muted">You picked: <strong>${esc(a.choices[my.poll])}</strong></p>
        ${st.status === 'open'
          ? '<button class="btn ghost" data-action="poll-edit">Change my answer</button>'
          : '<p class="faint">The poll is closed.</p>'}
      </div>`;
    }
    if (st.status !== 'open') {
      return `<div class="card wait">
        <div class="big-emoji">⏳</div>
        <h1>This poll has closed</h1>
        <p class="muted">Look at the big screen.</p>
      </div>`;
    }
    const picked = ui.pollPick ?? my.poll;
    return `<div class="card">
      <div class="kicker">${esc(a.title)}</div>
      <div class="question">${esc(a.question)}</div>
      ${choiceList(a.choices, picked)}
      <button class="btn block" data-action="poll-submit" ${picked === null || ui.busy ? 'disabled' : ''}>${ui.busy ? 'Sending…' : 'Submit'}</button>
    </div>`;
  }

  function renderFeature() {
    const a = config.activities.feature;
    const st = state.activities.feature;
    if (st.revealed) {
      const winner = st.winner;
      return `<div class="card center">
        <div class="kicker">${esc(a.title)}</div>
        ${winner !== null
          ? `<div class="winner"><div class="label">We’re building</div><div class="value">${esc(a.choices[winner])}</div></div>
             <p class="muted">Watch the demo on the big screen.</p>`
          : `<div class="winner"><div class="label">It’s a tie!</div><div class="value">Jazmine will pick one</div></div>`}
        ${my.feature !== null ? `<p class="faint">You voted: ${esc(a.choices[my.feature])}</p>` : ''}
      </div>`;
    }
    if (my.feature !== null && !ui.featureEditing) {
      return `<div class="card wait">
        <div class="big-emoji">✅</div>
        <h1>Vote counted!</h1>
        <p class="muted">You picked: <strong>${esc(a.choices[my.feature])}</strong></p>
        ${st.status === 'open'
          ? '<button class="btn ghost" data-action="feature-edit">Change my vote</button>'
          : '<p class="faint">Voting is closed. Waiting for the reveal…</p>'}
      </div>`;
    }
    if (st.status !== 'open') {
      return `<div class="card wait">
        <div class="big-emoji">⏳</div>
        <h1>Voting is closed</h1>
        <p class="muted">Waiting for the reveal on the big screen.</p>
      </div>`;
    }
    const picked = ui.featurePick ?? my.feature;
    return `<div class="card">
      <div class="kicker">${esc(a.title)}</div>
      <p class="muted">A snack-ordering app for the school fair.</p>
      <div class="question">${esc(a.question)}</div>
      ${choiceList(a.choices, picked)}
      <button class="btn block" data-action="feature-submit" ${picked === null || ui.busy ? 'disabled' : ''}>${ui.busy ? 'Sending…' : 'Vote'}</button>
    </div>`;
  }

  function cardMarkup(c) {
    const a = config.activities.card;
    return `<div class="action-card" id="action-card">
      <div class="ac-title">My first small project</div>
      <div class="ac-project">${esc(projectSentence(c))}</div>
      <div class="ac-row"><div class="ac-label">Who I could help</div><div class="ac-value">${esc(c.who)}</div></div>
      <div class="ac-row"><div class="ac-label">My first step</div><div class="ac-value">${esc(a.firstSteps[c.step])}</div></div>
      <div class="ac-reminder"><strong>Reminder:</strong> ${esc(a.reminder)}</div>
      <div class="ac-footer">${window.YFSHLogo.html({ size: 'sm' })}<span>Your Future Starts Here</span></div>
    </div>`;
  }

  function projectSentence(c) {
    return `I want to help ${c.who.trim()} ${c.what.trim()} more easily.`;
  }

  function renderCard() {
    const a = config.activities.card;
    const st = state.activities.card;
    if (card) return renderSavedCard();
    const closed = st.status !== 'open';
    return `<div class="card">
      <div class="kicker">${esc(a.title)}</div>
      <div class="question">${esc(a.prompt)}</div>
      ${closed ? '<div class="notice warn">The activity has closed, but you can still finish your card. It stays on your phone.</div>' : ''}
      <div class="examples"><strong>Examples</strong><ul>${a.examples.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>
      <form id="card-form" autocomplete="off">
        <label class="field">
          <span class="label">${esc(a.fields.who.label)}</span>
          <span class="help">${esc(a.fields.who.help)}</span>
          <input class="input" name="who" maxlength="60" placeholder="${esc(a.fields.who.placeholder)}" value="${esc(draft.who || '')}" required>
        </label>
        <label class="field">
          <span class="label">${esc(a.fields.what.label)}</span>
          <span class="help">${esc(a.fields.what.help)}</span>
          <input class="input" name="what" maxlength="80" placeholder="${esc(a.fields.what.placeholder)}" value="${esc(draft.what || '')}" required>
        </label>
        <div class="field"><span class="label" style="display:block;font-weight:800;margin-bottom:8px">${esc(a.fields.step.label)}</span>
          ${choiceList(a.firstSteps, draft.step ?? null)}
        </div>
        <button class="btn block" type="submit">Make my card</button>
      </form>
    </div>`;
  }

  // The follow-Jazmine invitation, shown once the talk is wrapping up.
  function followBlock() {
    const social = config.social;
    if (!social || !social.links || !social.links.length) return '';
    return `<div class="card follow">
      <div class="kicker">Keep going</div>
      <h2>${esc(social.invite)}</h2>
      <div class="stack">${social.links.map((l) =>
        `<a class="btn ghost block" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} · ${esc(l.handle)}</a>`).join('')}</div>
    </div>`;
  }

  const atTheEnd = () => state.ended || state.slide >= 10;

  function renderSavedCard() {
    const ended = state.ended;
    return `<div class="stack">
      ${ended ? '<div class="notice">The session has ended. Your card is saved on this phone — take a screenshot or save the image below.</div>' : ''}
      ${cardMarkup(card)}
      <div class="row">
        <button class="btn" data-action="card-image">Save card as image</button>
        <button class="btn ghost" data-action="card-edit">Edit</button>
      </div>
      ${ui.imageUrl ? `<div class="stack">
        <img class="card-preview" src="${ui.imageUrl}" alt="Your action card">
        <div class="row">
          <a class="btn" href="${ui.imageUrl}" download="my-first-small-project.png">Download image</a>
          ${navigator.canShare ? '<button class="btn ghost" data-action="card-share">Share</button>' : ''}
        </div>
        <p class="faint">On a phone you can also press and hold the image to save it.</p>
      </div>` : '<p class="faint">Tip: a screenshot works too.</p>'}
      ${atTheEnd() ? followBlock() : ''}
    </div>`;
  }

  function renderEnded() {
    if (card) return renderSavedCard();
    return `<div class="stack">
      <div class="card wait">
        <div class="big-emoji">💜</div>
        <h1>Thanks for joining!</h1>
        <p class="muted">The session has ended. Keep asking clearly, checking carefully, and finishing something useful.</p>
      </div>
      ${followBlock()}
    </div>`;
  }

  // ----- events -------------------------------------------------------------

  function bind() {
    app.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.pick);
        if (state.focus === 'poll') ui.pollPick = i;
        else if (state.focus === 'feature') ui.featurePick = i;
        else { draft.step = i; writeJson(DRAFT_KEY, draft); }
        render();
      });
    });
    app.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => actions[btn.dataset.action] && actions[btn.dataset.action]());
    });
    const form = document.getElementById('card-form');
    if (form) {
      form.addEventListener('input', () => {
        draft.who = form.who.value;
        draft.what = form.what.value;
        writeJson(DRAFT_KEY, draft);
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const who = form.who.value.trim();
        const what = form.what.value.trim();
        if (!who || !what) return notice('Fill in both blanks first.', 'warn');
        if (draft.step === undefined || draft.step === null) return notice('Pick your first step.', 'warn');
        card = { who, what, step: draft.step, createdAt: Date.now() };
        writeJson(CARD_KEY, card);
        ui.notice = null;
        render();
        sendCompletion();
      });
      // Keep focus where the student was typing after a re-render
      const focusName = document.activeElement && document.activeElement.name;
      if (focusName && form[focusName]) form[focusName].focus();
    }
  }

  function notice(text, kind) {
    ui.notice = { text, kind };
    render();
    setTimeout(() => { if (ui.notice && ui.notice.text === text) { ui.notice = null; render(); } }, 4000);
  }

  async function submitVote(activity, choice) {
    ui.busy = true;
    ui.notice = null;
    render();
    try {
      const res = await apiRetry('POST', `/api/sessions/${code}/vote/${activity}`, { pid, choice }, {
        onRetry: () => notice('Slow connection — retrying…', 'warn'),
      });
      my[activity] = res.choice;
      if (activity === 'poll') { ui.pollEditing = false; ui.pollPick = null; }
      else { ui.featureEditing = false; ui.featurePick = null; }
      ui.notice = null;
      if (poller && res.state) poller.apply(res.state);
    } catch (err) {
      ui.notice = { text: err.status === 409 ? 'Too late — this one just closed.' : err.message, kind: 'danger' };
    }
    ui.busy = false;
    render();
  }

  async function sendCompletion() {
    if (localStorage.getItem(SENT_KEY)) return;
    try {
      const res = await apiRetry('POST', `/api/sessions/${code}/card-complete`, { pid });
      localStorage.setItem(SENT_KEY, '1');
      my.cardCompleted = true;
      if (poller && res.state) poller.apply(res.state);
    } catch {
      // The card itself is already saved on the phone; the count is a nice-to-have.
    }
  }

  const actions = {
    'poll-edit': () => { ui.pollEditing = true; ui.pollPick = my.poll; render(); },
    'poll-submit': () => submitVote('poll', ui.pollPick ?? my.poll),
    'feature-edit': () => { ui.featureEditing = true; ui.featurePick = my.feature; render(); },
    'feature-submit': () => submitVote('feature', ui.featurePick ?? my.feature),
    'card-edit': () => {
      draft = { who: card.who, what: card.what, step: card.step };
      writeJson(DRAFT_KEY, draft);
      card = null;
      localStorage.removeItem(CARD_KEY);
      if (ui.imageUrl) { URL.revokeObjectURL(ui.imageUrl); ui.imageUrl = null; }
      render();
    },
    'card-image': async () => {
      const a = config.activities.card;
      if (document.fonts && document.fonts.load) {
        try { await Promise.all([document.fonts.load('900 58px Nunito'), document.fonts.load('400 40px "Bebas Neue"')]); }
        catch { /* fall back to system fonts */ }
      }
      const handles = ((config.social && config.social.links) || []).filter((l) => l.handle.startsWith('@'));
      const canvas = window.YFSHCard.render({
        project: projectSentence(card),
        who: card.who,
        step: a.firstSteps[card.step],
        reminder: a.reminder,
        follow: handles.length ? `Follow Jazmine: ${handles.map((l) => `${l.label} ${l.handle}`).join('  ·  ')}` : '',
      });
      const blob = await window.YFSHCard.toBlob(canvas);
      if (ui.imageUrl) URL.revokeObjectURL(ui.imageUrl);
      ui.imageUrl = URL.createObjectURL(blob);
      ui.imageBlob = blob;
      render();
      const img = app.querySelector('.card-preview');
      if (img) img.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    'card-share': async () => {
      if (!ui.imageBlob) return;
      const file = new File([ui.imageBlob], 'my-first-small-project.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'My first small project' }); } catch { /* cancelled */ }
      } else {
        notice('Sharing is not available here — use Download instead.', 'warn');
      }
    },
  };

  boot();
})();
