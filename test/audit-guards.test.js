/**
 * Regression harness for the AI Marketing Audit.
 *
 * Every case below is a REAL false claim the audit shipped in a report about zhaion.com,
 * verified against the live page and found to be wrong. They are frozen here so no future
 * prompt edit can quietly bring them back.
 *
 * The through-line: every fabrication was an ABSENCE claim inferred from a TRUNCATED
 * excerpt. The model was shown the first ~1000 chars of a 3,135-word page and concluded
 * that what it could not see did not exist.
 *
 * Run:  node test/audit-guards.test.js
 */
const A = require('../netlify/functions/audit.js').__internals;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}
function dropped(before, after) { return before.trim() && !after.split('\n').some(l => l.trim() === before.trim()); }
function kept(before, after) { return after.split('\n').some(l => l.trim() === before.trim()); }

/* The real, verified facts of zhaion.com (checked against the live DOM). */
const FACTS = {
  wordCount: 3135,
  hasEmailCapture: true, emailInput: true, formCount: 1,
  hasFAQ: true, faqQuestionCount: 10,
  hasBioSection: true,
  hasCountdown: true,
  imgCount: 29, imgAlt: 0,
  hasCanonical: false, hasJsonLd: false,
  headings: ['Zhaion, AI-Hybrid R&B Artist', 'NO CLEARANCE', 'FAQ', 'Who is Zhaion?']
};
const BIO = { name: 'Hopp', kind: 'link-in-bio' };

console.log('\nABSENCE CLAIMS CONTRADICTED BY THE FACTS  (v3 and v5 shipped all of these)');

// v5: claimed there is no email form. There is an <input type="email"> on the page, and the
// same report quoted that form's own button ("Get Early Access to NO CLEARANCE") as the CTA.
const c1 = '- Link-in-bio funnel does not capture email or build owned audience: the "Get Early Access to NO CLEARANCE" button exists, but there is no visible email signup form or newsletter CTA on the page itself.';
check('drops "no visible email signup form" (form exists)', dropped(c1, A.enforceFacts(c1, FACTS)));

// v3: recommended migrating off the platform to obtain email capture it already has.
const c2 = '- Migrate to a full website or custom domain: Hopp cannot add per-image alt text, canonical tags, or a mailing-list signup form; a WordPress or Webflow site would unlock email capture.';
check('drops "migrate to get email capture" (already present)', dropped(c2, A.enforceFacts(c2, FACTS)));

// v5: claimed no FAQ. There is an FAQ block with 10 question headings.
const c3 = '- Thin word count and single-page depth: there is no blog, no artist bio, no production credits, and no FAQ to answer long-tail queries.';
check('drops "no FAQ / no artist bio" (both exist)', dropped(c3, A.enforceFacts(c3, FACTS)));

// v5: claimed 200-300 words. The page has 3,135.
const c4 = '- Thin word count: the page is 200-300 words of visible content, which caps topical authority.';
check('drops "200-300 words" (page has 3,135)', dropped(c4, A.enforceFacts(c4, FACTS)));

// v3: called the countdown broken. It was live at 66 days; the zeros are pre-hydration.
const c5 = '- Countdown timer displays "00 days : 00 hours : 00 min : 00 sec" (frozen or broken): a broken countdown kills urgency and signals technical neglect.';
check('drops "countdown is frozen/broken" (widget is live)', dropped(c5, A.enforceFacts(c5, FACTS)));

console.log('\nTRUE FINDINGS MUST SURVIVE  (the guards must not gut a real audit)');

const t1 = '- All 29 images have zero alt text, which breaks accessibility and image-search visibility.';
check('keeps the real alt-text finding', kept(t1, A.enforceFacts(t1, FACTS)));

const t2 = '- No canonical tag and no JSON-LD schema, so search engines cannot index the artist and album as structured data.';
check('keeps the real canonical/schema finding', kept(t2, A.enforceFacts(t2, FACTS)));

// "NO CLEARANCE" is an album title, not a negation. It must not trip the absence matcher.
const t3 = '- The NO CLEARANCE email campaign and the FAQ both reinforce the album narrative well.';
check('does not misread the album title "NO CLEARANCE" as a negation', kept(t3, A.enforceFacts(t3, FACTS)));

console.log('\nINVENTED NUMBERS  (v2 and v5)');

const m1 = '- Realistic outcome: expect a 15 to 25 percent lift in organic click-through within 4 to 6 weeks.';
check('drops the fabricated "15 to 25 percent lift"', dropped(m1, A.stripInventedMetrics(m1)));

const m2 = '- A WordPress or Webflow site would drive 3x to 5x more organic traffic over 12 months.';
check('drops the fabricated "3x to 5x traffic"', dropped(m2, A.stripInventedMetrics(m2)));

const m3 = '- AI would A/B test the email signup copy, lifting email capture rate by 20 to 40 percent over baseline.';
check('drops the fabricated "20 to 40 percent"', dropped(m3, A.stripInventedMetrics(m3)));

const m4 = '- Pair the CTA with social proof ("Join 500+ fans...") to increase conversion.';
check('drops the fabricated "Join 500+ fans" social proof', dropped(m4, A.stripInventedMetrics(m4)));

// A real number quoted from the page in a Current/Use value is legitimate and must survive.
const m5 = '- [Low] Home page (/), the meta description: tighten the hook. Current: "#5 iTunes R&B/Soul, 279K+ Spotify streams". Use: "NO CLEARANCE drops 9.18.26 | #5 iTunes, 279K+ streams". Effort: 10 min (owner).';
check('keeps real numbers quoted in a Current/Use value', kept(m5, A.stripInventedMetrics(m5)));

console.log('\nORPHANED NARRATIVE  (v4: the "Why These Changes Matter" section invented its own fixes)');

const FIXES = [
  '- [High] Home page (/), the email capture button: visitors do not know what early access includes. Current: "Get Early Access to NO CLEARANCE". Use: "Join the list for the presave link and first listen". Effort: 15 min (owner).',
  '- [Low] Home page (/), the image alt text: all 29 images have no alt text. Current: "(none)". Use: "(platform limitation)". Effort: n/a.'
].join('\n');

// There is no Shazam link on the page at all, and TikTok and YouTube are both present.
// Neither was ever filed as a fix. The narrative section invented all three.
const o1 = '- Fixing the broken Shazam link and adding missing platform links (TikTok, YouTube channel) removes friction from the discovery path.';
check('drops the invented "broken Shazam link" (never filed, does not exist)', dropped(o1, A.tetherToFixes(o1, FIXES)));

