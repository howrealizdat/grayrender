/**
 * FAN ENGAGEMENT.
 *
 * This layer is a set of claims about numbers, and a claim about a number is exactly the
 * kind of thing that rots silently. The screens would keep rendering perfectly while the
 * segment counts drifted, the frequency cap stopped counting its own sends, or a
 * personalization token quietly started shipping empty. Nothing on screen would look wrong.
 *
 * So the assertions here are aimed at the things a screenshot cannot catch:
 *
 *   1. DETERMINISM. The whole build rests on it. If the seeded generator ever stops
 *      reproducing, every count in the product becomes a different story on every reload,
 *      and the first person to notice stops believing all of it. Tested first, and hardest.
 *   2. THE ARITHMETIC CLOSES. reachable + suppressed must equal matched, always. A
 *      suppression breakdown that does not add up is worse than no breakdown.
 *   3. CONSENT IS PER CHANNEL. The single most important behavioural claim this makes.
 *      Email consent must never buy an SMS.
 *   4. THE CAP COUNTS ITS OWN SENDS. A journey that ignores the messages it has already
 *      sent is not capped, and that bug is invisible until somebody is messaged five times.
 *   5. THE QA HARNESS ACTUALLY CATCHES THINGS. Asserted against a template with defects
 *      planted in it, because a harness proven against clean input has been proven of nothing.
 *   6. THE CONTRAST MATHS IS RIGHT. This product grades other people on accessibility.
 *   7. THE A/B GUARD REFUSES. Including that peeking really does inflate the error rate,
 *      which is measured by simulation rather than asserted.
 *
 * Run:  node test/fan.test.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://grayrender.local/' });
const win = dom.window;
/* const declarations never become window properties, so the fixtures are lifted out
   through the page's own scope rather than guessed at from the outside. */
win.eval('window.__fx={FAN_N,FREQ_CAP,FAN_TODAY,FAN_CLUB,FAN_SEED,FAN_SEGMENT_RULES,FAN_JOURNEY,'
       + 'FAN_TOKENS,SEG_OPS,FAN_FIELDS,EMAIL_V1,EMAIL_V2,SMS_V1,SMS_V2,PUSH_V1,PUSH_V2,FAN_BRIEF,'
       + 'FAN_FOCUS,FAN_STANDARDS,FAN_GUIDE,BIRG};');
const FX = win.__fx;

/* The cheapest assertion in the file, and it catches the worst failure. A throw anywhere
   during script execution means every declaration AFTER it never happens, and the app dies
   on every screen at once with a confusing "cannot access X before initialization" from
   whatever happens to be referenced first. A const that read another const declared further
   down did exactly that. If this line fails, nothing below it is worth reading. */
console.log('\nTHE SCRIPT RAN TO THE END');
check('the last declarations in the file exist, so nothing threw on the way',
  win.eval('typeof FAN_SCREENS') === 'object' && Object.keys(win.eval('FAN_SCREENS')).length === 7);
check('and the boot sequence completed', typeof win.goTool === 'function' && typeof win.fans === 'function');

/* ------------------------------------------------------------- determinism */
console.log('\nTHE SAME SEED IS THE SAME BOOK, EVERY TIME');
const A = win.fans();
check('the generator produces the whole book', A.length === FX.FAN_N && FX.FAN_N === 24000);
win.eval('FANS=null;');
const B = win.fans();
check('regenerating from the seed gives an identical record',
  JSON.stringify(A[7777]) === JSON.stringify(B[7777]), 'record 7777 drifted');
check('and an identical book end to end',
  A.every((f, i) => f.id === B[i].id && f.spend === B[i].spend && f.msgs7d === B[i].msgs7d));
const seg1 = win.evalSegment(FX.FAN_SEGMENT_RULES, 'email', {});
const seg2 = win.evalSegment(FX.FAN_SEGMENT_RULES, 'email', {});
check('so a segment count reproduces exactly',
  seg1.matched === seg2.matched && seg1.reachable === seg2.reachable);
check('ids are unique', new Set(A.map(f => f.id)).size === A.length);

/* --------------------------------------------------------------- the shape */
console.log('\nTHE DATA IS POWER LAW, NOT UNIFORM');
const sp = A.map(f => f.spend).sort((a, b) => a - b);
const total = sp.reduce((s, x) => s + x, 0);
const top1 = sp.slice(Math.floor(0.99 * sp.length)).reduce((s, x) => s + x, 0) / total;
const top10 = sp.slice(Math.floor(0.90 * sp.length)).reduce((s, x) => s + x, 0) / total;
check('the top 1% hold a disproportionate share of spend (' + (top1 * 100).toFixed(1) + '%)', top1 > 0.10);
check('the top 10% hold roughly half or more (' + (top10 * 100).toFixed(1) + '%)', top10 > 0.40);
check('the median is far below the mean, which is what a long tail means',
  sp[Math.floor(sp.length / 2)] * 3 < total / sp.length);
/* A clamp that the tail piles up against reads as a spike at exactly the ceiling. */
const atCap = A.filter(f => f.msgs7d === 7).length / A.length;
check('the contact-frequency tail is not stacked on its own clamp (' + (atCap * 100).toFixed(2) + '% at the ceiling)', atCap < 0.02);
const months = {};
A.forEach(f => { months[f.lastAttended.slice(5, 7)] = 1; });
check('attendance only ever falls inside a season window',
  Object.keys(months).sort().join(',') === '01,09,10,11,12', Object.keys(months).sort().join(','));
check('not everybody is a season ticket holder, or "lapsed holder" would select the whole book',
  A.filter(f => f.sthEver).length < A.length * 0.5 && A.filter(f => f.sthEver).length > A.length * 0.2);
check('a tier is a percentile, so no Founder sits below the median spend',
  Math.min.apply(null, A.filter(f => f.tier === 'Founders Circle').map(f => f.spend)) > sp[Math.floor(sp.length / 2)]);

