// Convex backend for the app. These functions are thin: they read and write
// rows and return the same "snapshot" shape the other stores produce, so the
// validation and view logic in server/sessions.js is shared by every store.
// All functions are internal: only the app's server, holding the deploy key, can call them.
import { internalQueryGeneric as query, internalMutationGeneric as mutation } from 'convex/server';
import { v } from 'convex/values';

const sessionByCode = (db, code) => db.query('sessions').withIndex('by_code', (q) => q.eq('code', code)).unique();

async function snapshotOf(db, s) {
  const [participants, pollVotes, featureVotes, cards, profiles] = await Promise.all([
    db.query('participants').withIndex('by_code', (q) => q.eq('code', s.code)).collect(),
    db.query('votes').withIndex('by_code_activity', (q) => q.eq('code', s.code).eq('activity', 'poll')).collect(),
    db.query('votes').withIndex('by_code_activity', (q) => q.eq('code', s.code).eq('activity', 'feature')).collect(),
    db.query('cards').withIndex('by_code', (q) => q.eq('code', s.code)).collect(),
    db.query('profiles').withIndex('by_code', (q) => q.eq('code', s.code)).collect(),
  ]);
  const votesMap = (rows) => Object.fromEntries(rows.map((r) => [r.pid, r.choice]));
  return {
    code: s.code,
    name: s.name,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    version: s.version,
    fields: s.fields,
    participantCount: participants.length,
    profileCount: profiles.length,
    pollVotes: votesMap(pollVotes),
    featureVotes: votesMap(featureVotes),
    completedCount: cards.length,
  };
}

async function bump(db, s, patch = {}) {
  const fields = { ...s.fields, ...patch };
  await db.patch(s._id, { fields, version: s.version + 1, updatedAt: Date.now() });
  return { ...s, fields, version: s.version + 1 };
}

async function ensureParticipant(db, code, pid) {
  const existing = await db.query('participants').withIndex('by_code_pid', (q) => q.eq('code', code).eq('pid', pid)).unique();
  if (existing) return false;
  await db.insert('participants', { code, pid, joinedAt: Date.now() });
  return true;
}

async function deleteRows(db, table, code) {
  const rows = await db.query(table).withIndex('by_code', (q) => q.eq('code', code)).collect();
  for (const r of rows) await db.delete(r._id);
}

