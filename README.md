# InfraTwin

InfraTwin is a browser-native network decision digital twin for change safety, capacity planning, resilience, and optimization. Human edits, deterministic solvers, evidence overlays, optimizer candidates, and WebMCP agents all operate on the same canonical browser state.

## Current status: Level 3 optimization contender

Levels 0–2 are preserved while Level 3 adds a real browser-local optimization layer:

- pinned **HiGHS 1.15.2 WebAssembly** solver loaded in a dedicated browser Worker;
- traffic-allocation LP that minimizes maximum link utilization under per-demand flow conservation and link capacities;
- discrete capacity-upgrade MILP minimizing declared upgrade cost under utilization/headroom, budget, baseline, and selected scenario constraints;
- explicit solver status/proof, objective, gap when exposed, time limit, runtime, solver/version, model/scenario hashes, and problem hash;
- time-limited runs never claim optimality unless the solver status proves it;
- optimizer output is always a `CandidatePlan`, never an implicit mutation;
- independent deterministic candidate verification that recomputes upgrade cost and replays selected scenarios;
- verifier disagreement blocks the VERIFIED badge;
- reversible candidate application with exact model-hash restoration for supported commands;
- WebMCP optimizer tools (`optimize_capacity_plan`, `optimize_routing`, `verify_candidate`) registered only after the HiGHS worker probes successfully;
- Level 0/1/2 regression coverage plus Level 3 LP, MILP, infeasibility, status, reversibility, verification, and WebMCP reference tests.

Level 2 remains the resilience foundation: deterministic ECMP, bounded worker-parallel N-1, cancellation/progress, stale-result protection, counterexample replay, min-cut evidence, dynamic capability groups, and browser-local safety bounds.

## Optimization semantics

The capacity MILP is intentionally narrow and auditable. It chooses only from each link's declared `upgradeOptions`. For each selected baseline/failure/growth scenario, InfraTwin computes the deterministic routing loads and requires the chosen discrete capacity to keep each active link at or below the requested utilization target. Optional budget constraints are enforced in the same MILP.

A missing route is reported as infeasible because capacity-only upgrades cannot repair connectivity. Scenario-level capacity overrides are rejected for optimization so capacity provenance remains unambiguous. A feasible time-limited incumbent may be shown as such, but it is never labeled minimum-cost without an optimal solver status.

The independent verifier does not trust the optimizer objective. It reapplies the candidate to the original model, confirms every capacity is a declared discrete option, recomputes cost, checks budget, and reruns all selected scenarios. Only agreement across those checks produces VERIFIED.

## Routing semantics

Bundled scenarios use `routingProfile.mode = "ecmp"`.

For each demand, InfraTwin finds the shortest path cost by positive link weight and splits the demand equally across every equal-cost shortest path. Aggregate link load is the sum of each demand's fractional flow. The implementation exposes both a stable representative path and the complete per-link flow fractions used for deterministic capacity/resilience analysis.

`single-shortest-path` remains supported for Level 0 compatibility. ECMP projects require strictly positive weights so the equal-cost shortest-path graph remains acyclic and deterministic.

The separate Level 3 traffic-allocation LP is an optimization reference: it may split commodity flow across any capacity-feasible topology path to minimize maximum utilization. It does not mutate the canonical routing profile.

## Bundled demos

### Maintenance Trap

Baseline PASS. Simulating CHI–DAL maintenance reroutes gold traffic across DEN–ATL and pushes `L3` to 120%. A capacity candidate raises `L3` to 15 Gbps and restores the modeled target.

### Growth Wall

Baseline east–west core is 60%. +40% growth pushes `G2` to 84%; first modeled service-target failure appears at 1.35×. The Level 3 MILP proves the minimum-cost declared plan is `G2` → 22 Gbps at cost 6 for an 80% utilization target.

### Resilience Gap

Bounded N-1 ranks `R2` as the worst link failure. Counterexample replay reroutes premium traffic onto `R4`/`R5`, both reaching 110%. The Level 3 MILP can optimize that selected failure and proves `R4`/`R5` → 14 Gbps at total cost 8 for an 80% target; the independent checker then replays the failure before VERIFIED is shown.

