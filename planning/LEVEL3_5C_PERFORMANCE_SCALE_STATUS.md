# InfraTwin Phase 3.5C — Browser Performance and Scale Status

## Scope and conclusion

Phase 3.5C establishes a measured browser operating envelope for the existing Phase 3.5A/B product rather than adding Level 4 features. The semantic model, ChangePlan contract, deterministic evidence rules, optimizer formulations, and human approval model remain unchanged.

The measured answer to the phase's central question is **yes, with feature-specific limits**: InfraTwin can now demonstrate real browser-scale network engineering on a realistic **500-node / 1,200-link / 400-demand / 12-region** workload with adaptive Canvas presentation, Worker-backed ChangePlan analysis, bounded exact N-1, and explicit optimizer guards. This is not a claim that every operation is safe at the canonical import maxima.

The largest deterministic routing workload exercised during this phase was the current canonical-limit probe at **500 nodes / 2,000 links / 2,000 demands**. That probe completed in Node benchmarks, but it is not promoted as the universal interactive browser envelope.

## Measurement context

### Baseline engine run

- baseline commit: `ba81cc19e60b2680a4b1644ddc61e9c35994aae3`
- Node: `v22.23.2`
- OS/architecture: Linux x64
- runner CPUs exposed: 4
- runner CPU: AMD EPYC 9V74 80-Core Processor
- memory: 16.77 GB reported

### Final browser validation candidate

- measurement commit: `b85c459f025c8e8aa18b231880b7cd20a8409935`
- Node: `v22.23.2`
- Chromium: `151.0.7922.34`
- viewport: 1280×720
- OS/architecture: Linux x64
- runner CPUs exposed: 4
- runner CPU: AMD EPYC 7763 64-Core Processor
- memory: 16.77 GB reported

GitHub-hosted runners are not a controlled hardware lab, so millisecond values are evidence of operating class and regression direction, not hardware-independent guarantees. Correctness is CI-gated; performance values are report-oriented with broad catastrophic-regression protection.

## Deterministic benchmark fixtures

The scale generator is seed-driven and controls node count, link count, demand count, regions, routing mode, source concentration/workload shape, service classes, and upgrade-option density.

| Tier | Nodes | Links | Demands | Purpose |
| --- | ---: | ---: | ---: | --- |
| A | 128 | 304 | 96 | flagship class |
| B | 250 | 600 | 200 | medium-large |
| C | 500 | 1,200 | 400 | large browser scale proof |
| D | 750 | ~1,900 | 750 | stress boundary; rejected by current 500-node canonical limit |
| E | 500 | 2,000 | 2,000 | current canonical-limit deterministic routing probe |

Routing benchmarks include single-shortest-path and ECMP plus concentrated-source, unique-source, dense cross-region, sparse, and failure-recompute workload shapes.

## Baseline bottlenecks

The baseline measurements showed that the main problem was repeated shortest-path work, not validation or semantic hashing. On concentrated-source workloads:

| Routing workload | Baseline | Final | Speedup |
| --- | ---: | ---: | ---: |
| Tier C SSP, 500/1,200/400 | 3,340.4 ms | 60.9 ms | 54.85× |
| Tier C ECMP, 500/1,200/400 | 1,964.1 ms | 380.0 ms | 5.17× |
| Tier E SSP, 500/2,000/2,000 | 18,886.1 ms | 96.6 ms | 195.47× |
| Tier E ECMP, 500/2,000/2,000 | 11,734.0 ms | 1,999.1 ms | 5.87× |

At Tier C after optimization, validation measured **1.5–2.6 ms** and semantic hashing **18.8–25.5 ms**, so neither justified weakening import validation or replacing semantic hashing.

The first browser-scale checkpoint then exposed a separate presentation bottleneck. On the 500/1,200/400 Tier-C workspace, rich SVG measured approximately **4,718 ms initial render**, **583 ms pan/zoom**, **1,231 ms search focus**, **3,488 ms plan-state highlighting**, and a **4,195 ms** longest observed presentation task. The end-to-end browser scale run observed a **14,150 ms** longest task because a large Worker result subsequently mounted tens of thousands of violation buttons synchronously.

## Algorithmic changes

### Binary-heap shortest paths

The optimized graph engine replaces the previous quadratic next-node selection with a binary min-heap. A shortest-path run is now approximately:

```text
O((V + E) log V)
```

for sparse graph structures, rather than the previous `O(V² + E)`-class scan behavior.

### Source/target reuse

A `RoutingSession` owns immutable topology structures and per-source/per-target distance trees for one semantic topology. For single-shortest-path routing, repeated demands sharing a source reuse one source tree. ECMP reuses forward distances by unique source and reverse distances by unique target.

The resulting dominant routing work is approximately:

