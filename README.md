# InfraTwin

> **Plan and verify network changes before production.**

| **Live Demo** | **Demo Video** | **Source** |
| --- | --- | --- |
| [Open InfraTwin](https://infra-twin-web-pi.vercel.app) | [Watch the final demo](https://vimeo.com/1223185421?share=copy&fl=sv&fe=ci#t=0) | [GitHub repository](https://github.com/insightlabs38-pixel/InfraTwin) |

InfraTwin is a browser-native network change-planning workbench where engineers and WebMCP agents collaborate on the **same live, unsaved ChangePlan**. Humans provide intent, operational constraints, and approval; the agent explores and revises alternatives; deterministic routing, resilience analysis, optimization, and verification provide machine-checkable engineering evidence.

The core idea is simple: network changes interact. A maintenance outage in one region, new traffic in another, and a capacity restriction somewhere else can combine into a failure that is difficult to reason about manually. InfraTwin lets teams model that interaction before production, then test proposed mitigations against the same shared plan.

## Why WebMCP?

A conventional agent integration usually gives the model a detached API view or a serialized copy of application state. That is useful, but it creates a synchronization problem: the human may be selecting a link, editing an unsaved plan, adding a lock, or invalidating an old proposal while the agent is reasoning over something else.

InfraTwin uses native WebMCP so the human and agent participate in the **same browser-local engineering artifact**:

```text
HUMAN UI -------------------\
                             > SAME LIVE Network + ChangePlan
WEBMCP AGENT ---------------/
                                  |
                                  v
                     deterministic engineering engine
                                  |
                                  v
                               evidence
```

Through that shared workspace, the agent can observe the current human selection, the current unsaved ChangePlan, locks and routing restrictions, deterministic analysis results, and whether a proposal or verification result is still fresh. A human edit can therefore change the agent's valid design space immediately rather than waiting for an external state synchronization cycle.

That is the WebMCP differentiation: **the agent is not operating beside the engineering tool; it is participating in the same live decision surface as the engineer.**

## The collaborative workflow

The flagship demo follows one continuous human + agent decision loop:

1. A human schedules a Northeast-to-Central backbone link for maintenance.
2. The agent sees that exact live selection and ChangePlan through WebMCP.
3. The agent adds the expected 20% Payments demand growth to the same plan.
4. InfraTwin runs deterministic routing and capacity analysis and discovers a remote Southeast-to-Central overload.
5. The agent asks InfraTwin for the cheapest modeled mitigation.
6. The human knows the proposed corridor cannot be modified and locks it in the workspace.
7. The old proposal becomes stale immediately.
8. The agent observes the changed restriction and replans.
9. With adaptive routing explicitly enabled, InfraTwin searches another bounded routing/capacity design.
10. The human reviews the result.
11. InfraTwin reconstructs the proposed design and verifies its routing, capacity, restrictions, objective, and scenario identity before it can receive verified status.

The important part is not that an agent can call tools. It is that **human judgment can modify the optimization problem mid-workflow, and the agent and deterministic engine remain synchronized with that judgment.**

## Architecture

```text
Human UI ----------------------┐
                               │
                        Shared application service
                               │
WebMCP Agent ------------------┘
                               │
                    NetworkProject + ChangePlan
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
       Routing             Resilience          Optimization
      SSP / ECMP              N-1            HiGHS LP/MILP
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                            Evidence
                               │
                   Human approval / verification
```

The canonical `NetworkProject` stays separate from the editable `ChangePlan`. Planned outages, restorations, capacity changes, traffic changes, new demands, growth, constraints, locks, and agent proposals are represented in that plan rather than silently mutating the base model.

## Evidence, not model guesses

InfraTwin deliberately separates **agent reasoning** from **engineering computation**.

The agent can inspect state, explain evidence, add or revise plan changes, request analysis, and explore alternatives. InfraTwin's deterministic engine performs SSP/ECMP routing, utilization and capacity analysis, bounded N-1 contingencies, bottleneck/min-cut analysis, and solver-backed optimization. HiGHS performs the LP/MILP solves. Adaptive proposals are not trusted simply because a solver returned them: InfraTwin reconstructs their primal decisions and checks demand conservation, path continuity, action legality, capacity/utilization constraints, restrictions, budget, objective, and scenario identity.

**The agent proposes and explains; InfraTwin computes and verifies.**

Evidence and proposals are bound to semantic model/plan identities. If a human changes an engineering-relevant assumption, stale analysis, proposals, or verification cannot continue to present themselves as current.

## What InfraTwin can do

- Browser-local `NetworkProject` + editable `ChangePlan` workflow.
- Deterministic single-shortest-path and ECMP routing.
- Utilization, capacity, route-witness, and bottleneck evidence.
- Bounded N-1 link contingencies with progress, cancellation, and stale-result protection.
- Min-cut and deterministic failure evidence.
- Human locks and explicit routing restrictions.
- HiGHS-backed capacity optimization.
- Adaptive K-path routing/design with bounded candidate paths.
- Joint routing plus declared capacity decisions.
- Explicitly declared candidate-link decisions when enabled.
- Scenario-aware adaptive design.
- Bounded design variants and reconstructed primal verification.
- Worker-backed analysis and optimization to keep the browser responsive.
- Dynamic native WebMCP capabilities tied to semantic preconditions.
- Large-browser validation on a 500-node / 1,200-link / 400-demand fixture.

## Adaptive network design

Normal plan analysis remains deterministic SSP/ECMP. Adaptive design is a separate, explicitly enabled planning capability for cases where fixed routing plus capacity upgrades cannot satisfy the current human constraints.

InfraTwin jointly optimizes over a **bounded deterministic set of candidate routes and declared capacity design options**. Candidate-path count is bounded, and routing redesign is opt-in. Where candidate links are allowed, their endpoints, capacity, weight, direction, and cost must be declared; the optimizer does not invent infrastructure or pricing.

Adaptive design respects human locks, forbidden routing links/nodes, budget, target utilization, selected scenarios, declared upgrade options, and declared candidate links. The result is a modeled engineering alternative within those inputs—not a claim of globally optimal real-world network architecture.

## Performance and scale

Level 4B retained the Level 4A optimization formulation and accelerated **candidate-path generation** through compiled graph reuse, deterministic heap-based shortest path, optimized bounded Yen K-shortest paths, semantic route caching, and Worker reuse.

**Cold candidate-path generation on the frozen A/B/C fixtures:**

| Fixture | Level 4A | Level 4B | Speedup |
| --- | ---: | ---: | ---: |
| 128 nodes / 304 links / 96 demands | 4,731 ms | 506 ms | 9.35× |
| 250 / 600 / 200 | 41,263 ms | 3,975 ms | 10.38× |
| 500 / 1,200 / 400 | 354,587 ms | 37,618 ms | 9.43× |

These numbers are **candidate-path generation**, not full end-to-end optimizer latency. Tier A is near-interactive for adaptive path preparation; Tier B is a deliberate multi-second bounded design operation; Tier C remains a long-running adaptive design workload. InfraTwin does not present 500-node adaptive optimization as instantaneous.

Separately, the browser workspace is validated on a **500-node, 1,200-link, 400-demand, 12-region** fixture using adaptive Canvas rendering, Worker-backed deterministic analysis, bounded N-1, and feature-specific compute guards. Different features intentionally have different scale envelopes.

## WebMCP integration

InfraTwin registers native `document.modelContext` capabilities dynamically rather than exposing one permanently available tool dump. Representative capabilities include:

- **Inspection:** `inspect_workspace`, `inspect_selection`, `inspect_plan`
- **Planning:** `add_plan_change`, constraint/restriction updates
- **Analysis:** `analyze_plan`, `run_contingencies`, `inspect_violation`
- **Mitigation:** `propose_mitigation`, `compare_mitigation_variants`
- **Verification:** `verify_plan`

Capability availability follows semantic state. Violation-specific tools require current failing evidence; proposal actions require a current proposal; human edits can revoke assumptions and invalidate stale results. Native Chromium tests exercise real `document.modelContext.getTools()`, `executeTool()`, and `toolchange` behavior against the live workbench.

## Safety and engineering boundaries

InfraTwin keeps the human approval boundary explicit:

- Imported names and metadata are treated as untrusted content.
- WebMCP read tools retain `untrustedContentHint` for imported/untrusted content.
- Agent actions modify the shared ChangePlan; they do not silently commit canonical network changes.
- Human locks are hard optimization constraints, not suggestions.
- Long-running work supports cancellation and stale-authority checks.
- Invalid or stale solver output cannot receive current verified status.
- Verification means the proposal is consistent with InfraTwin's declared model and constraints; it is not a guarantee of production-network safety.

## Run locally

Requires **Node.js 22+**.

```bash
npm ci
npm run dev
```

Quality gate:

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Native WebMCP contract test:

```bash
xvfb-run -a npm run test:webmcp:native
```

## Verify the engineering

The repository includes reproducible benchmark entry points for the deterministic engine, browser-scale path, and adaptive design engine:

```bash
npm run benchmark:level2
npm run benchmark:level3
npm run benchmark:scale
npm run benchmark:level4-design
npm run benchmark:level4-scale
```

The permanent CI workflow runs the complete quality gate, including unit tests, typecheck, production build, browser tests, native WebMCP validation, and benchmark gates.

## Scope and limitations

InfraTwin is a network planning abstraction, not vendor configuration emulation. It does not model BGP/OSPF/ISIS protocol convergence, ACL/security-policy behavior, or exact hardware queueing. Capacity semantics are aggregate rather than a reproduction of a particular router implementation.

Adaptive design operates only over declared actions and its bounded candidate-path set. Feature-specific compute envelopes differ: large deterministic browser analysis has a broader interactive envelope than adaptive multi-scenario design. These boundaries are intentional so the system can make precise claims about what was actually computed and verified.

## Technical notes

- [`planning/LEVEL3_5D_WEBMCP_COACTIVITY_STATUS.md`](planning/LEVEL3_5D_WEBMCP_COACTIVITY_STATUS.md) — shared WebMCP architecture, dynamic capability rules, stale-state safeguards, and native-host validation.
- [`planning/LEVEL4A_ADAPTIVE_DESIGN_STATUS.md`](planning/LEVEL4A_ADAPTIVE_DESIGN_STATUS.md) — bounded adaptive-design formulation, human lock/replan reference, and reconstructed verification.
- [`planning/LEVEL4B_HIGH_SCALE_DESIGN_STATUS.md`](planning/LEVEL4B_HIGH_SCALE_DESIGN_STATUS.md) — optimized path-engine architecture, cache/reuse rules, and A/B/C performance measurements.
- [`planning/LEVEL3_5C_PERFORMANCE_SCALE_STATUS.md`](planning/LEVEL3_5C_PERFORMANCE_SCALE_STATUS.md) — browser/Worker performance and scale validation.
- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — permanent automated quality gate.

## License

MIT — see [`LICENSE`](LICENSE).
