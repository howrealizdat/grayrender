/**
 * THE WORKSPACE.
 *
 * The suite used to be twelve tools you ran. This layer is the part that makes it somewhere
 * you come back to: findings become tracked work, the work has dates, and the dates leave
 * as a calendar file or a written update.
 *
 * Four things in here are worth a test far more than the screen is:
 *
 *   1. ITEM PARITY. Tracked work is collected inside fixBullets itself, so the to-do list
 *      can only ever contain fixes the report actually showed. If that ever drifts, the
 *      platform-impossible and fabricated findings the guards drop start reappearing as
 *      jobs somebody is asked to do. That is the single most important assertion here.
 *   2. DATES. Built from local components on purpose. toISOString would put anyone west of
 *      Greenwich a day out after 5pm, which on a "due today" list is the whole feature.
 *   3. THE .ics FILE. Somebody else's calendar app parses this, so it has to be right:
 *      CRLF, an exclusive all-day DTEND, escaped separators, folding by octet not character,
 *      and a stable UID so re-exporting updates events instead of duplicating them.
 *   4. NOTHING SILENTLY DROPPED. An export that leaves out half your list has to say so.
 *
 * Run:  node test/workspace.test.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://grayrender.local/' });
const win = dom.window;

win.localStorage.clear();
win.eval("clearBrand();");
win.saveBrand({ name: 'Northwind HVAC', industry: 'Home Services', offerings: ['Install', 'Callout'], audiences: ['Homeowner'], goals: ['Leads'], proof: [] });
win.eval("hydratePlan();");

/* ------------------------------------------------------------------ dates */
console.log('\nDATES ARE LOCAL, NOT UTC');
const today = new Date();
const p2 = n => String(n).padStart(2, '0');
const localToday = today.getFullYear() + '-' + p2(today.getMonth() + 1) + '-' + p2(today.getDate());
check('ymd builds the local date, so late-evening users are not a day out',
  win.ymd(today) === localToday, win.ymd(today) + ' vs ' + localToday);
check('daysUntil today is 0', win.daysUntil(localToday) === 0);
check('a past date reads as late', win.daysUntil(win.ymd(win.addDays(today, -3))) === -3);
check('dueWords speaks in days near the front', win.dueWords(win.ymd(win.addDays(today, 1))) === 'tomorrow');
check('an unparseable date returns nothing rather than guessing', win.daysUntil('next tuesday') === null);

/* ------------------------------------------------------------------ items */
console.log('\nITEMS REMEMBER, AND DO NOT DUPLICATE');
win.eval("PLAN = blankPlan();");
const a1 = win.addItem({ source: 'audit', title: 'Home page (/), title tag', detail: 'first', priority: 'Critical', foundAt: 1000 });
const a2 = win.addItem({ source: 'audit', title: 'Home page (/), title tag', detail: 'second', priority: 'Critical', foundAt: 2000 });
check('re-running the audit updates the fix you already have', win.eval('PLAN.items.length') === 1);
check('and refreshes its wording', a2.detail === 'second');
check('while keeping the same identity', a1.id === a2.id);

win.setItemStatus(a1.id, 'done');
check('marking done sticks', win.findItem(a1.id).status === 'done');
win.addItem({ source: 'audit', title: 'Home page (/), title tag', detail: 'still there', foundAt: Date.now() + 5000 });
check('a LATER audit that still finds it reopens it', win.findItem(a1.id).status === 'open');
check('and says so, rather than a tick beside a live problem', win.findItem(a1.id).returned === true);

win.setItemStatus(a1.id, 'done');
win.addItem({ source: 'audit', title: 'Home page (/), title tag', detail: 'same run', foundAt: 1 });
check('but the run that filed it does not undo what you just ticked off',
  win.findItem(a1.id).status === 'done');

const manual = win.addItem({ source: 'manual', title: 'Call the printer' });
check('a task you add by hand lands beside the findings', win.eval('PLAN.items.length') === 2);
win.removeItem(manual.id);
check('and can be removed', win.eval('PLAN.items.length') === 1);

