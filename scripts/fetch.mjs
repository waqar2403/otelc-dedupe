// Pulls the FULL corpus: issues + PRs, open AND closed, fully paginated.
// Closed items matter: #512 was closed as "Duplicate of #161", and that link is
// the only reason #817 is identifiable as the third instance of the same bug.

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = process.env.SCOUT_OWNER || 'open-telemetry';
const NAME = process.env.SCOUT_REPO || 'opentelemetry-go-compile-instrumentation';

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return execSync('gh auth token', { encoding: 'utf8' }).trim(); }
  catch { throw new Error('No GITHUB_TOKEN and `gh auth token` failed. Run `gh auth login`.'); }
}

const TOK = token();

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${TOK}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

const ISSUE_Q = `
query($owner:String!,$name:String!,$cursor:String){
  repository(owner:$owner,name:$name){
    issues(first:100,after:$cursor,orderBy:{field:CREATED_AT,direction:ASC}){
      pageInfo{hasNextPage endCursor}
      nodes{
        number title body state createdAt closedAt
        author{login}
        labels(first:20){nodes{name}}
        stateReason
        timelineItems(first:10,itemTypes:[CLOSED_EVENT]){nodes{... on ClosedEvent{createdAt}}}
      }
    }
  }
}`;

const PR_Q = `
query($owner:String!,$name:String!,$cursor:String){
  repository(owner:$owner,name:$name){
    pullRequests(first:50,after:$cursor,orderBy:{field:CREATED_AT,direction:ASC}){
      pageInfo{hasNextPage endCursor}
      nodes{
        number title body state createdAt closedAt merged
        author{login}
        labels(first:20){nodes{name}}
        files(first:100){nodes{path}}
        closingIssuesReferences(first:10){nodes{number}}
      }
    }
  }
}`;

async function pageAll(query, pick) {
  const out = [];
  let cursor = null;
  for (;;) {
    const d = await gql(query, { owner: OWNER, name: NAME, cursor });
    const conn = pick(d.repository);
    out.push(...conn.nodes);
    process.stderr.write(`\r  fetched ${out.length}`);
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  process.stderr.write('\n');
  return out;
}

console.log(`fetching ${OWNER}/${NAME}`);
console.log('issues:');
const issues = await pageAll(ISSUE_Q, (r) => r.issues);
console.log('pull requests:');
const prs = await pageAll(PR_Q, (r) => r.pullRequests);

const norm = (n, kind) => ({
  number: n.number,
  kind,
  title: n.title,
  body: n.body || '',
  state: n.state,
  merged: kind === 'PR' ? !!n.merged : undefined,
  author: n.author?.login || 'ghost',
  createdAt: n.createdAt,
  closedAt: n.closedAt || null,
  labels: (n.labels?.nodes || []).map((l) => l.name),
  files: kind === 'PR' ? (n.files?.nodes || []).map((f) => f.path) : undefined,
  // Issues this PR declares it closes. An issue and the PR fixing it share
  // title and files by design; without this they dominate the report.
  closes: kind === 'PR' ? (n.closingIssuesReferences?.nodes || []).map((x) => x.number) : undefined,
});

const corpus = [
  ...issues.map((n) => norm(n, 'ISSUE')),
  ...prs.map((n) => norm(n, 'PR')),
].sort((a, b) => a.number - b.number);

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(
  join(ROOT, 'data/corpus.json'),
  JSON.stringify({ owner: OWNER, name: NAME, fetchedAt: new Date().toISOString(), items: corpus }, null, 0)
);

const open = corpus.filter((c) => c.state === 'OPEN').length;
console.log(`\ncorpus: ${corpus.length} items (${issues.length} issues, ${prs.length} PRs), ${open} open`);
console.log(`wrote data/corpus.json`);
