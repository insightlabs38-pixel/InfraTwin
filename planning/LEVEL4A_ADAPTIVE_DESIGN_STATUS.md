# Level 4A Adaptive Network Design Optimization

**Status:** COMPLETE

## Frozen baseline

- Starting `main`: `2a309dce076181b7d140762938cacc0159b3690b`
- Baseline quality gate: `33236971436` — success
- Work branch: `tmp/level-4a-adaptive-design`

M3.5D remains the rollback boundary. Level 4A does not replace deterministic SSP/ECMP analysis, the existing capacity-only MILP, the browser-local ChangePlan, or the WebMCP coactivity architecture.

## Previous limitation

The frozen capacity MILP consumes pre-routed deterministic link loads and chooses only declared capacity upgrades. A human lock removes an upgrade variable but does not change routing, so a locked overloaded link can make that formulation infeasible even when another modeled routing/design solution exists.

## Level 4A formulation

Level 4A adds a separate bounded design path:

1. deterministic loop-free K candidate paths per demand using stable Yen-style alternatives;
2. a reduced path-allocation LP over `demand × candidate path`;
3. a joint MILP over path allocations plus declared capacity upgrades and, only when explicitly enabled, declared candidate links;
4. independently reconstructed primal verification before a design is labeled verified.

Normal SSP/ECMP analysis remains authoritative for the current network. Optimized route allocations are proposal evidence, not silent changes to base routing policy.

## Locks and routing restrictions

`locked` retains its M3.5D meaning: **do not modify**. A locked link may still carry traffic. Level 4A adds explicit `forbiddenRoutingLinkIds` / `forbiddenRoutingNodeIds` for human intent such as “do not route proposed traffic through this corridor.”

## Action boundary

The ChangePlan explicitly controls:

- capacity upgrades;
- routing changes;
- declared new links;
- K candidate paths, bounded to 1–8;
- declared candidate-link endpoints/capacity/weight/cost.

The optimizer never fabricates a new-link endpoint or cost. To preserve the M3.5A–D behavior boundary, newly created ChangePlans default to capacity upgrades enabled, adaptive routing disabled, and new links disabled. Routing redesign is therefore an explicit human opt-in before the shared service or WebMCP can fall back to the Level 4A adaptive solver.

## Required lock/replan reference

The deterministic Level 4A reference encodes:

- 12 Gbps A→D demand;
- normal SSP uses X→BD and overloads X;
- legacy capacity-only optimum: X 10→15 Gbps, cost 5;
- human locks X (modification forbidden, traffic still allowed);
- human explicitly enables adaptive routing;
- adaptive optimum: 8 Gbps remains on X→BD and 4 Gbps uses AC→Y;
- Y upgrades 2→5 Gbps, cost 8;
- expected route allocation: 66.7% / 33.3%;
- proposal must pass reconstructed verification.

## Additional deterministic references

- Declared candidate-link reference: at a 90% target, the declared A→C candidate costs 11 versus upgrade-only cost 18; disabling new-link actions forces the cost-18 alternative.
- Scenario-aware reference: baseline adaptive design costs 0, but the selected primary-corridor failure requires AC and CD upgrades for exact cost 12.
- Pareto lock reference: target utilizations 80/70/60 produce nondominated verified costs 8/12/16.

## Verification

Every adaptive variant carries source model/plan identity, candidate path-set hash, selected scenario identity, solver/version/status/proof, selected actions, routing allocations, declared cost/peak utilization, and reconstructed verification status.

The verifier reconstructs path continuity, demand conservation, action legality, link loads, capacity/utilization constraints, budget, objective, and scenario identity. It is described as **independently reconstructed primal verification**, not as a separate network simulator.

## WebMCP

M3.5D is extended rather than redesigned. `propose_mitigation` tries the proven capacity-only solver first and transparently falls back to adaptive design only when routing redesign is explicitly allowed and needed. One concise state-dependent capability, `compare_mitigation_variants`, exposes a small verified Pareto frontier. Human edits invalidate/cancel stale adaptive work through the same shared application-service authority boundary.

The headed native Chromium lane exercises real `document.modelContext` discovery/execution for the Level 4A replan sequence: capacity-only cost 5 → human locks X → adaptive verified Y alternative cost 8 → `verify_plan` confirms reconstructed adaptive verification.

## UI

- Network: current selected design summary and selected-demand default/proposed route comparison.
- Plans: compact nondominated design variants and selection.
- Analysis: adaptive solver/path/verification evidence.
- Constraints: explicit human controls for adaptive routing, new links, and candidate-path bound.
- Existing Advanced diagnostics remain available; no new optimizer dashboard was introduced.

## Performance policy and measured envelope

