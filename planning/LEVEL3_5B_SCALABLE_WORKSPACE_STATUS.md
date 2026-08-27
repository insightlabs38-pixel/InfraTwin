# InfraTwin Phase 3.5B — Scalable Engineering Workspace Status

## Scope and preserved contract

Phase 3.5B turns the Phase 3.5A collaborative planning model into a realistic desktop network-engineering workspace. The semantic execution contract is unchanged:

```text
NetworkProject
    +
ChangePlan
    |
    v
compileChangePlanToScenarioPatch()
    |
    v
ScenarioPatch
    |
    v
existing deterministic routing / evidence / optimizer stack
```

Viewport, layout, search, focus, filtering, and selection remain presentation state. No routing algorithm, N-1 algorithm, LP/MILP formulation, worker baseline-routing path, Rust/WASM graph kernel, WebGPU path, or WebMCP redesign was introduced in this phase.

## Renderer architecture

The topology workspace keeps an optimized SVG renderer for the 3.5B product target. This choice deliberately avoids a large graph-library dependency while preserving native vector interaction, keyboard-focusable semantic objects, accessible text alternatives, and the existing ChangePlan styling vocabulary.

`TopologyCanvas` is now a workspace shell rather than a fixed 700×455 diagram. It provides:

- pointer pan and wheel zoom using a mutable SVG `viewBox`;
- Fit network, Fit selection, Reset view, and Re-layout;
- deterministic presentation coordinates from `apps/web/lib/topology-workspace.ts`;
- search for node ID/name, link ID/endpoints, and demand ID/name/endpoints;
- deterministic focus of search results;
- region filtering/focus and subtle logical region hulls;
- display priority modes: All, Change Plan, Violations, Selected routes;
- lightweight Ctrl/Cmd/Shift multi-link selection with focus/outage/lock batch actions;
- normal-DOM selected-object details and upgrade-catalog controls.

SVG remains a practical fit for the stated 100–150 node / 250–350 link product target because normal text labels are aggressively reduced by LOD and React does not maintain hundreds of permanent link-label elements. The renderer remains replaceable in a later compute/visualization phase because layout/search and semantic state are separate pure modules.

## Deterministic automatic layout

`computeDeterministicLayout()` is presentation-only. It groups nodes by existing `region` values, places core nodes on a compact inner ring and edge nodes on deterministic outer rings, and applies stable ID-derived jitter to prevent overlap. It:

- requires no DAG assumption;
- handles projects with no x/y coordinates;
- produces identical coordinates for identical semantic topology/input presentation coordinates;
- respects explicit coordinates on first layout when supplied;
- can deliberately ignore explicit coordinates through Re-layout;
- is memoized from a stable layout cache key rather than rerun on pointer motion or unrelated React state;
- never mutates `NetworkProject`.

The existing semantic hashing rule continues to exclude node x/y and presentation metadata, so layout cannot stale ChangePlan evidence.

## Level of detail and visual priority

LOD is derived from viewport zoom rather than project semantics:

- **Overview:** compact node markers, region hulls, no normal link labels, only priority state labels.
- **Network detail:** node IDs plus priority link labels.
- **Engineering detail:** selected/important labels include link utilization/capacity context; normal labels remain bounded on large networks.

Priority exceptions include violations, planned changes/outages, proposals, locks, selection, selected evidence/routes, and search results. State encoding uses opacity, stroke width, dashed patterns, outlines/glow, and text badges in addition to color. The legend documents the combined encoding.

Display modes de-emphasize unrelated topology without mutating the project or plan. Region focus/filtering preserves cross-region links whenever both endpoints remain visible and is strictly presentation-only.

## Search and navigation

Topology search is deterministic and case-insensitive. It matches:

- node ID, name, region, and type;
- link ID and endpoint IDs;
- demand ID, name, and endpoints.

Results are score-sorted and then stably ordered by semantic kind/ID. Selecting a node/link/demand updates the shared selection surface, focuses the relevant graph extent, and exposes normal-DOM engineering details. Demand selection highlights solver-derived routed links and leaves traffic editing in the existing ChangePlan workflow.

## Flagship realistic synthetic planning model

The default example is **Continental Service Network**, clearly labeled as a realistic synthetic network planning model. It is generated deterministically in `packages/scenarios/src/index.ts` with stable semantic IDs and contains exactly:

- 128 nodes;
- 304 links;
- 96 demands;
- 6 logical regions (Northeast, Southeast, Central, Mountain, West, Cloud);
- 3 service classes.

The network has four redundant core nodes per region, 104 dual-homed edge nodes, full-mesh regional cores, 60 inter-region backbone links, varied access capacities, varied traffic sizes, and explicit upgrade catalogs on selected backbone links. It intentionally has no x/y coordinates so the shipped default exercises automatic layout.

The semantic project hash is:

```text
sha256:661d1e8c85aea919e8379981ad45f0554d9fe613e18aa52808f1797624fa0e65
```

## Flagship ChangePlan story

The saved/template plan **Saturday Backbone Maintenance** uses the exact same generic Phase 3.5A APIs as any manually authored plan:

- human planned outage of `BB-NE-CE-01`;
- 35% growth on ten east-to-central payments demands;
- 80% target utilization;
- budget of 12 abstract cost units;
- lock on `BB-SE-CE-02`.

