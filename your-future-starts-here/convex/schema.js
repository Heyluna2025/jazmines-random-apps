import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// Built for ~1,000 phones at once: each student write touches only its own
// rows plus one counter shard, and nothing an audience write does reads or
// writes the session row, so concurrent writes rarely conflict.
export default defineSchema({
  // One row per session; `fields` holds the flat session fields the app
  // patches ("poll:status", "slide", …). Only presenter actions write it.
  sessions: defineTable({
    code: v.string(),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    version: v.number(),
    fields: v.any(),
  }).index('by_code', ['code']),

  participants: defineTable({ code: v.string(), pid: v.string(), joinedAt: v.number() })
    .index('by_code_pid', ['code', 'pid'])
    .index('by_code', ['code']),

  votes: defineTable({ code: v.string(), activity: v.string(), pid: v.string(), choice: v.number() })
    .index('by_code_activity_pid', ['code', 'activity', 'pid'])
    .index('by_code', ['code']),

  cards: defineTable({ code: v.string(), pid: v.string(), at: v.number() })
    .index('by_code_pid', ['code', 'pid'])
    .index('by_code', ['code']),

  profiles: defineTable({ code: v.string(), pid: v.string(), name: v.string(), school: v.string(), email: v.string(), at: v.number() })
    .index('by_code_pid', ['code', 'pid'])
    .index('by_code', ['code']),

  // Running totals, split into shards so simultaneous increments land on
  // different rows. key: "participants" | "profiles" | "cards" | "writes" |
  // "poll:<choice>" | "feature:<choice>". A total is the sum over shards.
  counters: defineTable({ code: v.string(), key: v.string(), shard: v.number(), value: v.number() })
    .index('by_code_key_shard', ['code', 'key', 'shard'])
    .index('by_code', ['code']),

  // Small key/value rows: the live session pointer, presenter tokens, login rate limits.
  meta: defineTable({ key: v.string(), value: v.any() }).index('by_key', ['key']),
});
