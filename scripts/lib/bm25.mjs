// BM25 with a title boost. IDF is the whole point: it is what stops
// `add` / `fix` / `test` weighing the same as `isSetup` or `canFlattenTJump`.

const K1 = 1.2;
const B = 0.75;
const TITLE_BOOST = 3;

/** One posting list. Exported so the live delta can build entries that are
 *  scored on exactly the same footing as the ones baked into the index. */
export function buildEntry({ number, titleTokens, bodyTokens }) {
  const tf = new Map();
  const add = (toks, weight) => {
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + weight);
  };
  add(titleTokens, TITLE_BOOST);
  add(bodyTokens || [], 1);
  const len = [...tf.values()].reduce((a, b) => a + b, 0);
  return { number, tf: Object.fromEntries(tf), len };
}

export function buildBM25(docs) {
  // docs: [{ number, titleTokens, bodyTokens }]
  const df = new Map();
  const entries = [];
  let totalLen = 0;

  for (const d of docs) {
    const e = buildEntry(d);
    totalLen += e.len;
    for (const t of Object.keys(e.tf)) df.set(t, (df.get(t) || 0) + 1);
    entries.push(e);
  }

  return {
    N: docs.length,
    avgLen: totalLen / Math.max(1, docs.length),
    df: Object.fromEntries(df),
    entries,
  };
}

export function bm25Search(idx, queryTokens, { exclude = new Set() } = {}) {
  const qtf = new Map();
  for (const t of queryTokens) qtf.set(t, (qtf.get(t) || 0) + 1);

  const scores = [];
  for (const e of idx.entries) {
    if (exclude.has(e.number)) continue;
    let s = 0;
    for (const [t] of qtf) {
      const f = e.tf[t];
      if (!f) continue;
      const n = idx.df[t] || 0;
      // Robertson/Sparck-Jones IDF, floored so common terms cannot go negative.
      const idf = Math.max(0.01, Math.log(1 + (idx.N - n + 0.5) / (n + 0.5)));
      s += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * e.len) / idx.avgLen)));
    }
    if (s > 0) scores.push({ number: e.number, score: s });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores;
}
