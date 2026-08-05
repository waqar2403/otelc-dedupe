// Batch backfill: every OPEN item against the whole corpus, emitted as a
// markdown report for maintainers. No server, no keys, no per-request cost.
//
// Deliberately tiered rather than binary. The eval shows retrieval surfaces
// genuine non-duplicates constantly (linodego series, file.Close pattern), so
// presenting one flat "duplicates" list would be actively misleading.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedText } from './lib/text.mjs';
import { tokenize } from "./lib/text.mjs";
import { search, isNoiseFile } from './lib/search.mjs';
import { initEmbedder, embed } from './lib/embed.mjs';
import { makeRules, isLinkedPair, normTitle, titleSim, daysApart } from './lib/rules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cf = JSON.parse(readFileSync(join(ROOT, 'data/corpus.json'), 'utf8'));
const idx = JSON.parse(readFileSync(join(ROOT, 'data/index.json'), 'utf8'));
const corpus = cf.items;
const byNum = new Map(corpus.map((i) => [i.number, i]));
const store = { corpus, bm25: idx.bm25, vectors: idx.vectors };
if (store.vectors) await initEmbedder({ quiet: true });

const REPO = `${cf.owner}/${cf.name}`;
const url = (n) => `https://github.com/${REPO}/issues/${n}`;
const openItems = corpus.filter((i) => i.state === 'OPEN');

// Duplicate and collision scoring live in lib/rules.mjs so the same rules can
// be measured head-to-head against the judge (scripts/rules-vs-judge.mjs).
const { duplicateScore, collisionScore, fileJaccard, fileIdf } = makeRules(corpus);
const COMMON_FILE_IDF = 3.0; // below this a shared file is not evidence on its own

// Legacy single-axis classifier, retained for the older tiered view.
function classify(a, b, hit) {
  if (isLinkedPair(a, b)) return null;
  const { j, shared, weight } = fileJaccard(a, b);
  const sameAuthor = a.author === b.author;
  const titleA = a.title.replace(/^\w+(\([^)]*\))?:\s*/, '').toLowerCase().trim();
  const titleB = b.title.replace(/^\w+(\([^)]*\))?:\s*/, '').toLowerCase().trim();
  const ev = [];
  let tier = null;

  if (titleA === titleB) { tier = 'high'; ev.push('identical titles (normalised)'); }

  const bmRank = hit.from.bm25?.rank;
  const lexical = bmRank && bmRank <= 3;

  if (a.kind === 'PR' && b.kind === 'PR' && j > 0) {
    // Two guards, both learned from false positives in the first run:
    //  - One shared file is never enough alone. #725 and #487 both touch only
    //    README.md (Jaccard 1.0) and are completely unrelated changes.
    //  - If the counterpart is already merged, shared files are just the file's
    //    history, not duplicated effort. #789 and #476 share optimize.go
    //    because everyone editing that function does. Needs lexical support.
    const counterpartLive = b.state === 'OPEN';
    const strong = shared.length >= 2 && (counterpartLive || lexical);
    const weak = !strong ? (shared.length < 2 ? ' [single shared file]' : ' [counterpart already merged]') : '';
    ev.push(
      `file overlap ${(j * 100).toFixed(0)}% (${shared.length} shared: ` +
      `${shared.slice(0, 3).join(', ')}${shared.length > 3 ? ', …' : ''})${weak}`
    );
    if (j >= 0.99 && strong) tier = tier || 'high';
    else if (j >= 0.5 && strong) tier = tier || 'medium';
    else tier = tier || 'low';
  }

  if (lexical) {
    ev.push(`lexical rank ${bmRank}`);
    if (!tier) tier = bmRank === 1 ? 'medium' : 'low';
    // One shared file plus an independent lexical hit is two signals agreeing.
    else if (tier === 'low' && shared.length === 1 && j >= 0.99) tier = 'high';
  }
  if (hit.from.embed?.rank <= 3) ev.push(`semantic rank ${hit.from.embed.rank}`);

  if (!tier) return null;

  // Same author on the same files is usually a deliberate one-bug-per-PR
  // series (linodego, anthropic), not duplication. Demote, never drop: the
  // two real self-duplicates in this repo (#903/#916, #790/#939) are also
  // same-author, so dropping would lose them.
  if (sameAuthor && tier === 'high' && titleA !== titleB) {
    tier = 'medium';
    ev.push('same author (likely deliberate series)');
  } else if (sameAuthor) {
    ev.push('same author');
  }
  return { tier, evidence: ev, sameAuthor };
}

const clusters = new Map();
const seen = new Set();
let n = 0;

