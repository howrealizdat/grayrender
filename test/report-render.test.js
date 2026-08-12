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

console.log('\n' + '-'.repeat(62));
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nThe report a client would hold is BROKEN. Do not deploy.\n'); process.exit(1); }
console.log('\nThe report renders, the PDF builds, and the evidence is in both.\n');
