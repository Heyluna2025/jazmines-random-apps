'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SLIDES, ACTIVITIES, SLIDE_COUNT } = require('./slides');

// Session codes avoid look-alike characters (0/O, 1/I) so they're easy to type.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const CODE_RE = /^[A-Z2-9]{4}$/;
const PID_RE = /^[a-f0-9]{32}$/;
const VOTE_ACTIVITIES = ['poll', 'feature'];

function randomCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function newPid() {
  return crypto.randomBytes(16).toString('hex');
}

function newActivity(id) {
  if (id === 'card') return { status: 'pending', completed: {} };
  return { status: 'pending', revealed: false, votes: {}, winnerOverride: null };
}

function newSession(name) {
  const now = Date.now();
  return {
    code: randomCode(),
    name: String(name || '').trim().slice(0, 60) || 'Untitled session',
    createdAt: now,
    updatedAt: now,
    slide: 1,
    ended: false,
    endedAt: null,
    participants: {},
    activities: { poll: newActivity('poll'), feature: newActivity('feature'), card: newActivity('card') },
  };
}

// Count votes for one activity and work out the winner. Ties (including
// "no votes yet") have no winner until the presenter picks one of the leaders.
function tally(activity, choices) {
  const counts = choices.map(() => 0);
  for (const c of Object.values(activity.votes)) if (counts[c] !== undefined) counts[c]++;
  const total = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(...counts);
  const leaders = counts.map((n, i) => (n === max ? i : -1)).filter((i) => i >= 0);
  let winner = null;
  let tie = total === 0 || leaders.length > 1;
  if (!tie) winner = leaders[0];
  else if (activity.winnerOverride !== null && leaders.includes(activity.winnerOverride)) winner = activity.winnerOverride;
  return { counts, total, winner, tie, leaders };
}

// What the audience should be looking at right now. Derived from the session
// so every phone agrees without the presenter choosing a screen by hand.
function computeFocus(s) {
  if (s.ended) return 'ended';
  const { poll, feature, card } = s.activities;
  if (card.status === 'open' || (card.status === 'closed' && s.slide >= 9)) return 'card';
  if (feature.status === 'open' || (feature.status === 'closed' && s.slide >= 6 && s.slide <= 7)) return 'feature';
  if (poll.status === 'open' || (poll.status === 'closed' && s.slide <= 2)) return 'poll';
  return 'waiting';
}

class StoreError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class SessionStore {
  constructor(file) {
    this.file = file;
    this.sessions = new Map();
    this.tokens = new Set();
    this.onChange = () => {};
    this._saveTimer = null;
    this._load();
  }

