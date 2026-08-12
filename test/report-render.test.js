/**
 * END-TO-END REPORT RENDER TEST.
 *
 * This exists because I shipped a report that had no Print button and looked broken, and I
 * found out from Edmund instead of from a test. The unit tests all passed: they tested the
 * guards, not the thing the client actually holds.
 *
 * So this loads the REAL index.html in a real DOM, feeds it a REAL synthesis body (already put
 * through the server guards), renders it, and asserts on what a human ends up looking at:
 *
 *    - the report parses into its sections (not the raw-text fallback)
 *    - the "Print / Save as PDF" button EXISTS          <- the bug that shipped
 *    - the fixes render as fix cards
 *    - a title fix shows the SERP before/after preview
 *    - an on-page fix shows a cropped screenshot of the element
 *    - no internal scaffolding vocabulary reaches the page
 *
 * Run:  node test/report-render.test.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const A = require('../netlify/functions/audit.js').__internals;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}

/* A realistic synthesis body: exactly the shape the model emits, including the scaffolding
   leak that shipped at 4:04, so the guard is exercised on the real thing. */
const RAW_BODY = [
  'OVERVIEW',
  'Northwind is a tech staffing firm on WordPress. Strong messaging, weak technical SEO.',
  'OVERALL GRADE: B',
  'CATEGORY SCORES: Conversion: B- | Messaging: B | Copy: B | SEO: B- | Trust: B | UX: B',
  '',
  'WHAT IS WORKING',
  '- Strong differentiator: "the same person who answers your call closes the hire".',
  '- Transparent pricing positioning on the Pricing page.',
  '',
  'WHAT IS COSTING YOU LEADS',
  '- Recruiting and AI Teams carry zero social proof, despite OBSERVED FACTS confirming their absence. This is a conversion leak.',
  '- Every page carries two H1 tags, splitting semantic weight.',
  '',
  'PRIORITIZED FIXES',
  '- [Critical] Home page (/), title tag: a placeholder wastes the best SEO slot on the site. Current: "Home Final - Northwind". Use: "Tech Staffing & Recruiting | Northwind". Effort: 10 min (SEO specialist).',
  '- [High] Home page (/), H1 structure: two H1 tags dilute the primary keyword signal. Current: "The tech talent you need. Right now.". Use: "Keep this as the sole H1 and demote Tech Talent to a span". Effort: 20 min (developer).',
  '- [Critical] Recruiting page (/recruiting-services-in-the-usa), image alt text: 20 of 25 images lack alt text. Current: "(20 images with no alt attribute)". Use: "Add descriptive alt text to all 20 images". Effort: 45 min (content editor).',
  '',
  'STRATEGIC MOVES',
  '- Standardize the H1 structure across all five pages via the WordPress template.',
  '',
  'WHERE AI CREATES LEVERAGE',
  '- Continuous title and alt-text auditing would catch these before they ship.',
  '',
  'NOT VERIFIED IN THIS AUDIT',
  '- Mobile and smaller viewports were not measured; the render is desktop 1280x900 only.'
].join('\n');

/* Put it through the real server guards, exactly as production does. */
const BODY = A.applyGuards(RAW_BODY, { kind: 'cms', name: 'WordPress' }, { imgCount: 25, imgAlt: 5, wordCount: 2400 }, true, RAW_BODY);

console.log('\nTHE GUARDS MUST NOT DESTROY THE REPORT  (the bug that shipped)');
check('the section headers survive on their own lines', /\nPRIORITIZED FIXES\n/.test('\n' + BODY + '\n'), JSON.stringify(BODY.slice(0, 120)));
check('the report is still multi-line (not flattened)', BODY.split('\n').length > 15, BODY.split('\n').length + ' lines');
check('the blank lines between sections survive', /\n\nPRIORITIZED FIXES/.test(BODY));
check('the scaffolding leak is gone', !/OBSERVED FACTS/i.test(BODY));
check('but that sentence still reads', /zero social proof\. This is a conversion leak\./.test(BODY), BODY.split('\n').find(l => /social proof/.test(l)));

/* ---- Now render it through the REAL index.html ---- */
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://grayrender.local/' });
const win = dom.window;

// A fake full-page screenshot with the H1 at a known box, so the crop can be asserted.
const PNG1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const RESULTS = [{
  url: 'https://northwind.example/', label: 'Home', grade: 'B', scores: '', summary: 'x',
  signals: { title: 'Home Final - Northwind', metaDesc: 'Every leader we talk to is fighting the same fight.' },
  shotFull: PNG1x1, pageW: 1280, pageH: 1800,
  geo: { elementsRaw: [
    { kind: 'heading', text: 'The tech talent you need. Right now.', x: 40, y: 300, w: 260, h: 60 },
    { kind: 'button',  text: 'Find Your Next Hire',                 x: 40, y: 520, w: 200, h: 50 }
  ] }
}];

console.log('\nTHE RENDERED REPORT  (what a human actually ends up holding)');
let err = '';
try {
  win.registerShots(RESULTS);
  win.renderAudit(BODY, { url: 'https://northwind.example', platform: { kind: 'cms', name: 'WordPress' } }, 'Northwind', BODY, []);
} catch (e) { err = e.message; }
check('renderAudit does not throw', !err, err);

const out = win.document.getElementById('outArea');
const doc = out ? out.innerHTML : '';

