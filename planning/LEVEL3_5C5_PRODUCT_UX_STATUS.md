# InfraTwin Phase 3.5C.5 — Product UX and Information Architecture Status

## Scope

Phase 3.5C.5 is an information-architecture and product-UX restructuring pass on top of the completed Phase 3.5C browser-performance work. It does **not** add analytical capability, change routing/optimizer semantics, redesign WebMCP, or begin Level 4. The canonical `NetworkProject`, `ChangePlan`, ScenarioPatch compilation, evidence freshness, proposal lifecycle, restrictions/locks, deterministic routing, N-1, and optimizer behavior remain authoritative and unchanged.

The product artifact remains **Current Network + Current Change Plan**. The redesign makes that artifact the center of the application instead of one section in a vertically stacked dashboard.

## Pre-modification IA audit

The prior shell rendered most capabilities at once: product explanation, summary cards, network scale, compute profile, example selectors, a three-column workbench, route details, N-1 details, and WebMCP diagnostics. This produced excessive document scrolling, repeated state, a topology below competing content, and implementation details with the same visual weight as the engineering workflow.

The visible inventory was classified before restructuring:

| Classification | Previous content | Phase 3.5C.5 disposition |
| --- | --- | --- |
| Primary workflow | network selector, current ChangePlan, topology, selection inspector, Analyze/N-1/Optimize | kept immediately accessible in Network |
| Contextual | selected link/node/demand actions, current proposals, concise result state | shown only when relevant in ChangePlan/Inspector |
| Secondary | routes, detailed violations, contingencies, evidence, plan history/templates, model configuration | moved to Analysis, Plans, or Settings/Model |
| Advanced | hashes, solver diagnostics, compute/worker capability, raw optimizer state, WebMCP registration/activity | moved to Advanced drawer, hidden by default |
| Duplicate/unnecessary | workflow journey/tutorial strip, repeated status/scale cards, example-card strip, duplicate object/configuration panels | removed |

## Structural change

### Before

```text
Document page
├─ large heading / product explanation
├─ workflow journey
├─ summary cards / hashes
├─ scale + compute cards
├─ example cards
├─ ChangePlan | topology | evidence
├─ routes / contingencies / optimizer detail
└─ WebMCP / diagnostic detail
       ↓ document scroll
```

### After

```text
100vh application shell
├─ compact app bar
│  ├─ InfraTwin
│  ├─ Network | Analysis | Plans | Settings
│  ├─ network selector
│  └─ Import | Export | Advanced
└─ current destination
   ├─ Network (default, persistent workspace)
   │  ├─ compact action toolbar
   │  ├─ ChangePlan sidebar   [internal scroll]
   │  ├─ Topology workspace  [dominant region]
   │  └─ Inspector            [internal scroll]
   ├─ Analysis
   ├─ Plans
   └─ Settings / Model

Advanced diagnostics = off-canvas drawer, hidden by default
```

## Application destinations

### Network — default

Network is the working surface for inspecting the current network, authoring the current ChangePlan, inspecting selected objects, and triggering core deterministic analysis.

The desktop workspace is a bounded three-column grid:

- ChangePlan: approximately 260–290 px by default;
- Topology: `minmax(0, 1fr)` and therefore the majority of remaining width;
- Inspector: approximately 300–335 px by default.

The toolbar contains only global working context and the three primary actions: **Analyze Plan**, **Run N-1**, and **Find Mitigation**. The topology remains mounted when another destination is selected so zoom, pan/focus, LOD, region filtering, search focus, and object selection survive a destination round trip without creating a duplicate topology instance.

The Network result is deliberately compact and authoritative: DRAFT, PASS, FAIL, or STALE, with one sentence of summary and an Analysis link. Detailed evidence is not mounted in the Network view.

### Analysis

Analysis renders one sub-view at a time:

- Summary
- Routes
- Violations
- Contingencies
- Bottlenecks
- Evidence

These map only to capabilities that already existed. Large violation lists retain Phase 3.5C batching. Contingency counterexamples remain replayable and return the user to the Network workspace for inspection.

### Plans

Plans organizes non-primary plan management:

- current plan metadata;
- new/clear plan actions;
- bundled example/template plan loading;
- plan history/activity.

Actual plan editing remains in the Network ChangePlan sidebar.

### Settings / Model

Settings separates canonical network-model configuration from the current ChangePlan. It contains:

- routing profile and service-class context;
- upgrade-catalog editing;
- import/model assumptions;
- compute guidance.

Applying an upgrade-catalog edit remains an explicit canonical base-model mutation and intentionally starts a fresh ChangePlan, matching the existing product semantics.

## ChangePlan density reduction

The persistent left sidebar now shows:

- plan name/status;
- current changes;
- compact constraints summary with disclosure for editing;
- traffic changes behind progressive disclosure;
- restrictions/locks summary;
- current optimizer proposals only when present.

History, new-plan/template controls, and full model configuration no longer consume the primary sidebar.

## Contextual Inspector

The right panel is selection-driven:

- no selection: compact network/plan context;
- link: identity/endpoints, capacity/load/utilization/availability, plan state, outage/lock/capacity-plan actions, upgrade-catalog shortcut;
- node: identity/region/type/availability, plan state, outage/lock actions;
- demand: endpoints, bandwidth, service class, route summary, traffic-plan shortcut.

