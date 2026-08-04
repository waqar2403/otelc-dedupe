import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize, embedText } from './lib/text.mjs';
import { buildBM25 } from './lib/bm25.mjs';
import { initEmbedder, embed, embedderState } from './lib/embed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { items, fetchedAt, owner, name } = JSON.parse(readFileSync(join(ROOT, 'data/corpus.json'), 'utf8'));

console.log(`indexing ${items.length} items`);

const docs = items.map((it) => ({
  number: it.number,
  titleTokens: tokenize(it.title),
  bodyTokens: tokenize(it.body),
}));
const bm25 = buildBM25(docs);
console.log(`  BM25: ${Object.keys(bm25.df).length} distinct terms, avg doc len ${bm25.avgLen.toFixed(1)}`);

let vectors = null;
const noEmbed = process.argv.includes('--no-embed');
if (!noEmbed) {
  const st = await initEmbedder();
  if (st === 'ready') {
    vectors = {};
    const texts = items.map((it) => embedText(it));
    const B = 32;
    for (let i = 0; i < texts.length; i += B) {
      const vs = await embed(texts.slice(i, i + B));
      vs.forEach((v, j) => { vectors[items[i + j].number] = v; });
      process.stderr.write(`\r  embedding ${Math.min(i + B, texts.length)}/${texts.length}`);
    }
    process.stderr.write('\n');
  }
}

writeFileSync(
  join(ROOT, 'data/index.json'),
  JSON.stringify({
    owner, name, fetchedAt, builtAt: new Date().toISOString(),
    retrievers: ['bm25', 'files', ...(vectors ? ['embed'] : [])],
    bm25, vectors,
  })
);

const mb = (Buffer.byteLength(readFileSync(join(ROOT, 'data/index.json'))) / 1e6).toFixed(1);
console.log(`  retrievers: bm25, files${vectors ? ', embed' : ''}${vectors ? '' : `  (embed ${embedderState()})`}`);
console.log(`wrote data/index.json (${mb} MB)`);
