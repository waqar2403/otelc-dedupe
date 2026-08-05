# Component breakdown of the open queue

`open-telemetry/opentelemetry-go-compile-instrumentation` — snapshot **2026-08-05 23:26 UTC**

**125 open** (73 issues, 52 pull requests).
52 of the 52 open PRs carry changed-file data; the
73 issues carry none, which is why a path-based rule can label PRs
but not issues.

## Method

- Counts are **PR/component matches, not PRs**. A PR touching `tool/ast` and
  `docs` is counted in both, so the column sums to more than 52.
- Generated artifacts are excluded. 18 of 52 open PRs touch
  `tool/data/otelc-bundle.tgz`, an embedded build output — counting it would make
  it the largest "component" in the repo and mean nothing.
- Reproduce with `npm run components` against `data/corpus.json`, fetched from
  the GitHub GraphQL API with full pagination (`scripts/fetch.mjs`).
- The repo closes items quickly. A count from earlier the same day is already
  wrong, so the snapshot time above is part of the claim.

## Components

| component | PR matches |
|---|---:|
| `instrumentation` | 17 |
| `tool/setup` | 11 |
| `tool/instrument` | 10 |
| `docs` | 10 |
| `tool/rule` | 9 |
| `test/e2e` | 9 |
| `tool/ast` | 5 |
| `pkg/runtime` | 5 |
| `tool/cmd` | 2 |
| `demo` | 2 |
| `ci` | 1 |
| `build` | 1 |
| `tool/data` | 1 |
| `tool/util` | 1 |
| `tool/profile` | 1 |
| `tool/imports` | 1 |

## Instrumentation, by integration

16 integrations appear, 31 matches
total, at most 5 for any single one.

| integration | PR matches |
|---|---:|
| `openai` | 5 |
| `linode` | 4 |
| `anthropics` | 3 |
| `net` | 2 |
| `log` | 2 |
| `database` | 2 |
| `segmentio` | 2 |
| `otel` | 2 |
| `client-go` | 2 |
| `apache` | 1 |
| `gin-gonic` | 1 |
| `redis` | 1 |
| `sirupsen` | 1 |
| `mongo-driver` | 1 |
| `grpc` | 1 |
| `runtime` | 1 |
