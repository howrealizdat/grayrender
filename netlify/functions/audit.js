// Lazily required so the pure helpers (fact extraction, output guards) can be unit-tested
// without the SDK installed. Netlify still installs it and the handler still uses it.
let _Anthropic = null;
function Anthropic(opts) {
  if (!_Anthropic) _Anthropic = require('@anthropic-ai/sdk');
  return new _Anthropic(opts);
}

/**
 * Grayrender — the full-site AI Marketing Audit.
 *
 * Takes any public URL, fetches the LIVE page server-side, extracts real
 * technical/SEO/content signals, and has Claude produce a structured,
 * director-grade marketing teardown: what works, what's costing leads,
 * quick wins, strategic moves, and where AI creates leverage.
 *
 * SECURITY / KILL SWITCH: the Anthropic key lives ONLY in ANTHROPIC_API_KEY.
 * ACCESS GATE: one site-wide SITE_PASSCODE, checked before any work happens. Returns a
 * partial preview (truncated on the server, so the full audit never leaves it).
 * TRACKING: logs every run + alerts on outside visitors (owner skipped).
 */

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors(), body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { url, focus, passcode, owner, validateOnly, mode } = body;
    /* ---- THE SITE PASSCODE -------------------------------------------------
       One lock for the whole product, checked before any render, fetch or model
       call so a locked visitor costs nothing. The passcode lives ONLY in the
       Netlify env var SITE_PASSCODE, never in this repo, which is public.
       FAILS CLOSED: no SITE_PASSCODE means nothing runs. An unset secret must
       never mean "open to everyone" on a build that spends money per request.
    ---------------------------------------------------------------------- */
    const SITE_PW = process.env.SITE_PASSCODE;
    // Forgiving on purpose: case and ALL whitespace are ignored, so "OPENSESAME",
    // "open sesame" and " Open Sesame " are the same passcode. Someone retyping it from
    // an email should never be turned away over a stray space.
const npw = function (s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); };
    if (!SITE_PW) {
      return json(403, { locked: true, reason: 'unset',
        message: 'This deployment has no SITE_PASSCODE set, so every tool is locked. Set it in the environment and redeploy.' });
    }
    if (npw(passcode) !== npw(SITE_PW)) {
      return json(403, { locked: true, reason: 'bad', message: 'That passcode is not right.' });
    }
    // A cheap way for the unlock screen to check a passcode without spending anything.
    if (validateOnly) return json(200, { ok: true });
    const client = Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    /* ===== MODE: brand ==========================================================
       Read a website once and learn who this company is, so nothing in the suite
       has to be configured by hand. This deliberately sits ABOVE the feature lock:
       it is onboarding, not the premium audit, and a first-time visitor cannot be
       asked for a password before the product will even tell them what it does.
       It reuses the audit's own render and extraction path, so the profile is built
       from the real rendered page rather than a guess about the brand.
    ========================================================================== */
    if (mode === 'brand') {
      const t0 = normalizeUrl(url);
      if (!t0) return json(400, { error: 'Please enter a valid website URL (e.g. https://www.example.com).' });

      let html = '';
      const r = await renderPage(t0, false).catch(function () { return null; });
      if (r && r.html) html = r.html;
      if (!html) {
        const f = await fetchPage(t0).catch(function () { return null; });
        html = (f && f.html) || '';
      }
      if (!html) return json(200, { error: 'That site could not be read. Check the URL, or fill the fields in by hand.' });

      const sig = extractSignals(html, t0);
      const plat = detectPlatform(html, t0, sig);

      /* Refuse BEFORE spending. Bot-walled sites (patagonia.com returned 161 bytes of
         HTML) leave nothing to read, and asking the model to describe a company from an
         empty excerpt costs money to receive "please paste the content". Better to say
         plainly that the page could not be read and offer the manual path. */
      const brandText = String((buildDigest(html, sig, 8000) || {}).text || '');
      if (brandText.length < 250 && !sig.title) {
        console.warn('[brand] unreadable: ' + html.length + ' bytes of HTML, ' + brandText.length + ' chars of text for ' + t0);
        return json(200, { error: 'unreadable',
          message: 'That site would not let me read it. Some sites block automated visits. Try another URL, or enter your details by hand.' });
      }

      const brandMsg =
        'WEBSITE: ' + t0 + '\n' +
        'TITLE: ' + (sig.title || '(none)') + '\n' +
        'META DESCRIPTION: ' + (sig.metaDesc || '(none)') + '\n' +
        'HEADINGS: ' + [].concat(sig.h1s || [], sig.h2s || []).slice(0, 14).join(' | ') + '\n' +
        'BUTTON LABELS: ' + (sig.buttons || []).slice(0, 12).join(' | ') + '\n' +
        'LINK LABELS: ' + ((sig.links || []).map(function (l) { return l.text || l; })).slice(0, 18).join(' | ') + '\n' +
        'PAGE TEXT (excerpt): ' + brandText.slice(0, 2600);

      const bm = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 900,
        temperature: 0,
        system: BRAND_SYSTEM,
        messages: [{ role: 'user', content: brandMsg }]
      });
      const btxt = ((bm.content || []).find(function (b) { return b.type === 'text'; }) || {}).text || '';
      const bh = event.headers || {};
      /* Passcode-gated diagnostics. Brand setup is one model call whose input is
         assembled from several extractors; when it comes back empty there is otherwise
         no way to tell whether the page was unreadable, the excerpt was empty, or the
         model answered in a shape the parser cannot read. */
      const brandDebug = body.debug === true ? {
        excerptChars: brandText.length,
        htmlChars: html.length,
        title: sig.title || '',
        rawModelText: String(btxt || '').slice(0, 900)
      } : undefined;
      logUsage({ time: new Date().toISOString(), tool: 'brand-setup', inputs: { url: t0 },
        ip: bh['x-nf-client-connection-ip'] || bh['x-forwarded-for'] || 'unknown',
        country: bh['x-country'] || 'unknown', userAgent: bh['user-agent'] || 'unknown',
        referer: bh['referer'] || 'direct'
      }, bm, { unlocked: true, owner: owner === true }).catch(function () {});
      return json(200, { profile: parseBrand(btxt), platform: plat, url: t0, debug: brandDebug });
    }


    const h = event.headers || {};
    const clientIp = h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || 'unknown';

    // ===== MODE: discover the site's key pages (crawl homepage + sitemap; no model) =====
    if (mode === 'discover') {
      const t0 = normalizeUrl(url);
      if (!t0) return json(400, { error: 'Please enter a valid website URL (e.g. https://www.example.com).' });
      const found = await discoverPages(t0);
      return json(200, { pages: found.pages, commercial: found.commercial, thin: found.thin });
    }

    // ===== MODE: synthesize the site-level report from the per-page scans =====
    if (mode === 'synthesize') {
      const scans = Array.isArray(body.pages) ? body.pages : [];
      if (!scans.length) return json(400, { error: 'No page results to synthesize.' });
      /* BACKSTOP. The report holds a full-page screenshot per page for the evidence crops.
         Those are for the BROWSER. If one is ever posted back here it contributes nothing to
         the reasoning and quietly eats a synthesis budget that is already the tightest in the
         system, which is exactly how "the analysis step returned no result" happened. Drop
         any image on arrival and say so, rather than fail mysteriously later. */
      var dropped = 0;
      scans.forEach(function (p) {
        if (p && p.shotFull) { delete p.shotFull; dropped++; }
        if (p && p.geo && p.geo.elementsRaw) { delete p.geo.elementsRaw; }
      });
      if (dropped) console.warn('[audit] synthesize: dropped ' + dropped + ' screenshot(s) from the payload; they belong in the browser, not here');

      /* The synthesis is the tightest budget in the system: five pages, one call, one hard
         function timeout. If the full payload does not come back, retry COMPACT rather than
         hand the user "the analysis step returned no result" and ask them to run it again.
         Degrade the input, never the honesty. */
      var msg = null, out = '';
      var runSynth = async function (compact) {
        var m = await client.messages.create({
          model: 'claude-haiku-4-5-20251001', max_tokens: 4096, temperature: 0,
          system: SYNTH_SYSTEM,
          messages: [{ role: 'user', content: buildSynthMessage(url, scans, body.platform, compact) }]
        });
        return m;
      };
      try {
        msg = await runSynth(false);
        out = textOf(msg);
      } catch (e) {
        console.warn('[audit] synthesis failed on the full payload (' + (e && e.message) + '); retrying compact');
      }
      if (!out || !/OVERVIEW/i.test(out)) {
        console.warn('[audit] synthesis returned no usable report; retrying with a compact payload');
        try {
          msg = await runSynth(true);
          out = textOf(msg);
        } catch (e2) {
          console.error('[audit] synthesis failed on the compact payload too: ' + (e2 && e2.message));
        }
      }
      if (!out) return json(502, { error: 'Model returned no text content.' });
      // Safety net: the report must begin at OVERVIEW. Drop any preamble the model may
      // emit before it (e.g. a restated PLATFORM FAIRNESS block) so it never renders.
      out = out.replace(/^[\s\S]*?(?=OVERVIEW\b)/i, '').trim() || out;
      // ENFORCE, do not merely ask: drop absence claims the facts contradict, invented
      // percentages/timeframes, and platform limitations masquerading as owner fixes.
      // Layout claims are allowed only if at least one page was actually rendered and measured.
      var sawLayout = scans.some(function (p) { return p && p.geo; });
      // The corpus is everything the model was actually shown. A number not in here was not
      // read, it was computed, and computed numbers are inventions (see stripDerivedNumbers).
      var corpus = scans.map(function (p) {
        return [p && p.excerpt, p && p.summary, p && p.signals && JSON.stringify(p.signals)].join(' ');
      }).join(' ');
      out = applyGuards(out, body.platform, mergeFacts(scans), sawLayout, corpus);
      // And make sure the BIGGEST quantified defect actually got filed, rather than the
      // model filing the tidy small one on the page it found most interesting.
      out = ensureTopDefectFiled(out, defectLedger(scans));
      logUsage({ time: new Date().toISOString(), tool: 'audit-site', inputs: { url: url, pages: scans.length },
        ip: clientIp, country: h['x-country'] || 'unknown', userAgent: h['user-agent'] || 'unknown', referer: h['referer'] || 'direct'
      }, msg, { unlocked: true, owner: owner === true }).catch(function () {});
      return json(200, { result: out, locked: false, url: url, grade: extractGrade(out), usage: body.debug ? msg.usage : undefined });
    }

    // ===== MODE: requirements (the closing "what it takes" section; its own fast call) =====
    if (mode === 'requirements') {
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 900, temperature: 0,
        system: REQ_SYSTEM,
        messages: [{ role: 'user', content: buildReqMessage(url, body.context, body.platform) }]
      });
      let out = textOf(msg);
      if (!out) return json(502, { error: 'Model returned no text content.' });
      out = applyGuards(out, body.platform, body.facts, body.rendered === true, String(body.context || ''));
      return json(200, { result: out, usage: body.debug ? msg.usage : undefined });
    }

    // ===== MODE: impact (expert summary of WHY the fixes matter; its own fast call) =====
    if (mode === 'impact') {
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 800, temperature: 0,
        system: IMPACT_SYSTEM,
        messages: [{ role: 'user', content: buildImpactMessage(url, body.context, body.platform) }]
      });
      let out = textOf(msg);
      if (!out) return json(502, { error: 'Model returned no text content.' });
      // This section is where the model invents things that were never filed (a "broken"
      // link that does not exist, a fabricated "3x to 5x" lift). Guard it, then drop any
      // bullet that talks about an element the finalized fix list never mentions.
      out = applyGuards(out, body.platform, body.facts, body.rendered === true, String(body.context || ''));
      out = tetherToFixes(out, sectionOf(body.context, /PRIORITI[SZ]ED FIXES/i));
      return json(200, { result: out, usage: body.debug ? msg.usage : undefined });
    }

    /* ===== MODE: shot =====
       The report's evidence crops need a full-page screenshot. That screenshot was being taken
       inside the SCAN, which already renders the page, measures every element, reads the DOM
       and makes a vision call, all against one 26 second budget. Adding a full-page JPEG of a
       7,000px page to that is what pushed it over, and the audit timed out.

       So the screenshot gets its own invocation. It needs no model, so it is cheap (a render
       and a capture, ~8s), it cannot starve the scan, and if it fails the audit still completes
       and the report simply renders without pictures. Evidence is an enhancement, never a
       dependency. */
    if (mode === 'shot') {
      const t = normalizeUrl(url);
      if (!t) return json(400, { error: 'Bad URL' });
      const r = await renderPage(t, true).catch(function () { return null; });
      if (!r || !r.shotFull) {
        console.warn('[audit] shot MISSING for ' + t + ' (the report will render without a screenshot for this page)');
        return json(200, { url: t, shotFull: '', pageW: VIEWPORT.width, pageH: 0, elementsRaw: [] });
      }
      var g = geometryFacts(r.geometry);
      console.log('[audit] shot OK for ' + t + ': ' + Math.round(r.shotFull.length / 1024) + 'kb, ' + ((g && g.elementsRaw) || []).length + ' boxes');
      return json(200, { url: t, shotFull: r.shotFull, pageW: VIEWPORT.width,
        pageH: (g && g.pageHeight) || 0, elementsRaw: (g && g.elementsRaw) || [] });
    }

    // ===== MODE: scan one page (compact, fast) OR default deep single-page audit =====
    const target = normalizeUrl(url);
    if (!target) return json(400, { error: 'Please enter a valid website URL (e.g. https://www.example.com).' });

    // SEE the page: drive a real browser for the rendered DOM, a screenshot, and the measured
    // position of every element. Fail-safe by design: if no provider is configured, or the
    // render errors or times out, `render` is null and we degrade to the HTML-only audit with
    // layout claims banned and UX graded n/a. Honest silence, never a guess.
    const render = await renderPage(target, false).catch(function () { return null; });

    let html = '', fetchError = '';
    if (render && render.html) {
      html = render.html;                        // post-JavaScript DOM, what a visitor gets
    } else {
      try { html = await fetchPage(target); } catch (e) { fetchError = (e && e.message) || 'fetch failed'; }
    }
    if (!html) {
      return json(200, { error: 'reachable', url: target,
        message: 'We could not read that page (' + (fetchError || 'no response') + '). Check the URL is public and try again.' });
    }

    const geo = render ? geometryFacts(render.geometry) : null;
    const shot = render ? render.screenshot : '';

    const sig = extractSignals(html, target);
    sig.geo = geo;
    sig.rendered = !!render;
    // Presence/absence facts, computed in code from the FULL html (not the truncated
    // excerpt the model sees). This is what stops "no FAQ / no email form / thin content"
    // findings on a page that has all of them further down than the excerpt reaches.
    sig.facts = extractFacts(html, sig);
    // LAST, so it wins: when a real browser was open, its DOM is the truth and it OUTRANKS
    // everything a regex scraped out of an HTML string. Every parser bug this project hit
    // (alt="" counted as alt text, <noscript> ghosts counted as images, an apostrophe cutting
    // a meta description in half) was a string-matching artifact that cannot occur here.
    applyDomTruth(sig, render && render.domFacts);
    const isScan = mode === 'scan';
    // Give the model the WHOLE page. The old 3,000 char cap was set to protect the function
    // timeout, but input tokens are prefilled almost for free: wall-clock time is driven by
    // OUTPUT tokens, which max_tokens caps separately. At these budgets the great majority of
    // marketing pages arrive COMPLETE, which is what retires the whole absence/truncation bug
    // class at the source instead of guarding against it downstream.
    const digest = buildDigest(html, sig, isScan ? 18000 : 24000);
    sig.digest = digest;
    const content = digest.text;
    if (content.replace(/\s/g, '').length < 120) sig.spaWarning = true;

    if (isScan) {
      // Vision: hand the model the screenshot of the first screen alongside the measurements,
      // so it can judge hierarchy, emphasis and crowding, which are real but not numbers.
      // Facts constrain, vision interprets, never the other way round.
      const userContent = [];
      if (shot) {
        userContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: shot } });
      }
      userContent.push({ type: 'text', text: buildScanMessage(target, sig, content) });

      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 1200, temperature: 0,
        /* Every page in a run sends this same prompt. A measured 5-page audit reported
           cache_read_input_tokens: 0 on all five scans, paying full price each time.
           Haiku 4.5's minimum cacheable prefix is 4096 tokens and this sits near it, so
           the win is real but not guaranteed: check cache_read_input_tokens with
           debug:true rather than assuming. */
        system: [{ type: 'text', text: SCAN_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userContent }]
      });
      const out = textOf(msg);
      if (!out) return json(502, { error: 'Model returned no text content.', url: target });
      logUsage({ time: new Date().toISOString(), tool: 'audit-scan', inputs: { url: target },
        ip: clientIp, country: h['x-country'] || 'unknown', userAgent: h['user-agent'] || 'unknown', referer: h['referer'] || 'direct'
      }, msg, { unlocked: true, owner: owner === true }).catch(function () {});
      // Hand the synthesis the page OUTLINE and a real excerpt, not a 1,200-char prefix. The
      // 1,000-char slice the synthesis used to receive is precisely what made it report an
      // FAQ, a bio and an email form as "missing" on a page that had all three further down.
      return json(200, { url: target, label: body.label || '', grade: extractGrade(out), scores: extractScores(out), summary: out, platform: sig.platform,
        usage: body.debug ? msg.usage : undefined,
        signals: compactSignals(sig), excerpt: content.slice(0, 4000),
        outline: digest.outline, complete: digest.complete,
        // Geometry travels to the synthesis as TEXT (never the image: five screenshots would
        // blow the synthesis budget, and the measurements are what the fixes must cite).
        geo: geo, rendered: !!render,
        pageW: VIEWPORT.width,
        pageH: (geo && geo.pageHeight) || 0 });
    }

    // default deep single-page audit (kept for internal use / single-page mode)
    const focusLine = focusDirective(focus);
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 4096, temperature: 0,
      system: AUDIT_SYSTEM,
      messages: [{ role: 'user', content: buildUserMessage(target, focus, focusLine, sig, content) }]
    });
    const result = textOf(message);
    if (!result) return json(502, { error: 'Model returned no text content.' });
    logUsage({ time: new Date().toISOString(), tool: 'audit', inputs: { url: target, focus: focus || 'Full Audit' },
      ip: clientIp, country: h['x-country'] || 'unknown', userAgent: h['user-agent'] || 'unknown', referer: h['referer'] || 'direct'
    }, message, { unlocked: true, owner: owner === true }).catch(function () {});
    return json(200, { result: result, locked: false, url: target, grade: extractGrade(result), platform: sig.platform });
  } catch (err) {
    console.error('[audit] error:', err && err.message);
    return json(500, { error: (err && err.message) || 'Audit failed' });
  }
};

/* ============================ prompt ============================ */

const AUDIT_SYSTEM =
'You are a world-class website marketing auditor, the caliber a top conversion-optimization and growth consultancy fields for its best clients. You do not give opinions; you evaluate a page the way the masters of this craft do, reasoning through proven frameworks and tying every finding to a business outcome (qualified leads, trust, search visibility, conversion).\n\n' +

'THE LENSES YOU REASON THROUGH (use them to think; name a principle briefly only when it sharpens a point, and keep the writing plain and jargon-light for a business reader):\n' +
'- Conversion: the LIFT Model (a page\'s value proposition is lifted by Clarity, Relevance and Urgency and dragged down by Anxiety and Distraction); the Fogg Behavior Model (a click needs Motivation + Ability + a clear Prompt, so diagnose weak CTAs as low motivation, too much friction, or a missing/weak prompt); Cialdini\'s principles of persuasion (reciprocity, social proof, authority, scarcity, liking, commitment, unity); Nielsen\'s usability heuristics; Baymard-style UX and form/checkout best practice.\n' +
'- Messaging and positioning: April Dunford positioning (is the category, the ideal customer, and why it beats the alternative instantly clear?); StoryBrand (the customer is the hero, the brand is the guide, one clear plan and CTA); Jobs-To-Be-Done; the 5-second clarity test (can a stranger say what this is, who it is for, and why it is better within 5 seconds above the fold?).\n' +
'- Copy: voice-of-customer over inside-out jargon; clarity over cleverness; specific, benefit-led claims over adjectives.\n' +
'- SEO and technical: search-intent match; Google E-E-A-T (experience, expertise, authoritativeness, trust); title and meta best practice (unique, ~50-60 char title with the primary keyword front-loaded; a compelling ~150-160 char meta description); one clear H1 and a logical heading hierarchy; indexability and mobile/HTTPS hygiene.\n' +
'- Trust: specific, named, results-based social proof beats anonymous praise; quantified specificity beats claims; risk reversal (guarantees, easy exit) lowers anxiety near the CTA.\n\n' +

