'use strict';

// Redis-backed store for serverless hosts (Vercel + Upstash). Every function
// instance shares the same data, and votes are single HSETs so concurrent
// taps never overwrite each other.
//
// Keys (all expire two months after their last write):
//   yfsh:sessions          zset  code -> createdAt
//   yfsh:s:{code}          hash  session fields (same names as RESET_PATCH)
//   yfsh:p:{code}          hash  participant id -> joinedAt
//   yfsh:v:{code}:{act}    hash  participant id -> choice
//   yfsh:c:{code}          set   participant ids that completed a card
//   yfsh:tokens            set   presenter tokens
//   yfsh:live              str   session code the printed /join link points at
//   yfsh:rl:{ip}           int   login attempts in the current window

const S = require('./sessions');

const TTL = 60 * 24 * 3600;
const k = {
  index: 'yfsh:sessions',
  tokens: 'yfsh:tokens',
  live: 'yfsh:live',
  s: (code) => `yfsh:s:${code}`,
  p: (code) => `yfsh:p:${code}`,
  v: (code, activity) => `yfsh:v:${code}:${activity}`,
  c: (code) => `yfsh:c:${code}`,
  prof: (code) => `yfsh:prof:${code}`,
  rl: (ip) => `yfsh:rl:${ip}`,
};

const ser = (v) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
const num = (v) => (v === '' || v === undefined || v === null ? null : Number(v));

function fromPairs(arr) {
  const out = {};
  for (let i = 0; i < (arr || []).length; i += 2) out[arr[i]] = arr[i + 1];
  return out;
}

function numericValues(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) out[key] = Number(value);
  return out;
}

function fieldsOf(patch) {
  const out = [];
  for (const [key, value] of Object.entries(patch)) out.push(key, ser(value));
  return out;
}

class RedisStore {
  constructor(client) {
    this.kind = 'redis';
    this.r = client;
  }

  // ----- reading -----------------------------------------------------------

  _parse(code, h, participantCount, pollVotes, featureVotes, completedCount, profileCount = 0) {
    if (!h || !h.name) return null;
    return {
      code,
      name: h.name,
      createdAt: Number(h.createdAt),
      updatedAt: Number(h.updatedAt),
      version: Number(h.version || 0),
      slide: Number(h.slide),
      ended: h.ended === '1',
      endedAt: num(h.endedAt),
      participantCount: Number(participantCount || 0),
      profileCount: Number(profileCount || 0),
      activities: {
        poll: {
          status: h['poll:status'],
          revealed: h['poll:revealed'] === '1',
          votes: numericValues(pollVotes),
          winnerOverride: num(h['poll:winnerOverride']),
        },
        feature: {
          status: h['feature:status'],
          revealed: h['feature:revealed'] === '1',
          votes: numericValues(featureVotes),
          winnerOverride: num(h['feature:winnerOverride']),
        },
        card: { status: h['card:status'], completedCount: Number(completedCount || 0) },
      },
    };
  }

  async getSession(code) {
    code = String(code || '').toUpperCase();
    if (!S.isCode(code)) return null;
    const [h, participants, pollVotes, featureVotes, completed, profiles] = await this.r.pipeline([
      ['HGETALL', k.s(code)],
      ['HLEN', k.p(code)],
      ['HGETALL', k.v(code, 'poll')],
      ['HGETALL', k.v(code, 'feature')],
      ['SCARD', k.c(code)],
      ['HLEN', k.prof(code)],
    ]);
    return this._parse(code, fromPairs(h), participants, fromPairs(pollVotes), fromPairs(featureVotes), completed, profiles);
  }

  async _require(code) {
    const s = await this.getSession(code);
    if (!s) throw S.notFound();
    return s;
  }

  // ----- writing -----------------------------------------------------------

  // One round trip: optional commands, then the session patch and version bump.
  async _commit(code, patch = {}, { before = [], after = [] } = {}) {
    const now = Date.now();
    return this.r.pipeline([
      ...before,
      ['HSET', k.s(code), ...fieldsOf(patch), 'updatedAt', String(now)],
      ['HINCRBY', k.s(code), 'version', 1],
      ['EXPIRE', k.s(code), TTL],
      ...after,
    ]);
  }