for (const item of openItems) {
  process.stderr.write(`\r  scanning ${++n}/${openItems.length}`);
  const q = { title: item.title, body: item.body, files: item.files };
  if (store.vectors) {
    const v = await embed([embedText(item)]);
    if (v) q.vector = v[0];
  }
  const hits = search(store, q, { limit: 8, exclude: new Set([item.number]) });
  for (const h of hits) {
    const other = byNum.get(h.number);
    if (!other) continue;
    // Only pair open-with-open, or open-with-closed (a closed item can be the
    // canonical one, as #512 was). Skip closed-closed entirely.
    if (other.state !== 'OPEN' && other.kind === 'PR' && !other.merged) continue;
    const key = [item.number, other.number].sort((x, y) => x - y).join('-');
    if (seen.has(key)) continue;
    if (isLinkedPair(item, other)) continue;
    seen.add(key);
    const dup = duplicateScore(item, other, h);
    const col = collisionScore(item, other);
    if (dup.score < 0.35 && col.score < 0.5) continue;
    clusters.set(key, { a: item, b: other, dup, col, fused: h.score });
  }
}
process.stderr.write('\n');

const all = [...clusters.values()];
const dups = all.filter((c) => c.dup.score >= 0.35).sort((x, y) => y.dup.score - x.dup.score);
const cols = all
  .filter((c) => c.col.score >= 0.5 && c.dup.score < 0.6)
  .sort((x, y) => y.col.score - x.col.score);

const st = (i) => (i.state === 'OPEN' ? 'open' : i.merged ? 'merged' : 'closed');
const row = (c, which) => {
  const sc = which === 'dup' ? c.dup : c.col;
  return `| **${(sc.score * 100).toFixed(0)}** | [#${c.a.number}](${url(c.a.number)}) ${c.a.kind} ${st(c.a)}<br>${c.a.title.slice(0, 64)} | [#${c.b.number}](${url(c.b.number)}) ${c.b.kind} ${st(c.b)}<br>${c.b.title.slice(0, 64)} | ${sc.ev.join('; ')} |`;
};
const table = (rows, which) =>
  rows.length
    ? `| score | A | B | evidence |\n|---:|---|---|---|\n${rows.map((c) => row(c, which)).join('\n')}\n`
    : '_none_\n';

const md = `# otelc-dedupe backfill report

Repo: \`${REPO}\`
Corpus: **${corpus.length} items** (${corpus.filter((i) => i.kind === 'ISSUE').length} issues, ${corpus.filter((i) => i.kind === 'PR').length} PRs), open **and** closed.
Open items scanned: **${openItems.length}**.
Retrievers: ${idx.retrievers.join(' + ')}.
Fetched ${cf.fetchedAt.slice(0, 10)}, generated ${new Date().toISOString().slice(0, 10)}.

> **These are candidates, not verdicts.** The eval set shows retrieval surfaces
> genuine non-duplicates constantly: deliberate one-bug-per-PR series on shared
> files (linodego, anthropic) rank as highly as real duplicates. Every row below
> needs a human read. Tiers reflect signal strength, not confidence that a pair
> is a duplicate.

## Likely duplicates (${dups.length})

Same underlying work. The action is usually to close one and link it to the other.
Scored on title similarity, lexical rank, the same-author self-refile pattern, and
whether the counterpart has already landed.

${table(dups, 'dup')}

## Merge collisions (${cols.length})

Different work touching the same lines. Nothing to close here: these need
**sequencing**, because whichever merges second will need a rebase. Listed
separately because the action is different from a duplicate.

${table(cols, 'col')}

---

## Method

For each open item: BM25 over title+body (title boosted 3x, camelCase identifiers
expanded so \`isSetup\` matches \`isSetup()\`), plus changed-file Jaccard for PRs,
${idx.retrievers.includes('embed') ? 'plus MiniLM embeddings, ' : ''}fused by Reciprocal Rank Fusion, top 8 per item.
Pairs are then tiered by the rules in \`scripts/report.mjs\`.

Known limits, measured in \`npm run eval\` (run it for the current figure; it was
hardcoded here once and went stale the first time the corpus grew):
- Retrieval surfaces most labelled negative pairs inside the top 5. Ranking cannot
  separate "same file, different bug" from "same bug"; only reading the diff can.
- Closed items are indexed on purpose. #512 was closed as "Duplicate of #161" and
  that link is the only way to see #817 is the third instance of the same bug.
`;

writeFileSync(join(ROOT, 'REPORT.md'), md);
console.log(`likely-duplicates=${dups.length} merge-collisions=${cols.length}`);
console.log('wrote REPORT.md');
