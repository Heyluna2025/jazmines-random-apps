import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// One row per session; `fields` holds the flat session fields the app patches
// ("poll:status", "slide", …) so the shared session logic stays unchanged.
export default defineSchema({
  sessions: defineTable({
    code: v.string(),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    version: v.number(),
    fields: v.any(),
  }).index('by_code', ['code']),

  participants: defineTable({
    code: v.string(),
    pid: v.string(),
    joinedAt: v.number(),
  }).index('by_code_pid', ['code', 'pid']).index('by_code', ['code']),

  votes: defineTable({
    code: v.string(),
    activity: v.string(),
    pid: v.string(),
    choice: v.number(),
  }).index('by_code_activity_pid', ['code', 'activity', 'pid']).index('by_code_activity', ['code', 'activity']),

  cards: defineTable({
    code: v.string(),
    pid: v.string(),
    at: v.number(),
  }).index('by_code_pid', ['code', 'pid']).index('by_code', ['code']),

  profiles: defineTable({
    code: v.string(),
    pid: v.string(),
    name: v.string(),
    school: v.string(),
    email: v.string(),
    at: v.number(),
  }).index('by_code_pid', ['code', 'pid']).index('by_code', ['code']),

  // Small key/value rows: the live session pointer, presenter tokens, login rate limits.
  meta: defineTable({
    key: v.string(),
    value: v.any(),
  }).index('by_key', ['key']),
});