console.log('\nORDER: what is late comes before what is merely important');
win.eval("PLAN = blankPlan();");
win.addItem({ source: 'manual', title: 'Low, no date', priority: 'Low' });
win.addItem({ source: 'manual', title: 'Critical, no date', priority: 'Critical' });
const late = win.addItem({ source: 'manual', title: 'Overdue, low', priority: 'Low', due: win.ymd(win.addDays(today, -2)) });
const order = win.openItems().map(x => x.title);
check('an overdue item sorts first', order[0] === 'Overdue, low', order.join(' | '));
check('then priority decides', order[1] === 'Critical, no date', order.join(' | '));
check('dueWithin(7) sees the overdue one', win.dueWithin(7).some(x => x.id === late.id));

/* --------------------------------------------------- parity with the report */
console.log('\nPARITY: the to-do list can only contain fixes the report showed');
const FIXES = [
  '- [Critical] Home page (/), title tag: a placeholder wastes the best slot. Current: "Home Final - Northwind". Use: "Heating & Cooling | Northwind". Effort: 10 min (SEO specialist).',
  '- [High] Home page (/), image alt text: 41 images carry no alt attribute. Current: "(41 images with no alt)". Use: "Add descriptive alt text". Effort: 60 min (content editor).',
  '- [Medium] Home page (/), no changes needed here, this is already strong.',
  '- [High] Home page (/), meta description: too short to earn the click. Current: "exact text not provided". Use: "Book a heating engineer today.". Effort: 5 min (copywriter).'
].join('\n');
const body = 'PRIORITIZED FIXES\n' + FIXES + '\n\nSTRATEGIC MOVES\n- Something else entirely.\n';

win.eval("PLAN = blankPlan();");
const nCms = win.syncAuditItems({ body: body, vals: { url: 'https://northwind.example', platform: { name: 'WordPress', kind: 'cms' } }, at: Date.now() });
const titles = win.eval("PLAN.items.map(function(x){return x.title})");
check('real fixes become tracked work', nCms === 2, 'filed ' + nCms);
check('the "no changes needed" line never becomes a job',
  !titles.some(t => /no changes needed/i.test(t)), titles.join(' | '));
check('and neither does the fix whose Current is a fabrication placeholder',
  !titles.some(t => /meta description/i.test(t)), titles.join(' | '));
check('priority carries across for the ones that are real',
  win.eval("PLAN.items[0].priority") === 'Critical');
check('a Critical is dated sooner than a High',
  win.daysUntil(win.eval("PLAN.items[0].due")) < win.daysUntil(win.eval("PLAN.items[1].due")));
check('the replacement copy travels with it, so the item is actionable on its own',
  /Use this: Heating/.test(win.eval("PLAN.items[0].detail")));

win.eval("PLAN = blankPlan();");
win.syncAuditItems({ body: body, vals: { url: 'https://linkbio.example', platform: { name: 'Hopp', kind: 'link-in-bio' } }, at: Date.now() });
const bioTitles = win.eval("PLAN.items.map(function(x){return x.title})");
check('on a locked builder, the alt-text fix the report drops is not filed either',
  !bioTitles.some(t => /alt text/i.test(t)), bioTitles.join(' | '));
check('but the fix that IS possible there still is', bioTitles.some(t => /title tag/i.test(t)));

console.log('\nCALENDAR ROWS BECOME DATED WORK');
const CAL = [
  'WEEK 1',
  'Monday | LinkedIn | Post | Winter service booking opens | Book before the cold snap | Book a service | Photo',
  'Wednesday | Instagram | Reel | Inside a boiler service | What we check | Learn more | Video',
  'Someday | LinkedIn | Post | Unreadable day | Body | CTA | Asset',
  '',
  'WEEK 2',
  'Monday | LinkedIn | Post | Second week hook | Body copy | Book now | Photo',
  '',
  'POSTING NOTES',
  'Category entry points: cold snap, breakdown, moving house.'
].join('\n');
win.eval("PLAN = blankPlan();");
const nCal = win.syncCalendarItems({ raw: CAL, at: Date.now() });
check('every readable row becomes an item', nCal === 4, 'filed ' + nCal);
const w1 = win.eval("PLAN.items[0]"), w2 = win.eval("PLAN.items.filter(function(x){return /Second week/.test(x.title)})[0]");
check('week 2 lands exactly seven days after week 1',
  win.daysUntil(w2.due) - win.daysUntil(w1.due) === 7, w1.due + ' -> ' + w2.due);
