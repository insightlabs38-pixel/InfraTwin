from pathlib import Path

# Temporary focused patcher for F-004. Remove before the final freeze gate.
p = Path('packages/graph-engine/src/index.ts')
s = p.read_text()

cache_key_fn = r'''

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
'''
class_anchor = "\nexport class RoutingSession {\n  topologyKey = '';\n  graph: RoutingGraph | null = null;"
class_replacement = cache_key_fn + "\nexport class RoutingSession {\n  /** Compact diagnostic fingerprint; never authoritative for cache reuse. */\n  topologyKey = '';\n  /** Collision-safe exact semantic identity used to authorize graph/source reuse. */\n  cacheKey = '';\n  graph: RoutingGraph | null = null;"
if class_anchor not in s:
    raise SystemExit('RoutingSession class anchor not found')
s = s.replace(class_anchor, class_replacement, 1)

reset_anchor = """  reset(nextTopologyKey = ''): void {
    this.topologyKey = nextTopologyKey;
    this.graph = null;
"""
reset_replacement = """  reset(nextTopologyKey = '', nextCacheKey = ''): void {
    this.topologyKey = nextTopologyKey;
    this.cacheKey = nextCacheKey;
    this.graph = null;
"""
if reset_anchor not in s:
    raise SystemExit('RoutingSession reset anchor not found')
s = s.replace(reset_anchor, reset_replacement, 1)

graph_anchor = """function graphFor(project: NetworkProject, session: RoutingSession): RoutingGraph {
  const key = routingTopologyKey(project);
  if (session.topologyKey !== key) session.reset(key);
  if (session.graph) {
"""
graph_replacement = """function graphFor(project: NetworkProject, session: RoutingSession): RoutingGraph {
  const topologyKey = routingTopologyKey(project);
  const cacheKey = routingTopologyCacheKey(project);
  if (session.cacheKey !== cacheKey) session.reset(topologyKey, cacheKey);
  else session.topologyKey = topologyKey;
  if (session.graph) {
"""
if graph_anchor not in s:
    raise SystemExit('graphFor anchor not found')
s = s.replace(graph_anchor, graph_replacement, 1)
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
    if anchor not in s:
        raise SystemExit('final adversarial import anchor not found')
    s = s.replace(anchor, anchor + addition, 1)

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