The previous topology-embedded object/configuration footer was removed so there is one authoritative object-inspection surface.

## Information removed from the default workspace

Removed rather than merely hidden:

- permanent workflow-journey / "how it works" presentation;
- stacked summary-card dashboard;
- permanent example-description cards;
- topology-embedded duplicate inspector/configuration footer;
- obsolete hardening/layout CSS that only supported the long dashboard.

Normal product UI no longer presents phase/level, judge/demo, hackathon, or benchmark-stage language.

## Information moved

| Information | New location |
| --- | --- |
| detailed routes / violations / N-1 cases / bottleneck / evidence | Analysis |
| templates, new/clear plan, plan history | Plans |
| upgrade catalog, routing/service-class/model assumptions | Settings / Model |
| model/plan hashes | Advanced → Provenance |
| worker/SharedArrayBuffer/compute internals | Advanced → Compute profile |
| solver IDs/status and routing-LP diagnostic | Advanced → Solver diagnostics |
| WebMCP registration/activity | Advanced → WebMCP diagnostics |

Hashes remain available for provenance and tests, but the normal product communicates human-readable evidence currentness instead.

## Duplicate state eliminated

The primary locations are now:

- network identity/counts: Network toolbar;
- active plan identity/status: ChangePlan sidebar;
- analysis authority/verdict: Inspector result summary;
- selected object detail: Inspector;
- detailed solver/evidence content: Analysis/Advanced according to audience;
- model assumptions: Settings.

No second permanent PASS/FAIL stack, selected-object card, or hash summary is rendered in the default workspace.

## Shared-state and semantic invariants

Navigation state is presentation-only. A dedicated `application-shell` helper provides destination/tab/panel/Advanced presentation state and semantic fingerprints for tests.

Regression coverage asserts that:

1. Network → Analysis → Network does not mutate `NetworkProject` or `ChangePlan` hashes;
2. view changes do not create semantic evidence staleness;
3. Advanced opening/closing is semantically inert;
4. side-panel collapse/restore is semantically inert.

The persistent Network subtree also preserves topology-local viewport state across destination changes.

## Scrolling and viewport behavior

The root application shell is `100vw × 100vh` with document overflow disabled. The Network destination uses `overflow: hidden`; ChangePlan and Inspector own their internal vertical scrolling; the topology fills the remaining center region. Side panels have bounded desktop widths so they cannot expand until the graph becomes a narrow column.

At narrower laptop widths, the Inspector becomes an overlay and the ChangePlan panel can overlay/collapse while the topology retains the primary workspace. This is desktop/laptop engineering software rather than a phone-first redesign.

### Acceptance measurements

The Playwright Phase 3.5C.5 suite explicitly validates:

- 1440×900 initial viewport;
- 1920×1080 initial viewport;
- 1024×768 narrow-laptop behavior;
- topology bounding box intersects and remains within the initial viewport;
- topology is wider than either side panel at standard desktop widths;
- no document-level vertical or horizontal overflow during normal Network use;
- semantic and topology viewport state survives destination switching.

Final CI/run identifiers and screenshot review findings are recorded in the completion report after branch validation.

## New/updated tests

New structural tests:

- `tests/phase35c5-product-ux.test.ts`

New Playwright suite:

- `e2e/phase35c5-product-ux.spec.ts`

It covers graph-above-fold behavior, normal plan workflow without document scrolling, Analysis separation, Settings state preservation, Advanced disclosure, panel-collapse semantic invariance, and topology viewport/selection preservation. The suite also attaches screenshots for 1440×900, 1920×1080, and 1024×768 acceptance review.

Existing Phase 3.5A/B/C and Level 0–3/adversarial E2E selectors/workflows were updated to navigate the new IA instead of depending on removed scenario cards or permanently mounted secondary panels. Phase 3.5C browser-scale benchmarks use the compact network selector while preserving the existing measured compute/render workloads.

## Performance discipline

Phase 3.5C.5 does not introduce a new performance optimization claim. It preserves Phase 3.5C's adaptive renderer and Worker execution behavior while avoiding structural regressions:

- one topology instance;
- inactive Analysis tabs are not mounted;
- detailed evidence trees are not duplicated into Network;
- large violation evidence remains batched;
- destination changes do not recompute the semantic network merely for presentation.

## Known UX limitations

- panel widths are bounded and collapsible but not drag-resizable;
- under tablet-like widths, side panels use overlays rather than a fully redesigned compact workflow;
- Plans remains browser-session state rather than a persistence backend;
- Advanced diagnostics remain technical by design and are not a polished end-user troubleshooting console;
- Phase 3.5D should integrate WebMCP actions into the human workspace without returning diagnostics to primary visual prominence.

## Quality gate

Required completion gate:

```text
npm ci
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run benchmark:level2
npm run benchmark:level3
```

The repository's retained Phase 3.5C CI additionally exercises `npm run benchmark:scale`; it is kept green as a non-regression gate even though this phase does not make new scale claims.

## Completion criterion

Phase 3.5C.5 is complete only when the validated branch opens directly into a bounded Network engineering workspace where the current network, current ChangePlan, topology, core actions, and contextual inspector are immediately legible without document scrolling; detailed analysis/model/diagnostic information must remain accessible without competing with that workflow.