/* ------------------------------------------------------------------ gauss */
console.log('\nTHE NORMAL DRAW HAS REAL TAILS');
/* Averaging a few uniforms has BOUNDED support and cannot produce a tail event, which
   silently flattened the peeking simulation to zero. It has to be a real normal. */
const r = win.frng(11);
let n = 120000, s = 0, s2 = 0, mx = 0;
for (let i = 0; i < n; i++) { const g = win.gauss(r); s += g; s2 += g * g; mx = Math.max(mx, Math.abs(g)); }
check('mean is 0 (' + (s / n).toFixed(3) + ')', near(s / n, 0, 0.02));
check('standard deviation is 1 (' + Math.sqrt(s2 / n).toFixed(3) + ')', near(Math.sqrt(s2 / n), 1, 0.02));
check('and it can reach beyond 3 sigma, which a sum of uniforms cannot (' + mx.toFixed(2) + ')', mx > 3.5);

/* -------------------------------------------------------------- the counts */
console.log('\nEVERY COUNT ADDS UP, AND SAYS WHO WAS REMOVED');
['email', 'sms', 'push'].forEach(ch => {
  const s = win.evalSegment(FX.FAN_SEGMENT_RULES, ch, { hour: 10 });
  check(ch + ': reachable plus suppressed equals matched',
    s.reachable + s.suppressed === s.matched, s.reachable + '+' + s.suppressed + ' != ' + s.matched);
  check(ch + ': the itemised reasons add up to the suppressed total',
    s.reasons.reduce((a, x) => a + x.count, 0) === s.suppressed);
  check(ch + ': the sentence names a reason rather than just a number',
    /suppressed:/.test(win.segSentence(s)) || s.suppressed === 0);
});
const empty = win.evalSegment([], 'email', {});
check('no rules matches everybody, and is not silently treated as a segment', empty.matched === FX.FAN_N);

/* ------------------------------------------------------------- the consent */
console.log('\nCONSENT IS HELD PER CHANNEL, NOT ONCE FOR "MARKETING"');
const emailOnly = A.filter(f => f.emailOptIn && f.emailValid && !f.smsOptIn && !f.unsub && f.msgs7d < FX.FREQ_CAP)[0];
check('a fan with email consent and no SMS consent is reachable by email',
  win.suppressionOf(emailOnly, 'email', {}) === null);
check('and is NOT reachable by SMS, at any hour',
  win.suppressionOf(emailOnly, 'sms', { hour: 14 }) === 'No SMS consent');
const unsubbed = A.filter(f => f.unsub && f.emailOptIn)[0];
check('a global unsubscribe beats a channel opt-in that is still set',
  win.suppressionOf(unsubbed, 'email', {}) === 'Unsubscribed from all marketing');
const bounced = A.filter(f => f.emailOptIn && !f.emailValid && !f.unsub)[0];
check('a hard bounce is reported as a bounce, not as missing consent',
  win.suppressionOf(bounced, 'email', {}) === 'Email hard-bounced');
const noApp = A.filter(f => !f.hasApp && !f.unsub)[0];
check('push without the app is refused, and says the app is the reason',
  win.suppressionOf(noApp, 'push', {}) === 'No app installed');

console.log('\nQUIET HOURS BITE, AND ONLY AT NIGHT');
const smsFan = A.filter(f => f.smsOptIn && !f.unsub && f.msgs7d < FX.FREQ_CAP)[0];
check('11:00 in their own timezone is allowed', win.suppressionOf(smsFan, 'sms', { hour: 11 }) === null);
check('02:00 is not', win.suppressionOf(smsFan, 'sms', { hour: 2 }) === 'Quiet hours in their timezone');
check('23:00 is not', win.suppressionOf(smsFan, 'sms', { hour: 23 }) === 'Quiet hours in their timezone');
check('quiet hours wrap over midnight rather than being read as an empty range',
  win.inQuietHours({ quietStart: 21, quietEnd: 9 }, 23) && win.inQuietHours({ quietStart: 21, quietEnd: 9 }, 3)
  && !win.inQuietHours({ quietStart: 21, quietEnd: 9 }, 12));
const at22 = win.evalSegment(FX.FAN_SEGMENT_RULES, 'sms', { hour: 22 });
const at14 = win.evalSegment(FX.FAN_SEGMENT_RULES, 'sms', { hour: 14 });
check('so a 22:00 SMS send reaches nobody at all', at22.reachable === 0);
check('while the same segment at 14:00 does reach people', at14.reachable > 100);
check('and it is a preference per fan, not one global constant',
  new Set(A.slice(0, 500).map(f => f.quietStart)).size > 1);

console.log('\nTHE FREQUENCY CAP');
const busy = Object.assign({}, smsFan, { msgs7d: FX.FREQ_CAP });
check('a fan already at the cap is held back',
  win.suppressionOf(busy, 'sms', { hour: 12 }) === 'Frequency cap: ' + FX.FREQ_CAP + ' in 7 days already sent');
check('one below the cap is not',
  win.suppressionOf(Object.assign({}, smsFan, { msgs7d: FX.FREQ_CAP - 1 }), 'sms', { hour: 12 }) === null);
check('and the cap can be lifted explicitly, for a count of who matched before consent',
  win.suppressionOf(busy, 'sms', { hour: 12, cap: null }) === null);

/* ------------------------------------------------------------- the rules */
console.log('\nA SEGMENT RULE IS TOTAL, AND NEVER THROWS');
check('an unknown operator matches nobody rather than crashing the screen',
  win.segMatch(A[0], [{ field: 'spend', op: 'not_a_real_op', value: 1 }]) === false);
check('an unknown field matches nobody', win.segMatch(A[0], [{ field: 'nope', op: 'gte', value: 1 }]) === false);
check('a value that is not a number matches nobody',
  win.segMatch(A[0], [{ field: 'spend', op: 'gte', value: 'lots' }]) === false);
