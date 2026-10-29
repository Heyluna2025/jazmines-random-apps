# AI challenge landing page

A single-file registration page rebuilt from the "AI Income Challenge 2026" funnel page on event.monetise.com (captured 2026-10-27). Section order, layout and design tokens follow the original; names, photos, figures and claims are bracketed placeholders. No build step: open `index.html`.

`RESEARCH.md` holds the teardown of the original page, its tracking stack, the ad-link naming convention, and what the Meta Ad Library shows is running.

## Structure (top to bottom)

1. Lime announcement bar with pill CTA
2. Hero: stage photo placeholders, logo lockup, live date pill, challenge headline, proof line, CTA, trust badges
3. Credibility ticker (marquee)
4. "Breaking news" investment card
5. Five-episode blueprint carousel
6. Tracked-results ladder with screenshot placeholders and total card
7. What / When / Where details + CTA
8. Eight "what you'll learn" cards + CTA
9. "Why listen to us" timeline (five entries)
10. "Why is it free?" card
11. Quick recap + CTA
12. Final close: date pill, "Claim Your Spot Below", CTA
13. Footer with Meta notice and earnings disclaimer
14. Sticky mobile CTA + registration modal (first name, email, phone)

## Edit

- Dates, time label, episodes, the "what you'll learn" cards and the form endpoint live in the `CONFIG` object at the top of the script.
- Replace every `[bracketed]` value before running traffic. The results section is a placeholder and should be removed if you have no documented numbers.
- Photo blocks are placeholders. Drop images into the `.person`, `.news .img`, `.shot` and `.tli .art` elements.
- UTM, click-id and country parameters are captured from the URL, posted with the lead, and saved to `localStorage` for the thank-you page.
- `track()` fires Meta Pixel `InitiateCheckout` on modal open and `Lead` on submit, and TikTok `ClickButton` / `SubmitForm` if `ttq` is present.
