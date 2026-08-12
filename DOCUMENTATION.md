# Grayrender — Technical Documentation

Complete reference for what the app is, how every part works, and what to build next.
Built by Edmund Gray.

> Note: this file is committed to a public repo. It never contains secret values
> (passwords, API keys, webhook URLs) — those live only in Netlify environment
> variables and are referenced here by name.

---

## 1. What it is

A single-page AI marketing suite built around one flagship tool: a full-site marketing audit
that renders every page in a real headless browser before it says a word about it. Five tools
generate real output from the Anthropic Claude API (and OpenAI for images), behind Netlify
serverless functions so API keys are never exposed to the browser.

The four generators run against a configurable demo client, set by the `CO_NAME` / `CO`
constants in `index.html`; change those two lines to point them at any company.

**Stack:** one-file frontend (`index.html`) + Netlify Functions (Node) + Anthropic Claude
(`claude-haiku-4-5-20251001`) + OpenAI images. No build step, no framework.

**Design:** no webfont (SF Pro / system-ui, with Didot for display), warm bone `#F2EFEA`,
near-black `#111`, one bronze accent `#8A6D3B`, frosted panels and hairline borders. All of it
lives in the `:root` token block. No emojis in the UI.

---

## 2. The five tools

| Tool | What it does | Backend |
|------|--------------|---------|
| Client Outreach Generator | Personalized cold outreach email to a company that needs tech talent | `generate.js` |
| LinkedIn Content Engine | Thought-leadership LinkedIn post (+ optional DALL·E image) | `generate.js` + `image.js` |
| Campaign Ad Studio | Google Ad + LinkedIn Ad + landing-page hero, with live character-limit meters | `generate.js` |
| Competitive Intelligence | "Why We Win" battle card vs a named competitor | `generate.js` |
| **AI Marketing Audit** | **Full-site audit: crawls key pages, audits each, synthesizes a site-level report** | `audit.js` |

Tools 1–4 are single Claude calls with expert system prompts. Tool 5 is the flagship and is
documented in depth below.

---

## 3. The AI Marketing Audit (flagship)

Audits a **whole website** the way a pro consultancy would: it finds the site's most important
pages, audits each one live, and synthesizes a single **site-level** report with cross-page
patterns and recommendations. A full run takes about a minute.

### 3.1 Why it's multi-step (the core constraint)

Netlify synchronous functions are killed at roughly 26–30 seconds. A single deep page audit
already takes ~15–25s, so the whole site cannot be crawled and analyzed in one call. Instead,
**the browser orchestrates** three separate function calls, each staying under the timeout:

```
discover  → find the key pages          (~2s, no model call)
scan × N  → audit each page (parallel)  (~8–9s each, 3 at a time)
synthesize→ site-level report           (~20s)
                                         total ≈ 40s
```

### 3.2 The three backend modes (`netlify/functions/audit.js`)

All three are the same function, branched on a `mode` field in the request body. All are gated
by the feature lock and access gate (section 5).

**`mode: "discover"`** — no model call.
- Fetches the homepage and extracts every internal `<a href>`; also tries `/sitemap.xml` and
  `/sitemap_index.xml`.
- Ranks candidate pages with `scorePath()`: strong boosts for canonical nav pages
  (pricing, about, ai-teams, services, industries), a penalty for depth and for stale `-old`
  duplicate pages, and only a modest boost for service-detail pages so near-duplicates
  (e.g. four "staffing" variants) don't crowd out the strategic pages.
- Caps service-detail pages at one, returns the top **5** pages (`{url, label}` each).

**`mode: "scan"`** — one fast, compact model call per page (`max_tokens: 1200`).
- Fetches the page, extracts SEO/technical signals + ~3000 chars of visible text.
- Returns a terse block: `GRADE`, `CATEGORY SCORES`, `WINS`, `ISSUES` — designed to feed the
  synthesis, not to be shown in full.

**`mode: "synthesize"`** — one model call (`max_tokens: 4096`) over all the per-page scans.
- Produces the **site-level** report in the same 6-section shape the renderer/PDF already
  understand (so no new rendering code was needed): `OVERVIEW` (+ overall grade + category
  sub-scores), `WHAT IS WORKING`, `WHAT IS COSTING YOU LEADS`, `PRIORITIZED FIXES`,
  `STRATEGIC MOVES` (the cross-page moves), `WHERE AI CREATES LEVERAGE`.

