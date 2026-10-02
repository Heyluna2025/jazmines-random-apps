'use strict';

// Convex-backed store. The functions live in convex/sessions.js and return the
// same snapshot shape; validation stays in server/sessions.js like every store.

const { anyApi } = require('convex/server');
const S = require('./sessions');

const api = anyApi.sessions;

// Convex rows keep the flat fields; turn one into the snapshot the app expects.
function toSnapshot(row) {
  if (!row) return null;
  const base = {
    code: row.code,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
    participantCount: row.participantCount,
    profileCount: row.profileCount,
    activities: {
      poll: { votes: row.pollVotes || {} },
      feature: { votes: row.featureVotes || {} },
      card: { completedCount: row.completedCount },
    },
  };
  return S.applyPatch(base, row.fields);
}

class ConvexStore {
  // `client` needs query(ref, args) and mutation(ref, args): a ConvexHttpClient
  // in production, or the convex-test harness in tests.
  constructor(client) {
    this.kind = 'convex';
    this.c = client;
  }

  async getSession(code) {
    code = String(code || '').toUpperCase();
    if (!S.isCode(code)) return null;
    return toSnapshot(await this.c.query(api.getSession, { code }));
  }

  async _require(code) {
    const s = await this.getSession(code);
    if (!s) throw S.notFound();
    return s;
  }

  async _commit(code, patch) {
    const row = await this.c.mutation(api.commit, { code, patch });
    if (!row) throw S.notFound();
    return toSnapshot(row);
  }

  async createSession(name) {
    for (;;) {
      const code = S.randomCode();
      const snapshot = S.newSnapshot(code, name, Date.now());
      const fields = { ...S.RESET_PATCH };
      const { created } = await this.c.mutation(api.createSession, { code, name: snapshot.name, fields });
      if (created) return snapshot;
    }
  }

  async listSessions() {
    return this.c.query(api.listSessions, {});
  }

  async deleteSession(code) {
    const s = await this._require(code);
    await this.c.mutation(api.deleteSession, { code: s.code });
  }

  async resetSession(code) {
    const s = await this._require(code);
    return toSnapshot(await this.c.mutation(api.resetSession, { code: s.code, fields: { ...S.RESET_PATCH } }));
  }

  async setSlide(code, slide) {
    const s = await this._require(code);
    return this._commit(s.code, S.planSlide(slide));
  }

  async setActivity(code, id, action, payload) {
    const s = await this._require(code);
    return this._commit(s.code, S.planActivity(s, id, action, payload));
  }

  async endSession(code) {
    const s = await this._require(code);
    return this._commit(s.code, S.planEnd(s, Date.now()));
  }

  async resumeSession(code) {
    const s = await this._require(code);
    return this._commit(s.code, S.planResume());
  }

  // ----- audience ----------------------------------------------------------

  async join(code, pid) {
    code = String(code || '').toUpperCase();
    if (!S.isCode(code)) throw S.notFound();
    if (!S.isPid(pid)) pid = S.newPid();
    const res = await this.c.mutation(api.join, { code, pid });
    if (!res) throw S.notFound();
    return { pid, my: res.my, snapshot: toSnapshot(res.snapshot) };
  }

  async vote(code, activityId, pid, choice) {
    const s = await this._require(code);
    const c = S.checkVote(s, activityId, pid, choice);
    const row = await this.c.mutation(api.vote, { code: s.code, activity: activityId, pid, choice: c });
    if (!row) throw S.notFound();
    return { choice: c, snapshot: toSnapshot(row) };
  }

  async completeCard(code, pid) {
    const s = await this._require(code);
    if (!S.isPid(pid)) throw new S.StoreError(400, 'Join the session first.');
    const open = !s.ended && s.activities.card.status === 'open';
    if (!open) {
      if (await this.c.query(api.isCardDone, { code: s.code, pid })) return { duplicate: true, snapshot: s };
      throw new S.StoreError(409, 'The card activity is closed.');
    }
    const res = await this.c.mutation(api.completeCard, { code: s.code, pid });
    if (!res) throw S.notFound();
    return { duplicate: res.duplicate, snapshot: toSnapshot(res.snapshot) };
  }

  async setProfile(code, pid, input) {
    const s = await this._require(code);
    if (!S.isPid(pid)) throw new S.StoreError(400, 'Join the session first.');
    const profile = S.cleanProfile(input);
    const row = await this.c.mutation(api.setProfile, { code: s.code, pid, name: profile.name, school: profile.school, email: profile.email });
    if (!row) throw S.notFound();
    return { profile, snapshot: toSnapshot(row) };
  }

  async listProfiles(code) {
    const s = await this._require(code);
    return this.c.query(api.listProfiles, { code: s.code });
  }

  // ----- live pointer & auth ----------------------------------------------

  async setLive(code) {
    await this.c.mutation(api.setLive, { code: code ? String(code).toUpperCase() : null });
  }

  async getLive() {
    return (await this.c.query(api.getLive, {})) || null;
  }

  async addToken(token) {
    await this.c.mutation(api.addToken, { token });
  }

  async hasToken(token) {
    if (typeof token !== 'string' || !token) return false;
    return Boolean(await this.c.query(api.hasToken, { token }));
  }

  async loginAttempt(ip) {
    return Number(await this.c.mutation(api.loginAttempt, { ip: String(ip) }));
  }

  async close() {}
}

module.exports = { ConvexStore };
