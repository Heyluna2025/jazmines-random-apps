// Convex backend for the app. Built for ~1,000 phones at once:
// - student writes read and write only their own rows (point lookups) plus
//   one randomly chosen counter shard, so concurrent writes rarely collide;
// - totals come from counter shards, so nothing reads every vote;
// - mutations return only what they changed; the app reads fresh state with
//   a query afterwards (queries never conflict with writes).
// All functions are internal: only the app's server, holding the deploy key,
// can call them.
import { internalQueryGeneric as query, internalMutationGeneric as mutation } from 'convex/server';
import { v } from 'convex/values';

const SHARDS = 8;
const POLL_CHOICES = 5;
const FEATURE_CHOICES = 4;

const sessionByCode = (db, code) => db.query('sessions').withIndex('by_code', (q) => q.eq('code', code)).unique();
const rowByPid = (db, table, code, pid) => db.query(table).withIndex('by_code_pid', (q) => q.eq('code', code).eq('pid', pid)).unique();
const voteRow = (db, code, activity, pid) => db.query('votes').withIndex('by_code_activity_pid', (q) => q.eq('code', code).eq('activity', activity).eq('pid', pid)).unique();

async function addCounter(db, code, key, delta) {
  const shard = Math.floor(Math.random() * SHARDS);
  const row = await db.query('counters').withIndex('by_code_key_shard', (q) => q.eq('code', code).eq('key', key).eq('shard', shard)).unique();
  if (row) await db.patch(row._id, { value: row.value + delta });
  else await db.insert('counters', { code, key, shard, value: delta });
}

async function totals(db, code) {
  const rows = await db.query('counters').withIndex('by_code', (q) => q.eq('code', code)).collect();
  const sum = {};
  for (const r of rows) sum[r.key] = (sum[r.key] || 0) + r.value;
  return sum;
}

// Adds the participant if new; returns true when it was new.
async function ensureParticipant(db, code, pid) {
  if (await rowByPid(db, 'participants', code, pid)) return false;
  await db.insert('participants', { code, pid, joinedAt: Date.now() });
  await addCounter(db, code, 'participants', 1);
  return true;
}

async function deleteByCode(db, table, code) {
  const rows = await db.query(table).withIndex('by_code', (q) => q.eq('code', code)).collect();
  for (const r of rows) await db.delete(r._id);
}

async function clearSessionData(db, code) {
  for (const table of ['participants', 'votes', 'cards', 'profiles', 'counters']) await deleteByCode(db, table, code);
}

async function metaGet(db, key) {
  const row = await db.query('meta').withIndex('by_key', (q) => q.eq('key', key)).unique();
  return row ? row.value : null;
}

async function metaSet(db, key, value) {
  const row = await db.query('meta').withIndex('by_key', (q) => q.eq('key', key)).unique();
  if (value === null || value === undefined) { if (row) await db.delete(row._id); return; }
  if (row) await db.patch(row._id, { value });
  else await db.insert('meta', { key, value });
}

// ----- reading ---------------------------------------------------------------

export const ping = query({ args: {}, handler: async () => ({ ok: true }) });

export const getSession = query({
  args: { code: v.string() },
  handler: async ({ db }, { code }) => {
    const s = await sessionByCode(db, code);
    if (!s) return null;
    const t = await totals(db, code);
    const counts = (activity, n) => Array.from({ length: n }, (_, i) => t[`${activity}:${i}`] || 0);
    return {
      code: s.code,
      name: s.name,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      // Presenter changes bump s.version; every student write bumps "writes".
      version: s.version * 1e9 + (t.writes || 0),
      fields: s.fields,
      participantCount: t.participants || 0,
      profileCount: t.profiles || 0,
      completedCount: t.cards || 0,
      pollCounts: counts('poll', POLL_CHOICES),
      featureCounts: counts('feature', FEATURE_CHOICES),
    };
  },
});

