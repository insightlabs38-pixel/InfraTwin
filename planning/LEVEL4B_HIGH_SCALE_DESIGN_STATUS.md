# Level 4B High-Scale Adaptive Design Engine

**Status:** IMPLEMENTATION COMPLETE — final cleaned quality gate required before merge/freeze

## Frozen Level 4A baseline

- Level 4A merged to `main` through PR #12.
- Exact Level 4B starting commit: `caa194cb20ba3da8d19ff28fafffa09df71c0781`.
- Post-merge Level 4A `main` quality gate: `33295072504` — success.
- Level 4B branch: `feature/level-4b-high-scale-design`.
- Level 4A exact-tip design artifact is preserved from run `33291895230`.

No Level 4B optimization was started until the merged Level 4A baseline was reproducible.

## Frozen Level 4A path-generation baseline

The Level 4B benchmark keeps the exact Level 4A deterministic A/B/C fixtures, seeds, demand counts, and `K=3` path semantics.

| Fixture | Nodes | Links | Demands | K | Level 4A candidate-path generation |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tier A | ~128 | ~304 | 96 | 3 | 4,731.222 ms |
| Tier B | ~250 | ~600 | 200 | 3 | 41,262.530 ms |
| Tier C | ~500 | ~1,200 | 400 | 3 | 354,586.969 ms |

The reduced path formulation was already approximately 202.67×, 400×, and 800× smaller than the corresponding demand×directed-arc formulation at Tiers A/B/C. Level 4B therefore kept the Level 4A LP/MILP formulation and verification semantics frozen and optimized path preparation/execution instead.

## Baseline profile and root cause

The frozen Level 4A path generator repeatedly rebuilt and sorted adjacency, used `sort()` + `shift()` as its shortest-path queue, rebuilt an edge-weight map inside Yen spur searches, rebuilt signatures in hot loops, re-sorted candidate collections, and regenerated equivalent path sets across repeated semantic requests.

Low-overhead profiling established that adjacency reconstruction plus per-spur edge-weight-map construction accounted for roughly two-thirds of Tier A/B path-generation time. Queue/search work was the next material bucket. Duplicate source-target pairs were too rare in the scale fixtures for demand deduplication alone to explain a useful speedup.

## Implemented Level 4B engine

Level 4B adds `packages/optimizer/src/level4-path-engine.ts` and keeps the original Level 4A generator as `generateCandidatePathsReference` for exact differential testing.

The optimized engine provides:

1. **Compiled immutable graph state**
   - deterministic sorted node IDs;
   - numeric directed-edge IDs;
   - precomputed edge weights and immutable adjacency;
   - graph reuse by semantic topology fingerprint.

2. **Deterministic heap shortest path**
   - binary min-heap rather than full queue sorting;
   - stable tie-breaking compatible with the frozen Level 4A reference;
   - banned-node / banned-edge overlays rather than graph reconstruction.

3. **Optimized bounded Yen K-shortest paths**
   - K remains bounded by existing product semantics;
   - numeric spur exclusions;
   - heap-backed candidate selection;
   - exact loopless-path and diversity behavior retained.

4. **Semantic route caching**
   - route key: topology fingerprint + source + target + K + diversity penalty;
   - graph LRU bound: 32 topology entries;
   - route LRU bound: 4096 route entries;
   - approximate retained memory exposed for diagnostics.

5. **Safe reuse**
   - demand bandwidth changes reuse routes;
   - budget changes reuse routes;
   - target-utilization changes reuse routes;
   - traffic-only scenario patches reuse the same topology routes;
   - duplicate source-target demands reuse one semantic request;
   - Pareto variants generate one candidate path set and share it across solves.

6. **Required invalidation**
   - link/node availability changes;
   - routing weight changes;
   - link direction/bidirectionality changes;
   - forbidden routing links/nodes;
   - candidate-link addition/removal/weight/direction changes;
   - topology replacement.

Fields excluded from the path fingerprint are deliberately non-routing fields such as demand bandwidth, physical capacity, upgrade cost, budget, and utilization target; they affect feasibility/objective but do not change candidate route geometry or path cost.

## Browser execution and cancellation

Adaptive optimization remains off the UI thread. `apps/web/lib/optimizer-client.ts` now uses a bounded reusable optimizer Worker pool instead of creating/terminating a fresh Worker for every successful operation.

