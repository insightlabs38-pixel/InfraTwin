import test from 'node:test';
import assert from 'node:assert/strict';
import type { CandidateLinkOption, NetworkProject } from '../packages/model/src/index.ts';
import { optimizeAdaptiveDesign } from '../packages/optimizer/src/level4-design.ts';

function baseProject(): NetworkProject {
  return {
    schemaVersion: '0.1',
    id: 'adaptive-boundaries',
    name: 'Adaptive boundaries',
    nodes: ['A', 'B', 'C'].map((id) => ({ id, name: id })),
    links: [
      { id: 'L1', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: false, available: true },
      { id: 'L2', source: 'B', target: 'C', capacityGbps: 10, weight: 1, bidirectional: false, available: true },
    ],
    demands: [{ id: 'D', source: 'A', target: 'C', bandwidthGbps: 2, serviceClassId: 'gold' }],
    serviceClasses: [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 80, allowShedding: false }],
    routingProfile: { mode: 'single-shortest-path' },
  };
}

const candidate = (overrides: Partial<CandidateLinkOption> = {}): CandidateLinkOption => ({
  id: 'CAND',
  source: 'A',
  target: 'C',
  capacityGbps: 10,
  weight: 1,
  bidirectional: false,
  cost: 1,
  ...overrides,
});

test('AV-27: malformed candidate links reject before optimization instead of being repaired or invented', async () => {
  const project = baseProject();
  const cases: Array<{ name: string; options: CandidateLinkOption[]; pattern: RegExp }> = [
    { name: 'canonical id collision', options: [candidate({ id: 'L1' })], pattern: /unique non-canonical id/i },
    { name: 'duplicate candidate id', options: [candidate(), candidate({ source: 'B' })], pattern: /unique non-canonical id/i },
    { name: 'unknown endpoint', options: [candidate({ target: 'MISSING' })], pattern: /distinct existing nodes/i },
    { name: 'self link', options: [candidate({ source: 'A', target: 'A' })], pattern: /distinct existing nodes/i },
    { name: 'zero capacity', options: [candidate({ capacityGbps: 0 })], pattern: /capacity\/weight must be > 0/i },
    { name: 'zero weight', options: [candidate({ weight: 0 })], pattern: /capacity\/weight must be > 0/i },
    { name: 'negative cost', options: [candidate({ cost: -1 })], pattern: /cost >= 0/i },
  ];
  for (const entry of cases) {
    await assert.rejects(
      optimizeAdaptiveDesign(project, { allowedActions: { newLinks: true }, candidateLinkOptions: entry.options }),
      entry.pattern,
      entry.name,
    );
  }
});

test('AV-26: forbidding every route reports NO_PATH_CANDIDATES rather than budget infeasible', async () => {
  const result = await optimizeAdaptiveDesign(baseProject(), {
    forbiddenRoutingLinkIds: ['L1'],
    targetUtilizationPct: 80,
    budgetCostUnits: 0,
    maxCandidatePaths: 3,
  });
  assert.equal(result.variant, null);
  assert.equal(result.failureReason, 'NO_PATH_CANDIDATES');
  assert.match(result.diagnostics.message, /No candidate paths/i);
});

test('AV-26: routing disabled reports a lock/action-space failure without invoking the solver', async () => {
  const result = await optimizeAdaptiveDesign(baseProject(), {
    allowedActions: { routingChanges: false, capacityUpgrades: true, newLinks: false },
    budgetCostUnits: 0,
  });
  assert.equal(result.variant, null);
  assert.equal(result.failureReason, 'LOCKS_REMOVE_ALL_FEASIBLE_ACTIONS');
  assert.equal(result.diagnostics.status, 'Routing changes disabled');
  assert.equal(result.diagnostics.solveRuntimeMs, 0);
});