async function deleteVotes(db, code) {
  for (const activity of ['poll', 'feature']) {
    const rows = await db.query('votes').withIndex('by_code_activity', (q) => q.eq('code', code).eq('activity', activity)).collect();
    for (const r of rows) await db.delete(r._id);
  }
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

// ----- sessions ------------------------------------------------------------

export const getSession = query({
  args: { code: v.string() },
  handler: async ({ db }, { code }) => {
    const s = await sessionByCode(db, code);
    return s ? snapshotOf(db, s) : null;
  },
});

export const listSessions = query({
  args: {},
  handler: async ({ db }) => {
    const rows = await db.query('sessions').order('desc').collect();
    const out = [];
    for (const s of rows) {
      const participants = await db.query('participants').withIndex('by_code', (q) => q.eq('code', s.code)).collect();
      out.push({ code: s.code, name: s.name, createdAt: s.createdAt, updatedAt: s.updatedAt, slide: s.fields.slide, ended: Boolean(s.fields.ended), participants: participants.length });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const createSession = mutation({
  args: { code: v.string(), name: v.string(), fields: v.any() },
  handler: async ({ db }, { code, name, fields }) => {
    if (await sessionByCode(db, code)) return { created: false };
    const now = Date.now();
    await db.insert('sessions', { code, name, createdAt: now, updatedAt: now, version: 0, fields });
    return { created: true };
  },
});

export const deleteSession = mutation({
  args: { code: v.string() },
  handler: async ({ db }, { code }) => {
    const s = await sessionByCode(db, code);
    if (!s) return false;
    await deleteRows(db, 'participants', code);
    await deleteRows(db, 'cards', code);
    await deleteRows(db, 'profiles', code);
    await deleteVotes(db, code);
    await db.delete(s._id);
    if ((await metaGet(db, 'live')) === code) await metaSet(db, 'live', null);
    return true;
  },
});

export const resetSession = mutation({
  args: { code: v.string(), fields: v.any() },
  handler: async ({ db }, { code, fields }) => {
    const s = await sessionByCode(db, code);
    if (!s) return null;
    await deleteRows(db, 'participants', code);
    await deleteRows(db, 'cards', code);
    await deleteRows(db, 'profiles', code);
    await deleteVotes(db, code);
    const next = await bump(db, s, fields);
    return snapshotOf(db, next);
  },
});

// Apply a validated patch of session fields (the store validates first).
export const commit = mutation({
  args: { code: v.string(), patch: v.any() },
  handler: async ({ db }, { code, patch }) => {
    const s = await sessionByCode(db, code);
    if (!s) return null;
    const next = await bump(db, s, patch);
    return snapshotOf(db, next);
  },
});

// ----- audience ------------------------------------------------------------

export const join = mutation({
  args: { code: v.string(), pid: v.string() },
  handler: async ({ db }, { code, pid }) => {
    let s = await sessionByCode(db, code);
    if (!s) return null;
    if (await ensureParticipant(db, code, pid)) s = await bump(db, s);
    const [poll, feature, card, profile] = await Promise.all([
      db.query('votes').withIndex('by_code_activity_pid', (q) => q.eq('code', code).eq('activity', 'poll').eq('pid', pid)).unique(),
      db.query('votes').withIndex('by_code_activity_pid', (q) => q.eq('code', code).eq('activity', 'feature').eq('pid', pid)).unique(),
      db.query('cards').withIndex('by_code_pid', (q) => q.eq('code', code).eq('pid', pid)).unique(),
      db.query('profiles').withIndex('by_code_pid', (q) => q.eq('code', code).eq('pid', pid)).unique(),
    ]);
    return {
      my: { poll: poll ? poll.choice : null, feature: feature ? feature.choice : null, cardCompleted: Boolean(card), registered: Boolean(profile), name: profile ? profile.name : null },
      snapshot: await snapshotOf(db, s),
    };
  },
});

export const vote = mutation({
  args: { code: v.string(), activity: v.string(), pid: v.string(), choice: v.number() },
  handler: async ({ db }, { code, activity, pid, choice }) => {
    let s = await sessionByCode(db, code);
    if (!s) return null;
    const existing = await db.query('votes').withIndex('by_code_activity_pid', (q) => q.eq('code', code).eq('activity', activity).eq('pid', pid)).unique();
    if (existing) await db.patch(existing._id, { choice });
    else await db.insert('votes', { code, activity, pid, choice });
    await ensureParticipant(db, code, pid);
    s = await bump(db, s);
    return snapshotOf(db, s);
  },
});

export const completeCard = mutation({
  args: { code: v.string(), pid: v.string() },
  handler: async ({ db }, { code, pid }) => {
    let s = await sessionByCode(db, code);
    if (!s) return null;
    const existing = await db.query('cards').withIndex('by_code_pid', (q) => q.eq('code', code).eq('pid', pid)).unique();
    if (existing) return { duplicate: true, snapshot: await snapshotOf(db, s) };
    await db.insert('cards', { code, pid, at: Date.now() });
    await ensureParticipant(db, code, pid);
    s = await bump(db, s);
    return { duplicate: false, snapshot: await snapshotOf(db, s) };
  },
});

export const isCardDone = query({
  args: { code: v.string(), pid: v.string() },
  handler: async ({ db }, { code, pid }) => Boolean(await db.query('cards').withIndex('by_code_pid', (q) => q.eq('code', code).eq('pid', pid)).unique()),
});

export const setProfile = mutation({
  args: { code: v.string(), pid: v.string(), name: v.string(), school: v.string(), email: v.string() },
  handler: async ({ db }, { code, pid, name, school, email }) => {
    let s = await sessionByCode(db, code);
    if (!s) return null;
    const at = Date.now();
    const existing = await db.query('profiles').withIndex('by_code_pid', (q) => q.eq('code', code).eq('pid', pid)).unique();
    if (existing) await db.patch(existing._id, { name, school, email });
    else await db.insert('profiles', { code, pid, name, school, email, at });
    await ensureParticipant(db, code, pid);
    s = await bump(db, s);
    return snapshotOf(db, s);
  },
});

export const listProfiles = query({
  args: { code: v.string() },
  handler: async ({ db }, { code }) => {
    const rows = await db.query('profiles').withIndex('by_code', (q) => q.eq('code', code)).collect();
    return rows.map((p) => ({ pid: p.pid, name: p.name, school: p.school, email: p.email, at: p.at })).sort((a, b) => a.at - b.at);
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
