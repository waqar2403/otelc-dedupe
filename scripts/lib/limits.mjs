// Cost control that survives serverless.
//
// The original limiter kept counters in a module-level Map. On one long-running
// process that is exactly right. On Vercel it is not a limit at all: every cold
// instance starts at zero, and a burst that spawns twenty instances gets twenty
// times the daily cap. With a $2-5 prepaid balance that is the difference
// between a budget and a suggestion.
//
// So the counters go in Redis when one is configured (Vercel KV and Upstash
// both speak the same REST protocol, and both have a free tier large enough),
// and fall back to the in-memory behaviour otherwise - with `durable: false`
// reported, so a deployment running without a store is visibly unprotected
// rather than silently so.

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const DURABLE = !!(KV_URL && KV_TOKEN);

/** USD per million tokens. Verified against api-docs.deepseek.com/quick_start/pricing
 *  on 2026-08-04. Cache hits are cheaper; charging the miss rate over-estimates,
 *  which is the correct direction for a spending cap. */
const PRICES = {
  'deepseek-v4-flash': { in: 0.14, out: 0.28 },
  'deepseek-v4-pro': { in: 0.435, out: 0.87 },
  'llama-3.1-8b-instant': { in: 0.05, out: 0.08 },
};
const FALLBACK_PRICE = { in: 0.50, out: 1.00 };

export function costOf(usage, model) {
  if (!usage) return 0;
  const p = PRICES[model] || FALLBACK_PRICE;
  return ((usage.prompt_tokens || 0) * p.in + (usage.completion_tokens || 0) * p.out) / 1e6;
}

// ---- in-memory fallback ----------------------------------------------------
const mem = { hits: new Map(), day: '', n: 0, spend: 0, month: '' };
const MEM_MAX_IPS = 5000;

function memCheck(ip, caps, day) {
  if (mem.day !== day) { mem.day = day; mem.n = 0; }
  const now = Date.now();
  const t = (mem.hits.get(ip) || []).filter((x) => now - x < 86400000);
  const hour = t.filter((x) => now - x < 3600000).length;
  t.push(now);
  mem.hits.set(ip, t);
  // The original Map grew without bound: one entry per IP, never evicted.
  if (mem.hits.size > MEM_MAX_IPS) {
    for (const [k, v] of mem.hits) {
      if (!v.length || now - v[v.length - 1] > 86400000) mem.hits.delete(k);
      if (mem.hits.size <= MEM_MAX_IPS) break;
    }
  }
  mem.n++;
  return { hour: hour + 1, day: t.length, global: mem.n };
}

// ---- redis-over-REST -------------------------------------------------------
async function pipeline(commands) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KV_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`kv ${res.status}`);
  const j = await res.json();
  return j.map((r) => r.result);
}

const stamps = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const day = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  return { day, hour: `${day}${p(d.getUTCHours())}`, month: day.slice(0, 6) };
};

/**
 * Fixed-window counters. Counts the attempt whether or not it is allowed, which
 * is what stops a caller who is already over the line from retrying for free.
 *
 * @returns {{ ok, msg?, usage: { hour, day, global }, durable, spend }}
 */
export async function claim(ip, caps) {
  const { day, hour, month } = stamps();
  const safeIp = String(ip).slice(0, 64).replace(/[^\w.:-]/g, '_');

  if (!DURABLE) {
    const u = memCheck(safeIp, caps, day);
    if (mem.month !== month) { mem.month = month; mem.spend = 0; }
    return verdict(u, mem.spend, caps, false);
  }

  try {
    const [h, , d, , g, , spendRaw] = await pipeline([
      ['INCR', `otelc:h:${hour}:${safeIp}`], ['EXPIRE', `otelc:h:${hour}:${safeIp}`, 7200],
      ['INCR', `otelc:d:${day}:${safeIp}`], ['EXPIRE', `otelc:d:${day}:${safeIp}`, 172800],
      ['INCR', `otelc:g:${day}`], ['EXPIRE', `otelc:g:${day}`, 172800],
      ['GET', `otelc:spend:${month}`],
    ]);
    return verdict(
      { hour: Number(h), day: Number(d), global: Number(g) },
      Number(spendRaw || 0),
      caps,
      true
    );
  } catch {
    // A store outage must not take the checker offline, but it also must not
    // silently remove the ceiling. Fall back to memory and say so.
    const u = memCheck(safeIp, caps, day);
    const v = verdict(u, mem.spend, caps, false);
    v.degraded = true;
    return v;
  }
}

function verdict(u, spend, caps, durable) {
  const base = { usage: u, durable, spend };
  if (spend >= caps.monthlyUsd) {
    return { ...base, ok: false, code: 'BUDGET', msg: 'monthly API budget reached. Send your own key as x-api-key to continue.' };
  }
  if (u.hour > caps.perIpHour) return { ...base, ok: false, code: 'RATE', msg: `rate limit: ${caps.perIpHour}/hour` };
  if (u.day > caps.perIpDay) return { ...base, ok: false, code: 'RATE', msg: `rate limit: ${caps.perIpDay}/day` };
  if (u.global > caps.globalDay) {
    return { ...base, ok: false, code: 'BUDGET', msg: 'daily budget reached. Send your own key as x-api-key to continue.' };
  }
  return { ...base, ok: true };
}

/** Charge a completed paid call against the monthly ceiling. */
export async function recordSpend(usd) {
  if (!usd) return;
  const { month } = stamps();
  if (!DURABLE) {
    if (mem.month !== month) { mem.month = month; mem.spend = 0; }
    mem.spend += usd;
    return;
  }
  try {
    await pipeline([
      ['INCRBYFLOAT', `otelc:spend:${month}`, usd.toFixed(6)],
      ['EXPIRE', `otelc:spend:${month}`, 5_184_000],
    ]);
  } catch { /* the ceiling is best-effort; the provider balance is the hard stop */ }
}

/** Global counter only, for the health line. One command, no writes. */
export async function usedToday() {
  const { day } = stamps();
  if (!DURABLE) return mem.day === day ? mem.n : 0;
  try {
    const [g] = await pipeline([['GET', `otelc:g:${day}`]]);
    return Number(g || 0);
  } catch { return null; }
}

export const limiterKind = () => (DURABLE ? 'kv' : 'memory');