The default mode (no `mode` field) is a deep single-page audit, kept for internal use.

### 3.3 How it "thinks like the masters"

Both the scan and synthesis prompts reason through named, established frameworks rather than
giving opinions:

- **Conversion / CRO:** LIFT model, Fogg Behavior Model (B=MAP), Cialdini's persuasion
  principles, Nielsen usability heuristics, Baymard UX findings.
- **Messaging / positioning:** April Dunford positioning, StoryBrand, Jobs-To-Be-Done, the
  5-second clarity test.
- **SEO / technical:** search intent, Google E-E-A-T, title/meta best practice, one-H1 heading
  hierarchy, Core Web Vitals.
- **Trust:** specific named social proof, quantified specificity, risk reversal.

### 3.4 What makes the output actionable

- **Category sub-scores** (Conversion / Messaging / Copy / SEO / Trust / UX) rendered as chips.
- **Prioritized Fixes:** every fix is `[Priority] Location: exact change. Effort: est (role)`.
  The renderer (`fixBullets`) pulls the `[Critical/High/Medium/Low]` tag into a colored chip and
  bolds the location, so a developer knows exactly what/where/when.
- A hard client-side filter drops any "no change needed / keep as is / already strong" non-fix
  the model occasionally slips in (a prompt rule alone was not reliable — enforce in code).
- **Cross-page moves** in Strategic Moves, e.g. "elevate the About-us founder-led narrative to
  the homepage hero — it exists only on About us right now."

### 3.5 Frontend flow (`index.html`)

- `runSiteAudit()` orchestrates discover → `runPool(pages, 3, scan)` → synthesize.
- A live progress panel (`.site-prog`) lists each page with a status badge that flips to its
  grade as the scan completes.
- The final report is rendered by `renderAudit()` with a **"Pages Audited" grade strip**
  showing each page's grade.
- **Print / Save as PDF** (`printAuditReport()`) rebuilds the report as a clean branded document
  (brand header, grade box, sub-score chips, per-page strip, framework-cited findings, prioritized
  fixes, single end footer) and calls `window.print()`.

### 3.6 Truthfulness: the absence rule and the output guards

This is the most important section in this document. The audit's one unacceptable failure mode
is a **confident false claim**, and it shipped several before they were traced to a single root
cause.

**The root cause: absence inferred from truncation.** The model is only ever shown a truncated
excerpt of a page (1,000–3,000 chars) to stay under the function timeout. It was then asked to
judge the whole page. So when an FAQ, a bio section, or an email signup form sat further down
than the excerpt reached, the model reported them as **missing** — on pages that had all three.
Real examples, all verified false against the live page:

| Claim shipped | Reality |
|---|---|
| "no visible email signup form or newsletter CTA" | `<input type="email">` present; the report quoted that form's own button two sentences earlier |
| "the page is 200-300 words of visible content" | 3,135 words |
| "no artist bio… and no FAQ" | both present; the FAQ has 10 question headings |
| "countdown timer displays 00:00:00 (frozen or broken)" | live, counting down; the zeros are pre-hydration |
| "fixing the broken Shazam link" | there is no Shazam link on the page at all |
| "expect a 15 to 25 percent lift within 4 to 6 weeks" | invented; nothing supported it |

Every one of these is an **absence claim**, and the prompts had dozens of rules against
inventing *values* but not one against inferring *absence*. "I did not see it" was being
treated as "it is not there."

**The fix, in three layers:**

1. **`extractFacts()`** computes the absence-prone facts *deterministically in code from the
   full HTML* (never the excerpt): word count, email-capture form, FAQ section, bio section,
   countdown widget, every heading, image/alt counts, canonical, JSON-LD. These go to every
   model call via `factsBlock()` as **authoritative** and override the model's own reading.
2. **The ABSENCE RULE** in every system prompt: the excerpt is truncated and is *not* the page.
   An absence may be asserted **only** when a FACT explicitly says NO. If a fact says YES, the
   element exists — never call it missing, never recommend migrating to obtain it.
