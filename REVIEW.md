# Review

Read of `otelc-dedupe` at `b3a1f88`, plus the changes made in response.
Everything below was reproduced against the running app, not inferred.

The tool is well built. Retrieval works, the eval is honest about what it does
and does not show, and the judge exists for a reason the author can demonstrate.
The problems are concentrated in two places: **it was not deployable**, and
**the deployed shape would have silently lost its cost ceiling**. The staleness
you spotted was real and had a root cause nobody had noticed.

---

## 1. How it works

```
GitHub GraphQL ─► issues + PRs, open and closed ─► data/corpus.json
                                                          │
                                            BM25 table ─► data/index.json
                                                          │
 your draft ──► BM25 over title+body  ┐                    │
           └──► changed-file Jaccard  ┴─► RRF ─► top 12 ───┤
                                                          ▼
                                              raw BM25 < 10 ?  ─► stop, free
                                                          │ no
                                                          ▼
                                          DeepSeek scores each candidate 0-100
```

Four decisions carry the design:

- **Closed and merged items are indexed.** The most actionable finding is an
  open item restating work that already landed — #842/#905/#909 all restate a
  fix merged in #844/#853. An open-only comparison cannot see that.
- **camelCase is expanded but the whole symbol is kept.** `canFlattenTJump`
  indexes as itself *and* `can`/`flatten`/`jump`, so `isSetup` matches
  `isSetup()` matches "is setup". That is the #161/#817 shape.
- **RRF fuses the retrievers rank-only.** An unbounded BM25 score and a 0-1
  Jaccard combine with nothing to normalise per repo.
- **The short-circuit thresholds raw BM25, not the fused score.** RRF is
  rank-based, so the top hit always scores 1/61 whether the match is perfect or
  garbage. Getting this wrong would have made the free/paid decision meaningless.
  The commit that fixed it (`e81cb8f`) is the sharpest thing in the history.

The judge is there because ranking provably cannot do the job: hand-written
rules that correctly rejected the #947/#931 series also rejected #903/#916 and
#790/#939, which are real duplicates. `scripts/report.mjs:151-160` documents the
attempt and the revert.

---

## 2. The staleness you noticed — root cause

Not a design gap. **The refresh workflow was never committed.**
`.github/` was untracked in the working tree (`git status` showed `?? .github/`),
so the nightly job the README advertises has never run once. The snapshot was
frozen at whatever `npm run fetch` last produced.

But fixing the workflow alone would not have fixed the problem, because a
nightly rebuild still leaves the tool blind for up to 24 hours — which is
exactly the window that matters. Measured on the live repo at review time:

| | |
|---|---|
| Base snapshot | 2026-08-04 18:32 UTC, 947 items |
| Items changed since | 11 |
| **Brand new, not in the index at all** | **#951, #952, #953** |

#951 (`docs: stale cmd/gotel references in CONTRIBUTING.md`) and #952 (its PR)
were filed hours after the snapshot. Anyone checking a draft of that exact
issue got "no significant overlap found" — the most dangerous wrong answer the
tool can give, and the one the author was careful about elsewhere.

**Fixed with a two-layer knowledge base** (`scripts/lib/live.mjs`,
`scripts/lib/kb.mjs`):

- **Base** — the committed snapshot, rebuilt weekly by `.github/workflows/index.yml`.
- **Delta** — everything created or edited since `corpus.fetchedAt`, pulled at
  request time from `GET /repos/:o/:r/issues?since=…` (one call covers issues
  *and* PRs), cached 5 minutes in module scope, with changed files filled in by
  a single aliased GraphQL batch.

The fold into BM25 is **exact, not approximate**. A superseded document has its
terms subtracted from the `df` table and its length removed from `avgLen`
before the replacement goes in, so IDF is identical to a full rebuild. This is
verified rather than asserted — `npm run selftest` rebuilds BM25 over the merged
corpus and compares:

```
PASS  fold matches full rebuild  N=950, 16219 terms, exact
```

Ranking on the same query is byte-identical between folded and rebuilt indexes.
It matters: IDF is the entire reason `isSetup` outweighs `fix`, and a drifting
`df` table would degrade ranking quietly between rebuilds with nothing to catch it.

Cost: **zero.** GitHub's API is free; the delta adds no model calls.
Latency: one 1-2s GitHub round trip per 5 minutes, capped at 6s, falling back to
the base snapshot on timeout. New items are tagged `LIVE` in the UI, and the
header states the snapshot date, when the tail was last checked, and how many
items are new — so a user can see the tool's blind spot instead of guessing at it.

---

## 3. Bugs

All fixed. Ordered by how badly they mislead a user.