const o2 = '- Clarifying what "Get Early Access" delivers converts passive visitors into owned contacts before they leave for streaming.';
check('keeps narrative that maps to a filed fix', kept(o2, A.tetherToFixes(o2, FIXES)));

console.log('\nSEVERITY GATE  (a platform limitation is never an owner fix)');

const s1 = '- [High] Home page (/), the H1 tag: Hopp does not expose H1 editing, so this is a platform limitation. Current: "Zhaion". Use: "NO CLEARANCE | Zhaion". Effort: strategic.';
check('drops an unfixable H1 fix ranked High on a link-in-bio', dropped(s1, A.enforceSeverity(s1, BIO)));

const s2 = '- [Critical] Home page (/), all 29 images: add alt text to every image. Current: "(none)". Use: "NO CLEARANCE album cover by Zhaion". Effort: 20 min (owner).';
check('drops a Critical alt-text fix the platform forbids', dropped(s2, A.enforceSeverity(s2, BIO)));

const s3 = '- [High] Home page (/), the Subscribe button: the label does not say what the visitor gets. Current: "Subscribe". Use: "Get Early Access to NO CLEARANCE". Effort: 5 min (owner).';
check('keeps a real, owner-fixable High', kept(s3, A.enforceSeverity(s3, BIO)));

console.log('\nFACT EXTRACTION FROM RAW HTML  (the data was always there; nobody was passing it)');

const HTML = `<html><head><title>NO CLEARANCE | Zhaion</title></head><body>
<h1>Zhaion, AI-Hybrid R&amp;B Artist</h1>
<h2>NO CLEARANCE</h2><h2>Who is Zhaion?</h2><h2>FAQ</h2>
<h3>Is Zhaion an AI artist?</h3><h3>What genre is it?</h3><h3>Where can I listen?</h3>
<div class="countdown">66 days 13 hours 47 min 35 sec</div>
<form><input type="email" placeholder="Type your email"><button>Get Early Access to NO CLEARANCE</button></form>
<p>${'word '.repeat(700)}</p></body></html>`;
const sig = A.extractSignals(HTML, 'https://zhaion.com');
const f = A.extractFacts(HTML, sig);
check('detects the email capture form', f.hasEmailCapture === true);
check('detects the FAQ section', f.hasFAQ === true, 'faqQuestionCount=' + f.faqQuestionCount);
check('detects the bio / about section', f.hasBioSection === true);
check('detects the countdown widget', f.hasCountdown === true);
check('reports a real word count (not an impression)', f.wordCount > 600, 'wordCount=' + f.wordCount);

/* ------------------------------------------------------------------------------------
   THE CATEGORY FIX.

   The six false claims above were the ones we happened to catch. They are not special:
   they are the shape of EVERY absence claim inferred from a truncated excerpt. On a normal
   business site the same failure lands on the things a marketing analyst reaches for by
   reflex - "no testimonials", "no case studies", "no pricing page", "no phone number",
   "no blog". None of those can be verified from the first 1,000 characters of a page.

   So each now has a deterministic fact, and the guard is table-driven off ABSENCE_FACTS.
   These tests assert the whole category is closed, not just the instances we got burned by.
   ------------------------------------------------------------------------------------ */
console.log('\nTHE CATEGORY: absence claims a marketing analyst makes by reflex (WordPress-shaped)');

const SITE = {
  wordCount: 2400,
  hasTestimonials: true, hasCaseStudies: true, hasPricing: true, hasContactForm: true,
  hasPhone: true, hasEmailAddress: true, hasAboutOrTeam: true, hasBlog: true,
  hasVideo: true, hasSocialLinks: true, hasSearch: true, hasCTAButtons: true,
  hasEmailCapture: false, hasFAQ: false, hasBioSection: false, hasCountdown: false,
  imgCount: 40, imgAlt: 40, hasCanonical: true, hasJsonLd: true, headings: []
};

const cat = [
  ['testimonials', '- The site has no testimonials or social proof anywhere, so a visitor has no reason to trust the claims.'],
  ['case studies', '- There are no case studies or success stories to demonstrate results to a skeptical buyer.'],
  ['pricing',      '- Missing pricing page: prospects cannot self-qualify and drop out of the funnel.'],
  ['contact form', '- The page lacks a contact form, forcing visitors to hunt for a way to get in touch.'],
  ['phone number', '- No phone number is present, which costs trust for high-consideration B2B buyers.'],
  ['about/team',   '- Without an about page or team page, the site has no E-E-A-T signals for Google.'],
  ['blog',         '- There is no blog, so the site cannot rank for long-tail informational queries.'],
  ['social links', '- The site has no social media links, cutting off a discovery channel.'],
  ['site search',  '- No site search function, so visitors cannot find what they need.']
];
cat.forEach(([what, bullet]) => {
  check('drops fabricated "no ' + what + '" (it exists)', dropped(bullet, A.enforceFacts(bullet, SITE)));
});

// The other half of the contract: if a fact says NO, the absence claim is TRUE and must survive.
const true1 = '- There is no FAQ section to answer common objections before the visitor bounces.';
check('KEEPS a true absence claim (fact says NO)', kept(true1, A.enforceFacts(true1, SITE)));

// And the distinction that makes the guard usable: quality critique of a thing that EXISTS.
// "the blog has not been updated" is a real finding. "there is no blog" is a fabrication.
const qual1 = '- The blog has not been updated since 2023, which signals an abandoned site to both visitors and Google.';
check('KEEPS a quality critique of an element that exists', kept(qual1, A.enforceFacts(qual1, SITE)));

const qual2 = '- The testimonials are vague and unattributed, so they carry little persuasive weight.';
check('KEEPS a quality critique of the testimonials', kept(qual2, A.enforceFacts(qual2, SITE)));

const qual3 = '- The phone number is buried in the footer rather than placed near the primary CTA.';
check('KEEPS a placement critique of the phone number', kept(qual3, A.enforceFacts(qual3, SITE)));

