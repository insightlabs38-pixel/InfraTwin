# Level 3 implementation status

Level 3 adds browser-local optimization without weakening InfraTwin's evidence or change-safety model.

## Implemented

- HiGHS 1.15.2 WebAssembly integration in a dedicated browser Worker.
- Traffic-allocation LP that minimizes maximum link utilization with per-demand flow conservation and capacity constraints.
- Discrete capacity-upgrade MILP with cost objective, optional budget, target utilization/headroom, baseline, and selected scenario constraints.
- Explicit solver diagnostics: solver/version, raw status, proof classification, objective, MIP gap when exposed, timeout flag/limit, runtime, model/scenario hashes, and problem hash.
- Timeout/status normalization that never maps a time-limited incumbent to `optimal`.
- Optimizer output is a `CandidatePlan`; optimization never mutates the canonical project.
- Reversible candidate application through an inverse candidate generated from the pre-apply snapshot.
- Independent deterministic candidate verifier that recomputes discrete upgrade cost and replays all selected scenarios. Any disagreement blocks the VERIFIED state.
- Dynamic WebMCP optimizer capability group: `optimize_capacity_plan`, `optimize_routing`, `verify_candidate`.
- UI controls for routing LP, minimum-cost mitigation, cancellation, solver evidence, verification, apply, and undo.

## Scope and assumptions

The Level 3 capacity MILP uses the deterministic routing loads for each selected scenario and chooses among declared discrete `upgradeOptions`. It intentionally does not change route weights or repair missing connectivity. Scenarios with capacity overrides are rejected because they would obscure whether capacity came from the candidate or scenario. This keeps the optimization auditable and aligned with the canonical local model.

## Level 3 gate

The automated Level 3 evaluation suite covers a known LP optimum, explicit LP/MILP infeasibility, Growth Wall minimum-cost mitigation, Resilience Gap selected N-1 mitigation, timeout proof semantics, independent verification/disagreement, exact candidate reversibility, and optimizer WebMCP registration/behavior. CI also runs strict TypeScript and a production Next.js build.

An optional Python/Vercel verifier is intentionally deferred: the required independent verification boundary is already implemented locally with a separate deterministic checker, and adding a server dependency is not justified unless a later evaluation requires cross-runtime verification.
