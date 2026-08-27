# InfraTwin

InfraTwin is a browser-native collaborative network change-planning workbench. It keeps the canonical network separate from a visible, editable **Change Plan**, compiles that plan into the same deterministic solver overlays used by the validated Level 0–3 engine, and lets humans constrain and revise optimizer proposals before relying on verification.

> Plan and verify network changes before production.

## Product model

The primary workflow is now:

```text
BASE NETWORK
  +
CHANGE PLAN
  +
CONSTRAINTS / RESTRICTIONS
  ↓
deterministic analysis
  ↓
candidate proposal
  ↓
human revision
  ↓
verification
```

A `NetworkProject` remains the canonical base. Editing a `ChangePlan` never mutates it. `compileChangePlanToScenarioPatch()` deterministically translates planned outages, restorations, capacities, traffic edits, new demands, and growth into the existing solver-compatible `ScenarioPatch`; Level 0–3 routing, capacity, N-1, min-cut, cancellation, worker, and HiGHS logic is reused rather than replaced.

The browser workspace supports:

- named Change Plan creation and reset;
- planned link/node outages and restorations by selecting topology objects;
- planned link capacity changes;
- planned existing-demand bandwidth changes;
- new traffic demands with source, target, bandwidth, service class, and label;
- generic all-demand or selected-demand growth;
- target utilization, optional budget, N-1 requirement, and protected-service selections;
- locked links/nodes as explicit “do not modify” restrictions;
- constrained HiGHS capacity optimization that omits locked-link upgrade variables and reports lock-driven infeasibility honestly;
- optimizer changes represented inside the same Change Plan as agent proposals;
- individual proposal accept/reject, accept-all, and discard;
- semantic human / optimizer / system history;
- plan-analysis and candidate-verification staleness tied to semantic base + plan/revision hashes rather than layout.

## Template networks

Maintenance Trap, Growth Wall, and Resilience Gap remain bundled regression/onboarding assets, but they are no longer privileged product workflows. Each network can be opened with an empty Change Plan, and the corresponding saved example plan can optionally be loaded through the same plan machinery a human uses manually.

- **Maintenance Trap:** the saved plan disables `L1`; a human can reproduce it by selecting `L1` and adding an outage. Planned analysis exposes `L3` at 120%.
- **Growth Wall:** the saved plan applies +40% growth to `GD1`/`GD2`; the same generic growth editor reproduces `G2` at 84% and the existing first-failure behavior.
- **Resilience Gap:** the saved failure-replay plan disables `R2`; manual authoring produces the same southern `R4`/`R5` constraint. Independent N-1 enumeration remains available from the base or any current plan.

## Solver and provenance guarantees

The Level 0–3 computational core remains intact:

- deterministic single-shortest-path and ECMP routing;
- exact ECMP path-count reporting with bounded materialization;
- utilization/service evidence and route witnesses;
- deterministic growth and min-cut analysis;
- bounded worker-parallel N-1 with cancellation/progress/stale-result protection;
- browser-local HiGHS 1.15.2 traffic-allocation LP and discrete capacity-upgrade MILP;
- solver status/proof/objective/time-limit diagnostics;
- independent candidate verification;
- semantic SHA-256 model identity that ignores presentation layout while preserving engineering semantics;
- adversarial hardening for hostile metadata, threshold precision, unavailable-node LP routing, and canonical resource validation.

ChangePlan adds two identities:

- **plan hash:** effective changes + constraints + restrictions; this governs deterministic plan evidence freshness;
- **revision hash:** plan hash + proposal states; this additionally governs candidate-verification freshness.

Plan name, timestamps, status, history, and UI layout are not solver semantics.

## Constraint semantics

`targetUtilizationPct` is enforced by Change Plan analysis and passed into the capacity optimizer. `budgetCostUnits` is passed to the MILP when present. `requireN1` causes plan analysis to enumerate bounded single-link failures and those completed contingency scenarios are included in direct UI optimizer/verification requirements. Locked links are omitted from upgrade variables and verified independently.

Protected service-class IDs are first-class plan data and are used to identify violations affecting protected traffic. Phase 3.5A does **not** invent a new solver guarantee beyond the service-class routing/utilization semantics already modeled by Level 0–3.

## WebMCP scope

The existing WebMCP capability surface is preserved rather than redesigned in Phase 3.5A. Existing tools continue to use shared application services. Internal Change Plan services and lock state are available to the application layer, and existing candidate generation/optimization respects current locked links.

This phase does **not** claim complete WebMCP Change Plan coactivity; broader semantic tool design and product-specific WebMCP evaluation are intentionally deferred to Phase 3.5D.

## Run and verify

Requires Node.js 22+.

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run benchmark:level2
npm run benchmark:level3
```

`npm run test:e2e` exercises real browser plan authoring, proposal collaboration, cancellation/staleness, existing WebMCP lifecycle behavior, HiGHS WASM loading, import/export, and responsive-layout smoke checks.

## Repository layout

```text
apps/web/components      collaborative plan UI, topology, evidence, proposal/history components
apps/web/workers         contingency and optimizer Web Workers
packages/model           canonical project + ChangePlan/ScenarioPatch/CandidatePlan semantics and hashing
packages/graph-engine    deterministic routing, ECMP, utilization, components, min-cut
packages/evidence        capacity/change-plan/growth/N-1 orchestration and evidence
packages/optimizer       HiGHS LP/MILP formulation, lock constraints, diagnostics, independent verification
packages/webmcp          preserved state-derived WebMCP tool surface over shared services
packages/scenarios       network templates + optional saved Change Plan templates
benchmarks               reproducible Level 2 and Level 3 benchmarks
 tests                    Level 0–3, adversarial, and ChangePlan semantic regressions
 e2e                      Chromium product and WebMCP lifecycle coverage
planning                 architecture/status records
```

See `planning/LEVEL3_5A_CHANGE_PLAN_STATUS.md` for the exact Phase 3.5A schema, compilation/staleness contracts, test mapping, known limitations, and explicitly deferred Phase 3.5B/C/D work.
