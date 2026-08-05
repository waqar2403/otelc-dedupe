# Verified duplicates

`open-telemetry/opentelemetry-go-compile-instrumentation`, 959 items indexed (open and closed), 139 open.
Fetched 2026-08-05, verified 2026-08-05.

Every pair below was surfaced by keyword and changed-file retrieval, then
confirmed by a language model as the same underlying work. Pairs the model
called a deliberate series, or scored below 70, were dropped — that is
the failure mode mechanical scoring cannot fix on its own, and it removed
18 of the 26 candidates here.

**Still read both before closing anything.** This is a shortlist, not a ruling.

## Same work (8)

| score | A | B | relation | why |
|---:|---|---|---|---|
| **95** | [#842](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/842) ISSUE open<br>fix(ast): check return error of file.Close() in WriteFile to pre | [#905](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/905) ISSUE closed<br>fix(tool): check file.Close error handling in ImportConfig and A | subsumed by | Closed issue covering both files; proposed ast fix already resolved by #844 and #909. |
| **95** | [#842](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/842) ISSUE open<br>fix(ast): check return error of file.Close() in WriteFile to pre | [#844](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/844) PR merged<br>fix(ast): check return error of file.Close() in WriteFile | subsumed by | Merged PR already implements exact ast/parser.go fix proposed. |
| **95** | [#842](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/842) ISSUE open<br>fix(ast): check return error of file.Close() in WriteFile to pre | [#909](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/909) PR merged<br>fix(tool): check file.Close error handling in ImportConfig and A | subsumed by | Merged PR covers ast/parser.go close error handling, superseding proposed. |
| **95** | [#790](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/790) ISSUE open<br>test(util): TestRunCmd fails on Windows due to reliance on shell | [#939](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/939) ISSUE open<br>test(util): `TestRunCmd` fails on Windows due to non-existent `e | duplicate | Same issue, same file, same failure; proposed is a near-identical duplicate. |
| **95** | [#807](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/807) ISSUE open<br>docs: document runtime instrumentation selection env vars (OTEL_ | [#856](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/856) PR merged<br>docs(config): document runtime instrumentation env vars | duplicate | Same docs change to configuration.md for the same two env vars, already merged. |
| **95** | [#659](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/659) PR open<br>feat(tool): implement isSetup check in setup phase | [#818](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/818) PR open<br>fix(tool): implement isSetup check to skip redundant setup | duplicate | Same isSetup implementation and test in same files, both fixing the same stub. |
| **95** | [#903](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/903) ISSUE open<br>bug(hook): unsafe type assertion in GetKeyData/SetKeyData/HasKey | [#916](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/916) ISSUE open<br>fix(runtime): prevent type assertion panic in HookContext KeyDat | duplicate | Same bug and fix as proposed, filed as issue. |
| **95** | [#811](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/811) PR open<br>docs(config): document run-time instrumentation environment vari | [#856](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/856) PR merged<br>docs(config): document runtime instrumentation env vars | duplicate | Same documentation change for the same env vars in the same file, already merged. |


## Dropped by the model (18)

Ranked highly by the rules, rejected on reading. Mostly deliberate series: same
pattern, different target.

| rule | judge | A | B | verdict |
|---:|---:|---|---|---|
| 100 | 20 | [#201](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/201) | [#202](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/202) | related |
| 100 | 10 | [#842](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/842) | [#853](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/853) | related |
| 80 | 10 | [#587](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/587) | [#612](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/612) | related |
| 75 | 10 | [#202](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/202) | [#203](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/203) | series |
| 70 | 15 | [#880](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/880) | [#888](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/888) | related |
| 55 | 15 | [#201](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/201) | [#203](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/203) | related |
| 55 | 20 | [#545](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/545) | [#549](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/549) | related |
| 55 | 5 | [#570](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/570) | [#571](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/571) | unrelated |
| 55 | 15 | [#583](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/583) | [#560](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/560) | implements (linked work) |
| 55 | 20 | [#644](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/644) | [#643](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/643) | implements (linked work) |
| 55 | 95 | [#679](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/679) | [#689](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/689) | implements (linked work) |
| 55 | 20 | [#705](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/705) | [#728](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/728) | related |
| 55 | 15 | [#739](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/739) | [#756](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/756) | related |
| 55 | 20 | [#879](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/879) | [#885](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/885) | related |
| 55 | 95 | [#925](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/925) | [#936](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/936) | implements (linked work) |
| 50 | 5 | [#585](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/585) | [#933](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/933) | unrelated |
| 50 | 95 | [#745](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/745) | [#801](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/801) | implements (linked work) |
| 50 | 15 | [#805](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/805) | [#866](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/866) | series |