- pool maximum is capped at 4 and also leaves one hardware thread available where possible;
- a completed Worker is reused, allowing Level 4B graph/route caches to survive normal sequential reruns;
- cancellation still terminates the active Worker, preventing a cancelled invocation from later publishing a result;
- queued callers respect `AbortSignal` cancellation;
- task IDs isolate callbacks from previous invocations.

Adaptive design also reports explicit user-facing phases:

1. `Preparing route alternatives`
2. `Building optimization model`
3. `Solving design`
4. `Verifying proposal`

The Analysis evidence view exposes compact compute evidence including unique route pairs, cache hit rate, path-generation time, graph-compile time, and approximate retained cache size.

## Equivalence and correctness coverage

`tests/level4b-path-engine.test.ts` adds additive regression gates for:

- deterministic compiled-graph structure/fingerprints;
- exact optimized-vs-reference path-set equivalence through K=8 across fixed and generated networks;
- candidate-link equivalence;
- duplicate-demand reuse;
- traffic-only, bandwidth, budget, and utilization reuse;
- topology/restriction/candidate invalidation;
- distinct topology-scenario fingerprints;
- cancellation;
- bounded cache eviction;
- one exact candidate path set shared across Pareto variants;
- adaptive-design progress phase ordering.

The frozen Level 4A generator remains available specifically so cache-disabled/reference execution can be compared against the optimized path engine during later adversarial validation.

## Measured Level 4B result

Focused CI measurement on the unchanged Level 4A semantic workloads produced:

| Fixture | Level 4A | Level 4B cold path generation | Speedup | Warm budget/target-only rerun |
| --- | ---: | ---: | ---: | ---: |
| Tier A | 4,731 ms | ~506 ms | ~9.35× | ~17 ms |
| Tier B | 41,263 ms | ~3,975 ms | ~10.38× | ~58 ms |
| Tier C | 354,587 ms | ~37,618 ms | ~9.43× | ~204 ms |

Approximate retained Level 4B graph/path-cache memory in those runs was about 0.59 MiB / 1.49 MiB / 2.97 MiB for A/B/C respectively.

After optimization, graph compilation and path-set hashing are negligible relative to cold path generation. The remaining dominant cold-path bucket is Yen spur/alternative search. That is expected and bounded by the existing K/product envelope rather than by accidental graph reconstruction.

## Rust/WASM decision gate

**Decision: do not add a Rust/WASM graph kernel.**

The optimized TypeScript engine reaches the required performance class without changing the mathematical formulation or adding a second implementation language:

- Tier A: sub-second candidate-path generation class;
- Tier B: few-second class;
- Tier C: tens-of-seconds class;
- warm target/budget reruns: tens to low hundreds of milliseconds.

A Rust/WASM kernel would add equivalence, build, binary-size, debugging, and maintenance risk without evidence that it is necessary for the submission envelope. Level 4B therefore stops at the optimized TypeScript + Worker design.

## Frozen semantic boundaries

Level 4B does **not** change:

- candidate-path K limits;
- demand conservation;
- joint MILP cost objective;
- capacity constraints;
- candidate-link semantics;
- scenario semantics;
- reconstructed primal verification semantics;
- M3.5D WebMCP tools/authority boundaries;
- canonical model limits;
- solver proof/status semantics.

## Cleanup and final gate

Temporary implementation-only workflows and migration scripts (`level4b-apply`, `level4b-finalize`, and `level4b-verify`) were removed after the generated implementation was materialized. The permanent `.github/workflows/ci.yml` retains the Level 4B benchmark as part of the normal repository quality gate.

Before Level 4B is merged/frozen, the **cleaned branch head** must pass the complete permanent gate:

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
- `npm run benchmark:level4-scale`

The successful run and resulting merged SHA are recorded by the final merge/validation step rather than being predeclared here.

## Safe operating envelope / known residual limits

- Tier A adaptive path preparation is near-interactive.
- Tier B remains a deliberate multi-second operation and must stay in a Worker.
- Tier C remains a deliberate long-running operation in the tens-of-seconds class; cancellation/progress are required UX, not optional optimizations.
- Route caches are process/Worker-local and bounded; they are performance state, never authority state.
- Cache hits are never accepted as verification. The existing independent reconstruction/verification remains the authority boundary after optimization.
- No Level 4C or speculative performance architecture is justified by current evidence.
