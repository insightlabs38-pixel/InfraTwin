import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changePlanEvidenceStamp,
  createChangePlan,
  modelHash,
  setCandidateProposals,
  type CandidatePlan,
  type ChangePlan,
  type NetworkProject,
} from '../packages/model/src/index.ts';
import { CollaborativeWorkspaceService } from '../packages/application/src/index.ts';
import {
  createRoutingSession,
  routeProject,
  routeProjectReference,
  routingTopologyCacheKey,
  routingTopologyKey,
} from '../packages/graph-engine/src/index.ts';
import {
  createPathEngineProfile,
  designTopologyCacheKey,
  generateRoutePaths,
  resetLevel4PathCaches,
  type DesignPathTopologyOptions,
} from '../packages/optimizer/src/level4-path-engine.ts';

function legacyFnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function legacyTopologyFingerprint(project: NetworkProject, options: DesignPathTopologyOptions): string {
  const nodes = project.nodes.map((node) => `${node.id}:${node.available === false ? 0 : 1}`).sort();
  const links = project.links
    .map((link) => [link.id, link.source, link.target, link.bidirectional === false ? 0 : 1, link.available === false ? 0 : 1, link.weight].join(':'))
    .sort();
  const restrictions = [
    [...options.forbiddenRoutingNodeIds].sort().join(','),
    [...options.forbiddenRoutingLinkIds].sort().join(','),
    '',
  ].join('#');
  return `l4topo:${legacyFnv1a(`${nodes.join('|')}#${links.join('|')}#${restrictions}`)}`;
}

const options: DesignPathTopologyOptions = {
  forbiddenRoutingLinkIds: [],
  forbiddenRoutingNodeIds: [],
  lockedNodeIds: [],
  candidateLinkOptions: [],
  includeCandidateLinks: false,
  maxCandidatePaths: 3,
  diversityPenalty: 0.15,
};

function collisionProject(id: string, links: NetworkProject['links']): NetworkProject {
  return {
    schemaVersion: '0.1',
    id,
    name: id,
    nodes: ['A', 'B', 'C'].map((nodeId) => ({ id: nodeId, name: nodeId })),
    links,
    demands: [{ id: 'D', source: 'A', target: 'C', bandwidthGbps: 1, serviceClassId: 'gold' }],
    serviceClasses: [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 100, allowShedding: false }],
    routingProfile: { mode: 'single-shortest-path' },
  };
}

test('AV-06/F-001: legacy 32-bit topology collision cannot poison the Level 4B graph or route cache', () => {
  const reachable = collisionProject('collision-reachable', [
    { id: 'x92799', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: false },
    { id: 'y92799', source: 'B', target: 'C', capacityGbps: 10, weight: 1, bidirectional: false },
  ]);
  const unreachable = collisionProject('collision-unreachable', [
    { id: 'p19024', source: 'C', target: 'B', capacityGbps: 10, weight: 1, bidirectional: false },
    { id: 'q19024', source: 'B', target: 'A', capacityGbps: 10, weight: 1, bidirectional: false },
  ]);

  // This deliberately proves the old cache authority was unsafe. The test would fail against the old implementation
  // because both calls below were authorized by this 32-bit digest alone.
  assert.equal(legacyTopologyFingerprint(reachable, options), 'l4topo:fnv1a32:cf42e5c3');
  assert.equal(legacyTopologyFingerprint(unreachable, options), 'l4topo:fnv1a32:cf42e5c3');
  assert.notEqual(designTopologyCacheKey(reachable, options), designTopologyCacheKey(unreachable, options));

  resetLevel4PathCaches();
  const firstProfile = createPathEngineProfile();
  const first = generateRoutePaths(reachable, 'A', 'C', options, firstProfile);
  assert.equal(firstProfile.cacheMisses, 1);
  assert.equal(first.length, 1);
  assert.deepEqual(first[0].nodes, ['A', 'B', 'C']);
  assert.deepEqual(first[0].hops.map((hop) => hop.linkId), ['x92799', 'y92799']);

  const secondProfile = createPathEngineProfile();
  const second = generateRoutePaths(unreachable, 'A', 'C', options, secondProfile);
  assert.equal(secondProfile.cacheHits, 0, 'colliding legacy digest must never grant route-cache reuse');
  assert.equal(secondProfile.cacheMisses, 1);
  assert.deepEqual(second, [], 'the second topology has no directed A→C route');
});


test('AV-11/F-003: proposal acceptance rejects a candidate after the base network changes', () => {
  let project = collisionProject('proposal-authority', [
    { id: 'L1', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: false },
    { id: 'L2', source: 'B', target: 'C', capacityGbps: 10, weight: 1, bidirectional: false },
  ]);
  let plan: ChangePlan = createChangePlan(project, 'Authority test', { id: 'authority-plan', now: '2026-08-30T22:00:00.000Z' });
  const candidate: CandidatePlan = {
    id: 'authority-candidate',
    name: 'Upgrade L1',
    baseModelHash: modelHash(project),
    commands: [{ id: 'upgrade-l1', type: 'set_link_capacity', actor: 'agent', args: { linkId: 'L1', capacityGbps: 20 }, createdAt: '2026-08-30T22:00:01.000Z' }],
    objective: { name: 'cost', value: 1, unit: 'cost-units' },
    rationaleEvidenceIds: [],
  };
  plan = setCandidateProposals(project, plan, candidate, '2026-08-30T22:00:02.000Z');
  const proposalId = plan.proposals[0].id;
  const service = new CollaborativeWorkspaceService({
    getProject: () => project,
    getPlan: () => plan,
    setPlan: (next) => { plan = next; },
  });

  // Simulate a project replacement/revision racing with stale proposal UI state. The old service path
  // checked only sourcePlanHash and would accept this proposal against the wrong base network.
  project = structuredClone(project);
  project.links[0].weight = 2;
  assert.notEqual(plan.baseModelHash, modelHash(project));
  assert.equal(service.capabilityState().proposalStale, true);
  assert.equal(service.capabilityState().canDecideProposal, false);
  assert.equal(service.getWorkspaceSummary().proposal.stale, true);
  assert.equal(service.inspectPlan().proposals[0].stale, true);
  assert.throws(() => service.acceptProposalChange(proposalId, 'agent'), /stale.*base network changed/i);
  assert.equal(plan.proposals[0].state, 'pending');
  assert.equal(plan.changes.length, 0);
  assert.throws(() => service.acceptAllProposalChanges('agent'), /stale.*base network changed/i);
  assert.equal(plan.proposals[0].state, 'pending');
});


