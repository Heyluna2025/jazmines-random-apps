'use strict';

// Minimal client for the Upstash Redis REST API (what Vercel's Storage tab
// provisions). One command per request, or a batch through /pipeline.
class Upstash {
  constructor({ url, token }) {
    this.url = String(url).replace(/\/+$/, '');
    this.token = token;
  }

  async _post(path, body) {
    let res;
    try {
      res = await fetch(this.url + path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Redis unreachable: ${err.message}`);
    }
    if (!res.ok) throw new Error(`Redis request failed (${res.status})`);
    return res.json();
  }

  async cmd(...args) {
    const data = await this._post('', args);
    if (data.error) throw new Error(`Redis ${args[0]}: ${data.error}`);
    return data.result;
  }

  async pipeline(commands) {
    const data = await this._post('/pipeline', commands);
    return data.map((d, i) => {
      if (d.error) throw new Error(`Redis ${commands[i][0]}: ${d.error}`);
      return d.result;
    });
  }
}

module.exports = { Upstash };
