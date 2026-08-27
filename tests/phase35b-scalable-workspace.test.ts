import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changePlanHash,
  compileChangePlanToScenarioPatch,
  createChangePlan,
  isPlanEvidenceFresh,
  modelHash,
  type NetworkProject,
} from '../packages/model/src/index.ts';
import { analyzeChangePlan } from '../packages/evidence/src/index.ts';
import { buildCapacityUpgradeMILP } from '../packages/optimizer/src/index.ts';
import { getScenarioDefinition } from '../packages/scenarios/src/index.ts';
import { computeDeterministicLayout, searchTopology, topologyRegions } from '../apps/web/lib/topology-workspace.ts';
import { parseCsvBundle } from '../apps/web/lib/csv-import.ts';
import { applyUpgradeProfile } from '../apps/web/lib/upgrade-catalog.ts';

const FLAGSHIP_HASH = 'sha256:661d1e8c85aea919e8379981ad45f0554d9fe613e18aa52808f1797624fa0e65';

function coordinateFreeProject(): NetworkProject {
  return {
    schemaVersion: '0.1', id: 'coordinate-free', name: 'Coordinate Free',
    nodes: [
      { id: 'A', name: 'Alpha', region: 'East', type: 'core', available: true },
      { id: 'B', name: 'Beta', region: 'East', type: 'edge', available: true },
      { id: 'C', name: 'Gamma', region: 'West', type: 'core', available: true },
    ],
    links: [
      { id: 'AB', source: 'A', target: 'B', capacityGbps: 40, weight: 1, bidirectional: true, available: true },
      { id: 'BC', source: 'B', target: 'C', capacityGbps: 40, weight: 1, bidirectional: true, available: true },
    ],
    demands: [{ id: 'D', name: 'Alpha to Gamma', source: 'A', target: 'C', bandwidthGbps: 4, serviceClassId: 'default' }],
    serviceClasses: [{ id: 'default', name: 'Default', priority: 50, maxUtilizationPct: 80, allowShedding: false }],
    routingProfile: { mode: 'single-shortest-path' },
  };
}

test('Phase 3.5B A/B: deterministic auto-layout gives coordinate-free topology distinct stable positions', () => {
  const project = coordinateFreeProject();
  const first = computeDeterministicLayout(project);
  const second = computeDeterministicLayout(structuredClone(project));
  assert.deepEqual(first, second);
  assert.equal(Object.keys(first).length, 3);
  assert.equal(new Set(Object.values(first).map((point) => `${point.x},${point.y}`)).size, 3);
  assert.equal(Object.values(first).every((point) => point.x !== 0 || point.y !== 0), true);
});

test('Phase 3.5B C/G: presentation layout/search/filter state cannot stale semantic model or ChangePlan evidence', () => {
  const definition = getScenarioDefinition('continental-service-network');
  const project = definition.project;
  const plan = definition.changePlanTemplate!;
  const evidence = analyzeChangePlan(project, plan);
  const baseHash = modelHash(project);
  const planHash = changePlanHash(plan);
  const documentBefore = JSON.stringify(project);
  computeDeterministicLayout(project, { ignoreExplicit: true });
  searchTopology(project, 'Chicago');
  const presentation = { pan: [44, -12], zoom: 1.8, filter: new Set(['Central']), mode: 'change-plan', selection: 'CHI-CORE-1' };
  assert.equal(presentation.filter.has('Central'), true);
  assert.equal(JSON.stringify(project), documentBefore);
  assert.equal(modelHash(project), baseHash);
  assert.equal(changePlanHash(plan), planHash);
  assert.equal(isPlanEvidenceFresh(evidence.stamp, project, plan), true);
});

test('Phase 3.5B D: flagship synthetic network is exact and hash-stable', () => {
  const definition = getScenarioDefinition('continental-service-network');
  assert.equal(definition.project.nodes.length, 128);
  assert.equal(definition.project.links.length, 304);
  assert.equal(definition.project.demands.length, 96);
  assert.equal(topologyRegions(definition.project).length, 6);
  assert.equal(definition.project.serviceClasses.length, 3);
  assert.equal(modelHash(definition.project), FLAGSHIP_HASH);
  assert.equal(definition.project.nodes.some((node) => node.x !== undefined || node.y !== undefined), false);
  assert.equal(definition.project.metadata?.realisticSynthetic, true);
});

