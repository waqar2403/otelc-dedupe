# otelc-scout

Duplicate and overlap detection for
[`open-telemetry/opentelemetry-go-compile-instrumentation`](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation).

Batch tool. No server, no API keys, no per-request cost. Run it, read `REPORT.md`.

```bash
npm run all      # fetch -> index -> eval -> report
```

## Why this shape

The repo has 159 open items and a maintainer-confirmed duplicate problem: kakkoyun
closed [#512](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/512)
as *"Duplicate of #161"* on 2026-07-23, and
[#817](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/817)
was filed one day later as the third instance of the same bug. #161 is still open.

This started as a plan for a pre-submission web app with an LLM judge. Two
measurements killed that design:

1. **Retrieval is easy here.** At 947 documents, BM25 with camelCase identifier
   expansion gets 7/7 on the labelled positive set *and* passes the vocabulary-gap
   gate (#817 → #161 at rank 13). The embedding retriever that justified the whole
   hybrid architecture turned out not to be load-bearing.
2. **Rejection is hard.** 16 of 30 labelled negative pairs surface in the top 5.
   Ranking cannot tell "same file, different bug" from "same bug". A tool that
   showed a contributor a flat duplicate verdict would be wrong most of the time,
   against a base rate where genuine duplicates are maybe 5-10% of submissions.

So the output is a tiered report for maintainers to read, not a verdict for
contributors to obey. Tiers reflect signal strength, not confidence.

## How matching works

Three retrievers fused by Reciprocal Rank Fusion (`score = Σ 1/(60 + rank)`),
which needs no score normalisation between an unbounded BM25 score and a 0-1 cosine.

| Retriever | Catches |
|---|---|
| **BM25** over title+body, title boosted 3x, camelCase expanded | exact identifiers; `isSetup` matches `isSetup()` |
| **Changed-file Jaccard** (PRs) | collisions with no textual similarity at all |
| **MiniLM embeddings** (optional) | vocabulary gaps, if any survive tokenisation |

Embeddings are optional and off by default (`npm run index -- --no-embed` is the
default path). Install `@huggingface/transformers` to enable; the eval prints
which retrievers were active so a lexical run is never mistaken for a hybrid one.

### Precision rules

Learned from false positives in the first run, all encoded in `scripts/report.mjs`:

- **Issue ↔ its own PR is excluded.** They share title and files by design. Detected
  via `closingIssuesReferences` plus a `Fixes #N` body regex.
- **One shared file is never enough alone.** #725 and #487 both touch only
  `README.md` (Jaccard 1.0) and are unrelated. Needs a second file or lexical support.
- **Merged counterparts need lexical support.** #789 and #476 share `optimize.go`
  because everyone editing that function does. That is file history, not duplication.
- **Same-author pairs are demoted, never dropped.** Deliberate one-bug-per-PR series
  (linodego, anthropic) look identical to duplication by file overlap. But the two
  genuine self-duplicates in this repo (#903/#916, #790/#939) are also same-author.

## Eval

```bash
npm run eval                    # with whatever retrievers are built
npm run eval -- --lexical-only  # prove what BM25 alone does
```

Two things the original plan's eval could not measure:

- **The vocabulary-gap case is gated on its own.** Under an aggregate
  `recall@20 >= 7/8`, a build with a completely broken embedder still passes,
  because the other targets share literal identifiers (`file.Close`, `TestRunCmd`,
  `KeyData`). That gate cannot fail, so it tested nothing.
- **30 labelled negatives, not 2.** False positives are the failure that costs the
  project something: telling a first-time contributor their issue is a duplicate
  when it is not, in a repo where only 16% of July's new contributors returned in August.

## Layout

```
scripts/fetch.mjs      GraphQL, full pagination, issues + PRs, open AND closed
scripts/index.mjs      BM25/IDF table + optional embeddings -> data/index.json
scripts/report.mjs     batch backfill -> REPORT.md
scripts/eval.mjs       hard gates, recall, false-positive load
scripts/lib/           text, bm25, embed, search (RRF)
eval/dataset.json      labelled ground truth, verified against the live API
```

Closed items are indexed on purpose. Two of the five high-signal findings in the
first report are **open PRs duplicating already-merged work** (#811 vs merged #856,
#852 vs merged #774), which an open-only comparison structurally cannot see.

## Status

Retrieval, tiering, eval and report are done and measured. Not built: the LLM judge
and any web UI. Whether those are worth building depends on whether maintainers find
the report useful, which is the cheapest way to find out.