check('week 1 Monday is a Monday', new Date(w1.due + 'T00:00:00').getDay() === 1, w1.due);
const unread = win.eval("PLAN.items.filter(function(x){return /Unreadable/.test(x.title)})[0]");
check('a row whose day cannot be read gets NO date rather than an invented one', unread.due === '');
win.syncCalendarItems({ raw: CAL, at: Date.now() });
check('regenerating the calendar updates the rows instead of doubling them',
  win.eval('PLAN.items.length') === 4);

/* -------------------------------------------------------------------- ics */
console.log('\nTHE CALENDAR FILE');
win.eval("PLAN = blankPlan();");
const ev = win.addItem({ source: 'audit', title: 'Fix the title tag; and the meta, too', detail: 'Line one\nLine two', priority: 'Critical', due: '2026-08-20' });
const undated = win.addItem({ source: 'manual', title: 'No date on this one' });
const out = win.buildIcs(win.openItems(), 'Northwind plan');
const ics = out.ics;
check('it is a calendar', /^BEGIN:VCALENDAR\r\n/.test(ics) && /END:VCALENDAR\r\n$/.test(ics));
check('lines end CRLF, as the spec requires', !/[^\r]\n/.test(ics));
check('the dated item is an event', /BEGIN:VEVENT/.test(ics));
check('all-day DTEND is the NEXT day, because it is exclusive',
  /DTSTART;VALUE=DATE:20260820/.test(ics) && /DTEND;VALUE=DATE:20260821/.test(ics));
check('semicolons and commas in a title are escaped, not left to split the field',
  /SUMMARY:Fix the title tag\\; and the meta\\, too/.test(ics), (ics.match(/SUMMARY:.*/) || [''])[0]);
check('newlines in the description become \\n rather than breaking the file',
  /DESCRIPTION:.*Line one\\nLine two/.test(ics.replace(/\r\n /g, '')));
check('the UID is stable, so a re-export updates the event instead of duplicating it',
  ics.indexOf('UID:' + ev.id + '@grayrender') > -1);
check('an undated item is NOT given a date', ics.indexOf('No date on this one') === -1);
check('it is reported as skipped instead of silently vanishing',
  out.skipped.length === 1 && out.skipped[0].id === undated.id);
check('the file names itself for the business', /X-WR-CALNAME:Northwind plan/.test(ics));

console.log('\nFOLDING IS BY OCTET, NOT CHARACTER');
const longAscii = win.icsFold('SUMMARY:' + 'a'.repeat(200));
check('a long line is folded', longAscii.indexOf('\r\n ') > -1);
check('every folded line is within 75 octets',
  longAscii.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75),
  longAscii.split('\r\n').map(l => Buffer.byteLength(l, 'utf8')).join(','));
const multi = win.icsFold('SUMMARY:' + 'é'.repeat(120));
check('a multi-byte character is never split across the fold',
  multi.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75) && multi.replace(/\r\n /g, '').indexOf('�') === -1);
check('and the content survives the round trip',
  multi.replace(/\r\n /g, '') === 'SUMMARY:' + 'é'.repeat(120));

/* ------------------------------------------------------------------ guards */
console.log('\nTHE DAY PLAN IS TETHERED TO REAL ITEMS');
const drifted = ['FOCUS: Ship the title tag today.', '[1] Do the real one.', '[7] Do the one that does not exist.', 'NEXT: sets up the campaign.'].join('\n');
const tethered = win.tetherDayPlan(drifted, 2);
check('a citation outside the list is dropped', tethered.indexOf('[7]') === -1);
check('a real citation survives', tethered.indexOf('[1]') > -1);
check('FOCUS and NEXT carry no citation and are kept',
  /FOCUS:/.test(tethered) && /NEXT:/.test(tethered));

