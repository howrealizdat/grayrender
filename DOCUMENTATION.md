# Grayrender — Technical Documentation

Complete reference for what the app is, how every part works, and what to build next.
Built by Edmund Gray.

> Note: this file is committed to a public repo. It never contains secret values
> (passwords, API keys, webhook URLs) — those live only in Netlify environment
> variables and are referenced here by name.

**Contents**

1. What it is · 2. The screens · 3. The AI Marketing Audit · 4. The workspace ·
5. The marketing program · 6. Meeting Mode · 7. The Finesse handoff ·
8. Architecture & files · 9. Access control · 10. Usage tracking ·
11. Environment variables · 12. Deployment · 13. Performance · 14. Testing · 15. Roadmap

---

## 1. What it is

An AI marketing suite that a small business, or one marketing person, can actually work inside
day to day. It is built around one flagship tool — a full-site marketing audit that renders every
page in a real headless browser before it says a word about it — and around one idea: **the
findings should become work, and the work should carry from one day to the next.**

You configure it by pasting your website. Grayrender reads the rendered page, learns your name,
what you sell, who buys it and how you sound, and every tool, dropdown, hint and default in the
suite becomes correct for that business. There is nothing to edit in source, and a saved profile
keeps its own workspace, so an agency can run several businesses side by side.

**What separates it from a box of prompts:**

- The audit's prioritised fixes arrive as **tracked work with dates**, not as a PDF you file.
- The sidebar is a **six step marketing program**, ticked off from real state.
- Every generator is briefed on **what the others already produced and what is currently open**,
  so the suite stops contradicting itself.
- The plan leaves the building as a **calendar file** or a **written update**.
- Where a claim cannot be evidenced, the product **says so** rather than guessing. That rule is
  enforced in code, not in prompts, everywhere it matters.

**Stack:** one-file frontend (`index.html`) + Netlify Functions (Node) + Anthropic Claude
(`claude-haiku-4-5-20251001`) + OpenAI images + Browserless for real page rendering. No build
step, no framework, no state on a server.

**Design:** no webfont (SF Pro / system-ui, with Didot for display), warm bone `#F2EFEA`,
near-black `#111`, one bronze accent `#8A6D3B`, frosted panels and hairline borders. All of it
lives in the `:root` token block. No emojis in the UI.

---

## 2. The screens

Twenty-one entries in `TOOLS`, grouped in the sidebar by **when you use them** rather than by what
they are. Nine are bespoke screens rather than generators (`workspace: true`, `meeting: true`,
and the seven carrying `fan: true`); the rest take fields and produce an asset plus a strategist's
briefing.

### Workspace

| Screen | What it does |
|--------|--------------|
| **Today** | What is due, what is open, what happened, and what to do next. The landing screen for a returning profile. |
| **Meeting Mode** | Listens to a live meeting and answers from everything the suite knows. Owner only; everyone else sees a coming-soon page. |

### Marketing program (in order)

| # | Tool | What it does | Backend |
|---|------|--------------|---------|
| 1 | **AI Marketing Audit** | Renders ~5 key pages, measures them, grades them, and files the fixes as work | `audit.js` |
| 2 | Brand Voice & Messaging | Positioning statement, message house, voice principles, words we never use | `generate.js` |
| 3 | Competitive Intelligence | "Why We Win" battle card against a named competitor, or against doing nothing | `generate.js` |
| 4 | Campaign Builder | One brief → press release, LinkedIn post, ads, multi-channel and calendar, in parallel | orchestrates |
| 5 | Content Calendar Builder | Four weeks of dated posts, rendered as a grid, exported as CSV, filed as work | `generate.js` |
| 6 | Social Performance Report | Paste raw metrics → what they say, Kaushik's four metrics, and what is still invisible | `generate.js` |

### Any time

| Tool | What it does |
|------|--------------|
| Client Outreach Generator | Cold outreach email built on Josh Braun's 4-T structure |
| LinkedIn Content Engine | Hook-first post, 1300–2000 chars, optional generated image |
| Campaign Ad Studio | A real Responsive Search Ad: up to 15 headlines and 4 descriptions, compliance enforced in code |
| Multi-Channel Studio | One brief → LinkedIn, Instagram, YouTube title and description, short-form script, hashtags |
| Comms & PR Kit | Press release, newsletter, one-pager, case study, webinar or white-paper outline |
| Copy Editor | Edited version, what changed and why, claims to verify, readability |