check('rules are AND, so adding one can only ever narrow the audience',
  win.evalSegment(FX.FAN_SEGMENT_RULES.concat([{ field: 'hasApp', op: 'is_true' }]), 'email', {}).matched
  <= win.evalSegment(FX.FAN_SEGMENT_RULES, 'email', {}).matched);
check('is_null and not_null are exact opposites over the book',
  win.evalSegment([{ field: 'favoritePlayer', op: 'is_null' }], 'email', {}).matched
  + win.evalSegment([{ field: 'favoritePlayer', op: 'not_null' }], 'email', {}).matched === FX.FAN_N);
check('every operator offered in the UI actually exists in the engine',
  Object.keys(FX.SEG_OPS).every(k => typeof FX.SEG_OPS[k].fn === 'function'));

/* Caught in the browser, not here, which is why these three exist now. dormantDays had no
   FAN_FIELDS entry, so the row fell back to type "text", whose operator list does not
   contain "is at least". The select therefore rendered "is" while the engine evaluated
   "is at least": the screen was describing a rule that had not run. Nothing threw, nothing
   looked broken, and every count on the page was still correct. */
check('every field the default segment uses has a definition behind it',
  FX.FAN_SEGMENT_RULES.every(r => !!FX.FAN_FIELDS[r.field]),
  FX.FAN_SEGMENT_RULES.filter(r => !FX.FAN_FIELDS[r.field]).map(r => r.field).join(','));
check('and every field offered in the builder is a real field on a fan',
  Object.keys(FX.FAN_FIELDS).every(k => k in A[0]),
  Object.keys(FX.FAN_FIELDS).filter(k => !(k in A[0])).join(','));
win.goTool('fanseg');
const rows = Array.prototype.slice.call(win.document.querySelectorAll('.fe-rule'));
check('the builder renders one row per rule', rows.length === FX.FAN_SEGMENT_RULES.length);
check('and every row offers the operator that is actually being evaluated, so the screen '
  + 'can never describe a rule that did not run',
  rows.every((row, i) => {
    const sel = row.querySelector('.fe-rop');
    return sel && Array.prototype.slice.call(sel.options).some(o => o.value === FX.FAN_SEGMENT_RULES[i].op)
      && sel.value === FX.FAN_SEGMENT_RULES[i].op;
  }),
  rows.map((r, i) => FX.FAN_SEGMENT_RULES[i].op + '->' + r.querySelector('.fe-rop').value).join(' '));
check('a rule that needs a value gets an input to type it into',
  rows.every((row, i) => {
    const needs = ['is_true','is_false','is_null','not_null'].indexOf(FX.FAN_SEGMENT_RULES[i].op) < 0;
    return needs === !!row.querySelector('.fe-rv');
  }));

/* ----------------------------------------------------------------- LTV */
console.log('\nLIFETIME VALUE IS ARITHMETIC, AND SURVIVES A NULL');
const neverHeld = A.filter(f => !f.sthEver)[0];
check('a fan who never held a season ticket has no lastSeasonHeld', neverHeld.lastSeasonHeld === null);
check('and still scores a finite lifetime value rather than NaN',
  isFinite(win.fanLTV(neverHeld)) && win.fanLTV(neverHeld) > 0, String(win.fanLTV(neverHeld)));
check('every fan in the book scores a finite value', A.every(f => isFinite(win.fanLTV(f))));
check('lifetime value is never below what they have already spent',
  A.slice(0, 3000).every(f => win.fanLTV(f) >= f.spend));
check('a dormant fan is worth less than an identical fan who is not',
  win.fanLTV(Object.assign({}, A[10], { dormantSeasons: 5 })) < win.fanLTV(Object.assign({}, A[10], { dormantSeasons: 0 })));
check('the formula is stated on screen rather than hidden', /retention/.test(win.ltvFormula()) && win.ltvFormula().length > 120);

/* ------------------------------------------------------ dynamic content */
console.log('\nDYNAMIC CONTENT, AND WHAT HAPPENS WHEN IT IS EMPTY');
const nullFan = A.filter(f => !f.favoritePlayer)[0];
const noFb = win.resolveTokens('Watch {{favorite_player}} play.', nullFan, {});
check('a null token with no fallback renders as the hole it actually is', noFb.out === 'Watch  play.');
check('and is reported as empty rather than passing quietly', noFb.empty.indexOf('favorite_player') >= 0);
const withFb = win.resolveTokens('Watch {{favorite_player | the squad}} play.', nullFan, {});
check('a fallback fills it', withFb.out === 'Watch the squad play.');
check('and the fallback is reported as having been used', withFb.fellBack.indexOf('favorite_player') >= 0);
const typo = win.resolveTokens('Hi {{first_naem}}', A[0], {});
check('a mistyped token is left visible, so it cannot ship looking fine',
  typo.out === 'Hi {{first_naem}}' && typo.unknown[0] === 'first_naem');
const good = win.resolveTokens('Hi {{first_name}}', A[0], {});
check('a real token resolves', good.out === 'Hi ' + A[0].first && good.unknown.length === 0);
check('a fallback is not used when the value is present',
  win.resolveTokens('Hi {{first_name | there}}', A[0], {}).fellBack.length === 0);

console.log('\nSEND TIME AGAINST OPEN TIME');
const line = '{{countdown}} to kickoff, {{seats_left}} left';
const sentAt = win.resolveTokens(line, A[0], { mode: 'send', at: '2026-09-01' });
const openLater = win.resolveTokens(line, A[0], { mode: 'open', at: '2026-09-07' });
check('resolving at open gives a different answer from the frozen send-time one',
  sentAt.out !== openLater.out, sentAt.out + ' vs ' + openLater.out);
check('an open-time token rendered at send is reported as frozen',
  sentAt.frozen.indexOf('countdown') >= 0);
check('and is not reported as frozen when it is resolved at open',
  openLater.frozen.length === 0);
