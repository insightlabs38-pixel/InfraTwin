# Level 4A Adaptive Network Design Optimization

**Status:** IN PROGRESS

## 0. Frozen baseline

Level 4A starts from the post-M3.5D `main` commit:

- starting commit: `2a309dce076181b7d140762938cacc0159b3690b`
- baseline quality-gate run: `33236971436`
- baseline quality-gate conclusion: **success**
- branch: `tmp/level-4a-adaptive-design`

The baseline passed the complete M3.5D gate: 111/111 unit tests, typecheck, production build, browser E2E, real headed Chromium `document.modelContext` WebMCP evaluation, Level 2 benchmark, Level 3 benchmark, and the retained Phase 3.5C scale benchmark.

Baseline Level 3 optimizer measurements from the frozen implementation:

| Workload | Result | Runtime |
| --- | --- | ---: |
| Reference routing LP | Optimal, 40% maximum utilization | 77.697 ms |
| Growth Wall capacity MILP | Optimal, G2 20→22 Gbps, cost 6, independently verified | 25.216 ms |
| Resilience Gap capacity MILP | Optimal, R4/R5 10→14 Gbps, cost 8 | 16.424 ms |

The Phase 3.5C measured routing-LP recommendation remains approximately 10,000 flow variables. The canonical browser-local deterministic analysis envelope remains 500 nodes; Level 4A does not raise that model limit.

## 1. Previous optimization limitation

The frozen capacity MILP performs deterministic SSP/ECMP routing before constructing capacity constraints. For every selected scenario it consumes those pre-routed link loads, then chooses only declared `upgradeOptions`. A human lock removes upgrade variables for the protected link. Therefore a required overloaded locked target can correctly make that formulation infeasible even when a different routing/design solution exists outside the old formulation.

Existing regression coverage deliberately demonstrates that limitation: the M3.5A lock test reports infeasible/no-plan when all capacity-only repair targets are protected. Level 4A must preserve the truth of the capacity-only solver while adding a separate bounded adaptive-design formulation that can express rerouting and declared design choices.

## Baseline invariants frozen for Level 4A

- Default network analysis remains deterministic SSP/ECMP.
- Existing capacity-only MILP and traffic-allocation LP remain available and correct.
- Human locks mean **do not modify**, not **do not route through**.
- WebMCP remains a view/control surface over the same browser-local `ChangePlan`; it is not redesigned.
- Optimizer proposals cannot apply the canonical `NetworkProject` without the existing human approval boundary.
- Stale/cancelled asynchronous results cannot publish after a semantic human edit.
- The M3.5C 500-node browser/Worker/Worker-pool scale envelope remains a regression gate.

The remainder of this document will be expanded with the final Level 4A formulation, reference proofs, benchmarks, safe envelope, WebMCP replan result, and deferred features once exact-head validation is complete.
