# InfraTwin Phase 3.5A — Collaborative Change Planning Status

## Scope

Phase 3.5A changes the product-facing abstraction from demo-specific scenario buttons to a first-class, visible `ChangePlan`. It deliberately does **not** implement the future scalable graph renderer (3.5B), large-network performance envelope work (3.5C), broad WebMCP coactivity redesign/evaluation (3.5D), or Level 4 features.

The validated Level 0–3 routing/evidence/worker/optimizer core remains the computation layer.

## Final ChangePlan schema

`packages/model/src/index.ts` defines:

```ts
interface ChangePlan {
  id: string;
  name: string;
  baseModelHash: string;
  changes: PlanChange[];
  constraints: PlanConstraints;
  restrictions: PlanRestrictions;
  proposals: PlanProposal[];
  history: PlanHistoryEvent[];
  status: 'draft' | 'analyzed' | 'failing' | 'candidate' | 'verified';
  createdAt: string;
  updatedAt: string;
}
```

Supported `PlanChange` types:

- `disable_link` / `enable_link`
- `disable_node` / `enable_node`
- `set_link_capacity`
- `set_demand_bandwidth`
- `add_demand`
- `demand_growth`

Every change has a stable ID, `human` or `agent` actor, semantic target, deterministic payload, timestamp, and optional rationale evidence IDs.

Constraints:

- `targetUtilizationPct` (default 80)
- optional `budgetCostUnits`
- `requireN1`
- `protectedServiceClassIds`

Restrictions:

- `lockedLinkIds`
- `lockedNodeIds`

No speculative Phase 3.5B/C/D fields were added.

## Relationship among model contracts

```text
NetworkProject             canonical base network; plan UI never mutates it
    +
ChangePlan                 product-facing collaborative artifact
    |
    | compileChangePlanToScenarioPatch()
    v
ScenarioPatch              deterministic solver-facing overlay
    |
    +--> runScenarioCapacityAnalysis / N-1 / min-cut / routing

CandidatePlan              optimizer/internal solver contract
    |
    | setCandidateProposals()
    v
PlanProposal[]             visible proposed changes inside ChangePlan
    |
    +--> accept one/all -> PlanChange(actor='agent')
    +--> reject/discard -> proposal state + history
```

The existing `ModelCommand` contract remains for explicit canonical mutations and legacy WebMCP compatibility. Plan authoring does not use it to mutate the base.

## Compilation semantics

`compileChangePlanToScenarioPatch(project, plan)` validates the plan is bound to the current semantic base hash, then applies plan changes sequentially into one deterministic effective overlay. Final arrays are stable-sorted.

The legacy `ScenarioPatch` gained optional backward-compatible restoration/bandwidth fields:

- `enabledNodeIds`
- `enabledLinkIds`
- `demandBandwidthOverrides`

Existing Level 0–3 patches remain valid.

Existing non-zero demand bandwidth edits compile to a multiplier when possible; exact overrides handle the zero-bandwidth edge case. Added-demand edits/growth are resolved before the final patch is emitted. Locks do not modify topology; they restrict candidate generation.

## Hash and staleness semantics

`changePlanHash()` covers only effective changes, constraints, and restrictions. It excludes name/status/timestamps/history/proposals.

Plan analysis stores `{ baseModelHash, planHash }`. Any semantic base/plan change makes that evidence stale. Layout-only node coordinate movement does not.

`changePlanRevisionHash()` adds proposal semantic content and proposal state. Candidate verification stores `{ baseModelHash, planHash, revisionHash }`, so accepting/rejecting proposals immediately makes prior VERIFIED evidence stale.

Pending proposals also record `sourcePlanHash`; accepting an optimizer proposal whose source plan no longer matches the current plan is rejected as stale.

## Constraint semantics

- Target utilization is enforced by `analyzeChangePlan` and passed to direct UI optimizer/verification requirements.
- Optional budget is passed to the capacity MILP.
- `requireN1` causes direct plan analysis to run complete bounded N-1 before marking the plan analyzed; completed contingency patches are included in direct optimizer and verification requirements.
- Protected service classes are first-class plan semantics and plan analysis identifies violations affecting them. No unsupported guarantee is claimed beyond the existing service-class/capacity model.

## Restrictions / locks

The capacity MILP accepts `lockedLinkIds` and creates no upgrade variable for those links. If a locked link is a required repair, preflight returns explicit infeasibility instead of silently ignoring the restriction.

The deterministic quick mitigation also refuses to propose a required locked-link change. Independent verification reports disagreement if a candidate modifies a locked link. Existing WebMCP `propose_change` and the browser optimizer service consume the same internal lock state without adding a new tool surface.