```text
SSP:
uniqueSources × O((V + E) log V)
+ flow accumulation

ECMP:
(uniqueSources + uniqueTargets) × O((V + E) log V)
+ equal-cost flow accumulation
```

The estimator exposes `uniqueSources`, `uniqueTargets`, `directedArcs`, `shortestPathRuns`, and a deterministic complexity unit used for execution-mode selection. It is explicitly not presented as a runtime prediction.

### Cache correctness

Routing-session reuse is topology-sensitive. Availability or weight edits invalidate graph/source structures. Bandwidth-only edits reuse path structures while recomputing flow accumulation. Differential/property tests compare the accelerated engine with the independent reference implementation across deterministic seeds and preserve routes, ECMP path counts/fractions, link loads, and engineering verdicts.

## Worker strategy and main-thread responsiveness

ChangePlan analysis uses the routing complexity estimate to select synchronous versus Worker execution. The Phase 3.5C threshold is **700,000 estimated work units**. Workloads at or above that measured Tier-C class are moved to a Worker.

The browser scale proof measured:

- 500/1,200/400 single-shortest-path ChangePlan analysis: **1,199.2 ms**, Worker;
- 500/1,200/400 unique-source ECMP ChangePlan analysis: **1,721.0 ms**, Worker;
- interaction while that ECMP Worker analysis was active: **74.5 ms**;
- structured cloning of the 500/1,200/400 project: **2.3 ms**.

Worker results carry project hash, plan hash, and revision epoch authority. A stale result cannot become authoritative after a semantic project/ChangePlan revision. Existing cancellation/network-switch hardening remains in the retained browser suite.

### Large evidence presentation batching

A Worker alone was insufficient: the unique-source Tier-C result can produce roughly **25,000+** violation records. Rendering every violation as a React/DOM button on result publication caused a multi-second main-thread task. The result/evidence remains complete and authoritative, but the UI now renders violations in deterministic pages of **200** with an explicit “Show more” control.

After Canvas plus violation batching, the end-to-end browser scale run's longest observed main-thread task fell from **14,150 ms** at the earlier checkpoint to **424 ms**. The presentation-only Tier-C longest task fell from **4,195 ms** under SVG to **381 ms** under Canvas.

## Visualization envelope and adaptive renderer

SVG is retained for smaller networks because it provides rich vector semantics and did not justify replacement at Tier A/B. Canvas activates at the measured large-graph boundary:

```text
nodes >= 400
OR
links >= 1,000
```

Both renderers consume the same semantic project/plan/evidence state. Canvas mode preserves pan/zoom, node/link hit testing, selection, ChangePlan state, violations, proposals, locks, region context, search/focus, and the normal-DOM object inspector.

Measured presentation results:

| Workspace | Renderer | Initial render | Pan/zoom | Search focus | Longest observed task |
| --- | --- | ---: | ---: | ---: | ---: |
| Tier A 128/304/96 | SVG | 556.9 ms | 267.5 ms | 366.0 ms | 306 ms |
| Tier B 250/600/200 | SVG | 786.7 ms | 196.8 ms | 219.1 ms | 616 ms |
| Tier C 500/1,200/400 | Canvas | 526.1 ms | 133.0 ms | 367.4 ms | 381 ms |

The separate end-to-end browser scale run measured Tier-C initial topology availability at **1,179.7 ms**, Fit Network at **91.6 ms**, search focus at **361.0 ms**, and zoom interaction at **47.1 ms**.

Tier D is not a renderer crash measurement: its 750 nodes are rejected by the existing canonical 500-node model/import limit before normal product rendering.

## Feature-specific operating envelopes

| Capability | Tested scale | Measured result | Execution | Recommended limitation |
| --- | --- | --- | --- | --- |
| Deterministic base routing | 500 nodes / 2,000 links / 2,000 demands | SSP 96.6 ms; ECMP 1,999.1 ms in Node scale benchmark | engine; browser may select Worker by complexity | canonical-limit compute proof, not a universal interactive UI claim |
| ChangePlan analysis | 500 / 1,200 / 400 | 1,199.2 ms SSP; 1,721.0 ms unique-source ECMP | Worker | Worker for estimated work >= 700,000 |
| Exact N-1 | 500 / 1,200 / 400 | 50 failures in 8,571.3 ms browser worker pool | worker pool | 50 exact failures per recommended large-scale browser batch; report partial coverage |
| Routing LP | 10,000 flow variables | 518.7 ms; HiGHS `Optimal`; independent verification valid | HiGHS WASM | recommend <= 10,000 estimated flow variables |
| Capacity MILP | 478 decisions × 21 scenarios = 10,038 decision×scenario | model build 604.4 ms; measured run produced deterministic infeasibility outcome in 602.4 ms | HiGHS/precheck path | conservative recommendation <= 10,000 decision×scenario; do not generalize this infeasible case to all MILPs |
| Visualization | 500 / 1,200 / 400 | Canvas 526.1 ms presentation initial render; 133.0 ms pan/zoom | Canvas main thread | SVG below 400 nodes / 1,000 links; Canvas at/above measured boundary |