  // ----- persistence -------------------------------------------------------

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const s of raw.sessions || []) this.sessions.set(s.code, s);
      for (const t of raw.tokens || []) this.tokens.add(t);
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[store] could not read ${this.file}: ${err.message}`);
    }
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.saveNow();
    }, 300);
  }

  saveNow() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      const data = { sessions: [...this.sessions.values()], tokens: [...this.tokens] };
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.warn(`[store] could not write ${this.file}: ${err.message}`);
    }
  }

  _touch(s) {
    s.updatedAt = Date.now();
    this._scheduleSave();
    this.onChange(s.code);
  }

  // ----- presenter auth ----------------------------------------------------

  addToken(token) {
    this.tokens.add(token);
    this._scheduleSave();
  }

  hasToken(token) {
    return typeof token === 'string' && this.tokens.has(token);
  }

  // ----- sessions ----------------------------------------------------------

  static isCode(code) {
    return CODE_RE.test(code || '');
  }

  get(code) {
    return this.sessions.get(String(code || '').toUpperCase()) || null;
  }

  require(code) {
    const s = this.get(code);
    if (!s) throw new StoreError(404, 'Session not found. Check the code and try again.');
    return s;
  }

  list() {
    return [...this.sessions.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({
        code: s.code,
        name: s.name,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        slide: s.slide,
        ended: s.ended,
        participants: Object.keys(s.participants).length,
      }));
  }

  create(name) {
    let s = newSession(name);
    while (this.sessions.has(s.code)) s = newSession(name);
    this.sessions.set(s.code, s);
    this._touch(s);
    return s;
  }

  delete(code) {
    const s = this.require(code);
    this.sessions.delete(s.code);
    this._scheduleSave();
    this.onChange(s.code);
  }

  // Clears every response and goes back to slide 1. The code stays the same
  // so printed QR codes keep working.
  reset(code) {
    const s = this.require(code);
    s.slide = 1;
    s.ended = false;
    s.endedAt = null;
    s.participants = {};
    s.activities = { poll: newActivity('poll'), feature: newActivity('feature'), card: newActivity('card') };
    this._touch(s);
    return s;
  }

  setSlide(code, slide) {
    const s = this.require(code);
    const n = Number(slide);
    if (!Number.isInteger(n) || n < 1 || n > SLIDE_COUNT) throw new StoreError(400, `Slide must be 1–${SLIDE_COUNT}.`);
    s.slide = n;
    this._touch(s);
    return s;
  }

  setActivity(code, id, action, payload = {}) {
    const s = this.require(code);
    const a = s.activities[id];
    if (!a) throw new StoreError(404, 'Unknown activity.');
    switch (action) {
      case 'open':
        if (s.ended) throw new StoreError(409, 'The session has ended. Resume it first.');
        a.status = 'open';
        break;
      case 'close':
        a.status = a.status === 'pending' ? 'pending' : 'closed';
        break;
      case 'reveal':
        if (id === 'card') throw new StoreError(400, 'Cards are never shown on the projector.');
        a.revealed = true;
        break;
      case 'hide':
        if (id === 'card') throw new StoreError(400, 'Nothing to hide.');
        a.revealed = false;
        break;
      case 'setWinner': {
        if (id === 'card') throw new StoreError(400, 'Cards have no winner.');
        const choice = payload.choice === null ? null : Number(payload.choice);
        if (choice !== null) {
          const { leaders } = tally(a, ACTIVITIES[id].choices);
          if (!leaders.includes(choice)) throw new StoreError(400, 'Only a tied leading choice can be picked as winner.');
        }
        a.winnerOverride = choice;
        break;
      }
      default:
        throw new StoreError(400, 'Unknown action.');
    }
    this._touch(s);
    return s;
  }

  end(code) {
    const s = this.require(code);
    s.ended = true;
    s.endedAt = Date.now();
    for (const id of Object.keys(s.activities)) {
      if (s.activities[id].status === 'open') s.activities[id].status = 'closed';
    }
    this._touch(s);
    return s;
  }

  resume(code) {
    const s = this.require(code);
    s.ended = false;
    s.endedAt = null;
    this._touch(s);
    return s;
  }

  // ----- audience ----------------------------------------------------------

  join(code, pid) {
    const s = this.require(code);
    if (!PID_RE.test(pid || '')) pid = newPid();
    const now = Date.now();
    if (!s.participants[pid]) {
      s.participants[pid] = { joinedAt: now, lastSeen: now };
      this._touch(s);
    } else {
      s.participants[pid].lastSeen = now;
      this._scheduleSave();
    }
    return { pid, my: this.myState(s, pid) };
  }

  myState(s, pid) {
    return {
      poll: s.activities.poll.votes[pid] ?? null,
      feature: s.activities.feature.votes[pid] ?? null,
      cardCompleted: Boolean(s.activities.card.completed[pid]),
    };
  }

  vote(code, activityId, pid, choice) {
    const s = this.require(code);
    if (!VOTE_ACTIVITIES.includes(activityId)) throw new StoreError(404, 'Unknown activity.');
    if (!PID_RE.test(pid || '')) throw new StoreError(400, 'Join the session first.');
    const a = s.activities[activityId];
    if (s.ended || a.status !== 'open') throw new StoreError(409, 'This activity is closed.');
    const c = Number(choice);
    if (!Number.isInteger(c) || c < 0 || c >= ACTIVITIES[activityId].choices.length) throw new StoreError(400, 'Pick one of the choices.');
    if (!s.participants[pid]) s.participants[pid] = { joinedAt: Date.now(), lastSeen: Date.now() };
    a.votes[pid] = c; // latest answer wins; one entry per participant id
    this._touch(s);
    return { choice: c };
  }

  completeCard(code, pid) {
    const s = this.require(code);
    if (!PID_RE.test(pid || '')) throw new StoreError(400, 'Join the session first.');
    const a = s.activities.card;
    if (a.completed[pid]) return { completed: true, duplicate: true };
    if (s.ended || a.status !== 'open') throw new StoreError(409, 'The card activity is closed.');
    if (!s.participants[pid]) s.participants[pid] = { joinedAt: Date.now(), lastSeen: Date.now() };
    a.completed[pid] = Date.now();
    this._touch(s);
    return { completed: true, duplicate: false };
  }

  // ----- views -------------------------------------------------------------

  // Shared by the audience and projector. Counts appear only once revealed.
  publicState(code) {
    const s = this.get(code);
    if (!s) return null;
    const poll = tally(s.activities.poll, ACTIVITIES.poll.choices);
    const feature = tally(s.activities.feature, ACTIVITIES.feature.choices);
    const slide = SLIDES[s.slide - 1];
    return {
      code: s.code,
      name: s.name,
      slide: s.slide,
      slideTitle: slide.title,
      slideCount: SLIDE_COUNT,
      ended: s.ended,
      focus: computeFocus(s),
      participantCount: Object.keys(s.participants).length,
      activities: {
        poll: {
          status: s.activities.poll.status,
          revealed: s.activities.poll.revealed,
          total: poll.total,
          counts: s.activities.poll.revealed ? poll.counts : null,
        },
        feature: {
          status: s.activities.feature.status,
          revealed: s.activities.feature.revealed,
          total: feature.total,
          counts: s.activities.feature.revealed ? feature.counts : null,
          winner: s.activities.feature.revealed ? feature.winner : null,
          tie: s.activities.feature.revealed ? feature.tie : null,
        },
        card: {
          status: s.activities.card.status,
          completed: Object.keys(s.activities.card.completed).length,
        },
      },
    };
  }

  // Presenter sees live counts at all times, plus tie-break details.
  presenterState(code) {
    const s = this.get(code);
    if (!s) return null;
    const pub = this.publicState(code);
    const poll = tally(s.activities.poll, ACTIVITIES.poll.choices);
    const feature = tally(s.activities.feature, ACTIVITIES.feature.choices);
    pub.createdAt = s.createdAt;
    pub.endedAt = s.endedAt;
    pub.activities.poll.counts = poll.counts;
    pub.activities.feature.counts = feature.counts;
    pub.activities.feature.winner = feature.winner;
    pub.activities.feature.tie = feature.tie;
    pub.activities.feature.leaders = feature.leaders;
    pub.activities.feature.winnerOverride = s.activities.feature.winnerOverride;
    return pub;
  }
}

module.exports = { SessionStore, StoreError, tally, computeFocus, CODE_RE, PID_RE };
