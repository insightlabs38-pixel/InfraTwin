import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPACITY_MILP_RECOMMENDED_MAX_DECISION_SCENARIO_PRODUCT,
  ROUTING_LP_RECOMMENDED_MAX_FLOW_VARIABLES,
  estimateCapacityMILP,
  estimateTrafficAllocationLP,
} from '../packages/optimizer/src/index.ts';
import {
  CollaborativeWorkspaceService,
  type CollaborativeWorkspaceAdapters,
  type WorkspaceSelection,
} from '../packages/application/src/index.ts';
import { changePlanHash, createChangePlan, type ChangePlan, type NetworkProject, type ScenarioPatch } from '../packages/model/src/index.ts';
import { getScenarioDefinition } from '../packages/scenarios/src/index.ts';

function routingBoundaryProject(demands: number): NetworkProject {
  const nodes = [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }];
  const links = Array.from({ length: 50 }, (_, index) => ({
    id: `L${index}`, source: 'A', target: 'B', capacityGbps: 1000, weight: 1, bidirectional: true,
  }));
  return {
    schemaVersion: '0.1', id: `routing-boundary-${demands}`, name: 'Routing boundary', nodes, links,
    demands: Array.from({ length: demands }, (_, index) => ({ id: `D${index}`, source: 'A', target: 'B', bandwidthGbps: 1, serviceClassId: 'gold' })),
    serviceClasses: [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 100, allowShedding: false }],
    routingProfile: { mode: 'single-shortest-path' },
  };
}

function capacityBoundaryProject(decisions: number): NetworkProject {
  return {
    schemaVersion: '0.1', id: `capacity-boundary-${decisions}`, name: 'Capacity boundary',
    nodes: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }],
    links: Array.from({ length: decisions }, (_, index) => ({
      id: `L${index}`, source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: true,
      upgradeOptions: [{ capacityGbps: 20, cost: 1 }],
    })),
    demands: [{ id: 'D', source: 'A', target: 'B', bandwidthGbps: 1, serviceClassId: 'gold' }],
    serviceClasses: [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 100, allowShedding: false }],
    routingProfile: { mode: 'single-shortest-path' },
  };
}

const outage = (id: string): ScenarioPatch => ({
  id, name: id, disabledNodeIds: [], disabledLinkIds: [], demandMultipliers: [], addedDemands: [], linkCapacityOverrides: [],
});

test('AV-31: routing-LP guard is inclusive exactly at its measured flow-variable limit', () => {
  assert.equal(ROUTING_LP_RECOMMENDED_MAX_FLOW_VARIABLES, 10_000);
  const below = estimateTrafficAllocationLP(routingBoundaryProject(99));
  const exact = estimateTrafficAllocationLP(routingBoundaryProject(100));
  const above = estimateTrafficAllocationLP(routingBoundaryProject(101));
  assert.equal(below.flowVariables, 9_900);
  assert.equal(exact.flowVariables, 10_000);
  assert.equal(above.flowVariables, 10_100);
  assert.equal(below.recommended, true);
  assert.equal(exact.recommended, true);
  assert.equal(above.recommended, false);
});

test('AV-31: capacity-MILP guard is inclusive at decision×scenario product limit', () => {
  assert.equal(CAPACITY_MILP_RECOMMENDED_MAX_DECISION_SCENARIO_PRODUCT, 10_000);
  const project = capacityBoundaryProject(100);
  const patches99 = Array.from({ length: 98 }, (_, index) => outage(`s${index}`)); // + baseline = 99
  const patches100 = Array.from({ length: 99 }, (_, index) => outage(`s${index}`)); // + baseline = 100
  const patches101 = Array.from({ length: 100 }, (_, index) => outage(`s${index}`)); // + baseline = 101
  const below = estimateCapacityMILP(project, { includeBaseline: true, scenarioPatches: patches99 });
  const exact = estimateCapacityMILP(project, { includeBaseline: true, scenarioPatches: patches100 });
  const above = estimateCapacityMILP(project, { includeBaseline: true, scenarioPatches: patches101 });
  assert.equal(below.decisionScenarioProduct, 9_900);
  assert.equal(exact.decisionScenarioProduct, 10_000);
  assert.equal(above.decisionScenarioProduct, 10_100);
  assert.equal(below.recommended, true);
  assert.equal(exact.recommended, true);
  assert.equal(above.recommended, false);
});

function sharedHarness() {
  const project = structuredClone(getScenarioDefinition('maintenance-trap').project);
  let plan: ChangePlan = createChangePlan(project, 'Repeated action adversarial', { id: 'repeat-plan', now: '2026-08-31T01:00:00.000Z' });
  let selection: WorkspaceSelection = null;
  const adapters: CollaborativeWorkspaceAdapters = {
    getProject: () => project,
    getPlan: () => plan,
    setPlan: (next) => { plan = next; },
    getSelection: () => selection,
    setSelection: (next) => { selection = next; },
    getDestination: () => 'network',
    setDestination: () => {},
    getAnalysis: () => null,
    publishAnalysis: () => {},
  };
  return { service: new CollaborativeWorkspaceService(adapters), project, get plan() { return plan; } };
}

test('AV-38/AV-39: repeated locks and routing restrictions are idempotent and retain original human provenance', () => {
  const h = sharedHarness();
  const linkId = h.project.links[0].id;
  const once = h.service.setPlanRestriction('link', linkId, true, 'human');
  const afterOnceHash = changePlanHash(once);
  const twice = h.service.setPlanRestriction('link', linkId, true, 'human');
  assert.equal(twice.restrictions.lockedLinkIds.filter((id) => id === linkId).length, 1);
  assert.equal(changePlanHash(twice), afterOnceHash, 're-applying the same lock must not create a new semantic revision');

  const routedOnce = h.service.setRoutingRestriction('link', linkId, true, 'human');
  const routedHash = changePlanHash(routedOnce);
  const routedTwice = h.service.setRoutingRestriction('link', linkId, true, 'human');
  assert.equal(routedTwice.restrictions.forbiddenRoutingLinkIds.filter((id) => id === linkId).length, 1);
  assert.equal(changePlanHash(routedTwice), routedHash, 're-applying the same routing restriction must be semantically idempotent');

  assert.throws(() => h.service.setPlanRestriction('link', linkId, false, 'agent'), /cannot remove a human restriction/i);
  assert.throws(() => h.service.setRoutingRestriction('link', linkId, false, 'agent'), /cannot remove a human routing restriction/i);
});

test('AV-38: repeated equivalent semantic plan changes do not duplicate identical rows silently', () => {
  const h = sharedHarness();
  const linkId = h.project.links[0].id;
  h.service.addPlanChange({ type: 'disable_link', linkId }, 'human');
  assert.throws(
    () => h.service.addPlanChange({ type: 'disable_link', linkId }, 'human'),
    /duplicate|already|conflict|existing/i,
    'an identical outage entered twice must be rejected rather than silently duplicated',
  );
  assert.equal(h.plan.changes.filter((change) => change.type === 'disable_link' && change.target.kind === 'link' && change.target.id === linkId).length, 1);
  h.service.addPlanChange({ type: 'enable_link', linkId }, 'human');
  h.service.addPlanChange({ type: 'disable_link', linkId }, 'human');
  assert.equal(h.plan.changes.filter((change) => change.type === 'disable_link' && change.target.kind === 'link' && change.target.id === linkId).length, 2, 'disable→enable→disable remains a valid ordered semantic sequence');
});