check('opening at the same moment twice gives the same answer',
  win.resolveTokens(line, A[0], { mode: 'open', at: '2026-09-07' }).out === openLater.out);

/* ---------------------------------------------------------------- contrast */
console.log('\nTHE CONTRAST MATHS IS THE REAL WCAG MATHS');
check('black on white is 21:1', win.contrastRatio('#000000', '#ffffff') === 21);
check('white on white is 1:1', win.contrastRatio('#ffffff', '#ffffff') === 1);
check('#767676 on white sits just over the 4.5:1 threshold (' + win.contrastRatio('#767676', '#ffffff') + ')',
  near(win.contrastRatio('#767676', '#ffffff'), 4.54, 0.02));
check('#9a9a9a on white fails it (' + win.contrastRatio('#9a9a9a', '#ffffff') + ')',
  win.contrastRatio('#9a9a9a', '#ffffff') < 4.5);
check('the ratio is symmetric', win.contrastRatio('#123456', '#ffffff') === win.contrastRatio('#ffffff', '#123456'));
check('three-digit hex is understood', win.hexOf('#abc') === '#aabbcc');
check('rgb() is understood', win.hexOf('rgb(255, 0, 0)') === '#ff0000');
check('an unparseable colour returns nothing rather than a wrong number', win.contrastRatio('chartreuse', '#fff') === null);

/* --------------------------------------------------------------------- QA */
console.log('\nTHE QA HARNESS CATCHES A TEMPLATE THAT IS ACTUALLY BROKEN');
const people = win.evalSegment(FX.FAN_SEGMENT_RULES, 'email', {}).people;
const v1 = win.qaEmail(FX.EMAIL_V1, people);
const v2 = win.qaEmail(FX.EMAIL_V2, people);
const has = (F, re) => F.some(x => re.test(x.standard + ' ' + x.where + ' ' + x.what));
check('it finds the mistyped merge field', has(v1, /Unknown token/));
check('it finds the personalization token with no fallback', has(v1, /no fallback/));
check('and says how many of the real segment it would break for',
  v1.some(x => /no fallback/.test(x.what) && /\d/.test(x.what)));
check('it finds the image with no alt text', has(v1, /WCAG 1\.1\.1.*no alt/));
check('it finds the layout table announced as data', has(v1, /WCAG 1\.3\.1.*presentation/));
check('it finds the skipped heading level', has(v1, /Heading level jumps/));
check('it finds the failing contrast, and states the measured ratio', has(v1, /WCAG 1\.4\.3.*Contrast is \d/));
check('it finds the http link', has(v1, /http, not https/));
check('it finds the link text that says nothing', has(v1, /WCAG 2\.4\.4/));
check('it finds the missing unsubscribe', has(v1, /CAN-SPAM.*unsubscribe/i));
check('it warns on the over-long subject', has(v1, /Subject is \d+ characters/));
check('every finding names the standard it comes from',
  v1.every(x => x.standard && x.standard.length > 2));
check('every failing finding says what to do about it',
  v1.filter(x => x.severity === 'fail').every(x => x.fix && x.fix.length > 10));
check('the broken draft blocks the send', win.qaBlocks(v1) === true);
check('the corrected draft has nothing left at fail severity',
  win.qaCounts(v2).fail === 0, JSON.stringify(v2.filter(x => x.severity === 'fail')));
check('and nothing left at warn severity either', win.qaCounts(v2).warn === 0,
  JSON.stringify(v2.filter(x => x.severity === 'warn')));
check('so the corrected draft is cleared to send', win.qaBlocks(v2) === false);
check('a token that IS covered by a fallback is reported as a pass, not silence',
  v2.some(x => x.severity === 'pass' && /fallback covers/.test(x.what)));

console.log('\nAND CATCHES THE CHANNEL-SPECIFIC ONES');
const sms1 = win.qaSms(FX.SMS_V1, people), sms2 = win.qaSms(FX.SMS_V2, people);
check('SMS without a STOP instruction fails on TCPA', has(sms1, /TCPA.*STOP/));
check('SMS length is measured on the longest PERSONALIZED render, not the template',
  sms1.some(x => /Longest personalized render is \d+/.test(x.what)));
check('a two-segment message is called out as costing twice', has(sms1, /2 GSM-7 segments/));
check('the corrected SMS clears', win.qaBlocks(sms2) === false);
check('and fits in one segment', sms2.some(x => /1 GSM-7 segment/.test(x.what)));
const p1 = win.qaPush(FX.PUSH_V1, people), p2 = win.qaPush(FX.PUSH_V2, people);
check('a push with no deep link fails', has(p1, /Deep link/));
check('an over-long push title is flagged for truncation', has(p1, /Title is \d+ characters/));
check('the corrected push clears', win.qaBlocks(p2) === false);
check('an image-only email is caught, which is the commonest failure of all',
  has(win.qaEmail({ channel: 'email', subject: 'x', html: '<img src="a.png" alt="all of it">' }, people), /carried almost entirely by images/));

/* ---------------------------------------------------------------- journey */
console.log('\nTHE JOURNEY, AND A CAP THAT COUNTS ITS OWN SENDS');
const sim = win.journeySim(FX.FAN_JOURNEY, {});
const sends = sim.steps.filter(s => s.type === 'send');
check('everyone who matched the entry rules entered', sim.entered > 0);
check('it ran every send node', sends.length === 4);
check('no node sends to more people than were eligible for it',
  sends.every(s => s.sent <= s.eligible));
check('every node itemises who it held back',
  sends.every(s => s.reasons.reduce((a, x) => a + x.count, 0) === s.suppressed));
check('nobody converts without having clicked, and nobody clicks without opening',
  sends.every(s => s.converted <= s.clicked && s.clicked <= s.opened));