3. **Output guards that enforce, not ask** (`applyGuards`), because a prompt rule alone has
   never been reliable here:
   - `enforceFacts()` — drops any bullet asserting an absence the facts contradict.
   - `stripInventedMetrics()` — drops fabricated percentages, multiples, timeframes, and fake
     social proof ("Join 500+ fans"), while preserving real numbers quoted in a Current/Use.
   - `tetherToFixes()` — drops any "Why These Changes Matter" bullet that makes a breakage or
     absence claim about something never filed as a fix (this is what invented the Shazam link).
   - `enforceSeverity()` — a platform limitation (alt text, canonical, schema, H1 on a locked
     builder) can never be a PRIORITIZED FIX.

**The category, not the instances.** The six claims above are not special — they are the shape
of *every* absence claim inferred from a truncated excerpt. On a normal business site the same
failure lands on what a marketing analyst reaches for by reflex: *no testimonials, no case
studies, no pricing page, no phone number, no contact form, no blog, no about page, no social
links, no site search.* None of those is verifiable from the first 1,000 characters of a page.
Each therefore has its own deterministic fact, and both the prompt and the guard are driven off
**one shared table** (`ABSENCE_FACTS`) so a new fact is enforced everywhere automatically.

**The distinction that keeps the guard usable.** The negation set is *existence-only*, so a
quality critique of something that exists survives while a fabricated absence does not:

| Bullet | Fate |
|---|---|
| "there is no blog" (fact: blog exists) | dropped — fabrication |
| "the blog has not been updated since 2023" | **kept** — real finding |
| "the testimonials are vague and unattributed" | **kept** — real finding |
| "there is no FAQ" (fact: no FAQ) | **kept** — true absence |

**The regression harness** (`npm test`, 56 tests) freezes all of it. Every false claim the audit
ever shipped is in there, alongside true findings and quality critiques that must survive, so
the guards cannot pass by simply gutting the report. **Run it before shipping any prompt
change.**

**Still unguarded (know this before trusting a report):** anything visual (layout, hierarchy,
mobile tap targets) is unobservable from HTML — UX is graded `n/a` for exactly this reason.
Claims outside the `ABSENCE_FACTS` table have no fact backing them; if you see the audit assert
an absence of something not in that table, add a fact for it rather than trusting it.

### 3.7 Seeing the page (rendering, geometry, vision)

The audit used to read HTML and have no idea what a visitor actually *sees*. So it was banned
from discussing layout and UX was graded `n/a`. That ban was honest, but silence was a
placeholder for sight, not a substitute — and it meant the audit could not do the most ordinary
thing a CRO consultant does: *"your primary CTA is below the fold, move it up."*

With `RENDER_PROVIDER=browserless` the audit now drives a real headless browser per page and
gets three things:

| | What it is | How it's used |
|---|---|---|
| **Rendered DOM** | the post-JavaScript page | replaces the raw HTML, so JS-rendered content is finally readable |
| **Geometry** | every element's measured box, plus the fold line | becomes **facts** — `getBoundingClientRect`, not opinion |
| **Screenshot** | the first screen, as an image | passed to Claude's **vision** for hierarchy, emphasis, crowding |

**Facts constrain, vision interprets — never the other way round.** Whether a CTA is above the
fold is arithmetic (`y < foldY`) and the model may not argue with it. Whether the page *feels*
cluttered is a judgement, and that is what the screenshot is for.

**The gate that makes this safe.** The very first audit this project ever produced claimed
streaming links were "buried below merch" — inferred from raw HTML document order. It was
false, and it is the original sin of the entire project. So every layout claim is gated on a
render having actually happened:

- **geometry present** → position, fold, visual-order and prominence claims are allowed, and
  UX is graded. They are measured.
- **geometry absent** → `enforceLayoutClaims()` strips every such claim and `forceUxUnassessed()`
  pins UX to `n/a`. Not because the claim is necessarily wrong, but because we did not look.

Fail-safe throughout: no token, a render error, or a timeout, and the audit degrades to the
HTML-only behaviour with layout banned. **Degrading to honest silence is always allowed;
degrading to a guess never is.**

### 3.8 What it does NOT do (known limits)