Node locks are represented and visible now; the Level 3 capacity optimizer has no node-modification decision variables, so there is no node optimizer action to suppress in this phase.

## Candidate collaboration lifecycle

Optimizer `CandidatePlan` remains internal. `setCandidateProposals()` converts supported candidate commands into visible `PlanProposal` rows with agent provenance and the source semantic plan hash.

Humans can:

- accept one proposed change;
- reject one proposed change;
- accept all current proposals;
- discard the candidate.

An accepted change becomes a normal `PlanChange` with `actor: 'agent'`; the human acceptance itself is separately recorded in history. No direct UI action applies the entire optimizer candidate to `NetworkProject`.

Any proposal decision invalidates prior candidate verification through the revision hash. Semantic plan edits also make pending proposals stale and prevent acceptance until candidate generation is rerun.

## History / provenance

History records semantic events only:

- plan creation/rename;
- human plan changes/removals;
- constraint/restriction changes;
- optimizer candidate proposal;
- human accept/reject/discard;
- system analysis/status changes;
- system verification invalidation.

Hover, selection, and other cosmetic UI interactions are not history events.

## Bundled template migration

Maintenance Trap, Growth Wall, and Resilience Gap retain their original network definitions and old compatibility metadata used by existing solver regressions. Each now also exposes `changePlanTemplate`:

- Maintenance: human `disable_link L1`.
- Growth: human `demand_growth [GD1, GD2] ×1.4`.
- Resilience: human `disable_link R2` failure replay.

The browser no longer needs `runMaintenance()` or `runGrowth()` special-case product functions. Opening a network starts an empty Change Plan; loading the example plan is optional. Required unit tests prove manual authoring is semantically equivalent to legacy demo overlays.

## UI architecture

Primary hierarchy:

- **Left — Change Plan:** name, changes, contextual selected-object actions, traffic/growth authoring, constraints, restrictions, optimizer proposals, history.
- **Center — Network:** base topology rendered with effective planned state and visual distinctions for planned outage/change, proposal, lock, violation, and selected evidence.
- **Right — Analysis / Evidence:** authoritative DRAFT/PASS/FAIL/STALE status, plan evidence, N-1 evidence, violations/min-cut, optimizer result, independent verification.

Advanced solver/WebMCP diagnostics remain collapsed.

New components:

- `ChangePlanPanel`
- `DemandPlanEditor`
- `CandidateProposalList`
- `PlanHistory`

Business semantics remain in shared model/evidence/optimizer packages rather than React-only functions.

## Tests

`tests/phase35a-change-plan.test.ts` covers the required A–L semantics:

- non-destructive plan authoring;
- deterministic compilation;
- semantic edit staleness;
- layout immunity;
- manual Maintenance equivalence;
- generic Growth equivalence;
- added-demand isolation;
- lock suppression;
- locked infeasibility;
- individual candidate accept/reject + stale verification;
- deterministic meaningful history;
- human/agent authorship.

`e2e/phase35a-change-plan.spec.ts` covers the five required browser workflows:

1. manually authored Maintenance outage/remove with unchanged base hash;
2. selected-demand +40% Growth without a special Growth action;
3. Resilience failure -> optimizer -> verification -> human lock -> stale verification -> explicit lock-driven infeasibility;
4. new service demand authored through UI with unchanged base;
5. two-change candidate with individual accept/reject, stale verification, provenance, and history.

Existing Level 3 browser tests were intentionally migrated from removed demo-specific action selectors to the generic Change Plan workflow. Their computational expected behavior remains unchanged.

## Quality gate

Final completion requires all of:

```text
npm ci
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run benchmark:level2
npm run benchmark:level3
```

The final branch/merge report records the exact passing run and test totals. All pre-existing Level 0–3/adversarial tests must remain green.

## Known limitations / explicitly deferred work

- Phase 3.5B: scalable workspace/large-graph rendering is not implemented here.
- Phase 3.5C: maximum-size browser performance/safety-envelope work is not implemented here.
- Phase 3.5D: full Change Plan WebMCP coactivity/tool redesign and its limited-budget product evaluation are not implemented here. Existing tools are preserved and connected to shared lock/application services only.
- Level 4 functionality is not implemented.
- Protected service selections identify protected-traffic violations but do not introduce an invented new solver guarantee.
- CandidatePlan commands outside the currently representable plan-change types are rejected rather than hidden.

Phase 3.5A is complete only when the generic browser authoring/constraint/lock/candidate/history flows and the full regression/quality gate are green.