'EVIDENCE: you will be given real signals extracted from the LIVE page (title tag, meta description, headings, structure, counts) plus the visible content. Base every observation on THAT evidence and quote the actual text you are critiquing. Never invent facts you were not given.\n\n' +

'NEVER COMPUTE A NUMBER, ONLY QUOTE ONE: do not derive, calculate or infer any figure (years in business, percentages, counts, totals, ages). A recent audit wrote \"establishes 27 years of credibility\" for a firm founded in 1997 when the page itself says 29 years: it did arithmetic instead of reading. Another wrote \"four named client testimonials\" where there were three: it COUNTED instead of reading. This applies to numbers spelled as WORDS too (two, three, four, five). Do not count items on the page and do not compute an age, a percentage or a total. Every number you write must appear VERBATIM in the OBSERVED FACTS or in the page content. If a number you want is not there, do not state it.\n\n' +
'META LENGTH: a meta description between roughly 120 and 165 characters is a NORMAL, healthy length. Never describe one in that range as truncated, cut off, or too long, and never file a fix whose only justification is its character count. Only call a meta truncated when it genuinely ends mid-sentence or mid-word.\n\n' +
'GROUNDING AND NO FABRICATION (absolute): base every claim and every Current value only on the SIGNALS and CONTENT you are given, quoted verbatim. NEVER invent, guess, infer, or paraphrase a value; if you do not have the exact current text for an element, do not file a fix or claim about it, and NEVER write "exact text not provided", "platform-default", or a placeholder. Read the real title, meta, and H1s before judging them; they are often already custom and good, and you must verify any title/meta claim against the exact string and the bracketed FACTS (do not say the title lacks a pipe or colon it already has, or that a term is buried when it is already first; if the title/meta already does what you would recommend, do not file that fix; a title that is already custom, keyword-rich, and leads with the primary term is a STRENGTH, not a fix, so only file a title/meta fix for a concrete verifiable defect like a placeholder, a truncation, or a genuinely missing keyword, never merely to re-order or tighten a good one). Quote real link and button labels, but do NOT infer visual funnel order or file "buried/duplicate/fragmented funnel" findings from raw document-order links. ONLY IF the RENDERED LAYOUT block says NOT AVAILABLE: you have not seen the page, so never claim an element is above/below the fold or in a particular on-screen position. IF a RENDERED LAYOUT block IS present, a real browser measured this page: its fold position and element positions are FACTS, you SHOULD use them, and you MUST grade UX rather than marking it n/a. This HTML is PRE-hydration: JavaScript-populated values (countdown timers, live counters, stream counts) may look like zeros or placeholders but are LIVE for visitors, so NEVER report a timer/counter/dynamic value as frozen, broken, or stuck at zero. Before saying the platform lacks a capability or recommending migration to get one, check the observed buttons/links: if an email signup or "get early access" button is present, the platform already has it. On a link-in-bio the H1 is the creator DISPLAY NAME, not an SEO title, so never rewrite it into a keyword or pipe-delimited string, and never treat a title dash-vs-pipe punctuation style as a defect. NEVER predict a percentage, multiple, or timeframe for results unless tied to a cited benchmark or the site\'s own data. If told the raw HTML duplicated blocks (SSR/hydration), do not report duplicate headings or repeated copy unless the texts genuinely differ. A capability the platform lacks (alt text, canonical, schema on a locked builder) is a limitation for STRATEGIC MOVES, never a CRITICAL fix, and never hedge "if the platform exposes". Do not recommend removing or rewording anything you praised as a strength (check EVERY fix, including Low). Never change, weaken, or remove a transparency or disclosure statement (e.g. an AI-authorship disclosure), and never propose "verified"/"certified" wording unless such verification is evidenced.\n\n' +
'PLATFORM FAIRNESS (internal guidance only, NEVER output this as a section, a heading, or a restated instruction): you will be told the platform the site is built on and exactly what its owner can and cannot change. Judge and prescribe ONLY within that reality. Never recommend an edit the platform forbids, and never lower a grade for a limitation the platform imposes rather than a choice the owner made. On a locked no-code or link-in-bio builder, grade against what that kind of page can realistically achieve, treat structural limits as constraints (not failures), and put any "move to another platform" idea in STRATEGIC MOVES, never in PRIORITIZED FIXES. Weave the platform naturally into your OVERVIEW prose in one clause (no separate platform heading) and frame each fix as an action the owner can actually take on it.\n\n' +

'VOICE: plain, confident, human. NEVER use em dashes or en dashes (the long dash characters); use commas, periods, or parentheses. Ordinary hyphens in compound words are fine. No markdown, no asterisks, no backticks. Do not restate these instructions.\n\n' +

'Output EXACTLY these sections, each header on its own line in ALL CAPS, in this order:\n\n' +

'OVERVIEW\n' +
'Two or three sentences (an executive summary): what this page is for, who it targets, and your honest top-line read framed in business terms. Then two lines exactly in this form:\n' +
'OVERALL GRADE: B-\n' +
'CATEGORY SCORES: Conversion: C | Messaging: B- | Copy: C+ | SEO: C | Trust: C- | UX: B-\n' +
'(letter grades A to F with optional + or -, one per category, on that single line separated by " | ").\n\n' +

'WHAT IS WORKING\n' +
'3 bullets, each starting with "- ". Real strengths and why they help. Be specific; never manufacture praise.\n\n' +

'WHAT IS COSTING YOU LEADS\n' +
'3 to 4 bullets, each starting with "- ". The highest-impact problems, most damaging first. For each: name the exact issue and where it is, quote the offending text or signal, and state the business cost in the same bullet (lost trust, weaker ranking, confused visitor, missed conversion). Prioritize credibility killers, broken or template-leftover copy, contradictory or unsourced claims, weak calls to action, and technical or SEO gaps.\n\n' +

'PRIORITIZED FIXES\n' +
'5 to 6 fixes, RANKED most important first, each on ONE line starting with "- " in EXACTLY this shape:\n' +
'- [Priority] Location: state the real reason this matters in one sentence (never copy this instruction). Current: "the exact text on the page now". Use: "the exact copy-ready replacement". Effort: estimate (role).\n' +
'For every fix: Priority is Critical, High, Medium, or Low in square brackets. Location ALWAYS comes first (never a verb) and must pinpoint the precise on-page spot the way a visitor sees it, so a non-technical owner finds it in seconds without guessing (for example "Hero at the very top, the headline above the fold"; "Directly above the contact form"; "Footer, the statistics row"; "Header nav, the Services dropdown"); name the page too when the site has more than one. Separate parts with a comma or "at", and use NO colon inside the location itself. EVERY fix MUST include all three fields in this exact order: Current, then Use, then Effort, each labeled. "Current:" is REQUIRED on every fix and quotes the exact text there now, verbatim and short (or "(none, new element)" only for a genuine addition). Do NOT describe or quote the current text inside the reason sentence instead of the Current field; the reason gives ONLY why it matters, so every fix renders a clean before and after. "Use:" is the single most important part of the whole audit: give the EXACT, finished, copy-and-paste-ready text, written to a professional standard in the site\'s own voice, so the owner pastes it with zero further editing. Never a vague instruction like "make it clearer" or "add a stronger CTA"; always the literal finished words. Write real strings at realistic lengths (title tag 50 to 60 chars, meta description 150 to 160, CTA 2 to 5 words, headline one line) and separate title or meta parts with a pipe | or a colon, NEVER a dash. SOCIAL PROOF YOU CANNOT INVENT: for testimonials, quotes, named reviews, ratings, or statistics, NEVER fabricate a name, a quote, or a number; do not write a fake testimonial or a made-up stat as the replacement. Instead give a clearly labeled template with bracketed placeholders (for example [Client name, title, company]: "[one-sentence result-focused quote]") and tell the owner to insert a REAL, sourced one; for a statistic use a bracketed placeholder like "[verified metric, sourced]". Give exact finished words ONLY for the site\'s own marketing copy (titles, meta, headlines, subheadings, CTAs, value-prop and body copy). "Effort:" must give a REALISTIC time AND the RIGHT role for the actual task, and must VARY across the list, never the same estimate on every fix. Choose the role by what the task really is: title tags, meta descriptions, headlines, body copy, link labels and CTA text are content edits an SEO specialist or copywriter makes in the CMS or SEO plugin (on WordPress that is Yoast or RankMath, NOT code) so do NOT call these developer work; H1 and heading-structure fixes, schema and structured-data markup, redirects, and template or code changes need a developer; visual hierarchy, spacing, imagery, color and contrast, and mobile layout need a designer. Right-size the time: a single title or meta edit in a plugin is 5 to 15 minutes, rewriting copy across several pages is 1 to 2 hours, adding schema markup is 2 to 4 hours (developer), a site-wide heading cleanup is a half to a full day. If the platform brief says the owner does everything in a locked editor, the role is (owner) and estimates stay in minutes. ONE ELEMENT PER FIX: each fix changes exactly one element and has exactly one Current and one Use; never bundle two elements (for example a title AND a meta description) into a single fix, and never write a second Current or Use or sub-labels like "Current H1:" or "Current meta:". Make separate fixes for separate elements and keep the list to the highest-impact ones. Example: - [Critical] Homepage <title> tag: a placeholder title wastes the most valuable SEO slot on the site. Current: "Home Final - Company". Use: "Managed IT Services for Manufacturers | Company". Effort: 10 min (SEO or copywriter, in the SEO plugin). Rank by biggest gain for least effort, and write every fix at the level of a seasoned conversion strategist and senior copywriter, specific and sophisticated, not generic. Include ONLY real changes; never add "keep as is", "retain", or "no change needed" items.\n\n' +

'STRATEGIC MOVES\n' +
'3 bullets, each starting with "- ". Higher-leverage plays for the next quarter: positioning, content, funnel, or measurement. Director-level thinking, not tactics.\n\n' +

'WHERE AI CREATES LEVERAGE\n' +
'3 bullets, each starting with "- ". Specifically how an AI-powered marketing function and tooling would catch and fix these issues at scale (automated site QA, on-brand copy generation, continuous auditing, personalized outreach and content). Tie each to a problem you found above.\n\n' +

'BEFORE YOU FINISH, self-check: (1) every category score is justified by specific evidence on the page; (2) you have scanned for internal contradictions and flagged any in WHAT IS COSTING YOU LEADS, testimonials or stats that conflict or repeat with different numbers, claims with no support, or duplicated copy (for example the same testimonial quoting different results); (3) every fix names a precise location and an exact change, not a vague suggestion.\n\n' +

'RULES: Produce every section exactly once, in the exact order above. Be economical: keep every bullet to a single tight sentence, no filler or repetition, and aim for a total report around 5000 to 6000 characters. Stop immediately after the final WHERE AI CREATES LEVERAGE bullet.';

function focusDirective(focus) {
  var f = (focus || '').toLowerCase();
  if (f.indexOf('messaging') > -1 || f.indexOf('positioning') > -1)
    return 'Weight your analysis toward messaging, positioning, value proposition clarity, and voice consistency.';
  if (f.indexOf('conversion') > -1 || f.indexOf('lead') > -1)
    return 'Weight your analysis toward conversion: calls to action, lead capture, friction, trust signals, and the path to contact.';
  if (f.indexOf('seo') > -1 || f.indexOf('technical') > -1)
    return 'Weight your analysis toward SEO and technical hygiene: title tags, meta descriptions, heading structure, indexability signals, and content depth.';
  if (f.indexOf('brand') > -1 || f.indexOf('trust') > -1)
    return 'Weight your analysis toward brand and trust: credibility, social proof quality, consistency, and anything that reads as unpolished or untrustworthy.';
  if (f.indexOf('ai') > -1 || f.indexOf('opportun') > -1)
    return 'Weight your analysis toward opportunities where AI and automation would create the most marketing leverage.';
  return 'Give a balanced full audit across messaging, conversion, SEO/technical, and brand/trust.';
}