console.log('\nFACT EXTRACTION ON A WORDPRESS-SHAPED PAGE');
const WP = `<html><head><title>Managed IT Services | Acme</title>
<link rel="canonical" href="https://acme.com/"></head><body>
<nav><a href="/pricing">Pricing</a><a href="/about">About Us</a><a href="/blog">Blog</a>
<a href="/case-studies">Case Studies</a><a href="/contact">Contact</a></nav>
<h1>Managed IT for Manufacturers</h1>
<h2>What our clients say</h2>
<blockquote>They cut our downtime in half. - Jane Doe, COO</blockquote>
<a href="tel:+13135551234">313-555-1234</a><a href="mailto:hi@acme.com">hi@acme.com</a>
<iframe src="https://www.youtube.com/embed/abc"></iframe>
<a href="https://www.linkedin.com/company/acme">LinkedIn</a>
<form><textarea name="message"></textarea><button>Request a Quote</button></form>
<input type="search" name="s">
<p>${'word '.repeat(700)}</p></body></html>`;
const wsig = A.extractSignals(WP, 'https://acme.com');
const wf = A.extractFacts(WP, wsig);
[['testimonials', 'hasTestimonials'], ['case studies', 'hasCaseStudies'], ['pricing', 'hasPricing'],
 ['contact form', 'hasContactForm'], ['phone', 'hasPhone'], ['email address', 'hasEmailAddress'],
 ['about/team', 'hasAboutOrTeam'], ['blog', 'hasBlog'], ['video', 'hasVideo'],
 ['social links', 'hasSocialLinks'], ['site search', 'hasSearch'], ['CTA buttons', 'hasCTAButtons']
].forEach(([label, key]) => check('detects ' + label, wf[key] === true, key + '=' + wf[key]));

// A page that genuinely has none of it must report NO, or the guard would suppress true findings.
const BARE = '<html><head><title>x</title></head><body><h1>Hello</h1><p>Just a page.</p></body></html>';
const bf = A.extractFacts(BARE, A.extractSignals(BARE, 'https://bare.com'));
check('a bare page reports NO testimonials (true absence survives)', bf.hasTestimonials === false);
check('a bare page reports NO pricing', bf.hasPricing === false);
check('a bare page reports NO blog', bf.hasBlog === false);

/* ------------------------------------------------------------------------------------
   FALSE PRESENCE - the mirror of false absence, found on the northwind.example run.

   The audit praised "alt text on all images (8 to 52 per page)" as a STRENGTH. On the live
   site the home page had 4 of 7 images with no alt text, and the recruiting page had 40 of
   51. It inverted a real accessibility and SEO defect into a strength, which also SUPPRESSED
   the genuine finding.

   Root cause was a code bug, not the model: extractSignals counted alt text with /\balt\s*=/,
   which matches alt="" - and WordPress emits empty alt="" on decorative images constantly.
   "Has the attribute" was being counted as "has alt text".
   ------------------------------------------------------------------------------------ */
console.log('\nFALSE PRESENCE  (northwind.example: a defect praised as a strength)');

const ALT_HTML = `<html><body>
<img src="a.jpg" alt="A real description">
<img src="b.jpg" alt="">
<img src="c.jpg" alt="   ">
<img src="d.jpg">
</body></html>`;
const asig = A.extractSignals(ALT_HTML, 'https://acme.com');
check('empty alt="" is NOT counted as alt text', asig.imgAlt === 1, 'imgCount=' + asig.imgCount + ' imgAlt=' + asig.imgAlt);
check('counts all four images', asig.imgCount === 4);

const ALT_FACTS = { imgCount: 51, imgAlt: 11, hasCountdown: false, wordCount: 2000 };
const fp1 = '- Solid technical foundation across all pages: canonical tags, JSON-LD schema, viewport meta, alt text on all images (8 to 52 per page), and contact forms on every page.';
check('drops "alt text on all images" when 40 of 51 lack it', dropped(fp1, A.enforceFacts(fp1, ALT_FACTS)));

const fp2 = '- 40 of 51 images on the recruiting page have no alt text, costing accessibility compliance and image-search visibility.';
check('KEEPS the true alt-text defect finding', kept(fp2, A.enforceFacts(fp2, ALT_FACTS)));

// A page where alt text really IS complete must still be allowed to say so.
const GOOD_ALT = { imgCount: 12, imgAlt: 12, hasCountdown: false, wordCount: 2000 };
const fp3 = '- Every image carries descriptive alt text, which supports accessibility and image search.';
check('KEEPS a TRUE alt-text strength when every image has one', kept(fp3, A.enforceFacts(fp3, GOOD_ALT)));

// The honesty appendix must not assert a widget exists on a site that has none.
const fp4 = '- Countdown timer and live widget values rendered by JavaScript were not read; the widgets exist but their state was not verified.';
check('drops "the widgets exist" when no countdown markup was found', dropped(fp4, A.enforceFacts(fp4, ALT_FACTS)));

// And the word "countdown" buried in a bundled script must not fake a widget into existence.
const SCRIPTY = '<html><head><script>var countdown=function(){};</script></head><body><h1>Staffing</h1><p>' + 'word '.repeat(700) + '</p></body></html>';
const sf = A.extractFacts(SCRIPTY, A.extractSignals(SCRIPTY, 'https://acme.com'));
check('the word "countdown" inside a <script> does not create a widget', sf.hasCountdown === false);

/* ------------------------------------------------------------------------------------
   MAGNITUDE - file the defect where it is BIGGEST.

   On the northwind.example run every claim was finally true, but the audit filed the alt-text
   fix on AI Teams (5 of 8 images missing) while the Recruiting page had 41 of 52 missing and
   was never filed at all. It ranked by how important the page felt, not by the size of the
   defect. A senior SEO leads with the 41.
   ------------------------------------------------------------------------------------ */
console.log('\nMAGNITUDE  (northwind.example: filed the 5-image gap, never filed the 41-image gap)');

const SCANS = [
  { label: 'Home', url: 'https://northwind.example/', signals: { title: 'Home Final - Northwind', titleStrong: false, h1s: ['Tech Talent', 'The tech talent you need.'], facts: { imgCount: 8, imgAlt: 3 } } },
  { label: 'AI Teams', url: 'https://northwind.example/ai-teams', signals: { title: 'AI Teams - Northwind', titleStrong: false, h1s: ['Tech Talent', 'Find the work.'], facts: { imgCount: 8, imgAlt: 3 } } },
  { label: 'Recruiting', url: 'https://northwind.example/recruiting-services-in-the-usa', signals: { title: 'Top Executive Recruiting Services', titleStrong: true, h1s: ['Tech Talent', 'Highly Reliable'], facts: { imgCount: 52, imgAlt: 11 } } }
];

