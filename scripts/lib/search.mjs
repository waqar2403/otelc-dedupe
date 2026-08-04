// Hybrid retrieval: BM25 + embeddings + changed-file overlap, fused by RRF.
//
// The third retriever is not in the original plan and is the highest-precision
// signal available for PRs. It found #789/#883 (different titles, different bug
// reports, verified `git merge` conflict) which no text-based retriever ranks.

import { tokenize } from './text.mjs';
import { bm25Search } from './bm25.mjs';
import { vectorSearch } from './embed.mjs';

const RRF_K = 60;

/** Files that co-occur incidentally and imply nothing about duplication. */
export function isNoiseFile(f) {
  return (
    f === 'tool/data/otelc-bundle.tgz' ||
    f.endsWith('go.mod') ||
    f.endsWith('go.sum') ||
    f === 'Makefile' ||
    f.startsWith('.github/workflows') ||
    f.includes('/testdata/golden/')
  );
}

export function fileOverlapSearch(corpus, queryFiles, { exclude = new Set() } = {}) {
  const qf = new Set((queryFiles || []).filter((f) => !isNoiseFile(f)));
  if (qf.size === 0) return [];
  const out = [];
  for (const item of corpus) {
    if (exclude.has(item.number)) continue;
    const cf = new Set((item.files || []).filter((f) => !isNoiseFile(f)));
    if (cf.size === 0) continue;
    let inter = 0;
    for (const f of qf) if (cf.has(f)) inter++;
    if (!inter) continue;
    const jac = inter / (qf.size + cf.size - inter);
    out.push({ number: item.number, score: jac, shared: [...qf].filter((f) => cf.has(f)) });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Reciprocal Rank Fusion. Rank-only, so an unbounded BM25 score and a 0-1
 *  cosine combine with nothing to normalise or retune per repo. */
export function rrf(rankedLists, { k = RRF_K, limit = 20 } = {}) {
  const acc = new Map();
  for (const { name, list } of rankedLists) {
    list.forEach((hit, i) => {
      const cur = acc.get(hit.number) || { number: hit.number, score: 0, from: {} };
      cur.score += 1 / (k + i + 1);
      cur.from[name] = { rank: i + 1, raw: hit.score, ...(hit.shared ? { shared: hit.shared } : {}) };
      acc.set(hit.number, cur);
    });
  }
  return [...acc.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * @param query {{ title, body, files? }}
 * @returns fused candidates, each annotated with which retrievers found it.
 */
export function search(store, query, { limit = 20, exclude = new Set(), topN = 50 } = {}) {
  const qTokens = [
    ...tokenize(query.title).flatMap((t) => [t, t, t]), // mirrors BM25 title boost
    ...tokenize(query.body || ''),
  ];

  const lists = [];
  lists.push({ name: 'bm25', list: bm25Search(store.bm25, qTokens, { exclude }).slice(0, topN) });

  if (store.vectors && query.vector) {
    lists.push({ name: 'embed', list: vectorSearch(store.vectors, query.vector, { exclude }).slice(0, topN) });
  }
  const fileHits = fileOverlapSearch(store.corpus, query.files, { exclude });
  if (fileHits.length) lists.push({ name: 'files', list: fileHits.slice(0, topN) });

  return rrf(lists, { limit });
}
