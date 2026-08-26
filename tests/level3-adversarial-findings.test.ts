import test from 'node:test';
import assert from 'node:assert/strict';
import type { NetworkProject } from '../packages/model/src/index.ts';
import { cloneProject, modelHash, validateNetworkProject } from '../packages/model/src/index.ts';
import { routeProject } from '../packages/graph-engine/src/index.ts';
import { runCapacityAnalysis } from '../packages/evidence/src/index.ts';
import { optimizeRouting } from '../packages/optimizer/src/index.ts';

function oneLinkProject(bandwidthGbps: number, targetPct: number): NetworkProject {
  return {
    schemaVersion: '0.1', id: 'threshold', name: 'Threshold',
    nodes: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }],
    links: [{ id: 'AB', source: 'A', target: 'B', bidirectional: true, capacityGbps: 10, weight: 1 }],
    demands: [{ id: 'D', source: 'A', target: 'B', bandwidthGbps, serviceClassId: 'gold' }],
    serviceClasses: [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: targetPct }],
    routingProfile: { mode: 'ecmp' },
  };
}

function manyPathProject(layers = 7): NetworkProject {
  const nodes = [{ id: 'S', name: 'S' }];
  for (let layer = 0; layer < layers; layer += 1) {
    nodes.push({ id: `L${layer}A`, name: `L${layer}A` }, { id: `L${layer}B`, name: `L${layer}B` });
  }
  nodes.push({ id: 'T', name: 'T' });
  const links: NetworkProject['links'] = [];
  const add = (source: string, target: string) => links.push({ id: `E${links.length.toString().padStart(3, '0')}`, source, target, bidirectional: false, capacityGbps: 1000, weight: 1 });
  add('S', 'L0A'); add('S', 'L0B');
  for (let layer = 0; layer < layers - 1; layer += 1) {
    for (const from of ['A', 'B']) for (const to of ['A', 'B']) add(`L${layer}${from}`, `L${layer + 1}${to}`);
  }
  add(`L${layers - 1}A`, 'T'); add(`L${layers - 1}B`, 'T');
  return {
    schemaVersion: '0.1', id: 'many-paths', name: 'Many equal cost paths', nodes, links,
    demands: [{ id: 'D', source: 'S', target: 'T', bandwidthGbps: 128, serviceClassId: 'gold' }],
    serviceClasses: [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 100 }], routingProfile: { mode: 'ecmp' },
  };
}

test('adversarial repro: ECMP reports true path count independently of 64-path materialization cap', () => {
  const route = routeProject(manyPathProject()).routes[0];
  assert.equal(route.reachable, true);
  assert.equal(route.paths.length, 64, 'inspection materialization remains bounded');
  assert.equal(route.equalCostPathCountExact, '128');
  assert.equal(route.equalCostPathCount, 128);
  assert.equal(route.materializedPathCount, 64);
  assert.equal(route.pathsTruncated, true);
  const sourceFractions = Object.entries(route.linkFractions).filter(([id]) => id === 'E000' || id === 'E001').reduce((sum, [, fraction]) => sum + Number(fraction), 0);
  assert.ok(Math.abs(sourceFractions - 1) < 1e-12, `source fractions must conserve 1.0, got ${sourceFractions}`);
});

test('adversarial repro: semantic hashing treats __proto__ as data and cannot collide through prototype assignment', () => {
  const a = oneLinkProject(1, 80);
  const b = cloneProject(a);
  a.metadata = JSON.parse('{"__proto__":{"policy":"alpha"},"label":"same"}') as Record<string, unknown>;
  b.metadata = JSON.parse('{"__proto__":{"policy":"beta"},"label":"same"}') as Record<string, unknown>;
  assert.notEqual(modelHash(a), modelHash(b));
  assert.equal(({} as Record<string, unknown>).policy, undefined, 'canonicalization must not pollute Object.prototype');
});

test('adversarial repro: utilization decisions preserve 0.000001 percentage-point boundary semantics', () => {
  assert.equal(runCapacityAnalysis(oneLinkProject(7.9999999, 80)).result.verdict, 'PASS');
  assert.equal(runCapacityAnalysis(oneLinkProject(8, 80)).result.verdict, 'PASS');
  const overService = runCapacityAnalysis(oneLinkProject(8.0000001, 80));
  assert.equal(overService.result.verdict, 'FAIL');
  assert.ok(overService.result.violations.some((item) => item.type === 'SERVICE_UTILIZATION'));

  assert.equal(runCapacityAnalysis(oneLinkProject(9.9999999, 100)).result.verdict, 'PASS');
  assert.equal(runCapacityAnalysis(oneLinkProject(10, 100)).result.verdict, 'PASS');
  const overCapacity = runCapacityAnalysis(oneLinkProject(10.0000001, 100));
  assert.equal(overCapacity.result.verdict, 'FAIL');
  assert.ok(overCapacity.result.violations.some((item) => item.type === 'CAPACITY'));
});

test('adversarial repro: routing LP cannot traverse an unavailable node', async () => {
  const project: NetworkProject = {
    schemaVersion: '0.1', id: 'disabled-node-lp', name: 'Disabled node LP',
    nodes: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B', available: false }, { id: 'C', name: 'C' }],
    links: [
      { id: 'AB', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: true },
      { id: 'BC', source: 'B', target: 'C', capacityGbps: 10, weight: 1, bidirectional: true },
    ],
    demands: [{ id: 'D', source: 'A', target: 'C', bandwidthGbps: 5, serviceClassId: 'gold' }],
    serviceClasses: [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 100 }], routingProfile: { mode: 'ecmp' },
  };
  assert.equal(routeProject(project).routes[0].reachable, false);
  const optimized = await optimizeRouting(project, { timeLimitMs: 2_000 });
  assert.equal(optimized.diagnostics.proof, 'infeasible');
  assert.equal(optimized.allocations.length, 0);
});

test('adversarial repro: canonical validation rejects self-links and pathological upgrade-option arrays', () => {
  const selfLink = oneLinkProject(1, 80);
  selfLink.links[0].target = 'A';
  assert.equal(validateNetworkProject(selfLink).valid, false);

  const hugeOptions = oneLinkProject(1, 80);
  hugeOptions.links[0].upgradeOptions = Array.from({ length: 1000 }, (_, index) => ({ capacityGbps: 11 + index, cost: index }));
  assert.equal(validateNetworkProject(hugeOptions).valid, false);

  const duplicateOptions = oneLinkProject(1, 80);
  duplicateOptions.links[0].upgradeOptions = [{ capacityGbps: 20, cost: 1 }, { capacityGbps: 20, cost: 2 }];
  assert.equal(validateNetworkProject(duplicateOptions).valid, false);

  const nonMonotonic = oneLinkProject(1, 80);
  nonMonotonic.links[0].upgradeOptions = [{ capacityGbps: 30, cost: 2 }, { capacityGbps: 20, cost: 1 }];
  assert.equal(validateNetworkProject(nonMonotonic).valid, false);
});