const ledger = A.defectLedger(SCANS);
const worst = ledger.slice().sort((a, b) => b.missingAlt - a.missingAlt)[0];
check('ledger identifies Recruiting as the worst alt-text page', worst.label === 'Recruiting' && worst.missingAlt === 41, worst.label + '=' + worst.missingAlt);
check('ledger block ranks worst-first and quotes real counts', /Recruiting[^|]*41 of 52/.test(A.defectLedgerBlock(ledger)));
check('ledger flags every page with more than one H1', /more than one H1/.test(A.defectLedgerBlock(ledger)));

// The exact failure: a report that files the 5-image gap and never the 41-image gap.
const MISPRIORITIZED = [
  'PRIORITIZED FIXES',
  '- [Critical] Home page (/), H1 structure: two H1 tags confuse search engines. Current: "Tech Talent". Use: "The tech talent you need. Right now.". Effort: 30 min (developer).',
  '- [High] AI Teams page (/ai-teams), image alt text: 3 of 8 images have alt text. Current: "3 of 8 images have alt text". Use: "add alt text to the remaining 5". Effort: 20 min (content editor).',
  '',
  'STRATEGIC MOVES',
  '- Standardize H1 structure across all pages.'
].join('\n');

const forced = A.ensureTopDefectFiled(MISPRIORITIZED, ledger);
check('files the 41-image gap that the model left out', /41 of 52/.test(forced));
check('files it against the correct page path', /recruiting-services-in-the-usa/.test(forced));
check('the forced fix lands INSIDE Prioritized Fixes, not after it',
  forced.indexOf('41 of 52') < forced.indexOf('STRATEGIC MOVES'));
check('does not disturb the fixes the model got right', /\[Critical\] Home page \(\/\), H1 structure/.test(forced));

// If the model ALREADY filed the biggest one, do not duplicate it.
const CORRECT = [
  'PRIORITIZED FIXES',
  '- [High] Recruiting page (/recruiting-services-in-the-usa), the images: 41 of 52 images have no alt text. Current: "41 of 52 images have no alt text". Use: "describe each image". Effort: 90 min (content editor).',
  '',
  'STRATEGIC MOVES'
].join('\n');
check('does NOT double-file when the model already covered the worst page',
  A.ensureTopDefectFiled(CORRECT, ledger) === CORRECT);

// A site with only trivial alt gaps must not get a forced fix.
const TINY = A.defectLedger([{ label: 'Home', url: 'https://x.com/', signals: { h1s: ['A'], facts: { imgCount: 6, imgAlt: 5 } } }]);
check('does not force a fix for a trivial 1-image gap',
  !/no alt text/.test(A.ensureTopDefectFiled('PRIORITIZED FIXES\n- [High] Something else.\n\nSTRATEGIC MOVES', TINY)));

/* ------------------------------------------------------------------------------------
   THE TRUNCATION RULE - the auditor's own scissors, reported as the client's defect.

   On the northwind.example run the 3,000-char excerpt cut mid-word:
       ...Key Capabilities Cust|
   and the audit filed a HIGH fix: the product copy "is truncated mid-sentence at 'Key
   Capabilities Custom prom', leaving the primary product offering incomplete and
   conversion-blocking."

   The live page reads "Key Capabilities Custom prompts tuned for your tech stack: Django +
   Postgres?..." - complete and healthy. It would have sent a client hunting for copy that
   was never missing.

   Same root cause as the absence fabrications (the truncated excerpt), new disguise: not
   "X is missing" but "X is broken".
   ------------------------------------------------------------------------------------ */
console.log('\nTHE TRUNCATION RULE  (northwind.example: mistook its own cut for the site\'s defect)');

const LONG = 'Forge is the tool. ' + 'Some real sentence of product copy here. '.repeat(200) + 'Key Capabilities Custom prompts tuned for your tech stack.';
const clipped = A.clipExcerpt(LONG, 3000);
check('never ends the excerpt mid-word', /[\s.!?\]]$/.test(clipped.split('\n')[0]) || /\.$/.test(clipped.split('\n')[0]));
check('labels the cut as the AUDITOR\'s, not the page\'s', /cut was made by the auditor/i.test(clipped));
check('tells the model the page continues past the cut', /page CONTINUES past this point/i.test(clipped));
check('short text is passed through untouched', A.clipExcerpt('Just a short page.', 3000) === 'Just a short page.');

// The exact false finding, verbatim from the report.
const tr1 = '- AI Teams page product copy is truncated mid-sentence ("Key Capabilities Custom prom"), leaving the primary product offering incomplete and conversion-blocking.';
check('drops "product copy is truncated mid-sentence"', dropped(tr1, A.stripTruncationClaims(tr1)));

const tr2 = '- [High] AI Teams page (/ai-teams), product copy section: the Forge description cuts off mid-sentence at "Key Capabilities Custom prom". Current: "text truncates at Key Capabilities Custom prom". Use: "restore the complete copy". Effort: 1 hour.';
check('drops the HIGH fix built on the auditor\'s own cut', dropped(tr2, A.stripTruncationClaims(tr2)));

// A truncated TITLE or META is real - those are passed to the model complete.
const tr3 = '- The About page meta description cuts off mid-sentence at "The whole point", wasting the search snippet.';
check('KEEPS a genuinely truncated meta description (passed complete)', kept(tr3, A.stripTruncationClaims(tr3)));

const tr4 = '- [High] Home page (/), the title tag: the title is truncated and reads as a placeholder. Current: "Home Final - Northwind". Use: "Tech Staffing & Recruiting | Northwind". Effort: 10 min (SEO).';
check('KEEPS a title-tag finding that mentions truncation', kept(tr4, A.stripTruncationClaims(tr4)));

// And ordinary copy critique must survive untouched.
const tr5 = '- The AI Teams product copy is dense and jargon-heavy, which slows a non-technical buyer down.';
check('KEEPS an ordinary copy-quality critique', kept(tr5, A.stripTruncationClaims(tr5)));

/* ------------------------------------------------------------------------------------
   SEEING THE WHOLE PAGE - the cure rather than another antibody.

   Measured against the live site, the old 3,000-char cap meant the audit was reading:
       northwind.example/            24% of the page
       /ai-teams                  36%
       /pricing                   29%
       /recruiting-...            36%
       /about-us                  61%
   It was judging a five-page site having read about a third of it. Every fabrication -
   "no FAQ", "no email form", "200-300 words", "the copy is truncated" - was the model
   reporting on the 70% it was never shown.

   The cap protected a timeout it was never costing: input tokens prefill nearly free, and
   wall-clock is driven by OUTPUT, which max_tokens caps separately. At 18,000 chars every
   page of both test sites arrives COMPLETE.
   ------------------------------------------------------------------------------------ */
