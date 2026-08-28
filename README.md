# InfraTwin

InfraTwin is a browser-native collaborative network change-planning workbench. It keeps the canonical network separate from a visible, editable **ChangePlan**, compiles that plan into the same deterministic solver overlays used by the validated Level 0–3 engine, and lets humans and WebMCP agents collaborate on the same unsaved engineering artifact without bypassing human approval.

> Plan and verify network changes before production.

## Product model

The primary workflow is:

```text
HUMAN UI -------------------\
                            \
                             > Shared application service
                            /            |
WEBMCP AGENT --------------/             v
                              NetworkProject + ChangePlan
                                         |
                                         v
                          deterministic analysis / optimizer / evidence
                                         |
                                         v
                                 human approval / verification
```

A `NetworkProject` remains the canonical base. Editing a `ChangePlan` never mutates it. `compileChangePlanToScenarioPatch()` deterministically translates planned outages, restorations, capacities, traffic edits, new demands, and growth into the existing solver-compatible `ScenarioPatch`; Level 0–3 routing, capacity, N-1, min-cut, cancellation, Worker, and HiGHS logic is reused rather than replaced.

The browser workspace supports:

- named ChangePlan creation and reset;
- planned link/node outages and restorations by selecting topology objects;
- planned link capacity changes;
- planned existing-demand bandwidth changes;
- new traffic demands with source, target, bandwidth, service class, and label;
- generic all-demand or selected-demand growth;
- target utilization, optional budget, N-1 requirement, and protected-service selections;
- locked links/nodes as explicit “do not modify” restrictions;
- constrained HiGHS capacity optimization that omits locked-link upgrade variables and reports lock-driven infeasibility honestly;
- optimizer changes represented inside the same ChangePlan as agent proposals;
- individual proposal accept/reject, accept-all, and discard;
- semantic human / agent / system history;
- plan-analysis and candidate-verification staleness tied to semantic base + plan/revision hashes rather than layout.

## Human + WebMCP coactivity

InfraTwin does not use WebMCP merely to expose network APIs. WebMCP operates inside the same live browser page and shares the human's current unsaved **Network + ChangePlan** through `CollaborativeWorkspaceService`.

The human can:

- select infrastructure visually;
- create and remove ChangePlan changes;
- edit constraints;
- lock resources the agent/optimizer must not modify;
- accept/reject individual agent proposals;
- inspect deterministic evidence in the topology.

The agent can:

- inspect that exact live workspace and current human selection;
- add visible agent-attributed ChangePlan changes;
- update supported constraints/restrictions;
- analyze the current plan and publish the same evidence into the UI;
- run bounded N-1 with truthful complete/partial coverage;
- generate deterministic mitigation proposals under current locks/budget;
- observe human edits that make old evidence/proposals/verification stale;
- focus a deterministic violation so the human sees the same topology object;
- verify the current shared plan without equating verification with deployment.

Both sides use the same semantic service and deterministic evidence. There is no hidden persistent agent ScenarioPatch. WebMCP has no canonical `apply_candidate` capability; final engineering changes retain the explicit human approval boundary.

The concise ChangePlan-centric WebMCP vocabulary includes workspace/selection/plan/analysis inspection, shared plan authoring, analysis/N-1/verification, and dynamically registered evidence/mitigation/proposal capabilities. Tool availability reflects semantic preconditions: for example, violation tools require current failing evidence, and proposal decision tools disappear when a human edit makes the proposal stale.

Imported labels/names/metadata are treated as untrusted data and read tools retain `untrustedContentHint`. Long-running WebMCP operations accept execution cancellation and use model/plan hash authority so obsolete results cannot publish after concurrent human changes.

## Application workspace

The bounded M3.5C.5 shell remains intact:

- **Network** — primary ChangePlan + topology + contextual inspector workflow;
- **Analysis** — detailed routes, violations, contingencies, bottlenecks, and evidence;
- **Plans** — current plan metadata/templates/history;
- **Settings / Model** — canonical network assumptions and upgrade catalog;
- **Advanced** — compute/solver/WebMCP diagnostics.

M3.5D adds only compact collaboration feedback to the normal workspace. Raw tool lists, activity logs, and developer diagnostics remain under Advanced.

## Template networks

