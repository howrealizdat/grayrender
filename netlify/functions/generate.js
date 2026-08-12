const Anthropic = require('@anthropic-ai/sdk');

/**
 * Grayrender AI Marketing Suite — API proxy + usage logger.
 *
 * SECURITY: the Anthropic key lives ONLY in the Netlify env var ANTHROPIC_API_KEY.
 * Delete that var (or this function) and the whole tool goes dead. That is the kill switch.
 *
 * TRACKING: every generation is logged so you can see exactly what the tool is used for.
 *   1. console.log  -> always visible in Netlify dashboard: Functions -> generate -> Logs
 *   2. LOG_WEBHOOK_URL (optional env var) -> live alert of every OUTSIDE use.
 *      Works with a Discord webhook, a Slack webhook, or any endpoint that accepts JSON.
 *
 * "OUTSIDE use" = anyone who is not you. You are skipped if either:
 *   - the request IP is listed in OWNER_IP (comma-separated env var), OR
 *   - the browser is flagged as owner (visit the site once with ?owner=1 per device).
 * Every use is still logged to the console regardless; only the alert is filtered.
 */

exports.handler = async function (event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  try {
    const { systemPrompt, userMessage, tool, inputs, passcode, owner, maxTokens } = JSON.parse(event.body || '{}');

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

    if (!systemPrompt || !userMessage) {
      return json(400, { error: 'Missing systemPrompt or userMessage' });
    }

    // ---- who / what / when (for the usage log) ----
    const h = event.headers || {};
    const meta = {
      time: new Date().toISOString(),
      tool: tool || 'unknown',
      inputs: inputs || {},
      ip: h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || 'unknown',
      country: h['x-country'] || (event.geo && event.geo.country && event.geo.country.name) || 'unknown',
      userAgent: h['user-agent'] || 'unknown',
      referer: h['referer'] || 'direct'
    };

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      // Haiku 4.5: fast (~3-5s) and reliable for short marketing copy — avoids the
      // 13-16s reasoning latency (and occasional timeouts) of larger models. The
      // expert system prompts carry the quality.
      model: 'claude-haiku-4-5-20251001',
      /* Per-tool budget. 1500 is right for a cold email and nowhere near enough for a
         four-week calendar, which truncates mid-table and ships a half-built artefact.
         Clamped at 4096: past that the sync function starts flirting with the ~26-30s
         Netlify timeout, and a timeout is worse than a tight brief. */
      max_tokens: Math.min(Math.max(Number(maxTokens) || 1500, 500), 4096),
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });

    // Find the text block explicitly. Some models emit a leading reasoning/
    // thinking block, so content[0] is not guaranteed to be the text output.
    const textBlock = (message.content || []).find(function (b) { return b.type === 'text'; });
    const result = textBlock ? textBlock.text : '';
    if (!result) {
      return json(502, { error: 'Model returned no text content.' });
    }


    // ---- log the usage + alert on outside visitors (never blocks the response) ----
    logUsage(meta, message, { unlocked: true, owner: owner === true }).catch(() => {});

    return json(200, { result, locked: false });
  } catch (err) {
    console.error('[generate] error:', err && err.message);
    return json(500, { error: (err && err.message) || 'Generation failed' });
  }
};


function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(obj)
  };
}

function device(ua) {
  ua = ua || '';
  const b = /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome'
    : /Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android'
    : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : '';
  return os ? b + ' on ' + os : b;
}

async function logUsage(meta, message, ctx) {
  ctx = ctx || {};
  const usage = message && message.usage ? message.usage : {};
  const record = {
    ...meta,
    unlocked: ctx.unlocked === true,
    tokensIn: usage.input_tokens,
    tokensOut: usage.output_tokens
  };

  // 1) Always show up in Netlify function logs (owner or not)
  console.log('[USAGE]', JSON.stringify(record));

  // 2) Alert to a webhook — but ONLY for outside visitors (never for you).
  const hook = process.env.LOG_WEBHOOK_URL;
  if (!hook) return;
  const ownerIps = (process.env.OWNER_IP || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  const isOwner = ctx.owner === true || ownerIps.indexOf(record.ip) !== -1;
  if (isOwner) return; // it's you — don't alert

  const inputLines = Object.entries(record.inputs || {})
    .map(function (e) { return '• **' + e[0] + ':** ' + (e[1] || '(blank)'); })
    .join('\n');

  const access = record.unlocked ? 'FULL ACCESS (entered your code)' : 'Preview mode';
  const summary =
    '🔔 **Someone used your Grayrender demo** — `' + record.tool + '`\n' +
    '🔓 Access: **' + access + '**\n' +
    inputLines + '\n' +
    '🌍 ' + record.ip + ' (' + record.country + ')\n' +
    '💻 ' + device(record.userAgent) + '\n' +
    '🔗 ' + record.referer + '\n' +
    '🕒 ' + record.time;

  // Discord expects { content }, Slack expects { text }. Send both keys —
  // each platform reads the one it understands and ignores the other.
  await fetch(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: summary, text: summary })
  });
}
