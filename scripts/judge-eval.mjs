// Measures the thing retrieval cannot do: separating a deliberate series from
// a real duplicate. Every case here is verified against the live repo.
//
//   npm run judge-eval          (needs DEEPSEEK_API_KEY)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { search } from './lib/search.mjs';
import { judge, PROVIDERS } from './lib/judge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cf = JSON.parse(readFileSync(join(ROOT, 'data/corpus.json'), 'utf8'));
const idx = JSON.parse(readFileSync(join(ROOT, 'data/index.json'), 'utf8'));
const corpus = cf.items;
const byNum = new Map(corpus.map((i) => [i.number, i]));
const store = { corpus, bm25: idx.bm25, vectors: idx.vectors };
const PROVIDER = process.env.SCOUT_PROVIDER || 'deepseek';

const DUP = new Set(['duplicate', 'subsumes', 'subsumed_by']);
const NOTDUP = new Set(['series', 'related', 'unrelated']);

// want: 'dup'    -> verdict must be duplicate/subsumes/subsumed_by
//       'notdup' -> verdict must be series/related/unrelated
const CASES = [
  { q: 909, t: 853, want: 'dup', why: 'identical changed-file set, #853 already merged' },
  { q: 905, t: 853, want: 'dup', why: 'issue for work already merged' },
  { q: 842, t: 844, want: 'dup', why: 'issue whose own PR merged' },
  { q: 852, t: 774, want: 'dup', why: 'same 2-line docs fix, #774 merged' },
  { q: 916, t: 903, want: 'dup', why: 'same author re-filed KeyData panic' },
  { q: 939, t: 790, want: 'dup', why: 'same author re-filed Windows TestRunCmd' },
  { q: 818, t: 659, want: 'dup', why: 'competing isSetup implementations' },
  { q: 948, t: 931, want: 'notdup', why: 'gRPC vs HTTP e2e - deliberate series' },
  { q: 202, t: 201, want: 'notdup', why: 'otelhttp vs otelhttptrace - different targets' },
  { q: 883, t: 789, want: 'notdup', why: 'same function, different bugs (collision not duplicate)' },
  { q: 880, t: 873, want: 'notdup', why: 'linodego one-bug-per-PR series' },
  { q: 932, t: 909, want: 'notdup', why: 'same file, scanner limit vs close error' },
  { q: 805, t: 772, want: 'notdup', why: 'anthropic series by one author' },
  { q: 947, t: 924, want: 'notdup', why: 'gRPC vs HTTP e2e issues' },
];

const K = 12;
let pass = 0, fail = 0, missed = 0, tokens = 0, calls = 0;
const rows = [];

console.log(`\njudge eval  provider=${PROVIDER}  model=${process.env.SCOUT_MODEL || PROVIDERS[PROVIDER].model}  cases=${CASES.length}\n`);

for (const c of CASES) {
  const q = byNum.get(c.q);
  if (!q) { console.log(`  SKIP #${c.q} not in corpus`); continue; }
  const cands = search(store, { title: q.title, body: q.body, files: q.files }, { limit: K, exclude: new Set([c.q]) })
    .map((h) => byNum.get(h.number)).filter(Boolean);

  if (!cands.some((x) => x.number === c.t)) {
    missed++;
    rows.push(`  RETRIEVAL-MISS  #${c.q} -> #${c.t}  (target not in top ${K})`);
    continue;
  }

  let out;
  try {
    out = await judge({ title: q.title, body: q.body, kind: q.kind, files: q.files }, cands,
      { provider: PROVIDER, bodyCap: 600, maxTokens: 1500 });
  } catch (e) { rows.push(`  ERROR  #${c.q}: ${e.message}`); fail++; continue; }
  calls++; tokens += out.usage?.total_tokens || 0;

  const v = out.results.find((r) => r.number === c.t);
  const verdict = v?.verdict || 'NO-VERDICT';
  const ok = c.want === 'dup' ? DUP.has(verdict) : NOTDUP.has(verdict);
  ok ? pass++ : fail++;
  rows.push(
    `  ${ok ? 'PASS' : 'FAIL'}  #${c.q} -> #${c.t}  want=${c.want.padEnd(6)} got=${verdict.padEnd(12)}` +
    `${v ? `conf=${String(v.confidence).padStart(3)}` : ''}\n` +
    `        ${c.why}\n` +
    (v?.reason ? `        judge: ${v.reason}\n` : '')
  );
}

console.log(rows.join('\n'));
const n = pass + fail;
console.log(`\n  pass ${pass}/${n}   retrieval-miss ${missed}`);
console.log(`  ${calls} calls, ${tokens} tokens, approx $${((tokens / 1e6) * 0.21).toFixed(4)}\n`);
process.exit(fail > 0 ? 1 : 0);