const firstEmail = sends[0], lastEmail = sends[3];
const capOf = s => (s.reasons.filter(r => /Frequency cap/.test(r.reason))[0] || { count: 0 }).count;
check('the frequency cap removes more people at the LAST send than the first, because the '
  + 'journey now counts its own earlier messages (' + capOf(firstEmail) + ' then ' + capOf(lastEmail) + ')',
  capOf(lastEmail) > capOf(firstEmail));
check('an SMS node still refuses anyone without SMS consent, mid-journey',
  sends[1].reasons.some(r => /No SMS consent/.test(r.reason)));
check('running the same journey twice gives the same result',
  JSON.stringify(win.journeySim(FX.FAN_JOURNEY, {})) === JSON.stringify(sim));
check('lifting the cap can only ever let more messages through',
  win.journeySim(FX.FAN_JOURNEY, { cap: null }).steps.filter(s => s.type === 'send')
    .reduce((a, s) => a + s.sent, 0) > sends.reduce((a, s) => a + s.sent, 0));
check('revenue is only ever attributed to fans who actually converted',
  sim.converted === 0 ? sim.revenue === 0 : sim.revenue > 0);
check('recovered lifetime value cannot exceed the value in the segment',
  sim.ltvRecovered <= sim.ltvAtRisk);

/* -------------------------------------------------------------------- A/B */
console.log('\nTHE A/B GUARD REFUSES TO BE PEEKED AT');
check('probit is accurate at the value every calculator uses', near(win.probit(0.975), 1.959964, 1e-5));
check('and at 80% power', near(win.probit(0.80), 0.841621, 1e-5));
const plan = win.abSampleSize(0.04, 0.20);
check('sample size for a 20% lift on a 4% baseline is about 10,300 per arm (' + plan.perArm + ')',
  near(plan.perArm, 10300, 250));
check('a smaller effect needs a bigger sample', win.abSampleSize(0.04, 0.05).perArm > plan.perArm);
check('more power needs a bigger sample', win.abSampleSize(0.04, 0.20, 0.05, 0.95).perArm > plan.perArm);
check('an impossible test returns nothing rather than a number', win.abSampleSize(0.04, 0) === null);
const early = win.abVerdict({ n: 400, conv: 16 }, { n: 400, conv: 30 }, plan);
check('it refuses to name a winner before the planned sample size', early.decided === false && !early.winner);
check('even when the p value is already under 0.05 (p = ' + early.p.toFixed(4) + ')', early.p < 0.05);
check('and it says why, in words a marketer would accept', /peeking/.test(early.reason) && early.reason.length > 120);
check('it reports how far along the test actually is', near(early.progress, 400 / plan.perArm, 0.001));
const done = win.abVerdict({ n: plan.perArm, conv: Math.round(plan.perArm * 0.040) },
                           { n: plan.perArm, conv: Math.round(plan.perArm * 0.049) }, plan);
check('at the planned size it will decide', done.decided === true && done.winner === 'B');
const tie = win.abVerdict({ n: plan.perArm, conv: Math.round(plan.perArm * 0.04) },
                          { n: plan.perArm, conv: Math.round(plan.perArm * 0.0401) }, plan);
check('and calling no difference is treated as a real result, not a failure',
  tie.decided === true && tie.winner === null && /ship whichever is cheaper/.test(tie.reason));

console.log('\nAND THE COST OF PEEKING IS MEASURED, NOT ASSERTED');
const pk5 = win.peekingCost({ trials: 3000, looks: 5, perArm: 2000, baseline: 0.04 });
check('an A/A test at a fixed horizon sits on its nominal 5% (' + (pk5.atPlannedEnd * 100).toFixed(1) + '%)',
  near(pk5.atPlannedEnd, 0.05, 0.02));
check('but stopping at the first significant look roughly triples it (' + (pk5.ifPeeking * 100).toFixed(1) + '%)',
  pk5.ifPeeking > pk5.atPlannedEnd * 2);
const pk10 = win.peekingCost({ trials: 3000, looks: 10, perArm: 2000, baseline: 0.04 });
check('and more looks cost more (' + (pk10.ifPeeking * 100).toFixed(1) + '% at ten looks)',
  pk10.ifPeeking > pk5.ifPeeking);
check('the simulation reproduces from its seed',
  win.peekingCost({ trials: 500, looks: 5, perArm: 2000, baseline: 0.04 }).ifPeeking
  === win.peekingCost({ trials: 500, looks: 5, perArm: 2000, baseline: 0.04 }).ifPeeking);

/* ------------------------------------------------------------- the screens */
console.log('\nEVERY SCREEN RENDERS, AND SAYS THE DATA IS INVENTED');
['fanreq', 'fanseg', 'fanbuild', 'fanqa', 'fandeploy', 'fanmeasure', 'fanplan'].forEach(id => {
  win.goTool(id);
  const txt = win.document.getElementById('main').textContent || '';
  check(id + ' renders', txt.length > 600);
  check(id + ' leaks no undefined, NaN or [object Object]',
    !/\bundefined\b|\bNaN\b|\[object Object\]/.test(txt),
    (/\bundefined\b|\bNaN\b|\[object Object\]/.exec(txt) || [''])[0]);
  check(id + ' is highlighted in the sidebar',
    (win.document.querySelector('.nav-item.active') || { dataset: {} }).dataset.tool === id);
});
['fanreq', 'fanseg', 'fanbuild', 'fanqa', 'fandeploy', 'fanmeasure', 'fanplan'].forEach(id => {
  win.goTool(id);
  const txt = win.document.getElementById('main').textContent || '';
  check(id + ' labels the dataset as synthetic on screen',
    /[Ss]ynthetic/.test(txt), 'no synthetic label');
});
/* A wide table inside a card that has overflow:hidden is not merely ugly on a phone, it is
   CLIPPED: the rows past the fold cannot be reached at all. Caught in a 375px pass on the
   suppression-reasons table, which was the one table not wrapped in a scroller. */