console.log('\nNO FIGURE NOBODY SUPPLIED');
const src = 'OPEN WORK:\n[1] Fix the title tag (due 2026-08-20)\nConversion sits at 12% today.';
const claimed = ['Fixing this lifts conversion 30%.', 'Conversion sits at 12% today.', 'You have 3 items open.', 'Due in 2026.', 'Traffic was 12,400 last month.'].join('\n');
const cleaned = win.dropUnbackedFigures(claimed, src);
check('an invented percentage is dropped', cleaned.indexOf('30%') === -1);
check('a percentage that was supplied survives', cleaned.indexOf('12% today') > -1);
check('a small count is not a fabricated figure and is left alone', cleaned.indexOf('3 items') > -1);
check('a year is not a fabricated figure either', cleaned.indexOf('2026') > -1);
check('an invented thousands figure is dropped', cleaned.indexOf('12,400') === -1);

console.log('\nTHE EMAIL NEVER SILENTLY TRUNCATES');
const shortBody = 'Two lines.\nThat is all.';
check('a short update goes in whole',
  decodeURIComponent(win.mailtoLink('', 'Subject', shortBody).split('&body=')[1]) === shortBody);
const longBody = 'x'.repeat(3000);
const longLink = decodeURIComponent(win.mailtoLink('', 'Subject', longBody).split('&body=')[1]);
check('a long one is cut', longLink.length < longBody.length);
check('and says where the rest is, rather than just ending', /clipboard/.test(longLink));

/* ------------------------------------------------------------------ screen */
console.log('\nTHE SCREEN');
win.eval("PLAN = blankPlan();");
win.eval("Object.keys(LAST_OUT).forEach(function(k){delete LAST_OUT[k]});");
win.eval("current='home';");
win.renderTool();
check('Today renders instead of a form', !!win.document.querySelector('.wk-tiles'));
check('with no generate button, because it generates nothing', !win.document.getElementById('genBtn'));
check('the program names the first step and marks it as where you are',
  /Audit the site/.test(win.document.querySelector('.pg-list').textContent)
  && /You are here/.test(win.document.querySelector('.pg-now').textContent));
check('and files it as a dated job rather than leaving it on a diagram',
  win.openItems().some(x => x.source === 'program' && /Step 1 of 6/.test(x.title) && x.due),
  JSON.stringify(win.openItems().map(x => x.source + ':' + x.title)));

const it1 = win.addItem({ source: 'audit', title: 'Fix the title tag', priority: 'Critical', due: win.ymd(win.addDays(today, 1)) });
win.renderHome();
check('a due item shows on the screen', /Fix the title tag/.test(win.document.body.textContent));
check('the tiles count every open item, including the step the program filed',
  win.document.querySelector('.wk-tile b').textContent === String(win.openItems().length),
  win.document.querySelector('.wk-tile b').textContent + ' vs ' + win.openItems().length);
const box = win.document.querySelector('.wi-check');
box.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
check('ticking it off marks it done', win.findItem(it1.id).status === 'done');
check('and it is written to the timeline',
  win.eval("PLAN.log[0].kind") === 'done', win.eval("JSON.stringify(PLAN.log[0]||{})"));
win.renderHome();
check('done work leaves the open list', !win.openItems().some(x => x.id === it1.id));
check('and the timeline is on screen', !!win.document.querySelector('.wk-log'));

console.log('\nIT SURVIVES A RELOAD, AND TRAVELS WITH THE PROFILE');
win.eval("persistPlan();");
const stored = JSON.parse(win.localStorage.getItem(win.eval('planKey()')));
check('the plan is persisted for this profile', stored.items.length >= 1 && stored.items.some(x => x.id === it1.id));
check('under a key scoped to the business', /^gr_plan_b/.test(win.eval('planKey()')));
win.saveBrand({ name: 'Second Business', offerings: ['x'], audiences: ['y'], goals: ['z'] });
win.eval("hydratePlan();");
check('a different business starts with its own empty plan', win.eval('PLAN.items.length') === 0);

console.log('\nACCESSIBILITY, since this product grades other people on it');
win.eval("current='home';"); win.renderHome();
const unlabelled = [...win.document.querySelectorAll('#main input')].filter(i => {
  const id = i.getAttribute('id');
  return !(i.getAttribute('aria-label') || (id && win.document.querySelector('label[for="' + id + '"]')));
});
check('every input on the workspace has an accessible name', unlabelled.length === 0,
  unlabelled.map(i => i.outerHTML.slice(0, 70)).join(' | '));
