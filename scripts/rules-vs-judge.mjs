// Rules vs judge, same 14 labelled pairs, same retrieval.
//
//   node scripts/rules-vs-judge.mjs            rules only, free, no key
//   node scripts/rules-vs-judge.mjs --judge    also call the judge and compare
//
// The honest question is not "can mechanical checks do this" - they carry the
// whole batch report already, with no model and no per-request cost. It is
// where they stop, and whether the cases they get wrong are ones anybody cares
// about. This puts both scorers on the same pairs and prints the disagreements.
//
// The rules are the ones in scripts/lib/rules.mjs, already tuned against this
// repo's history over several iterations, including a broader "each side has an
// exclusive rare term" rule that was tried and reverted.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { search } from './lib/search.mjs';
import { makeRules } from './lib/rules.mjs';
import { judge, PROVIDERS } from './lib/judge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cf = JSON.parse(readFileSync(join(ROOT, 'data/corpus.json'), 'utf8'));
const idx = JSON.parse(readFileSync(join(ROOT, 'data/index.json'), 'utf8'));
const { cases: CASES } = JSON.parse(readFileSync(join(ROOT, 'eval/judge-cases.json'), 'utf8'));

const corpus = cf.items;
const byNum = new Map(corpus.map((i) => [i.number, i]));
const store = { corpus, bm25: idx.bm25, vectors: idx.vectors };
const { duplicateScore } = makeRules(corpus);

const withJudge = process.argv.includes('--judge');
const PROVIDER = process.env.OTELC_PROVIDER || 'deepseek';
if (withJudge && !process.env[PROVIDERS[PROVIDER].env]) {
  console.error(`--judge needs ${PROVIDERS[PROVIDER].env}`);
  process.exit(1);
}

// The rules produce 0-1, the judge 0-100. Compare each against its own decision
// threshold rather than pretending the scales are the same. 0.35 is the cut
// report.mjs already ships for listing a pair as a likely duplicate.
const RULE_CUT = 0.35;
const JUDGE_CUT = 70;

console.log(`\nrules vs judge  ${CASES.length} labelled pairs${withJudge ? '' : '  (rules only; pass --judge to compare)'}\n`);

const rows = [];
for (const c of CASES) {
  const q = byNum.get(c.q);
  const t = byNum.get(c.t);
  if (!q || !t) { console.log(`  SKIP #${c.q}/#${c.t} not in corpus`); continue; }

  const hits = search(store, { title: q.title, body: q.body, files: q.files },
    { limit: 12, exclude: new Set([c.q]) });
  const hit = hits.find((h) => h.number === c.t);
  if (!hit) { console.log(`  RETRIEVAL MISS #${c.q} -> #${c.t}`); continue; }

  const r = duplicateScore(q, t, hit);
  const row = { ...c, rule: r.score, ev: r.ev, judgeL: null, judgeV: null };

  if (withJudge) {
    const cands = hits.map((h) => byNum.get(h.number)).filter(Boolean);
    try {
      const out = await judge({ title: q.title, body: q.body, kind: q.kind, files: q.files }, cands,
        { provider: PROVIDER, bodyCap: 600, maxTokens: 1500 });
      const v = out.results.find((x) => x.number === c.t);
      row.judgeL = v?.likelihood ?? null;
      row.judgeV = v?.verdict ?? null;
    } catch (e) { console.log(`  judge error on #${c.q}: ${e.message}`); }
  }
  rows.push(row);
}

const ruleSays = (r) => r.rule >= RULE_CUT;
const judgeSays = (r) => (r.judgeL ?? 0) >= JUDGE_CUT;

console.log('  want  pair          rules        verdict     judge');
console.log('  ----  ------------  -----------  ----------  -----');
for (const r of rows) {
  const rOK = ruleSays(r) === r.want;
  const jOK = r.judgeL === null ? null : judgeSays(r) === r.want;
  console.log(
    `  ${r.want ? 'DUP ' : 'DIST'}  #${String(r.q).padEnd(4)}->#${String(r.t).padEnd(4)}  ` +
    `${r.rule.toFixed(2)} ${rOK ? ' ok ' : 'MISS'}     ${(r.judgeV || '-').padEnd(11)} ` +
    `${r.judgeL === null ? '  -' : String(r.judgeL).padStart(3)} ${jOK === null ? '' : jOK ? ' ok' : ' MISS'}`
  );
  if (!rOK) console.log(`          rules said: ${r.ev.join('; ')}`);
}

const ruleAcc = rows.filter((r) => ruleSays(r) === r.want).length;
const judgeRows = rows.filter((r) => r.judgeL !== null);
const judgeAcc = judgeRows.filter((r) => judgeSays(r) === r.want).length;

console.log(`\n  rules  ${ruleAcc}/${rows.length} correct at >=${RULE_CUT}`);
if (judgeRows.length) console.log(`  judge  ${judgeAcc}/${judgeRows.length} correct at >=${JUDGE_CUT}`);

// The separation a threshold can achieve is the real question for the rules: if
// positives and negatives overlap, no cut fixes it and the ceiling is structural.
const pos = rows.filter((r) => r.want).map((r) => r.rule);
const neg = rows.filter((r) => !r.want).map((r) => r.rule);
console.log(`\n  rule scores  duplicates ${Math.min(...pos).toFixed(2)}-${Math.max(...pos).toFixed(2)}  |  distinct ${Math.min(...neg).toFixed(2)}-${Math.max(...neg).toFixed(2)}`);
const overlap = Math.min(...pos) <= Math.max(...neg);
console.log(`  overlap      ${overlap ? 'YES - no threshold separates these cleanly' : 'no - a threshold separates them'}`);

let best = { t: 0, acc: 0 };
for (let t = 0; t <= 1.0001; t += 0.05) {
  const acc = rows.filter((r) => (r.rule >= t) === r.want).length;
  if (acc > best.acc) best = { t, acc };
}
console.log(`  best cut     >=${best.t.toFixed(2)} gives ${best.acc}/${rows.length}`);

const misses = rows.filter((r) => ruleSays(r) !== r.want);
if (misses.length) {
  console.log('\n  where the rules land wrong:');
  for (const m of misses) {
    console.log(`    #${m.q} -> #${m.t}  (${m.want ? 'is' : 'is NOT'} a duplicate)  ${m.why}`);
  }
}
console.log();
