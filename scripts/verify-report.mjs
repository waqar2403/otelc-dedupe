// Turns the rules-only candidate list into a list you can stand behind.
//
//   DEEPSEEK_API_KEY=... node scripts/verify-report.mjs          judge locally
//   node scripts/verify-report.mjs --via https://your-app        judge over HTTP
//
// report.mjs scores mechanically, which is fast, free and wrong in one specific
// way: it reads a deliberate series as a re-file. #202/#201 (otelhttptrace vs
// otelhttp) scores 1.00 and is not a duplicate. Publishing that list as
// "duplicates" burns the credibility of every row that is right.
//
// So: take each open item the report anchors on, ask the judge, and keep only
// the pairs it confirms. Writes REPORT-VERIFIED.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { search } from './lib/search.mjs';
import { judge } from './lib/judge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cf = JSON.parse(readFileSync(join(ROOT, 'data/corpus.json'), 'utf8'));
const idx = JSON.parse(readFileSync(join(ROOT, 'data/index.json'), 'utf8'));
const corpus = cf.items;
const byNum = new Map(corpus.map((i) => [i.number, i]));
const store = { corpus, bm25: idx.bm25, vectors: idx.vectors };

const REPO = `${cf.owner}/${cf.name}`;
const url = (n) => `https://github.com/${REPO}/issues/${n}`;

const viaIdx = process.argv.indexOf('--via');
const VIA = viaIdx > -1 ? process.argv[viaIdx + 1].replace(/\/$/, '') : null;
const MIN_RULE = Number(process.env.MIN_RULE || 50);   // drop the low-confidence tail
const MIN_JUDGE = Number(process.env.MIN_JUDGE || 70); // the cut the UI ships

// ---- parse the rules-only report ------------------------------------------
const md = readFileSync(join(ROOT, 'REPORT.md'), 'utf8');
const dupSection = md.split('## Likely duplicates')[1].split('## Merge collisions')[0];
const pairs = dupSection.split('\n').filter((l) => l.startsWith('| **')).map((l) => {
  const score = Number(l.match(/\*\*(\d+)\*\*/)[1]);
  const nums = [...l.matchAll(/\[#(\d+)\]/g)].map((m) => Number(m[1]));
  const cells = l.split(' | ');
  return { rule: score, a: nums[0], b: nums[1], ev: cells[cells.length - 1].replace(/\|$/, '').trim() };
}).filter((p) => p.rule >= MIN_RULE);

const anchors = [...new Set(pairs.map((p) => p.a))];
console.log(`\n${pairs.length} candidate pairs at rule score >=${MIN_RULE}, ${anchors.length} open items to check\n`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function verdictsFor(item) {
  if (VIA) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await fetch(`${VIA}/api/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: item.kind,
          title: item.title.slice(0, 200),
          body: (item.body || '').slice(0, 4000),
          files: item.kind === 'PR' ? (item.files || []).slice(0, 60) : [],
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const wait = (60 - new Date().getUTCMinutes()) * 60_000 + 20_000;
        process.stderr.write(`\n  rate limited, waiting ${Math.round(wait / 60000)}m for the window\n`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`${res.status}: ${d.error || 'failed'}`);
      return (d.candidates || []).filter((c) => c.judgement)
        .map((c) => ({ number: c.number, ...c.judgement }));
    }
    throw new Error('rate limited repeatedly');
  }
  const hits = search(store, { title: item.title, body: item.body, files: item.files },
    { limit: 12, exclude: new Set([item.number]) });
  const cands = hits.map((h) => byNum.get(h.number)).filter(Boolean);
  const out = await judge({ title: item.title, body: item.body, kind: item.kind, files: item.files },
    cands, { bodyCap: 600, maxTokens: 1500 });
  return out.results;
}

// ---- verify ---------------------------------------------------------------
const kept = [], dropped = [];
let n = 0;
for (const a of anchors) {
  const item = byNum.get(a);
  process.stderr.write(`\r  checking ${++n}/${anchors.length}  #${a}          `);
  let verdicts;
  try { verdicts = await verdictsFor(item); }
  catch (e) { console.log(`\n  ERROR #${a}: ${e.message}`); continue; }

  for (const p of pairs.filter((x) => x.a === a)) {
    const v = verdicts.find((x) => x.number === p.b);
    const row = { ...p, judge: v?.likelihood ?? null, verdict: v?.verdict ?? null, reason: v?.reason ?? '' };
    // subsumes/subsumed_by are duplicates too: one covers the other's work.
    const isDup = row.judge !== null && row.judge >= MIN_JUDGE
      && ['duplicate', 'subsumed_by', 'subsumes'].includes(row.verdict);
    (isDup ? kept : dropped).push(row);
  }
}
process.stderr.write('\n');

// ---- write ----------------------------------------------------------------
const st = (i) => (i.state === 'OPEN' ? 'open' : i.merged ? 'merged' : 'closed');
const row = (r) => {
  const A = byNum.get(r.a), B = byNum.get(r.b);
  return `| **${r.judge}** | [#${r.a}](${url(r.a)}) ${A.kind} ${st(A)}<br>${A.title.slice(0, 64)} | [#${r.b}](${url(r.b)}) ${B.kind} ${st(B)}<br>${B.title.slice(0, 64)} | ${r.verdict.replace('_', ' ')} | ${r.reason} |`;
};
kept.sort((x, y) => y.judge - x.judge);

const out = `# Verified duplicates

\`${REPO}\`, ${corpus.length} items indexed (open and closed), ${corpus.filter((i) => i.state === 'OPEN').length} open.
Fetched ${cf.fetchedAt.slice(0, 10)}, verified ${new Date().toISOString().slice(0, 10)}.

Every pair below was surfaced by keyword and changed-file retrieval, then
confirmed by a language model as the same underlying work. Pairs the model
called a deliberate series, or scored below ${MIN_JUDGE}, were dropped — that is
the failure mode mechanical scoring cannot fix on its own, and it removed
${dropped.length} of the ${kept.length + dropped.length} candidates here.

**Still read both before closing anything.** This is a shortlist, not a ruling.

## Same work (${kept.length})

${kept.length
  ? `| score | A | B | relation | why |\n|---:|---|---|---|---|\n${kept.map(row).join('\n')}\n`
  : '_none survived verification_\n'}

## Dropped by the model (${dropped.length})

Ranked highly by the rules, rejected on reading. Mostly deliberate series: same
pattern, different target.

${dropped.length
  ? `| rule | judge | A | B | verdict |\n|---:|---:|---|---|---|\n${dropped
      .sort((x, y) => y.rule - x.rule)
      .map((r) => `| ${r.rule} | ${r.judge ?? '-'} | [#${r.a}](${url(r.a)}) | [#${r.b}](${url(r.b)}) | ${r.verdict || 'not returned'} |`)
      .join('\n')}\n`
  : '_none_\n'}
`;

writeFileSync(join(ROOT, 'REPORT-VERIFIED.md'), out);
console.log(`\n  kept ${kept.length}, dropped ${dropped.length}`);
console.log('  wrote REPORT-VERIFIED.md\n');