check('the result area announces itself to a screen reader',
  (win.document.getElementById('wkOut') || {}).getAttribute?.('aria-live') === 'polite');

console.log('\nEVERY TOOL KNOWS THE CURRENT PLAN');
win.eval("PLAN = blankPlan();");
check('with nothing open, nothing is added to any prompt', win.planDigest() === '');
win.addItem({ source: 'audit', title: 'Fix the title tag', priority: 'Critical' });
win.eval("PLAN.strategy={text:'FOCUS: win back the boiler-repair searches.\\n[1] Do the title tag.',at:Date.now()};");
const dig = win.planDigest();
check('open work reaches the brief', /Fix the title tag/.test(dig), dig);
check('and so does the agreed focus', /boiler-repair searches/.test(dig), dig);
check('the citation markers do not travel with it', dig.indexOf('[1]') === -1, dig);
check('it stays short, because the two longest tools hit the ceiling first', dig.length < 700, 'len ' + dig.length);
win.eval("PLAN.strategy={text:'stale plan',at:Date.now()-9*86400000};");
check('a plan older than a week stops being asserted as current',
  win.planDigest().indexOf('stale plan') === -1);
check('workDigest carries it even when no tool has produced anything yet',
  /Fix the title tag/.test(win.workDigest('audit')));

console.log('\nCOMING BACK ANOTHER DAY');
win.eval("PLAN = blankPlan();");
win.eval("Object.keys(LAST_OUT).forEach(function(k){delete LAST_OUT[k]});");
win.addItem({ source: 'manual', title: 'Something open' });
win.eval("PLAN.lastSeen = Date.now() - 3*86400000;");
win.eval("current='home';"); win.renderHome();
check('the header notices the gap', /in 3 days/.test(win.document.querySelector('.tool-head p').textContent),
  win.document.querySelector('.tool-head p').textContent.trim());
win.eval("LAST_OUT.audit={kind:'audit',body:'x',vals:{},at:Date.now()};");
win.renderHome();
const head = win.document.querySelector('.tool-head p').textContent;
check('but a fresh piece of work overrides a stale lastSeen, so the two lines cannot contradict',
  !/in 3 days/.test(head), head.trim());

console.log('\nTHE PROFILE FILLS IN WHAT IT ALREADY KNOWS');
win.eval("clearBrand();");
win.eval("current='audit';"); win.renderTool();
check('with no business saved the audit field is empty, so zero setup still holds',
  win.document.getElementById('f_url').value === '');
check('and the audit is still reachable without a profile at all',
  !!win.document.getElementById('genBtn'));

win.saveBrand({ name: 'Northwind HVAC', what: 'heating and cooling for homes', url: 'https://northwind.example',
  offerings: ['Boiler install'], audiences: ['Homeowner'], goals: ['More booked jobs'], proof: [] });
win.eval("current='audit';"); win.renderTool();
check('once a site is connected the audit fills its own address in',
  win.document.getElementById('f_url').value === 'https://northwind.example');
check('and says where that came from, so it does not read as a bug',
  /Northwind HVAC/.test((win.document.querySelector('.brand-src') || {}).textContent || ''));
win.document.getElementById('f_url').value = 'https://a-competitor.example';
check('it is only a default: typing over it wins',
  win.document.getElementById('f_url').value === 'https://a-competitor.example');

['calendar', 'social', 'comms', 'brand', 'report'].forEach(k => {
  win.eval("current='" + k + "';"); win.renderTool();
  const v = (win.document.getElementById('f_brand') || {}).value;
  check(k + ' no longer asks you to type your own company', v === 'Northwind HVAC, heating and cooling for homes', k + ' got "' + v + '"');
});

console.log('\nBUT NOT THE FIELDS THAT ARE ABOUT SOMEBODY ELSE');
win.eval("current='outreach';"); win.renderTool();
check('the outreach target company is left blank, because it is not you',
  win.document.getElementById('f_company').value === '');
win.eval("current='intel';"); win.renderTool();
check('and neither is the competitor filled in with your own name',
  win.document.getElementById('f_competitor').value === '');