export const listSessions = query({
  args: {},
  handler: async ({ db }) => {
    const rows = await db.query('sessions').collect();
    const out = [];
    for (const s of rows) {
      const t = await totals(db, s.code);
      out.push({ code: s.code, name: s.name, createdAt: s.createdAt, updatedAt: s.updatedAt, slide: s.fields.slide, ended: Boolean(s.fields.ended), participants: t.participants || 0 });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listProfiles = query({
  args: { code: v.string() },
  handler: async ({ db }, { code }) => {
    const rows = await db.query('profiles').withIndex('by_code', (q) => q.eq('code', code)).collect();
    return rows.map((p) => ({ pid: p.pid, name: p.name, school: p.school, email: p.email, at: p.at })).sort((a, b) => a.at - b.at);
  },
});

export const isCardDone = query({
  args: { code: v.string(), pid: v.string() },
  handler: async ({ db }, { code, pid }) => Boolean(await rowByPid(db, 'cards', code, pid)),
});

// ----- presenter writes (touch the session row) -----------------------------

export const createSession = mutation({
  args: { code: v.string(), name: v.string(), fields: v.any() },
  handler: async ({ db }, { code, name, fields }) => {
    if (await sessionByCode(db, code)) return { created: false };
    const now = Date.now();
    await db.insert('sessions', { code, name, createdAt: now, updatedAt: now, version: 0, fields });
    return { created: true };
  },
});

export const commit = mutation({
  args: { code: v.string(), patch: v.any() },
  handler: async ({ db }, { code, patch }) => {
    const s = await sessionByCode(db, code);
    if (!s) return false;
    await db.patch(s._id, { fields: { ...s.fields, ...patch }, version: s.version + 1, updatedAt: Date.now() });
    return true;
  },
});

export const resetSession = mutation({
  args: { code: v.string(), fields: v.any() },
  handler: async ({ db }, { code, fields }) => {
    const s = await sessionByCode(db, code);
    if (!s) return false;
    await clearSessionData(db, code);
    await db.patch(s._id, { fields: { ...s.fields, ...fields }, version: s.version + 1, updatedAt: Date.now() });
    return true;
  },
});

export const deleteSession = mutation({
  args: { code: v.string() },
  handler: async ({ db }, { code }) => {
    const s = await sessionByCode(db, code);
    if (!s) return false;
    await clearSessionData(db, code);
    await db.delete(s._id);
    if ((await metaGet(db, 'live')) === code) await metaSet(db, 'live', null);
    return true;
  },
});

// ----- student writes (own rows + one counter shard; never the session row)

export const join = mutation({
  args: { code: v.string(), pid: v.string() },
  handler: async ({ db }, { code, pid }) => {
    if (!(await sessionByCode(db, code))) return null;
    if (await ensureParticipant(db, code, pid)) await addCounter(db, code, 'writes', 1);
    const [poll, feature, card, profile] = await Promise.all([
      voteRow(db, code, 'poll', pid),
      voteRow(db, code, 'feature', pid),
      rowByPid(db, 'cards', code, pid),
      rowByPid(db, 'profiles', code, pid),
    ]);
    return {
      poll: poll ? poll.choice : null,
      feature: feature ? feature.choice : null,
      cardCompleted: Boolean(card),
      registered: Boolean(profile),
      name: profile ? profile.name : null,
    };
  },
});

export const vote = mutation({
  args: { code: v.string(), activity: v.string(), pid: v.string(), choice: v.number() },
  handler: async ({ db }, { code, activity, pid, choice }) => {
    if (!(await sessionByCode(db, code))) return false;
    await ensureParticipant(db, code, pid);
    const existing = await voteRow(db, code, activity, pid);
    if (existing && existing.choice === choice) return true;
    if (existing) {
      await db.patch(existing._id, { choice });
      await addCounter(db, code, `${activity}:${existing.choice}`, -1);
    } else {
      await db.insert('votes', { code, activity, pid, choice });
    }
    await addCounter(db, code, `${activity}:${choice}`, 1);
    await addCounter(db, code, 'writes', 1);
    return true;
  },
});

export const completeCard = mutation({
  args: { code: v.string(), pid: v.string() },
  handler: async ({ db }, { code, pid }) => {
    if (!(await sessionByCode(db, code))) return null;
    if (await rowByPid(db, 'cards', code, pid)) return { duplicate: true };
    await ensureParticipant(db, code, pid);
    await db.insert('cards', { code, pid, at: Date.now() });
    await addCounter(db, code, 'cards', 1);
    await addCounter(db, code, 'writes', 1);
    return { duplicate: false };
  },
});

export const setProfile = mutation({
  args: { code: v.string(), pid: v.string(), name: v.string(), school: v.string(), email: v.string() },
  handler: async ({ db }, { code, pid, name, school, email }) => {
    if (!(await sessionByCode(db, code))) return false;
    await ensureParticipant(db, code, pid);
    const existing = await rowByPid(db, 'profiles', code, pid);
    if (existing) {
      await db.patch(existing._id, { name, school, email });
    } else {
      await db.insert('profiles', { code, pid, name, school, email, at: Date.now() });
      await addCounter(db, code, 'profiles', 1);
    }
    await addCounter(db, code, 'writes', 1);
    return true;
  },
});

// ----- meta: live pointer, presenter tokens, login rate limit --------------

export const getLive = query({ args: {}, handler: async ({ db }) => metaGet(db, 'live') });

export const setLive = mutation({
  args: { code: v.union(v.string(), v.null()) },
  handler: async ({ db }, { code }) => { await metaSet(db, 'live', code); },
});

export const hasToken = query({
  args: { token: v.string() },
  handler: async ({ db }, { token }) => Boolean(await metaGet(db, `token:${token}`)),
});

export const addToken = mutation({
  args: { token: v.string() },
  handler: async ({ db }, { token }) => { await metaSet(db, `token:${token}`, Date.now()); },
});

export const loginAttempt = mutation({
  args: { ip: v.string() },
  handler: async ({ db }, { ip }) => {
    const key = `login:${ip}`;
    const now = Date.now();
    const entry = (await metaGet(db, key)) || { count: 0, resetAt: now + 15 * 60 * 1000 };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 15 * 60 * 1000; }
    entry.count += 1;
    await metaSet(db, key, entry);
    return entry.count;
  },
});
