# InfraTwin

InfraTwin is a browser-native network decision digital twin for change safety, capacity planning, and resilience. The deterministic application model is shared by the human UI and WebMCP tools; agent orchestration never replaces solver truth.

## Current status: Level 1 complete contender

Level 1 is implemented as a zero-function, local-first workbench:

- polished topology workspace with utilization, failure, candidate, route, and evidence states;
- three deterministic bundled demos plus a blank/import path;
- non-destructive `ScenarioPatch` simulation over the canonical project;
- deterministic single-shortest-path routing and capacity/service-target analysis;
- stepped growth analysis with reproducible first-failure threshold;
- sequential single-link N-1 resilience enumeration with ranked impact scoring and counterexample replay;
- stale-safe candidate plans with before/after compare, explicit apply, and discard;
- human canonical edits followed by fresh agent inspection of the same live state;
- evidence witnesses that select/highlight the same links and routes shown in the graph;
- import/export of canonical project JSON and exact bundled-demo reset;
- visible WebMCP activity inspector with read-only/mutating classification and registered capability list;
- graceful operation when WebMCP is unavailable;
- reference/golden tests covering maintenance, growth, resilience, candidate safety, and WebMCP state sharing.

The routing model is intentionally **single deterministic shortest path by link weight**. Equal-cost ties are resolved by a stable path signature. This is routing/capacity planning simulation, not router-protocol or packet-level QoS emulation.

## Bundled demos

### Maintenance Trap

Healthy baseline. Simulating CHI–DAL maintenance reroutes gold traffic across DEN–ATL and pushes `L3` to 120%. A deterministic capacity candidate raises `L3` to 15 Gbps and restores the modeled service target without mutating the baseline until apply.

Suggested prompt:

> Can I take the Chicago–Dallas link down for maintenance without violating critical-service constraints? Don’t apply any changes.

### Growth Wall

The east–west core is healthy at 60%. Scaling selected east→west demands to +40% pushes `G2` to 84%; the first modeled service-target failure appears at 1.35×. The bundled upgrade ladder yields a 22 Gbps capacity candidate that restores at least 20% headroom.

Suggested prompt:

> If east-to-west demand grows 40%, what becomes the first bottleneck, and what is the cheapest upgrade plan that keeps at least 20% headroom?

### Resilience Gap

The baseline appears redundant. Sequential single-link N-1 analysis ranks `R2` as the worst failure; it reroutes premium traffic onto `R4`/`R5`, driving both to 110%. A two-link candidate upgrades the southern corridor to 14 Gbps and makes the replay pass the modeled gold target.

Suggested prompt:

> Find the worst single-link failure and tell me exactly what it breaks. Then propose the cheapest mitigation, but don’t apply it.

## Run

Requires Node.js 22+.

```bash
npm install
npm test
npm run typecheck
npm run dev
```

Open `http://localhost:3000`.

Production build:

```bash
npm run build
```

## WebMCP

InfraTwin feature-detects `document.modelContext`. In a supported browser/agent environment it registers semantic engineering tools against public application services, not DOM operations.

Base tools:

- `inspect_network` — read-only current topology/scenario/capacity summary;
- `inspect_demands` — read-only demand, class, and routed-path summary;
- `simulate_change` — read-only relative to the persistent project; creates an ephemeral visible scenario;
- `run_capacity_analysis` — read-only deterministic capacity/service-target analysis;
- `run_contingencies` — read-only single-link N-1 enumeration and worst-case replay;
- `propose_change` — creates a visible candidate branch but does not apply it.

When a candidate exists, InfraTwin additionally registers:

- `compare_candidate` — read-only before/after metrics;
- `apply_candidate` — mutating, stale-hash checked project commit;
- `discard_candidate` — mutating candidate-state removal without project change.

Read-only annotations are applied to investigation/simulation tools. Registrations are scoped with `AbortSignal`, and every tool call is surfaced in the ordinary Agent Activity inspector with status, duration, classification, and compact result summary. Lack of WebMCP support does not block the engineering workbench.

## Deterministic evidence contract

Capacity, growth, and contingency results carry:

```text
verdict
modelHash
scenarioHash
solver id/version
assumptions[]
metrics{}
violations[]
witnesses[]
runtimeMs
```

Failures include concrete stable-ID witnesses such as the disabled/overloaded link or the affected demand route. Candidate application is separate from analysis and proposal.

## Repository layout

```text
apps/web                 Next.js workbench and shared human/agent UI
packages/model           canonical model, scenario patches, commands, candidates, hashing
packages/graph-engine    deterministic shortest-path routing + link utilization
packages/evidence        capacity, growth, N-1, evidence, candidate comparison/mitigation
packages/webmcp          semantic browser capability adapter and activity telemetry
packages/scenarios       Maintenance Trap, Growth Wall, Resilience Gap, blank project
tests                    Level 0 references + Level 1 golden/product/tool tests
planning                 governing planning pack
```

## Planning precedence

See `planning/README.md`. The copied planning pack is the implementation baseline and its document-precedence rules govern changes.