check('the report parsed into sections (NOT the raw-text fallback)', /aud-sec|aud-h/.test(doc) && !/^<div class="output-wrap"><div class="card"><div class="email-card">/.test(doc.trim()));
check('the PRINT / SAVE AS PDF BUTTON EXISTS', !!win.document.getElementById('btnPrint'));
check('the fixes rendered as fix cards', (doc.match(/class="fx-li"/g) || []).length >= 3, (doc.match(/class="fx-li"/g) || []).length + ' fix cards');
check('the overall grade rendered', /grade-badge/.test(doc));
check('the scorecard rendered', /sc-item|sc-grade/.test(doc));

console.log('\nTHE VISUAL EVIDENCE');
check('the title fix shows a SERP before/after preview', /fx-serp/.test(doc) && /How Google shows it now/.test(doc));
check('the SERP shows the current title', /Home Final - Northwind/.test(doc));
check('the SERP shows the proposed title', /Tech Staffing &amp; Recruiting \| Northwind/.test(doc) || /Tech Staffing & Recruiting \| Northwind/.test(doc));
check('an on-page fix shows a cropped screenshot', /fx-shot/.test(doc) && /fx-img/.test(doc));
check('the crop is an <img> (prints to PDF), not a CSS background', /<img[^>]+class="fx-img"/.test(doc) && !/background-image/.test(doc));
check('no internal scaffolding reached the page', !/OBSERVED FACTS|RENDERED LAYOUT|PAGE OUTLINE/i.test(doc));

console.log('\nTHE PRINT PATH  (the PDF is the deliverable)');
let perr = '';
try { win.printAuditReport(); } catch (e) { perr = e.message; }
check('printAuditReport does not throw', !perr, perr);
const mount = win.document.getElementById('printMount');
const pdoc = mount ? mount.innerHTML : '';
check('the print document was built', !!pdoc && pdoc.length > 500, (pdoc || '').length + ' chars');
check('the print document contains the fixes', (pdoc.match(/class="fx-li"/g) || []).length >= 3);
check('the print document contains the SERP preview', /fx-serp/.test(pdoc));
check('the print document contains the cropped screenshot', /fx-img/.test(pdoc));
check('the print document has no scaffolding', !/OBSERVED FACTS/i.test(pdoc));

/* ------------------------------------------------------------------
   PLATFORM HONESTY  (both failures observed in a real zhaion.com run)

   1. Alt text filed as a HIGH prioritised fix on Hopp, where per-image alt text does not
      exist in the editor at all. An impossible task, ranked above real ones.
   2. That same fix costed as "60 to 90 min (content editor, in the WordPress media
      library)" on a page that is not WordPress and has no media library.

   Both were already forbidden in the prompt. Both shipped anyway. Hence code guards.
------------------------------------------------------------------ */
console.log('\nPLATFORM HONESTY  (a fix the owner physically cannot perform is not a fix)');
const BIO = { kind: 'link-in-bio', name: 'Hopp' };
const fx = (line, plat) => win.fixBullets(line, plat);

const altFix = '- [High] Home page (/), the images throughout the page: 41 of 41 images carry no alt text. Current: "41 of 41 images have no alt text". Use: "describe each image in plain language". Effort: 60 to 90 min (content editor, in the WordPress media library).';
check('DROPS an alt-text fix on a locked link-in-bio', !/fx-li/.test(fx(altFix, BIO)));
check('KEEPS the same alt-text fix on a real CMS the owner controls',
  /fx-li/.test(fx(altFix, { kind: 'cms', name: 'WordPress' })));

const canonFix = '- [Medium] Home page (/), head: no canonical tag. Current: "(none, new element)". Use: "<link rel=canonical>". Effort: 15 min (developer).';
check('DROPS a canonical fix on a link-in-bio', !/fx-li/.test(fx(canonFix, BIO)));
const schemaFix = '- [Medium] Home page (/), head: no JSON-LD schema markup. Current: "(none, new element)". Use: "Artist schema". Effort: 2 hours (developer).';
check('DROPS a JSON-LD fix on a link-in-bio', !/fx-li/.test(fx(schemaFix, BIO)));

const bioMetaFix = '- [High] Home page (/), meta description: it truncates before the album date. Current: "NO CLEARANCE album drops 9.18.26, Detroit AI-hybrid R&B artist". Use: "NO CLEARANCE album 9.18.26, Detroit AI-hybrid R&B, #5 iTunes". Effort: 10 min (owner, in the WordPress editor).';
const bioMetaOut = fx(bioMetaFix, BIO);
check('KEEPS a real, editable meta fix on a link-in-bio', /fx-li/.test(bioMetaOut));
check('and rewrites the wrong platform in its Effort line', /Hopp/.test(bioMetaOut) && !/WordPress/i.test(bioMetaOut),
  (bioMetaOut.match(/Effort:[^<]*/) || [''])[0]);

const wpFix = '- [High] Home page (/), title tag: a placeholder wastes the best SEO slot. Current: "Home Final - Northwind". Use: "Managed IT for Manufacturers | Northwind". Effort: 10 min (SEO specialist, in the WordPress SEO plugin).';
check('LEAVES the Effort alone when the platform named is the real one',
  /WordPress/.test(fx(wpFix, { kind: 'cms', name: 'WordPress' })));

