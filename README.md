# otelc-dedupe

Finds work that already exists in
[`open-telemetry/opentelemetry-go-compile-instrumentation`](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation)
before you file a duplicate.

Two ways to use it:

```bash
npm run report    # batch: scan every open item, write REPORT.md
npm run serve     # web UI on http://localhost:3000
```

No dependencies. Node 20+.

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
- Rate limiting is in-process and resets on restart. Fine locally, not sufficient
  for a public deployment.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | Enables scoring. Without it you get retrieval only. |
| `OTELC_PROVIDER` | `deepseek` | `deepseek` or `groq` |
| `OTELC_MODEL` | `deepseek-v4-flash` | Model override |
| `OTELC_THINKING` | off | Enable model reasoning. Costs ~2.4x for no measured accuracy gain. |
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
server.mjs             web UI + /api/analyze
scripts/fetch.mjs      GraphQL, full pagination, open and closed
scripts/index.mjs      BM25/IDF table -> data/index.json
scripts/report.mjs     batch scan -> REPORT.md
scripts/eval.mjs       retrieval eval
scripts/judge-eval.mjs scoring eval
eval/dataset.json      labelled ground truth
```

The index refreshes nightly via GitHub Actions, and the server reloads it on change
without a restart.

## Licence

MIT