console.log('\nNO LEFTOVER DNA IN THE HINTS');
const stale = JSON.parse(win.eval("JSON.stringify(Object.keys(TOOLS))"));
let staleHits = [];
stale.forEach(k => {
  win.eval("current='" + k + "';");
  if (win.eval("!!(TOOLS['" + k + "'].workspace)")) return;
  win.renderTool();
  [...win.document.querySelectorAll('#main input,#main textarea')].forEach(i => {
    const ph = i.getAttribute('placeholder') || '';
    if (/auto dealers|The Shop|dealer group/i.test(ph)) staleHits.push(k + ':' + ph);
  });
});
check('no field hint still names a business from an old job spec', staleHits.length === 0, staleHits.join(' | '));

console.log('\nTHE WEBSITE IS KEPT WHEN THE SITE IS READ');
win.eval("clearBrand();");
win.renderBrandConfirm({ name: 'Readco', what: 'a thing', offerings: ['x'], audiences: ['y'], goals: ['z'], proof: [] }, 'https://readco.example');
check('reading a site stores the address on the profile', win.eval("BRAND.url") === 'https://readco.example');
check('and shows it on the confirm screen so a wrong one can be corrected',
  (win.document.getElementById('bcUrl') || {}).value === 'https://readco.example');
win.document.getElementById('bcUrl').value = 'https://readco.example/uk';
win.document.getElementById('bcGo').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
check('a corrected address wins over the one that was read', win.eval("BRAND.url") === 'https://readco.example/uk');

console.log('\nA PROFILE FROM BEFORE THE ADDRESS WAS KEPT');
win.eval("clearBrand();");
win.saveBrand({ name: 'Legacy Co', offerings: ['x'], audiences: ['y'], goals: ['z'], proof: [] });
win.eval("PLAN = blankPlan(); hydratePlan();");
win.eval("current='audit';"); win.renderTool();
check('the audit field stays empty rather than guessing an address',
  win.document.getElementById('f_url').value === '');
check('and Today asks for it instead of silently doing nothing',
  win.nextMoves().some(m => /Tell Grayrender your website/.test(m.t)),
  JSON.stringify(win.nextMoves().map(m => m.t)));

console.log('\nTHE PREFILLED DESCRIPTION READS AS ONE SENTENCE');
check('a capitalised description is lowercased into the middle of the sentence',
  win.brandBlurb({ name: 'Eleventy', what: 'Simpler static site generator.' }) === 'Eleventy, simpler static site generator',
  win.brandBlurb({ name: 'Eleventy', what: 'Simpler static site generator.' }));
check('an acronym is left exactly as written',
  win.brandBlurb({ name: 'Acme', what: 'AI tooling for finance teams' }) === 'Acme, AI tooling for finance teams');
check('a name with no description is just the name',
  win.brandBlurb({ name: 'Acme' }) === 'Acme');
check('and nothing at all yields nothing', win.brandBlurb({}) === '');

console.log('\nTHE PROGRAM IS AN ORDER, NOT A MENU');
win.eval("clearBrand();");
win.saveBrand({ name: 'Northwind HVAC', what: 'heating and cooling', url: 'https://northwind.example',
  offerings: ['Boiler install'], audiences: ['Homeowner'], goals: ['Leads'], proof: [] });
win.eval("PLAN = blankPlan(); Object.keys(LAST_OUT).forEach(function(k){delete LAST_OUT[k]});");

check('every step maps to a tool that exists',
  win.eval("JSON.stringify(PROGRAM.map(function(s){return !!TOOLS[s.tool]}))") === JSON.stringify([true,true,true,true,true,true]));
check('and every tool is reachable from the sidebar, none lost in the reorder',
  win.eval("JSON.stringify(Object.keys(TOOLS).filter(function(k){return !document.querySelector('.nav-item[data-tool=\"'+k+'\"]')}))") === '[]',
  win.eval("JSON.stringify(Object.keys(TOOLS).filter(function(k){return !document.querySelector('.nav-item[data-tool=\"'+k+'\"]')}))"));

let st = win.programState();
check('with nothing done, step one is where you are', st[0].status === 'now' && st[0].tool === 'audit');
check('and everything after it is later, not locked', st.slice(1).every(s => s.status === 'later'));

