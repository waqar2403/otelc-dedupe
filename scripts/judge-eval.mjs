// Measures the thing retrieval cannot do: separating a deliberate series from a
// real duplicate. Reports SEPARATION and CALIBRATION, not pass/fail, because the
// product surfaces a likelihood rather than a verdict.
//
//   node scripts/judge-eval.mjs                   thinking off (default, ~6x cheaper)
//   OTELC_THINKING=1 node scripts/judge-eval.mjs  thinking on, for comparison

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { search } from './lib/search.mjs';
import { judge, PROVIDERS } from './lib/judge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cf = JSON.parse(readFileSync(join(ROOT, 'data/corpus.json'), 'utf8'));
const idx = JSON.parse(readFileSync(join(ROOT, 'data/index.json'), 'utf8'));
const byNum = new Map(cf.items.map((i) => [i.number, i]));
const store = { corpus: cf.items, bm25: idx.bm25, vectors: idx.vectors };
const PROVIDER = process.env.OTELC_PROVIDER || 'deepseek';

// want: true  = a maintainer would close one as redundant
//       false = deliberately distinct work
// Shared with scripts/prod-eval.mjs so the library and the deployed endpoint
// are never measured against drifting copies of the ground truth.
const { cases: CASES } = JSON.parse(readFileSync(join(ROOT, 'eval/judge-cases.json'), 'utf8'));

const K = 12;
const thinking = !!process.env.OTELC_THINKING;
let calls = 0, promptTok = 0, complTok = 0;
const scored = [];

console.log(`\njudge eval  model=${PROVIDERS[PROVIDER].model}  thinking=${thinking ? 'ON' : 'off'}  cases=${CASES.length}\n`);

for (const c of CASES) {
  const q = byNum.get(c.q);
  const cands = search(store, { title: q.title, body: q.body, files: q.files }, { limit: K, exclude: new Set([c.q]) })
    .map((h) => byNum.get(h.number)).filter(Boolean);
  if (!cands.some((x) => x.number === c.t)) { console.log(`  RETRIEVAL-MISS #${c.q} -> #${c.t}`); continue; }

  let out;
  try {
    out = await judge({ title: q.title, body: q.body, kind: q.kind, files: q.files }, cands,
      { provider: PROVIDER, bodyCap: 600, maxTokens: thinking ? 8000 : 1500 });
  } catch (e) { console.log(`  ERROR #${c.q}: ${e.message}`); continue; }

  calls++;
  promptTok += out.usage?.prompt_tokens || 0; complTok += out.usage?.completion_tokens || 0;

  const v = out.results.find((r) => r.number === c.t);
  const L = v?.likelihood ?? null;
  scored.push({ ...c, L, verdict: v?.verdict, reason: v?.reason });
  console.log(
    `  ${c.want ? 'DUP ' : 'DIST'}  #${String(c.q).padEnd(4)} -> #${String(c.t).padEnd(4)} ` +
    `L=${String(L ?? '--').padStart(3)}  ${String(v?.verdict || 'none').padEnd(12)} ${c.why}`
  );
  if (v?.reason) console.log(`          "${v.reason}"`);
}

const pos = scored.filter((s) => s.want && s.L !== null).map((s) => s.L);
const neg = scored.filter((s) => !s.want && s.L !== null).map((s) => s.L);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

console.log(`\n  duplicates  n=${pos.length}  mean ${avg(pos).toFixed(1)}  range ${Math.min(...pos)}-${Math.max(...pos)}`);
console.log(`  distinct    n=${neg.length}  mean ${avg(neg).toFixed(1)}  range ${Math.min(...neg)}-${Math.max(...neg)}`);
console.log(`  separation  ${(avg(pos) - avg(neg)).toFixed(1)} points`);

const usable = scored.filter((s) => s.L !== null);
let best = { t: null, acc: -1 };
for (let t = 0; t <= 100; t += 5) {
  const acc = usable.filter((s) => (s.L >= t) === s.want).length / usable.length;
  if (acc > best.acc) best = { t, acc };
}
console.log(`  best cut    >=${best.t} gives ${(best.acc * 100).toFixed(0)}% accuracy`);
const disjoint = pos.length && neg.length && Math.min(...pos) > Math.max(...neg);
console.log(`  clean split ${disjoint ? 'YES - ranges disjoint' : 'NO - ranges overlap, no threshold separates perfectly'}`);

console.log('\n  band       n   actually duplicate');
for (const [lo, hi] of [[90, 100], [70, 89], [40, 69], [10, 39], [0, 9]]) {
  const band = usable.filter((s) => s.L >= lo && s.L <= hi);
  if (!band.length) { console.log(`  ${String(lo).padStart(3)}-${String(hi).padEnd(3)}    0   -`); continue; }
  const d = band.filter((s) => s.want).length;
  console.log(`  ${String(lo).padStart(3)}-${String(hi).padEnd(3)}  ${String(band.length).padStart(3)}   ${d}/${band.length}  (${((100 * d) / band.length).toFixed(0)}%)`);
}

const cost = (promptTok / 1e6) * 0.14 + (complTok / 1e6) * 0.28;
console.log(`\n  ${calls} calls  ${promptTok} prompt + ${complTok} completion tokens`);
console.log(`  approx $${cost.toFixed(4)} total, $${(cost / Math.max(1, calls)).toFixed(5)} per call\n`);
