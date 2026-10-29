# Teardown: AI Income Challenge registration page + the ads behind it

Captured 2026-10-27 from `event.monetise.com/mark-tilbury/lp-1` (desktop 1280px render, full text, computed styles) and the Meta Ad Library. Figures and claims below are theirs as shown on the page; nothing here has been verified.

## What the page is

A free 5-day live "challenge" registration page for the "AI Income Challenge 2026", co-hosted by Iman Gadzhi (page owner, Consulting.com) with Mark Tilbury as guest. Dates on the page: Nov 7 to Nov 15, 1 PM Eastern, roughly one hour per session, replays within 24 hours. Built in Framer. Single conversion action: every button is the same "SAVE MY FREE SPOT" and there is no inline form, so the modal/opt-in loads on click.

## Section order (top to bottom)

1. Lime announcement bar: reason-for-the-event line on the left, black pill CTA on the right.
2. Hero: stage photo of both hosts under lime spotlights, partner-logo lockup, red-dot "LIVE VIRTUAL EVENT" date pill, H1 challenge headline, one-line proof sub, CTA, two trust badges ("No showing your face", "No experience needed").
3. Scrolling ticker of the partner company's credibility claims (valuation, run rate, "fastest-growing", etc.).
4. "Breaking news" card: press photo of the host's investment announcement next to a "here's what that means for you" explainer.
5. "Your 5-Day AI Income Blueprint": five horizontally scrolling episode cards. Each has a script-font "Episode", a giant lime number, title, date, time, three icon bullets.
6. Tracked-results section: four event-by-event figures ($8.9M, $15M, $31M, $41M) each with a leaderboard screenshot, then a $155M total card.
7. "All the details": What / When / Where in three cards, CTA.
8. "What you'll learn for free in 5 days": eight image cards with lime titles (two rows of three plus two).
9. "Why should you listen to us?": vertical timeline, alternating image and text, five entries (guest bio, host bio, past-event results, the AI-company investment, "joining forces").
10. "If this works, why is it free?": the revenue-share explanation (host co-owns the marketplace platform; takes a cut of every sale).
11. "Quick recap": What / When / Where again, CTA.
12. Final close: date pill, "Claim Your Spot Below", CTA, trust badges.
13. Footer: Privacy, Terms, Meta non-affiliation notice, © Consulting.com.

The CTA appears seven times. There is no countdown, no testimonials section, no FAQ. Proof is carried by screenshots of earnings leaderboards and the hosts' bios, not customer quotes.

## Design tokens (from computed styles)

| Token | Value |
| --- | --- |
| Background | `rgb(5,7,12)` near-black |
| Accent | `rgb(208,254,22)` lime, used for CTAs, numbers, highlighted words, card titles |
| Body font | Inter (Inter Display for the H1) |
| Display font | "GC EPICPRO Extra Bold", a wide extended face, for section headings, episode numbers (180px) and What/When/Where labels |
| Script font | "Mounsta" for the word "Episode" |
| H1 | 36px, white, lime on the money and day figures |
| Section H3 | 32px display, uppercase |
| CTA | lime pill, black text, uppercase, bolt icon, outer glow |

The clone substitutes Unbounded for the display font and Caveat for the script, both from Google Fonts.

## Copy formulas worth keeping

- Headline: "We Challenge YOU To Build A [$/day] [thing] In Just 5 Days". The dollar-per-day figure is the hook and is repeated in the ads' link title.
- Reason-why bar: "To celebrate [event], we're hosting a 5-Day Challenge". Gives the free offer a cause.
- Episode bullets are outcome-first ("Walk away knowing exactly what to build…"), three per day, each tied to a fear (no audience, no experience, no time).
- Results ladder: four growing numbers in sequence, then the total. The growth story is the proof, not any single figure.
- "Why is it free?" is answered with an incentive alignment, not generosity.

## Tracking stack on the page

Meta Pixel, TikTok Pixel, Google Ads conversion tags (seven conversion IDs on one page), GA4, Google Tag Manager, Microsoft Clarity, and an Axon pixel. The cold-traffic landing page is wired for every channel they buy on.

## URL naming convention (decoded from the ad link)

`utm_campaign=[012][AIC][LC][EDU04][COLD][PUR][CREATIVE_TESTING][CLIENT][M+I][CBO][WORLDWIDE]`

Reading: campaign 012, AI Income Challenge, LC (likely "lead campaign" or "launch"), EDU04 (angle or education variant 4), COLD audience, PUR (purchase-optimised, which for a free event means they optimise toward the backend sale, inference), creative-testing campaign, CLIENT-produced creative, M+I (Mark + Iman creative), CBO, worldwide.

`utm_content=AIC_LC_AD327_H1_MI_MISHAALCLIPBOARD_M3_CLIENT_9x16`

Ad number 327, hook 1, Mark+Iman, "Mishaal clipboard" concept (Mishaal is likely the creator or editor), variant M3, 9:16 vertical. Ad #327 in a campaign that launched days earlier tells you the creative volume.

`utm_term=[AIC][LC][18-65][BROAD][MISHAAL][M+I][PUR][WORLDWIDE]`: broad 18-65 targeting, no interest layer.

Placement in the link: Facebook Mobile Feed.

## Ads running (Meta Ad Library, US, pulled 2026-10-27)

Advertiser page: **Iman Gadzhi** (page id 103237888271515). The library estimates about 14,700 ads from this page in total, all time.

| Search | Est. active ads (US) |
| --- | --- |
| "AI Income Challenge Mark Tilbury" | 1,202 |
| "event.monetise.com" | 1,444 |

Two creative batches for this launch, identified by their link titles:

| Batch (link title) | First seen | Status on 2026-10-27 |
| --- | --- | --- |
| "Iman Gadzhi x Mark Tilbury, LIVE" | 2026-10-23 | Inactive (rotated out after about 3 days) |
| "I Challenge YOU (New AI Breakthrough)" | 2026-10-26 | Active, still being added hour by hour |

Every result in the 50 most recent is a variant of the same link title, so the spend concentrates on one angle at a time. The "x Mark Tilbury, LIVE" headline leaned on the guest's name; the replacement leans on the challenge framing and the "new AI breakthrough" curiosity hook, matching the page's H1.

Sample snapshot URLs to inspect the creatives directly:

- https://www.facebook.com/ads/library/?id=1174017924950496 (newest active)
- https://www.facebook.com/ads/library/?id=1380514437225390
- https://www.facebook.com/ads/library/?id=2981674058841967
- https://www.facebook.com/ads/library/?id=1440652334179820 (earlier "x Mark Tilbury, LIVE" batch)

What the API did not return: primary text, media, spend or reach. The Ad Library only exposes those for political ads, so the creative bodies have to be viewed through the snapshot links.

## What this tells you

- Volume over polish. Hundreds of near-identical ads per batch, numbered creative, one link title per batch. They test hooks at the ad level and swap the whole batch when a headline wins.
- The page and the ads share one promise: a dollar-per-day figure plus "5 days". Any clone of the page has to be fed by ads that make the same promise or the scroll depth drops.
- The free event is a front end. The "why free" section and the PUR tag both point at a paid backend on the marketplace platform. Measure the clone against cost per registrant and show-up rate, not cost per lead alone.