`benchmark:level4-design` measures candidate-path generation, reduced path-LP size/solve, joint MILP size/solve, reconstructed verification, scenario generation, Pareto solve count, and path-vs-arc formulation size at the small reference plus Tier A/B/C workloads where reasonable. Joint routing+design is deliberately not forced at 250/500 nodes merely because deterministic analysis supports those sizes.

Authoritative Level 4A benchmark artifact `level4a-design-benchmark` from run `33291272722`, commit `c017e33db38f38844cbe57cd9c9fb0431f38ad98`:

| Fixture | Result | Runtime |
| --- | --- | ---: |
| Lock/replan K-path generation | 2 deterministic path variables | 10.148 ms |
| Reduced path LP | 40% optimum, verified | 81.281 ms |
| Joint adaptive MILP | optimal cost 8, 80% peak, verified | 36.470 ms |
| Reconstructed verification | verified cost 8 / 80% peak | 21.877 ms |
| Pareto frontier | verified costs 8 / 12 / 16 at 80 / 70 / 60% | 60.138 ms |
| Scenario-aware loop | converged in 2 iterations, cost 12, verified | 57.890 ms |
| Tier A path formulation | 288 path vars vs 58,368 arc vars, 202.67× smaller | 4,747.713 ms K-path generation |
| Tier B path formulation | 600 path vars vs 240,000 arc vars, 400× smaller | 41,574.598 ms K-path generation |
| Tier C path formulation | 1,200 path vars vs 960,000 arc vars, 800× smaller | 354,660.745 ms K-path generation |

Tier A also completed an optimal joint solve in 4,901.446 ms. Tier B/C deliberately do not attempt the joint design solve. The Tier C K-path runtime establishes the current product boundary: large-network deterministic analysis remains supported, but Level 4A adaptive design is not presented as an interactive 500-node optimizer.

The retained Phase 3.5C browser scale gate also remained green on the same exact commit at 500 nodes / 1,200 links / 400 demands: initial canvas render 1,126.5 ms, worker ChangePlan analysis 954.9 ms, bounded 50-scenario N-1 worker pool 6,652.5 ms, interaction during Tier C worker analysis 63.4 ms, and Tier C ECMP worker analysis 1,462.2 ms.

## Validation log

- Implementation commit: `904c1d34fdfa968e3c68350c38afb7094ad955b8`.
- Additive Level 4A CI-gate commit: `d75cbb62be51f6bf18aea3f71029b026317d6d19`.
- First authoritative clean run: `33280385404`. Clean install and Chromium setup passed; 118/120 unit tests passed. The two failures were isolated to failure-classification precedence and a new integration-test contract, while the core Level 4A mathematical reference cases passed under clean HiGHS execution.
- Bounded fix commit: `5a90e0d1a9f45a6e3cab0b5b0bbb9ba74fb2c0de`. It gives an active budget precedence when classifying an otherwise lock-constrained infeasible formulation and aligns the shared-service test with the existing proposal-history contract.
- Focused clean Level 4A suite after those fixes: 9/9 passed in workflow run `33290666979` before publication.
- Full validation run `33290711342` reached 120/120 units, typecheck, and production build. Browser validation then exposed two product/test compatibility issues: an obsolete stale-history assertion in the new Level 4A case and adaptive routing being silently enabled for legacy ChangePlans.
- Compatibility commit: `b33ae21186998367014235a4c7cd04a898840c61`, `fix(level4a): make adaptive routing an explicit opt-in`.
- Guarded compatibility workflow `33291193470` passed 120/120 units, typecheck, and all 10 affected browser tests (`e2e/level4a-adaptive-design.spec.ts` plus `e2e/phase35a-change-plan.spec.ts`) before publishing that commit. This confirms the existing M3.5A locked-infeasibility behavior is preserved while Level 4A cases explicitly opt into routing redesign.
- Authoritative full-gate commit: `c017e33db38f38844cbe57cd9c9fb0431f38ad98`.
- Authoritative full-gate run: `33291272722` — **success**.
- Unit tests: **120/120 passed**.
- TypeScript: **passed**.
- Production build: **passed**.
- Ordinary Playwright E2E: **44 passed, 2 native-only tests intentionally skipped**.
- Headed native WebMCP: **2/2 passed**, including the Level 4A human-lock adaptive replan.
- `benchmark:level2`: **passed**.
- `benchmark:level3`: **passed**.
- `benchmark:scale`: **passed**, including 500-node browser/worker measurements.
- `benchmark:level4-design`: **passed**, with machine-readable JSON and Markdown artifacts uploaded.

## Acceptance result

The exact implementation tip passed the complete additive acceptance gate:

- `npm ci`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run test:e2e`
- `npm run test:webmcp:native`
- `npm run benchmark:level2`
- `npm run benchmark:level3`
- `npm run benchmark:scale`
- `npm run benchmark:level4-design`

**Level 4A status: COMPLETE.**
