# FB Page Poster

Posts to the **AI Empowered Club** Facebook Page (or any Page you admin), and to the Instagram professional account linked to it, from the command line, either right away or scheduled. Scheduled posts are handed to Facebook's own scheduler, so nothing has to stay running. A JSON queue file lets you line up a whole content plan and send it in one go.

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

```bash
node post.js show POST_ID
```

```bash
node post.js delete POST_ID
```

| Flag | What it does |
| --- | --- |
| `--link URL` | Adds a link (shows a preview card on text posts; added to the caption on photo posts) |
| `--image FILE\|URL` | Posts a photo from a local file or a public URL. Repeat it for a multi-photo (carousel) post; photos keep their order |
| `--at TIME` | Schedules the post. Must include a timezone (`-05:00`, `+08:00` or `Z`) and be at least 10 minutes away |
| `--platform LIST` | `facebook` (default), `instagram`, or `facebook,instagram` |
| `--dry-run` | Shows what would be sent without calling Facebook |

`check` confirms the token works and belongs to the Page, not to your personal profile. `show` reports whether a post is live or scheduled and its link; `delete` removes it.

Behind a proxy (such as a Claude cloud environment, where `HTTPS_PROXY` is set) the script restarts itself once with `NODE_USE_ENV_PROXY=1`, because Node's built-in fetch ignores the proxy otherwise.

## Instagram

Instagram posts need at least one image (up to 10 for a carousel); links in captions aren't clickable there. Instagram's API publishes immediately and has **no scheduler**, so:

- From the command line, `--platform instagram` posts now (with `--at` it refuses).
- In the queue, give the entry `"platforms": ["facebook", "instagram"]` and an `at` time. Facebook gets it scheduled straight away; the Instagram copy waits in the queue and is published by the first `queue` run at or after its time. Run the queue on a schedule (for example an hourly scheduled task) for hands-off Instagram posting.

Instagram fetches images from a public URL and only accepts JPEG, so local files are first uploaded to the Page as unpublished photos (they don't appear on the Page) and Instagram is given Facebook's hosted JPEG. `show POST_ID --platform instagram` shows a published Instagram post; delete Instagram posts in the Instagram app.

Requirements: the Instagram account is a Professional (Business or Creator) account linked to the Page, and the token includes `instagram_basic` and `instagram_content_publish`. `check` reports whether Instagram is ready.

## Graphics

```bash
node make-graphic.js --tag "New this week" --title "Plan a month of content in *20 minutes*" --subtitle "A free walkthrough" --theme dark --out graphics/post.png
```

Renders a 1080×1080 PNG in the club's purple style. `*word*` colours a word with the accent, `\n` breaks a line, and `--theme` is `dark` or `light`. Needs Playwright with Chromium (preinstalled in Claude cloud environments).

## Carousels and platform previews

```bash
node make-carousel.js content/week1/abc-intro.json --out graphics/week1/2026-11-10-abc-intro --sheet
```

```bash
node preview-platforms.js content/week1/abc-intro.json graphics/week1/2026-11-10-abc-intro
```

`make-carousel.js` renders 1080×1350 (4:5) slides from a JSON spec: the largest portrait size both Facebook and Instagram show in full. `"brand": "aec"` gives AI Empowered Club styling; the default is AI Builder's Camp. Logos and people photos live in `brand/`. `*word*` gets the accent colour and `[[note]]` renders a dashed TO CONFIRM box, so unfinished copy can't be mistaken for approved copy.

`preview-platforms.js` mocks up the Instagram feed (phone size, caption cut at "more") and profile grid (3:4 crop), the Facebook feed collage (approximate; Facebook picks the layout) and the tapped-open view, plus a crop check of every slide against the 3:4 and 1:1 crops. Review these before posting. Design rules that came out of them: keep cover text in the middle ~820px (Facebook's collage and Instagram's grid crop the sides), and keep text at 26px or larger so it stays readable at phone size.

## Claude skill

`.claude/skills/facebook-post/` at the repo root teaches Claude Code the whole routine: draft, make the graphic, show a preview, wait for approval, post or schedule, confirm, and commit the queue. In a Claude Code session on this repo, just ask, e.g. *"schedule this week's posts from our content plan"*.

## Queue file

Copy `posts.example.json` to `posts.json` and fill it in. Commit `posts.json` and `graphics/` after sending, so the next session knows what has already gone out. Each entry takes `text`, and optionally `link`, `image` (or `images`, a list, for a carousel) and `at`. Running `node post.js queue posts.json` sends every entry that hasn't gone out yet and writes the Facebook post id back into the file as `facebook_id`, so running it twice never double-posts. Entries with `at` land in the Page's scheduled posts in Meta Business Suite, where you can still edit or delete them.

## Settings

Copy `.env.example` to `.env`, or set these as environment variables (in a Claude cloud environment: environment settings → Edit → environment variables):

| Variable | Value |
| --- | --- |
| `FB_PAGE_ID` | `1231207646740791` (AI Empowered Club) |
| `FB_PAGE_ACCESS_TOKEN` | A Page access token with `pages_manage_posts` (see below) |
| `IG_USER_ID` | Optional. The linked Instagram account is found automatically from the Page |
| `FB_GRAPH_VERSION` | Optional, defaults to `v23.0` |

In a Claude cloud environment, also add `graph.facebook.com` under **Network access → Allowed domains**, or every call fails with `fetch failed`.

## Getting a Page access token

You need to be an admin of the Page. About 10 minutes.

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create app**. Pick the use case **Manage everything on your Page** (or *Other → Business*). The app can stay in Development mode; it only posts to Pages you admin.
2. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer/). Choose your app top right, then **Get User Access Token** and tick `pages_show_list`, `pages_read_engagement` and `pages_manage_posts`, plus `instagram_basic` and `instagram_content_publish` for Instagram. If a permission is missing from the list, add the **Manage everything on your Page** (and, for Instagram, **Manage messaging & content on Instagram**) use case to the app first. Click **Generate Access Token** and allow access to AI Empowered Club.
3. Copy that token into the [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/) and click **Extend Access Token** at the bottom. Copy the long-lived token it gives you.
4. Back in the Graph API Explorer, paste the long-lived token into the token box and run `me/accounts`. Copy the `access_token` next to **AI Empowered Club**. A Page token made from a long-lived user token does not expire: paste it into the Access Token Debugger and check that **Expires** says **Never**. If it shows a time, it was made from the short-lived token; repeat with the extended one.
5. Save it as `FB_PAGE_ACCESS_TOKEN` and run `node post.js check`.

Even a never-expiring Page token loses **data access** about 90 days after the user token it came from was authorised (the Access Token Debugger shows the date as *Data Access Expires*). Before that date, repeat these steps to make a fresh token. The current token's data access ends **8 Feb 2027**.

If the login pop-up shows *Invalid Scopes: pages_read_user_content*, add that permission (read-only) to the app's **Manage everything on your Page** use case and try again. Permissions shown in green in the Explorer are requested but not yet granted; they turn black once you click **Generate Access Token** and approve them, including ticking the Instagram account.

Treat the token like a password: it can post as the Page. Keep it out of the repo and out of chat. If it leaks, change your Facebook password or remove the app, which revokes it.

## Tests

```bash
npm test
```

The tests use a fake `fetch` and never contact Facebook.