These limits are deliberately feature-specific. The product does not equate “500 nodes / 2,000 links / 2,000 demands” with safe full N-1, routing LP, capacity MILP, and rich SVG simultaneously.

## Exact N-1 envelope

Exact link contingencies remain exact; no approximate failure screening was introduced.

Tier-C sequential engine measurements were:

- 50 scenarios: **12,174.5 ms**;
- 100 scenarios: **24,041.8 ms**;
- 500 scenarios: **117,300.8 ms**.

The browser Worker-pool run completed the recommended 50-scenario batch in **8,571.3 ms**. The evidence model reports both tested scenarios and total eligible failures. On the National Backbone Scale Test the browser correctly reports **50 / 1,200** eligible link failures as **PARTIAL** rather than complete resilience validation.

The evidence engine's exact hard cap remains 500 scenarios. On measured large routing workloads, the product recommendation is 50 scenarios per browser batch. Smaller workloads may use more up to the engine cap.

## Routing LP envelope

The multicommodity arc-based LP scales approximately with:

```text
demands × active directed arcs
```

The final measurement brackets under normal solve limits were:

| Flow variables | Outcome |
| ---: | --- |
| 10,000 | **Optimal, independently verified**, 518.7 ms |
| 19,600 | solver reported Optimal, but independent primal verification failed |
| 29,750 | solver reported Optimal, but independent primal verification failed |
| 39,600 | time limit reached |
| 59,400 | time limit reached |
| 78,750 | time limit reached |
| 97,200 | model construction succeeded; solve hit time limit |

Therefore the normal product recommendation is **<= 10,000 flow variables**. Above that size the UI reports **NOT RECOMMENDED AT THIS SCALE** while deterministic routing and ChangePlan analysis remain available. `allowLargeModel` remains an explicit expert/benchmark override and does not weaken verification.

The 19.6k/29.75k results are intentionally treated as failures despite the solver's `Optimal` label because the independently reconstructed primal violated the configured strict verification tolerance. Phase 3.5C does not loosen verification to improve advertised scale.

## Capacity MILP envelope

Capacity optimization is guarded independently from routing LP. The scale estimate is:

```text
upgrade decision variables × selected scenarios
```

The measured Tier-B probe contained **478** upgrade decisions and **21** selected scenarios, or **10,038 decision×scenario**, with **12,839** estimated constraints. Model construction completed in **604.4 ms**. The measured optimization path returned an infeasibility result in **602.4 ms** because no available discrete option could satisfy the target in the baseline scenario.

Because that measurement does not prove the runtime of arbitrary feasible 10k-class MILPs, the product recommendation is conservatively set to **<= 10,000 decision×scenario**. Routing-LP limits do not disable capacity optimization and vice versa.

## Canonical-limit and failure boundaries

The current canonical model limits remain defensible as **import/model maxima**, not universal compute guarantees.

The Tier-E concentrated-source routing probe at **500 / 2,000 / 2,000** completed:

- SSP: **96.6 ms**, about 17.1 MiB measured heap delta;
- ECMP: **1,999.1 ms**, about 78.6 MiB measured heap delta.

No browser tab crash, Worker out-of-memory, stack overflow, HiGHS memory error, or structured-clone failure was observed in the supported measured tiers. The important failure boundaries were instead:

1. Tier D 750-node product import rejected by the intentional 500-node canonical limit;
2. large exact N-1 becoming long-running and therefore explicitly bounded/partial;
3. routing LP losing independently verified reliability above the 10k measured envelope and later hitting normal time limits;
4. large result DOM publication becoming a main-thread bottleneck until evidence batching was added.

The canonical node limit was not raised because the phase did not produce product/browser evidence for >500 nodes. The existing 2,000-link and 2,000-demand maxima are retained, while the UI communicates feature-specific recommendations below them where necessary.

## Optimizations implemented

1. binary-heap shortest-path execution;
2. operation-scoped immutable graph reuse;
3. per-source SSP distance/tree reuse;
4. ECMP forward/reverse distance reuse;
5. topology-sensitive cache invalidation with bandwidth-only path reuse;
6. deterministic routing/optimizer workload estimators;
7. adaptive main-thread/Worker ChangePlan execution;
8. Worker authority tokens for stale-result rejection;
9. bounded large-scale exact N-1 policy and Worker pool;
10. adaptive SVG/Canvas rendering at the measured Tier-C presentation boundary;
11. bounded DOM publication for large violation evidence;
12. routing-LP and capacity-MILP product guardrails from measured envelopes;
13. reproducible Node/Chromium benchmark outputs and catastrophic-regression assertions.

## Optimizations deliberately rejected or deferred