N-1 is intentionally not pre-enabled on the 304-link flagship because Phase 3.5B does not claim a large-compute envelope for the existing bounded contingency implementation.

The existing deterministic shortest-path solver genuinely produces the intended non-local result: after the central Northeast–Central corridor is removed, growing traffic reroutes through Northeast–Southeast and Southeast–Central. `BB-SE-CE-01` reaches exactly **92.5% utilization**, violating the 80% planning target. This result is asserted in unit tests; there is no special `runFlagshipScenario()` or UI-coded outcome.

## Import formats and review

Canonical InfraTwin JSON import/export remains supported. Import now opens a review workflow rather than replacing the workspace immediately.

A CSV bundle is also supported:

### `nodes.csv`

- `id` (required)
- `name` (required)
- `region` (optional)
- `type` (optional)

### `links.csv`

- `id`, `source`, `target`, `capacityGbps` (required)
- `weight` (optional; disclosed default `1`)
- `bidirectional` (optional; disclosed default `true`)

### `demands.csv` (optional)

- `id`, `source`, `target`, `bandwidthGbps` (required per row)
- `name` (optional)
- `serviceClassId` (blank/`default` only for CSV bundle import)

Because this phase does not add a separate service-class CSV catalog, imported CSV traffic maps to one explicitly disclosed `Imported default` service class with an 80% planning threshold. Unknown node references and unsupported service-class references fail explicitly. The review step shows counts, warnings, and applied defaults before **Open Network** is enabled.

GraphML remains deferred because high-quality CSV + workspace functionality is complete and preferable to a fragile partial parser.

## Network assumptions / upgrade catalog

Selecting one or multiple links exposes an **Network assumptions / upgrade catalog** editor. Upgrade options are validated as strictly increasing capacities above the selected link(s)' current capacity with non-negative abstract cost units.

Applying an upgrade profile deliberately edits the canonical `NetworkProject` design space; it is **not** converted into a ChangePlan action. Because a canonical semantic edit changes the base model hash, the current plan is reset rather than silently rebased. The existing capacity optimizer immediately sees the newly declared discrete options through the unchanged `LinkModel.upgradeOptions` contract.

## Presentation-state and hash purity

The following remain outside semantic project/plan state:

- pan/zoom;
- LOD;
- display mode;
- region filters/focus;
- search query/result highlight;
- selection/multi-selection;
- generated auto-layout coordinates.

Unit and browser regression coverage verifies these interactions leave the semantic base hash and ChangePlan hash unchanged and do not make analyzed evidence stale.

## Accessibility and responsive behavior

Search/results and all plan actions are keyboard-accessible. Selected node/link/demand details live in normal DOM and are the semantic accessibility interface; the graph is not duplicated into an enormous screen-reader-only DOM tree. On narrow screens, the topology keeps a dedicated minimum-width engineering surface inside an overflow area instead of pretending 100-node editing is a phone-first workflow.

## Tests added

`tests/phase35b-scalable-workspace.test.ts` covers:

- deterministic auto-layout;
- usable positions when x/y are missing;
- presentation purity and evidence freshness;
- exact flagship counts/regions/hash;
- generic flagship ChangePlan compilation and the 92.5% distant bottleneck;
- deterministic node/link/demand search;
- CSV parsing/defaults/layout;
- invalid CSV references/service classes;
- upgrade-catalog validation and visibility to the existing MILP builder.

`e2e/phase35b-scalable-workspace.spec.ts` covers:

1. flagship navigation (counts, fit, zoom, pan, search/focus, full-network return);
2. flagship ChangePlan authoring with unchanged base hash;
3. large-graph LOD and priority semantics;
4. coordinate-free CSV import/review/layout/interaction/plan authoring;
5. explicit canonical upgrade-catalog editing;
6. presentation-state purity after analysis.

The existing Phase 3.5A and Level 0–3/adversarial suites are retained unchanged.

## Quality gate

Completion is gated on:

```text
npm ci
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run benchmark:level2
npm run benchmark:level3
```

The implementation workflow runs the full gate before committing the applied Phase 3.5B source.

## Known visualization limitations

- The renderer is deliberately optimized SVG for the 3.5B 100–150 node product target, not proof of a 500+ node operating envelope.
- Region hulls are logical grouping cues, not geographic maps.
- Re-layout is deterministic and region-aware rather than a physics/force simulation; extremely irregular ungrouped imported graphs can be less aesthetically compact than a specialized graph-layout engine.
- Multi-selection is modifier-click based; lasso selection is not implemented.
- CSV import does not infer real cost, latency, service policy, geography, or production topology semantics.
- N-1 on the flagship remains an explicit user action and is not used to claim large-network compute safety.

## Explicitly deferred

### Phase 3.5C

- routing algorithm acceleration / Dijkstra rewrite;
- routing caches;
- worker baseline routing;
- real large-network compute benchmarks and safe operating envelopes;
- 500+ node scale proof;
- Rust/WASM/WebGPU/advanced compute.

### Phase 3.5D

- ChangePlan-oriented WebMCP redesign;
- actual human+agent coactivity evaluation.

### Level 4

- high-scale compute engine and other stretch functionality.

## Phase answer

Ignoring WebMCP, the Phase 3.5B target is now a first-class network engineering workspace: realistic scale is visible by default, imported coordinate-free networks are navigable, topology interaction remains ChangePlan-centric, and presentation state is cleanly separated from semantic engineering identity.
