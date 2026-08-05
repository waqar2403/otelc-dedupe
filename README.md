# otelc-dedupe

Finds work that already exists in
[`open-telemetry/opentelemetry-go-compile-instrumentation`](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation)
before you file a duplicate.

Two ways to use it:

```bash
npm run report    # batch: scan every open item, write REPORT.md
npm run serve     # web UI on http://localhost:3000
```

No dependencies. Node 20+. Deploys to Vercel as a static page plus two
serverless functions — see [Deploying](#deploying).

## Why

The repo has a confirmed duplicate problem. A maintainer closed
[#512](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/512)
as *"Duplicate of #161"*, and
[#817](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/817)
was filed one day later as the third instance of the same bug. #161 is still open.

The batch report also found three open items duplicating work that had **already been
merged** — #842, #905 and #909 all restate a fix that landed in #844 and #853.

## How it works

```
GitHub GraphQL  ->  all issues + PRs, open and closed  ->  data/index.json
                                    +                             |
GitHub REST     ->  everything filed since that snapshot  --------+
                                                              |
proposed text  ->  BM25  +  changed-file overlap  ->  RRF  ->  top 12
                                                              |
                                                     language model
                                                              |
                                          likelihood 0-100 per candidate
```

**Retrieval** is BM25 over title and body, with camelCase identifiers expanded so
`isSetup` matches `isSetup()`, plus changed-file Jaccard for pull requests. Fused by
Reciprocal Rank Fusion, which combines an unbounded BM25 score with a 0-1 similarity
without any normalisation to tune.

**Scoring** is a language model, because ranking cannot do it. Hand-written rules that
correctly rejected one deliberate series also rejected #903/#916 and #790/#939, which
are real duplicates. Telling a series apart from a duplicate needs meaning, not term
statistics.

Closed and merged items are indexed on purpose. Some of the most useful findings are
open items duplicating work that already landed, which an open-only comparison cannot see.

**Changed files** are the strongest signal for a pull request and the UI asks for
them in PR mode. They found #789/#883 — different titles, different bug reports,
verified `git merge` conflict — which no text-based retriever ranks.

## Freshness

A checker that cannot see this morning's issues is wrong exactly when it matters
most. #951 and #952 were filed hours after the 2026-08-04 snapshot; a draft of
that same issue got "no significant overlap found".

So the knowledge base is two layers:

| | |
|---|---|
| **base** | the committed snapshot, rebuilt weekly by `.github/workflows/index.yml` |
| **live** | everything created or edited since, pulled per request from GitHub's REST API, cached 5 minutes |

The delta is folded into the BM25 statistics **exactly**: a superseded document
has its terms subtracted from the document-frequency table and its length removed
from the average before the replacement goes in, so IDF matches a full rebuild.
`npm run selftest` verifies this by rebuilding and comparing — IDF is the whole
reason `isSetup` outweighs `fix`, and a drifting `df` table would degrade ranking
quietly.

It costs nothing: GitHub's API is free and no extra model calls are involved.
It needs `GITHUB_TOKEN` (locally it falls back to `gh auth token`). New items are
tagged `LIVE` in the results, and the header states the snapshot date, when the
tail was last checked, and how many items are new — so the blind spot is visible
rather than guessed at.

Set `OTELC_LIVE=0` to turn it off and search the snapshot alone.

## Deploying

```bash
vercel --prod
```

Static page from `public/`, two functions from `api/`. `vercel.json` handles the
parts zero-config gets wrong: `includeFiles: "data/**"` (Vercel's tracer does not
follow `readFileSync` paths, and without it the function ships with no corpus),
`maxDuration: 60` (the judge takes 5-20s), and `--omit=optional` to keep the
unused embedding package out of the bundle.

**Set these before the first deploy:**

| | |
|---|---|
| `DEEPSEEK_API_KEY` | enables scoring |
| `GITHUB_TOKEN` | a read-only PAT; enables the live layer |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Vercel KV or Upstash — **see below**. Injected by the integration; any prefix works. |

Rate limits and the daily cap used to live in a `Map`. On one long-running
process that is correct; on serverless it is not a limit at all, because every
cold instance starts at zero. With KV configured the counters are shared, and
there is a hard monthly ceiling on top:

```
one 12-candidate check   $0.000488
$3.00/month cap        ~ 6,100 checks
```

Without KV the caps are per-instance and the prepaid provider balance is the only
real ceiling. `/api/health` reports `limiter: "memory"` when that is the case, and
`npm run selftest` warns about it.

## Measured

Judge, 14 labelled cases from this repo's real history:

| | n | mean likelihood | range |
|---|---|---|---|
| Real duplicates | 7 | 93.6 | 90–95 |
| Deliberately distinct | 7 | 10.0 | 10–10 |

Ranges are disjoint. Any threshold between 15 and 89 gives 100% accuracy.
About $0.0006 per check.

Retrieval, separately: 7/7 recall on the labelled positives, and it retrieves
#161 for #817 despite near-disjoint vocabulary.

```bash
npm run eval          # retrieval: hard gates, recall, false-positive load
npm run judge-eval    # scoring: separation and calibration (needs an API key)
```

## Limits

- The model is bimodal. Across 28 calls it only ever returned 95, 90, 10 or 5. The
  40–89 bands were empty, so there is **no evidence about how it scores genuinely
  ambiguous pairs**. The UI says so rather than implying a 60 means something.
- All 14 eval cases are clear-cut and hand-picked.
- It only helps people who use it. Someone filing straight on GitHub is not covered;
  the batch report is what catches those, after the fact.
- Rate limiting is in-process unless a KV store is configured. Fine for one
  long-running server, useless on serverless — see [Deploying](#deploying).
- Embeddings are wired up but off: `data/index.json` ships `vectors: null`, so the
  live retrievers are BM25 and changed-file overlap only. They did not earn their
  keep and the code that would run them is dormant.
- Candidate text comes from GitHub issue bodies, which anyone can write. The judge's
  output is validated against the candidate set and the verdict enum, so a crafted
  body can at worst skew one likelihood — it cannot inject markup or invent an issue.

Full review, including everything found and fixed: [REVIEW.md](REVIEW.md).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | Enables scoring. Without it you get retrieval only. |
| `OTELC_PROVIDER` | `deepseek` | `deepseek` or `groq` |
| `OTELC_MODEL` | `deepseek-v4-flash` | Model override |
| `OTELC_THINKING` | off | Enable model reasoning. Costs ~2.4x for no measured accuracy gain. |
| `GITHUB_TOKEN` | `gh auth token` | Enables the live layer. Read-only scope is enough. |
| `OTELC_LIVE` | on | `0` disables the live layer; the snapshot alone is searched. |
| `OTELC_LIVE_TTL_MS` | `300000` | How long a fetched tail is reused. |
| `OTELC_MONTHLY_USD` | `3` | Hard spend ceiling, charged from actual token usage. |
| `OTELC_GLOBAL_DAY` | `300` | Checks per day on the shared key. |
| `OTELC_PER_IP_HOUR` / `_DAY` | `20` / `60` | Per-caller limits. |
| `KV_REST_API_URL` / `_TOKEN` | — | Vercel KV or Upstash. Required for the caps to hold on serverless. Any `<PREFIX>_REST_API_URL` + `_TOKEN` pair is picked up, so a custom integration prefix works too. |
| `PORT` | `3000` | |

Never commit a key. Pass it in the environment, or send `x-api-key` per request.

### A note on DeepSeek v4

`deepseek-v4-*` are reasoning models and **reasoning tokens share the `max_tokens`
budget with the answer**. At `max_tokens: 900` the model spent all 900 reasoning and
returned empty content, so every score was dropped and the tool reported "nothing
found" — the most dangerous possible wrong answer. Reasoning is disabled by default
and the client now throws on empty content instead of returning nothing.

## Layout

```
scripts/lib/api.mjs    analyze() + health(), transport-independent
server.mjs             node:http adapter, serves public/
api/analyze.mjs        Vercel adapter
api/health.mjs         Vercel adapter

scripts/lib/kb.mjs     base snapshot + live delta -> one searchable store
scripts/lib/live.mjs   GitHub tail fetch, TTL cache, graceful degradation
scripts/lib/limits.mjs rate limits and spend ceiling, KV-backed when available

scripts/fetch.mjs      GraphQL, full pagination, open and closed
scripts/index.mjs      BM25/IDF table -> data/index.json
scripts/report.mjs     batch scan -> REPORT.md
scripts/eval.mjs       retrieval eval
scripts/judge-eval.mjs scoring eval
scripts/selftest.mjs   pre-deploy preflight, spends nothing
eval/dataset.json      labelled ground truth
```

`.github/workflows/index.yml` rebuilds the base index weekly and commits it, which
is also what triggers a redeploy. `report.yml` regenerates REPORT.md nightly and
commits only that — the index is 5.5MB and committing it daily would add ~2GB of
history a year for a file the live layer already keeps current.

A long-running `server.mjs` reloads `data/` on change without a restart. Serverless
deployments are immutable, so there the redeploy is the reload.

## Licence

MIT