### Fan Engagement

Seven bespoke screens (`fan: true`), named with the vocabulary of the process they model. They run
without a business loaded, because they carry their own audience of record. Full detail in
section 15.

| Screen | What it does |
|--------|--------------|
| 1. Request | The campaign brief, the 24,000-record synthetic audience, and the guardrails enforced in code |
| 2. Segment | A rule builder over the fan schema, with reachability and an itemised suppression breakdown per channel |
| 3. Build | One offer as email, SMS and push, every token shown against how often it is empty, send time against open time |
| 4. QA | Every template against WCAG, CAN-SPAM and TCPA, with the send blocked while anything fails |
| 5. Deploy | The journey, and who the frequency cap removed at every send |
| 6. Measure | Channel KPIs, fan LTV, and an A/B test that refuses to be stopped early |
| 7. Operating plan | Day one through continuous, 22 evidence-backed items, read out of the engine rather than written |

Every writing tool also returns a **briefing** — why it works (naming the practitioner standard
applied), two or three complete paste-ready alternatives, what to test, and what to watch out for.
It is a separate bounded call made after the asset, because folding it into the asset prompt
pushed the two longest tools past the function timeout.

Every writing tool has a **refine dock**: ask for a change in plain language and the revision is
re-rendered through the same guards the first draft passed.

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

### 3.2 The backend modes (`netlify/functions/audit.js`)

One function, branched on a `mode` field in the request body. All of them are behind the site
passcode (section 9), checked before any fetch, render or model call.

| Mode | Model call | What it does |
|------|-----------|--------------|
| `brand` | 1 (900 tok) | Onboarding: renders the pasted site and returns the labelled profile the whole suite configures itself from |
| `discover` | none | Finds the site's key pages |
| `scan` | 1 (1200 tok) | Renders and grades one page |
| `shot` | none | Captures the screenshot on its own invocation |
| `synthesize` | 2 in parallel | The site-level report |
| `impact` | 1 (800 tok) | "Why these changes matter", tethered to the filed fixes |
| `requirements` | 1 (900 tok) | "What it takes to fix this" — tools, people, a realistic timeline |

**`discover`** — no model call, ~2s. Reads the homepage's internal `<a href>` list plus
`/sitemap.xml`, then ranks with `scorePath()`. The keyword table is **industry neutral**
(pricing 60, plans 55, about 45, services 38, product 32, features 30, and so on) with a depth
penalty of 14 per level, −40 for numbered segments and −30 for article silos (blog, docs, press,
legal). It used to be one client's navigation — `ai-team` at 55, bonuses for
staffing/recruit/offshore — which quietly ranked one company's nav for every site the tool ever
audited. Near-duplicates are deduped **by last path segment**, which is what finally caught
nested cases like `/professional-services` and `/industries/professional-services`. Returns
`{pages, commercial, thin}`; `thin` flags a site with fewer than two real commercial pages, and
the UI says so rather than grading a styleguide as if it were a sales page.

**`scan`** — renders the page, returns `GRADE`, `CATEGORY SCORES`, `WINS`, `ISSUES`, plus
`compactSignals()` (verbatim title, meta, H1s, H2s, ordered link labels, button labels, counts)
and a content excerpt. Those verbatim signals travel to synthesis, which is what stops it
inventing a "current" value it never saw.

**`shot`** — the screenshot gets its own invocation because bundling a full-page JPEG into the
scan starved the 26s budget. It needs no model, so it is cheap, and a missing shot just renders
the report without pictures. Evidence is an enhancement, never a dependency.

**`synthesize`** — the site-level report, in the six-section shape the renderer and PDF already
understand. **Split into two halves run in parallel** (`part: 'main' | 'fixes'`) and stitched by
`stitchReport()`, because a single call sat at 28–30s on the function ceiling and tipped over
intermittently. `keepSections()` cuts each half down to the sections it owns, because told to
write everything *except* the fix list the model wrote one anyway on one live run in three.

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

---

## 4. The workspace

The layer that makes the suite somewhere you come back to. Per profile, in `localStorage` under
`gr_plan_<profileId>` alongside `gr_work_<profileId>` (the last output of each tool).

**Three things live in it**

| Field | What it holds |
|-------|---------------|
| `items` | Real work: title, detail, status (`open` / `done`), due date, source, priority, a stable `key` |
| `log` | The activity timeline, capped at 120 entries |
| `strategy` / `strategyDoc` | The running daily focus, and the full written strategy |

