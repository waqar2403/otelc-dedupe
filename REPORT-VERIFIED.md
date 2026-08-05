# Verified duplicates

`open-telemetry/opentelemetry-go-compile-instrumentation`, 959 items indexed (open and closed), 139 open.
Fetched 2026-08-05, verified 2026-08-05.

Every pair below was surfaced by keyword and changed-file retrieval, then
confirmed by a language model as the same underlying work. Pairs the model
called a deliberate series, or scored below 70, were dropped — that is
the failure mode mechanical scoring cannot fix on its own, and it removed
61 of the 75 candidates here.

**Still read both before closing anything.** This is a shortlist, not a ruling.

## Same work (14)

| score | A | B | relation | why |
|---:|---|---|---|---|
| **95** | [#842](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/842) ISSUE open<br>fix(ast): check return error of file.Close() in WriteFile to pre | [#844](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/844) PR merged<br>fix(ast): check return error of file.Close() in WriteFile | subsumed by | Same exact fix in same file already merged; proposed is redundant. |
| **95** | [#790](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/790) ISSUE open<br>test(util): TestRunCmd fails on Windows due to reliance on shell | [#939](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/939) ISSUE open<br>test(util): `TestRunCmd` fails on Windows due to non-existent `e | duplicate | Same issue, same file, same failure; proposed is a near-identical duplicate. |
| **95** | [#807](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/807) ISSUE open<br>docs: document runtime instrumentation selection env vars (OTEL_ | [#856](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/856) PR merged<br>docs(config): document runtime instrumentation env vars | duplicate | Same docs change to configuration.md documenting the same two env vars; already merged. |
| **95** | [#659](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/659) PR open<br>feat(tool): implement isSetup check in setup phase | [#818](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/818) PR open<br>fix(tool): implement isSetup check to skip redundant setup | duplicate | Same isSetup implementation and test in same files, both fix the same stub. |
| **95** | [#903](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/903) ISSUE open<br>bug(hook): unsafe type assertion in GetKeyData/SetKeyData/HasKey | [#916](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/916) ISSUE open<br>fix(runtime): prevent type assertion panic in HookContext KeyDat | duplicate | Same bug and fix as proposed, filed as issue before PR. |
| **95** | [#903](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/903) ISSUE open<br>bug(hook): unsafe type assertion in GetKeyData/SetKeyData/HasKey | [#917](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/917) PR open<br>fix(runtime): prevent type assertion panic in HookContext KeyDat | duplicate | Open PR with same fix, broader test coverage, supersedes proposed work. |
| **95** | [#811](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/811) PR open<br>docs(config): document run-time instrumentation environment vari | [#856](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/856) PR merged<br>docs(config): document runtime instrumentation env vars | duplicate | Same documentation change for the same env vars in the same file, already merged. |
| **95** | [#904](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/904) PR open<br>fix(hook): use safe type assertions in GetKeyData, SetKeyData, a | [#917](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/917) PR open<br>fix(runtime): prevent type assertion panic in HookContext KeyDat | duplicate | Same fix in same files, same author, same issue #903. |
| **95** | [#904](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/904) PR open<br>fix(hook): use safe type assertions in GetKeyData, SetKeyData, a | [#916](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/916) ISSUE open<br>fix(runtime): prevent type assertion panic in HookContext KeyDat | duplicate | Same fix and files, likely duplicate of proposed PR. |
| **95** | [#725](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/725) PR open<br>docs: Update otelc command path in README | [#953](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/953) PR merged<br>docs(readme): fix otecl path for demo app | duplicate | Same README fix for otelc path in demo app, already merged. |
| **90** | [#842](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/842) ISSUE open<br>fix(ast): check return error of file.Close() in WriteFile to pre | [#905](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/905) ISSUE closed<br>fix(tool): check file.Close error handling in ImportConfig and A | subsumed by | Closed issue covering both files; proposed work already landed via #844 and #909. |
| **90** | [#842](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/842) ISSUE open<br>fix(ast): check return error of file.Close() in WriteFile to pre | [#909](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/909) PR merged<br>fix(tool): check file.Close error handling in ImportConfig and A | subsumed by | Merged PR already fixes ast.WriteFile close error; proposed duplicates that. |
| **90** | [#939](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/939) ISSUE open<br>test(util): `TestRunCmd` fails on Windows due to non-existent `e | [#921](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/921) PR merged<br>test: fix Windows test failures due to POSIX shell assumptions | subsumed by | Merged PR already fixed TestRunCmd with cross-platform go binary. |
| **85** | [#790](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/790) ISSUE open<br>test(util): TestRunCmd fails on Windows due to reliance on shell | [#921](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/921) PR merged<br>test: fix Windows test failures due to POSIX shell assumptions | subsumed by | Merged PR already fixes TestRunCmd Windows failure; proposed is redundant. |


## Dropped by the model (61)

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
| 55 | 10 | [#705](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/705) | [#728](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/728) | related |
| 55 | 20 | [#739](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/739) | [#756](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/756) | related |
| 55 | 20 | [#879](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/879) | [#885](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/885) | related |
| 55 | 95 | [#925](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/925) | [#936](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/936) | implements (linked work) |
| 50 | 5 | [#585](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/585) | [#933](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/933) | unrelated |
| 50 | 95 | [#745](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/745) | [#801](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/801) | implements (linked work) |
| 50 | 15 | [#805](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/805) | [#866](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/866) | series |
| 45 | 15 | [#880](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/880) | [#885](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/885) | related |
| 45 | 10 | [#545](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/545) | [#551](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/551) | related |
| 45 | 20 | [#570](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/570) | [#569](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/569) | related |
| 45 | 5 | [#583](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/583) | [#567](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/567) | unrelated |
| 45 | 15 | [#739](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/739) | [#732](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/732) | related |
| 45 | 15 | [#739](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/739) | [#766](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/766) | related |
| 45 | 10 | [#585](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/585) | [#606](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/606) | related |
| 45 | 15 | [#745](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/745) | [#746](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/746) | related |
| 45 | 20 | [#456](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/456) | [#226](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/226) | related |
| 45 | 30 | [#541](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/541) | [#546](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/546) | related |
| 45 | 20 | [#541](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/541) | [#542](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/542) | related |
| 45 | 15 | [#542](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/542) | [#543](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/543) | related |
| 45 | 5 | [#552](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/552) | [#514](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/514) | unrelated |
| 45 | 5 | [#700](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/700) | [#705](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/705) | unrelated |
| 45 | 10 | [#744](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/744) | [#746](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/746) | related |
| 45 | 10 | [#756](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/756) | [#766](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/766) | related |
| 45 | 15 | [#777](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/777) | [#717](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/717) | related |
| 45 | 15 | [#873](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/873) | [#880](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/880) | related |
| 45 | 10 | [#908](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/908) | [#853](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/853) | related |
| 45 | 10 | [#955](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/955) | [#832](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/832) | related |
| 45 | 10 | [#961](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/961) | [#959](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/959) | related |
| 40 | 20 | [#789](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/789) | [#883](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/883) | related |
| 35 | 15 | [#790](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/790) | [#920](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/920) | related |
| 35 | 10 | [#739](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/739) | [#777](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/777) | related |
| 35 | 20 | [#879](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/879) | [#888](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/888) | related |
| 35 | 15 | [#585](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/585) | [#617](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/617) | related |
| 35 | 10 | [#805](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/805) | [#775](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/775) | related |
| 35 | 15 | [#541](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/541) | [#543](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/543) | related |
| 35 | 15 | [#542](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/542) | [#546](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/546) | related |
| 35 | 20 | [#552](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/552) | [#494](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/494) | related |
| 35 | 15 | [#552](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/552) | [#564](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/564) | related |
| 35 | 25 | [#700](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/700) | [#728](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/728) | related |
| 35 | 5 | [#777](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/777) | [#756](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/756) | unrelated |
| 35 | 10 | [#908](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/908) | [#905](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/905) | related |
| 35 | 20 | [#164](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/164) | [#346](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/346) | related |
| 35 | 15 | [#543](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/543) | [#546](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/546) | related |
| 35 | 10 | [#556](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/556) | [#529](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/529) | related |
| 35 | 95 | [#667](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/667) | [#669](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/669) | implements (linked work) |
| 35 | 10 | [#671](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/671) | [#567](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/567) | related |
| 35 | 5 | [#899](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/899) | [#958](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/958) | unrelated |
| 35 | 20 | [#939](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/939) | [#920](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/920) | related |
| 35 | 10 | [#956](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/956) | [#832](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/832) | related |
| 35 | 10 | [#959](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/959) | [#960](https://github.com/open-telemetry/opentelemetry-go-compile-instrumentation/issues/960) | related |

