import test from 'node:test';
import assert from 'node:assert/strict';
import type { NetworkProject } from '../packages/model/src/index.ts';
import { validateNetworkProject } from '../packages/model/src/index.ts';
import { routeProject } from '../packages/graph-engine/src/index.ts';
import { runCapacityAnalysis, runLinkContingencies, runLinkContingenciesAsync } from '../packages/evidence/src/index.ts';

function projectBase(id: string): NetworkProject {
  return {
    schemaVersion: '0.1',
    id,
    name: id,
    nodes: [],
    links: [],
    demands: [],
    serviceClasses: [],
    routingProfile: { mode: 'single-shortest-path' },
  };
}

function hugeEcmpProject(layers = 60): NetworkProject {
  const project = projectBase('huge-ecmp');
  project.routingProfile = { mode: 'ecmp' };
  project.serviceClasses = [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 100 }];
  project.nodes.push({ id: 'S', name: 'S' });
  for (let layer = 0; layer < layers; layer += 1) {
    project.nodes.push({ id: `L${layer}A`, name: `L${layer}A` }, { id: `L${layer}B`, name: `L${layer}B` });
  }
  project.nodes.push({ id: 'T', name: 'T' });
  const add = (source: string, target: string) => project.links.push({
    id: `E${project.links.length.toString().padStart(4, '0')}`,
    source,
    target,
    bidirectional: false,
    available: true,
    capacityGbps: 1_000_000,
    weight: 1,
  });
  add('S', 'L0A');
  add('S', 'L0B');
  for (let layer = 0; layer < layers - 1; layer += 1) {
    for (const from of ['A', 'B']) for (const to of ['A', 'B']) add(`L${layer}${from}`, `L${layer + 1}${to}`);
  }
  add(`L${layers - 1}A`, 'T');
  add(`L${layers - 1}B`, 'T');
  project.demands.push({ id: 'D', source: 'S', target: 'T', bandwidthGbps: 1, serviceClassId: 'gold' });
  return project;
}

test('AV-15: ECMP path counts remain exact beyond Number.MAX_SAFE_INTEGER without unbounded materialization', () => {
  const route = routeProject(hugeEcmpProject()).routes[0];
  const exact = 2n ** 60n;
  assert.equal(route.reachable, true);
  assert.equal(route.equalCostPathCountExact, exact.toString());
  assert.equal(route.equalCostPathCount, null, 'unsafe integer convenience field must not lie');
  assert.equal(route.paths.length, 64);
  assert.equal(route.materializedPathCount, 64);
  assert.equal(route.pathsTruncated, true);
  const firstHopFraction = Number(route.linkFractions.E0000 ?? 0) + Number(route.linkFractions.E0001 ?? 0);
  assert.ok(Math.abs(firstHopFraction - 1) < 1e-12, `ECMP source fractions must conserve 1.0, got ${firstHopFraction}`);
});

test('AV-14/AV-30: blank network analysis and N-1 return explicit empty complete results without crashing', async () => {
  const blank = projectBase('blank-adversarial');
  assert.equal(validateNetworkProject(blank).valid, true);
  const routed = routeProject(blank);
  assert.deepEqual(routed.routes, []);
  assert.deepEqual(routed.linkLoads, {});

  const capacity = runCapacityAnalysis(blank);
  assert.equal(capacity.result.verdict, 'PASS');
  assert.deepEqual(capacity.routes, []);

  const sequential = runLinkContingencies(blank);
  assert.equal(sequential.status, 'complete');
  assert.equal(sequential.totalEligibleScenarios, 0);
  assert.equal(sequential.completedScenarios, 0);
  assert.equal(sequential.worst, null);
  assert.equal(sequential.result.verdict, 'PASS');

  const progress: Array<{ total: number; completed: number; percentage: number }> = [];
  const asyncResult = await runLinkContingenciesAsync(blank, null, { onProgress: (value) => progress.push(value) });
  assert.equal(asyncResult.status, 'complete');
  assert.equal(asyncResult.totalEligibleScenarios, 0);
  assert.equal(asyncResult.completedScenarios, 0);
  assert.equal(asyncResult.result.verdict, 'PASS');
  assert.ok(progress.length >= 1);
  assert.deepEqual(progress[0], { ...progress[0], total: 0, completed: 0, percentage: 100 });
});

test('AV-14: N-1 excludes already-disabled links and handles exactly one eligible scenario truthfully', () => {
  const project = projectBase('single-eligible-n1');
  project.nodes = [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }];
  project.links = [
    { id: 'AB', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: true, available: true },
    { id: 'BC-disabled', source: 'B', target: 'C', capacityGbps: 10, weight: 1, bidirectional: true, available: false },
  ];
  const result = runLinkContingencies(project);
  assert.equal(result.totalEligibleScenarios, 1);
  assert.equal(result.completedScenarios, 1);
  assert.equal(result.status, 'complete');
  assert.equal(result.cases[0].linkId, 'AB');
  assert.equal(result.result.metrics.totalEligibleScenarios, 1);
  assert.equal(result.result.metrics.scenariosTested, 1);
});

test('AV-13/AV-14: bounded N-1 never represents partial coverage as PASS or complete', () => {
  const project = projectBase('bounded-n1');
  project.nodes = Array.from({ length: 5 }, (_, index) => ({ id: `N${index}`, name: `N${index}` }));
  project.links = Array.from({ length: 4 }, (_, index) => ({
    id: `L${index}`,
    source: `N${index}`,
    target: `N${index + 1}`,
    capacityGbps: 10,
    weight: 1,
    bidirectional: true,
  }));
  const result = runLinkContingencies(project, null, 3);
  assert.equal(result.totalEligibleScenarios, 4);
  assert.equal(result.completedScenarios, 3);
  assert.equal(result.status, 'partial');
  assert.equal(result.result.verdict, 'CANCELLED');
  assert.equal(result.result.metrics.totalEligibleScenarios, 4);
  assert.equal(result.result.metrics.scenariosTested, 3);
});
