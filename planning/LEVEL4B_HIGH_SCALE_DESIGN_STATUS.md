# Level 4B High-Scale Adaptive Design Engine

**Status:** IN PROGRESS — frozen baseline and profiling complete; optimization implementation starting

## Frozen Level 4A baseline

- Level 4A merged to `main` through PR #12.
- Exact Level 4B starting commit: `caa194cb20ba3da8d19ff28fafffa09df71c0781`.
- Post-merge `main` quality gate: `33295072504` — success.
- Level 4B branch: `feature/level-4b-high-scale-design`.
- Level 4A exact-tip design artifact is preserved from run `33291895230`.

No Level 4B optimization was started until the merged Level 4A baseline was reproducible.

## Level 4A path-generation baseline

Authoritative GitHub benchmark values from the unchanged Level 4A workload:

| Fixture | Nodes | Links | Demands | K | Path variables | Candidate-path generation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Tier A | ~128 | ~304 | 96 | 3 | 288 | 4,731.222 ms |
| Tier B | ~250 | ~600 | 200 | 3 | 600 | 41,262.530 ms |
| Tier C | ~500 | ~1,200 | 400 | 3 | 1,200 | 354,586.969 ms |

The reduced path formulation is already approximately 202.67×, 400×, and 800× smaller than the corresponding demand×directed-arc formulation at Tiers A/B/C. Level 4B therefore freezes the Level 4A LP/MILP semantics and focuses on path preparation unless later profiling contradicts this decision.

## Workload structure

The deterministic Level 4A A/B/C workloads contain:

- Tier A: 96 demands, 92 unique source-target pairs, 8 unique sources.
- Tier B: 200 demands, 198 unique source-target pairs, 15 unique sources.
- Tier C: 400 demands, 397 unique source-target pairs, 30 unique sources.

Demand-level path-cache reuse is required, but duplicate route pairs are rare in these benchmark fixtures. The primary A/B/C speedup therefore cannot come from demand deduplication alone.

## Source audit

The frozen `level4-design.ts` path engine was inspected before modification. The Level 4A implementation currently:

1. rebuilds adjacency in every shortest-path invocation;
2. re-sorts every adjacency list in every shortest-path invocation;
3. uses an array queue with `sort()` + `shift()` for Dijkstra-like search;
4. invokes shortest path repeatedly for Yen spur searches;
5. reconstructs an edge-weight `Map` inside every Yen spur iteration;
6. repeatedly constructs string path/edge signatures in hot loops;
7. re-sorts the complete Yen candidate collection to select each next path;
8. generates candidate paths per demand rather than per semantic source-target request;
9. regenerates candidate path sets across Pareto solves and scenario-generation iterations.

M3.5C already contains a deterministic binary min-heap and reusable routing-session graph structures. Level 4B should reuse compatible low-level concepts rather than maintain a second queue-sorting shortest-path kernel.

## Baseline profiling

Profiling was performed against the exact frozen Level 4A source with observer instrumentation kept outside the repository. The instrumentation preserved the deterministic path-set hash on the measured fixtures.

### Tier A

- Local profiled path generation: ~3,967 ms.
- Shortest-path calls: 12,794.
- Queue sort/shift operations: 614,855.
- Yen root/spur searches: 12,698.
- Path-set hash: `fnv1a32:7c8e9410`.

Approximate runtime breakdown:

| Bucket | Share |
| --- | ---: |
| Adjacency reconstruction | 34.78% |
| Adjacency sorting | 5.93% |
| Search / queue / reconstruction | 15.73% |
| Per-spur edge-weight map reconstruction | 35.04% |
| Signature / deduplication | 2.75% |
| Candidate sorting | 0.39% |
| Other Yen root/spur work | 3.83% |
| Graph materialization + diversity + hashing + scenario overhead | ~1.55% |

### Tier B

- Local profiled path generation: ~33,765 ms.
- Shortest-path calls: 53,477.
- Queue sort/shift operations: 5,209,399.
- Yen root/spur searches: 53,277.
- Path-set hash: `fnv1a32:b3d715e5`.

Approximate runtime breakdown:

| Bucket | Share |
| --- | ---: |
| Adjacency reconstruction | 32.93% |
| Adjacency sorting | 5.35% |
| Search / queue / reconstruction | 22.25% |
| Per-spur edge-weight map reconstruction | 33.02% |
| Signature / deduplication | 2.47% |
| Candidate sorting | 0.30% |
| Other Yen root/spur work | 3.11% |
| Graph materialization + diversity + hashing + scenario overhead | <1% |

### Tier C profile sample

Full observer instrumentation at Tier C is too intrusive for the local execution envelope. A deterministic 50-demand sample on the unchanged 500-node / 1,200-link Tier C topology showed the same shape:

- adjacency reconstruction: ~31.92%;
- adjacency sorting: ~4.83%;
- search / queue / reconstruction: ~24.46%;
- per-spur edge-weight map reconstruction: ~32.61%;
- signature / deduplication: ~2.40%;
- other Yen work: ~2.91%.

The authoritative uninstrumented Tier C total remains 354,586.969 ms. Level 4B's checked-in profiler/benchmark must report full-workload low-overhead measurements without presenting the sampled percentages as a full Tier C profile.

## Root causes established before optimization

The profile supports three immediate changes without touching Level 4A mathematical semantics:

1. compile immutable indexed graph/adjacency state once per topology fingerprint;
2. precompute numeric directed-edge IDs and edge weights so Yen spur work does not rebuild maps;
3. replace full queue sorting with a deterministic binary min-heap and temporary exclusion overlays.

Those changes target roughly two-thirds of observed preparation time before considering higher-risk algorithm changes. K remains bounded to 1–8, so optimized deterministic Yen remains the first choice; Eppstein or Rust/WASM are not justified at this stage.

## Initial implementation order

1. `CompiledDesignGraph` with stable node/link/edge mappings and sorted immutable adjacency.
2. Deterministic binary-heap shortest path over banned-node / banned-edge overlays.
3. Exact differential tests against the frozen Level 4A path generator.
4. Optimized Yen candidate queue and prefix handling only if profiling still shows material cost.
5. Path cache keyed by topology fingerprint + source + target + K + diversity semantics.
6. Traffic-only scenario reuse, Pareto reuse, and incremental scenario-set extension.
7. Workload-aware reusable Worker pool after the synchronous kernel is efficient.
8. Rust/WASM decision only after the optimized TypeScript engine is re-profiled.

## Frozen semantic boundaries

Level 4B does **not** change:

- candidate-path K limits;
- demand conservation;
- joint MILP cost objective;
- capacity constraints;
- candidate-link semantics;
- reconstructed verification semantics;
- M3.5D WebMCP tools/authority boundaries;
- canonical model limits.

## Completion status

Level 4B is not complete. Before completion it still requires the optimized engine, cache/scenario/Pareto reuse, Worker execution where measured useful, randomized/exact differential tests, cancellation/staleness regression coverage, real-browser Tier A/B measurements, `benchmark:level4-scale`, memory measurements, final safe operating envelope, Rust/WASM decision evidence, and the full additive quality gate.