test('AV-06/F-004: ordinary RoutingSession cache cannot be poisoned by a 32-bit topology collision', () => {
  const reachable = collisionProject('routing-collision-reachable', [
    { id: 'x174651', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: false },
    { id: 'y174651', source: 'B', target: 'C', capacityGbps: 10, weight: 1, bidirectional: false },
  ]);
  const unreachable = collisionProject('routing-collision-unreachable', [
    { id: 'p13952', source: 'C', target: 'B', capacityGbps: 10, weight: 1, bidirectional: false },
    { id: 'q13952', source: 'B', target: 'A', capacityGbps: 10, weight: 1, bidirectional: false },
  ]);

  // The public compact key deliberately remains stable for diagnostics. This pair proves why it cannot authorize reuse.
  assert.equal(routingTopologyKey(reachable), 'rtopo:7fc538c4');
  assert.equal(routingTopologyKey(unreachable), 'rtopo:7fc538c4');
  assert.notEqual(routingTopologyCacheKey(reachable), routingTopologyCacheKey(unreachable));

  const session = createRoutingSession();
  const first = routeProject(reachable, session);
  assert.equal(first.routes[0].reachable, true);
  assert.deepEqual(first.routes[0].nodeIds, ['A', 'B', 'C']);

  const second = routeProject(unreachable, session);
  const independent = routeProjectReference(unreachable);
  assert.deepEqual(second, independent, 'session reuse must equal a cache-independent reference after a colliding topology change');
  assert.equal(second.routes[0].reachable, false);
  assert.equal(session.stats.graphBuilds, 2, 'both exact topologies must build distinct graphs despite the diagnostic digest collision');
});


test('AV-13/F-006: stale complete N-1 evidence is not advertised as current complete coverage', () => {
  const project = collisionProject('n1-freshness', [
    { id: 'L1', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: false },
    { id: 'L2', source: 'B', target: 'C', capacityGbps: 10, weight: 1, bidirectional: false },
  ]);
  let plan = createChangePlan(project, 'N-1 freshness', { id: 'n1-plan', now: '2026-08-30T22:10:00.000Z' });
  const stamp = changePlanEvidenceStamp(project, plan);
  const service = new CollaborativeWorkspaceService({
    getProject: () => project,
    getPlan: () => plan,
    setPlan: (next) => { plan = next; },
    getContingencies: () => ({ analysis: { status: 'complete' } as never, stamp }),
  });
  assert.equal(service.capabilityState().hasCompleteN1, true);
  service.setPlanConstraint('targetUtilizationPct', 75, 'human');
  assert.equal(service.capabilityState().hasCompleteN1, false, 'complete but stale N-1 evidence must not be advertised as current coverage');
});


test('AV-09/F-007: agent cannot remove human routing restrictions through the shared service', () => {
  const project = collisionProject('routing-restriction-authority', [
    { id: 'L1', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: false },
    { id: 'L2', source: 'B', target: 'C', capacityGbps: 10, weight: 1, bidirectional: false },
  ]);
  let plan = createChangePlan(project, 'Routing restriction authority', { id: 'routing-plan', now: '2026-08-30T22:20:00.000Z' });
  const service = new CollaborativeWorkspaceService({
    getProject: () => project,
    getPlan: () => plan,
    setPlan: (next) => { plan = next; },
  });

  service.setRoutingRestriction('link', 'L1', true, 'human');
  service.setRoutingRestriction('node', 'B', true, 'human');
  assert.ok(plan.restrictions.forbiddenRoutingLinkIds.includes('L1'));
  assert.ok(plan.restrictions.forbiddenRoutingNodeIds.includes('B'));
  assert.throws(() => service.setRoutingRestriction('link', 'L1', false, 'agent'), /Agent cannot remove a human routing restriction/);
  assert.throws(() => service.setRoutingRestriction('node', 'B', false, 'agent'), /Agent cannot remove a human routing restriction/);
  assert.ok(plan.restrictions.forbiddenRoutingLinkIds.includes('L1'));
  assert.ok(plan.restrictions.forbiddenRoutingNodeIds.includes('B'));

  service.setRoutingRestriction('link', 'L1', false, 'human');
  service.setRoutingRestriction('node', 'B', false, 'human');
  assert.equal(plan.restrictions.forbiddenRoutingLinkIds.includes('L1'), false);
  assert.equal(plan.restrictions.forbiddenRoutingNodeIds.includes('B'), false);
});