- It reads **server-rendered HTML**. Most marketing builders (Hopp, Wix, Squarespace, Webflow,
  WordPress) server-render their content, so the headings, copy, forms, and links are all
  present in the raw HTML — this was never the real problem (see 3.6). But a **true
  client-rendered SPA** ships an empty shell. `fetchPage()` now detects a genuine shell
  (`isShell()`) and can re-fetch through a rendering reader proxy — set `RENDER_PROXY=jina`
  (optionally `JINA_API_KEY`) to enable. Fail-safe: if it is unset or errors, the direct HTML is
  kept and the NOT VERIFIED appendix tells the reader the read was limited.
- **JavaScript-populated values are still not observed** (countdown values, live counters). The
  audit knows the *widget* exists but never claims its *value*, and says so in the appendix.
- It audits ~5 key pages, not every page (deliberate: deep on the pages that drive decisions,
  fast, and low-cost — not 50 blog posts).

---

## 4. Architecture & files

```
/index.html                       entire frontend (UI, all 5 tools, audit orchestration, PDF export)
/netlify/functions/generate.js    Claude proxy for tools 1–4 + usage logging
/netlify/functions/image.js       OpenAI image proxy for the LinkedIn tool
/netlify/functions/audit.js       the full-site audit (discover / scan / synthesize modes)
/test/audit-guards.test.js        regression harness: every false claim the audit ever shipped
/netlify.toml                     build config (publish = ".", functions dir)
/package.json                     @anthropic-ai/sdk dependency + `npm test`
/DOCUMENTATION.md                 this file
/README.md                        short overview
```

Frontend → Netlify Function (proxy) → Claude/OpenAI. Keys live only in Netlify env vars, so the
browser never sees them, and deleting a key is an instant kill switch.

---

## 5. Access control (three independent gates)

1. **Kill switch** — `ANTHROPIC_API_KEY` (and `OPENAI_API_KEY` for images). Delete the env var and
   the tools go dead. This is the master off switch.
2. **The site passcode** — `SITE_PASSCODE`. One lock for the whole product, checked inside every
   serverless function before any render, fetch or model call, so a locked visitor costs nothing.
   The passcode is never in source. Fail-closed: if `SITE_PASSCODE` is unset, nothing runs at all,
   because an unset secret must never mean "open to everyone" on a build that bills per request.
   The unlock screen in `index.html` is courtesy only; the enforcement is server side.



## 6. Usage tracking

