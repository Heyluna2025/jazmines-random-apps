'use strict';

// Pure session logic shared by both stores: codes and ids, the shape of a
// session snapshot, validation of changes ("plans"), tallies, and the state
// each view is allowed to see. Nothing here touches storage.

const crypto = require('crypto');
const { SLIDES, ACTIVITIES, SLIDE_COUNT } = require('./slides');

// Session codes avoid look-alike characters (0/O, 1/I) so they're easy to type.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;
const PID_RE = /^[a-f0-9]{32}$/;
const VOTE_ACTIVITIES = ['poll', 'feature'];

class StoreError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const notFound = () => new StoreError(404, 'Session not found. Check the code and try again.');

function randomCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function newPid() {
  return crypto.randomBytes(16).toString('hex');
}

const isCode = (code) => CODE_RE.test(String(code || ''));
const isPid = (pid) => PID_RE.test(String(pid || ''));
const cleanName = (name) => String(name || '').trim().slice(0, 60) || 'Untitled session';

// A session is described by flat fields. "poll:status" style keys map onto
// activities.poll.status in a snapshot and are hash fields in Redis, so both
// stores apply exactly the same patches.
// The opening poll starts open, so phones that scan early can answer at once
// without the presenter pressing anything.
const RESET_PATCH = {
  slide: 1,
  ended: false,
  endedAt: null,
  'poll:status': 'open',
  'poll:revealed': false,
  'poll:winnerOverride': null,
  'feature:status': 'pending',
  'feature:revealed': false,
  'feature:winnerOverride': null,
  'card:status': 'pending',
};

function setField(target, key, value) {
  const i = key.indexOf(':');
  if (i < 0) target[key] = value;
  else target.activities[key.slice(0, i)][key.slice(i + 1)] = value;
}

function applyPatch(snapshot, patch) {
  const s = structuredClone(snapshot);
  for (const [key, value] of Object.entries(patch)) setField(s, key, value);
  return s;
}

function newSnapshot(code, name, now) {
  const base = {
    code,
    name: cleanName(name),
    createdAt: now,
    updatedAt: now,
    version: 0,
    participantCount: 0,
    activities: { poll: { votes: {} }, feature: { votes: {} }, card: { completedCount: 0 } },
  };
  return applyPatch(base, RESET_PATCH);
}

// Count votes for one activity and work out the winner. Ties (including
// "no votes yet") have no winner until the presenter picks one of the leaders.
function tally(activity, choices) {
  const counts = choices.map(() => 0);
  for (const c of Object.values(activity.votes)) {
    const i = Number(c);
    if (counts[i] !== undefined) counts[i]++;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(...counts);
  const leaders = counts.map((n, i) => (n === max ? i : -1)).filter((i) => i >= 0);
  const tie = total === 0 || leaders.length > 1;
  let winner = null;
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

// ----- plans: validate a change against the current snapshot, return the patch

function planSlide(slide) {
  const n = Number(slide);
  if (!Number.isInteger(n) || n < 1 || n > SLIDE_COUNT) throw new StoreError(400, `Slide must be 1–${SLIDE_COUNT}.`);
  return { slide: n };
}

function planActivity(s, id, action, payload = {}) {
  const a = s.activities[id];
  if (!a) throw new StoreError(404, 'Unknown activity.');
  switch (action) {
    case 'open':
      if (s.ended) throw new StoreError(409, 'The session has ended. Resume it first.');
      return { [`${id}:status`]: 'open' };
    case 'close':
      return { [`${id}:status`]: a.status === 'pending' ? 'pending' : 'closed' };
    case 'reveal':
      if (id === 'card') throw new StoreError(400, 'Cards are never shown on the projector.');
      return { [`${id}:revealed`]: true };
    case 'hide':
      if (id === 'card') throw new StoreError(400, 'Nothing to hide.');
      return { [`${id}:revealed`]: false };
    case 'setWinner': {
      if (id === 'card') throw new StoreError(400, 'Cards have no winner.');
      const choice = payload.choice === null || payload.choice === undefined ? null : Number(payload.choice);
      if (choice !== null) {
        const { leaders } = tally(a, ACTIVITIES[id].choices);
        if (!leaders.includes(choice)) throw new StoreError(400, 'Only a tied leading choice can be picked as winner.');
      }
      return { [`${id}:winnerOverride`]: choice };
    }
    default:
      throw new StoreError(400, 'Unknown action.');
  }
}

function planEnd(s, now) {
  const patch = { ended: true, endedAt: now };
  for (const id of Object.keys(s.activities)) {
    if (s.activities[id].status === 'open') patch[`${id}:status`] = 'closed';
  }
  return patch;
}

const planResume = () => ({ ended: false, endedAt: null });

function checkVote(s, activityId, pid, choice) {
  if (!VOTE_ACTIVITIES.includes(activityId)) throw new StoreError(404, 'Unknown activity.');
  if (!isPid(pid)) throw new StoreError(400, 'Join the session first.');
  if (s.ended || s.activities[activityId].status !== 'open') throw new StoreError(409, 'This activity is closed.');
  const c = Number(choice);
  if (!Number.isInteger(c) || c < 0 || c >= ACTIVITIES[activityId].choices.length) throw new StoreError(400, 'Pick one of the choices.');
  return c;
}

// ----- views

// Shared by the audience and projector. Counts appear only once revealed.
function publicState(s) {
  const poll = tally(s.activities.poll, ACTIVITIES.poll.choices);
  const feature = tally(s.activities.feature, ACTIVITIES.feature.choices);
  const slide = SLIDES[s.slide - 1];
  return {
    code: s.code,
    name: s.name,
    version: s.version,
    updatedAt: s.updatedAt,
    slide: s.slide,
    slideTitle: slide.title,
    slideCount: SLIDE_COUNT,
    ended: s.ended,
    focus: computeFocus(s),
    participantCount: s.participantCount,
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
        completed: s.activities.card.completedCount,
      },
    },
  };
}

// Presenter sees live counts at all times, plus tie-break details.
function presenterState(s) {
  const pub = publicState(s);
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

function listEntry(s) {
  return {
    code: s.code,
    name: s.name,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    slide: s.slide,
    ended: s.ended,
    participants: s.participantCount,
  };
}

module.exports = {
  StoreError, notFound, randomCode, newPid, isCode, isPid, cleanName,
  RESET_PATCH, setField, applyPatch, newSnapshot,
  tally, computeFocus, planSlide, planActivity, planEnd, planResume, checkVote,
  publicState, presenterState, listEntry, CODE_RE, PID_RE,
};