Text only, and every write is wrapped: an audit result carries a full-page screenshot per page,
so screenshots stay in memory for the session and only the report body persists. A full disk or
private mode degrades to session-only rather than breaking the product.

### 4.1 Where work comes from

**Audit fixes.** Collected *inside* `fixBullets` itself, into `FIX_PARSED`, on the way past every
guard. This is deliberate and it matters: parsing the report a second time somewhere else would
drift, and would quietly put the platform-impossible and fabricated findings the guards drop back
into somebody's to-do list. The to-do list can therefore only ever contain fixes the report
actually showed. Due dates are suggested by priority (Critical +2 days, High +5, Medium +12,
Low +25) and are editable.

**It came back.** A fix marked done that a *later* audit still reports is reopened and badged
"still there". A tick beside a problem the site still has is a lie. Guarded on
`foundAt > done_at`, so the run that files a fix cannot undo what you just ticked off.

**Calendar rows.** Each row becomes a dated post, counted from the next Monday. A row whose day
cannot be read gets **no** date rather than an invented one.

**Meetings and Finesse.** Actions parsed out of a meeting write-up, filed the same way.

**By hand.** Anything you type into Today.

### 4.2 Today

Deterministic and free. Opening it costs nothing and waits for nothing. It shows tiles (open, due
this week, done this week, site grade), the program, next moves decided in code, what is due, all
open work, an add box, and the timeline. `nextMoves()` reports only what the program cannot know:
what is late, what is stale, what has no website saved yet.

### 4.3 The two calls it may make

| Button | Call | Guard |
|--------|------|-------|
| **Plan my day** | `DAYPLAN_SYSTEM`, 700 tokens | Must cite items by number from a numbered list; `tetherDayPlan` drops any citation outside the range |
| **Draft the update** | `UPDATE_SYSTEM`, 800 tokens | Stakeholder email from real items and dates only |

Both run through `dropUnbackedFigures`, which drops any line containing a percentage,
comma-grouped number or multiplier that was not in the input, and deliberately ignores years and
small integers so it cannot over-fire on a date or a count of three.

The citation is an **exact** tether. Asking the model to pick from a numbered list and then
validating every number it cites means a drifted bullet cannot survive by being plausible, which
is what fuzzy text matching allows.

### 4.4 The two exits

**Calendar (`.ics`, RFC 5545).** Escaped separators, an exclusive all-day `DTEND`, CRLF line
endings, folding by **octet** rather than character, and a stable `UID` so re-exporting updates
events instead of duplicating them. It returns what it could **not** schedule and the UI says so,
because an export that quietly drops half your list is worse than one that admits it.

**Email (`mailto:`).** Opens the user's own mail client. The full text always goes to the
clipboard first, because the `mailto` URL length limit varies by client and a silently truncated
update is the worse failure. Nothing is ever sent on anyone's behalf.

### 4.5 Continuity

`workDigest()` briefs each generator on what the other tools produced. `planDigest()` adds the
current focus (if under a week old) and the open work, so Thursday's post knows about Monday's
fix. Kept to roughly 500 characters because it rides on every call and the two longest tools hit
the function ceiling first.

---

## 5. The marketing program

Twelve tools in a sidebar is a menu, and a menu does not tell anyone where to start. `PROGRAM` is
six steps in the only order that survives an argument: you cannot fix what you have not measured,
position before you know what you sell, write at scale before the voice is fixed, schedule a
campaign that does not exist, or report on something you never shipped.

**Completion is derived from real state, never ticked by hand.** `programState()` marks the first
incomplete step `now` and the rest `later`, but each step's status is independent — a step done
out of order is marked done where it is. **Nothing is ever locked.**

**Step one does not complete when the audit finishes.** It requires the audit to have run *and*
no open Critical or High audit items. Until then it is badged "report run, fixes still open". A
report nobody acted on has changed nothing.

`syncProgramItem()` files the current step as a dated work item (`key: "program:<tool>"`, so
exactly one is open at a time), completes it when the step completes, and opens the next. That is
what puts the program itself into the daily list and the calendar export.

`paintProgram()` patches the number/tick badges onto the existing nav items — build once, patch
only what changed — and runs from both `setActiveNav()` and `logWork()`, so a step ticks the
moment the work lands. All six steps show on day one; once you are moving it collapses to the
step you are on (`PLAN.progOpen`, persisted).

