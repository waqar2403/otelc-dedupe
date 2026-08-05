// Component breakdown of the open queue, written to COMPONENTS.md.
//
//   npm run components
//
// Exists so a claim about the backlog can be checked rather than trusted. The
// method is stated in the output, the counts are reproducible from the
// committed corpus, and the timestamp says exactly what moment it describes -
// which matters, because this repo closes double figures of items in an
// afternoon and a number from this morning is already wrong.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNoiseFile } from './lib/search.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cf = JSON.parse(readFileSync(join(ROOT, 'data/corpus.json'), 'utf8'));
const REPO = `${cf.owner}/${cf.name}`;

const open = cf.items.filter((i) => i.state === 'OPEN');
const issues = open.filter((i) => i.kind === 'ISSUE');
const prs = open.filter((i) => i.kind === 'PR');
const withFiles = prs.filter((p) => p.files?.length);

/** Component of a path. Instrumentation collapses to one bucket plus a
 *  per-integration breakdown, since the integrations are individually small. */
function comp(f) {
  let m;
  if (/^instrumentation\//.test(f)) return 'instrumentation';
  if ((m = f.match(/^tool\/(?:internal\/)?([^/]+)/))) return `tool/${m[1]}`;
  if (/^pkg\//.test(f)) return 'pkg/runtime';
  if (/^docs\//.test(f)) return 'docs';
  if (/^test\//.test(f)) return 'test/e2e';
  if (/^\.github\//.test(f)) return 'ci';
  if (/^(scripts|\.tools)\//.test(f)) return 'build';
  if (/^demo\//.test(f)) return 'demo';
  if (/^schemas\//.test(f)) return 'semconv';
  return null;
}

const integration = (f) => {
  const m = f.match(/^instrumentation\/(?:[^/]*\.[^/]*\/)?([^/]+)/);
  return m ? m[1] : null;
};

const tally = (items, fn) => {
  const h = new Map();
  for (const p of items) {
    for (const c of new Set(p.files.filter((f) => !isNoiseFile(f)).map(fn).filter(Boolean))) {
      h.set(c, (h.get(c) || 0) + 1);
    }
  }
  return [...h.entries()].sort((a, b) => b[1] - a[1]);
};

const comps = tally(withFiles, comp);
const integs = tally(withFiles, integration);
const bundle = withFiles.filter((p) => p.files.includes('tool/data/otelc-bundle.tgz')).length;

const md = `# Component breakdown of the open queue

\`${REPO}\` — snapshot **${cf.fetchedAt.slice(0, 16).replace('T', ' ')} UTC**

**${open.length} open** (${issues.length} issues, ${prs.length} pull requests).
${withFiles.length} of the ${prs.length} open PRs carry changed-file data; the
${issues.length} issues carry none, which is why a path-based rule can label PRs
but not issues.

## Method

- Counts are **PR/component matches, not PRs**. A PR touching \`tool/ast\` and
  \`docs\` is counted in both, so the column sums to more than ${withFiles.length}.
- Generated artifacts are excluded. ${bundle} of ${withFiles.length} open PRs touch
  \`tool/data/otelc-bundle.tgz\`, an embedded build output — counting it would make
  it the largest "component" in the repo and mean nothing.
- Reproduce with \`npm run components\` against \`data/corpus.json\`, fetched from
  the GitHub GraphQL API with full pagination (\`scripts/fetch.mjs\`).
- The repo closes items quickly. A count from earlier the same day is already
  wrong, so the snapshot time above is part of the claim.

## Components

| component | PR matches |
|---|---:|
${comps.map(([k, v]) => `| \`${k}\` | ${v} |`).join('\n')}

## Instrumentation, by integration

${integs.length} integrations appear, ${integs.reduce((a, [, v]) => a + v, 0)} matches
total, at most ${Math.max(...integs.map(([, v]) => v))} for any single one.

| integration | PR matches |
|---|---:|
${integs.map(([k, v]) => `| \`${k}\` | ${v} |`).join('\n')}
`;

writeFileSync(join(ROOT, 'COMPONENTS.md'), md);
console.log(`open ${open.length} (${issues.length} issues, ${prs.length} PRs); ${comps.length} components, ${integs.length} integrations`);
console.log('wrote COMPONENTS.md');
