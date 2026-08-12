/**
 * The lock.
 *
 * This exists because of a real exposure. Before the rewrite, generate.js used ACCESS_CODE
 * only to TRUNCATE the response: a caller with no credentials at all still reached the model
 * and still billed the account. Probed live on 2026-08-11 with no code of any kind, the
 * deployed function happily returned a generated tagline. `locked: true` in that response
 * meant "we cut the output", not "we refused the work".
 *
 * So the rule this file enforces is not "the output is hidden". It is:
 *
 *      AN UNAUTHENTICATED CALLER MUST NEVER REACH A PAID API.
 *
 * Every case below sets a deliberately BOGUS ANTHROPIC_API_KEY. If a handler ever gets past
 * the gate it will fail on that key and return 5xx. A clean 403 is therefore proof that the
 * request was refused before anything was spent.
 *
 * Run:  node test/passcode.test.js
 */
// A deliberately fake value. NEVER put the real passcode in this file: the repo is public,
// so a fixture here would publish the very secret the gate exists to protect.
process.env.SITE_PASSCODE = 'OPEN-SESAME-TEST-ONLY';
process.env.ANTHROPIC_API_KEY = 'sk-ant-INVALID-if-this-is-used-the-gate-leaked';
process.env.OPENAI_API_KEY = 'sk-INVALID-if-this-is-used-the-gate-leaked';

const generate = require('../netlify/functions/generate.js');
const audit = require('../netlify/functions/audit.js');
const image = require('../netlify/functions/image.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}
const call = (fn, body) => fn.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });

const FULL_GEN = { systemPrompt: 'x', userMessage: 'y', tool: 't' };

(async () => {
  console.log('\nNO CREDENTIALS  (the exposure that shipped: a stranger must not reach the model)');
  for (const [label, fn, body] of [
    ['generate', generate, FULL_GEN],
    ['audit',    audit,    { mode: 'discover', url: 'https://example.com' }],
    ['image',    image,    { prompt: 'a red circle' }]
  ]) {
    const r = await call(fn, body);
    check(label + ' refuses with 403', r.statusCode === 403, 'got ' + r.statusCode + ' ' + String(r.body).slice(0, 120));
    const j = JSON.parse(r.body || '{}');
    check(label + ' says locked and returns no content', j.locked === true && !j.result,
      JSON.stringify(j).slice(0, 140));
  }

  console.log('\nWRONG PASSCODE');
  for (const [label, fn, body] of [
    ['generate', generate, Object.assign({ passcode: 'wrong-value-here' }, FULL_GEN)],
    ['audit',    audit,    { mode: 'discover', url: 'https://example.com', passcode: 'wrong-value-here' }],
    ['image',    image,    { prompt: 'a red circle', passcode: 'wrong-value-here' }]
  ]) {
    const r = await call(fn, body);
    check(label + ' refuses a wrong passcode', r.statusCode === 403, 'got ' + r.statusCode);
  }

  console.log('\nNEAR MISSES  (forgiving on formatting, strict on the actual value)');
  const variants = [['OPEN-SESAME-TEST-ONLY', true], ['open-sesame-test-only', true],
                    ['OPEN-SESAME-TEST -ONLY', true], ['  Open-Sesame-Test-Only  ', true],
                    // Whitespace is REMOVED, not treated as a separator: a newline standing
                    // where a hyphen belongs is a different value, and must not pass.
                    ['OPEN\nSESAME-TEST-ONLY', false],
                    ['OPEN-SESAME-TEST', false], ['OPENSESAMETESTONLY', false],
                    ['', false], ['OPEN-SESAME-TEST-ONLY2', false], [null, false]];
  for (const [v, shouldPass] of variants) {
    const r = await call(audit, { mode: 'brand', validateOnly: true, passcode: v });
    const ok = r.statusCode === 200;
    check(`${JSON.stringify(v)} ${shouldPass ? 'accepted' : 'rejected'}`, ok === shouldPass,
      'status ' + r.statusCode);
  }

  console.log('\nFAIL CLOSED  (an unset secret must never mean "open to everyone")');
  const saved = process.env.SITE_PASSCODE;
  delete process.env.SITE_PASSCODE;
  for (const [label, fn, body] of [
    ['generate', generate, Object.assign({ passcode: 'OPEN-SESAME-TEST-ONLY' }, FULL_GEN)],
    ['audit',    audit,    { mode: 'discover', url: 'https://example.com', passcode: 'OPEN-SESAME-TEST-ONLY' }],
    ['image',    image,    { prompt: 'a red circle', passcode: 'OPEN-SESAME-TEST-ONLY' }]
  ]) {
    const r = await call(fn, body);
    const j = JSON.parse(r.body || '{}');
    check(label + ' locks itself when no passcode is configured',
      r.statusCode === 403 && j.reason === 'unset', 'got ' + r.statusCode + ' ' + JSON.stringify(j).slice(0, 100));
  }
  process.env.SITE_PASSCODE = saved;

  console.log('\nTHE RIGHT PASSCODE GETS THROUGH  (5xx here means it reached the bogus key, which is the point)');
  const r = await call(audit, { mode: 'brand', validateOnly: true, passcode: 'OPEN-SESAME-TEST-ONLY' });
  check('a correct passcode is accepted', r.statusCode === 200 && JSON.parse(r.body).ok === true,
    'got ' + r.statusCode + ' ' + String(r.body).slice(0, 120));

  console.log('\n' + '-'.repeat(62));
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('\nTHE LOCK IS OPEN. Do not deploy.\n'); process.exit(1); }
  console.log('\nNothing reaches a paid API without the passcode.\n');
})();
