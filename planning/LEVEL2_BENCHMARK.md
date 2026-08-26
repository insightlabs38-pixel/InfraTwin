# Level 2 Medium Benchmark

Recorded on 2026-08-26 with Node.js 22.16.0 using the reproducible script `benchmarks/level2-medium.ts`.

Fixture matches the planning target:

- 50 nodes
- 120 links
- 60 demands
- ECMP routing
- 120 single-link N-1 cases

Measured sample:

| Metric | Result |
|---|---:|
| base routing + capacity | 185.619 ms |
| sequential N-1 total | 2581.101 ms |
| sequential throughput | 46.49 scenarios/s |
| bounded async fallback slots | 4 |
| async fallback N-1 total | 1819.851 ms |
| async fallback throughput | 65.94 scenarios/s |
| shared memory | off |
| deterministic worst link | `L101` |
| sequential/fallback ranking match | yes |

These numbers are a local development sample, not a browser Web Worker speedup claim. Browser runtime varies by CPU and scheduler. The UI reports the actual detected execution mode, worker count, completion progress, and runtime for each run.

Decision: keep the TypeScript worker/fallback implementation for Level 2. SharedArrayBuffer, cross-origin isolation, Rust/WASM, and GPU acceleration remain optional because this benchmark is already within an acceptable demo-scale latency and adding them would increase deployment risk without measured need.