console.log('\nNO TABLE IS TRAPPED INSIDE A CLIPPING CARD');
['fanreq', 'fanseg', 'fanbuild', 'fanqa', 'fandeploy', 'fanmeasure', 'fanplan'].forEach(id => {
  win.goTool(id);
  const tables = Array.prototype.slice.call(win.document.querySelectorAll('#main .fe-tbl'));
  const loose = tables.filter(tb => !tb.closest('.fe-scroll'));
  check(id + ': every wide table sits in a horizontal scroller (' + tables.length + ' tables)',
    loose.length === 0, loose.length + ' unwrapped');
});

/* On a laptop the sidebar is roughly twice the height of the viewport, so a group at the
   bottom of it is invisible until you scroll. This is the feature the suite gets shown for;
   it does not get to be the one you have to hunt for on a shared screen. */
console.log('\nTHE GROUP IS ABOVE THE FOLD, NOT AT THE BOTTOM OF THE SIDEBAR');
const navOrder = Array.prototype.slice.call(win.document.querySelectorAll('.sidebar .nav-item'))
  .map(el => el.dataset.tool);
check('the fan group sits before the marketing program in the sidebar',
  navOrder.indexOf('fanreq') < navOrder.indexOf('audit'), navOrder.join(','));
check('and before the any-time tools', navOrder.indexOf('fanreq') < navOrder.indexOf('outreach'));
check('only Today and Meeting Mode come above it', navOrder.indexOf('fanreq') === 2, String(navOrder.indexOf('fanreq')));
check('all seven are together, in order',
  navOrder.slice(2, 9).join(',') === 'fanreq,fanseg,fanbuild,fanqa,fandeploy,fanmeasure,fanplan', navOrder.slice(2, 9).join(','));

win.goTool('fanreq');
const reqTxt = win.document.getElementById('main').textContent || '';
check('the request screen states plainly that this is not Adobe experience',
  /not Adobe Experience Platform/.test(reqTxt) && /should be read as experience operating them/.test(reqTxt));
check('and names what was deliberately not attempted',
  /Deliberately not attempted/.test(reqTxt) && /propensity/.test(reqTxt));
check('the fictional club is named as fictional', /fictional/.test(reqTxt));

/* --------------------------------------------------------- the work seam */
console.log('\nFINDINGS BECOME TRACKED WORK, AND THE COUNT IS HONEST');
/* Tracked work is keyed per business by planKey(). With none loaded it writes to
   gr_plan_none, which nothing reads again the moment a business IS set up: the button
   would report "Filed 14 to Today", Today would show the onboarding wizard instead, and
   the work would be stranded. So the control is off until there is somewhere to file to. */
win.eval('clearBrand(); hydratePlan();');
win.goTool('fanqa');
check('with no business loaded, filing work is refused rather than silently lost',
  win.document.getElementById('feFile').disabled === true);
check('and the screen says why instead of offering a dead control',
  /tracked work is kept per business/i.test(win.document.getElementById('main').textContent));
check('but the screens themselves still work without one, because they carry their own audience',
  (win.document.querySelector('.fe-gatebig').textContent || '').length > 30);
win.saveBrand({ name: 'Harborline FC', industry: 'Sport', offerings: ['Season tickets'], audiences: ['Fans'], goals: ['Renewals'], proof: [] });
win.eval('hydratePlan();');
win.goTool('fanqa');
check('with a business loaded, it turns on', win.document.getElementById('feFile').disabled === false);
win.eval('PLAN = blankPlan();');
win.goTool('fanqa');
win.document.querySelector('[data-feqav="0"]').click();
const failCount = ['Email', 'SMS', 'Push'].reduce((a, k) => {
  const T = { Email: FX.EMAIL_V1, SMS: FX.SMS_V1, Push: FX.PUSH_V1 }[k];
  return a + win.qaRun(T, people).filter(x => x.severity === 'fail').length;
}, 0);
win.document.getElementById('feFile').click();
const filedItems = win.eval('PLAN.items').filter(i => i.source === 'fan');
check('every failing finding becomes a separate job (' + filedItems.length + ' of ' + failCount + ')',
  filedItems.length === failCount, filedItems.length + ' != ' + failCount);
check('two elements failing the same check are two jobs, not one deduplicated into nothing',
  filedItems.filter(i => /Contrast is/.test(i.title)).length >= 2);
check('and the button reports what actually landed, not what was attempted',
  win.document.getElementById('feFile').textContent === 'Filed ' + filedItems.length + ' to Today',
  win.document.getElementById('feFile').textContent);
check('each job carries the standard it came from', filedItems.every(i => /WCAG|CAN-SPAM|TCPA|Personalization|Link|Journey/.test(i.detail)));
check('and what to do about it', filedItems.every(i => /Fix: \S/.test(i.detail)));
check('they are filed as coming from the fan engagement work', filedItems.every(i => i.source === 'fan'));

/* -------------------------------------------------------------- the focus */
console.log('\nTHE SECTION DECLARES ITS FOCUS RATHER THAN ASSUMING ONE');
check('the focus is sports, and it is the one that is built',
  FX.FAN_FOCUS.id === 'sports' && FX.FAN_FOCUS.built === true);
check('it separates what is vertical-neutral from what is not',
  FX.FAN_FOCUS.neutral.length >= 5 && FX.FAN_FOCUS.specific.length >= 4);
check('and does not claim a primitive as domain-specific, or the reverse',
  FX.FAN_FOCUS.neutral.every(x => FX.FAN_FOCUS.specific.indexOf(x) < 0));
win.goTool('fanreq');
const reqT = win.document.getElementById('main').textContent;
check('the focus is stated on the first screen', /Sports, a club with a season ticket base/.test(reqT));

