// Small shared helpers: JSON fetch with retries, a reconnecting WebSocket, and
// HTML escaping. Loaded as a plain script so there is no build step.
window.YFSH = (() => {
  'use strict';

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  async function api(method, url, body, { token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    let res;
    try {
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

  // Reconnecting WebSocket. onStatus gets 'live' | 'reconnecting' | 'gone'.
  function connect({ code, role, token, onState, onStatus }) {
    let ws = null;
    let closed = false;
    let delay = 1000;
    let keepAlive = null;

    function status(s) { if (onStatus) onStatus(s); }

    function open() {
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams({ code, role });
      if (token) params.set('token', token);
      try {
        ws = new WebSocket(`${proto}//${location.host}/ws?${params}`);
      } catch {
        return retry();
      }
      ws.onopen = () => {
        delay = 1000;
        status('live');
        clearInterval(keepAlive);
        keepAlive = setInterval(() => { if (ws && ws.readyState === 1) ws.send('ping'); }, 25000);
      };
      ws.onmessage = (ev) => {
        if (ev.data === 'pong') return;
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'state') onState(msg.state);
        else if (msg.type === 'gone') { status('gone'); closed = true; ws.close(); }
      };
      ws.onclose = () => { clearInterval(keepAlive); if (!closed) retry(); };
      ws.onerror = () => { /* onclose follows */ };
    }

    function retry() {
      status('reconnecting');
      setTimeout(open, delay);
      delay = Math.min(delay * 1.8, 10000);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !closed && (!ws || ws.readyState > 1)) {
        delay = 1000;
        open();
      }
    });

    open();
    return {
      close() { closed = true; clearInterval(keepAlive); if (ws) ws.close(); },
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

  return { api, apiRetry, connect, esc, pct, barChart, ApiError };
})();
