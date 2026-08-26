# Level 2 Implementation Status

This file maps the implemented branch to the Level 2 gate in `06_IMPLEMENTATION_LEVELS.md` and checklist section C in `15_MASTER_BUILD_CHECKLIST.md`.

| Level 2 requirement | Implementation / evidence |
|---|---|
| routing semantics frozen/documented | Bundled projects use deterministic ECMP; README documents equal split and positive-weight requirement; single-path remains supported for compatibility. |
| N-1 link enumeration | `runSingleLinkContingency`, sequential reference runner, and bounded async/worker runner enumerate eligible links from immutable snapshots. |
| worker pool + progress | Browser `contingency.worker.ts`; bounded pool defaults from hardware concurrency and emits `ContingencyProgress`. |
| cancellation via AbortSignal | Async runner and WebMCP execution accept `AbortSignal`; workers are terminated and cancellation returns/records `CANCELLED`, never PASS. |
| stale-job protection | `assertContingencyFresh` checks model + scenario hashes immediately before UI/tool publication. |
| worst-contingency ranking | Stable deterministic sort by documented impact score, then link ID tie-break. |
| counterexample replay | Ranked cases replay their exact `ScenarioPatch` and highlight stable graph link IDs. |
| min-cut/bottleneck evidence | Deterministic Edmonds-Karp max-flow/min-cut with `cutLinkIds`, shared UI highlighting, and `find_bottlenecks`. |
| dynamic WebMCP registration | Core, resilience, violation, and candidate groups register independently based on application state. |
| registration groups revoked cleanly | Every group has its own registration-scoped `AbortController`; tests assert each signal is aborted on dispose. |
| SharedArrayBuffer accelerator if worthwhile | Capability is detected but deliberately not required; benchmark does not justify adding isolation complexity at this scale. |
| Rust/WASM only if benchmark justified | Not added; TypeScript benchmark is acceptable at target demo size and no unmeasured speedup claim is made. |
| medium benchmark recorded | `benchmarks/level2-medium.ts` + `planning/LEVEL2_BENCHMARK.md`. |
| WebMCP eval suite core cases | Level 2 tests cover state groups, violation inspection, counterexample replay, min-cut mapping, and cancellation activity. |
| Level 2 gate determinism | Repeated N-1 runs compare exact rankings and score components. |
| cancellation state safety | Cancelled runs do not publish partial result into the workspace and cannot claim PASS. |
| evidence maps to graph IDs | route, link, scenario, and cut witnesses use canonical IDs; tests assert cut IDs reach shared selection. |

Optional accelerators are intentionally omitted until benchmark evidence shows they are needed.
