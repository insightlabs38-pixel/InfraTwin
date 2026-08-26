# InfraTwin

InfraTwin is a browser-native network decision digital twin for change safety, capacity planning, and resilience. Human edits, deterministic solvers, evidence overlays, and WebMCP agents all operate on the same canonical browser state.

## Current status: Level 2 green contender

Level 2 implements the resilience gate from the planning pack:

- deterministic **ECMP** routing with equal split across all equal-cost shortest paths;
- single-link N-1 enumeration over immutable model/scenario snapshots;
- bounded browser Web Worker pool with deterministic async fallback;
- live progress, user/agent cancellation, scenario/runtime/worker limits, and cancellation-safe results;
- stale-result protection using both model and scenario hashes before publication;
- deterministic worst-contingency ranking with displayed score components;
- counterexample replay onto the shared topology workspace;
- max-flow/min-cut bottleneck analysis with stable cut-edge IDs;
- compute capability detection and graceful fallback when Workers, SharedArrayBuffer, or cross-origin isolation are unavailable;
- state-derived WebMCP registration groups with independent `AbortSignal` lifetimes;
- violation tools (`inspect_violation`, `show_counterexample`, `find_bottlenecks`) that only appear when failure evidence exists;
- candidate tools that only appear while a candidate exists;
- browser-local safety limits for imported model size and heavy analysis resources;
- Level 0/1 regression coverage plus Level 2 ECMP, min-cut, N-1, worker, cancellation, stale-job, compute, and WebMCP eval tests;
- a reproducible 50-node / 120-link / 60-demand / 120-contingency benchmark.

SharedArrayBuffer and Rust/WASM are intentionally **not required** at Level 2. The recorded TypeScript benchmark is already acceptable for the target demo scale, so no unmeasured accelerator claim is made.

## Routing semantics

Bundled scenarios use `routingProfile.mode = "ecmp"`.

For each demand, InfraTwin finds the shortest path cost by positive link weight and splits the demand equally across every equal-cost shortest path. Aggregate link load is the sum of each demand's fractional flow. The implementation exposes both a stable representative path and the complete per-link flow fractions used for capacity analysis.

`single-shortest-path` remains supported for Level 0 compatibility. ECMP projects require strictly positive weights so the equal-cost shortest-path graph remains acyclic and deterministic.

## Bundled demos

### Maintenance Trap

Baseline PASS. Simulating CHI–DAL maintenance reroutes gold traffic across DEN–ATL and pushes `L3` to 120%. A capacity candidate raises `L3` to 15 Gbps and restores the modeled target.

### Growth Wall

Baseline east–west core is 60%. +40% growth pushes `G2` to 84%; first modeled service-target failure appears at 1.35×. The deterministic candidate raises `G2` to 22 Gbps and restores at least 20% headroom.

### Resilience Gap

Bounded N-1 ranks `R2` as the worst link failure. Counterexample replay reroutes premium traffic onto `R4`/`R5`, both reaching 110%. Min-cut evidence maps bottleneck edges directly to graph IDs. The existing two-link capacity candidate restores the modeled target.

## Run

Requires Node.js 22+.

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run dev
```

Open `http://localhost:3000`.

Medium benchmark:

```bash
npm run benchmark:level2
```

## Level 2 WebMCP capability states

InfraTwin feature-detects `document.modelContext` and registers semantic engineering tools against public application services, never DOM automation.

Always-on core tools for a valid project:

- `inspect_network`
- `inspect_demands`
- `simulate_change`
- `run_capacity_analysis`
- `propose_change`

When the current network supports N-1 analysis:

- `run_contingencies`

When current evidence is FAIL:

- `inspect_violation`
- `show_counterexample`
- `find_bottlenecks`

When a candidate exists:

- `compare_candidate`
- `apply_candidate`
- `discard_candidate`

Each capability group has its own registration-scoped `AbortController`; leaving the corresponding state revokes that group cleanly. `run_contingencies` propagates the execution `AbortSignal` into the worker/fallback runner. Cancellation is surfaced as cancellation, never PASS.

## N-1 evidence contract

Contingency results include:

```text
verdict
modelHash
scenarioHash
solver id/version
assumptions[]
metrics {
  totalEligibleScenarios
  completedScenarios
  workerCount
  executionMode
  status
  worstLinkId
  worstScore
  ...
}
violations[]
witnesses[]
runtimeMs
```

Ranking is deterministic and explicitly defined as:

```text
1000 * criticalUnsatisfiedGbps
+ 100 * totalUnsatisfiedGbps
+ 10 * severeOverloadGbps
+ maxUtilizationPercent
```

The score is a demo planning heuristic, not a universal reliability metric.

## Repository layout

```text
apps/web                 Next.js workbench + real contingency Web Worker
packages/model           canonical model, validation, scenario/candidate semantics
packages/graph-engine    shortest path, ECMP, utilization, components, min-cut
packages/evidence        capacity/growth/N-1 orchestration, cancellation, evidence
packages/webmcp          state-derived semantic tool registration + activity telemetry
packages/scenarios       Maintenance Trap, Growth Wall, Resilience Gap, blank project
benchmarks               reproducible Level 2 medium benchmark
tests                    Level 0/1 regressions + Level 2 references/evals
planning                 governing planning pack + implementation status/benchmark record
```

See `planning/README.md` for planning precedence and `planning/LEVEL2_IMPLEMENTATION_STATUS.md` for the Level 2 gate mapping.
