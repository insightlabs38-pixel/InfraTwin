import test from 'node:test';
import assert from 'node:assert/strict';
import { modelHash, validateNetworkProject, type NetworkProject } from '../packages/model/src/index.ts';
import { routeProject } from '../packages/graph-engine/src/index.ts';
import { runCapacityAnalysis } from '../packages/evidence/src/index.ts';

function project(): NetworkProject {
  return {
    schemaVersion: '0.1', id: 'numeric-boundaries', name: 'Numeric boundaries',
    nodes: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }],
    links: [
      { id: 'AB', source: 'A', target: 'B', capacityGbps: 1_000_000_000_000, weight: 1e-9, bidirectional: false },
      { id: 'BC', source: 'B', target: 'C', capacityGbps: 1_000_000_000_000, weight: 1e-9, bidirectional: false },
      { id: 'AC', source: 'A', target: 'C', capacityGbps: 1_000_000_000_000, weight: 2e-9, bidirectional: false },
    ],
    demands: [
      { id: 'D0', source: 'A', target: 'C', bandwidthGbps: 0, serviceClassId: 'gold' },
      { id: 'D1', source: 'A', target: 'C', bandwidthGbps: 1, serviceClassId: 'gold' },
    ],
    serviceClasses: [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 80, allowShedding: false }],
    routingProfile: { mode: 'ecmp' },
  };
}

test('AV-16: tiny positive weights, huge finite capacities, zero demand, and equal-cost paths remain finite and truthful', () => {
  const value = project();
  assert.equal(validateNetworkProject(value).valid, true);
  const routed = routeProject(value);
  const zero = routed.routes.find((row) => row.demandId === 'D0')!;
  const active = routed.routes.find((row) => row.demandId === 'D1')!;
  assert.equal(zero.reachable, true);
  assert.equal(active.reachable, true);
  assert.equal(active.equalCostPathCountExact, '2');
  assert.ok(Number.isFinite(routed.peakUtilizationPct));
  assert.ok(routed.peakUtilizationPct >= 0 && routed.peakUtilizationPct < 1e-6);
  const capacity = runCapacityAnalysis(value);
  assert.equal(capacity.result.verdict, 'PASS');
  assert.ok(Number.isFinite(capacity.routing.peakUtilizationPct));
});

test('AV-41: semantically equivalent object-key and canonical collection insertion orders preserve model identity', () => {
  const a = project();
  a.metadata = { z: { beta: 2, alpha: 1 }, a: 'same' };
  const b: NetworkProject = {
    metadata: { a: 'same', z: { alpha: 1, beta: 2 } },
    routingProfile: { ...a.routingProfile },
    serviceClasses: [...a.serviceClasses].reverse().map((row) => ({ ...row })),
    demands: [...a.demands].reverse().map((row) => ({ ...row })),
    links: [...a.links].reverse().map((row) => ({ ...row })),
    nodes: [...a.nodes].reverse().map((row) => ({ ...row })),
    name: a.name,
    id: a.id,
    schemaVersion: a.schemaVersion,
  };
  assert.equal(modelHash(a), modelHash(b));
});
