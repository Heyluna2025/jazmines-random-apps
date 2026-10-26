# AI challenge landing page

A single-file registration page for a free multi-day live challenge, modelled on the "AI Income Challenge" funnel pages that run on Meta ads. No build step: open `index.html`.

## Structure (top to bottom)

1. Urgency bar with the start date
2. Hero: live-eyebrow, headline, lead, date/time/location row, video placeholder, primary CTA, trust line, countdown
3. "As featured in" logo strip
4. Results stats (placeholders)
5. Day-by-day curriculum (5 cards) + CTA
6. Hosts: main host + special guest co-host
7. "This is for you if…" checklist
8. Testimonials (placeholders)
9. FAQ accordion
10. Final CTA
11. Footer with earnings disclaimer and the Meta non-affiliation notice
12. Sticky mobile CTA + registration modal (first name, email, phone)

## Edit

- Dates, time label, seat line and the form endpoint live in the `CONFIG` object at the top of the script.
- Replace every `[bracketed]` name, the stat figures and the testimonials before running traffic. The placeholders are deliberately not real people's claims.
- The video block is a placeholder `div`; swap it for your Vimeo/YouTube/Wistia embed.
- UTM and click-id parameters from the URL are captured and posted with the form, and saved to `localStorage` for the thank-you page.
- `track()` calls `fbq` if the Meta Pixel is on the page: `InitiateCheckout` on modal open, `Lead` on submit.
