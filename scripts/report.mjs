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

const normTitle = (t) => t.replace(/^\w+(\([^)]*\))?:\s*/, '').toLowerCase().trim();

// Vocabulary of instrumentation targets, derived from the repo's own
// instrumentation/ tree rather than hardcoded. Two items naming DIFFERENT
// targets are a deliberate series, not a duplicate: #201/#202/#203 are
// otelhttptrace / otelhttp / otelgrpc, and #948 vs #931 is gRPC vs HTTP.
const TARGETS = new Set(['grpc', 'http', 'sql', 'https']);
for (const it of corpus) {
  for (const f of it.files || []) {
    const m = f.match(/^instrumentation\/(.+?)\/(?:v\d+\/)?[^/]+$/);
    if (!m) continue;
    for (const seg of m[1].split('/')) {
      const s = seg.toLowerCase().replace(/\.(com|org|io|net)$/, '');
      if (s.length > 2 && !/^v\d+$/.test(s) && !s.includes('.')) TARGETS.add(s);
    }
  }
}

/** Target names mentioned in a title. */
function targetsIn(item) {
  const out = new Set();
  for (const t of tokenize(normTitle(item.title))) if (TARGETS.has(t)) out.add(t);
  return out;
}

function titleSim(a, b) {
  const ta = new Set(tokenize(normTitle(a.title)));
  const tb = new Set(tokenize(normTitle(b.title)));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

const daysApart = (a, b) =>
  Math.abs(new Date(a.createdAt) - new Date(b.createdAt)) / 86400000;

/**
 * DUPLICATE likelihood: is this the same underlying work?
 * Distinct from collision risk. A maintainer closes one of these.
 */
function duplicateScore(a, b, hit) {
  const ev = [];
  let s = 0;
  const ts = titleSim(a, b);
  const sameAuthor = a.author === b.author;

  if (normTitle(a.title) === normTitle(b.title)) { s += 0.6; ev.push('identical titles'); }
  else if (ts >= 0.6) { s += 0.45; ev.push(`title overlap ${(ts * 100).toFixed(0)}%`); }
  else if (ts >= 0.4) { s += 0.25; ev.push(`title overlap ${(ts * 100).toFixed(0)}%`); }

  const bmRank = hit.from.bm25?.rank;
  if (bmRank === 1) { s += 0.25; ev.push('top lexical match'); }
  else if (bmRank <= 3) { s += 0.15; ev.push(`lexical rank ${bmRank}`); }
  else if (bmRank <= 20) { s += 0.05; ev.push(`lexical rank ${bmRank}`); }

  // The self-refile pattern: one person files the same thing twice, days apart.
  // Both genuine self-duplicates in this repo (#903/#916, #790/#939) look
  // exactly like this. The earlier same-author rule DEMOTED these, which was
  // backwards - it is the strongest duplicate signal available.
  // Gated on lexical rank, not title similarity. #903 and #916 describe the
  // same bug with only ~21% title overlap ("GetKeyData/SetKeyData/HasKeyData
  // panics" vs "HookContext KeyData methods"), so a title threshold misses
  // them. BM25 reads the body and ranks them adjacent.
  if (sameAuthor && (ts >= 0.4 || bmRank <= 5)) {
    const d = daysApart(a, b);
    if (d <= 14) { s += 0.3; ev.push(`same author, ${d.toFixed(0)}d apart (self-refile)`); }
    else { s += 0.1; ev.push('same author'); }
  }

  // An open item duplicating already-landed work is the most actionable
  // finding there is: the maintainer just closes it.
  if (a.state === 'OPEN' && b.state !== 'OPEN' && ts >= 0.4) {
    s += 0.2; ev.push(b.merged ? 'counterpart already MERGED' : 'counterpart already closed');
  }

  // Different named targets => deliberate series, not duplication. Overrides
  // the self-refile boost, which otherwise scores these 100.
  // Each side naming its own rare, specific term means they address different
  // things. Rarity comes from the BM25 IDF table, so it needs no vocabulary:
  //   #201 "otelhttptrace" vs #202 "otelhttp"
  //   #947 "grpc"          vs #931 "http"
  // Both look like self-refiles by title overlap alone; the discriminating
  // token is what separates a series from a duplicate.
  const setA = new Set(tokenize(normTitle(a.title)));
  const setB = new Set(tokenize(normTitle(b.title)));
  const onlyA = [...setA].filter((t) => !setB.has(t));
  const onlyB = [...setB].filter((t) => !setA.has(t));
  const rare = (toks) =>
    toks.filter((t) => (idx.bm25.df[t] ?? 0) > 0 && idx.bm25.df[t] <= 25 && t.length >= 4);
  // Only the explicit sibling-target case is penalised. A broader
  // "each side has an exclusive rare term" rule was tried and reverted: it
  // removed #947/#931 (a real series) but also #903/#916 and #790/#939, which
  // are verified true duplicates. Their titles genuinely differ in wording
  // while describing the same bug, which is what a duplicate looks like.
  // Separating those two cases needs semantics, not term statistics - it is
  // the judge's job, and this scorer deliberately favours recall.
  void rare;
  const tA = onlyA.filter((t) => TARGETS.has(t));
  const tB = onlyB.filter((t) => TARGETS.has(t));
  if (tA.length && tB.length) {
    s -= 0.35;
    ev.push(`different targets (${tA.join(',')} vs ${tB.join(',')}) - likely a series`);
  }

  // For PRs, an identical changed-file set is near-conclusive: it is the same
  // edit. This is what separates #909/#853 (same two files, real duplicate)
  // from #948/#931 (same author and shape, different test files).
  if (a.kind === 'PR' && b.kind === 'PR') {
    const { j } = fileJaccard(a, b);
    if (j >= 0.99) { s += 0.25; ev.push('identical changed-file set'); }
    else if (j === 0) { s -= 0.2; ev.push('no shared files'); }
  }
  return { score: Math.max(0, Math.min(1, s)), ev };
}

/**
 * COLLISION risk: different work, same lines, will conflict on merge.
 * A maintainer sequences these rather than closing either.
 */
function collisionScore(a, b) {
  if (a.kind !== 'PR' || b.kind !== 'PR') return { score: 0, ev: [] };
  if (a.state !== 'OPEN' || b.state !== 'OPEN') return { score: 0, ev: [] };
  const { j, shared, weight } = fileJaccard(a, b);
  if (shared.length === 0) return { score: 0, ev: [] };
  const ev = [`${shared.length} shared file${shared.length > 1 ? 's' : ''}: ${shared.slice(0, 3).join(', ')}${shared.length > 3 ? ', …' : ''}`];
  // One shared file is weak evidence on its own (#725/#487 share only README.md).
  let s = shared.length >= 2 ? 0.5 + 0.4 * j : 0.25 * j;
  if (weight / shared.length >= 4) { s += 0.1; ev.push('rarely-touched files'); }
  return { score: Math.min(1, s), ev };
}

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

const md = `# otelc-prior-art backfill report

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

Known limits, measured in \`npm run eval\`:
- Retrieval surfaces ${'16/30'} labelled negative pairs inside the top 5. Ranking cannot
  separate "same file, different bug" from "same bug"; only reading the diff can.
- Closed items are indexed on purpose. #512 was closed as "Duplicate of #161" and
  that link is the only way to see #817 is the third instance of the same bug.
`;

writeFileSync(join(ROOT, 'REPORT.md'), md);
console.log(`likely-duplicates=${dups.length} merge-collisions=${cols.length}`);
console.log('wrote REPORT.md');
