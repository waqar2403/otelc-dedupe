// Vercel serverless entry. The logic lives in scripts/lib/api.mjs; this only
// translates a Node request into the shape that core expects.

import { analyze } from '../scripts/lib/api.mjs';

const MAX_BODY = 64_000;

async function readBody(req) {
  // Vercel parses JSON bodies for you, but only for some runtime/content-type
  // combinations. Handle every case rather than depend on which one you get.
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
  }
  return raw ? JSON.parse(raw) : {};
}

const send = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  let input;
  try { input = await readBody(req); }
  catch (e) { return send(res, e.status || 400, { error: e.status ? e.message : 'invalid JSON' }); }

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();

  try {
    const r = await analyze({ ip, apiKey: req.headers['x-api-key'], input });
    send(res, r.status, r.body);
  } catch (e) {
    console.error('[otelc-dedupe] analyze failed', e);
    send(res, 500, { error: e.message });
  }
}