  // The snapshot as it stands after a commit, without reading it back.
  _after(snapshot, patch = {}) {
    const s = S.applyPatch(snapshot, patch);
    s.version += 1;
    s.updatedAt = Date.now();
    return s;
  }

  async createSession(name) {
    let code = S.randomCode();
    while (await this.r.cmd('EXISTS', k.s(code))) code = S.randomCode();
    const now = Date.now();
    const snapshot = S.newSnapshot(code, name, now);
    const fields = { name: snapshot.name, createdAt: now, updatedAt: now, version: 0, ...S.RESET_PATCH };
    await this.r.pipeline([
      ['HSET', k.s(code), ...fieldsOf(fields)],
      ['EXPIRE', k.s(code), TTL],
      ['ZADD', k.index, String(now), code],
    ]);
    return snapshot;
  }

  async listSessions() {
    const codes = await this.r.cmd('ZREVRANGE', k.index, 0, 99);
    if (!codes || !codes.length) return [];
    const res = await this.r.pipeline(codes.flatMap((code) => [['HGETALL', k.s(code)], ['HLEN', k.p(code)]]));
    const out = [];
    codes.forEach((code, i) => {
      const h = fromPairs(res[i * 2]);
      if (!h.name) return; // expired session still listed in the index
      out.push({
        code,
        name: h.name,
        createdAt: Number(h.createdAt),
        updatedAt: Number(h.updatedAt),
        slide: Number(h.slide),
        ended: h.ended === '1',
        participants: Number(res[i * 2 + 1] || 0),
      });
    });
    return out;
  }

  async deleteSession(code) {
    const s = await this._require(code);
    await this.r.pipeline([
      ['DEL', k.s(s.code), k.p(s.code), k.v(s.code, 'poll'), k.v(s.code, 'feature'), k.c(s.code), k.prof(s.code)],
      ['ZREM', k.index, s.code],
    ]);
    if ((await this.getLive()) === s.code) await this.r.cmd('DEL', k.live);
  }

  // ----- printed /join link ------------------------------------------------

  async setLive(code) {
    if (code) await this.r.cmd('SET', k.live, String(code).toUpperCase());
    else await this.r.cmd('DEL', k.live);
  }

  async getLive() {
    return (await this.r.cmd('GET', k.live)) || null;
  }

  async resetSession(code) {
    const s = await this._require(code);
    await this._commit(s.code, S.RESET_PATCH, {
      before: [['DEL', k.p(s.code), k.v(s.code, 'poll'), k.v(s.code, 'feature'), k.c(s.code), k.prof(s.code)]],
    });
    const after = this._after(s, S.RESET_PATCH);
    after.participantCount = 0;
    after.profileCount = 0;
    after.activities.poll.votes = {};
    after.activities.feature.votes = {};
    after.activities.card.completedCount = 0;
    return after;
  }

  async setSlide(code, slide) {
    const s = await this._require(code);
    const patch = S.planSlide(slide);
    await this._commit(s.code, patch);
    return this._after(s, patch);
  }

  async setActivity(code, id, action, payload) {
    const s = await this._require(code);
    const patch = S.planActivity(s, id, action, payload);
    await this._commit(s.code, patch);
    return this._after(s, patch);
  }

  async endSession(code) {
    const s = await this._require(code);
    const patch = S.planEnd(s, Date.now());
    await this._commit(s.code, patch);
    return this._after(s, patch);
  }

  async resumeSession(code) {
    const s = await this._require(code);
    const patch = S.planResume();
    await this._commit(s.code, patch);
    return this._after(s, patch);
  }

  // ----- audience ----------------------------------------------------------