/* ------------------------------------------------------------------
   THE CALENDAR CONTRACT, as the live model actually honours it.

   Asked for "- Monday | LinkedIn | ...", Haiku returned "Monday | LinkedIn | ..."
   on every row of a real run. The parser required the bullet, matched nothing, and
   the flagship calendar silently degraded to prose. Seven pipe-separated fields is
   what identifies a row; the bullet is decoration.
------------------------------------------------------------------ */
console.log('\nCALENDAR PARSING  (real model output, not the shape we asked for)');
const LIVE_CAL = [
  'WEEK 1', '',
  "Monday | LinkedIn | Text post | Most teams waste 3 hours a week. | You're not disorganized—your tools are. | See how | Screenshot",
  'Wednesday | Instagram | Reel | Three taps. | Quick walkthrough. | Watch it | 30s capture',
  'Day | Channel | Format | Hook | Caption | CTA | Asset',
  '- Friday | YouTube | Short | The problem nobody measures. | A short. | Subscribe | Vertical video',
  'WEEK 2',
  'Tuesday | LinkedIn | Poll | What eats your week? | Four options. | Vote | Poll copy',
  'Broken | row | with | too | few',
  'POSTING NOTES', '- Post 8-10am Tuesday to Thursday.', '- Boost the poll.'
].join('\n');
const parsedCal = win.parseCalendar(LIVE_CAL);
const calRows = parsedCal.weeks.flatMap(w => w.rows);
check('rows without a leading bullet still parse', calRows.some(r => r.day === 'Monday'));
check('rows with a bullet still parse', calRows.some(r => r.day === 'Friday'));
check('a repeated header row is not treated as a post', !calRows.some(r => /^day$/i.test(r.day)));
check('a malformed row is dropped, not half-rendered', !calRows.some(r => r.day === 'Broken'));
check('both weeks captured', parsedCal.weeks.length === 2, parsedCal.weeks.length + ' weeks');
check('all posting notes captured', parsedCal.notes.split('\n').length === 2, JSON.stringify(parsedCal.notes));
const csvOut = win.calendarCsv(calRows.map(r => Object.assign({ week: 'WEEK 1' }, r)));
check('the CSV export carries no em dashes', !/[—–]/.test(csvOut),
  (csvOut.match(/.{0,30}[—–].{0,30}/) || [''])[0]);
check('the CSV has one line per real row', csvOut.split('\r\n').length === calRows.length + 1);

/* ------------------------------------------------------------------
   IMPACT TETHERING  (observed on a real zhaion.com run)

   "Why These Changes Matter" credited "a clearer H1 and tagline" and "the
   reordered title" when neither fix had been filed — only a button move, a meta
   edit and alt text were. The prompt already scopes the section to the fix list;
   prompts leak, so the code drops bullets whose element references are all absent.
------------------------------------------------------------------ */
console.log('\nIMPACT TETHERING  (the section may only credit fixes that were filed)');
const FILED = [
  'PRIORITIZED FIXES',
  '- [High] Home page (/), the early access button: buried. Current: "y=900". Use: "move up". Effort: 5 min (owner).',
  '- [High] Home page (/), meta description: front-load the date. Current: "old meta". Use: "new meta". Effort: 10 min (owner).',
].join('\n');
const IMPACT = [
  'WHY THESE CHANGES MATTER',
  '- Moving the early access button above the fold lifts signup rate.',
  '- A clearer H1 and tagline reduce bounce.',
  '- The reordered title improves click-through from search.',
  '- Tightening the meta description front-loads the date in the snippet.',
  '- Together these compound into faster routing and higher conversion velocity.',
].join('\n');
const tethered = win.tetherImpact(IMPACT, FILED);
check('keeps a bullet about a filed fix (the button)', /early access button/.test(tethered));
check('keeps a bullet about a filed fix (the meta)', /meta description/.test(tethered));
check('DROPS the unfiled H1 claim', !/clearer H1/.test(tethered), tethered);
check('DROPS the unfiled title claim', !/reordered title/.test(tethered), tethered);
check('keeps the element-free compounding bullet', /compound/.test(tethered));
check('keeps the section header', /^WHY THESE CHANGES MATTER/m.test(tethered));
check('fixesSectionOf stops at the next header',
  !/WHY THESE/.test(win.fixesSectionOf(FILED + '\n\nWHY THESE CHANGES MATTER\n- x')));

/* ---------------------------------------------------------------------------
   THE PASSCODE MUST RIDE ON EVERY AUDIT REQUEST.

   This shipped broken. Brand setup is the first screen a visitor touches, and it
   was the one postAudit caller that never put the passcode in the body, so the
   server 403'd every website anyone pasted and the screen said "I could not read
   that site from here" -- blaming the website for a lock failure. The backend was
   healthy the whole time, which is exactly why curl testing never caught it.

   fetch is called synchronously inside postAudit before the first await, so the
   body is captured the moment we invoke it, no awaiting needed.
--------------------------------------------------------------------------- */
console.log('\nTHE PASSCODE ON EVERY REQUEST  (brand setup forgot it and onboarding died)');
let sent = null;
win.fetch = function (url, opts) {
  sent = JSON.parse(opts.body);
  return Promise.resolve({ json: () => Promise.resolve({}) });
};
win.localStorage.setItem('gr_pass', 'OPEN-SESAME-TEST-ONLY');

win.postAudit({ mode: 'brand', url: 'https://northwind.example' });
check('brand setup sends the passcode', sent && sent.passcode === 'OPEN-SESAME-TEST-ONLY', JSON.stringify(sent));
check('brand setup still sends its own fields', sent && sent.mode === 'brand' && /northwind/.test(sent.url));

win.postAudit({ mode: 'scan', url: 'https://northwind.example/pricing' });
check('a scan sends the passcode', sent && sent.passcode === 'OPEN-SESAME-TEST-ONLY');

/* The unlock screen posts a CANDIDATE passcode to test it. That must win over the
   stored one, or you could never enter a corrected code after a bad one. */
win.postAudit({ mode: 'brand', validateOnly: true, passcode: 'A-DIFFERENT-CANDIDATE' });
check('an explicit passcode overrides the stored one', sent && sent.passcode === 'A-DIFFERENT-CANDIDATE', JSON.stringify(sent));

