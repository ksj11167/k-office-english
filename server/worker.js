/**
 * Translation proxy — the only backend this app has.
 *
 * The app is useless to anyone who will not paste an Anthropic key into a
 * settings screen, and nobody will. This takes the request, adds a key the
 * server holds, and forwards it. That is the whole job.
 *
 * The responsibility that comes with it is the part worth being careful about,
 * because someone's work chat goes through here:
 *
 *   - Nothing is logged. Not the prompt, not the reply, not on errors. The only
 *     thing written down is a per-day request count against a hash of the IP.
 *   - The IP is hashed with a server-side secret before it is stored, so the
 *     quota table cannot be read backwards into a list of who used the app.
 *   - Quotas are enforced before the upstream call, so an abusive client costs
 *     a KV read rather than a model call.
 *
 * Deploy: see server/README.md.
 */

const MAX_BODY = 200_000;          // ~a very long day of chat; refuse more
const MODELS = new Set(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']);

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return fail(405, 'method_not_allowed', cors);
    if (new URL(request.url).pathname !== '/translate') return fail(404, 'not_found', cors);
    if (!allowed(origin, env)) return fail(403, 'origin_not_allowed', cors);

    const raw = await request.text();
    if (raw.length > MAX_BODY) return fail(413, 'prompt_too_large', cors);

    let body;
    try { body = JSON.parse(raw); } catch { return fail(400, 'invalid_request', cors); }
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
      return fail(400, 'invalid_request', cors);
    }

    const quota = await spend(request, env);
    if (!quota.ok) {
      return fail(429, 'daily_limit', cors, { limit: quota.limit, resets: quota.resets });
    }

    const model = MODELS.has(body.model) ? body.model : (env.MODEL || 'claude-opus-5');

    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 8192,
          // Short conversational lines are not a reasoning problem. Thinking
          // stays on — disabling it on Opus 5 has its own failure modes — but
          // at the lowest effort, which is where this workload belongs.
          output_config: { effort: 'low' },
          messages: [{ role: 'user', content: body.prompt }],
        }),
      });
    } catch {
      return fail(502, 'upstream_error', cors);
    }

    if (!res.ok) {
      // The upstream body can quote the prompt back. Map to a code and drop it.
      const code = res.status === 401 ? 'not_granted'
        : res.status === 429 ? 'rate_limited'
        : res.status === 400 ? 'invalid_request'
        : 'upstream_error';
      return fail(res.status === 401 ? 500 : res.status, code, cors);
    }

    const data = await res.json();
    if (data.stop_reason === 'refusal') return fail(422, 'refused', cors);

    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return new Response(JSON.stringify({ text, remaining: quota.remaining }), {
      headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  },
};

function corsHeaders(origin, env) {
  return {
    'access-control-allow-origin': allowed(origin, env) ? origin : 'null',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

/** ALLOWED_ORIGINS is a comma-separated list; empty means "same-origin only". */
function allowed(origin, env) {
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return false;
  if (list.includes('*')) return true;
  return list.includes(origin);
}

function fail(status, code, cors, extra = {}) {
  return new Response(JSON.stringify({ error: code, ...extra }), {
    status,
    headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * One day's quota per caller, counted against a salted hash of the IP.
 *
 * Not an identity and not meant to be one — it resets daily and cannot be
 * reversed without QUOTA_SALT. It exists so one script cannot spend the month's
 * budget in an afternoon.
 */
async function spend(request, env) {
  const limit = Number(env.DAILY_LIMIT || 20);
  const resets = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (!env.QUOTA) return { ok: true, remaining: limit, limit, resets };   // unbound in dev

  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const day = new Date().toISOString().slice(0, 10);
  const key = 'q:' + day + ':' + await sha256(ip + '|' + (env.QUOTA_SALT || ''));

  const used = Number(await env.QUOTA.get(key)) || 0;
  if (used >= limit) return { ok: false, remaining: 0, limit, resets };

  // Expire with the day rather than accumulating keys forever.
  await env.QUOTA.put(key, String(used + 1), { expirationTtl: 172_800 });
  return { ok: true, remaining: limit - used - 1, limit, resets };
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