test('Phase 3.5B E: flagship Saturday Backbone Maintenance uses generic ChangePlan compilation and reveals the distant corridor bottleneck', () => {
  const definition = getScenarioDefinition('continental-service-network');
  const plan = definition.changePlanTemplate!;
  const patch = compileChangePlanToScenarioPatch(definition.project, plan);
  assert.deepEqual(patch.disabledLinkIds, ['BB-NE-CE-01']);
  assert.equal(patch.demandMultipliers.length, 10);
  assert.equal(plan.constraints.targetUtilizationPct, 80);
  assert.equal(plan.constraints.budgetCostUnits, 12);
  assert.deepEqual(plan.restrictions.lockedLinkIds, ['BB-SE-CE-02']);
  const analysis = analyzeChangePlan(definition.project, plan);
  assert.equal(analysis.verdict, 'FAIL');
  assert.ok(Math.abs(analysis.capacity.routing.linkUtilizationPct['BB-SE-CE-01'] - 92.5) < 1e-8);
  assert.equal(analysis.capacity.result.violations.some((violation) => violation.linkId === 'BB-SE-CE-01'), true);
});

test('Phase 3.5B F: semantic search deterministically returns node, link, and demand IDs', () => {
  const project = getScenarioDefinition('continental-service-network').project;
  assert.equal(searchTopology(project, 'Chicago')[0]?.id, 'CHI-CORE-1');
  assert.equal(searchTopology(project, 'BB-NE-CE-01')[0]?.id, 'BB-NE-CE-01');
  assert.equal(searchTopology(project, 'Payments east-central 1')[0]?.id, 'PAY-NECE-01');
  assert.deepEqual(searchTopology(project, 'Chicago'), searchTopology(project, 'Chicago'));
});

test('Phase 3.5B H: valid coordinate-free CSV bundle imports with disclosed defaults', () => {
  const review = parseCsvBundle({
    projectName: 'Imported Backbone',
    nodesCsv: 'id,name,region,type\nA,Alpha,East,core\nB,Beta,West,edge\n',
    linksCsv: 'id,source,target,capacityGbps,weight,bidirectional\nAB,A,B,40,,true\n',
    demandsCsv: 'id,name,source,target,bandwidthGbps,serviceClassId\nD1,Payments,A,B,5,default\n',
  });
  assert.deepEqual(review.counts, { nodes: 2, links: 1, demands: 1, regions: 2, serviceClasses: 1 });
  assert.equal(review.project.links[0].weight, 1);
  assert.equal(review.project.demands[0].serviceClassId, 'imported-default');
  assert.ok(review.warnings.some((warning) => /no explicit weight/i.test(warning)));
  const layout = computeDeterministicLayout(review.project);
  assert.notDeepEqual(layout.A, layout.B);
});

test('Phase 3.5B I: CSV invalid node and service-class references reject clearly', () => {
  assert.throws(() => parseCsvBundle({
    nodesCsv: 'id,name\nA,Alpha\n',
    linksCsv: 'id,source,target,capacityGbps\nAB,A,MISSING,40\n',
  }), /unknown node MISSING/i);
  assert.throws(() => parseCsvBundle({
    nodesCsv: 'id,name\nA,Alpha\nB,Beta\n',
    linksCsv: 'id,source,target,capacityGbps\nAB,A,B,40\n',
    demandsCsv: 'id,source,target,bandwidthGbps,serviceClassId\nD,A,B,5,gold\n',
  }), /no service-class catalog/i);
});

test('Phase 3.5B J: upgrade catalog editing is an explicit canonical design-space edit consumed by existing optimizer model construction', () => {
  const definition = getScenarioDefinition('continental-service-network');
  const baseHash = modelHash(definition.project);
  const edited = applyUpgradeProfile(definition.project, ['BB-SE-CE-01'], [
    { capacityGbps: 120, cost: 4 }, { capacityGbps: 200, cost: 8 },
  ]);
  assert.notEqual(modelHash(edited), baseHash);
  assert.deepEqual(edited.links.find((link) => link.id === 'BB-SE-CE-01')?.upgradeOptions, [{ capacityGbps: 120, cost: 4 }, { capacityGbps: 200, cost: 8 }]);
  const plan = definition.changePlanTemplate!;
  const rebuiltPlan = createChangePlan(edited, 'Saturday Backbone Maintenance', { id: 'rebased', now: '2026-01-01T00:00:00.000Z' });
  assert.equal(rebuiltPlan.baseModelHash, modelHash(edited));
  const milp = buildCapacityUpgradeMILP(edited, { targetUtilizationPct: 80, includeBaseline: true });
  assert.equal(milp.variables.some((variable) => variable.linkId === 'BB-SE-CE-01' && variable.toCapacityGbps === 200), true);
  assert.equal(changePlanHash(plan) === changePlanHash(rebuiltPlan), false);
});