/* And with nothing stored it must not invent one. */
win.localStorage.removeItem('gr_pass');
win.postAudit({ mode: 'discover', url: 'https://northwind.example' });
check('a locked visitor sends an empty passcode, not undefined', sent && sent.passcode === '', JSON.stringify(sent));

/* ---------------------------------------------------------------------------
   THE REPORT ARRIVES IN TWO PIECES AND MUST READ AS ONE.

   The synthesis was one call writing every section, measured at 28 to 30 seconds
   against a function ceiling in the same range, so it 504'd intermittently. It is
   now two parallel calls, and stitchReport puts the fix list back between WHAT IS
   COSTING YOU LEADS and STRATEGIC MOVES. Everything downstream reads the finished
   body, so if the seam is wrong the whole report is wrong.
--------------------------------------------------------------------------- */
console.log('\nSTITCHING THE TWO HALVES  (the fix list is written by its own call)');
const MAIN_HALF = [
  'OVERVIEW',
  'Northwind is a tech staffing firm on WordPress.',
  'OVERALL GRADE: B',
  'CATEGORY SCORES: Conversion: B- | Messaging: B | Copy: B | SEO: B- | Trust: B | UX: B',
  '',
  'WHAT IS WORKING',
  '- Transparent pricing positioning on the Pricing page.',
  '',
  'WHAT IS COSTING YOU LEADS',
  '- Every page carries two H1 tags.',
  '',
  'NOT VERIFIED IN THIS AUDIT',
  '- Mobile viewports were not measured.'
].join('\n');
const FIX_HALF = [
  'PRIORITIZED FIXES',
  '- [Critical] Home page (/), title tag: a placeholder wastes the best SEO slot. Current: "Home Final - Northwind". Use: "Tech Staffing & Recruiting | Northwind". Effort: 10 min (SEO specialist).',
  '',
  'STRATEGIC MOVES',
  '- Standardize the H1 structure across all five pages.',
  '',
  'WHERE AI CREATES LEVERAGE',
  '- Continuous auditing would catch these before they ship.'
].join('\n');

const stitched = win.stitchReport(MAIN_HALF, FIX_HALF);
const order = ['OVERVIEW', 'WHAT IS WORKING', 'WHAT IS COSTING YOU LEADS', 'PRIORITIZED FIXES',
               'STRATEGIC MOVES', 'WHERE AI CREATES LEVERAGE', 'NOT VERIFIED IN THIS AUDIT']
  .map(h => stitched.indexOf('\n' + h) === -1 ? stitched.indexOf(h) : stitched.indexOf('\n' + h));

check('every section survives the stitch', order.every(i => i >= 0), JSON.stringify(order));
check('sections land in report order', order.every((v, i) => i === 0 || v > order[i - 1]), JSON.stringify(order));
check('the fix list sits before the honesty appendix',
  stitched.indexOf('PRIORITIZED FIXES') < stitched.indexOf('NOT VERIFIED IN THIS AUDIT'));
check('the fix list sits after WHAT IS COSTING YOU LEADS',
  stitched.indexOf('PRIORITIZED FIXES') > stitched.indexOf('WHAT IS COSTING YOU LEADS'));
check('the moved sections ride with the fixes, still in order',
  stitched.indexOf('STRATEGIC MOVES') > stitched.indexOf('PRIORITIZED FIXES')
  && stitched.indexOf('WHERE AI CREATES LEVERAGE') > stitched.indexOf('STRATEGIC MOVES')
  && stitched.indexOf('WHERE AI CREATES LEVERAGE') < stitched.indexOf('NOT VERIFIED IN THIS AUDIT'));
check('the fix survives intact', /Home Final - Northwind/.test(stitched) && /Effort: 10 min/.test(stitched));
check('nothing is duplicated', stitched.split('STRATEGIC MOVES').length - 1 === 1
  && stitched.split('OVERVIEW').length - 1 === 1);

/* The fix pass can fail on its own. Half a report beats none. */
const noFixes = win.stitchReport(MAIN_HALF, '');
check('a failed fix pass still returns a readable report', noFixes === MAIN_HALF);
check('a failed fix pass files no empty fix header', !/PRIORITIZED FIXES/.test(noFixes));

/* A main half that somehow lacks STRATEGIC MOVES must not silently lose the fixes. */
const odd = win.stitchReport('OVERVIEW\nJust the overview.', FIX_HALF);
check('fixes are appended when the anchor is missing', /PRIORITIZED FIXES/.test(odd) && /Home Final/.test(odd));

/* The stitched body must still feed the downstream steps that read it. */
check('fixesSectionOf still finds the fix list after stitching',
  /Home Final - Northwind/.test(win.fixesSectionOf(stitched)));
check('the honesty appendix is still last',
  stitched.lastIndexOf('NOT VERIFIED IN THIS AUDIT') > stitched.lastIndexOf('WHERE AI CREATES LEVERAGE'));

/* ---------------------------------------------------------------------------
   EACH HALF STAYS IN ITS OWN LANE.

   Told to write everything EXCEPT the fix list, the model wrote a PRIORITIZED
   FIXES section anyway on one live run in three. Stitched, that renders two fix
   lists in one report. The shared rules name PRIORITIZED FIXES repeatedly, so the
   temptation never goes away and the prompt cannot be trusted to hold it.
   keepSections is the code that does.
--------------------------------------------------------------------------- */
console.log('\nEACH HALF STAYS IN ITS LANE  (the main pass wrote a fix list anyway)');
const LEAKY_MAIN = [
  'OVERVIEW',
  'Northwind is a tech staffing firm.',
  'OVERALL GRADE: B',
  '',
  'WHAT IS WORKING',
  '- Transparent pricing.',
  '',
  'WHAT IS COSTING YOU LEADS',
  '- Two H1 tags on every page.',
  '',
  'PRIORITIZED FIXES',
  '- [Critical] Home page (/), title tag: leaked from the other half. Current: "x". Use: "y". Effort: 10 min (SEO specialist).',
  '',
  'STRATEGIC MOVES',
  '- Also leaked.',
  '',
  'WHERE AI CREATES LEVERAGE',
  '- Continuous auditing catches these.',
  '',
  'NOT VERIFIED IN THIS AUDIT',
  '- Mobile viewports were not measured.'
].join('\n');

