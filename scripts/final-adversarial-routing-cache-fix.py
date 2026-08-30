from pathlib import Path

# Executed only by the temporary focused adversarial workflow; remove before final freeze.
p = Path('packages/graph-engine/src/index.ts')
s = p.read_text()

old = """export function routingTopologyKey(project: NetworkProject): string {
  const nodePart = project.nodes.map((node) => `${node.id}:${node.available === false ? 0 : 1}`).sort().join('|');
  const linkPart = project.links.map((link) => [
    link.id,
    link.source,
    link.target,
    link.bidirectional === false ? 0 : 1,
    link.available === false ? 0 : 1,
    link.weight,
  ].join(':')).sort().join('|');
  return `rtopo:${fnv1a(`${nodePart}#${linkPart}`)}`;
}

export class RoutingSession {
  topologyKey = '';
  graph: RoutingGraph | null = null;
"""
new = """export function routingTopologyKey(project: NetworkProject): string {
  const nodePart = project.nodes.map((node) => `${node.id}:${node.available === false ? 0 : 1}`).sort().join('|');
  const linkPart = project.links.map((link) => [
    link.id,
    link.source,
    link.target,
    link.bidirectional === false ? 0 : 1,
    link.available === false ? 0 : 1,
    link.weight,
  ].join(':')).sort().join('|');
  return `rtopo:${fnv1a(`${nodePart}#${linkPart}`)}`;
}

/** Exact routing-semantic identity used for cache authority. The compact FNV key above is diagnostics only. */
export function routingTopologyCacheKey(project: NetworkProject): string {
  const nodes = project.nodes
    .map((node) => [node.id, node.available === false ? 0 : 1] as const)
    .sort((left, right) => left[0].localeCompare(right[0]));
  const links = project.links
    .map((link) => [link.id, link.source, link.target, link.bidirectional === false ? 0 : 1, link.available === false ? 0 : 1, link.weight] as const)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify(['routing-topology-v2', nodes, links]);
}

export class RoutingSession {
  /** Compact diagnostic fingerprint; never authoritative for cache reuse. */
  topologyKey = '';
  /** Collision-safe exact semantic identity used to authorize graph/source reuse. */
  cacheKey = '';
  graph: RoutingGraph | null = null;
"""
if old not in s:
    raise SystemExit('routing topology/class target not found')
s = s.replace(old, new)

old = """  reset(nextTopologyKey = ''): void {
    this.topologyKey = nextTopologyKey;
    this.graph = null;
"""
new = """  reset(nextTopologyKey = '', nextCacheKey = ''): void {
    this.topologyKey = nextTopologyKey;
    this.cacheKey = nextCacheKey;
    this.graph = null;
"""
if old not in s:
    raise SystemExit('routing reset target not found')
s = s.replace(old, new)

old = """function graphFor(project: NetworkProject, session: RoutingSession): RoutingGraph {
  const key = routingTopologyKey(project);
  if (session.topologyKey !== key) session.reset(key);
  if (session.graph) {
"""
new = """function graphFor(project: NetworkProject, session: RoutingSession): RoutingGraph {
  const topologyKey = routingTopologyKey(project);
  const cacheKey = routingTopologyCacheKey(project);
  if (session.cacheKey !== cacheKey) session.reset(topologyKey, cacheKey);
  else session.topologyKey = topologyKey;
  if (session.graph) {
"""
if old not in s:
    raise SystemExit('graphFor target not found')
s = s.replace(old, new)
p.write_text(s)

p = Path('tests/final-adversarial.test.ts')
s = p.read_text()
anchor = "import { CollaborativeWorkspaceService } from '../packages/application/src/index.ts';\n"
addition = """import {
  createRoutingSession,
  routeProject,
  routeProjectReference,
  routingTopologyCacheKey,
  routingTopologyKey,
} from '../packages/graph-engine/src/index.ts';
"""
if addition not in s:
    s = s.replace(anchor, anchor + addition)

marker = "test('AV-06/F-004: ordinary RoutingSession cache cannot be poisoned by a 32-bit topology collision'"
if marker not in s:
    s += r'''

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
'''
p.write_text(s)