console.log('\nAN AUDIT ALONE DOES NOT FINISH STEP ONE');
const AUDIT_BODY = 'PRIORITIZED FIXES\n- [Critical] Home page (/), title tag: placeholder. Current: "Home Final". Use: "Boiler Install | Northwind". Effort: 10 min (SEO specialist).\n\nSTRATEGIC MOVES\n- later\n';
win.rememberOutput('audit', { kind: 'audit', body: AUDIT_BODY, vals: { url: 'https://northwind.example', platform: { name: 'WordPress', kind: 'cms' } }, mark: 'B-', raw: AUDIT_BODY, pages: [] });
st = win.programState();
check('running the report leaves step one open while a critical fix is unshipped',
  st[0].status === 'now', JSON.stringify(st.map(s => s.n + ':' + s.status)));
check('and says so, rather than looking merely undone', st[0].started === true);
const critical = win.openItems().filter(x => x.source === 'audit')[0];
win.setItemStatus(critical.id, 'done');
st = win.programState();
check('shipping the fixes is what completes it', st[0].status === 'done', JSON.stringify(st.map(s => s.n + ':' + s.status)));
check('and step two becomes where you are', st[1].status === 'now' && st[1].tool === 'brand');

console.log('\nWORKING OUT OF ORDER IS ALLOWED');
win.rememberOutput('report', { kind: 'gen', raw: 'HEADLINE\nnumbers', vals: {} });
st = win.programState();
check('a step done early is marked done where it is', st[5].status === 'done');
check('and the sequence still points at the real next one', st[1].status === 'now');
check('progress counts what is actually finished', win.programDone() === 2);

console.log('\nTHE STEP YOU ARE ON IS REAL WORK');
win.syncProgramItem();
const pItem = win.PLAN ? null : null;
const progItems = win.openItems().filter(x => x.source === 'program');
check('exactly one program step is open at a time', progItems.length === 1, JSON.stringify(progItems.map(x => x.title)));
check('it is the current step', /Step 2 of 6/.test(progItems[0].title), progItems[0].title);
check('it carries a date, so it reaches the calendar export', !!progItems[0].due);
const icsProg = win.buildIcs(win.openItems(), 'x');
check('and it really does appear in the calendar file',
  icsProg.ics.indexOf('Step 2 of 6') > -1);
win.rememberOutput('brand', { kind: 'gen', raw: 'POSITIONING\nvoice', vals: {} });
win.syncProgramItem();
check('finishing that step closes its job automatically',
  !win.openItems().some(x => x.key === 'program:brand'));
check('and the next one opens', win.openItems().some(x => x.key === 'program:intel'));

console.log('\nTHE SIDEBAR SHOWS THE CHECKLIST');
win.eval("current='home';"); win.renderTool();
const badges = [...win.document.querySelectorAll('.nav-item .np')].map(b => b.className.replace('np np-', '') + ':' + b.textContent);
check('every program step carries a badge', badges.length === 6, badges.join(' | '));
check('done steps show a tick, not a number', badges.filter(b => /✓/.test(b)).length === win.programDone(), badges.join(' | '));
check('one and only one step is marked as where you are',
  badges.filter(b => /^now/.test(b)).length === 1, badges.join(' | '));
check('the anytime tools carry no step number',
  !win.document.querySelector('.nav-item[data-tool="editor"] .np'));
win.eval("clearBrand();"); win.eval("current='home';");
win.paintProgram();
check('and with no business at all the sidebar is a plain menu again',
  win.document.querySelectorAll('.nav-item .np').length === 0);

console.log('\nTHE STRATEGY DOCUMENT');
win.saveBrand({ name: 'Northwind HVAC', what: 'heating and cooling', url: 'https://northwind.example', offerings: ['x'], audiences: ['y'], goals: ['z'], proof: [] });
win.eval("PLAN.strategyDoc={text:'WHERE YOU ARE\\nTwo steps are done.\\n\\nTHE STRATEGY\\n1. Fix the title tag first.\\n2. Then launch.\\n\\nTHE NEXT NINETY DAYS\\nDays 1 to 30\\nShip the fixes.\\n\\nWHAT WOULD MAKE THIS FAIL\\nNobody owns it.\\n\\nWHAT IS NOT KNOWN YET\\nNo conversion data.',at:Date.now(),done:2};");
win.eval("current='home';"); win.renderHome();
const strat = win.document.getElementById('stratOut');
check('it renders as a document, not a wall of text',
  strat.querySelectorAll('.st-sec').length === 5, String(strat.querySelectorAll('.st-sec').length));