const cleanedMain = A.keepSections(LEAKY_MAIN, A.MAIN_SECTIONS);
check('the leaked fix list is dropped from the main half', !/PRIORITIZED FIXES/.test(cleanedMain), cleanedMain);
check('the leaked strategic moves are dropped too', !/STRATEGIC MOVES/.test(cleanedMain));
check('the leaked AI leverage section is dropped too', !/WHERE AI CREATES LEVERAGE/.test(cleanedMain));
check('the main half keeps everything it owns',
  ['OVERVIEW', 'WHAT IS WORKING', 'WHAT IS COSTING YOU LEADS', 'NOT VERIFIED IN THIS AUDIT']
    .every(s => cleanedMain.includes(s)), cleanedMain);
check('the grade line survives the cut', /OVERALL GRADE: B/.test(cleanedMain));
check('the main half still ends at the honesty appendix',
  cleanedMain.trim().endsWith('- Mobile viewports were not measured.'));

const cleanedFix = A.keepSections(LEAKY_MAIN, A.FIX_SECTIONS);
check('the fix half keeps only its three sections',
  /PRIORITIZED FIXES/.test(cleanedFix) && /STRATEGIC MOVES/.test(cleanedFix)
  && /WHERE AI CREATES LEVERAGE/.test(cleanedFix)
  && !/OVERVIEW/.test(cleanedFix) && !/NOT VERIFIED/.test(cleanedFix), cleanedFix);
check('the fix half starts at the fix list', cleanedFix.trim().startsWith('PRIORITIZED FIXES'));

/* A duplicated section (the model restating itself) keeps only the first copy. */
const dupe = A.keepSections('PRIORITIZED FIXES\n- first\n\nPRIORITIZED FIXES\n- second\n', A.FIX_SECTIONS);
check('a repeated section keeps only the first copy',
  /first/.test(dupe) && !/second/.test(dupe), dupe);

/* A clean half must pass through untouched, or the guard is doing harm. */
const already = ['PRIORITIZED FIXES', '- [High] Home page (/), meta: reason. Current: "a". Use: "b". Effort: 5 min (SEO specialist).',
                 '', 'STRATEGIC MOVES', '- Standardize headings.',
                 '', 'WHERE AI CREATES LEVERAGE', '- Continuous auditing.'].join('\n');
check('a well-behaved half is left alone', A.keepSections(already, A.FIX_SECTIONS).trim() === already.trim());

/* Something unrecognisable is never silently emptied. */
check('unrecognisable text is returned rather than blanked',
  A.keepSections('no headers here at all', A.MAIN_SECTIONS) === 'no headers here at all');

/* ---------------------------------------------------------------------------
   THE AUDIT NEEDS NO SETUP AT ALL.

   Edmund: "no employer is gonna do a bunch of extra steps, this was invented to
   be Steve Jobs Apple easy." He was right, and the code agreed with him: the
   audit has no `system` prompt and runSiteAudit never reads BRAND, because it
   reads somebody ELSE's website. It was gated behind brand setup anyway, so the
   best thing in the product sat behind a form it did not need.

   Now only the ten tools that WRITE for your business ask who your business is.

   `current`/`TOOLS` are top-level let/const, so they live in the global
   declarative scope and never appear on window: read them through win.eval.
--------------------------------------------------------------------------- */
console.log('\nZERO SETUP FOR THE AUDIT  (paste a website, get the report)');

win.eval("clearBrand(); current='audit';");
win.renderTool();
check('the audit renders with NO brand saved', /Run Full-Site Audit/i.test(win.document.body.textContent));
check('and it does not divert to brand setup', !win.document.querySelector('.bw-gate'));
check('and it shows the website field straight away', !!win.document.getElementById('f_url'));
/* The sidebar must agree with the pane. On first load it did not: the audit rendered while
   the nav still highlighted the tool whose active class was baked into the static markup. */
check('the sidebar highlights what is actually rendered',
  (win.document.querySelector('.nav-item.active')||{}).dataset === undefined
    ? false
    : win.document.querySelector('.nav-item.active').dataset.tool === 'audit',
  'active nav = ' + ((win.document.querySelector('.nav-item.active')||{}).dataset||{}).tool);
/* Assert the SOURCE default, not the live value: `current` has been reassigned by the
   tests above, so reading it here would prove nothing about what a first visitor gets. */
check('the default landing tool in source is the audit', /let current\s*=\s*"audit"/.test(html),
  (html.match(/let current\s*=\s*"[a-z]+"/) || ['not found'])[0]);

/* The ten writing tools still need to know whose business they are writing for. */
console.log('\nTHE WRITING TOOLS STILL ASK  (and land you where you clicked)');
win.eval("clearBrand(); current='linkedin';");
win.renderTool();
const gate = win.document.querySelector('.bw-gate');
check('a writing tool is still gated into setup', !!gate, 'no .bw-gate rendered');
check('and the notice names that tool', !!gate && /LinkedIn Content Engine/.test(gate.textContent), gate && gate.textContent);
check('and says this is your own site, not the one to audit',
  !!gate && /not the site you want audited/i.test(gate.textContent));