/* ------------------------------------------------------- the two axes */
console.log('\nTHE ESCALATOR AND THE CONTINUUM ARE DERIVED, NOT DRAWN');
const rungs = {}; A.forEach(f => rungs[f.rung] = (rungs[f.rung] || 0) + 1);
check('every fan sits on exactly one rung', Object.values(rungs).reduce((a, b) => a + b, 0) === A.length);
check('every lapsed holder is on the lapsed rung, so the two can never contradict',
  A.filter(f => f.lapsed).every(f => f.rung === 'Lapsed season ticket'));
check('nobody on a light rung is also a current season ticket holder',
  A.filter(f => f.rung === 'Light attender').every(f => !f.sthEver || f.lapsed));
check('the base is a pyramid: the lightest rungs outnumber the committed ones',
  (rungs['Light attender'] || 0) + (rungs['Aware, not attending'] || 0) > (rungs['Season ticket holder'] || 0));
const stages = {}; A.forEach(f => stages[f.stage] = (stages[f.stage] || 0) + 1);
check('the continuum has all four stages', Object.keys(stages).length === 4);
check('and thins out towards allegiance, which is what a continuum does',
  stages['Awareness'] > stages['Attraction'] && stages['Attraction'] > stages['Attachment'] && stages['Attachment'] > stages['Allegiance']);