  async join(code, pid) {
    const s = await this._require(code);
    if (!S.isPid(pid)) pid = S.newPid();
    const [isNew, poll, feature, done, prof] = await this._commit(s.code, {}, {
      before: [
        ['HSETNX', k.p(s.code), pid, String(Date.now())],
        ['HGET', k.v(s.code, 'poll'), pid],
        ['HGET', k.v(s.code, 'feature'), pid],
        ['SISMEMBER', k.c(s.code), pid],
        ['HGET', k.prof(s.code), pid],
      ],
      after: [['EXPIRE', k.p(s.code), TTL]],
    });
    const snapshot = this._after(s);
    if (isNew) snapshot.participantCount += 1;
    let profile = null;
    try { profile = prof ? JSON.parse(prof) : null; } catch { profile = null; }
    return {
      pid,
      my: { poll: num(poll), feature: num(feature), cardCompleted: Number(done) === 1, registered: Boolean(profile), name: profile ? profile.name : null },
      snapshot,
    };
  }

  async setProfile(code, pid, input) {
    const s = await this._require(code);
    if (!S.isPid(pid)) throw new S.StoreError(400, 'Join the session first.');
    const profile = S.cleanProfile(input);
    const [added] = await this._commit(s.code, {}, {
      before: [['HSET', k.prof(s.code), pid, JSON.stringify(profile)], ['HSETNX', k.p(s.code), pid, String(Date.now())]],
      after: [['EXPIRE', k.prof(s.code), TTL], ['EXPIRE', k.p(s.code), TTL]],
    });
    const snapshot = this._after(s);
    if (added) snapshot.profileCount += 1;
    return { profile, snapshot };
  }

  async listProfiles(code) {
    const s = await this._require(code);
    const raw = fromPairs(await this.r.cmd('HGETALL', k.prof(s.code)));
    const out = [];
    for (const [pid, json] of Object.entries(raw)) {
      try { out.push({ pid, ...JSON.parse(json) }); } catch { /* skip bad row */ }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  async vote(code, activityId, pid, choice) {
    const s = await this._require(code);
    const c = S.checkVote(s, activityId, pid, choice);
    const [, isNew] = await this._commit(s.code, {}, {
      before: [
        ['HSET', k.v(s.code, activityId), pid, String(c)],
        ['HSETNX', k.p(s.code), pid, String(Date.now())],
      ],
      after: [['EXPIRE', k.v(s.code, activityId), TTL], ['EXPIRE', k.p(s.code), TTL]],
    });
    const snapshot = this._after(s);
    snapshot.activities[activityId].votes[pid] = c;
    if (isNew) snapshot.participantCount += 1;
    return { choice: c, snapshot };
  }

  async completeCard(code, pid) {
    const s = await this._require(code);
    if (!S.isPid(pid)) throw new S.StoreError(400, 'Join the session first.');
    const open = !s.ended && s.activities.card.status === 'open';
    if (!open) {
      const done = await this.r.cmd('SISMEMBER', k.c(s.code), pid);
      if (Number(done) === 1) return { duplicate: true, snapshot: s };
      throw new S.StoreError(409, 'The card activity is closed.');
    }
    const [added, isNew] = await this._commit(s.code, {}, {
      before: [['SADD', k.c(s.code), pid], ['HSETNX', k.p(s.code), pid, String(Date.now())]],
      after: [['EXPIRE', k.c(s.code), TTL], ['EXPIRE', k.p(s.code), TTL]],
    });
    const snapshot = this._after(s);
    if (added) snapshot.activities.card.completedCount += 1;
    if (isNew) snapshot.participantCount += 1;
    return { duplicate: !added, snapshot };
  }

  // ----- presenter auth ----------------------------------------------------

  async addToken(token) {
    await this.r.cmd('SADD', k.tokens, token);
  }

  async hasToken(token) {
    if (typeof token !== 'string' || !token) return false;
    return Number(await this.r.cmd('SISMEMBER', k.tokens, token)) === 1;
  }

  async loginAttempt(ip) {
    const [count] = await this.r.pipeline([['INCR', k.rl(ip)], ['EXPIRE', k.rl(ip), 900]]);
    return Number(count);
  }

  async close() {}
}

module.exports = { RedisStore };