console.log('\nSEEING THE WHOLE PAGE  (the old cap showed the model 24% of the home page)');

const PAGE = `<html><body>
<h1>Managed IT for Manufacturers</h1>
<h2>What our clients say</h2><p>Testimonial copy.</p>
<h2>Pricing</h2><p>Plans and packages.</p>
<h3>Is there a setup fee?</h3>
<h2>FAQ</h2><p>Answers live down here, far below any 3000 char prefix.</p>
<p>${'filler word '.repeat(400)}</p>
</body></html>`;

const dComplete = A.buildDigest(PAGE, { wordCount: 900 }, 18000);
check('a normal page now arrives COMPLETE', dComplete.complete === true);
check('the outline lists every heading, in document order',
  dComplete.outline.length === 5 &&
  /H1: Managed IT/.test(dComplete.outline[0]) &&
  /H2: FAQ/.test(dComplete.outline[4]),
  dComplete.outline.join(' / '));
check('COMPLETE coverage tells the model it may reason about absence',
  /COVERAGE: COMPLETE/.test(A.digestBlock(dComplete)) && /ENTIRE page/.test(A.digestBlock(dComplete)));

// A genuinely enormous page still gets cut - and must still say the cut is OURS.
const HUGE = '<html><body><h1>Big</h1><h2>Section Two</h2><p>' + 'sentence of text. '.repeat(3000) + '</p></body></html>';
const dPartial = A.buildDigest(HUGE, { wordCount: 9000 }, 18000);
check('an over-budget page is marked PARTIAL', dPartial.complete === false);
check('PARTIAL coverage still forbids absence claims',
  /COVERAGE: PARTIAL/.test(A.digestBlock(dPartial)) && /never claim something is missing/i.test(A.digestBlock(dPartial)));
check('even when PARTIAL, the outline still reveals the sections further down',
  A.digestBlock(dPartial).indexOf('H2: Section Two') > -1);

// The outline must survive SSR+hydration duplicate blocks (a visitor sees them once).
const SSR = '<html><body><h1>Zhaion</h1><h1>Zhaion</h1><h2>FAQ</h2><h2>FAQ</h2></body></html>';
check('duplicate SSR headings are collapsed in the outline',
  A.buildDigest(SSR, { wordCount: 10 }, 18000).outline.length === 2);

/* ------------------------------------------------------------------------------------
   PHASE 2 - SEEING THE PAGE.

   The audit can now drive a real browser: it measures every element's box, screenshots the
   first screen, and hands the measurements over as FACTS with the picture for judgement.

   The danger this introduces is the project's ORIGINAL SIN. The very first audit confidently
   said streaming links were "buried" below merch, inferred from raw document order. It was
   false. So layout claims are gated on a render having actually happened: measured, or
   silent. Never guessed.
   ------------------------------------------------------------------------------------ */
console.log('\nPHASE 2: GEOMETRY  (measured layout becomes fact; unmeasured layout stays silent)');

const GEO = A.geometryFacts({
  foldY: 900, pageHeight: 5200,
  elements: [
    { kind: 'heading', text: 'The tech talent you need.', x: 40, y: 180, w: 700, h: 60, area: 42000, aboveFold: true },
    { kind: 'button', text: 'Book a call', x: 40, y: 420, w: 180, h: 50, area: 9000, aboveFold: true },
    { kind: 'link', text: 'Pricing', x: 900, y: 40, w: 70, h: 20, area: 1400, aboveFold: true },
    { kind: 'button', text: 'Get the talent brief', x: 40, y: 3100, w: 320, h: 70, area: 22400, aboveFold: false },
    { kind: 'heading', text: 'FAQ', x: 40, y: 4400, w: 200, h: 40, area: 8000, aboveFold: false }
  ]
});
check('measures what a visitor sees before scrolling', GEO.aboveFoldCount === 3);
check('identifies the CTAs above the fold', GEO.ctasAboveFold.join() === 'Book a call');
check('identifies the CTAs a visitor must scroll to reach', GEO.ctasBelowFold.join() === 'Get the talent brief');
check('finds the largest CTA and knows it is below the fold',
  GEO.primaryCta.text === 'Get the talent brief' && GEO.primaryCta.aboveFold === false);
check('reports TRUE visual order, not document order', /above fold.*Book a call/s.test(GEO.visualOrder.join(' ')));
check('the geometry block tells the model it MAY now grade UX', /you MAY grade UX/.test(A.geometryBlock(GEO)));

console.log('\nPHASE 2: THE GATE  (no render, no layout opinions - the original sin)');

check('with NO geometry the model is told it may not discuss layout at all',
  /NOT AVAILABLE/.test(A.geometryBlock(null)) && /MUST grade UX as n\/a/.test(A.geometryBlock(null)));

// The exact false claim from the very first audit in this project.
const sin = '- [High] Home page (/), the link order: streaming links are buried below merch, forcing fans to scroll to reach the most common action.';
check('drops "buried" when the page was never rendered', dropped(sin, A.enforceLayoutClaims(sin, false)));
check('KEEPS "buried" when the page WAS measured', kept(sin, A.enforceLayoutClaims(sin, true)));

const fold = '- The primary CTA sits below the fold, so most visitors never see it without scrolling.';
check('drops an above/below-the-fold claim with no render', dropped(fold, A.enforceLayoutClaims(fold, false)));
check('KEEPS the fold claim once geometry exists', kept(fold, A.enforceLayoutClaims(fold, true)));

const moveUp = '- [High] Home page (/), the pricing CTA: move it up above the fold so it is visible without scrolling.';
check('drops "move it up" advice with no render', dropped(moveUp, A.enforceLayoutClaims(moveUp, false)));
check('KEEPS "move it up" advice once the layout is measured', kept(moveUp, A.enforceLayoutClaims(moveUp, true)));

// Non-layout findings must be untouched by this guard in both directions.
const notLayout = '- [High] Home page (/), the title tag: "Home Final - Northwind" is a placeholder. Current: "Home Final - Northwind". Use: "Tech Staffing | Northwind". Effort: 10 min.';
check('never touches a non-layout finding', kept(notLayout, A.enforceLayoutClaims(notLayout, false)));