**1. The changed-file retriever never ran in the web app.**
`server.mjs:126` hardcoded `files: []`. The README calls this "the
highest-precision signal available for PRs" and credits it with finding
#789/#883 — a pair "which no text-based retriever ranks". It only ever ran in
the batch report. Submitting a PR through the UI that touched exactly the same
files as an open PR returned nothing.
*Fixed:* the API accepts `files[]`, the UI has a changed-files field for PR mode,
and `npm run selftest` fails if the retriever stops being reachable. Now:
`#789 | files#2` on a query with no lexical overlap at all.

**2. No timeout on the judge call.**
`judge()` accepted an AbortSignal; `server.mjs` never passed one. A stalled
provider held the request until the platform killed it. On Vercel that is a
blank 504 that throws away retrieval results already computed and paid for.
*Fixed:* 45s AbortController, degrading to retrieval-only with a stated reason.

**3. The verdict cache could serve one issue's verdicts under another's title.**
The key was a 32-bit rolling hash (`Math.imul(31, h)`). Birthday bound: 50%
collision probability at ~77k distinct queries. A collision produces a
confidently wrong answer with no error — precisely the failure mode
`judge.mjs`'s output validation was written to prevent, reintroduced one layer up.
*Fixed:* sha256, and the key now includes the corpus identity, so a knowledge-base
change invalidates by construction rather than by remembering to call `cache.clear()`.

**4. A reply the judge could not read rendered as "no duplicates found".**
`judge()` validates every returned row against the candidate set and the verdict
enum and drops what fails — good. But the caller only read `out.results` and
ignored `out.dropped`. If the model returned twelve rows and all twelve were
invalid (hallucinated numbers, a verdict outside the enum, a reply keyed by list
position instead of issue number), `results` was `[]` — an empty array, which is
truthy — so `verdictSource` stayed `'judge'` and the UI printed *"Nothing scored
above 70. 12 nearby items were assessed and none looks like the same work."*
That is the exact silently-wrong answer `judge.mjs`'s empty-content guard was
written to prevent, reintroduced one layer up. Found by feeding the stubbed
provider a reply of hallucinated issue numbers.
*Fixed:* all-dropped is now a judge failure, so the user gets retrieval results
and a stated reason instead of a false all-clear.

**5. `retrieve()`'s `.filter(Boolean)` was a no-op.**
`{ ...undefined, _retrieval: … }` is a truthy object, so a corpus miss would
have rendered a card of `undefined`s rather than being dropped.
*Fixed:* filtered inside the map.

**6. Two unbounded maps.** The rate-limit `hits` map grew one entry per IP
forever; the verdict cache was only ever cleared on index reload.
*Fixed:* eviction on both, LRU capped at 500 for the cache.

**7. The UI asserted a measurement that was never taken.**
`band()` labelled scores under 10 with "0/5 were duplicates at this level". The
14-case eval never produced a score below 10 — there is no such measurement.
In a UI whose stated principle is that every claim is backed by a number, an
invented denominator is worse than no number.
*Fixed:* "no eval cases landed here", matching the honest wording used for the
40-89 bands.

**8. Hardcoded counts that were true once.** `"searching 947 items…"` in
`app.js`; `${'16/30'}` negative pairs in the generated report method section
(the eval currently reports 17/30).
*Fixed:* corpus size comes from `/api/health`; the report no longer asserts a
number it does not compute.

**9. `import { tokenize }` in `server.mjs`, never used.** Removed in the rewrite.

**10. `REPORT.md` says "otelc-scout backfill report"; `report.mjs` emits
"otelc-dedupe".** Stale artifact from the rename — regenerate.

One more, introduced during this work and caught by the new selftest: the
short-circuit read `candidates[0]` only, so a strong file-overlap hit sitting at
rank 3 behind a weak lexical hit was discarded as "no significant overlap". Now
taken as a max over the list.

---

## 4. Vercel

**It was not deployable.** `server.mjs` called `createServer().listen()` — a
long-lived process, which Vercel does not run. There was no `api/` directory, no
`vercel.json`, and nothing that would have produced a working URL.

Restructured so both targets share one implementation:

```
scripts/lib/api.mjs    analyze() + health(), transport-independent
api/analyze.mjs        Vercel adapter
api/health.mjs         Vercel adapter
server.mjs             node:http adapter, unchanged behaviour locally
```

`vercel.json` carries the four things zero-config gets wrong here:

| Setting | Why |
|---|---|
| `includeFiles: "data/**"` | NFT does not trace `readFileSync(join(ROOT, …))`. Without this the function deploys with no corpus and 500s on first request. |
| `maxDuration: 60` | The judge call takes 5-20s; the 10s default truncates it. |
| `installCommand: --omit=optional` | Keeps `@huggingface/transformers` (~300MB) out of the bundle. It is unused — see §5. |
| `outputDirectory: "public"` | Serves the static app; `api/` is auto-detected. |

Plus CSP and the usual hardening headers, which the app previously sent none of.

Cold start measured locally: 15ms read + 68ms parse for 5.5MB of JSON, so
roughly 150-250ms on Vercel, once per cold instance.

