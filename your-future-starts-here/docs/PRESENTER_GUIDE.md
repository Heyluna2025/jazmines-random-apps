# Presenter guide

Everything you need to set up, rehearse and run the participation app during the talk.

## Before the event

1. **Deploy the app** (see the README). No password is needed: `https://yourfuturestartshere.xyz/presenter` opens the controls directly.
2. **Open `/presenter`.** It lands on the live session (one is created automatically the first time). `← Sessions` lists all sessions; make a separate *Rehearsal* one if you like, then tap **Point the printed QR here** on whichever session should receive phones. The printed QR and the bare domain always open that session (or the newest open one).
3. **Open the projector view** for the session on the laptop that will drive the screen: `Open projector view ↗` from the control page. Press F11 (or ⌃⌘F on a Mac) for full screen.
4. **Test the QR code from a phone** — use mobile data, not the venue Wi-Fi — and confirm it opens the audience page. Typing `yourfuturestartshere.xyz` does the same; the 4-letter code on the big screen is only a fallback for `/enter`.
5. **Rehearse with at least three devices**: your laptop (projector), your phone (presenter controls), and two other phones as students. Run the whole sequence below once, then press *Reset all responses…* or use a fresh session on the day.
6. **Open the three demo branches** once each (`/demo?branch=quantities`, `/demo?branch=total`, `/demo?branch=soldout`) so you know the "Apply the AI-assisted change" and "Sneak in a mistake" toggles.
7. **Save screenshots** of the projector views and the three demo branches (before/after) as the offline fallback.

## Run of show

The control page shows the current slide, a hint for each one, and the three activities. The projector follows the slide; phones follow whichever activity is open.

| Slide | Say / do on stage | Tap on the control page | Phones show |
| --- | --- | --- | --- |
| 1 · What would you love to become? | Point at the QR code and the short link. Give it two minutes. | Nothing — the poll is already open when a session starts. | The five choices → "You're in!" after tapping Submit. |
| 2 · Meet your future self | Talk through the result. | **Close poll**, then **Reveal results**. | "Poll closed, look at the big screen". |
| 3–5 | Story · What is AI · One business has many jobs | **Next** only. | Waiting screen with the slide title. |
| 6 · Let's build something | Introduce the snack app, ask for votes. | **Open voting** → after ~30 s **Close voting** → **Reveal winner**. If it's a tie, pick one of the leaders (buttons appear). | The three features → "Vote counted!" → the winning feature. |
| 6 (continued) | Demonstrate the winning branch. | Click **open this demo branch ↗** next to the winner. Show version 1, then tick *Apply the AI-assisted change*. | The winning feature stays on screen. |
| 7 · Would you trust this? | Ask the room to check the result. Optionally tick *Sneak in a mistake* first. | **Next** only. | Winning feature still visible. |
| 8 · Ask clearly. Check carefully. Finish something useful. | | **Next** only. | Waiting screen. |
| 9 · Your first small project | Read the prompt and the examples aloud. | **Open form**. | The three fields → their finished card. |
| 10 · What will you make possible? | Watch the completed-card count climb. Ask them to save the card. | Nothing — or **Close form** if you want no new cards. | Their saved card with *Save card as image*. |
| After | | **End session (students keep their cards)**. | Their card stays available on their phone. |

Tips:

- On a phone, the bar at the bottom of the control page has Previous/Next and the one action you most likely need next on the current slide (Open poll, Close voting, Reveal winner…).
- Arrow keys change slides on the control page and on the projector (the audience page never does).
- Anyone who knows the `/presenter` address can use the controls. If that worries you, set `PRESENTER_PASSWORD` in Vercel and the page asks for it.
- Going back a slide never deletes answers. Reopening a closed activity lets students change their answer again.
- *Hide results* / *Hide winner* takes a reveal back if you tapped too early.
- Phones and the big screen pick up changes within about 2–3 seconds. Give a reveal a beat before you talk about it.
- "Phones joined" counts everyone who opened the link, including rehearsal devices.

## The snack demo

`/demo` is a fictional ordering screen for a school fair: Banana Cue, Turon, Kwek-Kwek, Puto, Buko Juice, Fishball with made-up prices and stock. The *Place demo order* button only shows a "this is a demonstration" message; nothing is ordered or paid.

Each branch has three states controlled by the bar at the top:

| Branch | Version 1 | AI-assisted change (rehearsed) | Sneaky mistake |
| --- | --- | --- | --- |
| Choose snacks and quantities | + / − per snack | A "Your order" list and a Clear button | − goes below zero |
| See the total price | Running total | Line totals (qty × price) and a big peso total | Total ignores quantities |
| See which snacks are sold out | Sold-out items disabled | "Only N left" warnings; + stops at stock | Sold-out items can be added |

The side panel shows the prompt you "asked" for the change and the three checks for slide 7. Add `?bar=0` to the URL to hide the controls bar while screen-sharing.

## If the Wi-Fi fails

- **Poll**: ask for raised hands per choice and count out loud.
- **Feature vote**: raised hands again; demonstrate from the saved screenshots if the demo page won't load.
- **Action card**: ask students to write "I want to help ______ do ______ more easily", who they could help, and their first step in their phone's Notes app.
- Phones that lose connection show *Reconnecting…* and pick up the current activity automatically once they're back. Unfinished card text is kept on the phone.

## Privacy, in one paragraph

Students never enter a name, email, school ID, photo or phone number. Each phone gets a random anonymous id. Votes are stored against that id (the latest vote replaces the earlier one), and the id prevents the same phone from being counted twice — it doesn't guarantee one vote per person. Action-card text is saved only on the student's phone; the server receives a single "completed" event per phone so the projector can show a count.