// UX must be forced to n/a when we did not look, and left alone when we did.
const scores = 'OVERALL GRADE: B-\nCATEGORY SCORES: Conversion: B | Messaging: B+ | Copy: A- | SEO: C | Trust: B | UX: B-';
check('forces UX to n/a when the page was never rendered', /UX: n\/a/.test(A.forceUxUnassessed(scores, false)));
check('leaves a real UX grade alone once the page was seen', /UX: B-/.test(A.forceUxUnassessed(scores, true)));
check('forcing UX to n/a does not disturb the other grades',
  /Conversion: B \| Messaging: B\+ \| Copy: A- \| SEO: C \| Trust: B/.test(A.forceUxUnassessed(scores, false)));

/* ------------------------------------------------------------------------------------
   GHOST ELEMENTS - counting things no visitor ever gets.

   northwind.example/recruiting-services-in-the-usa, measured in a real browser:
       53 <img> tags in the markup
       27 of them inside <noscript>  (the lazy-load fallback for the no-JS case)
       25 images in the actual DOM, 20 of them with no alt text

   The audit reported "42 of 53 images lack alt text". The defect was real and the PERCENTAGE
   was right (both numbers inflated together), but a content editor sent to fix 42 images would
   hunt for 22 that do not exist. extractText() always stripped <noscript>; the COUNTERS never
   did. Precision that is confidently wrong is the exact failure this codebase exists to stop.
   ------------------------------------------------------------------------------------ */
console.log('\nGHOST ELEMENTS  (<noscript> lazy-load fallbacks are not images a visitor sees)');

const LAZY = `<html><body>
<h1>Recruiting</h1>
<img src="real1.jpg" alt="A described image">
<img src="real2.jpg">
<noscript><img src="real1.jpg" alt="A described image"></noscript>
<noscript><img src="real2.jpg"></noscript>
<noscript><h2>Ghost heading nobody sees</h2></noscript>
<template><img src="never-rendered.jpg"></template>
</body></html>`;

const lsig = A.extractSignals(LAZY, 'https://acme.com');
check('does not count <noscript> images', lsig.imgCount === 2, 'imgCount=' + lsig.imgCount + ' (5 img tags exist in the markup)');
check('counts alt text only on the real images', lsig.imgAlt === 1, 'imgAlt=' + lsig.imgAlt);
check('does not count <template> images', lsig.imgCount !== 3);

const ldigest = A.buildDigest(LAZY, lsig, 18000);
check('the outline excludes headings buried in <noscript>',
  !ldigest.outline.some(h => /Ghost heading/.test(h)), ldigest.outline.join(' / '));

// The defect ledger must file the number a human will actually find on the page.
const lledger = A.defectLedger([
  { label: 'Recruiting', url: 'https://acme.com/recruiting', signals: { h1s: ['a'], facts: { imgCount: lsig.imgCount, imgAlt: lsig.imgAlt } } }
]);
check('the ledger quotes the REAL missing-alt count, not the ghost count', lledger[0].missingAlt === 1);

/* ------------------------------------------------------------------------------------
   THE APOSTROPHE - my parser corrupted the evidence, and the model reported it honestly.

   northwind.example/pricing has this meta description, live and intact:

     "Pricing | Northwind Pricing . What you pay The honest price page. We don't hide fees,
      we don't do surprise markups, and we don't make you negotiate"

   The old reader was  /content\s*=\s*["']([\s\S]*?)["']/  - a character class that accepts
   EITHER quote as the closer. The value opens with a double quote, so it was cut at the first
   APOSTROPHE, and the model was handed:

     "Pricing | Northwind Pricing . What you pay The honest price page. We don"

   The audit then filed "malformed meta description, cut at 'We don'" - and flagged in its own
   appendix that it could not verify this against the live page. It was RIGHT about what it was
   shown. My parser was the liar. Same family as alt="" and the <noscript> ghosts.
   ------------------------------------------------------------------------------------ */
console.log("\nTHE APOSTROPHE  (an attribute value must not be cut at the ' inside it)");

const APOS = `<html><head>
<title>Pricing - Northwind</title>
<meta name="description" content="The honest price page. We don't hide fees, we don't do surprise markups, and we don't make you negotiate.">
<meta property="og:title" content="Northwind's Pricing">
</head><body>
<h1>Pricing</h1>
<img src="a.jpg" alt="The founder's desk at Northwind">
<img src="b.jpg" alt="">
<a href="/what-you'll-pay">What you'll pay</a>
</body></html>`;

const apsig = A.extractSignals(APOS, 'https://northwind.example');
check('reads the FULL meta description past the apostrophe',
  /make you negotiate\.$/.test(apsig.metaDesc), apsig.metaDesc);
check('does not cut the meta at "We don"', !/We don$/.test(apsig.metaDesc.trim()));
check('reads an og:title containing an apostrophe', apsig.ogTitle === "Northwind's Pricing", apsig.ogTitle);
check('counts alt text that contains an apostrophe', apsig.imgAlt === 1, 'imgAlt=' + apsig.imgAlt);

/* ------------------------------------------------------------------------------------
   THE DOM OUTRANKS THE REGEX.

   Every parser bug in this project was a string-matching artifact:
     alt=""              counted as alt text      -> a defect praised as a strength
     <noscript> images   counted as real images   -> "42 of 53" when a visitor sees 26
     an apostrophe       ended an attribute early -> a meta "malformed at We don"

   None could happen if we simply ASK THE PAGE. When a browser is open, its DOM is the truth.
   ------------------------------------------------------------------------------------ */
console.log('\nDOM TRUTH  (when a browser is open, stop parsing strings and ask the page)');

