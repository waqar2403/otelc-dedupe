// Pre-deploy preflight. Checks everything that can be checked without spending
// money, so a broken deployment fails here rather than in front of a user.
//
//   npm run selftest
//
// Exits non-zero on any FAIL. WARNs are things that are fine locally and are
// not fine in production; they are listed at the end rather than failing, so
// this stays usable as a local smoke test.

import { getStore, getBase } from './lib/kb.mjs';
import { buildBM25 } from './lib/bm25.mjs';
import { tokenize } from './lib/text.mjs';
import { analyze, CAP } from './lib/api.mjs';
import { limiterKind, limiterSource } from './lib/limits.mjs';
import { PROVIDERS } from './lib/judge.mjs';

let fails = 0;
const warns = [];
const ok = (name, detail = '') => console.log(`  PASS  ${name}${detail ? `  ${detail}` : ''}`);
const bad = (name, detail) => { fails++; console.log(`  FAIL  ${name}  ${detail}`); };
const warn = (name, detail) => { warns.push(`${name}: ${detail}`); console.log(`  WARN  ${name}  ${detail}`); };

console.log('\notelc-dedupe selftest\n');

// ---- 1. the base snapshot loads -------------------------------------------
let base;
try {
  base = getBase();
  const ageDays = (Date.now() - new Date(base.meta.fetchedAt)) / 86400000;
  ok('base index loads', `${base.meta.count} items, fetched ${base.meta.fetchedAt.slice(0, 10)} (${ageDays.toFixed(1)}d ago)`);
  if (ageDays > 14) warn('base index age', `${ageDays.toFixed(0)} days old — the live tail may exceed its 300-item fetch cap`);
} catch (e) {
  bad('base index loads', e.message);
  process.exit(1);
}

// ---- 2. the live tail reaches GitHub --------------------------------------
const store = await getStore();
const live = store.meta.live;
if (!live.enabled) warn('live tail', 'disabled (OTELC_LIVE=0) — items filed since the snapshot are invisible');
else if (live.error) warn('live tail', `${live.error} — falling back to the snapshot alone`);
else {
  ok('live tail reachable', `${live.changed} changed since snapshot: +${live.added} new, ${live.updated} updated`);
  if (live.truncated) warn('live tail', 'hit the 300-item page cap — rebuild the base index');
}

// ---- 3. the incremental fold equals a full rebuild -------------------------
// This is the load-bearing claim of the whole live layer. If IDF drifts, the
// ranking quietly degrades between rebuilds and nothing else would notice.
{
  const full = buildBM25(store.corpus.map((i) => ({
    number: i.number, titleTokens: tokenize(i.title), bodyTokens: tokenize(i.body),
  })));
  const problems = [];
  if (full.N !== store.bm25.N) problems.push(`N ${store.bm25.N} vs ${full.N}`);
  if (Math.abs(full.avgLen - store.bm25.avgLen) > 1e-6) problems.push(`avgLen ${store.bm25.avgLen} vs ${full.avgLen}`);
  let dfDiff = 0;
  for (const t of new Set([...Object.keys(store.bm25.df), ...Object.keys(full.df)])) {
    if ((store.bm25.df[t] || 0) !== (full.df[t] || 0)) dfDiff++;
  }
  if (dfDiff) problems.push(`${dfDiff} document-frequency terms differ`);
  if (problems.length) bad('fold matches full rebuild', problems.join('; '));
  else ok('fold matches full rebuild', `N=${full.N}, ${Object.keys(full.df).length} terms, exact`);
}

// ---- 4. retrieval still finds the case the tool exists for -----------------
// #512 was closed as "Duplicate of #161"; #817 is the third instance. Their
// vocabulary barely overlaps, which is the hard case.
{
  const q = store.byNum.get(817);
  if (!q) warn('retrieval gate', '#817 not in corpus, skipped');
  else {
    const r = await analyze({ ip: 'selftest', input: { kind: 'ISSUE', title: q.title, body: q.body } });
    const nums = (r.body.candidates || []).map((c) => c.number);
    if (nums.includes(161) || nums.includes(512)) ok('retrieval gate #817', `found ${nums.filter((n) => n === 161 || n === 512).map((n) => `#${n}`).join(' ')}`);
    else bad('retrieval gate #817', `neither #161 nor #512 in top ${CAP.candidates}: ${nums.join(', ')}`);
  }
}

// ---- 5. the file retriever is reachable from the API -----------------------
// It was not: the web path hardcoded an empty file list, so the retriever that
// found #789/#883 never ran outside the batch report.
{
  const r = await analyze({
    ip: 'selftest',
    input: { kind: 'PR', title: 'chore: minor cleanup', body: 'small tidy-up',
             files: ['tool/internal/instrument/optimize.go'] },
  });
  const viaFiles = (r.body.candidates || []).filter((c) => c.retrieval?.from?.files);
  if (viaFiles.length) ok('file retriever reachable', `${viaFiles.length} hits: ${viaFiles.map((c) => `#${c.number}`).join(' ')}`);
  else bad('file retriever reachable', 'no candidate was matched by changed-file overlap');
}

// ---- 6. junk short-circuits before any paid call ---------------------------
{
  const r = await analyze({ ip: 'selftest', input: { kind: 'ISSUE', title: 'zzz qqq wobble frobnicate xyzzy', body: '' } });
  if (r.body.verdictSource === 'retrieval' && !r.body.candidates.length) ok('junk short-circuits', 'no paid call');
  else bad('junk short-circuits', `got ${r.body.candidates?.length} candidates via ${r.body.verdictSource}`);
}

// ---- 7. deployment posture ------------------------------------------------
const provider = process.env.OTELC_PROVIDER || 'deepseek';
if (!process.env[PROVIDERS[provider].env]) warn('judge', `no ${PROVIDERS[provider].env} — retrieval only, no scores`);
else ok('judge configured', provider);

if (limiterKind() === 'memory') {
  const near = Object.keys(process.env).filter((k) => /REDIS|UPSTASH|_KV_|^KV_|REST_API/.test(k));
  warn('limiter',
    'in-memory. Fine for one long-running process; on serverless every cold instance resets the counters.'
    + (near.length
      ? ` Found ${near.join(', ')} but no usable URL+TOKEN pair — check the integration's variable prefix.`
      : ' Connect Upstash Redis or Vercel KV.'));
} else {
  ok('limiter', `durable, credentials from ${limiterSource()}`);
}
ok('caps', `${CAP.perIpHour}/ip/hr, ${CAP.perIpDay}/ip/day, ${CAP.globalDay}/day, $${CAP.monthlyUsd}/month`);

console.log(`\n${fails ? `${fails} FAILED` : 'all checks passed'}${warns.length ? `, ${warns.length} warning${warns.length > 1 ? 's' : ''}` : ''}\n`);
process.exit(fails ? 1 : 0);
