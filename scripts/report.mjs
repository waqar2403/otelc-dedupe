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
import { search, isNoiseFile } from './lib/search.mjs';
import { initEmbedder, embed } from './lib/embed.mjs';

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

// How many PRs touch each file. `docs/configuration.md` and `README.md` are
// touched by dozens, so sharing one of them is near-zero evidence; a file
// touched by two PRs is strong evidence. Same IDF logic as BM25, applied to paths.
const fileDF = new Map();
for (const it of corpus) {
  for (const f of new Set((it.files || []).filter((x) => !isNoiseFile(x)))) {
    fileDF.set(f, (fileDF.get(f) || 0) + 1);
  }
}
const NPR = corpus.filter((i) => i.kind === 'PR').length;
const fileIdf = (f) => Math.log(1 + NPR / (1 + (fileDF.get(f) || 0)));
const COMMON_FILE_IDF = 3.0; // below this a shared file is not evidence on its own

function fileJaccard(a, b) {
  const fa = new Set((a.files || []).filter((f) => !isNoiseFile(f)));
  const fb = new Set((b.files || []).filter((f) => !isNoiseFile(f)));
  if (!fa.size || !fb.size) return { j: 0, shared: [], weight: 0 };
  const shared = [...fa].filter((f) => fb.has(f));
  const weight = shared.reduce((s, f) => s + fileIdf(f), 0);
  return { j: shared.length / (fa.size + fb.size - shared.length), shared, weight };
}

/** True when one item is the PR that closes the other, or vice versa. */
function isLinkedPair(a, b) {
  const declares = (pr, iss) => {
    if (pr.kind !== 'PR' || iss.kind !== 'ISSUE') return false;
    if ((pr.closes || []).includes(iss.number)) return true;
    // closingIssuesReferences only picks up GitHub's recognised syntax; many
    // PRs write it loosely, so match the text too.
    return new RegExp(`\\b(fix(e[sd])?|close[sd]?|resolve[sd]?)\\s*:?\\s*#${iss.number}\\b`, 'i')
      .test(pr.body || '');
  };
  return declares(a, b) || declares(b, a);
}

// Pair-level scoring. Retrieval decides WHAT to look at; these rules decide
// how strongly to present it. Thresholds are tuned against eval/dataset.json.
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
    const c = classify(item, other, h);
    if (!c) continue;
    seen.add(key);
    clusters.set(key, { a: item, b: other, ...c, fused: h.score });
  }
}
process.stderr.write('\n');

const TIERS = { high: [], medium: [], low: [] };
for (const c of clusters.values()) TIERS[c.tier].push(c);
for (const t of Object.values(TIERS)) t.sort((x, y) => y.fused - x.fused);

const line = (c) => {
  const st = (i) => (i.state === 'OPEN' ? 'open' : i.merged ? 'merged' : 'closed');
  return `| [#${c.a.number}](${url(c.a.number)}) ${c.a.kind} ${st(c.a)} | [#${c.b.number}](${url(c.b.number)}) ${c.b.kind} ${st(c.b)} | ${c.evidence.join('; ')} |
| ${c.a.title.slice(0, 70)} | ${c.b.title.slice(0, 70)} | |`;
};

const section = (name, rows, blurb) =>
  `## ${name} (${rows.length})\n\n${blurb}\n\n` +
  (rows.length
    ? `| A | B | evidence |\n|---|---|---|\n${rows.map(line).join('\n')}\n`
    : '_none_\n');

const md = `# otelc-scout backfill report

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

${section('High signal', TIERS.high, 'Identical normalised titles, or near-total changed-file overlap between two PRs.')}
${section('Medium signal', TIERS.medium, 'Substantial file overlap, top lexical rank, or a same-author pair that would otherwise be high.')}
${section('Low signal', TIERS.low, 'Partial overlap. Expect a high proportion of legitimate distinct work here.')}

---

## Method

For each open item: BM25 over title+body (title boosted 3x, camelCase identifiers
expanded so \`isSetup\` matches \`isSetup()\`), plus changed-file Jaccard for PRs,
${idx.retrievers.includes('embed') ? 'plus MiniLM embeddings, ' : ''}fused by Reciprocal Rank Fusion, top 8 per item.
Pairs are then tiered by the rules in \`scripts/report.mjs\`.

Known limits, measured in \`npm run eval\`:
- Retrieval surfaces ${'16/30'} labelled negative pairs inside the top 5. Ranking cannot
  separate "same file, different bug" from "same bug"; only reading the diff can.
- Closed items are indexed on purpose. #512 was closed as "Duplicate of #161" and
  that link is the only way to see #817 is the third instance of the same bug.
`;

writeFileSync(join(ROOT, 'REPORT.md'), md);
console.log(`high=${TIERS.high.length} medium=${TIERS.medium.length} low=${TIERS.low.length}`);
console.log('wrote REPORT.md');