const regexSig = {
  imgCount: 53, imgAlt: 11, wordCount: 800,          // what the string parser thought
  title: 'Cut at the apo', metaDesc: 'We don',
  h1s: ['Tech Talent'], h2s: ['a'], h2count: 1,
  hasCanonical: false, hasJsonLd: false,
  facts: { imgCount: 53, imgAlt: 11, wordCount: 800, hasEmailCapture: false, emailInput: false, formCount: 0, hasCanonical: false, hasJsonLd: false }
};
const domFacts = {                                    // what the real browser sees
  imgCount: 26, imgAlt: 5, wordCount: 2410,
  title: 'Pricing - Northwind',
  metaDesc: "The honest price page. We don't hide fees, we don't do surprise markups.",
  h1s: ['Tech Talent', 'The honest price page.'], h2s: ['x', 'y'],
  hasEmailInput: true, formCount: 1, hasCanonical: true, hasJsonLd: true,
  buttons: ['Schedule kickoff call']
};
const truth = A.applyDomTruth(JSON.parse(JSON.stringify(regexSig)), domFacts);
check('image count comes from the DOM, not the regex', truth.imgCount === 26 && truth.imgAlt === 5);
check('the FACTS block is corrected too', truth.facts.imgCount === 26 && truth.facts.imgAlt === 5);
check('the apostrophe-mangled meta is replaced by the real one', /make you|surprise markups\.$/.test(truth.metaDesc));
check('word count comes from the DOM', truth.wordCount === 2410 && truth.facts.wordCount === 2410);
check('an email form the regex missed is now found', truth.facts.hasEmailCapture === true);
check('canonical and JSON-LD are re-read from the DOM', truth.hasCanonical === true && truth.hasJsonLd === true);
check('both H1s are captured from the DOM', truth.h1s.length === 2);
check('without a render, the regex values are left untouched',
  A.applyDomTruth(JSON.parse(JSON.stringify(regexSig)), null).imgCount === 53);

/* ------------------------------------------------------------------------------------
   COMPUTED NUMBERS. The 3:23 report wrote "establishes 27 years of credibility" for a firm
   founded in 1997, in 2026. It is 29, and the page says 29. It did arithmetic instead of
   reading. A wrong number in a client deliverable is the quietest damage this tool can do.
   ------------------------------------------------------------------------------------ */
console.log('\nCOMPUTED NUMBERS  (quote a figure, never calculate one)');

const CORPUS = 'Founded in 1997. A 29-year track record. 400+ consultants placed.';
const n1 = '- Replacing the title establishes 27 years of credibility in the title itself, a direct E-E-A-T signal.';
check('drops "27 years" (computed; the page says 29)', dropped(n1, A.stripDerivedNumbers(n1, CORPUS)));

const n2 = '- The 29-year track record is the strongest trust asset on the page and should lead the About title.';
check('KEEPS "29 years" (it is on the page)', kept(n2, A.stripDerivedNumbers(n2, CORPUS)));

const n3 = '- [High] Home page (/), the title tag: a placeholder. Current: "Home Final - Northwind". Use: "Tech Staffing | Northwind | Since 1997". Effort: 10 min.';
check('never touches a bullet with no year-claim in it', kept(n3, A.stripDerivedNumbers(n3, CORPUS)));

/* ------------------------------------------------------------------------------------
   KEYWORD SALAD. The 3:41 report filed a MEDIUM to replace this home meta:

     "Every leader we talk to is fighting the same fight: roles that won't close, roadmaps
      that stall, and agencies that flood inboxes with the wrong people."

   with a pipe-delimited keyword string. That is a TITLE TAG, not a meta description: a meta
   is prose that earns a click. An earlier run had correctly praised that exact meta as "the
   strongest pain-point statement on the site". The prompt already banned filing a title/meta
   fix "merely to re-order, tighten, or front-load it" - and the model went round it. Enforce.
   ------------------------------------------------------------------------------------ */
console.log('\nKEYWORD SALAD  (do not replace good human copy with a pipe-delimited title)');

const salad = '- [Medium] Home page (/), the meta description: does not lead with the primary value prop or include a keyword; reorder to front-load "Tech Talent Staffing". Current: "Every leader we talk to is fighting the same fight: roles that won\'t close, roadmaps that stall, and agencies that flood inboxes with the wrong people.". Use: "Tech Talent Staffing & Recruiting | Permanent Placement, Contract Staffing, Executive Search & AI Teams | Northwind". Effort: 5 min (SEO).';
check('drops a meta fix whose replacement is a pipe-delimited title', dropped(salad, A.enforceMetaCraft(salad)));

const frontload = '- [Medium] About page (/about-us), the meta description: front-load the primary keyword for higher CTR. Current: "Northwind was founded in 1997 with one simple thesis: large firms had stopped caring, and the boutiques that did care lacked global reach.". Use: "Boutique tech recruiting with global reach, founder-led since 1997.". Effort: 10 min.';
check('drops a "front-load the keyword" fix on copy that is already real prose', dropped(frontload, A.enforceMetaCraft(frontload)));

// A genuine defect must still be fixable.
const placeholder = '- [Critical] Home page (/), the title tag: a placeholder artifact wastes the most valuable SEO slot on the site. Current: "Home Final - Northwind". Use: "Tech Staffing & Recruiting | Northwind". Effort: 10 min (SEO).';
check('KEEPS the placeholder title fix (a real defect)', kept(placeholder, A.enforceMetaCraft(placeholder)));

const truncated = '- [High] About page (/about-us), the meta description: it is truncated mid-sentence and ends on "The whole point". Current: "Northwind was founded in 1997 with one simple thesis... The whole point". Use: "Boutique tech recruiting with the reach of a large firm. Founder-led since 1997.". Effort: 10 min.';
check('KEEPS a genuinely truncated meta fix', kept(truncated, A.enforceMetaCraft(truncated)));

// A title tag legitimately IS pipe-delimited; only metas must be prose.
const goodTitle = '- [High] Pricing page (/pricing), the title tag: generic and misses the differentiator. Current: "Pricing - Northwind". Use: "Transparent Tech Staffing Pricing | No Hidden Fees | Northwind". Effort: 10 min.';
check('KEEPS a pipe-delimited TITLE fix (pipes are correct in a title)', kept(goodTitle, A.enforceMetaCraft(goodTitle)));

const notMeta = '- [High] Recruiting page (/recruiting-services-in-the-usa), image alt text: 20 of 25 images lack alt text. Current: "(20 images with no alt attribute)". Use: "describe each image". Effort: 1 hour.';
check('never touches a non-title/meta fix', kept(notMeta, A.enforceMetaCraft(notMeta)));

/* ------------------------------------------------------------------------------------
   NEVER LET THE SCAFFOLDING SHOW. The 4:04 report told the client their pages "carry zero
   social proof ... despite OBSERVED FACTS confirming their absence". OBSERVED FACTS is the
   name of an internal prompt block: my plumbing, in a document a client reads.
   ------------------------------------------------------------------------------------ */
console.log('\nSCAFFOLDING  (internal prompt vocabulary must never reach the client)');

