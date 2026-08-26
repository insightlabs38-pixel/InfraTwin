# Level 1 implementation status

This file intentionally does not replace the governing planning pack. It records the implementation-to-gate mapping for the Level 1 branch.

- Polished graph workspace: `apps/web/components/workbench.tsx`, `apps/web/app/globals.css`
- Three bundled scenarios: `packages/scenarios/src/index.ts`
- Change-safety workflow: Maintenance Trap + pure `ScenarioPatch` + deterministic evidence
- Growth workflow: stepped growth sweep with first-failure threshold and candidate mitigation
- Resilience workflow: sequential link N-1 enumeration, impact ranking, worst-case replay
- Candidate lifecycle: propose, compare, apply, discard with stale-model hash guard
- Human edit → agent reinspection: canonical React state exposed through live WebMCP service refs
- WebMCP core tools: inspect network/demands, simulate, capacity, contingencies, propose, compare/apply/discard
- Agent activity inspector: visible tool name, read-only/mutating classification, status, duration, summary
- Import/export/reset: canonical project JSON with validation and deterministic reset seed
- Tests: Level 0 references plus Level 1 maintenance/growth/resilience/WebMCP golden tests

The Level 1 gate is considered green only after GitHub CI passes tests, TypeScript checking, and the production Next.js build and the implementation PR is merged.
