# InfraTwin Planning Pack

**Working name:** InfraTwin / NetworkForge  
**Purpose:** Govern implementation of a WebMCP-native network planning, change-safety, resilience, and optimization workbench for the 2026 WebMCP Challenge.  
**Status:** implementation baseline, 2026-08-25.

## Product thesis

InfraTwin turns a network diagram into an **executable decision model** shared by the human, the agent, and deterministic solvers.

A user should be able to ask consequential questions such as:

- Can I take this link down for maintenance?
- Where will 40% traffic growth cause the first capacity failure?
- Which single failure is most damaging?
- What is the cheapest upgrade plan that makes the network N-1 resilient?
- Can I add this service without violating an SLA?

The agent interprets intent and orchestrates tools. The application owns topology, routing, demands, scenarios, optimization, evidence, and visualization. The human remains in control of material changes.

## Governing principles

1. **Useful without AI.** The core network workbench must be valuable as deterministic engineering software.
2. **AI should call, not reimplement.** Tools must expose accumulated computational capability that is irrational to recreate ad hoc.
3. **Evidence over prose.** Every important answer should resolve to routes, bottlenecks, violated constraints, counterexamples, optimality/feasibility diagnostics, or verification results.
4. **Shared live artifact.** Human edits, solver state, and agent actions operate on one canonical network model.
5. **Browser-first compute.** Normal operation should require zero server compute; use WASM/workers/HiGHS/WebGPU where appropriate.
6. **Sparse server verification.** Vercel Python is optional and used only for independent final verification, never as a single point of failure.
7. **Progressive depth.** Each implementation level is independently shippable. Do not start a higher level until the prior gate passes.
8. **No demo-only lies.** If the UI says “verified,” the stated model and solver must actually support that claim.

## Document precedence

When planning files conflict, use this order:

1. `00_PROJECT_CHARTER.md` — fixed product boundaries and judging strategy.
2. `01_PRODUCT_REQUIREMENTS.md` — required user experience and acceptance criteria.
3. `06_IMPLEMENTATION_LEVELS.md` — scope and sequencing gates.
4. `02_SYSTEM_ARCHITECTURE.md` + `03_NETWORK_MODEL_AND_SOLVERS.md` — technical contracts.
5. `04_WEBMCP_CAPABILITY_DESIGN.md` — agent interface contract.
6. Remaining files — implementation guidance.

Do not silently change a higher-precedence decision. Record intentional deviations in `13_DECISIONS_AND_OPEN_QUESTIONS.md`.

## Pack index

| File | Governs |
|---|---|
| `00_PROJECT_CHARTER.md` | thesis, audience, non-goals, judging strategy |
| `01_PRODUCT_REQUIREMENTS.md` | workflows, features, UX acceptance criteria |
| `02_SYSTEM_ARCHITECTURE.md` | components, data flow, runtime boundaries |
| `03_NETWORK_MODEL_AND_SOLVERS.md` | canonical model and deterministic algorithms |
| `04_WEBMCP_CAPABILITY_DESIGN.md` | tool taxonomy, dynamic registration, trust model |
| `05_UI_UX_AND_HUMAN_AGENT_FLOW.md` | interface, visual language, coactivity |
| `06_IMPLEMENTATION_LEVELS.md` | Level 0–4 build ladder and stop conditions |
| `07_ENGINEERING_PLAN_AND_AGENT_WORKFLOW.md` | coding-agent workflow, repo structure, milestone execution |
| `08_TESTING_EVALS_AND_BENCHMARKS.md` | correctness, WebMCP evals, performance, reference cases |
| `09_SECURITY_RELIABILITY_AND_TRUST.md` | security, prompt-injection boundaries, failure isolation |
| `10_VERCEL_DEPLOYMENT_AND_PERFORMANCE.md` | Vercel/browser deployment and compute strategy |
| `11_DEMO_SUBMISSION_AND_JUDGING.md` | 3-minute narrative and rubric mapping |
| `12_RISK_REGISTER_AND_SCOPE_GATES.md` | failure modes, scope cuts, kill criteria |
| `13_DECISIONS_AND_OPEN_QUESTIONS.md` | ADR-lite decision log and unresolved issues |
| `14_INTERFACE_CONTRACTS.md` | stable internal APIs for parallel implementation |
| `15_MASTER_BUILD_CHECKLIST.md` | top-level implementation/submission checklist |
| `schemas/network-model.schema.json` | initial serializable model contract |
| `examples/scenario_catalog.md` | demo/reference scenarios |
| `reference/sources.md` | current authoritative references |

## Definition of “core complete”

InfraTwin is core-complete when a judge can:

1. load a bundled network without account setup;
2. inspect topology, demands, and service classes visually;
3. make a topology or demand change manually;
4. ask an agent a natural-language network question;
5. observe WebMCP tools inspect the same changed model;
6. run a deterministic analysis that produces visible evidence;
7. receive a concrete recommendation or counterexample;
8. approve/reject a proposed model mutation;
9. rerun analysis and see the effect;
10. reload the app and still use the core experience without paid infrastructure.
