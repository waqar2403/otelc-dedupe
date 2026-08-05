// Local dev server. Zero dependencies: node server.mjs
//
// A thin adapter over scripts/lib/api.mjs, which is also what the Vercel
// functions in api/ call. One implementation, two transports, so what you test
// locally is what runs deployed.

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, health } from './scripts/lib/api.mjs';
import { baseMeta } from './scripts/lib/kb.mjs';
import { limiterKind } from './scripts/lib/limits.mjs';
import { PROVIDERS } from './scripts/lib/judge.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const PROVIDER = process.env.OTELC_PROVIDER || 'deepseek';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const send = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local').split(',')[0].trim();

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/analyze') {
    // Every method reaches the handler, so the method-handling branches in
    // api/analyze.mjs are exercised locally rather than only in theory.
    if (req.method !== 'POST') {
      return req.method === 'GET'
        ? send(res, 200, {
            endpoint: 'POST /api/analyze',
            body: { kind: 'ISSUE | PR', title: 'required, <=200 chars', body: 'optional, <=4000 chars', files: 'optional, PR only, changed paths' },
            headers: { 'x-api-key': 'optional; your own provider key, bypasses the shared budget' },
            health: 'GET /api/health',
          })
        : send(res, 405, { error: 'POST only' });
    }
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 64_000) req.destroy();      // hard stop before parsing
    });
    req.on('end', async () => {
      let input;
      try { input = JSON.parse(body); } catch { return send(res, 400, { error: 'invalid JSON' }); }
      try {
        const r = await analyze({ ip: clientIp(req), apiKey: req.headers['x-api-key'], input });
        send(res, r.status, r.body);
      } catch (e) { send(res, 500, { error: e.message }); }
    });
    return;
  }

  if (url.pathname === '/api/health') {
    health().then((r) => send(res, r.status, r.body)).catch((e) => send(res, 500, { error: e.message }));
    return;
  }

  const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = join(PUBLIC, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (file.startsWith(PUBLIC) && existsSync(file)) {
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'text/plain' });
    return res.end(readFileSync(file));
  }
  res.writeHead(404); res.end('not found');
}).listen(PORT, () => {
  const m = baseMeta();
  const configured = !!process.env[PROVIDERS[PROVIDER].env];
  console.log(`\n  otelc-dedupe  http://localhost:${PORT}`);
  console.log(`  base index: ${m.count} items, fetched ${m.fetchedAt.slice(0, 10)}`);
  console.log(`  live tail:  ${process.env.OTELC_LIVE === '0' ? 'disabled' : 'on, refreshed per request (TTL 5m)'}`);
  console.log(`  limiter:    ${limiterKind()}${limiterKind() === 'memory' ? ' (per-process; configure KV before deploying)' : ''}`);
  console.log(`  judge:      ${configured ? `${PROVIDER} ready` : `DISABLED (set ${PROVIDERS[PROVIDER].env} to enable)`}\n`);
});
