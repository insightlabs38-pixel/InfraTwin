# Level 4A Adaptive Network Design Optimization

**Status:** IN PROGRESS — implementation complete enough for clean CI validation

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

The optimizer never fabricates a new-link endpoint or cost.

## Required lock/replan reference

The deterministic Level 4A reference encodes:

- 12 Gbps A→D demand;
- normal SSP uses X→BD and overloads X;
- legacy capacity-only optimum: X 10→15 Gbps, cost 5;
- human locks X (modification forbidden, traffic still allowed);
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

M3.5D is extended rather than redesigned. `propose_mitigation` tries the proven capacity-only solver first and transparently falls back to adaptive design if allowed and needed. One concise state-dependent capability, `compare_mitigation_variants`, exposes a small verified Pareto frontier. Human edits invalidate/cancel stale adaptive work through the same shared application-service authority boundary.

## UI

- Network: current selected design summary and selected-demand default/proposed route comparison.
- Plans: compact nondominated design variants and selection.
- Analysis: adaptive solver/path/verification evidence.
- Existing Advanced diagnostics remain available; no new optimizer dashboard was introduced.

## Performance policy

`benchmark:level4-design` measures candidate-path generation, reduced path-LP size/solve, joint MILP size/solve, reconstructed verification, scenario generation, Pareto solve count, and path-vs-arc formulation size at the small reference plus Tier A/B/C workloads where reasonable. Joint routing+design is deliberately not forced at 250/500 nodes merely because deterministic analysis supports those sizes.

## Validation log

- Implementation commit: `904c1d34fdfa968e3c68350c38afb7094ad955b8`.
- Additive Level 4A CI-gate commit: `d75cbb62be51f6bf18aea3f71029b026317d6d19`.
- First authoritative clean run: `33280385404`. Clean install and Chromium setup passed; 118/120 unit tests passed. The two failures were isolated to failure-classification precedence and a new integration-test contract, while the core Level 4A mathematical reference cases passed under clean HiGHS execution.
- Bounded fix commit: `5a90e0d1a9f45a6e3cab0b5b0bbb9ba74fb2c0de`. It gives an active budget precedence when classifying an otherwise lock-constrained infeasible formulation and aligns the shared-service test with the existing proposal-history contract.
- Focused clean Level 4A suite after those fixes: 9/9 passed in workflow run `33290666979` before publication.

## Acceptance still outstanding

Level 4A is not complete until the exact target branch tip passes the additive gate:

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

Final measured benchmark values and exact-head CI identifiers will be recorded after clean GitHub validation.