const medSpend = s => { const v = A.filter(f => f.stage === s).map(f => f.spend).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
check('the stages actually discriminate on value (' + medSpend('Allegiance') + ' vs ' + medSpend('Awareness') + ')',
  medSpend('Allegiance') > medSpend('Awareness') * 5);
check('both axes are segmentable', !!FX.FAN_FIELDS.rung && !!FX.FAN_FIELDS.stage);
check('derived fields survive regeneration unchanged',
  (function () { win.eval('FANS=null;'); const C = win.fans(); return C[500].rung === A[500].rung && C[500].stage === A[500].stage; })());

/* --------------------------------------------------- result-contingent timing */
console.log('\nTHE SCORE MOVES THE PULL, NEVER THE GUARD');
const jWin = win.journeySim(FX.FAN_JOURNEY, { birg: 'win' });
const jNone = win.journeySim(FX.FAN_JOURNEY, { birg: 'none' });
const jLoss = win.journeySim(FX.FAN_JOURNEY, { birg: 'loss' });
const n1 = s => s.steps.filter(x => x.type === 'send')[0];
check('opens are higher after a win and lower after a loss ('
  + n1(jWin).opened + ' / ' + n1(jNone).opened + ' / ' + n1(jLoss).opened + ')',
  n1(jWin).opened > n1(jNone).opened && n1(jNone).opened > n1(jLoss).opened);
check('renewals follow (' + jWin.converted + ' / ' + jNone.converted + ' / ' + jLoss.converted + ')',
  jWin.converted > jLoss.converted);
/* The important one. Whether somebody may lawfully be contacted has nothing to do with
   Saturday's result, so at the first send, before anything downstream has happened, the
   guard must produce byte-identical numbers whichever way the match went. */
check('at the first send the guard is completely score-blind',
  n1(jWin).eligible === n1(jLoss).eligible && n1(jWin).sent === n1(jLoss).sent
  && n1(jWin).suppressed === n1(jLoss).suppressed
  && JSON.stringify(n1(jWin).reasons) === JSON.stringify(n1(jLoss).reasons));
check('the assumed magnitude is far more conservative than the effect in the paper',
  FX.BIRG.win.open < 1.3, String(FX.BIRG.win.open));
check('and every setting carries a note saying whether it was measured',
  Object.keys(FX.BIRG).every(k => /assum|baseline/i.test(FX.BIRG[k].note)));
win.goTool('fandeploy');
check('the deploy screen states it is an assumption rather than a measurement',
  /assumption/i.test(win.document.getElementById('main').textContent));

/* ------------------------------------------------------ the standards */
console.log('\nTHE THINKING IT IS HELD TO IS NAMED, AND THE GAPS ARE ADMITTED');
check('six standards are carried', FX.FAN_STANDARDS.length === 6);
check('each names a person, a work, what it says, and what this build does about it',
  FX.FAN_STANDARDS.every(s => s.who && s.work && s.says.length > 60 && s.here.length > 60));
const fader = FX.FAN_STANDARDS.filter(s => /Fader/.test(s.who))[0];
check('the lifetime value standard is cited AND the gap to it is admitted, not papered over',
  /does NOT meet it/.test(fader.here));
const sharp = FX.FAN_STANDARDS.filter(s => /Sharp/.test(s.who))[0];
check('the counterweight is carried as a challenge to the build, not a footnote',
  /counterweight/i.test(sharp.here) && /warns/.test(sharp.here));

/* ------------------------------------------------------- how to read it */
console.log('\nEVERY SCREEN EXPLAINS ITSELF');
const SCREENS = ['fanreq', 'fanseg', 'fanbuild', 'fanqa', 'fandeploy', 'fanmeasure', 'fanplan'];
SCREENS.forEach(id => {
  const g = FX.FAN_GUIDE[id];
  check(id + ' says what it does, what it breaks down, and how to read it',
    !!g && g.does.length > 60 && g.breaks.length > 40 && g.read.length >= 3);
  check(id + ' gives every reading note a heading and an explanation',
    g.read.every(r => r.length === 2 && r[0].length > 8 && r[1].length > 40));
  win.goTool(id);
  const panel = win.document.querySelector('#main .fe-guide');
  check(id + ' renders the panel', !!panel && (panel.textContent || '').length > 300);
});
/* Typed as "of 6" while a seventh screen existed, which put a small lie on every screen
   at once. Counted from the screens that actually exist now. */
check('the step count is derived from the screens, not typed',
  win.fanSteps() === SCREENS.length, String(win.fanSteps()));
SCREENS.forEach((id, i) => {
  win.goTool(id);
  const lab = (win.document.querySelector('#main .fe-step') || {}).textContent || '';
  check(id + ' labels itself step ' + (i + 1) + ' of ' + SCREENS.length,
    lab === 'Fan engagement, step ' + (i + 1) + ' of ' + SCREENS.length, lab);
});
check('every standard a screen cites actually exists in the registry',
  SCREENS.every(id => (FX.FAN_GUIDE[id].held || []).every(w => FX.FAN_STANDARDS.some(s => s.who === w))));

/* --------------------------------------------------------- the plan */
console.log('\nTHE PLAN IS READ OUT OF THE ENGINE, NOT WRITTEN');
win.eval('window.__P = operatingPlan();');
const PL = win.__P;
check('it covers day one through continuous', PL.phases.length === 6);
check('the phases are in time order',
  PL.phases.map(p => p.when).join('|') === 'Day one|Week one|First 30 days|60 days|90 days|Continuous');
check('every item says what to do and why', PL.phases.every(p => p.items.length >= 3
  && p.items.every(i => i.what.length > 15 && i.why.length > 60)));
check('almost every item carries its evidence',
  PL.phases.reduce((a, p) => a + p.items.filter(i => i.evidence).length, 0)
  >= PL.phases.reduce((a, p) => a + p.items.length, 0) - 1);
/* The claim the whole screen rests on: these numbers are not restated, they are read. */
const liveSeg = win.evalSegment(FX.FAN_SEGMENT_RULES, 'email', {});
check('the plan reports the SAME segment the segment screen does',
  PL.seg.matched === liveSeg.matched && PL.seg.reachable === liveSeg.reachable);
check('and the same QA failure count the QA screen shows',
  PL.qa.fails === ['Email', 'SMS', 'Push'].reduce((a, k) => a + win.qaRun(
    { Email: FX.EMAIL_V1, SMS: FX.SMS_V1, Push: FX.PUSH_V1 }[k], liveSeg.people)
    .filter(x => x.severity === 'fail').length, 0));
check('day one refuses to let anything send while QA is failing',
  /Close the \d+ finding/.test(PL.phases[0].items[0].what));
check('and asks for a holdout, without which the campaign takes credit for renewals it did not cause',
  PL.phases[0].items.some(i => /control group/i.test(i.what)));

console.log('\nAND IT ARGUES WITH ITSELF');
check('the penetration counterweight is present and says this campaign adds no new fans',
  /entirely retention/.test(PL.penetration.verdict) && /cannot add a single new fan/.test(PL.penetration.verdict));
check('it quantifies how much of the base the campaign never touches',
  PL.penetration.addressedPct > 0 && PL.penetration.addressedPct < 0.2);
check('the feasibility check states a number of weeks',
  PL.feasibility && typeof PL.feasibility.weeks === 'number' && PL.feasibility.weeks > 0);
check('and refuses the test when the audience cannot deliver it in the window ('
  + PL.feasibility.weeks + ' weeks)',
  PL.feasibility.weeks > 6 ? (PL.feasibility.feasible === false && /honest decision is to not run/.test(PL.feasibility.verdict)) : PL.feasibility.feasible === true);
check('a bigger audience makes the same test feasible',
  win.abFeasibility(PL.abPlan, 40000, 1).feasible === true);
check('it ends with what it cannot tell you', PL.unknowns.length >= 5);
check('including that the data is synthetic and the LTV is not a fitted model',
  PL.unknowns.some(u => /synthetic/i.test(u[0])) && PL.unknowns.some(u => /not a fitted model/i.test(u[0])));
check('and that the result-contingent lift is assumed rather than measured',
  PL.unknowns.some(u => /assumed/i.test(u[0])));

console.log('\nTHE EXPORT IS SOMETHING YOU CAN PASTE INTO A TICKET');
const txt = win.planText(PL);
check('it is plain text with no markup', !/<[a-z/][^>]*>/i.test(txt));
check('it carries every phase', PL.phases.every(p => txt.indexOf(p.when.toUpperCase()) >= 0));
check('it carries the counterweight and the boundary',
  /THE COUNTERWEIGHT/.test(txt) && /WHAT THIS CANNOT TELL YOU/.test(txt));
check('it names the thinking it was held to', /HELD TO/.test(txt) && /Mullin/.test(txt) && /Kohavi/.test(txt));
check('it is long enough to be a real document (' + txt.length + ' chars)', txt.length > 4000);

/* ---------------------------------------------------------------- hygiene */
console.log('\nNOTHING IN HERE SHOULD EMBARRASS A PUBLIC REPO');
/* The real passcode is never written down here. This asserts against a decoy, and then
   proves the decoy is genuinely absent, which is the lesson from putting the live value
   in a public commit once already. */
const DECOY = 'NOT-THE-REAL-PASSCODE';
const fanBlock = html.slice(html.indexOf('FAN ENGAGEMENT\n'), html.indexOf('/* Refine dock wiring.'));
check('the fan engagement code contains no passcode literal', fanBlock.indexOf(DECOY) === -1);
check('and no live-looking API key', !/sk-[A-Za-z0-9_-]{16,}/.test(fanBlock));
check('the club in the data is fictional', FX.FAN_CLUB === 'Harborline FC');
/* Adobe IS named in this block, and must be: the honesty statement says plainly that this
   is not their platform. What must never appear is a vendor named as if it were experience. */
check('no martech vendor is named except in the statement of what this is not',
  !/epsilon|movable ink|attentive|braze|salesforce marketing cloud/i.test(fanBlock));
check('and the one vendor named is named only to disclaim it',
  /not Adobe Experience Platform/.test(fanBlock));
check('sample email addresses use the reserved example.com', A.slice(0, 200).every(f => /@example\.com$/.test(f.email)));
check('every guardrail in the brief is a sentence somebody could audit',
  FX.FAN_BRIEF.guardrails.length >= 4 && FX.FAN_BRIEF.guardrails.every(g => g.length > 40));

console.log('\n--------------------------------------------------------------');
console.log(pass + ' passed, ' + fail + ' failed');
console.log('\nA segment that cannot say who it removed is not a segment.');
if (fail) process.exit(1);
