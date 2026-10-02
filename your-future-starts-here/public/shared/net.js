// Small shared helpers: JSON fetch with retries, a state poller, the session
// code from the URL, and HTML escaping. Plain script, no build step.
window.YFSH = (() => {
  'use strict';

  const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/i;

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  async function api(method, url, body, { token } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    let res;
    try {
      // No cache option here: the server's Cache-Control decides (max-age=0 for state,
      // no-store for presenter data), and request-side no-cache could skip the edge cache.
      res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (err) {
      throw new ApiError(0, 'No connection.');
    }
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON body */ }
    if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status}).`);
    return data;
  }

  // Retries only on network trouble or server errors; a 4xx answer is final.
  async function apiRetry(method, url, body, { token, tries = 4, onRetry } = {}) {
    let delay = 800;
    for (let attempt = 1; ; attempt++) {
      try {
        return await api(method, url, body, { token });
      } catch (err) {
        const retryable = err.status === 0 || err.status >= 500;
        if (!retryable || attempt >= tries) throw err;
        if (onRetry) onRetry(attempt, err);
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 5000);
      }
    }
  }

  // The session code from ?code=, /a/CODE, /x/CODE, /p/CODE or the short /CODE link.
  function codeFromLocation() {
    const q = new URLSearchParams(location.search).get('code');
    if (q && CODE_RE.test(q)) return q.toUpperCase();
    const parts = location.pathname.split('/').filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) if (CODE_RE.test(parts[i])) return parts[i].toUpperCase();
    return '';
  }

  // Polls a state endpoint. onState fires only when the server's version moves
  // forward; onStatus gets 'live' | 'reconnecting' | 'gone'. Works through any
  // network that allows plain HTTPS, and the server can cache it at the edge.
  function poll({ url, token, interval = 2000, initial = null, onState, onStatus }) {
    let timer = null;
    let stopped = false;
    let failures = 0;
    let version = initial && typeof initial.version === 'number' ? initial.version : -1;

    const status = (s) => { if (onStatus) onStatus(s); };
    const accept = (state) => {
      if (!state || typeof state.version !== 'number') return;
      if (state.version > version) {
        version = state.version;
        onState(state);
      }
    };

    async function tick() {
      if (stopped) return;
      clearTimeout(timer);
      try {
        const data = await api('GET', url, undefined, { token });
        failures = 0;
        status('live');
        accept(data.state);
      } catch (err) {
        if (err.status === 404 || err.status === 401) {
          stopped = true;
          status('gone');
          return;
        }
        failures += 1;
        status('reconnecting');
      }
      schedule();
    }

    function schedule() {
      if (stopped) return;
      clearTimeout(timer);
      let delay = failures ? Math.min(interval * 2 ** failures, 10000) : interval;
      if (document.hidden) delay = Math.max(delay, 15000); // easy on the battery while the phone is locked
      timer = setTimeout(tick, delay);
    }

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !stopped) tick();
    });

    if (initial) { status('live'); schedule(); } else tick();

    return {
      refresh: () => tick(),
      apply: accept,
      stop() { stopped = true; clearTimeout(timer); },
    };
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pct(n, total) {
    return total ? Math.round((n / total) * 100) : 0;
  }

  function barChart(choices, counts, total) {
    return `<div class="bars">${choices.map((label, i) => {
      const n = counts ? counts[i] : 0;
      const p = pct(n, total);
      return `<div class="bar-row">
        <div class="bar-label">${esc(label)}</div>
        <div class="bar-value">${n} · ${p}%</div>
        <div class="bar-track"><div class="bar-fill" style="width:${p}%"></div></div>
      </div>`;
    }).join('')}</div>`;
  }

  return { api, apiRetry, poll, codeFromLocation, esc, pct, barChart, ApiError, CODE_RE };
})();
