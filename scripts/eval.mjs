// Two things this measures that the original plan's eval could not:
//   1. The vocabulary-gap case (#817 -> #161) is gated ON ITS OWN. Under an
//      aggregate recall@20 >= 7/8, a build with a completely broken embedder
//      still passes, because the other 7 targets share literal identifiers.
//   2. False-positive rate, over 30 labelled negatives instead of 2. Telling a
//      contributor "this is a duplicate" when it is not is the failure that
//      actually costs the project something.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize, embedText } from './lib/text.mjs';
import { search } from './lib/search.mjs';
import { initEmbedder, embed } from './lib/embed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpusFile = JSON.parse(readFileSync(join(ROOT, 'data/corpus.json'), 'utf8'));
const idx = JSON.parse(readFileSync(join(ROOT, 'data/index.json'), 'utf8'));
const ds = JSON.parse(readFileSync(join(ROOT, 'eval/dataset.json'), 'utf8'));

const corpus = corpusFile.items;
const byNum = new Map(corpus.map((i) => [i.number, i]));
const store = { corpus, bm25: idx.bm25, vectors: idx.vectors };
const K = Number(process.env.K || 20);
const ONLY = process.argv.includes('--lexical-only');
if (ONLY) store.vectors = null;

if (store.vectors) await initEmbedder({ quiet: true });

async function queryFor(num) {
  const it = byNum.get(num);
  if (!it) throw new Error(`#${num} not in corpus`);
  const q = { title: it.title, body: it.body, files: it.files };
  if (store.vectors) {
    const v = await embed([embedText(it)]);
    if (v) q.vector = v[0];
  }
  return { it, q };
}

console.log(`\notelc-prior-art eval   corpus=${corpus.length}  K=${K}  retrievers=${[
  'bm25', 'files', ...(store.vectors ? ['embed'] : []),
].join('+')}\n`);

let fail = false;

// ---- Hard gates -----------------------------------------------------------
console.log('HARD GATES');
for (const g of ds.hardGates) {
  const { it, q } = await queryFor(g.query);
  const hits = search(store, q, { limit: K, exclude: new Set([g.query]) });
  const nums = hits.map((h) => h.number);
  for (const target of g.mustRetrieve) {
    const rank = nums.indexOf(target) + 1;
    const ok = rank > 0;
    if (!ok) fail = true;
    const from = ok ? Object.keys(hits[rank - 1].from).join('+') : '-';
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  #${g.query} -> #${target}  ${ok ? `rank ${rank}/${K} via ${from}` : `NOT in top ${K}`}`
    );
    if (!ok) console.log(`        ${g.why}`);
  }
}

// ---- Recall ---------------------------------------------------------------
console.log('\nRECALL@' + K);
let found = 0, total = 0;
for (const p of ds.positives) {
  const { q } = await queryFor(p.query);
  const hits = search(store, q, { limit: K, exclude: new Set([p.query]) });
  const nums = hits.map((h) => h.number);
  const got = p.mustRetrieve.filter((t) => nums.includes(t));
  found += got.length; total += p.mustRetrieve.length;
  const detail = p.mustRetrieve
    .map((t) => {
      const r = nums.indexOf(t) + 1;
      return r > 0 ? `#${t}@${r}` : `#${t}:MISS`;
    })
    .join(' ');
  console.log(`  #${p.query}  ${got.length}/${p.mustRetrieve.length}  ${detail}   (${p.label})`);
}
console.log(`  TOTAL recall@${K} = ${found}/${total} (${((100 * found) / total).toFixed(0)}%)`);

// ---- False positives ------------------------------------------------------
// A negative "fires" if the retriever ranks it in the top 5, i.e. somewhere a
// judge would very likely be asked to call it a duplicate.
const TOP = 5;
console.log(`\nFALSE POSITIVES (negative pair appearing in top ${TOP})`);
let fired = 0;
for (const n of ds.negatives) {
  const [a, b] = n.pair;
  if (!byNum.has(a) || !byNum.has(b)) { console.log(`  SKIP #${a}/#${b} not in corpus`); continue; }
  const { q } = await queryFor(a);
  const hits = search(store, q, { limit: TOP, exclude: new Set([a]) });
  const rank = hits.map((h) => h.number).indexOf(b) + 1;
  if (rank > 0) { fired++; console.log(`  FIRED  #${a} -> #${b} at rank ${rank}   ${n.why}`); }
}
const negTotal = ds.negatives.filter((n) => byNum.has(n.pair[0]) && byNum.has(n.pair[1])).length;
console.log(`  ${fired}/${negTotal} negatives surfaced in top ${TOP} (${((100 * fired) / negTotal).toFixed(0)}%)`);
console.log(
  '  NOTE: retrieval surfacing a negative is expected and fine. It is the judge\n' +
  '        that must not label these "duplicate". This number is the load the\n' +
  '        judge has to reject, and the reason a judge eval is still needed.'
);

console.log(`\n${fail ? 'GATE FAILED' : 'GATES PASSED'}\n`);
process.exit(fail ? 1 : 0);
