# Grayrender

**An AI marketing audit that renders the page before it judges it.**

Built by Edmund Gray. Twelve tools, a workspace and a live meeting copilot, one flagship: a full-site marketing audit
that drives a real headless browser over every key page, measures the layout, looks at a
screenshot, and only then writes the report. Everything runs behind Netlify serverless
functions, so API keys never reach the browser.

**The sidebar is a plan, not a menu.** The tools are ordered into a six step marketing
program, numbered and ticked off from real state: audit the site and ship what it finds,
lock the voice, know the competition, build the campaign, put it on dates, measure it.
Step one deliberately does not complete when the report arrives, only when the critical
fixes are shipped. The step you are on is filed as dated work, so the program itself lands
in your calendar, and "Write the full strategy" turns everything done so far into a phased
ninety day plan that is told exactly which steps are finished and which are not.

**Meeting Mode** (owner only, in private testing) listens to a live meeting through the
browser's own speech recognition, with no key to paste and nothing to leak, and answers from
the positioning, audit findings and open work this suite already holds, or turns the
conversation into a recap, a follow-up email, a one-pager or a proposal outline before the
call ends. Actions parsed out of it are filed as ordinary work, and an action the meeting
gave no date for is filed without one rather than handed a deadline nobody agreed. Everyone
else sees a coming-soon page.

**It is something you come back to, not something you run.** Every finding the audit files
becomes tracked work with a status and a date, every calendar row becomes a dated post, and the
whole plan leaves as a calendar file or a written update. Each business you add keeps its own
workspace, and every tool is briefed on what the others have already produced and what is
currently open, so the suite builds on itself day to day instead of starting over each time.

**You configure it by pasting your website.** Grayrender reads the rendered page, learns your
name, what you sell, who buys it and how you sound, and every tool and every dropdown in the
suite becomes correct for your industry. There is nothing to edit in source.

> Full technical documentation is in **[DOCUMENTATION.md](DOCUMENTATION.md)** — architecture,
> the render pipeline, the guard system, every environment variable, and the roadmap.

---

## Why it exists

Most SEO tools read raw HTML and guess at everything else. That guessing is where they lie to
you: they call a JavaScript countdown "frozen at 00:00:00", they report `alt=""` as alt text,
they invent a testimonial to show you what a better one would look like.

Grayrender's rule is that **it may never claim something it did not observe.** That one
constraint drove the whole architecture.

## The tools

1. **AI Marketing Audit** — the flagship. Finds a site's key pages, renders and audits each one
   live, and synthesises a director-level cross-page report with a prioritised fix list, exact
   copy-ready replacements, a SERP preview, screenshot evidence crops, and a Print / Save-as-PDF
   export. Around 95 seconds end to end, and it needs no setup: paste a URL and go.
2. **Client Outreach Generator** — a personalised cold outreach email.
3. **LinkedIn Content Engine** — a thought-leadership post, with an optional generated image.
4. **Campaign Ad Studio** — Google Ad + LinkedIn Ad + landing-page hero, with live char meters.
5. **Competitive Intelligence** — a "Why We Win" battle card against a named competitor.
6. **Content Calendar Builder** — four weeks, multi-channel, every post with a hook, caption,
   CTA and required asset. Exports to CSV.
7. **Multi-Channel Studio** — one brief, natively rewritten for LinkedIn, Instagram, YouTube
   and short-form video.
8. **Comms & PR Kit** — press releases, newsletters, one-pagers, case studies, webinar abstracts.
9. **Brand Voice & Messaging** — positioning, message house, voice principles, words to avoid.
10. **Social Performance Report** — paste your metrics, get three decisions and an honest list
    of what the data cannot tell you.
11. **Copy Editor** — a clean edit, the reasoning behind every change, and claims to verify.

Every tool runs on the brand profile learned at setup, so the options you see are your services
and your audiences, not a demo company's. Press <kbd>⌘K</kbd> to jump between them.

## How the audit actually sees a page

```
discover  ->  scan (xN, 3 concurrent)  ->  synthesize  ->  impact + requirements
```

Each `scan` drives a real browser via Browserless and comes back with:

- the **post-JavaScript DOM**, not the fetched HTML
- a **full-page screenshot**, used for evidence crops in the report
- **measured geometry** — the bounding box of every heading, button, link, image and form
  control, which is how it knows what is above the fold
- **`domFacts`** asked of the live DOM rather than regexed out of a string

