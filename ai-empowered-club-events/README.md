# AI Empowered Club Events

One-page schedule of the club's in-person events (Nov–Dec 2026), in the AI Empowered Club brand: violet and lavender, the "A" logo mark, Bebas Neue and Nunito.

- `index.html`: the standalone page. Deploy the folder as a static site (Vercel: Root Directory `ai-empowered-club-events`, framework *Other*).
- `page.html`: the same page without the `<html>`/`<head>` wrapper, used for the claude.ai artifact. Edit this one, then rebuild `index.html`:

```bash
{ printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n'; cat page.html; printf '\n</body>\n</html>\n'; } > index.html
```

To change an event, edit the `EVENTS` list near the bottom of `page.html`. Times are Philippine Time and weekdays are computed from the dates. Each event gets Add to calendar (Google Calendar), Directions (Google Maps) and Copy details (text for a group chat). Past events fade and the next one is highlighted automatically.
