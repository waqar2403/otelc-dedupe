// The knowledge base the checker searches: a committed base snapshot plus a
// live tail pulled from GitHub at request time.
//
// Two layers, because neither alone works:
//   base   947 items, BM25 table precomputed at build time. Cheap, but frozen
//          at whatever moment the last rebuild ran.
//   delta  everything created or edited since. Small, fetched on demand, and
//          folded into the same BM25 statistics so scores stay comparable.
//
// The fold is exact, not approximate. A superseded base document has its terms
// subtracted from the document-frequency table and its length removed from the
// average before the replacement is added, so IDF is identical to what a full
// rebuild would produce. That matters: IDF is the whole reason `isSetup` beats
// `fix`, and a drifting df table would quietly degrade ranking between rebuilds.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize } from './text.mjs';
import { buildEntry } from './bm25.mjs';
import { getDelta, liveState } from './live.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Vercel unpacks the function at /var/task with data/ alongside it; local runs
 *  resolve relative to this file. Try both rather than assume a layout. */
function dataDir() {
  const candidates = [
    join(HERE, '../../data'),
    join(process.cwd(), 'data'),
    '/var/task/data',
  ];
  for (const c of candidates) if (existsSync(join(c, 'index.json'))) return c;
  throw new Error(`data/index.json not found. Looked in: ${candidates.join(', ')}`);
}

let base = null;        // { corpus, bm25, vectors, meta, mtime }
let merged = null;      // { corpus, byNum, bm25, meta } - base + delta
let mergedKey = '';

function loadBase() {
  const dir = dataDir();
  const cf = JSON.parse(readFileSync(join(dir, 'corpus.json'), 'utf8'));
  const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  base = {
    corpus: cf.items,
    bm25: idx.bm25,
    vectors: idx.vectors,
    meta: {
      owner: cf.owner,
      name: cf.name,
      fetchedAt: cf.fetchedAt,
      builtAt: idx.builtAt || cf.fetchedAt,
      retrievers: idx.retrievers || ['bm25', 'files'],
      count: cf.items.length,
    },
    mtime: statSync(join(dir, 'index.json')).mtimeMs,
  };
  merged = null;
  mergedKey = '';
  return base;
}

/** Long-running server only: the nightly job rewrites data/ under a live
 *  process. Serverless deployments are immutable, so this is a no-op there. */
export function reloadBaseIfStale() {
  if (!base) return false;
  try {
    const m = statSync(join(dataDir(), 'index.json')).mtimeMs;
    if (m === base.mtime) return false;
    loadBase();
    return true;
  } catch { return false; }
}

export function getBase() {
  return base || loadBase();
}

export function baseMeta() {
  return getBase().meta;
}

/**
 * Fold the delta into the base BM25 statistics.
 * Returns a store shaped exactly like the base one, so search() is unchanged.
 */
function foldDelta(b, deltaItems) {
  if (!deltaItems.length) {
    return {
      corpus: b.corpus,
      byNum: new Map(b.corpus.map((i) => [i.number, i])),
      bm25: b.bm25,
      vectors: b.vectors,
      added: 0,
      updated: 0,
    };
  }

  const deltaNums = new Set(deltaItems.map((i) => i.number));
  const baseByNum = new Map(b.corpus.map((i) => [i.number, i]));

  // A delta item can be an edit of something already indexed, in which case the
  // stale posting list has to come out before the fresh one goes in.
  const supersededEntries = b.bm25.entries.filter((e) => deltaNums.has(e.number));
  const keptEntries = b.bm25.entries.filter((e) => !deltaNums.has(e.number));

  const df = { ...b.bm25.df };
  let totalLen = b.bm25.avgLen * b.bm25.N;

  for (const e of supersededEntries) {
    totalLen -= e.len;
    for (const t of Object.keys(e.tf)) {
      const v = (df[t] || 0) - 1;
      if (v <= 0) delete df[t]; else df[t] = v;
    }
  }

  const newEntries = [];
  for (const it of deltaItems) {
    const e = buildEntry({
      number: it.number,
      titleTokens: tokenize(it.title),
      bodyTokens: tokenize(it.body),
    });
    totalLen += e.len;
    for (const t of Object.keys(e.tf)) df[t] = (df[t] || 0) + 1;
    newEntries.push(e);
  }

  const N = b.bm25.N - supersededEntries.length + deltaItems.length;

  // A delta item may carry less than the base does - the REST listing has no
  // changed-file list for PRs when the enrichment call was skipped or failed.
  // Merge field-wise so a live update never deletes information we already had.
  const corpus = [];
  for (const it of b.corpus) if (!deltaNums.has(it.number)) corpus.push(it);
  for (const it of deltaItems) {
    const prev = baseByNum.get(it.number);
    corpus.push(prev ? { ...prev, ...stripUndefined(it) } : it);
  }
  corpus.sort((a, b_) => a.number - b_.number);

  return {
    corpus,
    byNum: new Map(corpus.map((i) => [i.number, i])),
    bm25: { N, avgLen: totalLen / Math.max(1, N), df, entries: [...keptEntries, ...newEntries] },
    vectors: b.vectors,
    added: deltaItems.filter((i) => !baseByNum.has(i.number)).length,
    updated: supersededEntries.length,
  };
}

const stripUndefined = (o) => {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
};

/**
 * The store to search. Refreshes the live tail at most once per TTL and
 * rebuilds the folded index only when the tail actually changed.
 */
export async function getStore(opts = {}) {
  const b = getBase();
  const delta = await getDelta(b.meta, opts);

  // Cheap identity for "has the tail changed": count plus the newest timestamp
  // GitHub reported. Re-folding 947 posting lists on every request would be
  // wasteful; re-folding when nothing moved would be pointless.
  const key = `${b.mtime}|${delta.items.length}|${delta.items[0]?.number ?? ''}|${delta.fetchedAt ?? ''}`;
  if (merged && mergedKey === key) return merged;

  const store = foldDelta(b, delta.items);
  store.meta = {
    ...b.meta,
    live: {
      // Carried here so a caller holding only `freshness` can still say what
      // the snapshot underneath it is.
      indexedAt: b.meta.fetchedAt,
      enabled: !delta.disabled,
      error: delta.error,
      truncated: delta.truncated,
      checkedAt: delta.fetchedAt,
      changed: delta.items.length,
      added: store.added,
      updated: store.updated,
    },
    count: store.corpus.length,
  };
  merged = store;
  mergedKey = key;
  return store;
}

export { liveState };
