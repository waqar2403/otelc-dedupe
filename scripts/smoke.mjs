// Post-deploy smoke check against a live deployment. Spends nothing: it only
// calls GET endpoints, never POST /api/analyze.
//
// This exists because a Vercel build can succeed and still ship a deployment
// that serves nothing. On 2026-08-13 and again on 2026-08-19 the zero-config
// Node builder picked public/app.js -- a browser script -- as the project's
// root entrypoint and bundled it as the one catch-all function, so every route
// returned FUNCTION_INVOCATION_FAILED while the build was reported green. The
// entrypoint is pinned in vercel.json now, but "the build passed" was never
// evidence the site works, and nothing was checking the site itself.
//
//   npm run smoke                          # production
//   npm run smoke -- https://some-preview  # anything else

const BASE = (process.argv[2] || 'https://otelc-dedupe.vercel.app').replace(/\/$/, '');
const TIMEOUT_MS = 30_000;

let failures = 0;

const check = (name, ok, detail = '') => {
  process.stdout.write(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
  if (!ok) failures++;
};

async function get(path) {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not every endpoint is JSON */ }
  return { status: res.status, text, json };
}

process.stdout.write(`\notelc-dedupe smoke  ${BASE}\n\n`);

try {
  // The page itself. A 200 on /style.css proves only that the CDN is up; the
  // outage served static assets fine and 500ed on / and every function.
  const page = await get('/');
  check('page loads', page.status === 200, `HTTP ${page.status}`);
  check('page is the app', page.text.includes('<title>otelc dedupe</title>'));

  const health = await get('/api/health');
  check('health responds', health.status === 200, `HTTP ${health.status}`);

  const h = health.json;
  if (!h) {
    check('health returns JSON', false, health.text.slice(0, 120).replace(/\s+/g, ' '));
  } else {
    check('health ok', h.ok === true, h.error ? String(h.error) : '');

    // vercel.json includeFiles: "data/**". Vercel's tracer does not follow
    // readFileSync paths, so a config change can ship a function with no
    // corpus. It answers "no significant overlap found" to everything -- the
    // most dangerous wrong answer this tool can give, and a silent one.
    check('corpus shipped', h.corpus > 0, `${h.corpus} items`);

    // Rate limits and the spend ceiling are per-instance without a shared
    // store, and every cold serverless instance starts at zero. "memory" here
    // means the prepaid balance is the only real cap left.
    check('limiter is shared', h.limiter === 'kv', `${h.limiter}${h.limiterVia ? ` via ${h.limiterVia}` : ''}`);

    // Without a provider key the deployment silently degrades to retrieval
    // only: it still returns candidates, just never scores them.
    check('judge configured', h.judgeConfigured === true);
  }

  const api = await get('/api/analyze');
  check('analyze reachable', api.status === 200, `HTTP ${api.status}`);
  check('analyze describes itself', api.json?.endpoint === 'POST /api/analyze');
} catch (e) {
  check('reachable', false, e.message);
}

process.stdout.write(
  failures ? `\n${failures} check${failures === 1 ? '' : 's'} failed\n\n` : '\nall checks passed\n\n'
);
process.exit(failures ? 1 : 0);