That last one retired an entire family of bugs. Every parser defect in this project's history
came from pattern-matching HTML text: `alt=""` counted as alt text, `<noscript>` lazy-load
fallbacks counted as visible images, an apostrophe cutting a meta description in half. When a
real browser is open, ask it.

If no render provider is configured the audit degrades to an HTML-only read: layout claims are
disabled, UX is graded `n/a`, and the report says so.

## Every tool hands over a briefing, not just an asset

The experts are the reason several outputs are short: a cold email is 50 to 125 words, a Google
headline is 30 characters. Padding those makes them worse. So each tool returns the tight asset
**and** a briefing beneath it: why it works with the principle named and quoted from your own
copy, two or three paste-ready alternatives, what to test and the metric it should move, and what
to verify before it ships. The briefing is a separate bounded call, so it can never time out the
asset.

Anything you get back can be changed by asking. **Change this** opens a dock where you type what
you want different, and the revision runs back through the same renderer, so every guard that
applied to the first draft applies to the rewrite.

## Truthfulness is enforced in code, not in the prompt

The central lesson of this codebase: **a model ignores a prompt rule maybe 10 to 30 percent of
runs.** Anything that must never appear has to be enforced after generation, not requested
before it. So the defence runs in three layers:

1. **Grounding** — verbatim signals, real link and button labels, computed facts, SSR
   de-duplication, and a pre-hydration flag are handed to the model as authoritative.
2. **Prompt rules** — no fabrication, severity rubric, platform fairness, no contradictions.
3. **Code guards** — `fixBullets` drops any fix that asserts a fabricated "current" value, calls
   a strong title weak, infers funnel order from document-order links, reports a JS timer as
   frozen, or rewrites a link-in-bio H1 into an SEO string.

Layer 3 exists because layers 1 and 2 were not enough, every single time.

The report also ships a **Not Verified in This Audit** appendix that states its own observation
limits — what the render did not cover, what was never expanded, what is a snapshot.

## Running it

```bash
npm install
npm test
```

`npm test` runs 569 assertions across four suites: `passcode.test.js` (an unauthenticated
caller can never reach a paid API), `audit-guards.test.js` (every known false claim is blocked,
every real finding survives), `report-render.test.js` (the report renders, the print document
builds, the evidence is in both, and every guard holds on the thing a human actually receives)
and `workspace.test.js` (findings become tracked work and only the ones the report actually
showed, dates are local rather than UTC, the calendar file parses in somebody else's app, and the
Finesse handoff never carries the passcode).

Full technical reference, including the workspace, the program, Meeting Mode and the handoff, is
in [DOCUMENTATION.md](DOCUMENTATION.md).

The frontend is a single `index.html` with no build step. Serve the folder and open it; the
audit backend needs Netlify Functions, so audits only run against a deployment.

## Environment

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required. Also the kill switch — remove it and every tool stops. |
| `OPENAI_API_KEY` | Optional. LinkedIn post images. |
| `RENDER_PROVIDER` | Set to `browserless` to enable real rendering. |
| `BROWSERLESS_TOKEN` | Required when rendering is on. |
| `BROWSERLESS_URL` | Optional. Defaults to the SFO region. |
| `RENDER_TIMEOUT_MS` | Optional. Defaults to 20000. |
| `SITE_PASSCODE` | **Required.** One passcode for the whole site. Every function refuses to work without it, and it fails closed if unset. |
| `LOG_WEBHOOK_URL` | Optional. Usage pings. |
| `OWNER_IP` | Optional. Skips your own usage pings. |

No secret values live in this repo, only variable names.

## The lock

This is a portfolio build that spends real money per click: each audit renders pages in a
headless browser and makes several model calls. So the whole site sits behind one passcode.

It is enforced **server side**. Every function checks the request against `SITE_PASSCODE`
before it renders, fetches, or calls a model, and returns `403` otherwise. The unlock screen
is courtesy; reading this source or the network tab gets you nothing, because the passcode is
not in either. It fails closed on purpose: an unset secret must never mean "open to everyone"
on something that bills per request.

If you are an employer and want to look around, the screen tells you how to ask.

## Design

No webfont: SF Pro and system-ui, with Didot for display type. Warm bone `#F2EFEA`, near-black
`#111`, one bronze accent `#8A6D3B`, frosted panels, hairline borders. The whole palette is the
`:root` token block in `index.html`.

---

Built by Edmund Gray · Runs on Anthropic Claude