// Anchor every model call to the real current date so the audit applies the most
// current, expert-level standards (not outdated tactics from earlier years). The date
// is read server-side at request time, so it is always right without any hardcoding.
function nowContext() {
  var M = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var now = new Date();
  var d = M[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();
  return 'CURRENT DATE: ' + d + '. Anchor everything to this date. Apply the MOST CURRENT, up-to-date best practices that the industry\'s leading experts follow as of now across SEO, conversion-rate optimization, web UX, accessibility, and brand and content marketing: current Google search-ranking guidance and helpful-content standards, Core Web Vitals, E-E-A-T, structured data, mobile-first and current accessibility (WCAG) expectations, answer-engine and AI-search optimization, and modern messaging and conversion patterns. Judge the site and base every grade, finding, and recommendation on what is proven and current RIGHT NOW; never apply outdated tactics from earlier years.';
}

function buildUserMessage(target, focus, focusLine, sig, content) {
  var lines = [];
  lines.push(nowContext());
  lines.push('');
  lines.push('Audit this web page as a B2B marketing teardown.');
  lines.push('');
  lines.push('URL: ' + target);
  lines.push('FOCUS: ' + (focus || 'Full Audit') + ' — ' + focusLine);
  lines.push('');
  if (sig.platform) {
    lines.push('PLATFORM (' + sig.platform.name + ', ' + sig.platform.kind + '): ' + sig.platform.control);
    lines.push('');
  }
  lines.push('TECHNICAL & SEO SIGNALS (extracted from the live HTML):');
  lines.push('- Page title tag: ' + q(sig.title) + (sig.title ? ' (' + sig.title.length + ' chars)' : ''));
  lines.push('- Meta description: ' + q(sig.metaDesc) + (sig.metaDesc ? ' (' + sig.metaDesc.length + ' chars)' : ''));
  lines.push('- Open Graph title: ' + q(sig.ogTitle));
  lines.push('- Canonical tag: ' + (sig.hasCanonical ? 'present' : 'MISSING'));
  lines.push('- Mobile viewport tag: ' + (sig.hasViewport ? 'present' : 'MISSING'));
  lines.push('- Structured data (JSON-LD): ' + (sig.hasJsonLd ? 'present' : 'MISSING'));
  lines.push('- H1 tags found (' + sig.h1s.length + '): ' + (sig.h1s.length ? sig.h1s.map(q).join(', ') : 'none'));
  lines.push('- H2 headings on page: ' + sig.h2count);
  lines.push('- Images: ' + sig.imgCount + ' (' + sig.imgAlt + ' with alt text)');
  lines.push('- Links: ' + sig.internalLinks + ' internal, ' + sig.externalLinks + ' external');
  lines.push('- HTTPS: ' + (sig.https ? 'yes' : 'NO'));
  lines.push('- Approx visible word count: ' + sig.wordCount);
  if (sig.spaWarning) lines.push('- NOTE: very little server-rendered text was found; the page may rely on JavaScript rendering, so judge content depth cautiously.');
  lines.push('');
  lines.push('VISIBLE PAGE CONTENT (may be truncated):');
  lines.push(content);
  return lines.join('\n');
}

function q(s) { return s ? '"' + String(s).replace(/"/g, "'") + '"' : '(none)'; }

function textOf(message) {
  var b = (message && message.content || []).find(function (x) { return x.type === 'text'; });
  return b ? b.text : '';
}
function extractScores(t) {
  var m = String(t || '').match(/CATEGORY SCORES?:\s*(.+)/i);
  return m ? m[1].trim() : '';
}

/* ---------- per-page SCAN (fast, compact; feeds the site synthesis) ---------- */
const SCAN_SYSTEM =
'You are a world-class website marketing auditor doing a FAST per-page scan as part of a full-site audit. Reason through proven frameworks (LIFT model, Fogg B=MAP, Cialdini, Nielsen heuristics, April Dunford positioning, StoryBrand, the 5-second clarity test, E-E-A-T, title/meta and heading best practice, social proof). Base everything on the real signals and content provided and quote the actual text. Plain voice, NEVER em dashes or en dashes, no markdown.\n\n' +
'SEEING THE PAGE: if a RENDERED LAYOUT block is present, a real browser measured this page and you are also given a SCREENSHOT of the first screen. Those measurements are facts: use them to judge what a visitor sees before scrolling, the true visual order, and CTA prominence, and grade UX from what you can actually see. If the block says NOT AVAILABLE, you have not seen the page: say NOTHING about layout, the fold, position, prominence or anything being "buried", and grade UX as n/a. HTML document order is never a proxy for visual order.\n\n' +

'THE TRUNCATION RULE (absolute): the excerpt stops because the AUDITOR cut it to a character budget, not because the page ends or the copy is broken. Never report the page copy as truncated, cut off, incomplete, or ending mid-sentence based on where the excerpt stops, and never quote the excerpt\'s final fragment as evidence of a defect. The TITLE and META are given complete, so a genuine mid-sentence cut in one of THOSE is a real defect you may file.\n\n' +

'THE ABSENCE RULE (absolute): the CONTENT you are given is a TRUNCATED excerpt of the START of the page, never the whole page. You may NEVER report something as missing, absent, thin, or lacking because you did not see it in the excerpt. Not seeing it is NOT evidence it is not there. Assert an absence ONLY when the OBSERVED FACTS block explicitly says NO for it; if the FACTS say YES, it EXISTS, so never call it missing and never recommend adding it. Use the word count from the FACTS, never your impression of the excerpt.\n\n' +

'NEVER COMPUTE A NUMBER, ONLY QUOTE ONE: do not derive, calculate or infer any figure (years in business, percentages, counts, totals, ages). A recent audit wrote \"establishes 27 years of credibility\" for a firm founded in 1997 when the page itself says 29 years: it did arithmetic instead of reading. Another wrote \"four named client testimonials\" where there were three: it COUNTED instead of reading. This applies to numbers spelled as WORDS too (two, three, four, five). Do not count items on the page and do not compute an age, a percentage or a total. Every number you write must appear VERBATIM in the OBSERVED FACTS or in the page content. If a number you want is not there, do not state it.\n\n' +
'GROUNDING, NO FABRICATION: base every observation only on the SIGNALS and CONTENT provided; quote the exact text. NEVER invent, guess, or paraphrase a value; if the exact current text is not in the data, do not claim it and do not write "not provided" or a placeholder. Read the real title, meta, and H1s before judging them (they are often already custom and good). Quote real link and button labels from the provided lists, never invent link text (no generic "Listen/Watch/Play"), but do NOT infer visual funnel order or file "buried/duplicate/fragmented funnel" findings from the raw document-order link list (it mixes CTAs, nav, utility, and hidden citation links). ONLY IF the RENDERED LAYOUT block says NOT AVAILABLE: you have not seen the page, so never claim an element is above/below the fold or in a particular on-screen position, and grade UX as n/a. IF a RENDERED LAYOUT block IS present, a real browser measured this page and you also have a SCREENSHOT: the fold and element positions are FACTS, you SHOULD cite them, and you MUST give UX a real letter grade (n/a is FORBIDDEN when you can see the page). This HTML is PRE-hydration: values populated by JavaScript (countdown timers, live counters, stream counts) may look like zeros or placeholders but are LIVE for visitors, so NEVER report a timer/counter/dynamic value as frozen, broken, or stuck at zero. Before saying the platform lacks a capability, check the observed buttons/links: if an email signup or "get early access" button is present, the platform already has it, so do not recommend migrating to get it. On a link-in-bio the H1 is the creator DISPLAY NAME, not an SEO title, so never rewrite it into a keyword or pipe-delimited string. Never treat a title dash-vs-pipe punctuation style as a defect. Verify any title/meta claim against the exact string and the bracketed FACTS: do not say the title lacks a pipe or colon it already has, or that a term is buried when it is already first. Never invent a percentage or timeframe for results. Never flag a transparency or disclosure statement (e.g. an AI-authorship disclosure) as a copy problem; a truthful disclosure is a trust strength. If a note says the raw HTML duplicated blocks (SSR/hydration), do NOT report duplicate headings or repeated copy unless the duplicated texts genuinely differ.\n\n' +
'PLATFORM FAIRNESS (critical): you are told the platform this page runs on and what its owner can and cannot change. Grade and list issues ONLY within that reality. Do NOT penalize a locked no-code or link-in-bio page (single page, platform-set title/meta, heading structure it cannot edit, thin copy, no schema, no blog) for limits it cannot change; grade it against what that kind of page should do, and only raise issues the owner can actually fix on the platform. A capability the platform lacks (alt text, canonical, schema) is a limitation, not an owner issue.\n\n' +
'Output EXACTLY this compact format and nothing else:\n' +
'GRADE: <A to F with optional + or ->\n' +
'CATEGORY SCORES: Conversion: <g> | Messaging: <g> | Copy: <g> | SEO: <g> | Trust: <g> | UX: <g>\n' +
'WINS:\n' +
'- <one short real strength> (1 to 2 bullets)\n' +
'ISSUES:\n' +
'- [<Critical/High/Medium/Low>] <exact element or location>: <the problem in one line, quote the offending text, and the business cost>\n' +
'(3 to 5 issues, most damaging first). Keep it terse; this feeds a site-level synthesis.';

function buildScanMessage(target, sig, content) {
  var L = [];
  L.push(nowContext());
  L.push('');
  L.push('Scan this page: ' + target);
  if (sig.platform) L.push('PLATFORM (' + sig.platform.name + ', ' + sig.platform.kind + '): ' + sig.platform.control);
  L.push('SIGNALS: title=' + q(sig.title) + ' (' + (sig.title ? sig.title.length : 0) + ' chars); meta=' + q(sig.metaDesc) +
    '; H1s(' + sig.h1s.length + ')=' + (sig.h1s.map(q).join(', ') || 'none') + '; H2s=' + sig.h2count +
    '; canonical=' + (sig.hasCanonical ? 'y' : 'MISSING') + '; viewport=' + (sig.hasViewport ? 'y' : 'MISSING') +
    '; jsonld=' + (sig.hasJsonLd ? 'y' : 'no') + '; imgs=' + sig.imgCount + ' (' + sig.imgAlt + ' alt); links=' +
    sig.internalLinks + ' int/' + sig.externalLinks + ' ext; https=' + (sig.https ? 'y' : 'NO') + '; words=' + sig.wordCount +
    (sig.spaWarning ? '; NOTE: little server-rendered text (may be JS-rendered)' : '') +
    (sig.ssrDuplicated ? '; NOTE: server-render+hydration repeats blocks the live visitor sees only ONCE, so treat content as appearing a single time and do NOT report any duplicated/repeated/doubled headings or copy (only flag if two headings have genuinely different text)' : '') +
    (sig.contentThin ? '; NOTE: very little readable content was found (page may be client-rendered) — audit only what is provided and say the read was limited rather than guessing at body content' : ''));
  var lb = linksBlock(sig);
  if (lb) { L.push(''); L.push(lb); }
  var fb = factsBlock(sig.facts);
  if (fb) { L.push(''); L.push(fb); }
  L.push('');
  L.push(geometryBlock(sig.geo));
  var db = digestBlock(sig.digest);
  if (db) { L.push(''); L.push(db); }
  L.push('');
  L.push('PAGE CONTENT:');
  L.push(content);
  return L.join('\n');
}

/* ---------- SITE-LEVEL synthesis (same 6-section shape as the deep audit) ---------- */
const SYNTH_SYSTEM =
'You are a world-class website marketing strategist delivering a SITE-LEVEL audit, the kind a top growth consultancy gives a client. You are given per-page scans (grade, category scores, wins, issues) for the most important pages of ONE site. Synthesize them: find PATTERNS across pages, judge the site as a whole, and make CROSS-PAGE recommendations (what to promote, relocate, or standardize across pages). Reason through proven frameworks (LIFT, Fogg B=MAP, Cialdini, April Dunford positioning, StoryBrand, the 5-second clarity test, E-E-A-T). Reference specific pages by name. Plain confident voice, NEVER em dashes or en dashes, no markdown.\n\n' +
'Output EXACTLY these sections, each header on its own line in ALL CAPS, in this order:\n\n' +
'NEVER COMPUTE A NUMBER, ONLY QUOTE ONE: do not derive, calculate or infer any figure (years in business, percentages, counts, totals, ages). A recent audit wrote \"establishes 27 years of credibility\" for a firm founded in 1997 when the page itself says 29 years: it did arithmetic instead of reading. Another wrote \"four named client testimonials\" where there were three: it COUNTED instead of reading. This applies to numbers spelled as WORDS too (two, three, four, five). Do not count items on the page and do not compute an age, a percentage or a total. Every number you write must appear VERBATIM in the OBSERVED FACTS or in the page content. If a number you want is not there, do not state it.\n\n' +
'GROUNDING AND NO FABRICATION (absolute, overrides everything): every factual claim and every Current value MUST be quoted verbatim from the VERBATIM SIGNALS or VISIBLE CONTENT provided for that page. Quote real link and button labels from the provided lists, but NEVER infer a link\'s visual position, funnel order, or "buried / duplicate / fragmented funnel" problems from the raw document-order link list (it mixes CTA buttons, navigation, utility links, and citations or links hidden behind "Show More", so its order is not what a visitor sees). ONLY IF a page\'s RENDERED LAYOUT block says NOT AVAILABLE: you have not seen that page, so NEVER assert or speculate that any element is "above the fold", "below the fold", "buried", or in a particular on-screen position, and grade UX as n/a. IF a page carries a RENDERED LAYOUT block, a real browser MEASURED it: the fold line and every element position are FACTS you SHOULD cite by name, you may say exactly what a visitor sees before scrolling and recommend moving an element up or down, and you MUST give UX a real letter grade (writing "n/a" for UX when you can see the page is FORBIDDEN and is itself an error). VERIFY BEFORE CRITIQUING THE TITLE OR META: check your claim against the exact provided string and the bracketed FACTS; never say the title lacks a pipe or colon it already has, and never say a keyword is "buried", "late", or "missing" when it is already present or already first; if the title or meta already does what you would recommend, do NOT file that fix. A title or meta that is already custom, keyword-rich, and leads with the primary term is a STRENGTH (put it in WHAT IS WORKING), NOT a fix: do NOT file a title or meta fix merely to re-order, tighten, or "front-load" it, and do not invent a subtle deficiency to justify one. Only file a title or meta fix for a concrete, verifiable defect: a placeholder like "Home Final", a mid-sentence truncation, a duplicated word, a genuinely missing primary keyword, or a real error. SEVERITY: a real defect (placeholder, truncation, missing primary keyword) is HIGH or CRITICAL; but a purely stylistic refinement of an already-custom working title (re-ordering terms, changing which word leads, tightening) is at most LOW, and its one sentence must explicitly acknowledge the current title already works, so it reads as an optional polish, not a problem. When in doubt about a custom title, praise it in WHAT IS WORKING and file no fix. NEVER predict a specific percentage, multiple, or timeframe for results (no "15 to 25 percent lift", no "within 4 to 6 weeks") unless it is tied to a named, cited benchmark or the site\'s own stated data; state direction and mechanism (higher CTR, clearer intent, lower bounce) without inventing numbers. NEVER invent, infer, guess, paraphrase, or assume a Current value or any on-page fact. If you do not have the exact current text for an element, you may NOT file a fix or make a claim about it. NEVER write "exact text not provided", "platform-default", "generic labels", "appears to", "likely", or any placeholder in a Current value; if it is not in the provided data, it does not exist for you. Read the actual title, meta, H1s, and content excerpt before saying anything about them (the site often already has good custom values, do not assume they are defaults).\n\n' +
'THE TRUNCATION RULE (absolute): the excerpt STOPS because the auditor cut it to fit a character budget, NOT because the page ends there and NOT because the site\'s copy is broken. The page always continues past the cut. Therefore you may NEVER report the page copy as truncated, cut off, incomplete, ending mid-sentence, or "trailing off" based on where the excerpt stops, and you may never quote the final fragment of the excerpt as evidence of a defect. A previous audit filed a HIGH fix claiming a product section was "truncated mid-sentence at Key Capabilities Custom prom" when the live page read "Key Capabilities Custom prompts tuned for your tech stack" perfectly well: it mistook the auditor\'s own scissors for the client\'s defect. EXCEPTION: the TITLE and META DESCRIPTION are given to you COMPLETE, so if one of those genuinely ends mid-sentence, that is a real defect and you should file it.\n\n' +

'SEEING THE PAGE: each page may carry a RENDERED LAYOUT block. When it is present, a real browser measured every element, so the fold position, what is above or below it, the true visual order and CTA prominence are all MEASURED FACTS: you may cite them, you may recommend moving an element up or down, and you MUST grade UX. When the block says NOT AVAILABLE, you did not see the page: say nothing whatsoever about layout, position, the fold, prominence or anything being "buried", and grade UX as n/a. HTML document order is NOT visual order and is never a substitute for it. A previous audit inferred that "streaming links are buried below merch" from document order alone; it was false, and it is the reason this rule exists.\n\n' +

'COVERAGE FIRST: each page is labelled COMPLETE or PARTIAL. When a page is COMPLETE you have been given the ENTIRE page, so you may reason normally about what is and is not on it (still cross-checking the OBSERVED FACTS, which are computed in code and outrank your reading). When a page is PARTIAL, everything below applies with full force. Either way, a PAGE OUTLINE lists every heading on the page top to bottom, so you always know what sections exist even when the text is cut.\n\n' +

'THE ABSENCE RULE (absolute whenever coverage is PARTIAL): the VISIBLE CONTENT you are given for that page is a TRUNCATED excerpt of the START of it. You are not seeing the whole page. Therefore you may NEVER conclude that an element, section, or feature is missing, absent, thin, lacking, or "not on the page" because you did not see it in the excerpt. Not seeing something is NOT evidence it is not there. You may assert an absence ONLY when the OBSERVED FACTS block for that page explicitly says NO for it. If the FACTS say YES, that element EXISTS: never call it missing, never recommend adding it, never recommend a platform migration to obtain it. If a fact is not listed in the FACTS block at all, you cannot speak to its presence or absence, so say nothing about it. This one rule is the difference between an audit and a hallucination: every false finding this system has ever produced was an absence claim inferred from a truncated excerpt (a "missing" email signup form, a "missing" FAQ, "thin 200-300 word content") on a page that had all of them further down. Never do it again. The same applies to word count: use the word count in the FACTS, never your own impression of the excerpt length.\n\n' +

'PRE-HYDRATION HTML (applies ONLY to a page whose RENDERED LAYOUT block says NOT AVAILABLE; a page that WAS rendered gave you the post-JavaScript DOM, so this paragraph does not apply to it and you must not describe its values as pre-hydration): what you are given for an UNRENDERED page is the HTML BEFORE JavaScript runs, so any value populated by JavaScript (countdown timers, live counters, stream/view counts, carousels, lazy-loaded sections) may appear as zeros, empty, or a placeholder here but is LIVE for real visitors. NEVER report a countdown, timer, counter, or dynamic value as frozen, broken, stuck at zero, or missing; you did not observe its live value, so you may not file any finding about it. CAPABILITY BEFORE MIGRATION: before recommending a platform migration to GET a capability (email capture, a signup form, a store), check the observed BUTTON and LINK labels and the content; if it is already present (for example an email signup or "get early access" button is in the list), the platform HAS it, so NEVER recommend migrating to obtain a feature you can see is already working. ELEMENT IDENTITY: identify what an element renders as to a human before rewriting it. On a link-in-bio the H1 is the artist or creator DISPLAY NAME shown in large type on the profile card, NOT an SEO title, so NEVER rewrite it into a keyword string or a pipe-delimited title (that would look broken to every visitor); leave the display-name H1 alone. Never treat title punctuation style (an em dash vs a pipe) as a defect, and never recommend swapping one for the other.\n\n' +
'CAPABILITY, NO HEDGING: use the platform\'s real capabilities and never write "if the platform exposes X". If the platform cannot do something (a link-in-bio builder cannot add per-image alt text, a canonical tag, or JSON-LD schema), that is a PLATFORM LIMITATION: mention it once under WHAT IS COSTING YOU LEADS or as a STRATEGIC MOVE (migrate to a full site), and NEVER file it as a PRIORITIZED FIX and NEVER mark it CRITICAL, because the owner cannot fix it on this platform.\n\n' +
'SEVERITY RUBRIC: CRITICAL is only for an issue that is (a) actually observed in the provided data, (b) fixable by the owner on THIS platform, and (c) materially costly. A platform limitation the owner cannot fix is never CRITICAL. NO CONTRADICTION (applies to EVERY fix, including Medium and Low): never recommend removing, deleting, shortening, rewording, or replacing anything you named as a strength in WHAT IS WORKING; before finishing, check EVERY fix against your strengths and drop any that conflict. DISCLOSURE PROTECTION: never recommend changing, weakening, or removing a transparency or disclosure statement (for example an AI-authorship disclosure like "human-authored, plainly disclosed", a sponsorship disclosure, or legal wording); and never propose wording that implies third-party verification or certification ("verified", "certified", "authenticated") unless such verification is actually evidenced in the provided content. A truthful disclosure is always a strength, never a copy defect.\n\n' +
'PLATFORM FAIRNESS (internal guidance only, NEVER output this as a section, a heading, or a restated instruction): you are told the platform the site runs on and what its owner can and cannot change. Judge the site and write every fix ONLY within that reality. Never lower the grade for limits the platform imposes, and never recommend edits it forbids. If it is a locked no-code or link-in-bio builder, grade it as that kind of site, keep fixes to what the platform allows, and put any "move to a real website" idea in STRATEGIC MOVES, never in PRIORITIZED FIXES. Weave the platform naturally into the OVERVIEW prose in one clause; do NOT create a separate platform or fairness heading. The report begins with the OVERVIEW header and nothing before it.\n\n' +
'OVERVIEW\n' +
'Two or three sentences: what this site is, the platform it runs on, who it targets, and your honest site-wide read in business terms. Then two lines exactly:\n' +
'OVERALL GRADE: <A to F with optional + or ->\n' +
'CATEGORY SCORES: Conversion: <g> | Messaging: <g> | Copy: <g> | SEO: <g> | Trust: <g> | UX: <g>\n' +
'(site-wide letter grades weighing all pages.) Do not state a letter grade anywhere in the prose or bullets; grades appear only on these two lines.\n\n' +
'WHAT IS WORKING\n' +
'3 bullets, each "- ". Site-wide strengths and assets worth amplifying; name the page where relevant.\n\n' +
'WHAT IS COSTING YOU LEADS\n' +
'3 to 4 bullets, each "- ". The highest-impact SITE-WIDE problems and PATTERNS that repeat across pages (for example a template artifact on several pages, or positioning that shifts page to page). Name the pages, quote the evidence, and state the business cost.\n\n' +
'PRIORITIZED FIXES\n' +
'5 to 6 fixes, ranked most important first, each on ONE line in EXACTLY this shape:\n' +
'- [Priority] Page and element: state the real reason this matters in one sentence (never copy this instruction). Current: "exact text there now". Use: "exact copy-ready replacement". Effort: est (role).\n' +
'Priority is Critical, High, Medium, or Low. Location comes first (never a verb) and must pinpoint BOTH the exact page, named with its URL path, AND the precise on-page spot described the way a visitor sees it, so a non-technical owner finds it in seconds without guessing. Separate the page from the spot with a comma or the word "at", and use NO colon inside the location itself. Good locations: "Home page (/), the hero headline at the very top"; "Pricing page (/pricing), directly above the pricing table"; "About page (/about), the founder paragraph"; "Footer on every page, the statistics row". Too vague, never do this: "the hero", "homepage", "a testimonial". EVERY fix MUST include all three fields in this exact order: Current, then Use, then Effort, each labeled. "Current:" is REQUIRED on every fix and is the exact text on the page now, in quotes (or "(none, new element)" only for a genuine addition). Do NOT describe or quote the current text inside the reason sentence instead of the Current field; the reason gives ONLY why it matters, and the Current field shows the exact text now, so every fix renders a clean before and after. "Use:" is the EXACT, finished, copy-and-paste-ready replacement in the site\'s voice, written to a professional standard, the literal words to paste and never a vague instruction; for a title or meta separate parts with a pipe | or a colon, NEVER a dash, at realistic lengths. SOCIAL PROOF YOU CANNOT INVENT: for testimonials, quotes, named reviews, ratings, or statistics, NEVER fabricate a name, a quote, or a number; do not write a fake testimonial or a made-up stat as the replacement. Instead give a clearly labeled template with bracketed placeholders (for example [Client name, title, company]: "[one-sentence result-focused quote]") and tell the owner to insert a REAL, sourced one; for a statistic use a bracketed placeholder like "[verified metric, sourced]". Give exact finished words ONLY for the site\'s own marketing copy (titles, meta, headlines, subheadings, CTAs, value-prop and body copy). "Effort:" must give a REALISTIC time AND the RIGHT role for the actual task, and must VARY across the list, never the same estimate on every fix. Choose the role by what the task really is: title tags, meta descriptions, headlines, body copy, link labels and CTA text are content edits an SEO specialist or copywriter makes in the CMS or SEO plugin (on WordPress that is Yoast or RankMath, NOT code) so do NOT call these developer work; H1 and heading-structure fixes, schema and structured-data markup, redirects, and template or code changes need a developer; visual hierarchy, spacing, imagery, color and contrast, and mobile layout need a designer. Right-size the time: a single title or meta edit in a plugin is 5 to 15 minutes, rewriting copy across several pages is 1 to 2 hours, adding schema markup is 2 to 4 hours (developer), a site-wide heading cleanup is a half to a full day. If the platform brief says the owner does everything in a locked editor, the role is (owner) and estimates stay in minutes. ONE ELEMENT PER FIX: each fix changes exactly one element and has exactly one Current and one Use; never bundle two elements (for example a title AND a meta description, or an H1 AND a meta) into a single fix, and never write a second Current or Use or sub-labels like "Current H1:" or "Current meta:". If a page needs its title, meta, and H1 all fixed, that is three separate fixes; keep the whole list to the 5 or 6 highest-impact atomic fixes. Write every fix at the level of a senior conversion strategist and copywriter, specific and sophisticated. Include only real changes.\n\n' +
'STRATEGIC MOVES\n' +
'3 bullets, each "- ". Higher-leverage CROSS-PAGE plays: what to promote, relocate, or standardize across the site (for example, pull the strongest page voice onto the homepage), plus positioning, funnel, or measurement.\n\n' +
'WHERE AI CREATES LEVERAGE\n' +
'3 bullets, each "- ". How an AI-powered marketing function and continuous site-wide auditing would catch and fix these at scale.\n\n' +
'NOT VERIFIED IN THIS AUDIT\n' +
'2 to 3 bullets, each "- ", each ONE short factual sentence. This is the honesty appendix: state plainly what this audit could NOT observe and therefore did not judge, so the reader knows the scope. Only list what was GENUINELY not observed for THIS site. If a page carries a RENDERED LAYOUT block then its JavaScript-rendered content AND its visual layout WERE observed, so you must NOT list either as unverified for that page: saying so is a false statement about your own scope, and the honesty appendix of all places must be honest. Entries that stay true even after a render: content revealed only by interaction (behind \"Show More\", accordions, tabs) was not expanded; mobile and smaller viewports were not measured (the render is desktop 1280x900 only); a live value that changes second by second is a snapshot. For a page that was NOT rendered, the old limits still apply: JavaScript-rendered values were not read, and the visual layout and fold were not seen. Include ONLY genuine observation limits that apply to THIS site; never put an actual finding, recommendation, or criticism here, and never speculate about what the unobserved values might be.\n\n' +
'BREVITY IS MANDATORY. Each bullet is ONE plain sentence of at most 30 words. Do NOT chain clauses with semicolons or trailing "this/which means" explanations, and do not pile up examples inside one bullet. State the finding and its business cost, nothing more. A PRIORITIZED FIXES line may add the exact change but stays on one line.\n\n' +
'RULES: every section exactly once, in the order above; no repetition; total report under 6000 characters. Stop immediately after the last NOT VERIFIED IN THIS AUDIT bullet. Proofread before finishing: put a single space between every word (never fuse two words together, e.g. write "subdomain if", not "subdomainif"), and fix any typos or dropped spaces.';

/* ---------- REQUIREMENTS: the closing "what it takes" section (its own fast call) ---------- */
const REQ_SYSTEM =
'You are a marketing operations lead scoping the work to fix a website you just audited. Given a short summary of the site and its issues, output ONLY an implementation section: the tools, access, people, and time it takes, framed as the work a marketing function owns, not a quick patch. Plain voice, NEVER em dashes or en dashes, no markdown.\n\n' +
'ADAPT TO THE PLATFORM you are told the site uses. If it is a locked no-code or link-in-bio builder (for example Hopp, Linktree, Carrd, a bio page), the plan is SMALLER and platform-appropriate: access to the platform account and its editor (NOT a codebase, CMS, or staging server); the platform\'s own analytics or a light add-on and simple UTM links (NOT Google Analytics 4 plus Looker plus Screaming Frog); a copywriter and designer to sharpen the profile, headline, and link priority; and, only if the business has outgrown a single bio page, a separate bullet for building a real website on its own domain with its own realistic timeline. Do NOT prescribe developer, CMS, staging, or SEO-crawler tooling that a locked platform cannot use, and keep the timeline proportional (a bio-page tune-up is days to a couple of weeks, not 8 to 12). For a normal website (a CMS, a website builder, or custom code), use the fuller plan below.\n\n' +
'Output EXACTLY this and nothing else:\n' +
'WHAT IT TAKES TO FIX THIS\n' +
'5 to 6 bullets, each starting with "- ", each naming a realistic time estimate. Cover, one per bullet: (1) codebase and CMS access, a developer plus the site platform or WordPress admin and a staging environment for safe QA before anything ships; (2) analytics and reporting, Google Analytics 4 and Google Search Console for measurement plus a reporting layer such as Looker Studio for back-end dashboards and stakeholder reports; (3) an SEO crawler such as Screaming Frog or Semrush to find and track every title, meta, and heading issue site-wide; (4) conversion tooling, a session and heatmap tool such as Microsoft Clarity or Hotjar plus an A/B testing tool to validate changes with real behavior; (5) the people, a developer, a copywriter, a designer, and a marketing owner to run and measure it; and (6) an honest phased timeline in weeks. Timelines must be REALISTIC and account for discovery, content production, stakeholder review and approval cycles, QA, and iteration; do NOT lowball, a proper messaging overhaul plus analytics and reporting setup is a multi-week engagement (roughly 8 to 12 weeks phased, the analytics and reporting foundation alone taking 2 to 3 weeks). Each bullet may run to two sentences. Stop after the last bullet. Proofread before finishing: put a single space between every word (never fuse two words together), and fix any typos or dropped spaces.';

function buildReqMessage(url, context, platform) {
  var p = platform ? 'PLATFORM (' + platform.name + ', ' + platform.kind + '): ' + platform.control + '\n\n' : '';
  return nowContext() + '\n\n' + 'Site: ' + (url || '') + '\n\n' + p + 'Audit summary (tailor the plan to it):\n' + String(context || '').slice(0, 2000) +
    '\n\nNow output only the WHAT IT TAKES TO FIX THIS section.';
}

/* ---------- IMPACT: expert summary of WHY the fixes matter (its own fast call) ---------- */
const IMPACT_SYSTEM =
'You are a senior SEO and conversion-rate-optimization strategist writing the closing summary of a website audit. You are given the FINALIZED FIX LIST from the audit. In plain, expert language, explain WHY those filed changes matter as a whole and what they are expected to do for the business.\n\n' +
'TRACEABILITY (absolute): every sentence you write must map to one or more fixes in the FINALIZED FIX LIST you are given. Discuss ONLY those fixes. NEVER mention, imply, or invent any element, link, platform, page, or change that is not in the list; NEVER describe anything as "broken", "missing", or "absent" unless the list itself says so. If the list has only two fixes, your summary covers exactly those two, nothing more. This summary is a synthesis of the filed fixes, not a fresh audit. Concretely: do NOT introduce a "broken" link, a "missing" platform link, a reordering, or any other change that is not literally in the list below. Do not name an element the list does not name. If you find yourself writing about something and cannot point to the fix it came from, delete the sentence. Reason like a professional: search ranking (crawlability and index hygiene, title and meta relevance to search intent, one clear H1 and heading structure, E-E-A-T and credible sourcing, content depth and clarity, Core Web Vitals) AND conversion and trust (the 5-second clarity test, message match, reduced friction, specific social proof, risk reversal). Ground every point in the ACTUAL issues and fixes in this audit, never generic filler. NEVER use em dashes or en dashes, no markdown.\n\n' +
'MATCH THE PAYOFF TO THE PLATFORM you are told about: for a locked link-in-bio page, deep organic ranking barely applies, so emphasize instant clarity, click-through to the right destination, credibility, and fan or lead conversion rather than SEO ranking; for a full website, weigh both ranking and conversion.\n\n' +
'Output EXACTLY this and nothing else:\n' +
'WHY THESE CHANGES MATTER\n' +
'3 to 4 bullets, each starting with "- ", each one tight expert sentence. Across the bullets cover: the ranking or discoverability payoff, the conversion and trust payoff, and the compounding effect of doing these fixes together, and end with the DIRECTION of the outcome to expect. Reference the specific problems and fixes from THIS audit. CRITICAL: NEVER invent a specific percentage, multiple, or timeframe (do NOT write "15 to 25 percent lift", "double your traffic", or "within 4 to 6 weeks") unless it is tied to a named, cited benchmark or the site\'s own stated data; describe the direction and mechanism (higher CTR because the title matches intent, lower bounce because the page is clearer) without fabricating numbers. Stop after the last bullet. Proofread: a single space between every word, no fused words, fix any typos.';

// Extract one report section (from its header line to the next known header).
function sectionOf(text, startRe) {
  var lines = String(text || '').split('\n');
  var HDR = /^(OVERVIEW|WHAT IS WORKING|WHAT IS COSTING|PRIORITI[SZ]ED FIXES|WHY THESE|STRATEGIC MOVES|WHERE AI|WHAT IT TAKES|NOT VERIFIED)/i;
  var start = -1;
  for (var i = 0; i < lines.length; i++) { if (startRe.test(lines[i])) { start = i; break; } }
  if (start < 0) return '';
  var end = lines.length;
  for (var j = start + 1; j < lines.length; j++) { if (HDR.test(lines[j].trim())) { end = j; break; } }
  return lines.slice(start + 1, end).join('\n').trim();
}

function buildImpactMessage(url, context, platform) {
  var p = platform ? 'PLATFORM (' + platform.name + ', ' + platform.kind + '): ' + platform.control + '\n\n' : '';
  // Pass the FINALIZED fix list (plus strengths for context), never a truncated blob of
  // the whole report: a free-running summary over partial context is how the model
  // invented fixes that were never filed (e.g. a "broken" link that does not exist).
  var fixes = sectionOf(context, /PRIORITI[SZ]ED FIXES/i);
  var working = sectionOf(context, /WHAT IS WORKING/i);
  var payload = fixes
    ? 'THE FINALIZED FIX LIST (your summary may discuss ONLY these):\n' + fixes.slice(0, 2400) +
      (working ? '\n\nSTRENGTHS ALREADY ON THE SITE (context only; never propose changing these):\n' + working.slice(0, 800) : '')
    : 'The audit and its prioritized fixes (base your reasoning on these):\n' + String(context || '').slice(0, 2600);
  return nowContext() + '\n\n' + 'Site: ' + (url || '') + '\n\n' + p + payload +
    '\n\nNow output only the WHY THESE CHANGES MATTER section.';
}

/* The synthesis carries FIVE pages in ONE call against a hard function timeout, so its budget
   is the tightest in the system. Adding rendered geometry took the payload from ~18k to ~39k
   chars and pushed a call that already ran 27.3s over the cliff, which surfaced to the user as
   "the analysis step returned no result".

   The excerpt is the cheapest thing to cut and the least missed: by this point the synthesis
   already has the page OUTLINE, the verbatim signals (title, meta, H1s, H2s, links, buttons),
   the OBSERVED FACTS, the measured geometry, and the per-page scan findings. The raw text is
   only there to quote body copy from. 1,200 chars of it is plenty; 4,000 was indulgent.

   `compact` trims further still and is used for the automatic retry, so a payload that blows
   the budget degrades to a smaller one instead of failing in the user's face. */
function buildSynthMessage(url, scans, platform, compact) {
  var L = [];
  L.push(nowContext());
  L.push('');
  L.push('Site: ' + (url || '') + '   Pages audited: ' + scans.length);
  if (platform) L.push('PLATFORM (' + platform.name + ', ' + platform.kind + '): ' + platform.control);
  L.push('');
  scans.forEach(function (p, i) {
    L.push('=== PAGE ' + (i + 1) + ': ' + (p.label ? p.label + ' — ' : '') + (p.url || '') + '  (grade ' + (p.grade || '?') + ') ===');
    if (p.scores) L.push('scores: ' + p.scores);
    var s = p.signals;
    if (s) {
      L.push('VERBATIM SIGNALS (these are the ONLY source of Current values; quote them exactly, never invent):');
      L.push('  title tag: ' + q(s.title) + '  [FACTS: ' + (s.titleLen || 0) + ' chars; already contains a pipe "|": ' + (s.titleHasPipe ? 'YES' : 'no') + '; already contains a colon: ' + (s.titleHasColon ? 'YES' : 'no') + '; first words: ' + q(s.titleFirstWords) + '; ALREADY STRONG (custom, has separator, good length, not a placeholder): ' + (s.titleStrong ? 'YES' : 'no') + '. If ALREADY STRONG is YES, the title is fine: do NOT file ANY title fix and do NOT reference changing the title anywhere in the report (not in fixes, not in why-it-matters); treat it as a strength. Otherwise, do not claim the title lacks a pipe/colon or buries a term if the facts above show otherwise.]');
      L.push('  meta description: ' + q(s.metaDesc) + '  [' + (s.metaLen || 0) + ' chars]');
      L.push('  H1 tags (' + (s.h1s || []).length + ' unique): ' + ((s.h1s || []).map(q).join(' | ') || 'none'));
      L.push('  H2 headings (' + (s.h2s || []).length + ' unique): ' + ((s.h2s || []).map(q).join(' | ') || 'none'));
      L.push('  images: ' + s.imgCount + ' (' + s.imgAlt + ' with alt) | canonical: ' + (s.hasCanonical ? 'present' : 'MISSING') + ' | JSON-LD: ' + (s.hasJsonLd ? 'present' : 'MISSING') + ' | viewport: ' + (s.hasViewport ? 'present' : 'MISSING'));
      var lb = linksBlock(s);
      if (lb) L.push('  ' + lb.replace(/\n/g, '\n  '));
      var fb = factsBlock(s.facts);
      if (fb) L.push('  ' + fb.replace(/\n/g, '\n  '));
      if (s.ssrDuplicated) L.push('  NOTE: this page server-renders then hydrates, so the raw HTML repeats blocks that the LIVE visitor sees only ONCE. Treat all content as appearing a single time and do NOT file ANY finding or fix about duplicated, repeated, or doubled headings, copy, blocks, or metrics. Only flag duplication if two headings have genuinely DIFFERENT text.');
      if (s.contentThin) L.push('  NOTE: very little readable body content was found (page may be client-rendered); audit only the signals above and state the read was limited, do NOT guess at body copy.');
    }
    L.push(geometryBlock(p.geo, true));
    if (p.outline && p.outline.length) {
      L.push('PAGE OUTLINE (every heading on this page, in the order a visitor meets them, top to bottom):');
      L.push('  ' + p.outline.slice(0, compact ? 24 : 60).join('\n  '));
    }
    if (p.excerpt) {
      if (p.complete) {
        L.push('PAGE CONTENT (the page was read COMPLETE; the excerpt below is its opening, and the OUTLINE above lists every section in it. You may reason about what is and is not on this page, cross-checked against the OBSERVED FACTS):');
      } else {
        L.push('PAGE CONTENT (PARTIAL: the page ran past the budget and OUR cut ends it early. The PAGE OUTLINE above shows what exists further down. Never claim something is missing merely because it is not below):');
      }
      L.push(String(p.excerpt).slice(0, compact ? 600 : 1200));
    }
    L.push('SCAN FINDINGS (guidance only, may be imprecise; verify against the signals above):');
    L.push(String(p.summary || '').slice(0, compact ? 700 : 1100));
    L.push('');
  });
  var ledger = defectLedgerBlock(defectLedger(scans));
  if (ledger) { L.push(ledger); L.push(''); }
  L.push('Now produce the SITE-LEVEL audit across these pages, with cross-page patterns and moves. Every Current value MUST be quoted verbatim from the VERBATIM SIGNALS or VISIBLE CONTENT above; if the exact current text for an element is not there, do not file a fix about it.');
  return L.join('\n');
}

/* ---------- page discovery (homepage links + sitemap, ranked, capped) ---------- */
async function discoverPages(startUrl) {
  var origin, host;
  try { var u = new URL(startUrl); origin = u.origin; host = u.hostname.replace(/^www\./i, ''); }
  catch (e) { return [{ url: startUrl, label: 'Home' }]; }
  var home = origin + '/';
  var map = {};
  map[stripHash(home)] = { url: home, label: 'Home', score: 1000 };
  var add = function (raw, label) {
    var abs = toAbs(raw, origin);
    if (!abs || !sameHost(abs, host) || !contentLike(abs)) return;
    var k = stripHash(abs);
    if (!k) return;
    if (!map[k]) map[k] = { url: abs.replace(/\/+$/, '') || abs, label: (label || '').trim(), score: scorePath(k, label) };
    else if (label && !map[k].label) map[k].label = label.trim();
  };
  try {
    var html = await fetchPage(home);
    var anchors = html.match(/<a\b[^>]*href\s*=\s*["'][^"']*["'][^>]*>[\s\S]*?<\/a>/gi) || [];
    anchors.forEach(function (a) {
      var href = attrOf(a, 'href');
      add(href, clean(a.replace(/<[^>]+>/g, ' ')).slice(0, 40));
    });
  } catch (e) {}
  var smUrls = [origin + '/sitemap.xml', origin + '/sitemap_index.xml'];
  for (var si = 0; si < smUrls.length; si++) {
    try {
      var sm = await fetchPage(smUrls[si]);
      var locs = sm.match(/<loc>\s*([^<]+?)\s*<\/loc>/gi) || [];
      if (locs.length) { locs.forEach(function (l) { add((l.match(/<loc>\s*([^<]+?)\s*<\/loc>/i) || [])[1] || '', ''); }); break; }
    } catch (e) {}
  }
  var arr = Object.keys(map).map(function (k) { return map[k]; });
  arr.sort(function (a, b) { return b.score - a.score; });
  /* Pick up to 5, deduping by LAST PATH SEGMENT. This used to cap "near-duplicates"
     with a staffing regex (staffing|recruit|placement|offshore...), which only ever
     recognised one industry's pages: stripe.com returned BOTH /professional-services
     and /industries/professional-services because neither matched it. Comparing the
     final segment is industry-neutral and catches the nested-duplicate case. Sorted by
     score descending, so the survivor is the better-ranked (usually shallower) one. */
  var out = [], seenLeaf = {};
  var leafOf = function (u) {
    try { return new URL(u).pathname.toLowerCase().replace(/^\/|\/$/g, '').split('/').pop(); }
    catch (e) { return u; }
  };
  for (var i = 0; i < arr.length && out.length < 5; i++) {
    var p = arr[i], leaf = leafOf(p.url);
    if (leaf && seenLeaf[leaf]) continue;
    if (leaf) seenLeaf[leaf] = 1;
    out.push({ url: p.url, label: p.label || labelFromUrl(p.url), score: p.score });
  }
  /* How many of these are actually commercial pages? An open-source docs site
     (11ty.dev) has none, and the audit filled its five slots with a styleguide and a
     leaderboard. Better to grade what's there AND say so than to imply a marketing
     site was assessed. */
  var commercial = out.filter(function (x) { return x.score > 20; }).length;
  return { pages: out.map(function (x) { return { url: x.url, label: x.label }; }),
           commercial: commercial, thin: commercial < 2 };
}
function toAbs(href, origin) {
  if (!href) return '';
  href = href.trim();
  if (/^(mailto:|tel:|javascript:|#)/i.test(href)) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (href.indexOf('//') === 0) return 'https:' + href;
  if (href[0] === '#' || href[0] === '?') return '';
  if (href[0] === '/') return origin + href;
  return origin + '/' + href.replace(/^\.?\//, '');
}
function sameHost(u, host) { try { return new URL(u).hostname.replace(/^www\./i, '') === host; } catch (e) { return false; } }
function stripHash(u) { return (u || '').split('#')[0].split('?')[0].replace(/\/+$/, '') || u; }
function contentLike(u) {
  return !/\.(jpg|jpeg|png|gif|svg|webp|pdf|zip|css|js|ico|xml|json|mp4|mp3|woff2?|ttf|eot)($|\?)/i.test(u) &&
    !/(wp-admin|wp-login|\/wp-json|\/feed|\/cart|\/checkout|\/login|\/sign|\/account|\/privacy|\/terms|\/cookie|\/sitemap|\/tag\/|\/category\/|\/author\/|\/page\/\d)/i.test(u);
}
function scorePath(u, label) {
  var seg = '';
  try { seg = new URL(u).pathname.toLowerCase().replace(/^\/|\/$/g, ''); } catch (e) { seg = (u || '').toLowerCase(); }
  var last = seg.split('/').pop();
  var depth = seg ? seg.split('/').length : 0;
  var s = -(depth - 1) * 14; // strongly prefer shallow, canonical pages
  var hay = (seg + ' ' + (label || '')).toLowerCase();
  /* Industry-neutral. This table used to be one client's: it scored "ai-team" at 55 and
     gave a bonus to staffing/recruit/placement/offshore, which quietly ranked one
     company's nav for every site the tool ever audited. These are the pages a marketing
     audit wants on ANY commercial site. */
  var kw = [['pricing', 60], ['plans', 55], ['about', 45], ['services', 38], ['solution', 34],
    ['product', 32], ['features', 30], ['platform', 30], ['how-it-work', 28], ['how-we-work', 28],
    ['use-case', 24], ['case-stud', 24], ['industr', 22], ['company', 22], ['team', 18], ['contact', 12]];
  kw.forEach(function (k) {
    if (last.indexOf(k[0]) > -1) s += k[1];
    else if (hay.indexOf(k[0]) > -1) s += Math.round(k[1] * 0.5);
  });
  /* A segment that opens with a chapter/article number ("01.2-about-basecamp",
     "11.1-theres-nothing-functional") is numbered content, not a nav page. Without this,
     the substring "about" inside a book chapter earned the full about-page bonus and
     basecamp.com's 2006 book outranked /features and /how-it-works. */
  if (/^\d+[.\-_]/.test(last)) s -= 40;
  /* Article silos are content, not the commercial pages an audit should grade. */
  if (/(^|\/)(blog|news|press|docs?|help|support|handbook|guide|guides|article|articles|gettingreal|changelog|legal|privacy|terms)(\/|$)/.test(seg)) s -= 30;
  // Deprioritize stale "-old" duplicate pages.
  if (/(-old|_old|\bold\b)/.test(last)) s -= 40;
  return s;
}
function labelFromUrl(u) {
  try {
    var p = new URL(u).pathname.replace(/^\/|\/$/g, '');
    if (!p) return 'Home';
    var last = p.split('/').pop().replace(/[-_]+/g, ' ').replace(/\.\w+$/, '');
    return last.replace(/\b\w/g, function (c) { return c.toUpperCase(); }).slice(0, 30) || 'Page';
  } catch (e) { return 'Page'; }
}

/* ============================ fetch + parse ============================ */

/* Build a compact brand profile AND the industry-correct dropdown options the whole
   suite will use. Hardcoded option lists were the thing that made this product feel
   like it belonged to one company; these are generated per brand instead. */
const BRAND_SYSTEM =
'You read a company website and return a compact brand profile that other marketing tools will run on. ' +
'Base EVERYTHING only on the page content given. Never invent a statistic, a customer name, or a claim the page does not make. ' +
'If the page does not support a field, write a sensible generic value rather than a fabricated specific one.\n\n' +
'Return EXACTLY these labelled lines, one per line, nothing else, no preamble, no markdown:\n' +
'NAME: the company or product name as they write it\n' +
'WHAT: one sentence, max 25 words, plainly what they do and for whom\n' +
'INDUSTRY: their industry in 1 to 4 words\n' +
'TONE: 2 to 4 words describing how their copy actually reads\n' +
'AUDIENCES: six pipe-separated audience segments THIS company sells to, most likely first\n' +
'OFFERINGS: six pipe-separated products or services THIS company actually offers\n' +
'TOPICS: six pipe-separated content topics this company could credibly speak on\n' +
'GOALS: five pipe-separated marketing goals that make sense for this business\n' +
'BUYERS: five pipe-separated job titles of the people who buy from them\n' +
'PROOF: up to three pipe-separated proof points the page genuinely evidences, or the single word NONE\n' +
'PROFILE: one paragraph, 40 to 70 words, describing the company the way a marketer briefing a copywriter would. This is the context every generator will use.\n\n' +
'Every pipe-separated list must contain SHORT items, 2 to 5 words each, in title case, with no numbering and no trailing punctuation. ' +
'Never use an em dash or en dash anywhere.';

/* Labelled lines rather than JSON: the model gets it right far more often, and a
   single malformed field degrades to a default instead of throwing away the profile. */
function parseBrand(txt) {
  const get = function (k) {
    const m = String(txt || '').match(new RegExp('^' + k + '\\s*:\\s*(.+)$', 'im'));
    return m ? m[1].trim() : '';
  };
  const list = function (k, n) {
    return get(k).split('|').map(function (x) { return x.trim(); })
      .filter(function (x) { return x && !/^none$/i.test(x); }).slice(0, n);
  };
  return {
    name: get('NAME'), what: get('WHAT'), industry: get('INDUSTRY'), tone: get('TONE'),
    audiences: list('AUDIENCES', 6), offerings: list('OFFERINGS', 6), topics: list('TOPICS', 6),
    goals: list('GOALS', 5), buyers: list('BUYERS', 5), proof: list('PROOF', 3),
    profile: get('PROFILE')
  };
}

function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  var u = url.trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    var parsed = new URL(u);
    if (!parsed.hostname || parsed.hostname.indexOf('.') === -1) return '';
    return parsed.href;
  } catch (e) { return ''; }
}

async function rawFetch(url, ms) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, ms || 15000);
  try {
    var res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/* Tiered fetch. Most marketing builders (Hopp, Wix, Squarespace, Webflow, WordPress)
   server-render their content, so the direct fetch already contains the headings, copy,
   forms and links - the audit's real bug was never the fetch, it was inferring absence from
   a truncated excerpt (see extractFacts). But a TRUE client-rendered SPA ships an empty
   shell, and auditing that shell is worthless. So: fetch directly, and only if the result is
   genuinely a shell, re-fetch through a rendering reader proxy that runs the page's
   JavaScript. Fail-safe: if the proxy is unset or errors, keep the direct HTML and let the
   thin-content notes and the NOT VERIFIED appendix tell the truth about the limited read. */
async function fetchPage(url) {
  var html = '';
  try { html = await rawFetch(url, 12000); } catch (e) { html = ''; }

  if (html && !isShell(html)) return html;

  var rendered = await renderFetch(url).catch(function () { return ''; });
  if (rendered && (!html || rendered.length > html.length)) return rendered;
  return html;
}

// A shell is a page whose server HTML carries essentially no readable content: the content
// only exists after JavaScript runs. NOT the same as a short page.
function isShell(html) {
  var text = extractText(html);
  var words = text.split(/\s+/).filter(Boolean).length;
  var headings = (html.match(/<h[12]\b/gi) || []).length;
  return words < 60 && headings < 2;
}

// Reader/render proxy. Jina Reader runs the page's JS and can return the rendered HTML.
// Off by default; set RENDER_PROXY=jina (and optionally JINA_API_KEY for the higher tier).
async function renderFetch(url) {
  if ((process.env.RENDER_PROXY || '').toLowerCase() !== 'jina') return '';
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 12000);
  try {
    var headers = { 'x-return-format': 'html', 'x-timeout': '10' };
    if (process.env.JINA_API_KEY) headers['Authorization'] = 'Bearer ' + process.env.JINA_API_KEY;
    var res = await fetch('https://r.jina.ai/' + url, { signal: controller.signal, headers: headers });
    if (!res.ok) return '';
    return await res.text();
  } catch (e) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/* ============================ SEEING THE PAGE: render + geometry ============================
   PHASE 2. Until now the audit read HTML and had no idea what a visitor actually SEES: what
   is in the first viewport, what order things appear in visually, how prominent a CTA is. So
   it was banned from saying anything about layout, and UX was graded n/a. That ban was
   honest, but it was a placeholder for sight, not a substitute for it. (The very first audit
   in this project DID try, and invented "streaming links are buried below merch" from raw
   document order. Guessing at layout is how this whole mess started.)

   Now: drive a real headless browser, take a screenshot, and read every element's box with
   getBoundingClientRect. That gives two very different things, and the difference matters:

     GEOMETRY  -> deterministic FACTS (this button's top edge is at y=412; the fold is at
                  y=900; therefore it is above the fold). The model cannot argue with these,
                  exactly like the word count and the email-form facts.
     SCREENSHOT -> what a human sees. Passed to the model's vision so it can judge hierarchy,
                  emphasis and clutter, which are real but not reducible to numbers.

   Facts constrain; vision interprets. Never the other way round.

   Fail-safe: no provider configured, or the render errors or times out, and we fall straight
   back to today's behaviour. Layout claims stay banned and UX stays n/a, because we did not
   see the page. Degrading to honest silence is always allowed; degrading to a guess is not. */

// Desktop first: the fold is where the first viewport ends.
var VIEWPORT = { width: 1280, height: 900 };

/* Ask the render provider for {html, screenshot, geometry}. Provider is pluggable so this is
   not welded to one vendor; Browserless is the default because its /function endpoint runs
   our own page.evaluate, which is what makes GEOMETRY (not just a picture) possible. */
async function renderPage(url, wantFull) {
  /* SAY WHY, ALWAYS. This used to return null silently when it was not configured, so a
     render that never happened looked identical in the logs to a render that was never
     attempted: the only symptom was UX coming back n/a, and the cause had to be DEDUCED from
     an absence of log lines. That is the same sin as the audit itself inferring things from
     what it could not see. Every path out of here now states its reason. */
  var provider = (process.env.RENDER_PROVIDER || '').toLowerCase();
  if (!provider) {
    console.log('[audit] render SKIPPED: RENDER_PROVIDER is not set. The audit will run HTML-only, layout claims disabled and UX graded n/a. Set RENDER_PROVIDER=browserless and BROWSERLESS_TOKEN, then REDEPLOY (env vars are only picked up by a new deploy).');
    return null;
  }
  if (provider !== 'browserless') {
    console.warn('[audit] render SKIPPED: RENDER_PROVIDER="' + provider + '" is not a provider this build knows. Supported: browserless.');
    return null;
  }
  var token = process.env.BROWSERLESS_TOKEN;
  if (!token) {
    console.warn('[audit] render SKIPPED: RENDER_PROVIDER=browserless but BROWSERLESS_TOKEN is empty. Add the token and REDEPLOY.');
    return null;
  }

  var base = process.env.BROWSERLESS_URL || 'https://production-sfo.browserless.io';
  var ms = Number(process.env.RENDER_TIMEOUT_MS || 20000);
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, ms);

  // Runs in the browser. Collects the rendered HTML, a viewport screenshot, and the
  // bounding box of every heading, button, link, image and form control.
  var code = [
    'export default async function ({ page }) {',
    '  await page.setViewport({ width: ' + VIEWPORT.width + ', height: ' + VIEWPORT.height + ' });',
    '  await page.goto(CONTEXT_URL, { waitUntil: "networkidle2", timeout: 20000 });',
    '  await new Promise(r => setTimeout(r, 700));',
    /* TRUTH FROM THE DOM, NOT FROM A REGEX OVER A STRING.
       Every parser bug in this project came from pattern-matching HTML text: alt="" counted
       as alt text, <noscript> lazy-load fallbacks counted as images a visitor sees, and an
       apostrophe cutting a meta description in half. All three were impossible to make here.
       When a real browser is open, ASK IT. The regex path stays only as the fallback for when
       no render happened. */
    '  const domFacts = await page.evaluate(() => {',
    '    const vis = (el) => { const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden"; };',
    '    const imgs = [...document.querySelectorAll("img")];',
    '    const alt = (i) => (i.getAttribute("alt") || "").trim();',
    '    const metaOf = (n) => { const m = document.querySelector(`meta[name="${n}"]`); return m ? (m.getAttribute("content") || "") : ""; };',
    '    return {',
    '      imgCount: imgs.length,',
    '      imgAlt: imgs.filter(i => alt(i)).length,',
    '      title: document.title || "",',
    '      metaDesc: metaOf("description"),',
    '      h1s: [...document.querySelectorAll("h1")].map(h => h.innerText.trim()).filter(Boolean),',
    '      h2s: [...document.querySelectorAll("h2")].map(h => h.innerText.trim()).filter(Boolean),',
    '      wordCount: (document.body.innerText || "").trim().split(/\\s+/).filter(Boolean).length,',
    '      hasEmailInput: !!document.querySelector(\'input[type="email"]\'),',
    '      formCount: document.querySelectorAll("form").length,',
    '      hasCanonical: !!document.querySelector(\'link[rel="canonical"]\'),',
    '      hasJsonLd: document.querySelectorAll(\'script[type="application/ld+json"]\').length > 0,',
    '      buttons: [...document.querySelectorAll("button,[role=button],input[type=submit]")].filter(vis).map(b => (b.innerText || b.value || "").trim()).filter(Boolean).slice(0, 20)',
    '    };',
    '  });',
    '  const geometry = await page.evaluate((foldY) => {',
    '    const vis = (el) => { const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) !== 0; };',
    '    const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };',
    '    const grab = (sel, kind) => [...document.querySelectorAll(sel)].filter(e => vis(e) && e.getBoundingClientRect().width > 0).slice(0, 80).map(e => {',
    '      const b = box(e);',
    '      return { kind, text: (e.innerText || e.value || e.getAttribute("aria-label") || "").trim().replace(/\\s+/g, " ").slice(0, 70), x: b.x, y: b.y, w: b.w, h: b.h, area: b.w * b.h, aboveFold: b.y < foldY, href: (e.getAttribute("href") || "").slice(0, 80) };',
    '    });',
    '    const els = [].concat(',
    '      grab("h1,h2,h3", "heading"),',
    '      grab("button,input[type=submit],[role=button]", "button"),',
    '      grab("a[href]", "link"),',
    '      grab("input,textarea,select", "field")',
    '    ).filter(e => e.text || e.kind === "field");',
    '    els.sort((a, b) => (a.y - b.y) || (a.x - b.x));',
    '    return { foldY, pageHeight: document.documentElement.scrollHeight, elements: els.slice(0, 160) };',
    '  }, ' + VIEWPORT.height + ');',
    '  const shot = await page.screenshot({ type: "png", encoding: "base64" });',
    // A FULL-PAGE shot as well. The report crops this to the exact element a fix refers to,
    // using the boxes we already measure, so a reader SEES the thing being changed. JPEG and
    // modest quality because a tall page is a big image and this one travels to the browser.
    '  const shotFull = WANT_FULL ? await page.screenshot({ type: "jpeg", quality: 55, fullPage: true, encoding: "base64" }) : "";',
    '  const html = await page.content();',
    '  return { data: { geometry, domFacts, screenshot: shot, shotFull, html }, type: "application/json" };',
    '}'
  ].join('\n').replace('CONTEXT_URL', JSON.stringify(url)).replace('WANT_FULL', wantFull ? 'true' : 'false');

  try {
    var res = await fetch(base + '/function?token=' + encodeURIComponent(token), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/javascript' },
      body: code
    });
    if (!res.ok) {
      var why = await res.text().catch(function () { return ''; });
      console.warn('[audit] render FAILED for ' + url + ': HTTP ' + res.status + ' ' + String(why).slice(0, 300) +
        (res.status === 401 || res.status === 403 ? '  -> the BROWSERLESS_TOKEN looks wrong or expired' : ''));
      return null;
    }
    var out = await res.json();
    var d = (out && out.data) || out;
    if (!d || !d.geometry) {
      console.warn('[audit] render FAILED for ' + url + ': the provider replied but sent no geometry. Body starts: ' + JSON.stringify(out).slice(0, 300));
      return null;
    }
    var df = d.domFacts || null;
    console.log('[audit] render OK for ' + url + ': ' + d.geometry.elements.length + ' elements measured, fold at y=' + d.geometry.foldY +
      (df ? ', DOM truth: ' + df.imgCount + ' images (' + df.imgAlt + ' with alt), ' + df.wordCount + ' words' : ', no domFacts') +
      ', vision shot ' + (d.screenshot ? Math.round(d.screenshot.length / 1024) + 'kb' : 'MISSING'));
    return { html: d.html || '', screenshot: d.screenshot || '', shotFull: d.shotFull || '', geometry: d.geometry, domFacts: df };
  } catch (e) {
    var msg = (e && e.name === 'AbortError')
      ? 'timed out after ' + ms + 'ms (raise RENDER_TIMEOUT_MS)'
      : (e && e.message);
    console.warn('[audit] render FAILED for ' + url + ': ' + msg);
    return null;      // honest silence, never a guess
  } finally {
    clearTimeout(timer);
  }
}

/* THE DOM OUTRANKS THE REGEX.

   Every single parser bug in this project was a string-matching artifact:
     alt=""              counted as alt text        -> a defect praised as a strength
     <noscript> images   counted as real images     -> "42 of 53" when a visitor sees 26
     an apostrophe       ended an attribute early   -> a meta description "malformed at We don"

   None of them could happen if we simply ASKED THE PAGE. So when a browser was open, its DOM
   is the truth and it overwrites what the regex scraped. The string parser stays only as the
   fallback for pages we could not render. Measure, do not infer. */
function applyDomTruth(sig, dom) {
  if (!sig || !dom) return sig;
  if (typeof dom.imgCount === 'number') sig.imgCount = dom.imgCount;
  if (typeof dom.imgAlt === 'number') sig.imgAlt = dom.imgAlt;
  if (typeof dom.wordCount === 'number' && dom.wordCount > 0) sig.wordCount = dom.wordCount;
  if (dom.title) sig.title = dom.title;
  if (dom.metaDesc) sig.metaDesc = dom.metaDesc;
  if (Array.isArray(dom.h1s) && dom.h1s.length) sig.h1s = dom.h1s.filter(function (v, i, a) { return a.indexOf(v) === i; });
  if (Array.isArray(dom.h2s) && dom.h2s.length) {
    sig.h2s = dom.h2s.filter(function (v, i, a) { return a.indexOf(v) === i; });
    sig.h2count = sig.h2s.length;
  }
  if (Array.isArray(dom.buttons) && dom.buttons.length) sig.buttons = dom.buttons;
  if (typeof dom.hasCanonical === 'boolean') sig.hasCanonical = dom.hasCanonical;
  if (typeof dom.hasJsonLd === 'boolean') sig.hasJsonLd = dom.hasJsonLd;
  sig.domTruth = true;

  // The facts block is built from sig, so refresh the parts the DOM knows better.
  if (sig.facts) {
    sig.facts.imgCount = sig.imgCount;
    sig.facts.imgAlt = sig.imgAlt;
    sig.facts.wordCount = sig.wordCount;
    sig.facts.hasCanonical = sig.hasCanonical;
    sig.facts.hasJsonLd = sig.hasJsonLd;
    if (typeof dom.hasEmailInput === 'boolean') {
      sig.facts.emailInput = dom.hasEmailInput;
      sig.facts.hasEmailCapture = sig.facts.hasEmailCapture || dom.hasEmailInput;
    }
    if (typeof dom.formCount === 'number') sig.facts.formCount = dom.formCount;
  }
  return sig;
}

/* Geometry -> FACTS. The same discipline as everywhere else in this file: compute it in code,
   hand it over as authoritative, and let the model interpret but never contradict. */
function geometryFacts(geo) {
  if (!geo || !geo.elements || !geo.elements.length) return null;
  var els = geo.elements;
  var fold = geo.foldY || VIEWPORT.height;
  var above = els.filter(function (e) { return e.aboveFold; });

  var ctas = els.filter(function (e) {
    return (e.kind === 'button' || (e.kind === 'link' && e.area >= 2000)) && e.text;
  });
  var ctasAbove = ctas.filter(function (e) { return e.aboveFold; });
  var primary = ctas.slice().sort(function (a, b) { return b.area - a.area; })[0] || null;

  return {
    foldY: fold,
    pageHeight: geo.pageHeight || 0,
    elementCount: els.length,
    aboveFoldCount: above.length,
    // The true VISUAL order (top to bottom, then left to right) - not document order, which
    // is what the very first audit mistook for visual order and hallucinated a funnel from.
    visualOrder: els.filter(function (e) { return e.text; }).slice(0, 30).map(function (e) {
      return e.kind + (e.aboveFold ? ' [above fold]' : ' [below fold]') + ': "' + e.text + '"';
    }),
    aboveFoldElements: above.filter(function (e) { return e.text; }).slice(0, 20).map(function (e) {
      return e.kind + ': "' + e.text + '"';
    }),
    ctasAboveFold: ctasAbove.map(function (e) { return e.text; }),
    ctasBelowFold: ctas.filter(function (e) { return !e.aboveFold; }).map(function (e) { return e.text; }),
    primaryCta: primary ? { text: primary.text, aboveFold: primary.aboveFold, y: primary.y, area: primary.area } : null,
    anyCtaAboveFold: ctasAbove.length > 0,
    // Raw boxes, for the REPORT to crop the screenshot to the exact element a fix names.
    // Never shown to the model (geometryBlock emits only the summary), so this costs no tokens.
    elementsRaw: els.filter(function (e) { return e.text; }).slice(0, 120).map(function (e) {
      return { kind: e.kind, text: e.text, x: e.x, y: e.y, w: e.w, h: e.h };
    })
  };
}

/* compact=true for the SITE synthesis, which carries five pages at once and has a hard
   function-timeout budget. The per-page scan gets the full block plus the screenshot. */
function geometryBlock(g, compact) {
  if (!g) {
    return 'RENDERED LAYOUT: NOT AVAILABLE. This page was NOT rendered in a browser, so you have NO information about the visual layout. You may NOT say anything about what is above or below the fold, what a visitor sees first, visual order, prominence, or "buried" elements, and you MUST grade UX as n/a. Document order in the HTML is NOT visual order and must never be used as a proxy for it.';
  }
  var L = [];
  L.push('THIS PAGE WAS RENDERED IN A REAL BROWSER. The content, headings, image counts and metadata you were given are the POST-JavaScript DOM, i.e. what an actual visitor gets, NOT pre-hydration HTML. Do NOT say the values "are pre-hydration" or "may differ from what a real visitor sees", and do NOT list JavaScript-rendered content as unobserved in the NOT VERIFIED appendix for this page: it WAS observed. (Live values that change second by second, like a running countdown, are still only a snapshot.)');
  L.push('RENDERED LAYOUT (a real browser at ' + VIEWPORT.width + 'x' + VIEWPORT.height + '; MEASURED positions, authoritative, you may not contradict them):');
  L.push('  fold (bottom of the first screen) at y=' + g.foldY + '; full page ' + g.pageHeight + 'px tall; a visitor sees ' + g.aboveFoldCount + ' of ' + g.elementCount + ' elements before scrolling');
  var af = compact ? g.aboveFoldElements.slice(0, 8) : g.aboveFoldElements;
  if (af.length) L.push('  ABOVE THE FOLD (what they see first): ' + af.join(' | '));
  L.push('  CTAs above the fold: ' + (g.ctasAboveFold.length ? g.ctasAboveFold.map(q).join(', ') : 'NONE'));
  L.push('  CTAs below the fold (they must scroll to reach these): ' + (g.ctasBelowFold.length ? g.ctasBelowFold.slice(0, compact ? 6 : 20).map(q).join(', ') : 'none'));
  if (g.primaryCta) L.push('  largest CTA on the page: ' + q(g.primaryCta.text) + ', ' + (g.primaryCta.aboveFold ? 'above the fold' : 'BELOW the fold at y=' + g.primaryCta.y));
  if (!compact) L.push('  TRUE VISUAL ORDER, top to bottom (NOT document order): ' + g.visualOrder.join('  ->  '));
  L.push('');
  L.push(compact
    ? 'Because this page was SEEN, you MAY grade UX, you MAY say what is above or below the fold, and you MAY recommend moving an element up or down. Ground every such claim in the measurements above, never in HTML order.'
    : 'You are also given a SCREENSHOT of the first screen. Use it to judge what the numbers cannot: visual hierarchy, emphasis, contrast, crowding, whether the eye lands where it should. Because you can now SEE this page, you MAY grade UX, you MAY say what is above or below the fold, and you MAY recommend moving an element up or down. Ground every such claim in the measurements above or in the screenshot, never in HTML order.');
  return L.join('\n');
}

/* Elements a real visitor never gets.

   <noscript> is the standard lazy-loading fallback: the theme emits a duplicate <img> inside
   it for the no-JavaScript case, and a JS-swapped <img> for everyone else. <template> content
   is inert by definition. Neither is ever rendered for an actual visitor.

   extractText() has always stripped these. The COUNTERS never did, so they counted the ghosts:
   on one WordPress services page the audit reported "42 of 53 images lack alt text" when
   the real DOM has 25 images and 20 without alt. 27 of those 53 were noscript duplicates.

   The defect was real and the PERCENTAGE was right (both numbers inflated together), but a
   content editor told to fix 42 images would go hunting for 22 that do not exist. Precision
   that is confidently wrong is the exact failure this whole codebase exists to prevent. Count
   what a visitor actually gets. */
function stripInert(html) {
  return String(html || '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ');
}

function extractSignals(rawHtml, url) {
  var html = stripInert(rawHtml);
  var title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  var metaDesc = metaContent(html, 'description');
  var ogTitle = ogContent(html, 'og:title');
  var h1sRaw = allMatches(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).map(clean).filter(Boolean);
  // Keep UNIQUE H1/H2 text: an SPA's raw HTML often repeats identical headings (server-render
  // + hydration) that render only once, so identical duplicates are not a real "duplicate H1".
  var h1s = h1sRaw.filter(function (v, i) { return h1sRaw.indexOf(v) === i; });
  var h2sRaw = allMatches(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi).map(clean).filter(Boolean);
  var h2s = h2sRaw.filter(function (v, i) { return h2sRaw.indexOf(v) === i; });
  var h2count = h2s.length;
  var imgTags = html.match(/<img\b[^>]*>/gi) || [];
  // An EMPTY alt="" is not alt text. WordPress (and most builders) emit alt="" on decorative
  // images by the dozen, so the old /\balt\s*=/ test counted "has the attribute" as "has alt
  // text" and reported a page with 40 unlabelled images as having "alt text on all images" -
  // praising a real accessibility and SEO defect as a STRENGTH, and burying the finding.
  // Require a non-empty, non-whitespace value.
  // attrOf, not a naive ["'] class: an alt text containing an apostrophe ("the founder's desk")
  // would otherwise be sliced at the apostrophe (see attrOf).
  var imgAlt = imgTags.filter(function (t) { return !!attrOf(t, 'alt').trim(); }).length;
  var anchors = html.match(/<a\b[^>]*href\s*=\s*["'][^"']*["'][^>]*>/gi) || [];
  var host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
  var internal = 0, external = 0;
  anchors.forEach(function (a) {
    var href = attrOf(a, 'href');
    if (/^https?:\/\//i.test(href)) {
      if (host && href.indexOf(host) > -1) internal++; else external++;
    } else if (href && href[0] !== '#' && !/^(mailto:|tel:|javascript:)/i.test(href)) {
      internal++;
    }
  });
  var wc = extractText(html).split(/\s+/).filter(Boolean).length;
  return {
    title: clean(title),
    metaDesc: metaDesc,
    ogTitle: ogTitle,
    hasCanonical: /<link[^>]+rel\s*=\s*["']canonical["']/i.test(html),
    hasViewport: /<meta[^>]+name\s*=\s*["']viewport["']/i.test(html),
    hasJsonLd: /<script[^>]+type\s*=\s*["']application\/ld\+json["']/i.test(html),
    h1s: h1s,
    h2count: h2count,
    imgCount: imgTags.length,
    imgAlt: imgAlt,
    internalLinks: internal,
    externalLinks: external,
    https: /^https:/i.test(url),
    wordCount: wc,
    h2s: h2s,
    links: extractLinks(html, url),
    buttons: extractButtons(html),
    ssrDuplicated: h1sRaw.length > h1s.length || h2sRaw.length > h2s.length,
    contentThin: wc < 120,
    platform: detectPlatform(html, url, { wordCount: wc, externalLinks: external, internalLinks: internal })
  };
}

// Ordered list of on-page link labels + destination host, in document order. Lets the
// model judge CTA/link HIERARCHY accurately (e.g. streaming links buried below merch) and
// quote REAL link labels instead of inventing them. Works from the raw HTML because every
// real marketing builder (Hopp, Wix, Squarespace, Webflow, WordPress) server-renders links.
function extractLinks(html, baseUrl) {
  var origin = ''; try { origin = new URL(baseUrl).origin; } catch (e) {}
  var out = [], seen = {}, re = /<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var href = m[1], label = clean(m[2]);
    if (!label || label.length > 90 || /^https?:\/\//i.test(label)) continue;
    var dest = href;
    try { dest = new URL(href, origin || undefined).hostname.replace(/^www\./, ''); } catch (e) { dest = String(href).slice(0, 40); }
    var key = label.toLowerCase() + '|' + dest;
    if (seen[key]) continue; seen[key] = 1;
    out.push({ t: label, d: dest });
    if (out.length >= 24) break;
  }
  return out;
}

// On-page button / submit labels (real CTA text), so CTA findings quote actual labels.
function extractButtons(html) {
  var out = [], seen = {}, add = function (t) { t = clean(t); if (t && t.length <= 60 && !seen[t.toLowerCase()]) { seen[t.toLowerCase()] = 1; out.push(t); } };
  (html.match(/<button\b[^>]*>([\s\S]*?)<\/button>/gi) || []).forEach(function (x) { add(x.replace(/<button[^>]*>/i, '').replace(/<\/button>/i, '')); });
  (html.match(/<input\b[^>]*type\s*=\s*["'](?:submit|button)["'][^>]*>/gi) || []).forEach(function (x) { add(attrOf(x, 'value')); });
  return out.slice(0, 12);
}

// Compact, verbatim signal set passed to the synthesis so it can quote exact Current
// values instead of inventing them (the root cause of the fabricated "exact text not
// provided" findings: synthesis only saw prose summaries, never the real page text).
function compactSignals(sig) {
  var t = sig.title || '', m = sig.metaDesc || '';
  return {
    title: sig.title, metaDesc: sig.metaDesc, ogTitle: sig.ogTitle, h1s: sig.h1s, h2s: (sig.h2s || []).slice(0, 12), h2count: sig.h2count,
    imgCount: sig.imgCount, imgAlt: sig.imgAlt, hasCanonical: sig.hasCanonical, hasJsonLd: sig.hasJsonLd,
    hasViewport: sig.hasViewport, https: sig.https, wordCount: sig.wordCount, ssrDuplicated: sig.ssrDuplicated,
    contentThin: sig.contentThin, links: sig.links, buttons: sig.buttons,
    // Deterministic presence/absence facts. The synthesis is only ever shown a truncated
    // excerpt, so without these it infers "missing" from "not in my context window".
    facts: sig.facts,
    // Objective, precomputed facts so the model can't miscount/misclaim the title/meta.
    titleLen: t.length, titleHasPipe: /\|/.test(t), titleHasColon: /:/.test(t), titleFirstWords: t.split(/\s+/).slice(0, 4).join(' '),
    metaLen: m.length,
    // Deterministic verdict: is the title already strong (custom, separator, good length, no
    // placeholder/truncation)? If yes, the model must not file or reference any title fix.
    titleStrong: !(/\b(home final|untitled|new page|page \d|default title|draft|copy of|template|localhost|test page|wordpress|welcome to|final)\b/i.test(t) || /(\.{3}|…)\s*$/.test(t) || t.length < 20 || t.length > 72) && /[|:]/.test(t) && t.length >= 25
  };
}
/* ============================ OBSERVED FACTS + the ABSENCE RULE ============================
   THE ROOT CAUSE OF THE FABRICATIONS. The model is only ever shown a TRUNCATED excerpt of
   the page (1000-3000 chars), so anything further down (an FAQ, a bio section, a signup
   form) is simply not in its context. It then reported those things as MISSING: "no email
   signup form", "no FAQ", "thin word count, 200-300 words" - on a page that has all three.

   Every fabrication this audit has produced has been an ABSENCE claim inferred from
   truncated input. The prompts were full of rules against inventing VALUES, and had no rule
   against inferring ABSENCE. So: compute the absence-prone facts deterministically in code,
   hand them to the model as authoritative, and forbid absence claims that are not backed by
   them. Then enforce it again on the way out (enforceFacts), because a prompt rule alone has
   never been reliable here. */
function extractFacts(rawHtml, sig) {
  var L = stripInert(rawHtml);        // never count <noscript>/<template> ghosts (see stripInert)
  var h3s = allMatches(L, /<h3[^>]*>([\s\S]*?)<\/h3>/gi).map(clean).filter(Boolean);
  var uniqH3 = h3s.filter(function (v, i) { return h3s.indexOf(v) === i; });
  var allHeads = [].concat(sig.h1s || [], sig.h2s || [], uniqH3);
  var headText = allHeads.join(' | ');

  // Email capture: a real <input type=email>, an email-named/placeholdered input, or a
  // form plus a signup-shaped button. This is the exact claim the audit kept getting wrong.
  var emailInput = /<input\b[^>]*type\s*=\s*["']email["']/i.test(L) ||
    /<input\b[^>]*name\s*=\s*["'][^"']*e-?mail[^"']*["']/i.test(L) ||
    /<input\b[^>]*(?:placeholder|aria-label)\s*=\s*["'][^"']*e-?mail[^"']*["']/i.test(L);
  var formCount = (L.match(/<form\b/gi) || []).length;
  var signupBtn = (sig.buttons || []).some(function (b) {
    return /subscribe|sign ?up|join|early access|newsletter|notify|waitlist|get .* first/i.test(b);
  });

  var faqHeading = allHeads.some(function (h) { return /^(faq|faqs|q&a|frequently asked)/i.test(h.trim()); });
  var questionHeads = uniqH3.filter(function (h) { return /\?\s*$/.test(h); });
  var hasFAQ = faqHeading || questionHeads.length >= 3;

  var hasBio = /\b(who is|about (us|me|the)?|artist bio|bio|our story|meet the|biography)\b/i.test(headText);

  // A countdown/timer widget: its VALUE is JS-rendered (zeros pre-hydration), so we record
  // that the widget EXISTS but that its value was never observed. Never call it broken.
  //
  // Test MARKUP, not the raw file: the bare word "countdown" appears inside bundled JS on
  // sites that have no countdown at all (most B2B sites hit this), which made the honesty
  // appendix assert that "the widgets exist" on a site with no widget. A false presence claim
  // is exactly as bad as a false absence claim.
  var markup = L.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  var visible = extractText(L);
  var hasCountdown = /data-countdown|(?:class|id)\s*=\s*["'][^"']*(?:countdown|js-timer)/i.test(markup) ||
    /\bdays?\b[\s\S]{0,40}\bhours?\b[\s\S]{0,40}\b(min|minutes?)\b[\s\S]{0,40}\b(sec|seconds?)\b/i.test(visible.slice(0, 8000));

  /* The rest of the absence-prone surface. The six facts above were the ones the audit was
     caught inventing; these are the SAME failure shape waiting to happen on a normal
     business site, because they are exactly what a marketing analyst reaches for:
     "no testimonials", "no case studies", "no pricing page", "no phone number", "no blog".
     Each is a claim the model cannot possibly verify from a 1,000-char excerpt of the top of
     the page, so each one gets a deterministic fact instead. Fixing the category, not the
     six instances. */
  var linkText = (sig.links || []).map(function (l) { return l.t; }).join(' | ');
  var btnText = (sig.buttons || []).join(' | ');
  var surface = headText + ' | ' + linkText + ' | ' + btnText;   // headings + link + button labels

  var hasTestimonials = /<blockquote/i.test(L) ||
    /"@type"\s*:\s*"(?:Review|AggregateRating)"/i.test(L) ||
    /\b(testimonial|what (?:our )?(?:clients|customers) say|client stories|customer stories|reviews?|rated \d)\b/i.test(surface);
  var hasCaseStudies = /\b(case stud(?:y|ies)|success stor(?:y|ies)|client stor(?:y|ies)|portfolio|our work)\b/i.test(surface);
  var hasPricing = /\b(pricing|plans?|packages?|rates|tiers?)\b/i.test(surface);
  var hasContactForm = /<textarea\b/i.test(L) ||
    (formCount > 0 && /\b(contact|message|enquir|inquir|get in touch|request a (?:quote|demo|call)|book a)\b/i.test(surface));
  var hasPhone = /href\s*=\s*["']tel:/i.test(L);
  var hasEmailAddress = /href\s*=\s*["']mailto:/i.test(L);
  var hasAboutOrTeam = /\b(about(?: us)?|our team|leadership|our story|who we are|meet the)\b/i.test(surface);
  var hasBlog = /\b(blog|news|insights|articles|resources|journal)\b/i.test(surface);
  var hasVideo = /<video\b/i.test(L) || /<iframe[^>]+(?:youtube|vimeo|wistia)/i.test(L) || /(?:youtube\.com\/embed|player\.vimeo\.com)/i.test(L);
  var hasSocialLinks = /(?:instagram\.com|tiktok\.com|twitter\.com|\/\/x\.com|facebook\.com|linkedin\.com|youtube\.com)/i.test(L);
  var hasSearch = /<input[^>]+type\s*=\s*["']search["']/i.test(L) || /role\s*=\s*["']search["']/i.test(L);
  var hasCTAButtons = (sig.buttons || []).length > 0;

  return {
    wordCount: sig.wordCount,
    hasEmailCapture: !!(emailInput || (formCount > 0 && signupBtn)),
    emailInput: !!emailInput,
    formCount: formCount,
    hasFAQ: !!hasFAQ,
    faqQuestionCount: questionHeads.length,
    hasBioSection: !!hasBio,
    hasCountdown: !!hasCountdown,
    hasTestimonials: !!hasTestimonials,
    hasCaseStudies: !!hasCaseStudies,
    hasPricing: !!hasPricing,
    hasContactForm: !!hasContactForm,
    hasPhone: !!hasPhone,
    hasEmailAddress: !!hasEmailAddress,
    hasAboutOrTeam: !!hasAboutOrTeam,
    hasBlog: !!hasBlog,
    hasVideo: !!hasVideo,
    hasSocialLinks: !!hasSocialLinks,
    hasSearch: !!hasSearch,
    hasCTAButtons: !!hasCTAButtons,
    headings: allHeads.slice(0, 40),
    imgCount: sig.imgCount,
    imgAlt: sig.imgAlt,
    hasCanonical: sig.hasCanonical,
    hasJsonLd: sig.hasJsonLd
  };
}

/* Which fact backs which kind of absence claim. One table, used by BOTH the prompt (so the
   model is told what it may and may not assert) and the output guard (so it is held to it).
   If a claim shape is not in this table, the model has no fact for it and must stay silent. */
var ABSENCE_FACTS = [
  { key: 'hasEmailCapture',  label: 'email capture / newsletter signup form', kw: '(?:email(?: capture| signup| sign-?up)?|newsletter|mailing list|opt-?in|subscribe form)' },
  { key: 'hasFAQ',           label: 'FAQ section',                            kw: '(?:faq|frequently asked)' },
  { key: 'hasBioSection',    label: 'bio / about-the-artist section',         kw: '(?:artist bio|bio section|biography)' },
  { key: 'hasTestimonials',  label: 'testimonials / reviews / social proof',  kw: '(?:testimonial|review|social proof|customer quote|client quote)' },
  { key: 'hasCaseStudies',   label: 'case studies / success stories',         kw: '(?:case stud(?:y|ies)|success stor(?:y|ies)|portfolio)' },
  { key: 'hasPricing',       label: 'pricing / plans',                        kw: '(?:pricing|price page|plans|packages)' },
  { key: 'hasContactForm',   label: 'contact form',                           kw: '(?:contact form|enquiry form|inquiry form|quote form)' },
  { key: 'hasPhone',         label: 'phone number',                           kw: '(?:phone number|telephone|phone)' },
  { key: 'hasEmailAddress',  label: 'email address',                          kw: '(?:email address|contact email)' },
  { key: 'hasAboutOrTeam',   label: 'about / team page',                      kw: '(?:about page|about us|team page|our team|leadership page)' },
  { key: 'hasBlog',          label: 'blog / news / insights',                 kw: '(?:blog|news section|insights|articles section)' },
  { key: 'hasVideo',         label: 'video',                                  kw: '(?:video|embedded video)' },
  { key: 'hasSocialLinks',   label: 'social media links',                     kw: '(?:social (?:media )?links?|social icons|social profiles)' },
  { key: 'hasSearch',        label: 'site search',                            kw: '(?:site search|search (?:bar|box|function))' },
  { key: 'hasCTAButtons',    label: 'call-to-action buttons',                 kw: '(?:cta buttons?|call[- ]to[- ]action buttons?)' }
];

// The authoritative block handed to every model call. Facts first, then the ABSENCE RULE.
function factsBlock(f) {
  if (!f) return '';
  var yn = function (b) { return b ? 'YES' : 'NO'; };
  var L = [];
  L.push('OBSERVED FACTS (computed deterministically from the page HTML; AUTHORITATIVE; they OVERRIDE your own reading of the excerpt):');
  L.push('  visible word count: ' + f.wordCount);
  L.push('  email capture form present: ' + yn(f.hasEmailCapture) + '  (email input: ' + yn(f.emailInput) + ', forms: ' + f.formCount + ')');
  L.push('  FAQ section present: ' + yn(f.hasFAQ) + '  (' + f.faqQuestionCount + ' question headings)');
  L.push('  bio / about section present: ' + yn(f.hasBioSection));
  L.push('  countdown or live timer widget present: ' + yn(f.hasCountdown) +
    (f.hasCountdown ? '  (the widget EXISTS. Its VALUE is rendered by JavaScript and was NOT observed, so it may look like zeros here while counting down correctly for real visitors. NEVER call it broken, frozen, stuck, or stopped.)' : ''));
  L.push('  images: ' + f.imgCount + ' (' + f.imgAlt + ' with alt text) | canonical: ' + (f.hasCanonical ? 'present' : 'MISSING') + ' | JSON-LD: ' + (f.hasJsonLd ? 'present' : 'MISSING'));
  // The rest of the absence-prone surface, driven off the one shared table.
  var rest = ABSENCE_FACTS.filter(function (r) {
    return ['hasEmailCapture', 'hasFAQ', 'hasBioSection'].indexOf(r.key) === -1 && typeof f[r.key] === 'boolean';
  });
  if (rest.length) {
    L.push('  present on the page: ' + rest.map(function (r) { return r.label + ': ' + yn(f[r.key]); }).join(' | '));
  }
  L.push('  every heading on the page: ' + (f.headings.length ? f.headings.map(q).join(' | ') : 'none'));
  L.push('');
  L.push('THE ABSENCE RULE (absolute, overrides everything else): the CONTENT excerpt below is TRUNCATED and is NOT the whole page. You are seeing the beginning of it, not all of it. Therefore you may NEVER conclude that anything is missing, absent, thin, lacking, or "not on the page" merely because you did not see it in the excerpt. An absence claim is permitted ONLY when a FACT above explicitly says NO. If a fact says YES, that element EXISTS on the page: do not call it missing, do not recommend adding it, and do not recommend changing platform to obtain it. If you cannot verify presence or absence from the FACTS above, say nothing about it at all. "I did not see it" is NOT "it is not there". This applies with full force to the claims an analyst reaches for by reflex: no testimonials, no case studies, no pricing, no phone number, no contact form, no blog, no about page, no social links. Each of those has a FACT above. Check it before you write it. If a fact says YES you may still critique the QUALITY of that element (a vague testimonial, a buried phone number), but you may NEVER say it is absent.');
  return L.join('\n');
}

/* ---------- SEEING THE WHOLE PAGE ----------
   THE CURE, not another antibody.

   Every fabrication in this system had one parent: the model was shown a 1,000-3,000 char
   PREFIX of a page and asked to judge the whole thing. From that single wound came "no FAQ"
   (it was further down), "no email signup form" (further down), "200-300 words" (it was
   3,135), and "the product copy is truncated" (that was OUR cut). The fact table, the absence
   rule and the truncation rule all treat symptoms.

   The cap existed to protect the Netlify function timeout. That reasoning was wrong: INPUT
   tokens are prefilled almost for free, it is OUTPUT tokens that cost wall-clock time, and
   output is separately capped by max_tokens. A 3,135-word page is ~4k input tokens against a
   200k window. We were starving the model to save time we were never spending.

   So: give it the whole page.
     - an OUTLINE of every heading in document order (the true shape of the page)
     - the page text at a budget large enough that most pages fit COMPLETE
     - complete:true when the whole page fits, which finally lets the model reason about
       absence instead of being forbidden from it

   When coverage is complete, "I did not see it" and "it is not there" mean the same thing,
   and the guards become belt-and-braces rather than the load-bearing wall. */
function buildDigest(rawHtml, sig, limit) {
  var html = stripInert(rawHtml);     // headings inside <noscript>/<template> are not real
  var full = extractText(html);
  var complete = full.length <= limit;
  var text = complete ? full : clipExcerpt(full, limit);

  // Heading outline in DOCUMENT ORDER, so the model sees what exists further down than any
  // excerpt could reach. SSR+hydration repeats blocks, so dedupe: a visitor sees them once.
  var outline = [], seen = {}, m;
  var re = /<(h[123])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  while ((m = re.exec(html)) !== null) {
    var t = clean(m[2]);
    if (!t) continue;
    var key = m[1].toLowerCase() + '|' + t.toLowerCase();
    if (seen[key]) continue;
    seen[key] = 1;
    outline.push(m[1].toUpperCase() + ': ' + t);
    if (outline.length >= 60) break;
  }
  return { text: text, complete: complete, outline: outline };
}

function digestBlock(d) {
  if (!d) return '';
  var L = [];
  if (d.outline && d.outline.length) {
    L.push('PAGE OUTLINE (every heading, in the order a visitor meets them, across the WHOLE page):');
    L.push('  ' + d.outline.join('\n  '));
    L.push('');
  }
  if (d.complete) {
    L.push('COVERAGE: COMPLETE. The text below is the ENTIRE page, start to finish, nothing withheld. Because you can see all of it, you MAY reason about what is and is not on this page, and you MAY state that something is genuinely absent (cross-check the OBSERVED FACTS first). Do not hedge that your view was partial: it was not.');
  } else {
    L.push('COVERAGE: PARTIAL. The page ran past the budget, so the text below is cut, and the cut is OURS, not the site\'s. Use the PAGE OUTLINE above to know what exists further down, and never claim something is missing merely because it is not in the text below.');
  }
  return L.join('\n');
}

/* ---------- THE TRUNCATION RULE ----------
   The excerpt is cut by US, at a fixed character budget. On one test site the cut landed
   mid-word:

     ...Key Capabilities Cust|

   and the audit filed a HIGH fix saying the site's product copy "is truncated mid-sentence
   at 'Key Capabilities Custom prom', leaving the primary product offering incomplete and
   conversion-blocking". The live page reads "Key Capabilities Custom prompts tuned for your
   tech stack: Django + Postgres?..." - complete and healthy. It mistook its own scissors for
   the client's defect, and would have sent someone hunting for copy that was never missing.

   Same root cause as the absence fabrications (a truncated excerpt), different disguise: not
   "X is missing" but "X is broken". So: never cut mid-word, SAY that the cut is ours, and
   refuse any "the copy is cut off" finding about body text.

   A truncated TITLE or META is still fair game - those are passed complete, so a cut there
   is real (that site's About meta genuinely does end mid-sentence). */
function clipExcerpt(text, limit) {
  var t = String(text || '');
  if (t.length <= limit) return t;
  var cut = t.slice(0, limit);
  // Back off to a sentence boundary, else a word boundary. Never end mid-word.
  var sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence > limit * 0.6) cut = cut.slice(0, sentence + 1);
  else {
    var space = cut.lastIndexOf(' ');
    if (space > 0) cut = cut.slice(0, space);
  }
  return cut.trim() +
    '\n\n[EXCERPT ENDS HERE. This cut was made by the auditor to fit a character budget, NOT by the website. The page CONTINUES past this point with content you have not been shown. Do NOT report the page copy as truncated, cut off, incomplete, or ending mid-sentence on the basis of this boundary.]';
}

/* ---------- OUTPUT GUARDS: enforce in code what the prompt only asks for ----------
   Every one of these exists because a prompt rule alone was tried first and failed. */

// Refuse any finding that the page's BODY COPY is cut off / truncated / incomplete: the only
// truncation the model can actually see is the one we introduced. Title and meta are exempt,
// because those are handed over complete, so a cut there is genuinely the site's.
function stripTruncationClaims(text) {
  var TRUNC = /(truncat|cuts? off|cut off|mid-?sentence|mid-?word|ends? abruptly|incomplete (copy|sentence|text|product copy)|trails? off)/i;
  var EXEMPT = /\b(title tag|title|meta description|meta|og:|snippet)\b/i;
  return String(text || '').split('\n').filter(function (ln) {
    if (!/^\s*-/.test(ln)) return true;
    if (!TRUNC.test(ln)) return true;
    return EXEMPT.test(ln);        // a truncated title/meta is real; truncated body copy is us
  }).join('\n');
}

/* Drop any bullet that asserts the ABSENCE of something the FACTS say is present.
   Driven off the ABSENCE_FACTS table so a new fact automatically gets enforced.

   The negation set is deliberately EXISTENCE-only ("no X", "lacks X", "there is no X") and
   not general negation. That distinction matters: "the blog has not been updated since 2023"
   is a legitimate quality critique of a blog that EXISTS and must survive, while "there is no
   blog" is a fabrication if the fact says otherwise. Quality critique in, absence claim out. */
function enforceFacts(text, f) {
  if (!text || !f) return text;
  // "NO CLEARANCE" is an album title, not a negation. Neutralize before matching.
  var neutralize = function (s) { return s.replace(/\bno clearance\b/gi, 'ALBUMTITLE'); };
  var EXIST_NEG = '(?:\\bno\\b|\\bnone\\b|\\bnothing\\b|\\bmissing\\b|\\blacks?\\b|\\blacking\\b|\\babsent\\b|\\bwithout\\b|\\bhas no\\b|\\bhave no\\b|\\bthere (?:is|are) no\\b|\\bdoes not (?:have|include|offer|exist)\\b|\\bdo not (?:have|include|offer)\\b|\\bnot present\\b|\\bnot found\\b|\\bnowhere\\b|\\bfails? to (?:include|provide|offer)\\b)';
  var absentNear = function (s, kw) {
    return new RegExp(EXIST_NEG + '[^.;]{0,45}' + kw, 'i').test(s) ||
           new RegExp(kw + '[^.;]{0,30}' + EXIST_NEG, 'i').test(s);
  };

  return String(text).split('\n').filter(function (ln) {
    if (!/^\s*-/.test(ln)) return true;               // only ever filter bullet lines
    var s = neutralize(ln);

    // Table-driven: every absence-prone fact, enforced the same way.
    for (var i = 0; i < ABSENCE_FACTS.length; i++) {
      var r = ABSENCE_FACTS[i];
      if (f[r.key] === true && absentNear(s, r.kw)) return false;
    }

    // "Migrate to another platform to GET a capability it demonstrably already has."
    if (f.hasEmailCapture &&
        /(migrat|move to|switch to|wordpress|webflow|full (?:web)?site)/i.test(s) &&
        /(email|newsletter|signup|sign-?up|capture|form)/i.test(s)) return false;

    // A JS-rendered widget whose value was never observed is not "broken".
    if (f.hasCountdown && /(countdown|timer)/i.test(s) &&
        /(broken|frozen|freeze|stuck|stopped|not (?:working|running)|zero|00\s*[:d]|abandoned|neglect|stale)/i.test(s)) return false;

    // Word count comes from the FACTS, never from an impression of the excerpt length.
    if (f.wordCount >= 600 &&
        (/\b\d{2,3}\s*(?:to|-|–)\s*\d{2,3}\s*words\b/i.test(s) ||
         /(thin|sparse|shallow|scant|minimal|low)[^.;]{0,25}(word count|content|copy)/i.test(s) ||
         /(word count|content)[^.;]{0,20}(?:is |are )?(thin|sparse|shallow|scant|low)/i.test(s))) return false;

    /* FALSE PRESENCE is the mirror of false absence, and just as damaging: on one test site
       the audit praised "alt text on all images" as a STRENGTH on pages where 40 of 51 images
       had none. Inverting a defect into a strength is worse than missing it, because it also
       suppresses the real finding. So: if the facts say images are MISSING alt text, no bullet
       may claim they have it. */
    if (typeof f.imgCount === 'number' && typeof f.imgAlt === 'number' && f.imgCount > f.imgAlt) {
      if (/alt[- ]text|alt attribute/i.test(s) &&
          /\b(all|every|each|complete|full|present on all|solid|strong|good)\b/i.test(s) &&
          !/\b(missing|no|without|lacks?|zero|none)\b/i.test(s)) return false;
    }
    // Likewise, never assert a countdown/timer widget exists when no markup for one was found.
    if (f.hasCountdown === false && /(countdown|timer)[^.;]{0,40}(exists?|present|widget)/i.test(s)) return false;

    return true;
  }).join('\n');
}

// Strip invented quantified predictions ("15 to 25 percent lift", "3x to 5x traffic",
// "within 4 to 6 weeks", "Join 500+ fans"). Never touches a Current/Use value, which may
// legitimately quote a real number that is actually on the page.
function stripInventedMetrics(text) {
  var BAD = [
    /\b\d{1,3}\s*(?:to|-|–|and)\s*\d{1,3}\s*(?:percent|%)/i,
    /\b\d{1,3}\s*(?:percent|%)\s*(?:lift|increase|boost|gain|improvement|more|higher)/i,
    /\b\d+\s*x\s*(?:to|-|–)\s*\d+\s*x\b/i,
    /\b(?:double|triple|2x|3x|5x|10x)\b[^.;]{0,40}\b(traffic|conversion|revenue|signups?|leads?|audience)\b/i,
    /\bwithin\s+\d+\s*(?:to\s*\d+\s*)?(?:days|weeks|months)\b/i,
    /\bjoin\s+\d[\d,]*\+?\s+(?:fans|subscribers|readers|people|customers|others)/i
  ];
  return String(text || '').split('\n').filter(function (ln) {
    if (!/^\s*-/.test(ln)) return true;
    if (/\b(?:Current|Use):/.test(ln)) return true;   // a quoted real value is allowed
    return !BAD.some(function (r) { return r.test(ln); });
  }).join('\n');
}

/* LAYOUT CLAIMS ARE GATED ON HAVING ACTUALLY SEEN THE PAGE.

   This is the guard that lets Phase 2 exist safely. The very FIRST audit in this project
   confidently reported that streaming links were "buried" below merch, inferred purely from
   raw document order. It was false, and it is the original sin of the whole project.

   Now the audit can genuinely measure layout - but only when a render happened. So:
     geometry present -> position, fold, visual-order and prominence claims are ALLOWED,
                         because they are measured, and UX can be graded.
     geometry absent  -> every such claim is STRIPPED and UX stays n/a. Not because the claim
                         is necessarily wrong, but because we did not look, and a claim we did
                         not check is exactly what we have spent this whole project deleting. */
function enforceLayoutClaims(text, hasGeometry) {
  if (!text || hasGeometry) return text;
  var LAYOUT = /(above the fold|below the fold|above-the-fold|below-the-fold|first (?:screen|viewport)|without scrolling|scroll(?:ing)? (?:down )?to (?:find|reach|see)|buried|visual (?:hierarchy|order|weight|prominence)|on-?screen (?:order|position)|higher up the page|further down the page|move (?:it |this |the )?\w* ?(?:up|down|above|below)|top of the page|eye(?:-| )?catching|prominen(?:ce|t(?:ly)?))/i;
  return String(text).split('\n').filter(function (ln) {
    if (!/^\s*-/.test(ln)) return true;
    return !LAYOUT.test(ln);
  }).join('\n');
}

// Without a render there is no basis for a UX grade. Force it to n/a rather than let the
// model invent one from the HTML.
function forceUxUnassessed(text, hasGeometry) {
  if (!text || hasGeometry) return text;
  return String(text).replace(/(CATEGORY SCORES?:[^\n]*?)\bUX:\s*[A-F][+-]?/i, '$1UX: n/a');
}

/* A number the model COMPUTED rather than READ.

   The 3:23 report wrote "establishes 27 years of credibility" for a firm founded in 1997 in
   2026. The arithmetic is wrong (it is 29), and the page itself says 29. It did maths instead
   of reading. Any figure that does not appear verbatim in the page content or the facts is an
   invention, however plausible it looks - and a wrong number in a client deliverable is the
   most quietly damaging thing this tool can produce.

   So: any "<N> years" claim must actually appear in the source. If it does not, the bullet
   goes. */
function stripDerivedNumbers(text, corpus) {
  if (!text || !corpus) return text;
  var src = String(corpus);
  return String(text).split('\n').filter(function (ln) {
    if (!/^\s*-/.test(ln)) return true;
    var years = ln.match(/\b(\d{1,3})[- ]year(?:s)?\b/gi) || [];
    for (var i = 0; i < years.length; i++) {
      var n = (years[i].match(/\d{1,3}/) || [])[0];
      if (!n) continue;
      // Allow it only if that number appears in the page content / facts we were given.
      var seen = new RegExp('\\b' + n + '\\b').test(src);
      if (!seen) return false;
    }
    return true;
  }).join('\n');
}

/* DO NOT REPLACE GOOD HUMAN COPY WITH KEYWORD SALAD.

   The 3:41 report filed a MEDIUM to replace this home meta:

     "Every leader we talk to is fighting the same fight: roles that won't close, roadmaps
      that stall, and agencies that flood inboxes with the wrong people."

   with this:

     "Tech Talent Staffing & Recruiting | Permanent Placement, Contract Staffing, Executive
      Search & AI Teams | Northwind"

   Two things wrong. The replacement is a TITLE TAG, not a meta description: a meta is prose
   that earns a click, and pipes do not earn clicks. And an earlier run correctly praised that
   same meta as "the strongest pain-point statement on the site". The prompt already forbids
   filing a title/meta fix "merely to re-order, tighten, or front-load it" - the rule was there
   and the model went round it, which is the story of this entire project. So: enforce it.

   Two hard rules, both checkable from the fix line itself:
     1. A meta-description fix whose Use: value is pipe-delimited is proposing a title. Drop it.
     2. A title/meta fix whose ONLY complaint is front-loading/re-ordering, on a Current value
        that is already real custom prose, is the "polish a working thing" fix the prompt bans. */
function enforceMetaCraft(text) {
  var PLACEHOLDER = /\b(home final|untitled|new page|page \d|default|draft|copy of|template|test page|welcome to wordpress)\b/i;
  return String(text || '').split('\n').filter(function (ln) {
    if (!/^\s*-\s*\[/.test(ln)) return true;                 // PRIORITIZED FIXES lines only
    var isMeta = /meta description/i.test(ln);
    var isTitle = /\btitle tag\b/i.test(ln);
    if (!isMeta && !isTitle) return true;

    var use = (ln.match(/\bUse:\s*"([^"]+)"/i) || [])[1] || '';
    var cur = (ln.match(/\bCurrent:\s*"([^"]+)"/i) || [])[1] || '';

    // 1. A meta description is prose. A pipe-delimited string is a title tag.
    if (isMeta && (use.match(/\|/g) || []).length >= 2) return false;

    // 2. "Front-load the keyword" on copy that is already custom prose = banned polish.
    var onlyFrontLoading = /(front-?load|re-?order|lead with|does not (?:lead|start) with|reorder)/i.test(ln) &&
      !/(placeholder|truncat|malformed|duplicat|missing|empty|generic|error)/i.test(ln);
    var currentIsRealCopy = cur.length > 55 && !PLACEHOLDER.test(cur);
    if (onlyFrontLoading && currentIsRealCopy) return false;

    return true;
  }).join('\n');
}

/* NEVER LET THE SCAFFOLDING SHOW.

   The 4:04 report told the client their pages "carry zero social proof ... despite OBSERVED
   FACTS confirming their absence". OBSERVED FACTS is the name of an internal prompt block. It
   is my plumbing, and it leaked into a document a client reads. Nobody outside this codebase
   should ever learn that a thing called an OBSERVED FACTS block exists.

   Strip the internal vocabulary and let the sentence stand on its own. */
/* LINE BY LINE. The first version of this ran the whole report through /\s{2,}/g -> ' ', and
   \s INCLUDES NEWLINES: it collapsed every blank line between sections and flattened the entire
   report onto one line. parseSections then found no sections, renderAudit fell back to dumping
   the raw text, and the fallback has no Print button. One character class silently destroyed
   the report AND the PDF.

   So: never touch the line structure. Clean each line, leave the newlines alone, and only
   collapse runs of SPACES and TABS ([ \t]), never \s. */
function stripScaffolding(text) {
  var JARGON = /\b(?:OBSERVED FACTS|RENDERED LAYOUT|PAGE OUTLINE|VERBATIM SIGNALS|QUANTIFIED DEFECT LEDGER|SCAN FINDINGS|DOM TRUTH|THE ABSENCE RULE|THE TRUNCATION RULE|MAGNITUDE RULE|COVERAGE: (?:COMPLETE|PARTIAL))\b/gi;
  return String(text || '').split('\n').map(function (line) {
    if (!JARGON.test(line)) { JARGON.lastIndex = 0; return line; }   // leave clean lines untouched
    JARGON.lastIndex = 0;
    return line
      // "..., despite OBSERVED FACTS confirming their absence" -> drop the whole clause
      .replace(/,?\s*(?:as|and)?\s*(?:despite|per|according to|confirmed by|based on|as shown in|as confirmed by)\s+(?:the\s+)?(?:OBSERVED FACTS|RENDERED LAYOUT|PAGE OUTLINE|VERBATIM SIGNALS|QUANTIFIED DEFECT LEDGER|SCAN FINDINGS|DOM TRUTH)[^.;]*/gi, '')
      // any bare mention of the internal vocabulary
      .replace(/\b(?:the\s+)?(?:OBSERVED FACTS|RENDERED LAYOUT|PAGE OUTLINE|VERBATIM SIGNALS|QUANTIFIED DEFECT LEDGER|SCAN FINDINGS|COVERAGE: (?:COMPLETE|PARTIAL)|THE ABSENCE RULE|THE TRUNCATION RULE|MAGNITUDE RULE|DOM TRUTH)\b[ \t]*/gi, '')
      .replace(/\([ \t]*\)/g, '')
      .replace(/[ \t]{2,}/g, ' ')        // spaces and tabs ONLY. NEVER \s. Newlines are structure.
      .replace(/[ \t]+([.,;])/g, '$1')
      .replace(/[ \t]+$/g, '');
  }).join('\n');
}

// A platform limitation is never a PRIORITIZED FIX. The prompt says so; this makes it true.
function enforceSeverity(text, platform) {
  if (!text || !platform || !/link-in-bio/i.test(platform.kind || '')) return text;
  var LIMIT = /(alt[- ]text|canonical|json-?ld|schema markup|structured data|\bh1\b|heading (structure|hierarchy|control)|start a blog|add a blog)/i;
  return String(text).split('\n').filter(function (ln) {
    if (!/^\s*-\s*\[/.test(ln)) return true;          // only PRIORITIZED FIXES lines
    return !LIMIT.test(ln);
  }).join('\n');
}

/* The "WHY THESE CHANGES MATTER" section runs free and narrates a DIFFERENT, imaginary
   report: it has invented a "broken Shazam link" (there is no Shazam link on the page at
   all) and "missing TikTok and YouTube links" (both present), neither of which was ever
   filed as a fix. Passing it the finalized fix list was not enough. So: if a bullet makes a
   breakage or absence claim about a named thing that appears NOWHERE in the filed fixes,
   that bullet is about a fix that does not exist. Drop it. */
var TETHER_STOPWORDS = {
  the: 1, this: 1, that: 1, these: 1, those: 1, your: 1, our: 1, and: 1, but: 1, for: 1, with: 1,
  use: 1, current: 1, effort: 1, page: 1, home: 1, site: 1, together: 1, adding: 1, moving: 1,
  putting: 1, fixing: 1, reordering: 1, removing: 1, updating: 1, together_: 1, critical: 1,
  high: 1, medium: 1, low: 1, owner: 1, seo: 1, cta: 1, ctr: 1, google: 1, search: 1
};
function tetherToFixes(text, fixesText) {
  if (!text || !fixesText) return text;
  var fixes = String(fixesText).toLowerCase();
  var CLAIM = /(broken|missing|absent|dead link|not working|no longer|does not work|remove|reorder|move [^.]{0,20}above|add (a|the|missing))/i;
  return String(text).split('\n').filter(function (ln) {
    if (!/^\s*-/.test(ln)) return true;
    if (!CLAIM.test(ln)) return true;
    var body = ln.replace(/^\s*-\s*/, '');
    // Proper nouns and quoted phrases this bullet is making a claim about.
    var toks = (body.match(/"[^"]{2,40}"|\b[A-Z][A-Za-z]{2,}\b/g) || [])
      .map(function (t) { return t.replace(/"/g, '').trim().toLowerCase(); })
      .filter(function (t) { return t && !TETHER_STOPWORDS[t]; });
    // Ignore a capitalized first word (sentence case), it is not a claim about an entity.
    var first = (body.split(/\s+/)[0] || '').toLowerCase();
    toks = toks.filter(function (t) { return t !== first; });
    if (!toks.length) return true;
    var unknown = toks.filter(function (t) { return fixes.indexOf(t) === -1; });
    return unknown.length === 0;   // claims about un-filed entities are hallucinations
  }).join('\n');
}

/* ---------- MAGNITUDE: file the defect where it is BIGGEST ----------
   On that run every claim was finally true, but the audit filed the alt-text
   fix on AI Teams (5 images missing alt) while the Recruiting page had 41 of 52 missing and
   was never filed at all. It ranked by page prominence instead of by the size of the defect.
   A senior SEO leads with the 41.

   So: compute a ledger of the QUANTIFIED defects per page in code, show it to the model
   ranked, and then verify the biggest one actually got filed. If it did not, file it
   ourselves from the facts (a deterministic, quoted, correctly-shaped fix line) rather than
   trusting the next prompt edit to remember. */
function defectLedger(scans) {
  var rows = [];
  (scans || []).forEach(function (p) {
    var s = p && p.signals; if (!s) return;
    var f = s.facts || {};
    var imgCount = typeof f.imgCount === 'number' ? f.imgCount : s.imgCount;
    var imgAlt = typeof f.imgAlt === 'number' ? f.imgAlt : s.imgAlt;
    var missingAlt = (typeof imgCount === 'number' && typeof imgAlt === 'number') ? Math.max(0, imgCount - imgAlt) : 0;
    rows.push({
      label: p.label || labelFromUrl(p.url || ''),
      url: p.url || '',
      path: pathOf(p.url || ''),
      imgCount: imgCount || 0,
      missingAlt: missingAlt,
      dupH1: (s.h1s || []).length > 1,
      title: s.title || '',
      placeholderTitle: s.titleStrong === false
    });
  });
  return rows;
}
function pathOf(u) { try { return new URL(u).pathname || '/'; } catch (e) { return '/'; } }

function defectLedgerBlock(rows) {
  if (!rows || !rows.length) return '';
  var alt = rows.slice().sort(function (a, b) { return b.missingAlt - a.missingAlt; });
  var L = [];
  L.push('QUANTIFIED DEFECT LEDGER (computed in code, authoritative, ranked by SIZE):');
  L.push('  images missing alt text, worst first: ' + alt.map(function (r) {
    return r.label + ' (' + r.path + '): ' + r.missingAlt + ' of ' + r.imgCount;
  }).join(' | '));
  var dup = rows.filter(function (r) { return r.dupH1; });
  if (dup.length) L.push('  pages with more than one H1: ' + dup.map(function (r) { return r.label + ' (' + r.path + ')'; }).join(', '));
  L.push('');
  L.push('MAGNITUDE RULE: rank fixes by the SIZE of the defect times its impact, never by how important the page feels. When the SAME defect appears on several pages, file it on the page where it is LARGEST and state the count in the fix. It is a serious error to file the small instance of a defect (5 images) while leaving the large instance (41 images) unfiled. Quote the counts from this ledger exactly.');
  return L.join('\n');
}

// Enforcement, not a request: if the biggest quantified defect never made the fix list, file
// it from the facts. Deterministic, correctly shaped, and always true by construction.
function ensureTopDefectFiled(text, rows) {
  if (!text || !rows || !rows.length) return text;
  var worst = rows.slice().sort(function (a, b) { return b.missingAlt - a.missingAlt; })[0];
  if (!worst || worst.missingAlt < 8) return text;             // not material enough to force

  var fixes = sectionOf(text, /PRIORITI[SZ]ED FIXES/i);
  // Already covered if some fix mentions alt text AND names the worst page.
  var covered = /alt[- ]text|alt attribute/i.test(fixes) &&
    (fixes.indexOf(worst.path) > -1 || (worst.label && fixes.toLowerCase().indexOf(String(worst.label).toLowerCase()) > -1));
  if (covered) return text;

  var line = '- [High] ' + worst.label + ' page (' + worst.path + '), the images throughout the page: ' +
    worst.missingAlt + ' of ' + worst.imgCount + ' images carry no alt text, which fails WCAG accessibility and forfeits image-search visibility on the page that has the most images on the site. ' +
    'Current: "' + worst.missingAlt + ' of ' + worst.imgCount + ' images have no alt text". ' +
    'Use: "describe each image in plain language for a screen reader, naming what it shows and why it is there, for example: Recruiter reviewing a shortlist of vetted engineering candidates". ' +
    'Effort: 60 to 90 min (content editor, in the WordPress media library).';

  // Insert at the end of the PRIORITIZED FIXES section, before the next section header.
  var lines = String(text).split('\n');
  var HDR = /^(OVERVIEW|WHAT IS WORKING|WHAT IS COSTING|PRIORITI[SZ]ED FIXES|WHY THESE|STRATEGIC MOVES|WHERE AI|WHAT IT TAKES|NOT VERIFIED)/i;
  var start = -1;
  for (var i = 0; i < lines.length; i++) { if (/^PRIORITI[SZ]ED FIXES/i.test(lines[i].trim())) { start = i; break; } }
  if (start < 0) return text;
  var end = lines.length;
  for (var j = start + 1; j < lines.length; j++) { if (HDR.test(lines[j].trim())) { end = j; break; } }
  while (end > start + 1 && !lines[end - 1].trim()) end--;      // step back over blank lines
  lines.splice(end, 0, line);
  return lines.join('\n');
}

// One call so no code path forgets a guard.
function applyGuards(text, platform, facts, hasGeometry, corpus) {
  var out = String(text || '');
  out = enforceFacts(out, facts);
  out = stripScaffolding(out);
  out = stripDerivedNumbers(out, corpus);
  out = stripTruncationClaims(out);
  out = stripInventedMetrics(out);
  out = enforceSeverity(out, platform);
  out = enforceMetaCraft(out);
  out = enforceLayoutClaims(out, hasGeometry);
  out = forceUxUnassessed(out, hasGeometry);
  return out;
}

// Merge the per-page facts for the site-level synthesis: if ANY audited page has an email
// form or an FAQ, the SITE has one, and no bullet may claim otherwise.
function mergeFacts(scans) {
  var m = null;
  (scans || []).forEach(function (p) {
    var f = p && p.signals && p.signals.facts;
    if (!f) return;
    if (!m) { m = JSON.parse(JSON.stringify(f)); return; }
    // Generic on purpose: ANY boolean fact ORs, ANY numeric fact MAXes. A fact added to
    // extractFacts is merged automatically instead of being silently dropped here, which is
    // how a new guard would quietly stop working at the site level.
    Object.keys(f).forEach(function (k) {
      if (typeof f[k] === 'boolean') m[k] = (m[k] === true) || (f[k] === true);
      else if (typeof f[k] === 'number') m[k] = Math.max(m[k] || 0, f[k] || 0);
    });
  });
  return m;
}

// Format the link labels + button labels for a prompt. IMPORTANT: this is raw document
// order, NOT visual order, and it mixes CTA buttons, nav, utility links, and citations or
// links hidden behind "Show More". So it is only trustworthy for quoting real labels, never
// for inferring on-screen position or funnel order.
function linksBlock(sig) {
  var L = [];
  if (sig.links && sig.links.length) L.push('ON-PAGE LINK LABELS (raw document order, NOT visual order; this list mixes CTA buttons, navigation, utility links, and citations or links hidden behind a "Show More" clamp, so you CANNOT tell a link\'s on-screen position or whether it is a visible button from this list): ' + sig.links.map(function (x) { return '"' + x.t + '" -> ' + x.d; }).join('  |  ') + '. Use these ONLY to quote real link labels; do NOT infer funnel position, and do NOT file "buried link", "duplicate destination", or "fragmented funnel" findings from this list.');
  if (sig.buttons && sig.buttons.length) L.push('BUTTON / SUBMIT LABELS (verbatim CTA text): ' + sig.buttons.map(function (b) { return '"' + b + '"'; }).join(', '));
  return L.join('\n');
}

/* ---------- platform detection: judge and prescribe against what the owner can actually change ----------
   The audit used to implicitly assume a normal editable website (even a WordPress CMS),
   so it faulted locked no-code sites (a Hopp/Wix/Linktree link-in-bio) for things the
   platform controls and the owner cannot touch. This fingerprints the platform from the
   live HTML and returns a plain-language description of what IS and IS NOT changeable,
   which is fed into every model prompt so grades and fixes stay fair and realistic. */
function detectPlatform(html, url, shape) {
  var h = String(html || '');
  var L = h.toLowerCase();
  var has = function (s) { return L.indexOf(s) > -1; };
  var count = function (s) { return L.split(s).length - 1; };
  var gen = ((h.match(/<meta[^>]+name\s*=\s*["']generator["'][^>]*content\s*=\s*["']([^"']*)["']/i) || [])[1] || '') + ' ' +
            ((h.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']generator["']/i) || [])[1] || '');
  var g = gen.toLowerCase();
  var host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch (e) {}
  shape = shape || {};
  var bioShaped = (shape.wordCount || 0) < 110 && (shape.internalLinks || 0) <= 3 && (shape.externalLinks || 0) >= 3;

  // link-in-bio / bio-link builders (locked, single page). Hopp runs on Wix infra and its
  // app bundle is served from .../services/doppe/ (Hopp's internal name), so check it first.
  if (has('static.parastorage.com/services/doppe') || has('/services/doppe/') || count('hopp') >= 5 || has('hopp.co') || has('hopp.bio'))
    return platformInfo('Hopp', 'link-in-bio');
  if (host.indexOf('linktr.ee') > -1 || has('linktr.ee') || g.indexOf('linktree') > -1) return platformInfo('Linktree', 'link-in-bio');
  if (host.indexOf('carrd.co') > -1 || has('.carrd.co') || g.indexOf('carrd') > -1) return platformInfo('Carrd', 'link-in-bio');
  if (host.indexOf('beacons.ai') > -1 || has('beacons.ai')) return platformInfo('Beacons', 'link-in-bio');
  if (host.indexOf('bio.link') > -1 || has('//bio.link')) return platformInfo('Bio.link', 'link-in-bio');
  if (host.indexOf('hoo.be') > -1) return platformInfo('hoo.be', 'link-in-bio');

  // ecommerce
  if (has('cdn.shopify.com') || has('shopify.theme') || g.indexOf('shopify') > -1) return platformInfo('Shopify', 'ecommerce');

  // hosted website builders (bio-shaped pages on these are really link-in-bio pages)
  if (g.indexOf('wix') > -1 || has('static.parastorage.com') || has('static.wixstatic.com') || has('//www.wix.com'))
    return platformInfo('Wix', bioShaped ? 'link-in-bio' : 'site-builder');
  if (g.indexOf('squarespace') > -1 || has('static1.squarespace.com') || has('assets.squarespace.com'))
    return platformInfo('Squarespace', bioShaped ? 'link-in-bio' : 'site-builder');
  if (g.indexOf('webflow') > -1 || has('assets.website-files.com') || has('assets-global.website-files.com'))
    return platformInfo('Webflow', bioShaped ? 'link-in-bio' : 'site-builder');
  if (g.indexOf('framer') > -1 || has('framerusercontent.com')) return platformInfo('Framer', bioShaped ? 'link-in-bio' : 'site-builder');

  // CMS
  if (g.indexOf('wordpress') > -1 || has('/wp-content/') || has('/wp-includes/') || has('wp-json')) return platformInfo('WordPress', 'cms');
  if (g.indexOf('ghost') > -1) return platformInfo('Ghost', 'cms');
  if (g.indexOf('drupal') > -1 || has('/sites/default/files')) return platformInfo('Drupal', 'cms');
  if (g.indexOf('joomla') > -1) return platformInfo('Joomla', 'cms');

  // fallback: a bio-shaped page on an unknown host is still a link hub
  if (bioShaped) return platformInfo('a link-in-bio builder', 'link-in-bio');
  return platformInfo('Custom / unknown', 'custom');
}

function platformInfo(name, kind) {
  var control = {
    'link-in-bio':
      'This is a LINK-IN-BIO page built on ' + name + ', a locked no-code platform. The owner CAN change: the links and their order, the bio and headline text, the profile image, theme and colors, and the page title and SEO description fields the builder exposes (so the title and meta are frequently already custom, do not assume they are platform defaults, read them). The owner definitively CANNOT: add per-image ALT TEXT (the image menu is only crop/replace/remove, no alt field), add a CANONICAL tag, add JSON-LD or SCHEMA markup, edit raw HTML, control H1 or heading tags, add more pages, run a blog, or inject scripts. Those missing capabilities are PLATFORM LIMITATIONS, never owner-fixable fixes and never CRITICAL; raise them at most once as a reason to move to a full site under STRATEGIC MOVES, and never hedge "if the platform exposes". The H1 on this kind of page is the artist or creator DISPLAY NAME rendered in large type on the profile card, NOT an SEO title: never rewrite it into a keyword string or a pipe-delimited title (that would look broken). ' + name + ' link-in-bio pages DO support email capture, buttons, and forms, so if a signup or "get early access" button is on the page, email capture already exists, do not recommend migrating to obtain it. Judge this as a link-in-bio, whose one job is to route a visitor to the right destination in seconds, NOT as a full website. Do NOT lower the grade for being a single page, thin word count, a platform-set title or meta, a missing or single H1, no schema, or no blog when the platform controls those. Grade against what an excellent link-in-bio does: instantly clear who and what this is, the right links prioritized, credible profile and proof, fast obvious taps. Treat every platform limit as a CONSTRAINT, not an owner mistake. Recommend ONLY changes possible inside the ' + name + ' editor. If a real gain needs capabilities the platform lacks, put moving to a full website or custom domain in STRATEGIC MOVES, never in PRIORITIZED FIXES or as a quick fix.',
    'site-builder':
      'This site is built on ' + name + ', a hosted website builder. The owner edits content, copy, images and alt text, page titles and meta descriptions through the builder\'s SEO panel, headings, and page layout in the visual editor, but generally CANNOT touch raw server HTML or inject custom code except on higher paid tiers. Frame every fix as an action inside the ' + name + ' editor or its SEO settings (for example "in the page SEO panel, set the title to..."), never as "edit the code" or "get CMS or codebase access". Only call something a constraint if ' + name + ' genuinely cannot do it.',
    'ecommerce':
      'This is a ' + name + ' store. The owner works through the theme customizer, theme templates, and admin settings. Frame fixes as theme-editor or admin changes, with developer help only for template-level work.',
    'cms':
      'This site runs on ' + name + ', so the owner has theme and template plus CMS access and a developer can make structural, code, and template changes. Standard full-site recommendations apply.',
    'custom':
      'No hosted-platform fingerprint was detected, so treat this as a custom-built site with normal code and CMS access. Standard recommendations apply, but do not name a specific stack you have not confirmed; say "the codebase and CMS" generically rather than assuming WordPress.'
  };
  return { name: name, kind: kind, control: control[kind] || control.custom };
}

/* Read an HTML attribute WITHOUT letting an apostrophe inside the value end it early.

   The old pattern was /content\s*=\s*["']([\s\S]*?)["']/ . That character class matches EITHER
   quote as the closing delimiter, so a value opened with a double quote was cut at the first
   APOSTROPHE inside it. One test site's pricing meta read:

       "... The honest price page. We don't hide fees, we don't do surprise markups ..."

   and the parser handed the model:

       "... The honest price page. We don"          <- sliced at the ' in "don't"

   The audit then dutifully filed it as "a malformed meta description, cut at 'We don'". The
   MODEL was right about what it saw. MY PARSER corrupted the evidence. Same shape as the
   alt="" bug and the <noscript> ghosts: the model has been faithfully reporting what my code
   handed it, and my code kept lying to it.

   Now the closing quote must MATCH the opening one (backreference), with a bare unquoted
   fallback. */
function attrOf(tag, name) {
  var re = new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s">]+))', 'i');
  var m = String(tag || '').match(re);
  if (!m) return '';
  return m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : (m[3] || ''));
}

function metaContent(html, name) {
  var tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (var i = 0; i < tags.length; i++) {
    if (new RegExp('name\\s*=\\s*["\']?' + name + '["\'\\s>]', 'i').test(tags[i])) {
      return clean(attrOf(tags[i], 'content'));
    }
  }
  return '';
}
function ogContent(html, prop) {
  var tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (var i = 0; i < tags.length; i++) {
    if (new RegExp('property\\s*=\\s*["\']?' + prop + '["\'\\s>]', 'i').test(tags[i])) {
      return clean(attrOf(tags[i], 'content'));
    }
  }
  return '';
}
function firstMatch(html, re) { var m = html.match(re); return m ? m[1] : ''; }
function allMatches(html, re) {
  var out = [], m;
  while ((m = re.exec(html)) !== null) { out.push(m[1]); }
  return out;
}

function extractText(html) {
  return dedupeText(decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim());
}
// Collapse duplicated blocks that a server-rendered SPA (Hopp/Wix/React) emits twice
// (server-render + hydration). Drops any 40+ char sentence that already appeared, so the
// same hero/bio block is not read as "repeated content". Real unique copy is untouched.
function dedupeText(t) {
  var parts = String(t || '').split(/(?<=[.!?·])\s+/);
  var seen = {}, out = [];
  for (var i = 0; i < parts.length; i++) {
    var key = parts[i].trim().toLowerCase();
    if (key.length >= 18) { if (seen[key]) continue; seen[key] = 1; }
    out.push(parts[i]);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}
function clean(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&mdash;/g, ', ').replace(/&ndash;/g, '-').replace(/&middot;/g, '.')
    .replace(/&nbsp;/g, ' ').replace(/&hellip;/g, '...')
    .replace(/&#(\d+);/g, function (_, n) { try { return String.fromCharCode(+n); } catch (e) { return ' '; } });
}

/* ============================ gate + grade ============================ */

function extractGrade(text) {
  // Matches the synthesis "OVERALL GRADE:" and the compact scan "GRADE:".
  var m = String(text || '').match(/(?:OVERALL )?GRADE:\s*([A-F][+-]?)/i);
  return m ? m[1].toUpperCase() : '';
}


/* Exposed for the regression harness (test/audit-guards.test.js). Pure functions only;
   nothing here runs in the Netlify handler path. */
exports.__internals = {
  extractSignals: extractSignals, extractFacts: extractFacts, factsBlock: factsBlock,
  enforceFacts: enforceFacts, stripInventedMetrics: stripInventedMetrics,
  enforceSeverity: enforceSeverity, tetherToFixes: tetherToFixes, applyGuards: applyGuards,
  mergeFacts: mergeFacts, isShell: isShell, extractText: extractText,
  defectLedger: defectLedger, defectLedgerBlock: defectLedgerBlock, ensureTopDefectFiled: ensureTopDefectFiled,
  clipExcerpt: clipExcerpt, stripTruncationClaims: stripTruncationClaims,
  geometryFacts: geometryFacts, geometryBlock: geometryBlock,
  enforceLayoutClaims: enforceLayoutClaims, forceUxUnassessed: forceUxUnassessed,
  stripDerivedNumbers: stripDerivedNumbers, applyDomTruth: applyDomTruth,
  enforceMetaCraft: enforceMetaCraft, stripScaffolding: stripScaffolding,
  buildDigest: buildDigest, digestBlock: digestBlock,
  scorePath: scorePath, discoverPages: discoverPages, labelFromUrl: labelFromUrl
};

/* ============================ plumbing ============================ */

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
function json(statusCode, obj) {
  return { statusCode: statusCode, headers: Object.assign({ 'Content-Type': 'application/json' }, cors()), body: JSON.stringify(obj) };
}
function device(ua) {
  ua = ua || '';
  var b = /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  var os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : '';
  return os ? b + ' on ' + os : b;
}
async function logUsage(meta, message, ctx) {
  ctx = ctx || {};
  var usage = message && message.usage ? message.usage : {};
  var record = Object.assign({}, meta, {
    unlocked: ctx.unlocked === true,
    tokensIn: usage.input_tokens,
    tokensOut: usage.output_tokens
  });
  console.log('[USAGE]', JSON.stringify(record));

  var hook = process.env.LOG_WEBHOOK_URL;
  if (!hook) return;
  var ownerIps = (process.env.OWNER_IP || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var isOwner = ctx.owner === true || ownerIps.indexOf(record.ip) !== -1;
  if (isOwner) return;

  var access = 'Unlocked with the site passcode';
  var summary =
    '🔍 **Someone ran your Grayrender AI Marketing Audit**\n' +
    '🌐 Audited URL: **' + (record.inputs && record.inputs.url) + '**\n' +
    '🔓 Access: **' + access + '**\n' +
    '🌍 ' + record.ip + ' (' + record.country + ')\n' +
    '💻 ' + device(record.userAgent) + '\n' +
    '🔗 ' + record.referer + '\n' +
    '🕒 ' + record.time;
  await fetch(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: summary, text: summary })
  });
}