**Write the full strategy** (`STRATEGY_SYSTEM`, 1500 tokens) reads the program, the audit grade
and what it found costing leads, and writes: Where you are / The strategy / The next ninety days /
What would make this fail / What is not known yet. It is told explicitly which steps are done and
which are not, because claiming work nobody did would discredit it in one line. The document
records the state it was **written from**, and says plainly when the work has moved on since.

---

## 6. Meeting Mode

Owner only (`isOwner()`, the `?owner=1` device flag). Everyone else gets a real coming-soon page
rather than a dead menu item. **The flag decides what is shown; the passcode every function
already enforces decides what can be spent**, so nobody can run up a bill by finding it. It is a
feature flag, not security.

Ported in spirit from Finesse and deliberately not in mechanism. Finesse streams to Deepgram with
a key the user pastes into the browser; this repo is public and its rule is that keys never reach
the browser, so this uses the browser's built-in `SpeechRecognition`. Nothing to paste, nothing to
leak, no new environment variable. The trade-off is honest and stated in the UI: **microphone
only** (not tab audio) and Chrome or Edge only.

**Privacy is stated on screen, not assumed.** Chrome's implementation sends audio to its own
speech service, so the screen says exactly that, says nothing reaches Grayrender until a button is
pressed, and says the transcript is never written to storage.

| Action | What it does |
|--------|--------------|
| **Answer that** | The tail of the transcript plus the positioning, audit findings, program and open work, back in under ninety words, written to be said out loud |
| **Make it** | Recap with ticket-ready actions, follow-up email, one-pager, or proposal outline |

Actions come back pipe separated (`what \| owner \| YYYY-MM-DD`) — the shape the content calendar
proved this model holds far more reliably than a prose convention — and a row that does not parse
is dropped rather than half filed. **An action the meeting gave no date for is filed without
one:** "next week" does not become a deadline and "unassigned" does not become a person.

`goTool()` stops the microphone when you navigate away. A listener still running on a screen you
have left is the one bug this feature is not allowed to have.

---

## 7. The Finesse handoff

