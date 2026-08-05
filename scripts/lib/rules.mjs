// The mechanical scorer: everything that can be decided from term statistics,
// changed files, authorship and timing, with no model in the loop.
//
// Extracted from report.mjs unchanged so it can be measured head-to-head
// against the judge (scripts/rules-vs-judge.mjs). The interesting question is
// not "do rules work" - they carry the batch report on their own - but where
// exactly they stop working, and that needs both scorers on the same cases.

import { tokenize } from './text.mjs';
import { isNoiseFile } from './search.mjs';

export const normTitle = (t) => t.replace(/^\w+(\([^)]*\))?:\s*/, '').toLowerCase().trim();

export function titleSim(a, b) {
  const ta = new Set(tokenize(normTitle(a.title)));
  const tb = new Set(tokenize(normTitle(b.title)));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export const daysApart = (a, b) =>
  Math.abs(new Date(a.createdAt) - new Date(b.createdAt)) / 86400000;

/** True when one item is the PR that closes the other, or vice versa. */
export function isLinkedPair(a, b) {
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

/**
 * Builds the corpus-derived tables the scorers need: per-file document
 * frequency, and the vocabulary of instrumentation targets taken from the
 * repo's own instrumentation/ tree rather than hardcoded.
 */
export function makeRules(corpus) {
  const fileDF = new Map();
  for (const it of corpus) {
    for (const f of new Set((it.files || []).filter((x) => !isNoiseFile(x)))) {
      fileDF.set(f, (fileDF.get(f) || 0) + 1);
    }
  }
  const NPR = corpus.filter((i) => i.kind === 'PR').length;
  const fileIdf = (f) => Math.log(1 + NPR / (1 + (fileDF.get(f) || 0)));

  function fileJaccard(a, b) {
    const fa = new Set((a.files || []).filter((f) => !isNoiseFile(f)));
    const fb = new Set((b.files || []).filter((f) => !isNoiseFile(f)));
    if (!fa.size || !fb.size) return { j: 0, shared: [], weight: 0 };
    const shared = [...fa].filter((f) => fb.has(f));
    const weight = shared.reduce((s, f) => s + fileIdf(f), 0);
    return { j: shared.length / (fa.size + fb.size - shared.length), shared, weight };
  }

  // Two items naming DIFFERENT targets are a deliberate series, not a
  // duplicate: #201/#202/#203 are otelhttptrace / otelhttp / otelgrpc, and
  // #948 vs #931 is gRPC vs HTTP.
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

    // The self-refile pattern: one person files the same thing twice, days
    // apart. Both genuine self-duplicates in this repo (#903/#916, #790/#939)
    // look exactly like this.
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

    // Different named targets => deliberate series. Overrides the self-refile
    // boost, which otherwise scores these 100.
    const setA = new Set(tokenize(normTitle(a.title)));
    const setB = new Set(tokenize(normTitle(b.title)));
    const tA = [...setA].filter((t) => !setB.has(t)).filter((t) => TARGETS.has(t));
    const tB = [...setB].filter((t) => !setA.has(t)).filter((t) => TARGETS.has(t));
    if (tA.length && tB.length) {
      s -= 0.35;
      ev.push(`different targets (${tA.join(',')} vs ${tB.join(',')}) - likely a series`);
    }

    // For PRs, an identical changed-file set is near-conclusive: it is the same
    // edit. This is what separates #909/#853 from #948/#931.
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

  return { duplicateScore, collisionScore, fileJaccard, fileIdf, TARGETS };
}
