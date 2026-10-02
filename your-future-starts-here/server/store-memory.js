'use strict';

// In-process store for local runs and tests. Keeps everything in memory and
// mirrors it to a JSON file so a restart doesn't lose the session.

const fs = require('fs');
const path = require('path');
const S = require('./sessions');

class MemoryStore {
  constructor({ file } = {}) {
    this.kind = 'memory';
    this.file = file || null;
    this.records = new Map();
    this.tokens = new Set();
    this.live = null; // session the printed /join link points at
    this.loginAttempts = new Map();
    this._saveTimer = null;
    this._load();
  }

  // ----- persistence -------------------------------------------------------

  _load() {
    if (!this.file) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const r of raw.sessions || []) this.records.set(r.code, r);
      for (const t of raw.tokens || []) this.tokens.add(t);
      this.live = raw.live || null;
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[store] could not read ${this.file}: ${err.message}`);
    }
  }

  _scheduleSave() {
    if (!this.file || this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.saveNow();
    }, 300);
    this._saveTimer.unref();
  }

  saveNow() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ sessions: [...this.records.values()], tokens: [...this.tokens], live: this.live }));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.warn(`[store] could not write ${this.file}: ${err.message}`);
    }
  }

  // ----- records -----------------------------------------------------------

  // A record is a snapshot plus the per-participant maps the snapshot only counts.
  _record(code) {
    const r = this.records.get(String(code || '').toUpperCase());
    if (!r) throw S.notFound();
    return r;
  }

  _snapshot(r) {
    const s = structuredClone(r);
    s.participantCount = Object.keys(r.participants).length;
    delete s.participants;
    s.activities.card.completedCount = Object.keys(r.activities.card.completed).length;
    delete s.activities.card.completed;
    return s;
  }

  _commit(r, patch = {}) {
    for (const [key, value] of Object.entries(patch)) S.setField(r, key, value);
    r.version += 1;
    r.updatedAt = Date.now();
    this._scheduleSave();
    return this._snapshot(r);
  }

  _touchParticipant(r, pid) {
    if (!r.participants[pid]) r.participants[pid] = Date.now();
  }

  // ----- sessions ----------------------------------------------------------

  async createSession(name) {
    let code = S.randomCode();
    while (this.records.has(code)) code = S.randomCode();
    const r = S.newSnapshot(code, name, Date.now());
    delete r.participantCount;
    delete r.activities.card.completedCount;
    r.participants = {};
    r.activities.card.completed = {};
    this.records.set(code, r);
    this._scheduleSave();
    return this._snapshot(r);
  }

  async getSession(code) {
    const r = this.records.get(String(code || '').toUpperCase());
    return r ? this._snapshot(r) : null;
  }

  async listSessions() {
    return [...this.records.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => S.listEntry(this._snapshot(r)));
  }

  async deleteSession(code) {
    const r = this._record(code);
    this.records.delete(r.code);
    if (this.live === r.code) this.live = null;
    this._scheduleSave();
  }

  // ----- printed /join link ------------------------------------------------

  async setLive(code) {
    this.live = code ? String(code).toUpperCase() : null;
    this._scheduleSave();
  }

  async getLive() {
    return this.live;
  }

  async resetSession(code) {
    const r = this._record(code);
    r.participants = {};
    r.activities.poll.votes = {};
    r.activities.feature.votes = {};
    r.activities.card.completed = {};
    return this._commit(r, S.RESET_PATCH);
  }

  async setSlide(code, slide) {
    return this._commit(this._record(code), S.planSlide(slide));
  }

  async setActivity(code, id, action, payload) {
    const r = this._record(code);
    return this._commit(r, S.planActivity(this._snapshot(r), id, action, payload));
  }

  async endSession(code) {
    const r = this._record(code);
    return this._commit(r, S.planEnd(r, Date.now()));
  }

  async resumeSession(code) {
    return this._commit(this._record(code), S.planResume());
  }

  // ----- audience ----------------------------------------------------------

  async join(code, pid) {
    const r = this._record(code);
    if (!S.isPid(pid)) pid = S.newPid();
    let snapshot;
    if (r.participants[pid]) snapshot = this._snapshot(r);
    else {
      r.participants[pid] = Date.now();
      snapshot = this._commit(r);
    }
    return { pid, my: this._my(r, pid), snapshot };
  }

  _my(r, pid) {
    return {
      poll: r.activities.poll.votes[pid] ?? null,
      feature: r.activities.feature.votes[pid] ?? null,
      cardCompleted: Boolean(r.activities.card.completed[pid]),
    };
  }

  async vote(code, activityId, pid, choice) {
    const r = this._record(code);
    const c = S.checkVote(r, activityId, pid, choice);
    r.activities[activityId].votes[pid] = c; // latest answer wins; one entry per participant id
    this._touchParticipant(r, pid);
    return { choice: c, snapshot: this._commit(r) };
  }

  async completeCard(code, pid) {
    const r = this._record(code);
    if (!S.isPid(pid)) throw new S.StoreError(400, 'Join the session first.');
    const card = r.activities.card;
    if (card.completed[pid]) return { duplicate: true, snapshot: this._snapshot(r) };
    if (r.ended || card.status !== 'open') throw new S.StoreError(409, 'The card activity is closed.');
    card.completed[pid] = Date.now();
    this._touchParticipant(r, pid);
    return { duplicate: false, snapshot: this._commit(r) };
  }

  // ----- presenter auth ----------------------------------------------------

  async addToken(token) {
    this.tokens.add(token);
    this._scheduleSave();
  }

  async hasToken(token) {
    return typeof token === 'string' && this.tokens.has(token);
  }

  // Returns how many attempts this address has made in the current 15-minute window.
  async loginAttempt(ip) {
    const now = Date.now();
    let entry = this.loginAttempts.get(ip);
    if (!entry || now > entry.resetAt) entry = { count: 0, resetAt: now + 15 * 60 * 1000 };
    entry.count += 1;
    this.loginAttempts.set(ip, entry);
    return entry.count;
  }

  async close() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this.saveNow();
  }
}

module.exports = { MemoryStore };
