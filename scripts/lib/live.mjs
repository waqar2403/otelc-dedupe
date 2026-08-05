// Live delta layer: everything filed or edited since the base index was built.
//
// The base index is a snapshot. Between rebuilds it is blind to exactly the
// items a duplicate checker most needs to see - the ones opened in the last few
// hours. #951/#952 (a stale-docs issue and its PR) were filed within a day of
// the 2026-08-04 snapshot and were invisible to the whole pipeline.
//
// So: pull the tail at request time. GitHub's issues endpoint accepts `since`
// (filters on updated_at) and returns issues AND pull requests in one call, so
// one request covers the whole tail. It is free, it is cached in module scope
// with a TTL, and it degrades to "base index only" on any failure rather than
// taking the checker down.

import { execSync } from 'node:child_process';

const API = 'https://api.github.com';
const MAX_PAGES = 3;          // 300 items. More than that means a rebuild is due.
const MAX_PR_FILE_FETCH = 40; // changed files cost one GraphQL request per batch

// A slow GitHub must not become a slow duplicate check. Past this the request
// falls back to the base snapshot, which is the pre-existing behaviour rather
// than a failure.
const FETCH_TIMEOUT_MS = Number(process.env.OTELC_LIVE_TIMEOUT_MS || 6000);
const deadline = () => AbortSignal.timeout(FETCH_TIMEOUT_MS);

let cached = { at: 0, key: '', data: null };
let inflight = null;
let lastError = null;

/** Local dev convenience. Never shells out inside a serverless function. */
function resolveToken(explicit) {
  if (explicit) return explicit;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.VERCEL || process.env.CI) return null;
  try { return execSync('gh auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

const headers = (token) => ({
  accept: 'application/vnd.github+json',
  'user-agent': 'otelc-dedupe',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

/** REST issue/PR node -> the same shape scripts/fetch.mjs writes into the corpus. */
function normalise(n) {
  const isPR = !!n.pull_request;
  return {
    number: n.number,
    kind: isPR ? 'PR' : 'ISSUE',
    title: n.title || '',
    body: n.body || '',
    state: String(n.state || 'open').toUpperCase(),
    merged: isPR ? !!n.pull_request.merged_at : undefined,
    author: n.user?.login || 'ghost',
    createdAt: n.created_at,
    closedAt: n.closed_at || null,
    labels: (n.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
    // Filled in by enrichPullRequests; absent means "unknown", not "none".
    files: isPR ? undefined : undefined,
    closes: isPR ? [] : undefined,
    _live: true,
  };
}

/**
 * Changed files and closing references, which the REST listing does not carry.
 * One aliased GraphQL request for the whole batch rather than one call per PR.
 */
async function enrichPullRequests(owner, name, items, token) {
  const prs = items.filter((i) => i.kind === 'PR').slice(0, MAX_PR_FILE_FETCH);
  if (!prs.length || !token) return;

  const fields = prs
    .map((p) => `p${p.number}: pullRequest(number:${p.number}){ number merged files(first:100){nodes{path}} closingIssuesReferences(first:10){nodes{number}} }`)
    .join('\n');

  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    signal: deadline(),
    headers: { ...headers(token), 'content-type': 'application/json' },
    body: JSON.stringify({ query: `query{ repository(owner:"${owner}",name:"${name}"){ ${fields} } }` }),
  });
  if (!res.ok) return;                       // files are a bonus, not a requirement
  const j = await res.json();
  const repo = j.data?.repository;
  if (!repo) return;

  const byNum = new Map(items.map((i) => [i.number, i]));
  for (const v of Object.values(repo)) {
    if (!v?.number) continue;
    const it = byNum.get(v.number);
    if (!it) continue;
    it.files = (v.files?.nodes || []).map((f) => f.path);
    it.closes = (v.closingIssuesReferences?.nodes || []).map((x) => x.number);
    it.merged = !!v.merged;
  }
}

/**
 * Everything created or updated since `since`.
 * @returns {{ items, truncated, fetchedAt }}
 */
export async function fetchDelta({ owner, name, since, token }) {
  const out = [];
  let truncated = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${API}/repos/${owner}/${name}/issues`
      + `?state=all&sort=updated&direction=desc&per_page=100&page=${page}`
      + `&since=${encodeURIComponent(since)}`;
    const res = await fetch(url, { headers: headers(token), signal: deadline() });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`github ${res.status}: ${body.slice(0, 160)}`);
    }
    const page_ = await res.json();
    if (!Array.isArray(page_)) throw new Error('github returned a non-array listing');
    out.push(...page_.map(normalise));
    if (page_.length < 100) break;
    if (page === MAX_PAGES) truncated = true;
  }

  await enrichPullRequests(owner, name, out, token).catch(() => {});
  return { items: out, truncated, fetchedAt: new Date().toISOString() };
}

/**
 * Cached wrapper. Concurrent callers share one in-flight request, a stale
 * result is preferred over an error, and a cold failure yields an empty delta
 * so the base index still answers.
 *
 * @param base {{ owner, name, fetchedAt }}
 * @param opts {{ ttlMs, token, disabled }}
 */
export async function getDelta(base, opts = {}) {
  const ttl = opts.ttlMs ?? Number(process.env.OTELC_LIVE_TTL_MS || 300_000);
  const key = `${base.owner}/${base.name}@${base.fetchedAt}`;

  if (opts.disabled || process.env.OTELC_LIVE === '0') {
    return { items: [], disabled: true, fetchedAt: null, truncated: false, error: null };
  }
  if (cached.data && cached.key === key && Date.now() - cached.at < ttl) return cached.data;

  // Callers that only want to describe the tail, not search it, must never pay
  // for a GitHub round trip. /api/health was doing exactly that, which put a
  // 1-2s network hop (6s worst case) in front of the page's first paint on
  // every cold instance.
  if (opts.cachedOnly) {
    if (cached.data && cached.key === key) return cached.data;
    return { items: [], fetchedAt: null, truncated: false, error: null, disabled: false, pending: true };
  }

  if (inflight) return inflight;

  const token = resolveToken(opts.token);
  if (!token) {
    // Unauthenticated GitHub is 60 requests/hour keyed on the caller's IP.
    // Serverless functions share egress IPs, so this would fail unpredictably
    // rather than usefully. Refuse clearly instead.
    lastError = 'no GITHUB_TOKEN configured';
    const empty = { items: [], fetchedAt: null, truncated: false, error: lastError, disabled: false };
    cached = { at: Date.now(), key, data: empty };
    return empty;
  }

  inflight = (async () => {
    try {
      const d = await fetchDelta({ owner: base.owner, name: base.name, since: base.fetchedAt, token });
      lastError = null;
      const data = { ...d, error: null, disabled: false };
      cached = { at: Date.now(), key, data };
      return data;
    } catch (e) {
      lastError = e.message;
      // Serve the previous delta if we have one; a slightly old tail beats none.
      if (cached.data && cached.key === key) {
        cached = { at: Date.now(), key, data: { ...cached.data, error: lastError } };
        return cached.data;
      }
      const empty = { items: [], fetchedAt: null, truncated: false, error: lastError, disabled: false };
      cached = { at: Date.now() - ttl + 30_000, key, data: empty };  // retry in 30s, not on every request
      return empty;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function liveState() {
  return {
    cachedAt: cached.at || null,
    count: cached.data?.items.length ?? null,
    truncated: cached.data?.truncated ?? false,
    error: lastError,
  };
}

/** Test seam. */
export function resetLiveCache() {
  cached = { at: 0, key: '', data: null };
  inflight = null;
  lastError = null;
}
