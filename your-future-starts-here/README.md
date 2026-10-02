# Your Future Starts Here

Mobile web app for audience participation during Jazmine de Luna's 30-minute talk **AI and the Future of Work: What It Means for the Next Generation of Business Owners**. Students scan one QR code on their phones, stay in the same session for the whole talk, and leave with one small project idea saved on their phone.

It works with zero setup: the bare domain drops students straight into the live session (one is created on the first visit), and `/presenter` opens that session's controls — no password, no codes to type. Three screens share one live session, and every one of them works on a phone:

| Screen | URL | Who uses it |
| --- | --- | --- |
| Audience | `/` (also `/join`, `/a/CODE`, short link `/CODE`) | Students, on their phones |
| Presenter controls | `/c/<secret>` (see `PRESENTER_PATH`; `/presenter` answers 404) | Jazmine, from her phone or laptop |
| Big screen | `/x/CODE` | The projector; `?mode=activity` shows only the live panel |

Plus the snack-ordering prototype used in the demo (`/demo`) and a typed-code fallback page (`/enter`).

## Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import **Heyluna2025/jazmines-random-apps**.
2. Under **Root Directory** click *Edit* and choose `your-future-starts-here`. Leave the framework as *Other*; no build command and no environment variables are needed.
3. Click **Deploy**. Open the URL Vercel gives you: `/presenter` is the control page; the bare URL is what students open.
4. **Custom domain**: Settings → Domains → add `yourfuturestartshere.xyz` and set the DNS records Vercel shows at your registrar (an `A` record to `76.76.21.21`, and `www` as a `CNAME` to `cname.vercel-dns.com`). Then add `PUBLIC_URL=https://yourfuturestartshere.xyz` under Environment Variables so the in-app QR codes always use the domain, and redeploy.
5. **Before a real audience, add shared storage**: Storage → Create Database → Upstash (Redis), free plan, connect it to the project, then Deployments → ⋯ → Redeploy. Vercel injects `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatically and the app switches to Redis on its own. Without it each serverless instance keeps sessions in its own memory, so with many phones a session can look "not found" or lose votes; the presenter page shows a yellow warning until Redis is connected.

Optional: set `PRESENTER_PASSWORD` to require a sign-in on the control page. Leave it unset and the controls are open to anyone who knows the `/presenter` URL.

How it runs on Vercel: pages and assets come from the CDN, `/`, `/join` and `/api/*` go to one serverless function (`api/index.js`), phones poll a state endpoint that the edge caches for one second, and state lives in Upstash Redis. Live updates land on phones within about 2–3 seconds.

## Sign-up list

Students enter name, school and email after the welcome letter. The list is kept in the store (Redis on Vercel) until the session is deleted — it is exempt from the 60-day expiry the rest of a session has — and the controls page has a **Download list (CSV)** button. Public endpoints only ever expose the count.

## Printed QR code

`docs/qr/` holds a ready-to-paste QR for `https://yourfuturestartshere.xyz`: `join-qr.png` (2048 px) and `join-qr.svg` plain, plus branded light and dark tiles (`join-card-light.png`, `join-card-dark.png`). The domain always opens the session marked live on the presenter page (or the newest open one), so the same QR works for every talk. Regenerate for another address with:

```bash
node scripts/make-qr.js https://your-domain.example docs/qr
```

## Run it locally

```bash
cd your-future-starts-here
npm install
cp .env.example .env     # set PRESENTER_PASSWORD
npm start                # http://localhost:3000
```

Locally the app keeps state in memory and mirrors it to `data/sessions.json`. To test from a real phone on the same Wi-Fi, set `PUBLIC_URL=http://<your-laptop-ip>:3000` in `.env` so the QR code points at your laptop.

`npm test` runs the acceptance checks against both stores (the Redis one through a small fake Upstash server), no extra installs.

## Other hosts

Any host that runs Node 18+ works (Render, Railway, Fly, Docker — a `Dockerfile` is included). Settings:

| Variable | What it does |
| --- | --- |
| `PRESENTER_PATH` | The secret part of the controls address, `/c/<PRESENTER_PATH>`. A default is baked in; set your own in production and keep it private. |
| `PRESENTER_PASSWORD` | Optional. When set, the controls additionally require this password. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis REST credentials (`UPSTASH_REDIS_REST_URL`/`_TOKEN` also work). Optional on a single long-lived server; required on serverless hosts. |
| `PUBLIC_URL` | Public address of the app, for the QR code. Optional when the host sends `X-Forwarded-Proto`/`Host`. |
| `DATA_FILE` | Where the in-memory store mirrors sessions (default `./data/sessions.json`). |

## How it fits together

```
api/index.js           Vercel entry: the Express app as one function
vercel.json            Page rewrites (/a/CODE, /x/CODE, /p/CODE, /CODE) and the API route
server/
  app.js               Express routes, presenter auth, cache headers
  sessions.js          Pure session logic: codes, patches, tallies, what each view may see
  store-memory.js      In-process store (local runs, tests)
  store-redis.js       Upstash Redis store (Vercel)
  store.js             Picks a store from the environment
  slides.js            The ten slides, three activities, demo branches  ← edit text here
  index.js             Long-lived Node server for local runs and classic hosts
scripts/make-qr.js     Generates the printed QR assets in docs/qr
public/
  enter.html           Typed-code fallback page
  audience/            Phone view: poll → feature vote → action card (+ image export)
  presenter/           Controls: slides, open/close/reveal, counts, tie-break, quick bar on phones
  projector/           Big-screen view: slides, QR, revealed results, completion count
  demo/                Snack-ordering prototype with three prepared branches
  shared/              LUNA styles, logo, fonts, fetch/poll helpers
test/                  Acceptance checks for both stores
docs/                  Presenter setup and rehearsal guide
```

- The server decides what the audience sees (`computeFocus` in `sessions.js`): the open activity wins, closed activities stay visible on their slides, everything else shows the waiting screen. Changing slides never deletes responses.
- Phones get an anonymous participant id in `localStorage`. Reloading restores the current activity and earlier answers. One id holds one vote per activity; the latest answer replaces the previous one.
- Action-card text never leaves the phone. Only a deduplicated "card completed" event reaches the server, so the big screen can show a count.
- Results stay hidden from the room until the presenter reveals them; the presenter page always sees live counts.
- Every change bumps a session `version`; clients poll (phones every 2 s, projector and presenter every 1.5 s) and re-render only when the version moves forward.

## Editing content

- Slide titles, lines and presenter hints: `server/slides.js` (`SLIDES`).
- Poll choices, feature choices, card prompts and examples: `server/slides.js` (`ACTIVITIES`).
- Snack names, prices, stock and the three rehearsed changes: `public/demo/demo.js`.
- The follow-Jazmine invitation at the end (handles and links for Instagram, Facebook, TikTok): `server/slides.js` (`SOCIAL`).
- Colours: CSS variables at the top of `public/shared/base.css` (deep violet, lavender, white; no green).
- Logo: `public/shared/logo.js` draws the AI Empowered Club mark as inline SVG so it inherits the text colour (white on violet, violet on the lavender card). It is a hand-drawn recreation; to use the original artwork, replace the `MARK_PATH`/`MARK_DOT` shapes or swap the `markSvg()` output for your SVG's paths. The card image export (`public/audience/card.js`) reuses the same shapes.
- Fonts: Nunito (UI) and Bebas Neue (logo wordmark) are self-hosted in `public/shared/fonts/` (SIL Open Font License), so nothing depends on reaching Google Fonts from the venue.

## Using the big screen beside an external deck

If the talk runs from Canva or PowerPoint, open `/x/CODE?mode=activity` on a second window or display. It hides the slide text and shows only the QR code, live counts, results and the winning feature. Nothing synchronises with the external deck automatically; the presenter page still opens and closes activities.
