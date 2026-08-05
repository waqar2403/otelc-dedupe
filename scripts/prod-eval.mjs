// Accuracy of the DEPLOYED endpoint, not the library.
//
//   node scripts/prod-eval.mjs https://otelc-dedupe.vercel.app
//
// scripts/judge-eval.mjs measures the judge by calling the provider directly.
// That leaves the deployment untested: retrieval caps, the short-circuit, the
// live delta and the request path can all change the answer a user actually
// gets. This replays the same labelled pairs over HTTP against a running
// instance and reports what that instance returns.
//
// Two deliberate handicaps, both making the number conservative:
//
//   1. The query text is the labelled item's own title and body, so the item
//      itself is in the corpus and comes back as its own top match, consuming
//      one of the 12 candidate slots. A real user's draft is not in the index.
//      It doubles as a positive control: a self-match that does not score high
//      means something is broken upstream of the judge.
//   2. Production also indexes items filed after the labelled snapshot, so
//      there is more to crowd the list than judge-eval.mjs contends with.
//
// Costs one paid check per case and counts against the deployed budget.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || process.env.OTELC_BASE || 'http://localhost:3000').replace(/\/$/, '');
const KEY = process.env.OTELC_EVAL_KEY || '';   // optional: bypass the shared budget

const { items } = JSON.parse(readFileSync(join(ROOT, 'data/corpus.json'), 'utf8'));
const { cases: CASES } = JSON.parse(readFileSync(join(ROOT, 'eval/judge-cases.json'), 'utf8'));
const byNum = new Map(items.map((i) => [i.number, i]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(item) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(KEY ? { 'x-api-key': KEY } : {}) },
      body: JSON.stringify({
        kind: item.kind,
        title: item.title.slice(0, 200),
        body: (item.body || '').slice(0, 4000),
        files: item.kind === 'PR' ? (item.files || []).slice(0, 60) : [],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) {
      // The per-IP window is a fixed UTC hour. Wait it out rather than report
      // a rate limit as an accuracy failure.
      const wait = (60 - new Date().getUTCMinutes()) * 60_000 + 15_000;
      process.stderr.write(`\n  rate limited; waiting ${Math.round(wait / 60000)}m for the window to roll\n`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status}: ${data.error || 'request failed'}`);
    return data;
  }
  throw new Error('rate limited repeatedly');
}

console.log(`\nproduction accuracy  ${BASE}\n`);
const h = await (await fetch(`${BASE}/api/health`)).json();
console.log(`  commit ${h.commit || '?'}  corpus ${h.corpus}  judge ${h.judgeConfigured ? 'on' : 'OFF'}  limiter ${h.limiter}`);
if (!h.judgeConfigured) { console.error('\n  judge is not configured on this deployment; scores would be meaningless.\n'); process.exit(1); }
console.log(h.live?.pending
  ? `  live: tail not yet fetched on this instance; the first check below populates it\n`
  : `  live: +${h.live?.added ?? 0} new, ${h.live?.updated ?? 0} updated since ${h.indexedAt?.slice(0, 10)}\n`);

const scored = [];
let selfOk = 0, selfTotal = 0, retrievalMiss = 0, tokens = 0;

for (const c of CASES) {
  const q = byNum.get(c.q);
  if (!q) { console.log(`  SKIP #${c.q} not in local corpus`); continue; }

  let d;
  try { d = await check(q); }
  catch (e) { console.log(`  ERROR #${c.q}: ${e.message}`); continue; }
  tokens += d.usage?.total_tokens || 0;

  const cands = d.candidates || [];
  const self = cands.find((x) => x.number === c.q);
  if (self) { selfTotal++; if ((self.judgement?.likelihood ?? 0) >= 70) selfOk++; }

  const hit = cands.find((x) => x.number === c.t);
  if (!hit) {
    retrievalMiss++;
    console.log(`  ${c.want ? 'DUP ' : 'DIST'}  #${String(c.q).padEnd(4)} -> #${String(c.t).padEnd(4)}  RETRIEVAL MISS  ${c.why}`);
    continue;
  }
  const L = hit.judgement?.likelihood ?? null;
  scored.push({ ...c, L, verdict: hit.judgement?.verdict, reason: hit.judgement?.reason });
  const mark = L === null ? '  ?' : (L >= 70) === c.want ? ' ok' : 'MISS';
  console.log(
    `  ${c.want ? 'DUP ' : 'DIST'}  #${String(c.q).padEnd(4)} -> #${String(c.t).padEnd(4)} ` +
    `L=${String(L ?? '--').padStart(3)} ${mark}  ${String(hit.judgement?.verdict || 'none').padEnd(12)} ${c.why}`
  );
  if (hit.judgement?.reason) console.log(`          "${hit.judgement.reason}"`);
}

const usable = scored.filter((s) => s.L !== null);
const pos = usable.filter((s) => s.want).map((s) => s.L);
const neg = usable.filter((s) => !s.want).map((s) => s.L);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

console.log(`\n  duplicates   n=${pos.length}  mean ${avg(pos).toFixed(1)}  range ${pos.length ? `${Math.min(...pos)}-${Math.max(...pos)}` : '-'}`);
console.log(`  distinct     n=${neg.length}  mean ${avg(neg).toFixed(1)}  range ${neg.length ? `${Math.min(...neg)}-${Math.max(...neg)}` : '-'}`);
console.log(`  separation   ${(avg(pos) - avg(neg)).toFixed(1)} points`);

let best = { t: null, acc: -1 };
for (let t = 0; t <= 100; t += 5) {
  const acc = usable.filter((s) => (s.L >= t) === s.want).length / usable.length;
  if (acc > best.acc) best = { t, acc };
}
const atShipped = usable.filter((s) => (s.L >= 70) === s.want).length;
console.log(`  at the shipped cut (>=70): ${atShipped}/${usable.length} correct (${((100 * atShipped) / usable.length).toFixed(0)}%)`);
console.log(`  best cut     >=${best.t} gives ${(best.acc * 100).toFixed(0)}%`);
const disjoint = pos.length && neg.length && Math.min(...pos) > Math.max(...neg);
console.log(`  clean split  ${disjoint ? 'YES - ranges disjoint' : 'NO - ranges overlap'}`);
console.log(`  retrieval    ${CASES.length - retrievalMiss}/${CASES.length} targets reached the candidate list`);
console.log(`  self-control ${selfOk}/${selfTotal} items scored >=70 against themselves`);
console.log(`\n  ${tokens} tokens, approx $${((tokens / 3123) * 0.000488).toFixed(4)} total\n`);
process.exit(disjoint && atShipped === usable.length && retrievalMiss === 0 ? 0 : 1);