check('numbered moves are pulled out', strat.querySelectorAll('.st-move').length === 2);
check('the ninety day phases are marked', strat.querySelectorAll('.st-phase').length === 1);
/* The model writes the phase and its content on one line about half the time. Uppercasing
   that shouted an entire paragraph at the reader on the first live run. */
win.eval("PLAN.strategyDoc={text:'THE NEXT NINETY DAYS\\nDays 1 to 30: Ship the two fixes, then test both on mobile yourself.\\nDays 31 to 60\\nRun the campaign builder.',at:Date.now(),done:2};");
win.renderHome();
const phases = [...win.document.querySelectorAll('.st-phase')].map(e => e.textContent);
check('a phase written on one line keeps its label short', phases.length === 2 && phases.every(p => p.length < 18), JSON.stringify(phases));
check('and its sentence renders as ordinary prose, not shouting',
  /Ship the two fixes/.test(win.document.querySelector('.st-b p').textContent),
  (win.document.querySelector('.st-b p') || {}).textContent);
check('it says how much of the program it was written from, not how much is done NOW',
  /written from 2 of 6 steps done/.test(strat.textContent.replace(/\s+/g, ' ')),
  strat.textContent.replace(/\s+/g, ' ').slice(0, 160));
check('and admits when the work has moved on since it was written',
  /finished \d+ more steps? since this was written/.test(strat.textContent),
  strat.textContent.replace(/\s+/g, ' ').slice(0, 300));
check('and it can be taken away', !!win.document.getElementById('stDl') && !!win.document.getElementById('stCopy'));
check('a strategy written earlier is still there on the next visit',
  (win.renderHome(), !!win.document.querySelector('.strategy')));
check('the audit section reader finds a named section',
  /placeholder/.test(win.auditSectionOf(AUDIT_BODY, 'PRIORITIZED FIXES')));
check('and returns nothing for a section that is not there',
  win.auditSectionOf(AUDIT_BODY, 'WHAT IS COSTING YOU LEADS') === '');

console.log('\nTHE PROGRAM GETS OUT OF THE WAY ONCE YOU ARE MOVING');
win.eval("clearBrand();");
win.saveBrand({ name: 'Fresh Co', offerings: ['x'], audiences: ['y'], goals: ['z'], proof: [], url: 'https://fresh.example' });
win.eval("PLAN = blankPlan(); Object.keys(LAST_OUT).forEach(function(k){delete LAST_OUT[k]});");
win.eval("current='home';"); win.renderHome();
check('on day one all six steps are shown', win.document.querySelectorAll('.pg-s').length === 6);
win.rememberOutput('brand', { kind: 'gen', raw: 'POSITIONING\nvoice', vals: {} });
win.renderHome();
check('once something is done it collapses to the step you are on',
  win.document.querySelectorAll('.pg-s').length === 1, String(win.document.querySelectorAll('.pg-s').length));
check('and that one row is the current step',
  /Audit the site/.test(win.document.querySelector('.pg-s').textContent));
check('the progress bar still reports the whole program',
  /1<\/b> of 6 done/.test(win.document.querySelector('.pg-prog').innerHTML.replace(/\s+/g, ' ')),
  win.document.querySelector('.pg-prog').textContent.replace(/\s+/g, ' '));
win.document.getElementById('pgToggle').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
check('opening it shows everything again', win.document.querySelectorAll('.pg-s').length === 6);
win.renderHome();
check('and the choice survives a re-render', win.document.querySelectorAll('.pg-s').length === 6);

console.log('\n' + '-'.repeat(62));
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nThe workspace is BROKEN. Do not deploy.\n'); process.exit(1); }
console.log('\nFindings become work, the work has dates, and the dates leave the building.\n');
