# FB Page Poster

Posts to the **AI Empowered Club** Facebook Page (or any Page you admin) from the command line, either right away or scheduled. Scheduled posts are handed to Facebook's own scheduler, so nothing has to stay running. A JSON queue file lets you line up a whole content plan and send it in one go.

No dependencies: Node 20.12 or newer.

## Commands

```bash
node post.js check
```

```bash
node post.js "Hello from AI Empowered Club" --link https://example.com
```

```bash
node post.js "Workshop photos" --image ./photo.jpg --at 2026-11-03T10:00-05:00
```

```bash
node post.js queue posts.json
```

| Flag | What it does |
| --- | --- |
| `--link URL` | Adds a link (shows a preview card on text posts; added to the caption on photo posts) |
| `--image FILE\|URL` | Posts a photo from a local file or a public URL |
| `--at TIME` | Schedules the post. Must include a timezone (`-05:00`, `+08:00` or `Z`) and be at least 10 minutes away |
| `--dry-run` | Shows what would be sent without calling Facebook |

`check` confirms the token works and belongs to the Page, not to your personal profile.

## Queue file

Copy `posts.example.json` to `posts.json` (git-ignored) and fill it in. Each entry takes `text`, and optionally `link`, `image` and `at`. Running `node post.js queue posts.json` sends every entry that hasn't gone out yet and writes the Facebook post id back into the file as `facebook_id`, so running it twice never double-posts. Entries with `at` land in the Page's scheduled posts in Meta Business Suite, where you can still edit or delete them.

## Settings

Copy `.env.example` to `.env`, or set these as environment variables (in a Claude cloud environment: environment settings → Edit → environment variables):

| Variable | Value |
| --- | --- |
| `FB_PAGE_ID` | `1231207646740791` (AI Empowered Club) |
| `FB_PAGE_ACCESS_TOKEN` | A Page access token with `pages_manage_posts` (see below) |
| `FB_GRAPH_VERSION` | Optional, defaults to `v23.0` |

In a Claude cloud environment, also add `graph.facebook.com` under **Network access → Allowed domains**, or every call fails with `fetch failed`.

## Getting a Page access token

You need to be an admin of the Page. About 10 minutes.

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create app**. Pick the use case **Manage everything on your Page** (or *Other → Business*). The app can stay in Development mode; it only posts to Pages you admin.
2. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer/). Choose your app top right, then **Get User Access Token** and tick `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`. Click **Generate Access Token** and allow access to AI Empowered Club.
3. Copy that token into the [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/) and click **Extend Access Token** at the bottom. Copy the long-lived token it gives you.
4. Back in the Graph API Explorer, paste the long-lived token into the token box and run `me/accounts`. Copy the `access_token` next to **AI Empowered Club**. A Page token made from a long-lived user token does not expire.
5. Save it as `FB_PAGE_ACCESS_TOKEN` and run `node post.js check`.

Treat the token like a password: it can post as the Page. Keep it out of the repo and out of chat. If it leaks, change your Facebook password or remove the app, which revokes it.

## Tests

```bash
npm test
```

The tests use a fake `fetch` and never contact Facebook.