The flagship **Continental Service Network** models 128 nodes, 304 links, 96 demands, and six regions. Its Saturday-maintenance workflow demonstrates the main coactivity loop: a human plans a backbone outage, an agent adds Payments growth and analyzes the same plan, deterministic evidence identifies the distant Southeast–Central corridor, the agent proposes mitigation, and human locks/rejections immediately invalidate agent assumptions.

Maintenance Trap, Growth Wall, and Resilience Gap remain bundled regression/onboarding assets. Each network uses the same generic ChangePlan machinery.

- **Maintenance Trap:** disabling `L1` exposes `L3` at 120%.
- **Growth Wall:** +40% coordinated demand growth exposes `G2` at 84% and the validated first-failure behavior.
- **Resilience Gap:** failure of `R2` reroutes premium traffic onto the constrained southern `R4`/`R5` corridor.

## Solver and provenance guarantees

The Level 0–3 computational core remains intact:

- deterministic single-shortest-path and ECMP routing;
- exact ECMP path-count reporting with bounded materialization;
- utilization/service evidence and route witnesses;
- deterministic growth and min-cut analysis;
- bounded Worker-parallel N-1 with cancellation/progress/stale-result protection;
- browser-local HiGHS 1.15.2 traffic-allocation LP and discrete capacity-upgrade MILP;
- solver status/proof/objective/time-limit diagnostics;
- independent candidate verification;
- semantic SHA-256 model identity that ignores presentation layout while preserving engineering semantics;
- adversarial hardening for hostile metadata, threshold precision, unavailable-node LP routing, and canonical resource validation.

ChangePlan has two semantic identities:

- **plan hash:** effective changes + constraints + restrictions; governs deterministic plan evidence freshness;
- **revision hash:** plan hash + proposal states; additionally governs candidate-verification freshness.

Plan name, timestamps, status, history, human selection, current destination, zoom/pan, panel layout, filters, and label density are not solver semantics.

## Constraint and mitigation semantics

`targetUtilizationPct` is enforced by ChangePlan analysis and passed into the capacity optimizer. `budgetCostUnits` is passed to the MILP when present. `requireN1` causes bounded single-link failure analysis and completed contingency scenarios can be included in optimizer/verification requirements. Locked links are omitted from upgrade variables and independently rejected during proposal publication.

The current deterministic mitigation engine is fixed-routing and capacity-only. If a human locks a link that is itself a required overloaded capacity target, InfraTwin reports that no valid capacity-only mitigation is available rather than inventing a routing/topology change. Route/topology redesign remains Level 4 work.

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
npm run benchmark:scale
```

The CI quality gate additionally runs the dedicated headed native WebMCP contract:

```bash
xvfb-run -a npm run test:webmcp:native
```

That lane enables Chromium's WebMCP testing features and validates real `document.modelContext.getTools()`, `executeTool()`, and `toolchange` behavior against the live Workbench. The normal E2E suite separately exercises a deterministic browser modelContext harness for registration lifetime, dynamic capability changes, cancellation, hostile input, and human-agent coactivity.

## Repository layout

```text
apps/web/components      bounded collaborative UI, topology, evidence, proposal/history components
apps/web/workers         analysis, contingency, and optimizer Web Workers
packages/application     shared human/WebMCP semantic workspace service
packages/model           canonical project + ChangePlan/ScenarioPatch/CandidatePlan semantics and hashing
packages/graph-engine    deterministic routing, ECMP, utilization, components, min-cut
packages/evidence        capacity/change-plan/growth/N-1 orchestration and evidence
packages/optimizer       HiGHS LP/MILP formulation, lock constraints, diagnostics, independent verification
packages/webmcp          ChangePlan-centric WebMCP registration/capability state machine
packages/scenarios       network templates + optional saved ChangePlan templates
benchmarks               reproducible Level 2, Level 3, and scale benchmarks
tests                    Level 0–3.5D semantic/adversarial regressions
e2e                      Chromium product, lifecycle, coactivity, and native WebMCP coverage
planning                 architecture/status/manual-evaluation records
```

See `planning/LEVEL3_5D_WEBMCP_COACTIVITY_STATUS.md` for the final architecture, tool vocabulary, dynamic capability rules, stale-result safeguards, security cases, native-host evaluation, known limitations, and milestone completion evidence. See `planning/M3_5D_WEBMCP_MANUAL_EVAL.md` for the concise external ChatGPT/WebMCP evaluation script.
