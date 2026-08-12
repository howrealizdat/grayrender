/**
 * Grayrender AI Marketing Suite — image generation for LinkedIn posts.
 *
 * Uses OPENAI_API_KEY (Netlify env var, server-only — never exposed to the browser).
 * Gated the same way as generate.js: only callers with the SITE_PASSCODE
 * can spend on images, so preview visitors can't run up your OpenAI bill.
 *
 * If OPENAI_API_KEY isn't set, it returns a friendly {error:'no_key'} so the app
 * can tell you to add it — nothing breaks.
 */

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors(), body: '' };
  }
  try {
    const { prompt, userPrompt, passcode } = JSON.parse(event.body || '{}');

    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return json(200, { error: 'no_key' });
    }

    /* ---- THE SITE PASSCODE -------------------------------------------------
       One lock for the whole product. The passcode lives ONLY in the Netlify env
       var SITE_PASSCODE and never in this repo, which is public. Checked before
       any model call or page fetch, so a locked visitor costs nothing.
       FAILS CLOSED: if SITE_PASSCODE is unset, nothing runs. An unset secret must
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

    if (!prompt) {
      return json(400, { error: 'missing_prompt' });
    }

    const NOTEXT = ' No text, no words, no letters, no logos, no watermarks.';
    let imgPrompt;
    const custom = (userPrompt || '').trim();
    if (custom) {
      // The user typed exactly what they want — honor it.
      imgPrompt = 'Professional, photorealistic editorial photograph. ' + custom.slice(0, 400) +
        ' High quality, natural lighting, cinematic.' + NOTEXT;
    } else {
      // Auto-match: rotate the composition AND the people shown so it isn't the same
      // shot every time. Some scenes have no people at all, for variety.
      const scenes = [
        'a diverse group of colleagues collaborating in a bright modern office',
        'a candid over-the-shoulder shot of one professional working at a laptop by a sunny window',
        'two coworkers discussing ideas at a glass whiteboard',
        'a wide, airy open-plan tech office with a few people working',
        'a small team reviewing something on a large screen in a meeting room',
        'a close-up of hands typing on a laptop, blurred office in the background',
        'a confident professional presenting to a few seated colleagues',
        'a clean, abstract visual of technology, data and connection (no people)',
        'a modern city skyline at golden hour through office windows (no people)',
        'a single professional walking through a sleek company lobby'
      ];
      const scene = scenes[Math.floor(Math.random() * scenes.length)];
      imgPrompt = 'Professional, photorealistic editorial photograph for a LinkedIn post about ' +
        String(prompt).slice(0, 200) + '. Scene: ' + scene +
        '. When people appear, show a genuine mix of ages, genders, ethnicities and body types across the frame — never a single default look. ' +
        'Natural lighting, cinematic, high quality.' + NOTEXT;
    }

    // Try the best model the account has access to. Different OpenAI accounts
    // expose different image models — fall through to the next only when a model
    // is unavailable; stop immediately on real errors (billing, content policy).
    // 'low' quality keeps gpt-image-1 fast enough to finish inside Netlify's
    // function timeout (~26s) while still looking photographic.
    const models = [
      { name: 'gpt-image-1', extra: { quality: 'low' } },
      { name: 'dall-e-3', extra: {} },
      { name: 'dall-e-2', extra: {} }
    ];
    let lastErr = 'Image generation failed';
    for (let m = 0; m < models.length; m++) {
      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ model: models[m].name, prompt: imgPrompt, n: 1, size: '1024x1024' }, models[m].extra))
      });
      const data = await r.json();
      if (r.ok) {
        const item = data && data.data && data.data[0];
        // Either shape: inline base64 (gpt-image-1) or a hosted URL (dall-e).
        const img = item ? (item.b64_json ? 'data:image/png;base64,' + item.b64_json : item.url) : null;
        if (img) return json(200, { image: img, model: models[m].name });
        lastErr = 'No image returned';
      } else {
        lastErr = (data && data.error && data.error.message) || lastErr;
        if (!/does not exist|not available|must be verified|do not have access|unsupported|invalid model/i.test(lastErr)) break;
      }
    }
    return json(502, { error: 'openai_error', message: lastErr });
  } catch (err) {
    console.error('[image] error:', err && err.message);
    return json(500, { error: 'server_error', message: (err && err.message) || 'Image failed' });
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
function json(statusCode, obj) {
  return { statusCode, headers: Object.assign({ 'Content-Type': 'application/json' }, cors()), body: JSON.stringify(obj) };
}