- **Rust/WASM graph rewrite:** not justified in Phase 3.5C. TypeScript algorithmic/reuse changes produced large routing speedups and support the 500-node browser target. A compiled graph kernel remains Level 4 work only if later workloads show JS graph compute dominating again.
- **WebGPU graph/scenario compute:** not needed for the measured target; Worker execution and graph reuse establish a credible browser envelope first.
- **WebGL renderer:** Canvas 2D removed the measured Tier-C SVG bottleneck, so a more complex renderer is not justified by current evidence.
- **Approximate N-1 screening:** exact bounded analysis plus truthful partial coverage is retained. Broad structural screening belongs to Level 4.
- **Path-based/reduced routing LP:** the arc-based LP is now explicitly guarded instead of being forced to pathological sizes. Reduced/path-column formulations are strong Level 4 candidates.
- **Validation weakening:** rejected; validation cost was small relative to routing and presentation bottlenecks.
- **Verification tolerance loosening:** rejected; unverified `Optimal` primals remain failures.

## Tests and reproducibility

Phase 3.5C adds/extends:

- accelerated SSP differential equivalence against the independent reference;
- accelerated ECMP equivalence including path counts/fractions and link loads;
- routing-session reuse/invalidation tests;
- Worker/synchronous analysis equivalence;
- deterministic workload/execution estimator tests;
- measured Worker threshold tests for Tier B versus Tier C;
- routing-LP size estimator correctness;
- exact complete/partial N-1 state tests;
- deterministic scale-generator hash tests;
- stale Worker authority-token tests;
- optimizer guardrail regression coverage at the 10,000 measured boundaries;
- 500-node Canvas load/navigation E2E;
- Worker-scale interactivity and live runtime E2E;
- stale large Worker publication E2E;
- bounded N-1 partial-coverage E2E;
- routing-LP scale-guard E2E;
- live Compute Profile E2E;
- adaptive renderer and large violation batching assertions.

The reproducible scale command emits machine-readable `scale.json`, `feature-scale.json`, `presentation-scale.json`, and `browser-scale.json` artifacts.

## Quality gate

The final validation candidate passed:

```text
npm ci
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run benchmark:level2
npm run benchmark:level3
npm run benchmark:scale
```

This includes retained Phase 3.5A/B and Level 0–3/adversarial coverage. Performance numbers are not gated on fragile millisecond thresholds; correctness and broad catastrophic regressions are gated.

## Remaining bottlenecks

1. **ECMP unique-source work** remains substantially more expensive than concentrated-source SSP because source/target reuse is lower and equal-cost flow accumulation is broader.
2. **Exact N-1** remains multiplicative in scenario count and routing workload. A 500-scenario Tier-C run is measured in minutes, not an interactive browser action.
3. **Arc-based multicommodity routing LP** has a low verified product envelope relative to large network sizes. It is the clearest Level 4 optimizer bottleneck.
4. **Main-thread presentation** is substantially improved but still shows several-hundred-millisecond long tasks in the CI browser at Tier C. Canvas drawing/search/layout are acceptable for the demonstrated scale but are not a 60-fps guarantee on all hardware.
5. **Very large evidence sets** are retained in memory even though DOM rendering is paged. More advanced evidence virtualization/indexing may be useful if future workloads generate materially larger result sets.

## Recommended Level 4 performance work

Promote only work justified by the measurements:

1. path-based/reduced routing optimization or column generation before attempting larger arc-based LPs;
2. N-1 structural screening/ranking so exact routing is reserved for the most consequential candidates while preserving explicit proof semantics;
3. deeper Worker scheduling/chunking and optional compiled graph kernels if ECMP/failure recomputation becomes the dominant target-scale bottleneck;
4. evidence-list virtualization/indexing if result cardinality grows beyond current paging needs;
5. only evaluate WebGPU/WebGL after CPU/Worker/Canvas limits are reproduced on workloads that matter to Level 4.

## Phase 3.5C completion statement

InfraTwin can now honestly demonstrate browser-scale network engineering on a realistic **500-node / 1,200-link / 400-demand** topology rather than only displaying a visually large graph. The claim is defensible because the browser run measures presentation, live Worker analysis, interaction during compute, exact bounded N-1, and feature-aware optimization guidance separately.

The correct product statement is not “everything works at 500/2,000/2,000.” It is:

- realistic 500-node browser workspace: demonstrated;
- canonical-limit deterministic routing: demonstrated in the engine benchmark;
- long-running ChangePlan analysis: Worker-backed;
- exact N-1: bounded and explicitly partial when incomplete;
- routing LP: recommended only through the independently verified 10k-flow-variable envelope;
- capacity MILP: separately guarded at the conservative 10k decision×scenario envelope;
- >500-node product operation: not claimed.

That is the measured, reproducible, and defensible Phase 3.5C operating envelope.
