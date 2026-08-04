// Local embeddings via transformers.js. Optional by design: the whole pipeline
// runs without it, and the eval reports which retrievers were actually active
// so a lexical-only run is never silently mistaken for a hybrid one.

let pipe = null;
let state = 'cold';

export async function initEmbedder({ quiet = false } = {}) {
  if (state === 'ready' || state === 'unavailable') return state;
  try {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    if (!quiet) process.stderr.write('  loading all-MiniLM-L6-v2 (first run downloads ~30MB)\n');
    pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' });
    state = 'ready';
  } catch (err) {
    if (!quiet) {
      process.stderr.write(
        `  embeddings unavailable (${err.message.split('\n')[0]})\n` +
        '  install with: npm i @huggingface/transformers\n'
      );
    }
    state = 'unavailable';
  }
  return state;
}

export function embedderState() { return state; }

export async function embed(texts) {
  if (state !== 'ready') return null;
  const out = [];
  for (const t of texts) {
    const r = await pipe(t, { pooling: 'mean', normalize: true });
    out.push(Array.from(r.data));
  }
  return out;
}

export function cosine(a, b) {
  // Vectors are stored L2-normalised, so dot product is the cosine.
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function vectorSearch(vectors, qvec, { exclude = new Set() } = {}) {
  if (!qvec) return [];
  const out = [];
  for (const [num, v] of Object.entries(vectors)) {
    const n = Number(num);
    if (exclude.has(n)) continue;
    out.push({ number: n, score: cosine(v, qvec) });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