const leak1 = '- Recruiting and AI Teams pages carry zero social proof (testimonials, case studies), despite OBSERVED FACTS confirming their absence. This is a critical conversion leak.';
const sc1 = A.stripScaffolding(leak1);
check('removes "despite OBSERVED FACTS confirming their absence"', !/OBSERVED FACTS/i.test(sc1));
check('and the sentence still reads properly', /zero social proof \(testimonials, case studies\)\. This is a critical conversion leak\./.test(sc1), sc1);

const leak2 = '- The RENDERED LAYOUT shows the CTA sits below the fold, per the PAGE OUTLINE.';
check('removes RENDERED LAYOUT and PAGE OUTLINE', !/RENDERED LAYOUT|PAGE OUTLINE/i.test(A.stripScaffolding(leak2)));

const clean = '- [Critical] Home page (/), the title tag: a placeholder wastes the best SEO slot. Current: "Home Final - Northwind". Use: "Tech Staffing | Northwind". Effort: 10 min.';
check('never touches a clean fix', A.stripScaffolding(clean) === clean);

console.log('\nSITE-LEVEL MERGE  (a fact on ANY audited page is a fact for the site)');
const merged = A.mergeFacts([
  { signals: { facts: { hasPricing: false, hasBlog: false, wordCount: 300, hasTestimonials: false } } },
  { signals: { facts: { hasPricing: true,  hasBlog: false, wordCount: 1900, hasTestimonials: false } } }
]);
check('ORs booleans across pages (pricing found on page 2)', merged.hasPricing === true);
check('MAXes numbers across pages (word count)', merged.wordCount === 1900);
check('keeps a fact false when no page has it', merged.hasTestimonials === false);

console.log('\nSHELL DETECTION  (only a true empty SPA should trigger the render proxy)');
check('a server-rendered page is NOT a shell', A.isShell(HTML) === false);
check('an empty SPA shell IS a shell', A.isShell('<html><body><div id="root"></div><script src="/app.js"></script></body></html>') === true);

/* ------------------------------------------------------------------
   PAGE DISCOVERY RANKING

   A live basecamp.com audit spent two of its five page slots on chapters of
   Basecamp's 2006 book "Getting Real" (/gettingreal/01.2-about-basecamp), because
   indexOf('about') matched inside the chapter slug and handed it the full
   about-page bonus. It outranked /features and /how-it-works.

   The keyword table was also still one client's — 'ai-team' at 55 and a bonus for
   staffing/recruit/placement/offshore — which ranked one company's navigation on
   every site the tool audited.
------------------------------------------------------------------ */
console.log('\nPAGE DISCOVERY RANKING  (which five pages a marketing audit should grade)');
const sp = (p, l) => A.scorePath('https://example.com' + p, l || '');

check('pricing outranks everything', sp('/pricing') > sp('/about') && sp('/about') > sp('/features'));
check('a numbered book chapter loses to a real nav page',
  sp('/gettingreal/01.2-about-basecamp') < sp('/features'),
  `chapter ${sp('/gettingreal/01.2-about-basecamp')} vs features ${sp('/features')}`);
check('"about" inside a slug does not earn the about-page bonus',
  sp('/gettingreal/11.1-theres-nothing-functional-about-afunctional-spec') < 0);
check('article silos are deprioritised',
  sp('/blog/a-post') < 0 && sp('/docs/setup') < 0 && sp('/help/faq') < 0);
check('a genuine /about page still scores well', sp('/about') >= 45);
check('shallow pages beat deep ones', sp('/services') > sp('/solutions/x/services'));

// The table must not privilege one industry's navigation.
const neutral = ['/pricing', '/features', '/product', '/services', '/platform', '/about'];
check('every generic commercial page scores positively',
  neutral.every(p => sp(p) > 0), JSON.stringify(neutral.map(p => [p, sp(p)])));
check('no staffing-specific bonus survives',
  sp('/recruiting') === sp('/somethingelse') && sp('/ai-teams') === sp('/xy-teams'),
  `recruiting=${sp('/recruiting')} other=${sp('/somethingelse')} ai-teams=${sp('/ai-teams')} xy-teams=${sp('/xy-teams')}`);

/* ------------------------------------------------------------ return shapes */
/* fetchPage returns the HTML as a STRING. renderPage returns an OBJECT with an .html
   property. Brand onboarding mixed the two: it read `.html` off fetchPage's string, which
   is undefined, so the direct-fetch fallback silently produced nothing and onboarding
   depended entirely on the renderer succeeding. When a site refused the headless browser,
   the one path that could still have read it never ran and the screen blamed the site.
   Nothing threw and nothing logged, which is why this is asserted against the source. */
console.log('\nTHE TWO FETCHERS RETURN DIFFERENT SHAPES, AND CALLERS MUST KNOW WHICH');
const srcPath = require('path').join(__dirname, '..', 'netlify', 'functions', 'audit.js');
const src = require('fs').readFileSync(srcPath, 'utf8');

const fpDef = src.slice(src.indexOf('async function fetchPage'));
check('fetchPage still returns a bare string, not an object',
  /return html;/.test(fpDef.slice(0, 400)) && !/return \{\s*html/.test(fpDef.slice(0, 400)));

const callSites = [];
let i = -1;
while ((i = src.indexOf('fetchPage(', i + 1)) !== -1) {
  if (/async function $/.test(src.slice(Math.max(0, i - 16), i))) continue;   // the definition
  callSites.push(src.slice(i, i + 200));
}
check('every fetchPage call site was found (' + callSites.length + ')', callSites.length >= 4);
const derefs = callSites.filter(s => /\.html\b/.test(s));
check('no caller reads .html off what fetchPage returned',
  derefs.length === 0, derefs.join('\n---\n'));

/* Bounded to the function, not to a character count: renderPage's body carries the whole
   injected browser script, so a fixed window stopped short of its return. */
const rpStart = src.indexOf('async function renderPage');
const rpNext = src.indexOf('\nasync function ', rpStart + 10);
const rpDef = src.slice(rpStart, rpNext === -1 ? src.length : rpNext);
check('renderPage still returns an object carrying html, so r.html stays correct',
  /return \{ html:/.test(rpDef));
check('and brand onboarding reads each of them the right way round',
  /if \(r && r\.html\) html = r\.html;/.test(src) && /typeof f === 'string'/.test(src));

console.log('\n' + '-'.repeat(62));
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nREGRESSION: a false claim the audit already shipped once can ship again.\n'); process.exit(1); }
console.log('\nAll known false claims are blocked. Real findings survive.\n');