### The part that actually threatens a $2-5 budget

Rate limiting and the daily cap lived in module-level `Map`s. On one
long-running process that is exactly right. **On serverless it is not a limit at
all** — every cold instance starts at zero, so a burst that spawns twenty
instances gets twenty times the daily cap. The `CAP` block reads like a budget
and would have behaved like a suggestion.

`scripts/lib/limits.mjs` moves the counters to Redis-over-REST when one is
configured (Vercel KV and Upstash speak the same protocol; both free tiers are
far larger than this needs), falls back to the old in-memory behaviour
otherwise, and **reports which one is active** so a deployment running
unprotected is visibly unprotected. Added a hard monthly USD ceiling on top,
computed from actual token usage at the miss-rate price:

```
cost of one real 12-candidate call: $0.000488
$3.00 monthly cap                 ≈ 6,142 checks
```

Three independent stops now: per-IP rate limit → daily count → monthly spend →
and the pre-existing provider-balance floor, which is the only one that cannot
be wrong because the account is prepaid.

**Before deploying, set `KV_REST_API_URL` and `KV_REST_API_TOKEN`.** Without
them the caps are per-instance and the prepaid balance is your only real ceiling.

---

## 5. Drawbacks that remain

**Embeddings are dead weight.** `data/index.json` has `vectors: null` and
`retrievers: ["bm25", "files"]`. The embed branch in `search.mjs`, all of
`embed.mjs`, and the "hybrid retrieval" framing describe a path that does not
run in any shipped configuration. The author's own note — "embeddings turned out
not to be load-bearing" — is the honest version; the code and README have not
caught up. Either delete it or state plainly that it is off.

**Recall still depends on how you word things.** The eval gate passes because it
replays #817's exact text. Paraphrasing the same bug in my own words retrieved
#658 and #817 at likelihood 95 but did *not* surface #161 in the top 12 — the
canonical open issue. The vocabulary-gap case is genuinely hard and one gate is
thin evidence that it is solved.

**The judge is close to bimodal.** It had been seen returning only 95, 90, 10 or
5 across 28 calls. Replaying the labelled set against the deployment widened that
to 100, 95, 90, 85, 15, 10 and 5 — so the scale is finer than a 4-point scale
wearing a costume, but **40-69 is still empty across every run recorded**. There
is no evidence about how it scores a genuinely ambiguous pair, and one case
landing at 85 is the only data point above 15 and below 90. The UI says so.

**14 eval cases, all hand-picked and clear-cut.** Disjoint ranges on 14 easy
cases is weaker evidence than the "any threshold between 15 and 89 gives 100%
accuracy" line suggests.

**Candidate bodies are attacker-controlled text fed to a model.** Anyone can
file an issue whose body addresses the judge directly. Blast radius is small —
`judge.mjs` validates that every returned number is in the candidate set and
every verdict is in the enum, and `reason` is escaped in the UI — so the worst
case is a manipulated likelihood on one card, not injected markup or a
fabricated issue number. Worth a line in the prompt telling the model that
candidate text is data, not instructions.

**No origin check on `/api/analyze`.** Browsers are blocked by the missing CORS
preflight, but `curl` is not; per-IP rate limiting is the only defence against
scripted abuse. Fine given the spend caps, worth knowing.

**It only helps people who use it.** Someone filing straight on GitHub is not
covered. This is the biggest limitation and it is architectural, not a bug.

---

## 6. Suggestions, in order of value

1. **Run it where issues are actually filed.** A GitHub Action on
   `issues.opened` that posts a comment when something scores ≥90 would catch
   the people a web form never reaches — the case the whole tool exists for.
   The corpus, retrieval and judge already work; it is one workflow file plus a
   `POST /issues/:n/comments`. At $0.0005 a check and ~15 new items a day, that
   is about **$0.22 a month**.
2. **Widen the eval.** Every closed-as-duplicate pair in the repo's history is
   free labelled data. 14 hand-picked cases is where the confidence is thinnest.
3. **Delete the embedding path or turn it on.** Carrying a retriever that never
   runs makes the README describe a system that does not exist.
4. **Pin the region near the provider.** DeepSeek is served from Asia; `iad1`
   adds avoidable round-trip latency to every scored check.
5. **Cap stored bodies at ~3000 chars.** The judge reads 600. It would take
   `corpus.json` from 3.8MB to ~1.9MB and halve cold-start parse time — but it
   would degrade `report.mjs` and `judge-eval.mjs`, which read full bodies, so
   only do this if cold start actually shows up as a problem.

---

## 7. Verify

```bash
npm run selftest
```

Checks that the base index loads, the live tail reaches GitHub, the incremental
fold is exact against a full rebuild, #817 still retrieves its known duplicate,
the file retriever is reachable, junk short-circuits before any paid call, and
whether the limiter is durable. No API key needed; no money spent.