win.renderBrandConfirm({ name: 'Zhaion', what: 'AI-hybrid R&B artist', industry: 'Music',
                         tone: 'Bold', audiences: [], offerings: [], proof: [] }, 'https://zhaion.com');
const bcGo = win.document.getElementById('bcGo');
check('the confirm button names where it is taking you', !!bcGo && /LinkedIn Content Engine/.test(bcGo.textContent), bcGo && bcGo.textContent);

bcGo.dispatchEvent(new win.Event('click'));
check('THE BUG: you land on the tool you clicked, not the email writer',
  win.eval('current') === 'linkedin', 'landed on: ' + win.eval('current'));
check('that tool actually rendered', /Generate LinkedIn Post/i.test(win.document.body.textContent));
check('the brand was saved on the way through', win.eval('!!BRAND'));

/* With a brand saved, nothing nags and every tool opens directly. */
win.eval("current='audit';");
win.renderTool();
check('no gate notice once a brand exists', !win.document.querySelector('.bw-gate'));
check('needsBrand is what decides, not the tool count',
  win.eval('needsBrand(TOOLS.audit)') === false && win.eval('needsBrand(TOOLS.outreach)') === true);

/* ---------------------------------------------------------------------------
   A REAL RESPONSIVE SEARCH AD HAS 19 ASSETS, NOT 3.

   Google's own guidance: fill all 15 headline and 4 description slots, because
   Ad Strength is driven by asset variety and Poor -> Excellent averages about
   15% more clicks and conversions. The tool used to emit two headlines and one
   description, which is not an RSA. The meters have to count numbered assets
   and show how many slots are actually filled.
--------------------------------------------------------------------------- */
console.log('\nRESPONSIVE SEARCH AD METERS  (two headlines is not an RSA)');
const RSA = ['Headline 1: Concept Albums Built Right',
             'Headline 2: Charted #5 On iTunes R&B',
             'Headline 3: This one is deliberately far too long to be a legal headline asset',
             'Description 1: Full concept albums with a short film and a playable game included.',
             'Description 2: Hear the record before release. Join the early list today.'].join('\n');
