(() => {
  'use strict';
  const { api, apiRetry, poll, codeFromLocation, esc, barChart } = window.YFSH;

  // Self-paced phone flow. The phone keeps its own place (step); the server
  // keeps everyone's answers so the results each phone shows are shared.
  const STEPS = ['welcome', 'register', 'poll', 'pollResults', 'feature', 'featureResults', 'card', 'guide', 'follow'];

  const code = codeFromLocation();
  const app = document.getElementById('app');
  const conn = document.getElementById('conn');

  const PID_KEY = 'yfsh:pid';
  const STEP_KEY = `yfsh:step:${code}`;
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
  let step = localStorage.getItem(STEP_KEY) || 'welcome';
  const ui = { pollPick: null, featurePick: null, busy: false, notice: null, imageUrl: null, imageBlob: null };

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  }
  function goTo(next) {
    step = next;
    try { localStorage.setItem(STEP_KEY, step); } catch { /* ignore */ }
    ui.notice = null;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const stepIndex = () => STEPS.indexOf(step);

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
      if (err.status === 404) return rejoinLive();
      return fatal('Could not reach the session. Check your connection and try again.', false);
    }
    // Skip ahead if this phone already answered (e.g. after a reload)
    if (step === 'register' && my.registered) step = 'poll';
    if (step === 'welcome' && my.poll !== null) step = 'pollResults';
    if (step === 'pollResults' && my.feature !== null) step = 'featureResults';
    // The note from Coach Jazmine greets each phone once
    if (step === 'welcome' && config.welcome && config.welcome.letter && !localStorage.getItem(LETTER_KEY)) letterOpen = true;
    render();
    poller = poll({
      url: `/api/sessions/${code}/state`,
      interval: 2500,
      initial: state,
      onState: (s) => { state = s; render(); },
      onStatus: setConn,
    });
  }

  function setConn(status) {
    if (status === 'live') { conn.textContent = 'Live'; conn.className = 'pill live'; }
    else if (status === 'gone') { conn.textContent = 'Rejoining…'; conn.className = 'pill warn'; rejoinLive(); }
    else { conn.textContent = 'Reconnecting…'; conn.className = 'pill warn'; }
  }

  // If the server no longer knows this session, hop to whatever session is live
  // now. Guarded so a server that keeps forgetting can't bounce the phone forever.
  function rejoinLive() {
    const key = 'yfsh:rejoinAt';
    let last = 0;
    try { last = Number(sessionStorage.getItem(key) || 0); } catch { /* ignore */ }
    if (Date.now() - last < 15000) {
      conn.textContent = 'Session unavailable';
      conn.className = 'pill danger';
      ui.notice = { text: 'The session keeps dropping. Please tell Coach Jazmine — the app needs its database connected.', kind: 'danger' };
      render();
      return;
    }
    try { sessionStorage.setItem(key, String(Date.now())); } catch { /* ignore */ }
    location.replace('/');
  }

  function fatal(message, offerHome) {
    conn.textContent = 'Offline';
    conn.className = 'pill danger';
    app.innerHTML = `<div class="card wait">
      <div class="big-emoji">😕</div>
      <h2>${esc(message)}</h2>
      ${offerHome ? '<a class="btn" href="/">Try again</a>' : '<button class="btn" onclick="location.reload()">Try again</button>'}
    </div>`;
  }

  // ----- rendering ----------------------------------------------------------

  function render() {
    if (!state) return;
    const views = {
      welcome: renderWelcome,
      register: renderRegister,
      poll: renderPoll,
      pollResults: renderPollResults,
      feature: renderFeature,
      featureResults: renderFeatureResults,
      card: renderCard,
      guide: renderGuide,
      follow: renderFollow,
    };
    const body = (views[step] || renderWelcome)();
    app.innerHTML = progressBar() + (ui.notice ? `<div class="notice ${ui.notice.kind || ''}">${esc(ui.notice.text)}</div>` : '') + body;
    bind();
  }

  function progressBar() {
    const i = stepIndex();
    const labels = ['Start', 'You', 'Poll', 'Results', 'Vote', 'Winner', 'Card', 'Build', 'Follow'];
    return `<div class="progress" aria-label="Step ${i + 1} of ${STEPS.length}">
      ${STEPS.map((s, n) => `<span class="dot ${n < i ? 'done' : ''} ${n === i ? 'now' : ''}" title="${labels[n]}"></span>`).join('')}
      <span class="progress-label">${labels[i]} · ${i + 1}/${STEPS.length}</span>
    </div>`;
  }

  const nav = (back, next, nextLabel = 'Next') => `<div class="row nav">
    ${back ? `<button class="btn ghost" data-go="${back}">← Back</button>` : ''}
    <span class="spacer"></span>
    ${next ? `<button class="btn" data-go="${next}">${esc(nextLabel)} →</button>` : ''}
  </div>`;

  const LETTER_KEY = `yfsh:letterSeen:${code}`;
  let letterOpen = false;

  function renderWelcome() {
    const w = config.welcome || { roadmap: [], why: null, letter: null };
    return `<div class="stack">
      <div class="card">
        <div class="kicker">AI and the Future of Work</div>
        <h1>Your Future Starts Here</h1>
        <p class="muted">${esc(w.tagline || '')}</p>
        <p class="faint">${state.participantCount} ${state.participantCount === 1 ? 'person has' : 'people have'} joined so far.</p>
        ${w.letter ? '<button class="btn ghost small" data-action="letter">💌 Read the note from Coach Jazmine</button>' : ''}
      </div>
      ${w.why ? `<div class="card why"><div class="kicker">${esc(w.why.title)}</div><p>${esc(w.why.text)}</p></div>` : ''}
      <div class="card">
        <div class="kicker">What happens next</div>
        <ol class="roadmap">${w.roadmap.map((r) => `<li><strong>${esc(r.title)}</strong><span>${esc(r.text)}</span></li>`).join('')}</ol>
        ${nav(null, my.registered ? 'poll' : 'register', 'Let’s go')}
      </div>
      ${letterOpen && w.letter ? renderLetter(w.letter) : ''}
    </div>`;
  }

  function renderRegister() {
    const r = config.register;
    const d = readJson(`yfsh:regdraft:${code}`) || {};
    return `<div class="card">
      <div class="kicker">${esc(r.title)}</div>
      <p class="muted">${esc(r.intro)}</p>
      <form id="register-form" autocomplete="on">
        <label class="field"><span class="label">${esc(r.fields.name.label)}</span>
          <input class="input" name="name" id="reg-name" maxlength="80" autocomplete="name" placeholder="${esc(r.fields.name.placeholder)}" value="${esc(d.name || '')}" required></label>
        <label class="field"><span class="label">${esc(r.fields.school.label)}</span>
          <input class="input" name="school" id="reg-school" maxlength="100" autocomplete="organization" placeholder="${esc(r.fields.school.placeholder)}" value="${esc(d.school || '')}" required></label>
        <label class="field"><span class="label">${esc(r.fields.email.label)}</span>
          <input class="input" name="email" id="reg-email" type="email" maxlength="120" autocomplete="email" inputmode="email" placeholder="${esc(r.fields.email.placeholder)}" value="${esc(d.email || '')}" required></label>
        <p class="faint">${esc(r.consent)}</p>
        <button class="btn block" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Saving…' : esc(r.button)}</button>
      </form>
      ${nav('welcome', null)}
    </div>`;
  }

  function renderLetter(l) {
    return `<div class="modal" data-action="letter-close" role="dialog" aria-modal="true" aria-label="${esc(l.title)}">
      <div class="letter" data-stop>
        <div class="kicker">${esc(l.title)}</div>
        ${l.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}
        <p class="signoff">${esc(l.signoff)}</p>
        <button class="btn block" data-action="letter-close">${esc(l.button || 'Close')}</button>
      </div>
    </div>`;
  }

  function choiceList(choices, picked) {
    return `<div class="choices">${choices.map((c, i) =>
      `<button type="button" class="choice ${picked === i ? 'selected' : ''}" data-pick="${i}" aria-pressed="${picked === i}">
        <span class="dot"></span><span>${esc(c)}</span></button>`).join('')}</div>`;
  }

  function closedNote(a) {
    return a.status !== 'open' ? '<div class="notice warn">This question is closed for now. You can still look at the results.</div>' : '';
  }

  function renderPoll() {
    const a = config.activities.poll;
    const st = state.activities.poll;
    const picked = ui.pollPick ?? my.poll;
    return `<div class="card">
      <div class="kicker">1 · ${esc(a.title)}</div>
      <div class="question">${esc(a.question)}</div>
      ${closedNote(st)}
      ${choiceList(a.choices, picked)}
      <button class="btn block" data-action="poll-submit" ${picked === null || ui.busy || st.status !== 'open' ? 'disabled' : ''}>${ui.busy ? 'Sending…' : my.poll !== null ? 'Update my answer' : 'Submit'}</button>
      ${nav('welcome', my.poll !== null ? 'pollResults' : null, 'See results')}
    </div>`;
  }

  function renderPollResults() {
    const a = config.activities.poll;
    const st = state.activities.poll;
    return `<div class="card">
      <div class="kicker">Everyone’s answers · live</div>
      <h2>${esc(a.question)}</h2>
      ${my.poll !== null ? `<p class="muted">You picked <strong>${esc(a.choices[my.poll])}</strong>.</p>` : ''}
      ${st.counts ? barChart(a.choices, st.counts, st.total) : '<p class="muted">Results are hidden right now.</p>'}
      <p class="faint" style="margin-top:12px">${st.total} answer${st.total === 1 ? '' : 's'} so far. Whatever you picked, there’s a version of you who builds things.</p>
      ${nav('poll', 'feature')}
    </div>`;
  }

  function renderFeature() {
    const a = config.activities.feature;
    const st = state.activities.feature;
    const picked = ui.featurePick ?? my.feature;
    return `<div class="card">
      <div class="kicker">2 · ${esc(a.title)}</div>
      <p class="muted">We asked an AI to build a snack-ordering app for a school fair. One business has many jobs — picking the right first feature is one of them.</p>
      <div class="question">${esc(a.question)}</div>
      ${closedNote(st)}
      ${choiceList(a.choices, picked)}
      <button class="btn block" data-action="feature-submit" ${picked === null || ui.busy || st.status !== 'open' ? 'disabled' : ''}>${ui.busy ? 'Sending…' : my.feature !== null ? 'Update my vote' : 'Vote'}</button>
      ${nav('pollResults', my.feature !== null ? 'featureResults' : null, 'See the winner')}
    </div>`;
  }

  function renderFeatureResults() {
    const a = config.activities.feature;
    const st = state.activities.feature;
    const winner = st.winner;
    const branch = winner !== null ? config.demoBranches[winner] : null;
    return `<div class="card">
      <div class="kicker">The room’s pick · live</div>
      ${winner !== null
        ? `<div class="winner"><div class="label">Leading right now</div><div class="value">${esc(a.choices[winner])}</div></div>`
        : `<div class="winner"><div class="label">It’s a tie</div><div class="value">Vote to break it</div></div>`}
      ${st.counts ? barChart(a.choices, st.counts, st.total) : ''}
      ${branch ? `<a class="btn block" href="/demo?branch=${esc(branch.key)}&from=app&code=${esc(code)}">Try the snack app with this feature →</a>` : ''}
      <div class="examples" style="margin-top:14px"><strong>Would you trust it? Check:</strong><ul>
        <li>Is the total correct?</li><li>Can sold-out snacks still be ordered?</li><li>Does the button do what it says?</li></ul>
        <p class="faint" style="margin:8px 0 0">AI guesses. It’s fast, not always right. You’re the one in charge.</p></div>
      ${nav('feature', 'card', 'My project')}
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

  const projectSentence = (c) => `I want to help ${c.who.trim()} ${c.what.trim()} more easily.`;

  function renderCard() {
    const a = config.activities.card;
    if (card) return renderSavedCard();
    return `<div class="card">
      <div class="kicker">3 · ${esc(a.title)}</div>
      <div class="question">${esc(a.prompt)}</div>
      <div class="examples"><strong>Examples</strong><ul>${a.examples.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>
      <form id="card-form" autocomplete="off">
        <label class="field">
          <span class="label">${esc(a.fields.who.label)}</span>
          <span class="help">${esc(a.fields.who.help)}</span>
          <input class="input" name="who" id="who" maxlength="60" placeholder="${esc(a.fields.who.placeholder)}" value="${esc(draft.who || '')}" required>
        </label>
        <label class="field">
          <span class="label">${esc(a.fields.what.label)}</span>
          <span class="help">${esc(a.fields.what.help)}</span>
          <input class="input" name="what" id="what" maxlength="80" placeholder="${esc(a.fields.what.placeholder)}" value="${esc(draft.what || '')}" required>
        </label>
        <div class="field"><span class="label" style="display:block;font-weight:800;margin-bottom:8px">${esc(a.fields.step.label)}</span>
          ${choiceList(a.firstSteps, draft.step ?? null)}
        </div>
        <button class="btn block" type="submit">Make my card</button>
      </form>
      ${nav('featureResults', null)}
    </div>`;
  }

  function renderSavedCard() {
    const done = state.activities.card.completed;
    return `<div class="stack">
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
      <p class="muted">${done} ${done === 1 ? 'person has' : 'people have'} made a card so far.</p>
      <div class="card">${nav('featureResults', 'guide', 'How to build one')}</div>
    </div>`;
  }

  function renderGuide() {
    const g = config.guide;
    return `<div class="card">
      <div class="kicker">4 · ${esc(g.title)}</div>
      <p class="muted">${esc(g.intro)}</p>
      ${g.sections.map((s) => `<h2 class="guide-h">${esc(s.title)}</h2><ol class="guide-list">${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ol>`).join('')}
      <h2 class="guide-h">A prompt to start with</h2>
      <div class="prompt-box" id="prompt-box">${esc(g.prompt)}</div>
      <button class="btn ghost small" data-action="copy-prompt">Copy prompt</button>
      <div class="rules">${g.rules.map((r) => `<span class="pill">${esc(r)}</span>`).join('')}</div>
      ${nav('card', 'follow', 'Finish')}
    </div>`;
  }

  function renderFollow() {
    const social = config.social || { links: [], invite: '' };
    return `<div class="stack">
      <div class="card wait">
        <div class="big-emoji">💜</div>
        <h1>That’s it. Start small.</h1>
        <p class="muted">Your card is saved on this phone. Ask clearly, check carefully, finish something useful.</p>
      </div>
      <div class="card follow">
        <div class="kicker">Keep going</div>
        <h2>${esc(social.invite)}</h2>
        <div class="stack">${social.links.map((l) =>
          `<a class="btn ghost block" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} · ${esc(l.handle)}</a>`).join('')}</div>
      </div>
      <div class="card">${nav('guide', card ? 'card' : 'welcome', card ? 'My card' : 'Start over')}</div>
    </div>`;
  }

  // ----- events -------------------------------------------------------------

  function bind() {
    app.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => goTo(b.dataset.go)));
    app.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.pick);
        if (step === 'poll') ui.pollPick = i;
        else if (step === 'feature') ui.featurePick = i;
        else { draft.step = i; writeJson(DRAFT_KEY, draft); }
        render();
      });
    });
    app.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (btn.classList.contains('modal') && e.target !== btn) return; // taps inside the letter
        if (actions[btn.dataset.action]) actions[btn.dataset.action]();
      });
    });
    const reg = document.getElementById('register-form');
    if (reg) {
      const draftKey = `yfsh:regdraft:${code}`;
      reg.addEventListener('input', () => writeJson(draftKey, { name: reg.name.value, school: reg.school.value, email: reg.email.value }));
      reg.addEventListener('submit', async (e) => {
        e.preventDefault();
        ui.busy = true; ui.notice = null; render();
        try {
          const res = await apiRetry('POST', `/api/sessions/${code}/profile`, {
            pid, name: reg.name.value, school: reg.school.value, email: reg.email.value,
          }, { onRetry: () => notice('Slow connection — retrying…', 'warn') });
          my.registered = true;
          my.name = res.name;
          localStorage.removeItem(draftKey);
          if (poller && res.state) poller.apply(res.state);
          ui.busy = false;
          goTo('poll');
          return;
        } catch (err) {
          if (err.status === 404) return rejoinLive();
          ui.notice = { text: err.message, kind: 'danger' };
        }
        ui.busy = false;
        render();
      });
      const focusName = document.activeElement && document.activeElement.name;
      if (focusName && reg[focusName]) reg[focusName].focus();
    }
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
      const focusName = document.activeElement && document.activeElement.name;
      if (focusName && form[focusName]) form[focusName].focus();
    }
  }

  function notice(text, kind) {
    ui.notice = { text, kind };
    render();
    setTimeout(() => { if (ui.notice && ui.notice.text === text) { ui.notice = null; render(); } }, 4000);
  }

  async function submitVote(activity, choice, nextStep) {
    ui.busy = true;
    ui.notice = null;
    render();
    try {
      const res = await apiRetry('POST', `/api/sessions/${code}/vote/${activity}`, { pid, choice }, {
        onRetry: () => notice('Slow connection — retrying…', 'warn'),
      });
      my[activity] = res.choice;
      if (poller && res.state) poller.apply(res.state);
      ui.busy = false;
      goTo(nextStep);
      return;
    } catch (err) {
      if (err.status === 404) return rejoinLive();
      ui.notice = { text: err.status === 409 ? 'This question is closed right now.' : err.message, kind: 'danger' };
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
    letter: () => { letterOpen = true; render(); },
    'letter-close': () => {
      letterOpen = false;
      try { localStorage.setItem(LETTER_KEY, '1'); } catch { /* ignore */ }
      render();
    },
    'poll-submit': () => submitVote('poll', ui.pollPick ?? my.poll, 'pollResults'),
    'feature-submit': () => submitVote('feature', ui.featurePick ?? my.feature, 'featureResults'),
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
    'copy-prompt': () => {
      const text = config.guide.prompt;
      const done = () => notice('Prompt copied. Paste it into ChatGPT or Claude.', '');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => notice('Press and hold the text to copy it.', 'warn'));
      else notice('Press and hold the text to copy it.', 'warn');
    },
  };

  boot();
})();
