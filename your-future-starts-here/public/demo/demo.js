// Snack-ordering prototype for the school fair. Three prepared branches, one
// per feature-vote choice. Everything here is fictional: no payments, no orders.
(() => {
  'use strict';
  const { esc } = window.YFSH;

  const SNACKS = [
    { id: 'bananacue', name: 'Banana Cue', emoji: '🍌', price: 15, stock: 12 },
    { id: 'turon', name: 'Turon', emoji: '🥟', price: 20, stock: 0 },
    { id: 'kwek', name: 'Kwek-Kwek (4 pcs)', emoji: '🥚', price: 25, stock: 3 },
    { id: 'puto', name: 'Puto (3 pcs)', emoji: '🍚', price: 15, stock: 0 },
    { id: 'buko', name: 'Buko Juice', emoji: '🥥', price: 30, stock: 8 },
    { id: 'fishball', name: 'Fishball (5 pcs)', emoji: '🍡', price: 10, stock: 20 },
  ];

  // Each branch: what version 1 does, the rehearsed AI-assisted change, the
  // prompt Jazmine "asked", and the sneaky mistake for the trust discussion.
  const BRANCHES = {
    quantities: {
      label: 'Choose snacks and quantities',
      v1: 'Tap + and − to choose how many of each snack you want.',
      change: 'Add a “Your order” list so people can see what they picked, plus a Clear button.',
      prompt: 'Add a "Your order" section under the snack list that shows each chosen snack with its quantity, and a "Clear" button that sets everything back to zero. Keep the existing + and − buttons.',
      mistake: 'The − button can go below zero.',
      checks: ['Does − stop at zero?', 'Does “Your order” match the quantities?', 'Does Clear really clear everything?'],
    },
    total: {
      label: 'See the total price',
      v1: 'The total at the bottom adds up your snacks.',
      change: 'Show the price for each line (quantity × price) and make the total big and clear in pesos.',
      prompt: 'Next to each snack, show its line total (quantity times price) formatted as pesos. Make the grand total large and easy to read. Don\'t change how quantities are chosen.',
      mistake: 'The total ignores quantities — it only adds each price once.',
      checks: ['Pick 3 of one snack. Did the total triple?', 'Is the peso formatting right?', 'Does the total update straight away?'],
    },
    soldout: {
      label: 'See which snacks are sold out',
      v1: 'Snacks with no stock are marked sold out and cannot be added.',
      change: 'Warn when stock is low (“Only 3 left”) and stop + at the number in stock.',
      prompt: 'Show "Only N left" when a snack has 5 or fewer in stock, and don\'t let the + button go above the stock number. Sold-out snacks stay disabled.',
      mistake: 'Sold-out snacks can still be added to the order.',
      checks: ['Can you add Turon (sold out)?', 'Can you add more Kwek-Kwek than the 3 in stock?', 'Is the low-stock warning right?'],
    },
  };

  const params = new URLSearchParams(location.search);
  const ui = {
    branch: BRANCHES[params.get('branch')] ? params.get('branch') : 'quantities',
    aiChange: params.get('change') === '1',
    mistake: params.get('mistake') === '1',
  };
  const qty = Object.fromEntries(SNACKS.map((s) => [s.id, 0]));

  const bar = document.getElementById('bar');
  const phone = document.getElementById('phone');
  const side = document.getElementById('side');
  const branchSel = document.getElementById('branch');
  const aiChangeBox = document.getElementById('aiChange');
  const mistakeBox = document.getElementById('mistake');

  if (params.get('bar') === '0') bar.hidden = true;

  // Coming from the phone flow: a way back, and the coach tips on first visit
  const fromApp = params.get('from') === 'app';
  const backBtn = document.getElementById('backBtn');
  if (fromApp) {
    const code = (params.get('code') || '').toUpperCase();
    backBtn.href = /^[A-HJ-NP-Z2-9]{4}$/.test(code) ? `/a/${code}` : '/';
    backBtn.hidden = false;
  }
  for (const [key, b] of Object.entries(BRANCHES)) branchSel.add(new Option(b.label, key));
  branchSel.value = ui.branch;
  aiChangeBox.checked = ui.aiChange;
  mistakeBox.checked = ui.mistake;

  branchSel.onchange = () => { ui.branch = branchSel.value; syncUrl(); render(); };
  aiChangeBox.onchange = () => { ui.aiChange = aiChangeBox.checked; syncUrl(); render(); };
  mistakeBox.onchange = () => { ui.mistake = mistakeBox.checked; syncUrl(); render(); };
  document.getElementById('resetOrder').onclick = () => { for (const k in qty) qty[k] = 0; render(); };

  function syncUrl() {
    const p = new URLSearchParams({ branch: ui.branch });
    if (ui.aiChange) p.set('change', '1');
    if (ui.mistake) p.set('mistake', '1');
    if (bar.hidden) p.set('bar', '0');
    history.replaceState(null, '', `?${p}`);
  }

  const peso = (n) => `₱${n.toFixed(2)}`;

  function total() {
    const b = ui.branch;
    if (b === 'total' && ui.mistake) {
      // The sneaky mistake: adds each chosen snack's price once, ignoring quantity.
      return SNACKS.filter((s) => qty[s.id] > 0).reduce((sum, s) => sum + s.price, 0);
    }
    return SNACKS.reduce((sum, s) => sum + s.price * qty[s.id], 0);
  }

  function canAdd(s) {
    const b = ui.branch;
    if (b === 'soldout') {
      if (ui.mistake) return true;
      if (s.stock === 0) return false;
      if (ui.aiChange) return qty[s.id] < s.stock;
      return true;
    }
    return true;
  }

  function canRemove(s) {
    if (ui.branch === 'quantities' && ui.mistake) return true;
    return qty[s.id] > 0;
  }

  function change(id, delta) {
    const s = SNACKS.find((x) => x.id === id);
    if (delta > 0 && !canAdd(s)) return;
    if (delta < 0 && !canRemove(s)) return;
    qty[id] += delta;
    render();
  }

  function render() {
    const b = ui.branch;
    const br = BRANCHES[b];
    const showStock = b === 'soldout';
    const showLineTotals = b === 'total' && ui.aiChange;
    const showTotal = b === 'total';
    const showSummary = b === 'quantities' && ui.aiChange;
    const chosen = SNACKS.filter((s) => qty[s.id] > 0);

    phone.innerHTML = `
      <span class="demo-badge">Demo · fictional snacks · no real orders</span>
      <h1>School Fair Snacks</h1>
      <p class="muted">${esc(br.v1)}${ui.aiChange ? `<span class="change-tag">+ AI change</span>` : ''}</p>
      <div>${SNACKS.map((s) => {
        const soldOut = showStock && s.stock === 0;
        const low = showStock && ui.aiChange && s.stock > 0 && s.stock <= 5;
        return `<div class="snack ${soldOut ? 'soldout' : ''}">
          <div class="emoji">${s.emoji}</div>
          <div>
            <div class="name">${esc(s.name)}</div>
            <div class="price">${peso(s.price)}</div>
            ${showStock ? `<div class="stock ${soldOut ? 'out' : low ? 'low' : ''}">${soldOut ? 'Sold out' : low ? `Only ${s.stock} left` : 'In stock'}</div>` : ''}
            ${showLineTotals && qty[s.id] > 0 ? `<div class="line-total">${qty[s.id]} × ${peso(s.price)} = ${peso(qty[s.id] * s.price)}</div>` : ''}
          </div>
          <div class="stepper">
            <button data-id="${s.id}" data-delta="-1" ${canRemove(s) ? '' : 'disabled'} aria-label="Remove one">−</button>
            <span class="qty">${qty[s.id]}</span>
            <button data-id="${s.id}" data-delta="1" ${canAdd(s) ? '' : 'disabled'} aria-label="Add one">+</button>
          </div>
        </div>`;
      }).join('')}</div>
      ${showSummary ? `<div class="summary"><strong>Your order</strong>
        ${chosen.length ? `<ul>${chosen.map((s) => `<li>${esc(s.name)} × ${qty[s.id]}</li>`).join('')}</ul>` : '<p class="muted" style="margin:6px 0 0">Nothing yet.</p>'}
        <button class="btn ghost small" id="clear" style="margin-top:10px;color:var(--violet-800);border-color:var(--lavender-400)">Clear</button></div>` : ''}
      ${showTotal ? `<div class="summary"><div class="total"><span>Total</span><span>${peso(total())}</span></div></div>` : ''}
      <button class="order-btn" id="order" ${chosen.length ? '' : 'disabled'}>Place demo order</button>`;

    side.innerHTML = `
      <div class="card"><div class="kicker muted">Branch</div><h3>${esc(br.label)}</h3><p class="muted">${esc(br.v1)}</p></div>
      <div class="card"><h3>The rehearsed AI-assisted change</h3><p>${esc(br.change)}</p>
        <div class="kicker muted">What I asked</div><div class="prompt">${esc(br.prompt)}</div>
        <p class="faint" style="margin-top:10px">${ui.aiChange ? 'Applied — look at the prototype.' : 'Tick “Apply the AI-assisted change” above to show the result.'}</p></div>
      <div class="card"><h3>Would you trust this? Check:</h3><ul>${br.checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
        ${ui.mistake ? `<p class="notice warn" style="margin:8px 0 0"><strong>Mistake is on:</strong> ${esc(br.mistake)}</p>` : '<p class="faint">Turn on “Sneak in a mistake” to make the check worth doing.</p>'}</div>`;

    phone.querySelectorAll('[data-delta]').forEach((btn) => btn.addEventListener('click', () => change(btn.dataset.id, Number(btn.dataset.delta))));
    const clear = document.getElementById('clear');
    if (clear) clear.onclick = () => { for (const k in qty) qty[k] = 0; render(); };
    document.getElementById('order').onclick = showOrderModal;
  }

  // ----- coach tips: a short tour that teaches what the demo shows --------

  const TIPS = [
    { target: '.phone', text: '👋 This is a snack-ordering app we asked an AI to build for a school fair. Pretend you’re a customer. Everything here is pretend — no real orders.' },
    { target: '.stepper', text: 'Tap + to add a snack and − to remove it. Notice what updates on the screen when you do.' },
    { target: '#aiChange', text: 'This is version 1 — the AI’s first try. Flip “Apply the AI-assisted change” to see what one clear request added. Then tap around again.' },
    { target: '#mistake', text: 'Now flip “Sneak in a mistake”. Something is wrong on purpose. Can you find it? AI guesses fast — checking is your job.' },
    { target: '.side', text: 'Scroll down: the side panel shows the exact words we asked the AI. Short, specific, one thing at a time. That’s “ask clearly”.' },
    { target: '#backBtn', text: 'Done? Go back and make your own project card. That card is the start of your own app.' },
  ];
  const TIPS_KEY = 'yfsh:demoTipsSeen';
  const coach = document.getElementById('coach');
  let tip = -1;

  function clearSpot() { document.querySelectorAll('.spotlight').forEach((el) => el.classList.remove('spotlight')); }

  function showTip(i) {
    clearSpot();
    if (i < 0 || i >= TIPS.length) { tip = -1; coach.hidden = true; document.body.classList.remove('touring'); try { localStorage.setItem(TIPS_KEY, '1'); } catch { /* ignore */ } return; }
    tip = i;
    const t = TIPS[i];
    const el = document.querySelector(t.target);
    if (el && !el.hidden) { el.classList.add('spotlight'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    document.getElementById('coachStep').textContent = `Tip ${i + 1} of ${TIPS.length}`;
    document.getElementById('coachText').textContent = t.text;
    document.getElementById('coachNext').textContent = i === TIPS.length - 1 ? 'Done' : 'Next';
    coach.hidden = false;
    document.body.classList.add('touring');
  }

  document.getElementById('coachNext').onclick = () => showTip(tip + 1);
  document.getElementById('coachSkip').onclick = () => showTip(-1);
  document.getElementById('tipsBtn').onclick = () => showTip(0);
  // Re-apply the spotlight after the prototype re-renders (its buttons are rebuilt)
  const origRender = render;
  render = function () { origRender(); if (tip >= 0) { const el = document.querySelector(TIPS[tip].target); if (el) el.classList.add('spotlight'); } };

  let tipsSeen = false;
  try { tipsSeen = Boolean(localStorage.getItem(TIPS_KEY)); } catch { /* ignore */ }
  if (fromApp && !tipsSeen) setTimeout(() => showTip(0), 400);

  function showOrderModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="card solid stack">
      <h2>This is a demonstration</h2>
      <p>No real order was placed and nothing was paid. The snacks, prices and stock are made up for the talk.</p>
      <button class="btn block" id="closeModal">Got it</button></div>`;
    document.body.appendChild(modal);
    modal.querySelector('#closeModal').onclick = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  }

  render();
})();