const meters = win.adMeters('Google Ad', RSA);
check('it meters every numbered headline', /H1 /.test(meters) && /H2 /.test(meters) && /H3 /.test(meters), meters);
check('it meters the descriptions too', /D1 /.test(meters) && /D2 /.test(meters));
check('it reports how many of the 15 slots are filled', /3\/15 headlines/.test(meters), meters);
check('and how many of the 4 description slots', /2\/4 descriptions/.test(meters));
check('an over-limit headline is flagged, not hidden', /cc over">H3/.test(meters), meters);
check('a compliant headline is marked ok', /cc ok">H1/.test(meters));
check('LinkedIn still meters on its own two fields',
  /Headline 3[0-9]?\/70|Headline \d+\/70/.test(win.adMeters('LinkedIn Sponsored', 'Headline: Detroit R&B\nIntro text: Short intro.')),
  win.adMeters('LinkedIn Sponsored', 'Headline: Detroit R&B\nIntro text: Short intro.'));
check('an unrecognised block meters nothing rather than throwing',
  win.adMeters('Google Ad', 'no assets here') === '');

/* ---------------------------------------------------------------------------
   OVER-LENGTH RSA ASSETS NEVER REACH THE USER.

   Measured live on one brief: run one returned compliant descriptions but seven
   headlines up to 38 characters against a 30 cap; run two returned clean
   headlines and all four descriptions between 113 and 133 against a 90 cap. The
   model will not hold two hard caps at once and copy cannot be trimmed in code
   without mangling it, so the prompt over-generates and tightenRsa keeps only
   the legal assets.
--------------------------------------------------------------------------- */
console.log('\nONLY LEGAL RSA ASSETS SURVIVE  (the model will not hold two caps at once)');
const MESSY = [
  'Headline 1: Concept Albums Built Right',
  'Headline 2: This headline is far too long to ever be accepted by Google',
  'Headline 3: Charted #5 On iTunes R&B',
  'Description 1: Full concept albums with a short film and a playable game. Hear it first.',
  'Description 2: This description rambles on well past the ninety character cap that Google enforces on every single description asset.',
  'Pinning note: Pin only the brand name or a required disclaimer.'
].join('\n');
const tight = win.tightenRsa(MESSY);
check('the over-length headline is dropped', !/far too long/.test(tight), tight);
check('the over-length description is dropped', !/rambles on/.test(tight));
check('compliant assets survive', /Concept Albums Built Right/.test(tight) && /Charted #5/.test(tight));
check('survivors are renumbered contiguously', /Headline 1:/.test(tight) && /Headline 2:/.test(tight) && !/Headline 3:/.test(tight), tight);
check('the pinning note is preserved', /Pinning note:/.test(tight));
check('a short set is declared, not hidden', /still to fill/.test(tight), tight);
check('nothing over the cap survives at all',
  (tight.match(/^Headline \d+: (.+)$/gm) || []).every(l => l.replace(/^[^:]*:\s*/, '').length <= 30));
check('an unrecognised block is passed through untouched',
  win.tightenRsa('GOOGLE AD\nsomething unexpected') === 'GOOGLE AD\nsomething unexpected');
check('empty input does not throw', win.tightenRsa('') === '');

/* ---------------------------------------------------------------------------
   REFINE: change a draft instead of rerolling it.

   Regenerating throws away a draft that was mostly right. The dock sends the
   same tool prompt plus the draft plus the instruction, and renders the reply
   back through renderOutput so every guard applies to the revision too.
   Writing tools only: the audit is a multi-call site crawl, not a chat.
--------------------------------------------------------------------------- */
console.log('\nREFINE DOCK  (edit the draft, do not reroll it)');
win.eval("saveBrand(DEFAULT_BRAND); current='outreach';");
win.renderTool();
win.refineArm('Subject: first draft\n\nBody of the first draft.', { company: 'Northwind' });
check('it arms on a writing tool', win.eval('!!REFINE'));
check('the Change this button is revealed', !win.document.getElementById('refineBtn').hidden);
check('the first draft is version 1', win.eval('REFINE.versions.length') === 1);
check('undo is disabled with only one version', win.document.getElementById('rfUndo').disabled);

win.refineOpen(true);
check('the dock opens', win.document.getElementById('refineDock').classList.contains('open'));
check('it suggests example edits before you type', /rf-eg/.test(win.document.getElementById('rfLog').innerHTML));

/* A second version, then Undo must put the first one back on screen. */
win.eval("REFINE.versions.push('Subject: second draft\\n\\nRewritten body.');");
win.undoRefine();
check('undo restores the previous version',
  win.eval("REFINE.versions[REFINE.versions.length-1]").indexOf('first draft') > -1);
check('and the restored draft is what renders',
  /first draft/.test(win.document.getElementById('outArea').textContent),
  win.document.getElementById('outArea').textContent.slice(0, 80));
check('undo is disabled again at version 1', win.document.getElementById('rfUndo').disabled);

/* The audit must never arm it: refining that means re-crawling a site. */
win.eval("current='audit';");
win.renderTool();
win.refineArm('some report body', {});
check('the audit does NOT arm the refine dock', win.eval('REFINE === null'));
check('and its button stays hidden', win.document.getElementById('refineBtn').hidden);

/* Switching tools must not leave a stale draft attached to the wrong tool. */
win.eval("current='outreach';");
win.renderTool();
win.refineArm('draft A', { company: 'A' });
win.eval("current='linkedin';");
win.renderTool();
check('switching tools clears the previous draft', win.eval('REFINE === null'));
check('and closes the dock', !win.document.getElementById('refineDock').classList.contains('open'));

/* The subject gets its own field, so a "---" rule the model puts under it arrives as a
   stray line of hyphens at the top of the email. Seen in a real run. */
console.log('\nTHE EMAIL PREVIEW  (no stray separator under the subject)');
win.eval("saveBrand(DEFAULT_BRAND); current='outreach';");
win.renderTool();
win.renderOutput('Subject: how meridian handles ai-native artists\n\n---\n\nMeridian\'s catalog skews traditional.\n\nWorth a 15 minute call?', { company: 'Meridian' });
const emailTxt = win.document.querySelector('.email-card .body').textContent.trim();
check('the separator rule is gone', !/^[-–—_*]{3,}/.test(emailTxt), JSON.stringify(emailTxt.slice(0, 40)));
check('the body itself still starts correctly', /^Meridian/.test(emailTxt), emailTxt.slice(0, 40));
check('the subject still renders in its own field',
  /how meridian handles ai-native artists/.test(win.document.querySelector('.subject').textContent));
check('a real hyphenated word is untouched',
  (win.renderOutput('Subject: x\n\nWe are a full-stack team.', {}),
   /full-stack/.test(win.document.querySelector('.email-card .body').textContent)));

/* ---------------------------------------------------------------------------
   THE READ IS SAVED IMMEDIATELY, NOT ON "CONTINUE".

   Edmund clicked Competitive Intelligence, got gated into setup, read
   zhaion.com correctly, then clicked another tool in the still-live sidebar
   instead of Continue. saveBrand only ran on Continue, so the read was thrown
   away and the next tool gated him straight back into setup. From his side
   every tool he touched showed the same screen and he never reached a single
   output. His header had no brand chip, which is what gave it away.
--------------------------------------------------------------------------- */
console.log('\nTHE BRAND READ SURVIVES NAVIGATION  (the loop that hid every tool)');
win.eval("clearBrand(); current='intel';");
win.renderBrandConfirm({ name: 'Zhaion', what: 'AI-hybrid R&B artist', industry: 'Music',
                         tone: 'Bold', audiences: ['R&B fans'], offerings: ['Studio Albums'], proof: [] },
                       'https://zhaion.com');
check('the read is saved on arrival, before any click', win.eval('!!BRAND'));
check('and the header chip appears immediately', !win.document.getElementById('brandChip').hidden);
check('the copy tells you it is already saved',
  /saved already/i.test(win.document.querySelector('.tool-head p').textContent));

/* THE ACTUAL BUG: leave via the sidebar instead of Continue. */
win.eval("current='calendar';");
win.renderTool();
check('a different tool now opens instead of re-gating',
  !win.document.querySelector('.bw-gate') && !win.document.getElementById('bwUrl'),
  win.document.querySelector('.tool-head h1').textContent);
check('and it is the tool that was clicked',
  /Content Calendar/i.test(win.document.querySelector('.tool-head h1').textContent));

/* Continue must still work, and still honour a name edit. */
win.eval("clearBrand(); current='intel';");
win.renderBrandConfirm({ name: 'Zhaion', what: 'x', industry: 'Music', tone: 'Bold',
                         audiences: [], offerings: [], proof: [] }, 'https://zhaion.com');
win.document.getElementById('bcName').value = 'Zhaion Music';
win.document.getElementById('bcGo').dispatchEvent(new win.Event('click'));
check('Continue still lands on the tool you clicked', win.eval('current') === 'intel');
check('and an edited name is kept', win.eval('BRAND.name') === 'Zhaion Music', win.eval('BRAND.name'));

/* ---------------------------------------------------------------------------
   YOUR RESULT SURVIVES A SIDEBAR CLICK.

   Switching tools rebuilds main, which threw the output away. Generate an ad
   campaign, glance at the calendar, come back, and it was gone: a model call
   for a generator, and about ten cents and ninety seconds for a site audit,
   lost to a click. Same family as the brand read that was discarded on
   navigation.
--------------------------------------------------------------------------- */
console.log('\nRESULTS SURVIVE NAVIGATION  (a sidebar click used to destroy them)');
win.eval("saveBrand(DEFAULT_BRAND); current='outreach';");
win.renderTool();
const DRAFT = 'Subject: how meridian handles ai-native artists\n\nMeridian has been scaling releases.\n\nWorth a 15 minute call?';
win.renderOutput(DRAFT, { company: 'Meridian' });
win.rememberOutput('outreach', { kind: 'gen', raw: DRAFT, vals: { company: 'Meridian' } });
const beforeLen = win.document.getElementById('outArea').textContent.trim().length;
check('the draft is on screen to begin with', beforeLen > 0);

win.eval("current='linkedin';"); win.renderTool();
check('leaving shows a clean tool, not the old output',
  win.document.getElementById('outArea').textContent.trim().length === 0);

win.eval("current='outreach';"); win.renderTool();
check('COMING BACK RESTORES THE DRAFT',
  /15 minute call/.test(win.document.getElementById('outArea').textContent),
  win.document.getElementById('outArea').textContent.slice(0, 60));
check('and the refine dock re-arms on the restored draft', win.eval('!!REFINE'));
check('restored through the real renderer, so the subject is still a field',
  !!win.document.querySelector('.email-card .subject'));

/* Each tool keeps its own result; they must not bleed into each other. */
win.rememberOutput('intel', { kind: 'gen', raw: 'WHY WE WIN\n- Something specific.', vals: {} });
win.eval("current='intel';"); win.renderTool();
check('a different tool restores ITS output, not the last one',
  /Something specific/.test(win.document.getElementById('outArea').textContent)
  && !/15 minute call/.test(win.document.getElementById('outArea').textContent));

/* A restore must never take the tool screen down with it. */
win.rememberOutput('editor', { kind: 'audit', body: null, vals: null, mark: null, raw: null, pages: null });
let restoreThrew = false;
win.eval("current='editor';");
try { win.renderTool(); } catch (e) { restoreThrew = true; }
check('a broken restore does not break the tool screen', !restoreThrew);
check('and the tool form still rendered', !!win.document.getElementById('genBtn'));

/* ---------------------------------------------------------------------------
   NO INDUSTRY DNA LEFT IN THE FIELDS.

   Spotted on Edmund's own screen: Competitive Intelligence hard-coded five
   staffing agencies as its suggested competitors for every user, so a
   musician was offered recruiters to compete with. The dropdowns
   were made brand-aware long ago; the placeholders and datalists beside them
   were missed. Third time this repo has found leftover staffing DNA, after
   the scorePath keyword table and the near-duplicate service regex.
--------------------------------------------------------------------------- */
console.log('\nNO INDUSTRY DNA IN THE FIELD HINTS  (an R&B artist was offered staffing firms)');
const STAFFING = /robert half|teksystems|insight global|randstad|toptal|staffing|recruit|placement|talent acquisition/i;
const BRAND_FIXTURE = { industry: 'Music, Entertainment', offerings: ['Studio Albums'], audiences: ['R&B fans'] };
let locked = [];
Object.keys(win.eval('Object.keys(TOOLS)') ? {} : {});
const toolKeys = JSON.parse(win.eval('JSON.stringify(Object.keys(TOOLS))'));
toolKeys.forEach(k => {
  const n = Number(win.eval(`(TOOLS['${k}'].fields||[]).length`));
  for (let i = 0; i < n; i++) {
    const ph = win.eval(`(function(){var f=TOOLS['${k}'].fields[${i}];
      var p = typeof f.placeholder==='function' ? f.placeholder(${JSON.stringify(BRAND_FIXTURE)}) : (f.placeholder||'');
      var l = typeof f.list==='function' ? f.list(${JSON.stringify(BRAND_FIXTURE)}) : (f.list||[]);
      return p + ' || ' + l.join(', ');})()`);
    if (STAFFING.test(ph)) locked.push(k + '.' + i + ' -> ' + ph);
  }
});
check('no field hint names a staffing firm or staffing work', locked.length === 0, locked.join('\n        '));

/* And the two that were locked now speak the loaded brand. */
check('the competitor hint uses the brand industry',
  /Music, Entertainment/.test(win.eval(`TOOLS.intel.fields.find(function(f){return f.id==='competitor';}).placeholder(${JSON.stringify(BRAND_FIXTURE)})`)));
check('and offers "doing nothing", the alternative Dunford insists on',
  /doing nothing/i.test(win.eval(`TOOLS.intel.fields.find(function(f){return f.id==='competitor';}).placeholder(${JSON.stringify(BRAND_FIXTURE)})`)));
check('the outreach hint uses a real offering',
  /Studio Albums/.test(win.eval(`TOOLS.outreach.fields.find(function(f){return f.id==='company';}).placeholder(${JSON.stringify(BRAND_FIXTURE)})`)));

console.log('\n' + '-'.repeat(62));
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nThe report a client would hold is BROKEN. Do not deploy.\n'); process.exit(1); }
console.log('\nThe report renders, the PDF builds, and the evidence is in both.\n');
