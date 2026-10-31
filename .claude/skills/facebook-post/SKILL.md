---
name: facebook-post
description: Draft, design, schedule and publish organic posts to the AI Empowered Club Facebook Page, one at a time or a whole content plan. Use when someone asks to post, schedule or queue something on Facebook or "the Page", turn a content plan into Facebook posts, make a post graphic, check what is scheduled, or delete a Page post.
---

# Facebook Page posting

Posts go to the **AI Empowered Club** Page (ID `1231207646740791`) through `fb-page-poster/` in this repo. These are organic posts, not ads. Read `fb-page-poster/README.md` for every command and flag.

## Ground rules

- **Nothing goes public without an explicit yes.** Before publishing, scheduling or deleting, show the exact caption, the graphic and the time, and wait for approval. A yes covers only what was shown.
- **Prefer scheduling over posting now.** A scheduled post can still be edited or deleted in Meta Business Suite (Planner) before it goes out.
- **Times are Philippine time (UTC+08:00)** unless told otherwise. Always write `--at` / `"at"` with the offset, e.g. `2026-11-03T10:00+08:00`. Facebook needs at least 10 minutes of lead and limits how far ahead a post can be scheduled (about a month); send longer plans in monthly batches.
- **Never print, echo or log `FB_PAGE_ACCESS_TOKEN`**, and never commit `.env`.

## 1. Check the setup

```bash
node fb-page-poster/post.js check
```

`OK: token posts as "AI Empowered Club"` means ready. Otherwise:
- `FB_PAGE_ACCESS_TOKEN is not set` → the person adds it to the cloud environment's settings (environment menu → Edit → environment variables) and starts a new session. The README has the token steps.
- `fetch failed` / `ENOTFOUND` → `graph.facebook.com` is missing from the environment's Network access → Allowed domains.
- `expired or invalid` → the token was revoked; make a new one (README).

## 2. Draft the post

Write captions in the club's voice: warm, practical, plain language, aimed at small business owners learning to use AI. Keep most captions under ~120 words, lead with the hook, end with one clear call to action, and use at most a couple of emoji and 3 hashtags. Don't invent facts, prices, dates or links; ask for them.

## 3. Make the graphic

Use the person's own image when they give one (local file or public URL). Otherwise render one:

```bash
node fb-page-poster/make-graphic.js --tag "New this week" --title "Plan a month of content in *20 minutes*" --subtitle "A free walkthrough for small business owners" --theme dark --out fb-page-poster/graphics/2026-11-03-content-plan.png
```

`*word*` colours a word with the accent; `\n` breaks a line; `--theme` is `dark` or `light`. Keep titles short (under ~8 words). **Open the PNG and look at it** before showing it: check for overflowing or awkward line breaks and re-render if needed. Name files `YYYY-MM-DD-short-slug.png` in `fb-page-poster/graphics/`.

## 4a. One post

Show the preview, get the yes, then:

```bash
node fb-page-poster/post.js "Caption text" --image fb-page-poster/graphics/FILE.png --at 2026-11-03T10:00+08:00
```

Drop `--at` to publish immediately. `--link URL` adds a link (put it in the caption for photo posts; the tool does this automatically).

## 4b. A content plan

1. Turn the plan into `fb-page-poster/posts.json`, appending to what's already there. Each entry: `text`, optional `image` (a URL, or a path relative to `fb-page-poster/`, e.g. `graphics/2026-11-03-content-plan.png`), optional `link`, and `at`. Don't touch entries that already have `facebook_id`.
2. Make the graphics.
3. Show the person a review table (date and time in PH, caption, graphic) and get approval. Edit and re-show until they approve.
4. Preview, then send:
   ```bash
   node fb-page-poster/post.js queue fb-page-poster/posts.json --dry-run
   ```
   ```bash
   node fb-page-poster/post.js queue fb-page-poster/posts.json
   ```
   Entries already carrying `facebook_id` are skipped, so re-running is safe.

## 5. Confirm and save

- Verify each post with `node fb-page-poster/post.js show POST_ID` and report the date and time in PH and the permalink.
- Commit `fb-page-poster/posts.json` and new files in `fb-page-poster/graphics/`, then push, so the next session knows what has gone out. Cloud sessions start from a fresh clone; anything uncommitted is lost.

## Fixing mistakes

- Delete a post (after the person confirms which one): `node fb-page-poster/post.js delete POST_ID`, then remove its `facebook_id` from `posts.json` only if it should be sent again.
- To change a scheduled post's text or time: delete it and send a corrected one, or the person edits it in Meta Business Suite → Planner.
