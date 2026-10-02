# Your Future Starts Here

Audience participation app for Jazmine de Luna's 30-minute talk **AI and the Future of Work: What It Means for the Next Generation of Business Owners**. High-school students scan one QR code, stay in the same session for the whole talk, and leave with one small project idea saved on their phone.

Three views share one live session:

| View | URL | Who sees it |
| --- | --- | --- |
| Audience | `/a/CODE` (short link `/CODE`) | Students, on their phones |
| Presenter controls | `/presenter` → `/p/CODE` | Jazmine only (password) |
| Projector | `/x/CODE` | The big screen |

Plus the snack-ordering prototype used in the demo: `/demo`.

## Run it locally

```bash
cd your-future-starts-here
npm install
cp .env.example .env     # set PRESENTER_PASSWORD
npm start                # http://localhost:3000
```

Then open `http://localhost:3000/presenter`, sign in, create a session, and open the projector and audience links from the control page. To test from a real phone on the same Wi-Fi, set `PUBLIC_URL=http://<your-laptop-ip>:3000` in `.env` so the QR code points at your laptop instead of `localhost`.

Run the server-side checks with `npm test` (uses Node's built-in test runner, no extra installs).

## Deploy

The app is one Node process with a JSON file for state, so any host that runs Node 18+ works. Three settings matter:

| Variable | What it does |
| --- | --- |
| `PRESENTER_PASSWORD` | Password for the presenter controls. **Required** in production (otherwise a random one is printed to the logs on every restart). |
| `PUBLIC_URL` | Public address of the app, e.g. `https://yourfuture.example.com`. Used for the QR code and short join link. Optional on hosts that send `X-Forwarded-Proto`/`Host` headers (Render, Railway, Fly). |
| `DATA_FILE` | Where sessions are saved (default `./data/sessions.json`). Point it at a persistent disk if your host wipes the filesystem on deploy. |

Quick paths:

- **Render / Railway**: create a Web Service from this folder, build command `npm install`, start command `npm start`, add the variables above. Both support WebSockets out of the box.
- **Docker**: `docker build -t yfsh . && docker run -p 3000:3000 -e PRESENTER_PASSWORD=... yfsh`
- **Fly.io**: `fly launch` in this folder (the Dockerfile is picked up), then `fly secrets set PRESENTER_PASSWORD=...`.

Run a single instance. State lives in memory (saved to `DATA_FILE`), so two instances would not share a room. A single small instance comfortably handles a few hundred phones; see the rehearsal checklist in [docs/PRESENTER_GUIDE.md](docs/PRESENTER_GUIDE.md).

## How it fits together

```
server/
  index.js      Express routes, presenter auth, WebSocket rooms
  sessions.js   Session state, voting rules, "what should phones show now"
  slides.js     The ten slides, three activities, demo branches  ← edit text here
public/
  index.html    Join page (enter a code)
  audience/     Phone view: poll → feature vote → action card
  presenter/    Control page (slides, open/close/reveal, counts, tie-break)
  projector/    Big-screen slides + QR + aggregate results
  demo/         Snack-ordering prototype with three prepared branches
  shared/       LUNA styles, logo, fetch/WebSocket helpers
test/           Server-side acceptance checks
docs/           Presenter setup and rehearsal guide
```

- The server decides what the audience sees (`focus` in `sessions.js`): the open activity wins, closed activities stay visible on their slides, and everything else shows the waiting screen. Advancing a slide never deletes responses.
- Phones get an anonymous participant id stored in `localStorage`. Reloading restores the current activity and the student's earlier answers. One id can hold one vote per activity; the latest answer replaces the previous one.
- Action-card text never leaves the phone. Only a deduplicated "card completed" event reaches the server, so the projector can show a count.
- Results are hidden from the room until the presenter reveals them; the presenter page always sees live counts.
- Every state change is pushed over WebSocket to the room, coalesced to at most ~5 pushes per second per session so vote bursts stay cheap.

## Editing content

- Slide titles, lines and presenter hints: `server/slides.js` (`SLIDES`).
- Poll choices, feature choices, card prompts and examples: `server/slides.js` (`ACTIVITIES`).
- Snack names, prices, stock and the three rehearsed changes: `public/demo/demo.js`.
- Colours: CSS variables at the top of `public/shared/base.css` (deep violet, lavender, white; no green).
- Logo: `public/shared/logo.js` draws the AI Empowered Club mark as inline SVG so it inherits the text colour (white on violet, violet on the lavender card). It is a hand-drawn recreation of the logo; to use the original artwork, replace the `MARK_PATH`/`MARK_DOT` shapes there or swap the `markSvg()` output for your SVG's paths. The card image export (`public/audience/card.js`) reuses the same shapes.
- Fonts: Nunito (UI) and Bebas Neue (logo wordmark) are self-hosted in `public/shared/fonts/` (SIL Open Font License), so nothing depends on reaching Google Fonts from the venue.

## Using the projector beside an external deck

If the talk runs from Canva or PowerPoint, open `/x/CODE?mode=activity` on a second window or display. It hides the slide text and shows only the QR code, live counts, results and the winning feature — whatever the phones are currently on. Nothing synchronises with the external deck automatically; the presenter page still opens and closes activities.