## Run

Requires Node.js 22+.

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run dev
```

The web `dev` and `build` scripts copy `node_modules/highs/build/highs.wasm` into the app's public solver assets before Next.js starts. Open `http://localhost:3000`.

Benchmarks:

```bash
npm run benchmark:level2
npm run benchmark:level3
```

## WebMCP capability states

InfraTwin feature-detects `document.modelContext` and registers semantic engineering tools against public application services, never DOM automation.

Always-on core tools for a valid project: `inspect_network`, `inspect_demands`, `simulate_change`, `run_capacity_analysis`, `propose_change`.

When N-1 is available: `run_contingencies`.

When current evidence is FAIL: `inspect_violation`, `show_counterexample`, `find_bottlenecks`.

When the HiGHS Worker is ready: `optimize_capacity_plan`, `optimize_routing`, `verify_candidate`.

When a candidate exists: `compare_candidate`, `apply_candidate`, `discard_candidate`.

Each capability group has its own registration-scoped `AbortController`; leaving the corresponding state revokes that group cleanly. Long resilience and optimizer work propagates cancellation to the browser execution boundary. Cancellation is surfaced as cancellation, never PASS or OPTIMAL.

## Evidence contracts

Resilience results retain deterministic ranking, model/scenario hashes, assumptions, violations, witnesses, worker mode/count, progress status, and runtime. The N-1 ranking heuristic remains:

```text
1000 * criticalUnsatisfiedGbps
+ 100 * totalUnsatisfiedGbps
+ 10 * severeOverloadGbps
+ maxUtilizationPercent
```

Optimizer evidence adds:

```text
solver / solverVersion
status / proof
objectiveValue / mipGap
timedOut / timeLimitMs / runtimeMs
modelHash / scenarioHashes / problemHash
selected upgrades
candidate plan
independent verification status + disagreement reasons
```

The N-1 score is a demo planning heuristic, not a universal reliability metric.

## Repository layout

```text
apps/web                 Next.js workbench + contingency/optimizer Web Workers
packages/model           canonical model, validation, reversible scenario/candidate semantics
packages/graph-engine    shortest path, ECMP, utilization, components, min-cut
packages/evidence        capacity/growth/N-1 orchestration, cancellation, evidence
packages/optimizer       HiGHS LP/MILP formulation, diagnostics, candidate verification
packages/webmcp          state-derived semantic tool registration + activity telemetry
packages/scenarios       Maintenance Trap, Growth Wall, Resilience Gap, blank project
scripts                  build/dev preparation for local WASM solver asset
benchmarks               reproducible Level 2 and Level 3 benchmarks
tests                    Level 0–3 reference and regression evaluations
planning                 governing planning pack + implementation status/benchmark records
```

See `planning/README.md`, `planning/LEVEL2_IMPLEMENTATION_STATUS.md`, and `planning/LEVEL3_IMPLEMENTATION_STATUS.md` for gate mapping and planning precedence.


## Level 3 hardening

The current Level 0–3 product is frozen for a reliability and judge-facing product-quality pass before any Level 4 work. The workbench now separates the primary engineering journey from advanced protocol/solver diagnostics, routes human semantic edits through validated `ModelCommand` application, and uses a semantic SHA-256 model identity that excludes layout-only node coordinates and presentation metadata.

WebMCP analysis contracts are state-honest: `simulate_change` is read-only, N-1 ranking does not silently replay a failure, and `show_counterexample` is only registered when a valid ranking exists. Model-derived tool output is marked as untrusted content where imported/user-controlled labels may be present.

Browser regression coverage is available with `npm run test:e2e` and covers the bundled Maintenance Trap, Growth Wall, and Resilience Gap workflows plus cancellation, reset/switch stale-result protection, import/export, HiGHS worker loading, and responsive-layout smoke checks.

See `planning/LEVEL3_HARDENING_STATUS.md` for the exact hardening scope and remaining limitations. The next stage after this gate is a dedicated adversarial/fuzz/evaluation pass; this hardening pass does not claim that adversarial testing is complete.
