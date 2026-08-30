import test from 'node:test';
import assert from 'node:assert/strict';
import type { NetworkProject } from '../packages/model/src/index.ts';
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