Every generation logs a `[USAGE]` line (tool, inputs, IP, country, browser, referrer, token
counts) to the Netlify function logs (Dashboard → Logs & metrics → Functions → Logs; retained
24h). If `LOG_WEBHOOK_URL` is set (a Discord or Slack webhook), an alert also fires — but only for
outside visitors, never the owner. This is the "has anyone tried it" detector and the permanent
record (the webhook channel keeps history; Netlify logs don't).

---

## 7. Environment variables (all set in Netlify)

| Variable | Purpose | Required |
|----------|---------|----------|
| `ANTHROPIC_API_KEY` | Claude API key (tools + audit). Kill switch. | Yes |
| `OPENAI_API_KEY` | OpenAI image generation for the LinkedIn tool | For images |
| `LOG_WEBHOOK_URL` | Discord/Slack webhook for live usage alerts | Optional |
| `OWNER_IP` | Comma-separated IPs whose usage never triggers alerts | Optional |
| `RENDER_PROXY` | Set to `jina` to render true client-side SPAs through a reader proxy (text only) | Optional |
| `JINA_API_KEY` | Higher rate tier for the render proxy above | Optional |
| `RENDER_PROVIDER` | Set to `browserless` to **see** the page: rendered DOM + screenshot + measured element geometry. Without it, layout claims stay banned and UX stays `n/a`. | Recommended |
| `BROWSERLESS_TOKEN` | Browserless API token. Free tier is 1,000 units; a unit is up to 30s of browser time, and a page render is well under one. | With `RENDER_PROVIDER` |
| `BROWSERLESS_URL` | Override the Browserless region endpoint (default `https://production-sfo.browserless.io`) | Optional |
| `RENDER_TIMEOUT_MS` | Per-page render budget, default `20000` | Optional |

**Important:** env-var changes only take effect after a redeploy (Deploys → Trigger deploy).

---

## 8. Deployment

Push to `main` → Netlify auto-deploys (repo connected, no build command needed; Netlify installs
`@anthropic-ai/sdk` and publishes the site + functions). To change the model, edit the `model:`
lines in the function files (currently `claude-haiku-4-5-20251001`, chosen for speed and
reliability under the function timeout).

Local test: `npm install && netlify dev` (serves `index.html` and runs the functions locally;
set the env vars first).

---

## 9. Performance notes

- Model is Haiku 4.5 everywhere for speed and to stay under Netlify's ~26–30s synchronous function
  timeout. Deep single-page and synthesis calls run ~16–25s; per-page scans ~8–9s.
- Output length is deliberately capped (char targets in the prompts, `max_tokens` limits) because
  the risk is a 504 timeout on content-heavy pages, not too little detail.
- Full-site run wall-clock ≈ 40s (discover ~2s + 5 scans at 3-concurrent + synthesis ~20s).

---

## 10. Roadmap / future work

### 10.1 Handling bot-protected and JavaScript-rendered sites (the main gap)

Today the audit fetches raw server HTML with a browser-like User-Agent. That works for most
marketing sites but returns thin or blocked content for two cases: **(a) single-page apps** that
render with JavaScript, and **(b) sites behind a bot challenge** (Cloudflare "checking your
browser", CAPTCHA, or aggressive WAF/rate limits). Options to fix, roughly cheapest → most robust:

1. **Richer request headers + polite retries (cheap, partial).**
   Send a full browser header set (`Accept`, `Accept-Language`, `Referer`, `Sec-Fetch-*`), and on
   a `403`/`429` retry once with backoff. Beats naive fetches; won't defeat real challenges.

2. **A reader/render proxy (best effort-to-value ratio).**
   Route the fetch through a service that renders the page (runs its JS) and returns clean text.
   - **Jina AI Reader** — prefix the URL: `https://r.jina.ai/https://target.com`. Returns rendered
     markdown, handles many JS sites, near-zero setup, generous free tier. Easiest first upgrade.
   - **Firecrawl / similar** — hosted crawl+render APIs with a clean JSON response.
   Add as a fallback: try the direct fetch first, and if the result is thin (the existing
   `spaWarning` check) or blocked, retry through the reader proxy.

3. **A scraping/unblocker API (most robust for hard blocks).**
   Services built to defeat bot protection with rotating residential proxies, JS rendering, and
   CAPTCHA solving: **ScrapingBee, ScraperAPI, Bright Data Web Unlocker, Zyte**. Pass the URL, get
   back rendered HTML. Costs per request but handles Cloudflare-class protection. Wire it as the
   final fallback tier behind (1) and (2).

4. **Headless browser rendering.**
   Puppeteer/Playwright with stealth plugins renders anything, but a headless Chrome does not fit
   Netlify's function size/time limits. It would need either a separate service
   (Browserless, a small Fly.io/Render worker) or a **Netlify background function** (async, up to
   15 min) that the frontend polls. Heaviest option; only worth it if (2) and (3) prove
   insufficient.

5. **Cache fallbacks.**
   If the live fetch is blocked, try the Google cache or the Wayback Machine
   (`http://web.archive.org/web/2/https://target.com`) for a recent snapshot. Free, but content can
   be stale or missing.

6. **Anthropic server-side `web_fetch` tool.**
   Let Claude fetch the URL itself via the `web_fetch` tool during the model call. Simplest
   integration and may bypass some blocks, though it does not guarantee JS rendering. Worth a test
   as an alternative to fetching in the function.

**Recommended path:** implement a tiered fetch — direct fetch → Jina Reader on thin/blocked →
a scraping API on hard blocks — behind a single `fetchRenderable(url)` helper in `audit.js`, and
keep the existing "this page may be JS-rendered" note as the graceful fallback when all tiers
return thin content. Add short-TTL caching of fetched pages to control cost. Respect `robots.txt`
and reasonable rate limits when auditing sites you do not own.

### 10.2 Other future ideas

- **Choose-your-pages** discovery mode (show the found pages, let the user tick which to audit).
- **Deeper crawls** for larger audits (opt-in, more pages, background-function architecture).
- **Competitor comparison** (audit two sites and produce a head-to-head).
- **Historical tracking** (re-run monthly, show grade movement over time).
- **A sharper synthesis model** (a stronger model for the final synthesis) if tighter prose is
  wanted — with a background-function architecture to remove the timeout risk that currently makes
  Haiku the safe choice.