[Finesse](https://snh-ai.pages.dev) is the live interview and meeting copilot. It has a
**GRAYRENDER** tab that brings this suite's knowledge of the business into its live answers.

**The boundary.** Grayrender's data is in `grayrender.netlify.app` localStorage. Finesse desktop
is Electron loading from `file://` — a different browser entirely, so it can never read Chrome's
storage — and a third-party frame would get a partitioned empty copy even in a browser. There is
no way around this, so the handoff is explicit.

**The mechanism is a consent window.** Finesse opens `/?connect=Finesse`; `bootScreen()` routes to
`renderConnect()` (still behind the passcode), which names the requester and lists exactly what
would be shared; on send it posts to `window.opener` and closes. Posting to `*` is acceptable
**because the human approved it in the app that owns the data, having been shown who asked** — a
whitelist could not have covered a `file://` parent (origin `null`) without being unsafe.

The reverse runs at `/?import=Finesse`: Grayrender signals ready, Finesse sends its actions,
Grayrender shows them and files nothing until confirmed. A clipboard path covers both directions,
which is necessary in practice because popups get blocked.

**The payload** (`buildHandoff()`, v1): brand, audit grade and what it found costing leads,
positioning, competitive read, program status, up to 15 open items with dates, current focus.
**Never the passcode, no audio, no screenshots, and nothing about any other saved business** —
asserted in the test suite. `handoffWorth()` prevents offering to send an empty envelope.

---

## 8. Architecture & files

```
/index.html                       entire frontend: 21 screens, the workspace, the program,
                                  Meeting Mode, the audit orchestration, PDF export
/netlify/functions/generate.js    Claude proxy for every writing tool + usage logging
/netlify/functions/image.js       OpenAI image proxy for the LinkedIn tool
/netlify/functions/audit.js       the audit: brand / discover / scan / shot / synthesize /
                                  impact / requirements modes
/test/passcode.test.js            an unauthenticated caller can never reach a paid API
/test/audit-guards.test.js        every false claim the audit ever shipped, blocked
/test/report-render.test.js       the report a human receives, rendered and printed
/test/workspace.test.js           items, dates, the .ics, the program, Meeting Mode, the handoff
/netlify.toml                     build config, cache headers, security headers
/package.json                     @anthropic-ai/sdk dependency + `npm test`
/DOCUMENTATION.md                 this file
/README.md                        short overview
```

Frontend → Netlify Function (proxy) → Claude/OpenAI/Browserless. Keys live only in Netlify env
vars, so the browser never sees them, and deleting a key is an instant kill switch. **No user data
is stored on any server** — profiles, work and plans live in the browser's own storage.

**Storage keys**

| Key | Holds |
|-----|-------|
| `gr_brands` / `gr_brand_active` | Saved business profiles and which one is active |
| `gr_work_<profileId>` | The last output of each tool, per profile |
| `gr_plan_<profileId>` | Items, timeline, strategy, program preference |
| `gr_pass` | The site passcode, so you unlock once |
| `wai_owner` | The owner device flag (`?owner=1`) |

---

## 9. Access control

1. **Kill switch** — `ANTHROPIC_API_KEY` (and `OPENAI_API_KEY` for images). Delete the env var and
   the tools go dead. This is the master off switch.
2. **The site passcode** — `SITE_PASSCODE`. One lock for the whole product, validated inside
   **all three** serverless functions before any render, fetch or model call, so a locked visitor
   costs nothing. Matching is whitespace- and case-insensitive, because an employer retyping it
   from an email should never be rejected over a space. The passcode is never in source.
   **Fail-closed:** if `SITE_PASSCODE` is unset, nothing runs at all — an unset secret must never
   mean "open to everyone" on a build that bills per request. The unlock screen is courtesy; the
   enforcement is server side, and `test/passcode.test.js` proves it by giving every case a
   deliberately bogus API key, so a clean 403 is positive proof nothing was spent.
3. **Owner flag** — `?owner=1` hides Meeting Mode from everyone else. A feature flag, not
   security: it decides what is *shown*, while the passcode decides what can be *spent*.

**Headers** (`netlify.toml`): `X-Frame-Options: DENY` and `frame-ancestors 'none'` — the Finesse
handshake is a consent window, not an embed, so framing bought nothing and only opened a
clickjacking surface on a product holding someone's business plan. Plus `Referrer-Policy` and
`X-Content-Type-Options`.

---

## 10. Usage tracking

Every generation logs a `[USAGE]` line (tool, inputs, IP, country, browser, referrer, token
counts) to the Netlify function logs (Dashboard → Logs & metrics → Functions → Logs; retained
24h). If `LOG_WEBHOOK_URL` is set (a Discord or Slack webhook), an alert also fires — but only for
outside visitors, never the owner. This is the "has anyone tried it" detector and the permanent
record (the webhook channel keeps history; Netlify logs don't).

---

---

## 11. Environment variables (all set in Netlify)

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

---

## 12. Deployment

Push to `main` → Netlify auto-deploys in about 25 seconds.

**It does not serve the repo.** `netlify.toml` sets `publish = "_site"` and a build command that
stages the page and nothing else:

```toml
command = "rm -rf _site && mkdir -p _site && cp index.html _site/"
publish = "_site"
```

So the deployed site is a single `index.html` copied out of the repo root at build time.
`_site/` is gitignored and rebuilt on every deploy, so a stale local copy of it means nothing.
Edit the root `index.html`; never edit `_site/`.

This is why the test suite, `DOCUMENTATION.md`, `README.md` and `package.json` are not fetchable
from the live site. With the old `publish = "."` they all were, on a site whose whole premise is
that it is by invitation, and it put test fixtures in the deployable output. Anything added to
the repo that is not `index.html` is therefore invisible to the web by construction, and anything
the page genuinely needs must be inside `index.html` or reached through `/.netlify/functions`.

**Confirm a deploy by curling the live page and diffing it against the local
`index.html`** — never by assuming:

```bash
curl -s https://grayrender.netlify.app/ | diff -q - index.html && echo "live == local"
```

**Two gotchas, both learned the hard way:**

- **Netlify reads environment variables at build time.** Changing one does nothing until a
  rebuild. Force one with an empty commit: `git commit --allow-empty -m "rebuild" && git push`.
- **A stalled auto-deploy** (missed webhook) is fixed the same way. If a push has not deployed
  within a couple of minutes, push an empty commit to re-fire it.

Local: `python3 -m http.server 8770` serves the frontend, but the functions do not run locally, so
anything needing a model call must be tested against the deployment.

---

## 13. Performance and cost

- Model is Haiku 4.5 everywhere, for speed and to stay under Netlify's ~26–30s synchronous
  function ceiling.
- **A measured 5-page full-site audit costs $0.0953**: 8 model calls, 61,690 input + 6,731 output
  tokens, 10 Browserless renders, 103 seconds wall clock. Synthesis alone is a third of it.
- **Synthesis is split into two parallel halves** (`part: 'main' | 'fixes'`, stitched by
  `stitchReport()`), which took it from 28–30s on the timeout edge to 22.8–23.5s with independent
  per-half retry. A large share of each call is fixed overhead — each half re-pays the full page
  payload — so two calls is roughly the practical floor.
- **Prompt caching does not engage here.** Measured: `cache_creation_input_tokens: 0` and
  `cache_read_input_tokens: 0` on all five scans. The stable prefix is under Haiku 4.5's
  4096-token minimum, and the API declines **silently**. Do not re-add it without measuring.
- Writing tools: 3.6–23.8s for the asset, 6–12s for the briefing.

---

## 14. Testing

```bash
npm test
```

883 assertions across five suites. The rule they enforce is not "the output looks right" but
**"the product cannot make a claim it did not earn."**

| Suite | What it proves |
|-------|----------------|
| `passcode.test.js` | An unauthenticated caller can never reach a paid API. Every case sets a bogus API key, so a clean 403 is proof nothing was spent. |
| `audit-guards.test.js` | Every false claim the audit ever shipped is blocked, and every real finding still survives. Both directions matter: a guard that over-fires deletes true findings. |
| `report-render.test.js` | The report a human actually receives renders, prints, and leaks no scaffolding. |
| `workspace.test.js` | Items, local dates, the `.ics` a stranger's calendar has to parse, the program, Meeting Mode, and the handoff payload. |
| `fan.test.js` | The script reaches its own end (a throw at load kills every declaration after it), the seeded dataset reproduces exactly, every suppression count adds up and names a reason, consent is per channel, the frequency cap counts the journey's own sends, the escalator and continuum are derived rather than drawn, the score moves the pull but never the guard, the QA harness catches a template that is genuinely broken, the contrast maths is the real WCAG maths, the A/B guard refuses to be peeked at, and the operating plan reports the same numbers the screens do. |

**The house rule:** when a change turns a test red, fix the test only if the test was wrong.
Never weaken the app to keep an old test happy.

---

## 15. Fan Engagement

Its own nav group and its own test file, sharing the design system, the guard philosophy and the
passcode. Seven screens: six carrying the **JD's own vocabulary** — Request, Segment, Build, QA,
Deploy, Measure — plus an **Operating plan** that assembles what the other six established.
Somebody who runs this process for a living should recognise their own week in the sidebar.

**The focus is declared, not assumed.** `FAN_FOCUS` states that the built vertical is sports and
separates what is vertical-neutral (consent, suppression, journeys, dynamic content, template QA,
experiment design) from what is not (the fan schema, the two progression models, result-contingent
timing, season tickets as the unit, renewals as the KPI). A build that stayed neutral would be an
ecommerce build with the word fan pasted over it.

**Every screen explains itself.** `feHowTo(key)` renders the same four parts from `FAN_GUIDE`:
what the screen does, what it is breaking down, how to read what comes back, and whose thinking it
is held to. A suppression breakdown reads as a failure report until somebody says it is the
opposite; a p value under 0.05 beside a refusal to call a winner reads as a bug until somebody
explains the stopping rule.

**What it is, stated on screen:** the analogue built to reason about the primitives an
enterprise journey platform is made of. It is **not** Adobe Experience Platform, Journey
Optimizer or Customer Journey Analytics, and the Request screen says so in those words, on
screen, above every number it shows. Deliberately not attempted, and named as such: real ESP or SMS delivery, deliverability
and IP warmup, suppression infrastructure, throttling, trained propensity models, cross-device
identity. That is where the genuine production complexity lives and it cannot be simulated
honestly.

### 15.1 The thinking it is held to

`FAN_STANDARDS` carries six, each with what it says and **what this build does about it** — the
same rule the writing tools follow, where naming the standard turns an opinion into a checkable
claim. They are implemented, not quoted:

| Source | Implemented as |
|--------|----------------|
| Mullin, Hardy and Sutton, the frequency escalator (*Sport Marketing*; Mullin, 1978) | Every fan carries a `rung` derived from real attendance and tenure. Lapsing is a rung **down**, not a churn event, which is the whole reason reactivation is worth running |
| Funk and James, the Psychological Continuum Model (*Sport Management Review*, 2001) | A `stage` beside it — Awareness, Attraction, Attachment, Allegiance — because behaviour and attachment are different questions. Both axes are segmentable |
| Cialdini et al., *Basking in Reflected Glory* (1976) | Result-contingent send timing. 26% wore team apparel after a win against 13.5% after a loss. The **direction** is the finding; the magnitude here is a stated assumption, and the guards stay score-blind |
| Fader and Hardie, BTYD / Pareto-NBD / BG-NBD / BG-BB | Named as the standard the LTV figure is held to, **and the gap to it admitted**. A fitted model needs real transaction histories; this prints arithmetic beside the number instead |
| Byron Sharp and the Ehrenberg-Bass Institute | The counterweight, built as a challenge. The plan measures how much of itself is retention and states that this campaign cannot add a single new fan |
| Kohavi, Tang and Xu, *Trustworthy Online Controlled Experiments* | Feasibility, not just a stopping rule: `abFeasibility()` states in weeks how long this audience would take to deliver the planned sample |

### 15.2 The audience of record

`buildFans()` generates 24,000 records from a **fixed seed** (`FAN_SEED`), in two passes: everything
a fan *is* is drawn independently, then tier is assigned by percentile, because a tier is a
statement about where somebody sits relative to everyone else and cannot be known until the whole
book exists. Drawing it from a dice roll instead lets a "Founder" sit below the median spend.

Spend is **Pareto**, not uniform: the top 1% hold roughly 16% of lifetime spend and the top 10%
hold about half. Attendance falls only inside real season windows. Consent is held **per channel**
— email, SMS and push opt-in are separate flags, alongside quiet hours and a rolling frequency
cap. `favoritePlayer` and `seatSection` are deliberately nullable, because a personalization token
that is never null in your test data proves nothing.

Determinism is the whole foundation: `Math.random` would make every segment size, LTV band and
A/B result a different story on each reload. The UI labels the dataset synthetic on all six screens.

### 15.3 Segmentation and reachability

Rules are data, so a rule can be shown on screen exactly as it was evaluated, and `.fe-ruleline`
restates them in English from the same objects the engine read. Every operator is total: an
unknown field or an unparseable value returns `false` rather than throwing.

`evalSegment()` returns matched, reachable, and an **itemised** suppression breakdown, because the
number that matters is not how many people match but how many you are allowed to contact:

> 1,253 match, 959 reachable, 294 suppressed: 187 no email consent; 44 frequency cap; 34
> unsubscribed from all marketing; 29 email hard-bounced

`suppressionOf()` is the single source of truth, called by the segment screen and the journey
alike so the two can never disagree. A global unsubscribe is reported as an unsubscribe even when
a channel flag is still set, because that is the reason that governs.

### 15.4 Dynamic content, send time against open time

Tokens are **declared** in `FAN_TOKENS`, not discovered, so QA can tell a typo from a field that
is allowed to be empty. Syntax is `{{token}}` or `{{token | fallback}}`; the pipe is part of the
syntax rather than a convention somebody has to remember. Each token carries a **scope**: a
send-time token is frozen when the message is built, an open-time token resolves when the message
is opened, which is why a countdown in an email is either impressive or a lie. The Build screen
shows both, side by side, for the same fan.

### 15.5 The QA harness

Findings carry the **standard** they come from, so they are defects rather than opinions:
WCAG 1.1.1, 1.3.1, 1.4.3, 2.4.4, 3.1.1, CAN-SPAM, TCPA. Contrast is **computed** — sRGB relative
luminance per WCAG 2.1 and the (L1 + 0.05) / (L2 + 0.05) ratio, against 4.5:1 for body text and
3:1 for large — not eyeballed. Accessible email is the part of this most CRM teams have nobody to
check.

**Draft 1 of every template is broken on purpose**: a mistyped merge field, a token with no
fallback, a hero image carrying the offer with no alt text, grey on white at 2.81:1, a skipped
heading level, a layout table announced as data, "Click here", an http link, and no unsubscribe.
A harness demonstrated against a clean template has been proven of nothing. Draft 2 closes every
one. The gate is `qaBlocks()`, a function, and the Deploy screen checks it too.

Failures become **ordinary tracked work** through the same `addItem` door audit findings use. The
location is part of the item's identity: two elements failing contrast are two jobs, and titling
on the message alone collapsed them into one.

### 15.6 The journey

`journeySim()` carries the segment through send, wait and audience-filtered nodes. The frequency
cap counts the journey's **own** earlier sends, which is visible in the numbers: it removes 44
people at the first email and 223 by the last. A cap that ignores the messages it has just sent
is not a cap.

### 15.7 A/B, and the peeking guard

`abSampleSize()` is a two-proportion two-sided calculation with alpha and power as real inputs
(`probit()` is Acklam's inverse normal, accurate to ~1e-9). `abVerdict()` **refuses to name a
winner** before the planned sample size and says why in words a marketer will accept. Calling no
difference is treated as a real result.

The cost of peeking is **measured rather than asserted**: `peekingCost()` runs 3,000 simulated
A/A tests, where the two variants are identical by construction, so every winner found is false.
At a fixed horizon it sits on its nominal 5%; stopping at the first significant look reaches
about 15% at five looks and 21% at ten — the textbook sequential-testing result, reproduced in
the browser from a fixed seed.

### 15.8 Where a real stack takes over

The job description names tools this build does not attempt. Leaving them unmentioned would be the
wrong kind of quiet: the question worth answering is not whether somebody has built a CDP, it is
whether they know what one is *for* and where in the process it takes over. So `FAN_HANDOFFS` puts
a successor at the foot of the screen it would take over from, each with what it owns, what this
build does not do, and the specific point of handover.

| Step | Takes over | Because |
|------|-----------|---------|
| 1. Request | Adobe Experience Platform | One fan is one record here. A real fan base has the same person across ticketing, retail and the app, and the identity graph is the foundation everything else reads from |
| 2. Segment | Adobe Real-Time CDP | Rules here run against a static snapshot, with no streaming behaviour and nowhere to publish an audience to |
| 3. Build | Movable Ink | The two panels show why open-time resolution matters; actually serving content at open needs a rendering service behind the image request |
| 4. QA | Litmus or Email on Acid | Pairs rather than replaces: code checks are what a rendering service does not do, and client screenshots are what no static analysis can do |
| 5. Deploy | Journey Optimizer, Epsilon PeopleCloud Messaging, Attentive | Orchestration with real decisioning; actual delivery and deliverability; and SMS subscriber growth, which is the largest single suppression reason on this campaign |
| 6. Measure | Adobe Customer Journey Analytics | Measurement stops at what the campaign did. It cannot see the fan who ignored the email and renewed at the box office |

Links point at API documentation rather than marketing pages, since the reason to record them is to
wire them up later. Every URL was checked; `developers.movableink.com` is deliberately absent
because it does not resolve at all.

**The line that makes this safe to say** rides on every one of them: *naming where a tool belongs is
not a claim to have operated it.* That is enforced by `HANDOFF_HONESTY`, rendered on every screen
that names a tool and asserted in the suite.

### 15.9 The operating plan

The seventh screen, and the reason the other six are worth walking through. `operatingPlan()`
returns six phases — day one, week one, 30, 60, 90 and continuous — of 22 items, each with what to
do, why, and the **evidence** it was derived from. Every figure is read out of the engine when the
screen renders, so changing a segment rule changes the plan; nothing is generated prose, so there
is nothing to invent and nothing that can drift from the numbers it claims to rest on. It exports
as plain text, because what people actually do with a plan is paste it into a ticket, and files
day one as tracked work.

It closes with the two sections that stop it being a pitch: **the counterweight**, which states
that a reactivation campaign is retention by construction and cannot add a new fan, with the share
of the base it never touches; and **what this cannot tell you** — synthetic data, LTV that is not
a fitted model, an assumed result-contingent lift, no deliverability, no identity resolution,
modelled rather than observed conversion. Same convention as the audit's NOT VERIFIED appendix,
for the same reason: the boundary of what was established is part of the finding.

---

## 16. Roadmap / future work

### 16.1 Handling bot-protected and JavaScript-rendered sites (the main gap)

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

### 16.2 Other future ideas

- **Choose-your-pages** discovery mode (show the found pages, let the user tick which to audit).
- **Deeper crawls** for larger audits (opt-in, more pages, background-function architecture).
- **Competitor comparison** (audit two sites and produce a head-to-head).
- **Historical tracking** (re-run monthly, show grade movement over time).
- **A sharper synthesis model** (a stronger model for the final synthesis) if tighter prose is
  wanted — with a background-function architecture to remove the timeout risk that currently makes
  Haiku the safe choice.
