# InfraTwin

InfraTwin is a browser-native network decision digital twin for change safety, capacity planning, resilience, and optimization. The deterministic application model is shared by the human UI and WebMCP tools; AI orchestration never replaces solver truth.

## Current status: Level 0 foundation

Implemented:

- Next.js + React + TypeScript shell;
- canonical serializable network model and runtime validation;
- deterministic semantic model hashing;
- bundled Maintenance Trap scenario with exact reset;
- SVG topology canvas backed directly by canonical state;
- click-to-enable/disable links as a visible topology edit;
- deterministic single-shortest-path routing with stable tie-breaking;
- link load/utilization calculation and normalized PASS/FAIL evidence;
- `inspect_network` WebMCP tool using `document.modelContext.registerTool` when available;
- unit/reference tests including the line-network 80% and 120% cases.

The routing model is intentionally **single deterministic shortest path by link weight** at Level 0. Equal-cost ties are resolved deterministically by a stable path signature. This is routing simulation, not protocol emulation.

## Run

Requires Node.js 22+.

```bash
npm install
npm test
npm run typecheck
npm run dev
```

Open `http://localhost:3000`. The baseline scenario is healthy. Click the **CHI–DAL** link in the graph to disable it; traffic reroutes and the evidence panel should expose the resulting overload. Click again to restore it, or use **Reset scenario**.

## WebMCP

In a supported browser/agent environment, the app registers a read-only `inspect_network` tool. It returns a compact summary derived from the current canonical project, including model hash, topology counts, disabled links, routing mode, verdict, peak utilization, and current violations. Registration is revoked via `AbortSignal` when the workbench unmounts.

The app feature-detects WebMCP. Lack of WebMCP support does not block normal deterministic operation.

## Repository layout

```text
apps/web                 Next.js workbench
packages/model           canonical model, validation, stable hashing
packages/graph-engine    deterministic shortest path + utilization
packages/evidence        normalized capacity evidence
packages/webmcp          browser capability adapter
packages/scenarios       bundled Level 0 scenario
tests                    Level 0 unit/reference tests
planning                 governing planning notes retained in-repo
```

## Planning precedence

The implementation follows the supplied planning pack. See `planning/README.md` for the governing precedence rules and `planning/06_IMPLEMENTATION_LEVELS.md` for the Level 0–4 quality gates. The original uploaded pack remains the source baseline for documents not duplicated in this repository.
