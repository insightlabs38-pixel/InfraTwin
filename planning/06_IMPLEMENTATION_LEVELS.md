# 06 — Implementation Levels

## Strategy

Levels are **quality gates**, not feature buckets. Never begin a higher level if the previous level is unstable. A polished Level 2 should be submitted over a brittle Level 4.

## Level 0 — Foundation / Skeleton

**Goal:** establish contracts before sophistication.

Required:
- repo + Next.js shell;
- canonical model schema;
- graph visualization;
- load/reset one scenario;
- deterministic shortest-path routing;
- link utilization calculation;
- evidence object format;
- basic unit tests;
- first WebMCP `inspect_network` tool.

Gate:
- model round-trips JSON without loss;
- manual edit updates route/utilization;
- agent can inspect actual current state;
- no architecture blockers.

**Do not polish heavily here.**

---

## Level 1 — Complete Contender

**Goal:** coherent product already worth submitting.

Required:
- polished graph workspace;
- 3 bundled scenarios;
- change-safety workflow;
- growth workflow;
- simple resilience workflow;
- deterministic routing/capacity analysis;
- human edit → agent reinspection;
- candidate diff + apply/discard;
- WebMCP core tools with schemas/annotations;
- agent activity inspector;
- export/import JSON;
- robust demo reset;
- Vercel deployment.

WebMCP minimum:
- `inspect_network`;
- `inspect_demands`;
- `simulate_change`;
- `run_capacity_analysis`;
- `propose_change`;
- `compare_candidate`;
- `apply_candidate` / `discard_candidate`.

Gate:
- end-to-end maintenance demo runs without manual repair;
- all core tool calls affect/show the shared UI correctly;
- no server dependency;
- basic reference tests green.

**If development is slow, stop after fully polishing Level 1. It should still be a credible submission.**

---

## Level 2 — Strong / Likely Finalist-Level Technical Depth

**Goal:** make resilience analysis indisputably non-trivial.

Add:
- ECMP or clearly defined multi-path routing;
- N-1 link contingency enumeration;
- worker pool;
- ranked worst contingencies;
- concrete counterexample replay;
- min-cut/bottleneck analysis;
- dynamic WebMCP tool registration;
- registration lifetimes via `AbortSignal`;
- execution cancellation;
- compute capability detection/fallback;
- performance benchmarks.

Optional accelerator:
- Rust/WASM graph kernel;
- SharedArrayBuffer when cross-origin isolated.

Gate:
- N-1 result deterministic across repeated runs;
- cancellation does not corrupt state;
- tool capability set updates correctly after state changes;
- target demo N-1 finishes within acceptable time;
- evidence maps to graph IDs correctly.

**Level 2 is the recommended minimum target.**

---

## Level 3 — Winning-Level Optimization

**Goal:** move from “what happens?” to “what should we do?”

Add:
- HiGHS WASM integration;
- traffic allocation LP and/or capacity-upgrade MILP;
- budget/cost constraints;
- optimizer diagnostics;
- candidate plan comparison;
- resilience-aware plan for selected scenario set;
- optimizer WebMCP tools;
- optional Vercel Python independent verification;
- solver/version/model hashes in evidence.

Core marquee workflow:

```text
Find worst failure
      ↓
quantify impact
      ↓
find minimum-cost mitigation
      ↓
human approves candidate
      ↓
rerun contingencies
      ↓
independently verify final plan
```

Gate:
- known LP/MILP reference cases validated;
- infeasible case is demonstrated and explained correctly;
- time-limited optimizer never claims optimality without proof/status;
- candidate application is reversible;
- independent verifier disagreement blocks “verified” badge.

**Level 3 is the primary target if coding agents keep velocity high.**

---

## Level 4 — Exceptional / Research-Grade Stretch

Only pursue after Level 3 demo is frozen and green.

Choose **at most two** of the following.

### A. Robust scenario ensemble
- demand uncertainty;
- multiple failures/growth samples;
- WebGPU or worker acceleration;
- percentile/worst-case evidence.

### B. N-2 / adversarial failure search
- targeted candidate pairs rather than naive exhaustive search for large graphs;
- criticality heuristics;
- compare N-1 vs N-2 fragility.

### C. Cross-module WebMCP composition
- routing/resilience/optimizer in isolated descendant modules;
- `getTools()` / `executeTool()`;
- `exposedTo` / `fromOrigins`;
- visible capability topology.

This is technically impressive but must not destabilize the main app.

### D. Advanced capacity design
- discrete new-link decisions;
- scenario generation / cutting-plane style loop;
- Pareto frontier: cost vs resilience/headroom.

### E. Pyodide analyst console
- safe read-only scientific analysis over current model/results;
- not arbitrary unsafe code execution by default.

Gate:
- stretch module can be disabled without affecting Level 3;
- benchmark demonstrates why added complexity matters;
- demo narrative remains under 3 minutes.

---

## Level selection rule

At each daily integration point, classify:

| Status | Action |
|---|---|
| prior level red | fix only |
| prior level green, current level <50% | continue current |
| current level green | freeze tag, begin next |
| <48h to submission and current level unstable | revert to last green level |
| <24h | no architecture changes; polish/tests/demo only |

## Feature priority score

For optional work, estimate each 1–5:

```text
priority =
2*WebMCPValue
+2*DemoValue
+2*ImpactValue
+TechnicalNovelty
+ReliabilityGain
-2*ImplementationRisk
```

Do not pursue a feature solely because it is technically interesting.
