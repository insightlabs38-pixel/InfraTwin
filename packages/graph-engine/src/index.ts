import type { DemandModel, LinkModel, NetworkProject } from '../../model/src/index.ts';
import { assertValidNetworkProject } from '../../model/src/index.ts';

export interface RoutePath {
  nodeIds: string[];
  linkIds: string[];
  fraction: number;
}

export interface DemandRoute {
  demandId: string;
  reachable: boolean;
  nodeIds: string[];
  linkIds: string[];
  totalWeight: number | null;
  paths: RoutePath[];
  /** Exact number of equal-cost shortest paths. Kept as decimal text so very large DAG counts stay exact. */
  equalCostPathCountExact: string;
  /** Numeric path count when it is safely representable, otherwise null. */
  equalCostPathCount: number | null;
  materializedPathCount: number;
  pathsTruncated: boolean;
  linkFractions: Record<string, number>;
}

export interface RoutingResult {
  mode: 'single-shortest-path' | 'ecmp';
  routes: DemandRoute[];
  linkLoadsGbps: Record<string, number>;
  linkUtilizationPct: Record<string, number>;
  peakUtilizationPct: number;
  unroutedDemandIds: string[];
}

export interface RoutingSessionStats {
  graphBuilds: number;
  graphReuses: number;
  sourceComputations: number;
  sourceReuses: number;
  reverseComputations: number;
  reverseReuses: number;
}

export interface ComponentResult {
  components: string[][];
  componentByNodeId: Record<string, number>;
}

export interface CutResult {
  sourceId: string;
  targetId: string;
  maxFlowGbps: number;
  cutCapacityGbps: number;
  cutLinkIds: string[];
  reachableNodeIds: string[];
}

type AdjacencyEdge = { from: string; to: string; linkId: string; weight: number; capacityGbps: number };
type RoutingGraph = { adjacency: Map<string, AdjacencyEdge[]>; reverse: Map<string, AdjacencyEdge[]> };
type SingleSourceTree = {
  distance: Map<string, number>;
  signature: Map<string, string>;
  previous: Map<string, { nodeId: string; linkId: string }>;
};
type HeapEntry = { nodeId: string; distance: number; tie: string };

const EPSILON = 1e-9;

function round(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }

class BinaryMinHeap {
  private values: HeapEntry[] = [];
  private readonly compare: (left: HeapEntry, right: HeapEntry) => number;
  constructor(compare: (left: HeapEntry, right: HeapEntry) => number) { this.compare = compare; }
  get size(): number { return this.values.length; }
  push(value: HeapEntry): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.values[parent], value) <= 0) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }
  pop(): HeapEntry | undefined {
    if (!this.values.length) return undefined;
    const root = this.values[0];
    const last = this.values.pop()!;
    if (this.values.length) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.values.length) break;
        let child = left;
        if (right < this.values.length && this.compare(this.values[right], this.values[left]) < 0) child = right;
        if (this.compare(last, this.values[child]) <= 0) break;
        this.values[index] = this.values[child];
        index = child;
      }
      this.values[index] = last;
    }
    return root;
  }
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Routing-semantic key. Demand bandwidth, capacity, names, coordinates, and other presentation fields are intentionally excluded:
 * they do not affect shortest-path structure. Availability, endpoints, directionality, and weights do.
 */
export function routingTopologyKey(project: NetworkProject): string {
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
  singleSourceTrees = new Map<string, SingleSourceTree>();
  sourceDistances = new Map<string, Map<string, number>>();
  reverseDistances = new Map<string, Map<string, number>>();
  readonly stats: RoutingSessionStats = { graphBuilds: 0, graphReuses: 0, sourceComputations: 0, sourceReuses: 0, reverseComputations: 0, reverseReuses: 0 };

  reset(nextTopologyKey = '', nextCacheKey = ''): void {
    this.topologyKey = nextTopologyKey;
    this.cacheKey = nextCacheKey;
    this.graph = null;
    this.singleSourceTrees.clear();
    this.sourceDistances.clear();
    this.reverseDistances.clear();
  }
}

export function createRoutingSession(): RoutingSession { return new RoutingSession(); }

function buildArcs(project: NetworkProject): RoutingGraph {
  const availableNodes = new Set(project.nodes.filter((node) => node.available !== false).map((node) => node.id));
  const adjacency = new Map<string, AdjacencyEdge[]>();
  const reverse = new Map<string, AdjacencyEdge[]>();
  for (const nodeId of availableNodes) { adjacency.set(nodeId, []); reverse.set(nodeId, []); }

  const addArc = (from: string, to: string, link: LinkModel) => {
    const edge: AdjacencyEdge = { from, to, linkId: link.id, weight: link.weight, capacityGbps: link.capacityGbps };
    adjacency.get(from)?.push(edge);
    reverse.get(to)?.push(edge);
  };

  for (const link of project.links) {
    if (link.available === false || !availableNodes.has(link.source) || !availableNodes.has(link.target)) continue;
    addArc(link.source, link.target, link);
    if (link.bidirectional !== false) addArc(link.target, link.source, link);
  }

  const sortEdges = (edges: AdjacencyEdge[]) => edges.sort((a, b) => `${a.linkId}:${a.to}:${a.from}`.localeCompare(`${b.linkId}:${b.to}:${b.from}`));
  for (const edges of adjacency.values()) sortEdges(edges);
  for (const edges of reverse.values()) sortEdges(edges);
  return { adjacency, reverse };
}

function graphFor(project: NetworkProject, session: RoutingSession): RoutingGraph {
  const topologyKey = routingTopologyKey(project);
  const cacheKey = routingTopologyCacheKey(project);
  if (session.cacheKey !== cacheKey) session.reset(topologyKey, cacheKey);
  else session.topologyKey = topologyKey;
  if (session.graph) {
    session.stats.graphReuses += 1;
    return session.graph;
  }
  session.stats.graphBuilds += 1;
  session.graph = buildArcs(project);
  return session.graph;
}

function heapDijkstra(adjacency: Map<string, AdjacencyEdge[]>, sourceId: string, reverseDirection = false): Map<string, number> {
  const distance = new Map<string, number>();
  for (const id of adjacency.keys()) distance.set(id, Number.POSITIVE_INFINITY);
  if (!distance.has(sourceId)) return distance;
  distance.set(sourceId, 0);
  const heap = new BinaryMinHeap((left, right) => {
    if (Math.abs(left.distance - right.distance) > EPSILON) return left.distance - right.distance;
    return left.nodeId.localeCompare(right.nodeId);
  });
  heap.push({ nodeId: sourceId, distance: 0, tie: sourceId });
  const settled = new Set<string>();

  while (heap.size) {
    const entry = heap.pop()!;
    const current = entry.nodeId;
    if (settled.has(current)) continue;
    const known = distance.get(current) ?? Number.POSITIVE_INFINITY;
    if (entry.distance > known + EPSILON) continue;
    settled.add(current);
    for (const edge of adjacency.get(current) ?? []) {
      const next = reverseDirection ? edge.from : edge.to;
      if (settled.has(next)) continue;
      const candidateDistance = known + edge.weight;
      const nextDistance = distance.get(next) ?? Number.POSITIVE_INFINITY;
      if (candidateDistance < nextDistance - EPSILON) {
        distance.set(next, candidateDistance);
        heap.push({ nodeId: next, distance: candidateDistance, tie: next });
      }
    }
  }
  return distance;
}

function heapSingleSourceTree(adjacency: Map<string, AdjacencyEdge[]>, sourceId: string): SingleSourceTree {
  const distance = new Map<string, number>();
  const signature = new Map<string, string>();
  const previous = new Map<string, { nodeId: string; linkId: string }>();
  for (const id of adjacency.keys()) distance.set(id, Number.POSITIVE_INFINITY);
  if (!distance.has(sourceId)) return { distance, signature, previous };
  distance.set(sourceId, 0);
  signature.set(sourceId, sourceId);
  const heap = new BinaryMinHeap((left, right) => {
    if (Math.abs(left.distance - right.distance) > EPSILON) return left.distance - right.distance;
    const tie = left.tie.localeCompare(right.tie);
    return tie || left.nodeId.localeCompare(right.nodeId);
  });
  heap.push({ nodeId: sourceId, distance: 0, tie: sourceId });
  const settled = new Set<string>();

  while (heap.size) {
    const entry = heap.pop()!;
    const current = entry.nodeId;
    const knownDistance = distance.get(current) ?? Number.POSITIVE_INFINITY;
    const knownSignature = signature.get(current) ?? current;
    if (settled.has(current)) continue;
    if (entry.distance > knownDistance + EPSILON || entry.tie !== knownSignature) continue;
    settled.add(current);
    for (const edge of adjacency.get(current) ?? []) {
      if (settled.has(edge.to)) continue;
      const candidateDistance = knownDistance + edge.weight;
      const candidateSignature = `${knownSignature}>${edge.linkId}>${edge.to}`;
      const nextDistance = distance.get(edge.to) ?? Number.POSITIVE_INFINITY;
      const nextSignature = signature.get(edge.to);
      if (candidateDistance < nextDistance - EPSILON || (Math.abs(candidateDistance - nextDistance) <= EPSILON && (nextSignature === undefined || candidateSignature < nextSignature))) {
        distance.set(edge.to, candidateDistance);
        signature.set(edge.to, candidateSignature);
        previous.set(edge.to, { nodeId: current, linkId: edge.linkId });
        heap.push({ nodeId: edge.to, distance: candidateDistance, tie: candidateSignature });
      }
    }
  }
  return { distance, signature, previous };
}

function pathCountFields(total: bigint, materialized: number) {
  return {
    equalCostPathCountExact: total.toString(),
    equalCostPathCount: total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null,
    materializedPathCount: materialized,
    pathsTruncated: total > BigInt(materialized),
  };
}

function ratioBigInt(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  const scale = 1_000_000_000_000_000n;
  return Number((numerator * scale) / denominator) / 1_000_000_000_000_000;
}

function unreachableRoute(demandId: string): DemandRoute {
  return { demandId, reachable: false, nodeIds: [], linkIds: [], totalWeight: null, paths: [], ...pathCountFields(0n, 0), linkFractions: {} };
}

function singleRouteFromTree(demand: DemandModel, tree: SingleSourceTree): DemandRoute {
  if (demand.source === demand.target) {
    return { demandId: demand.id, reachable: true, nodeIds: [demand.source], linkIds: [], totalWeight: 0, paths: [{ nodeIds: [demand.source], linkIds: [], fraction: 1 }], ...pathCountFields(1n, 1), linkFractions: {} };
  }
  if (!tree.previous.has(demand.target)) return unreachableRoute(demand.id);
  const nodeIds = [demand.target];
  const linkIds: string[] = [];
  let cursor = demand.target;
  while (cursor !== demand.source) {
    const step = tree.previous.get(cursor);
    if (!step) return unreachableRoute(demand.id);
    linkIds.unshift(step.linkId);
    nodeIds.unshift(step.nodeId);
    cursor = step.nodeId;
  }
  const linkFractions = Object.fromEntries(linkIds.map((id) => [id, 1])) as Record<string, number>;
  return {
    demandId: demand.id,
    reachable: true,
    nodeIds,
    linkIds,
    totalWeight: tree.distance.get(demand.target) ?? null,
    paths: [{ nodeIds, linkIds, fraction: 1 }],
    ...pathCountFields(1n, 1),
    linkFractions,
  };
}

function ecmpRouteFromDistances(graph: RoutingGraph, demand: DemandModel, fromSource: Map<string, number>, toTarget: Map<string, number>): DemandRoute {
  const { adjacency } = graph;
  if (!adjacency.has(demand.source) || !adjacency.has(demand.target)) return unreachableRoute(demand.id);
  if (demand.source === demand.target) {
    return { demandId: demand.id, reachable: true, nodeIds: [demand.source], linkIds: [], totalWeight: 0, paths: [{ nodeIds: [demand.source], linkIds: [], fraction: 1 }], ...pathCountFields(1n, 1), linkFractions: {} };
  }
  const totalWeight = fromSource.get(demand.target) ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(totalWeight)) return unreachableRoute(demand.id);

  const dag = new Map<string, AdjacencyEdge[]>();
  for (const nodeId of adjacency.keys()) dag.set(nodeId, []);
  for (const [nodeId, edges] of adjacency) {
    const sourceDistance = fromSource.get(nodeId) ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(sourceDistance)) continue;
    for (const edge of edges) {
      const targetDistance = toTarget.get(edge.to) ?? Number.POSITIVE_INFINITY;
      if (!Number.isFinite(targetDistance)) continue;
      if (Math.abs(sourceDistance + edge.weight + targetDistance - totalWeight) <= EPSILON) dag.get(nodeId)?.push(edge);
    }
    dag.get(nodeId)?.sort((a, b) => `${a.linkId}:${a.to}`.localeCompare(`${b.linkId}:${b.to}`));
  }

  const nodesByDescendingDistance = [...adjacency.keys()].sort((a, b) => {
    const da = fromSource.get(a) ?? Number.POSITIVE_INFINITY;
    const db = fromSource.get(b) ?? Number.POSITIVE_INFINITY;
    if (Math.abs(da - db) > EPSILON) return db - da;
    return b.localeCompare(a);
  });
  const pathCount = new Map<string, bigint>();
  pathCount.set(demand.target, 1n);
  for (const nodeId of nodesByDescendingDistance) {
    if (nodeId === demand.target) continue;
    const count = (dag.get(nodeId) ?? []).reduce((sum, edge) => sum + (pathCount.get(edge.to) ?? 0n), 0n);
    pathCount.set(nodeId, count);
  }
  const totalPaths = pathCount.get(demand.source) ?? 0n;
  if (totalPaths <= 0n) return unreachableRoute(demand.id);

  const nodeFlow = new Map<string, number>([[demand.source, 1]]);
  const linkFractions: Record<string, number> = {};
  const nodesByAscendingDistance = [...adjacency.keys()].sort((a, b) => {
    const da = fromSource.get(a) ?? Number.POSITIVE_INFINITY;
    const db = fromSource.get(b) ?? Number.POSITIVE_INFINITY;
    if (Math.abs(da - db) > EPSILON) return da - db;
    return a.localeCompare(b);
  });
  for (const nodeId of nodesByAscendingDistance) {
    const flow = nodeFlow.get(nodeId) ?? 0;
    if (flow <= EPSILON || nodeId === demand.target) continue;
    const edges = (dag.get(nodeId) ?? []).filter((edge) => (pathCount.get(edge.to) ?? 0n) > 0n);
    const denominator = edges.reduce((sum, edge) => sum + (pathCount.get(edge.to) ?? 0n), 0n);
    if (denominator <= 0n) continue;
    for (const edge of edges) {
      const fraction = flow * ratioBigInt(pathCount.get(edge.to) ?? 0n, denominator);
      linkFractions[edge.linkId] = (linkFractions[edge.linkId] ?? 0) + fraction;
      nodeFlow.set(edge.to, (nodeFlow.get(edge.to) ?? 0) + fraction);
    }
  }

  const primaryNodeIds = [demand.source];
  const primaryLinkIds: string[] = [];
  let cursor = demand.source;
  const seen = new Set<string>();
  while (cursor !== demand.target) {
    if (seen.has(cursor)) return unreachableRoute(demand.id);
    seen.add(cursor);
    const next = (dag.get(cursor) ?? []).find((edge) => (pathCount.get(edge.to) ?? 0n) > 0n);
    if (!next) return unreachableRoute(demand.id);
    primaryLinkIds.push(next.linkId);
    primaryNodeIds.push(next.to);
    cursor = next.to;
  }

  const paths: RoutePath[] = [];
  const enumerate = (nodeId: string, nodeIds: string[], linkIds: string[]) => {
    if (paths.length >= 64) return;
    if (nodeId === demand.target) {
      paths.push({ nodeIds: [...nodeIds], linkIds: [...linkIds], fraction: ratioBigInt(1n, totalPaths) });
      return;
    }
    for (const edge of dag.get(nodeId) ?? []) {
      if ((pathCount.get(edge.to) ?? 0n) <= 0n) continue;
      enumerate(edge.to, [...nodeIds, edge.to], [...linkIds, edge.linkId]);
      if (paths.length >= 64) break;
    }
  };
  enumerate(demand.source, [demand.source], []);

  return {
    demandId: demand.id,
    reachable: true,
    nodeIds: primaryNodeIds,
    linkIds: primaryLinkIds,
    totalWeight: round(totalWeight),
    paths,
    ...pathCountFields(totalPaths, paths.length),
    linkFractions,
  };
}

function singleTreeFor(graph: RoutingGraph, sourceId: string, session: RoutingSession): SingleSourceTree {
  const cached = session.singleSourceTrees.get(sourceId);
  if (cached) { session.stats.sourceReuses += 1; return cached; }
  session.stats.sourceComputations += 1;
  const tree = heapSingleSourceTree(graph.adjacency, sourceId);
  session.singleSourceTrees.set(sourceId, tree);
  return tree;
}

function sourceDistancesFor(graph: RoutingGraph, sourceId: string, session: RoutingSession): Map<string, number> {
  const cached = session.sourceDistances.get(sourceId);
  if (cached) { session.stats.sourceReuses += 1; return cached; }
  session.stats.sourceComputations += 1;
  const value = heapDijkstra(graph.adjacency, sourceId);
  session.sourceDistances.set(sourceId, value);
  return value;
}

function reverseDistancesFor(graph: RoutingGraph, targetId: string, session: RoutingSession): Map<string, number> {
  const cached = session.reverseDistances.get(targetId);
  if (cached) { session.stats.reverseReuses += 1; return cached; }
  session.stats.reverseComputations += 1;
  const value = heapDijkstra(graph.reverse, targetId, true);
  session.reverseDistances.set(targetId, value);
  return value;
}

export function shortestPath(project: NetworkProject, demand: DemandModel): DemandRoute {
  assertValidNetworkProject(project);
  const session = createRoutingSession();
  const graph = graphFor(project, session);
  if (!graph.adjacency.has(demand.source) || !graph.adjacency.has(demand.target)) return unreachableRoute(demand.id);
  return singleRouteFromTree(demand, singleTreeFor(graph, demand.source, session));
}

export function ecmpRoute(project: NetworkProject, demand: DemandModel): DemandRoute {
  assertValidNetworkProject(project);
  const session = createRoutingSession();
  const graph = graphFor(project, session);
  if (!graph.adjacency.has(demand.source) || !graph.adjacency.has(demand.target)) return unreachableRoute(demand.id);
  for (const edges of graph.adjacency.values()) {
    if (edges.some((edge) => edge.weight <= 0)) throw new Error('ECMP routing requires strictly positive link weights to keep the shortest-path DAG acyclic.');
  }
  return ecmpRouteFromDistances(graph, demand, sourceDistancesFor(graph, demand.source, session), reverseDistancesFor(graph, demand.target, session));
}

export interface RoutingExecutionProfile {
  validationMs: number;
  graphBuildMs: number;
  pathComputationMs: number;
  flowAccumulationMs: number;
  capacityComputationMs: number;
  totalMs: number;
  graphBuilds: number;
  graphReuses: number;
  sourceComputations: number;
  sourceReuses: number;
  reverseComputations: number;
  reverseReuses: number;
}

function profilingNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function routeProjectCore(project: NetworkProject, session: RoutingSession, timings?: Partial<RoutingExecutionProfile>): RoutingResult {
  const graphStartedAt = profilingNow();
  const graph = graphFor(project, session);
  if (timings) timings.graphBuildMs = profilingNow() - graphStartedAt;
  if (project.routingProfile.mode === 'ecmp') {
    for (const edges of graph.adjacency.values()) {
      if (edges.some((edge) => edge.weight <= 0)) throw new Error('ECMP routing requires strictly positive link weights to keep the shortest-path DAG acyclic.');
    }
  }

  const pathsStartedAt = profilingNow();
  // Work is organized by source. The first demand from a source computes the source structure; all others reuse it.
  const routes = project.demands.map((demand) => {
    if (!graph.adjacency.has(demand.source) || !graph.adjacency.has(demand.target)) return unreachableRoute(demand.id);
    if (project.routingProfile.mode === 'ecmp') {
      return ecmpRouteFromDistances(graph, demand, sourceDistancesFor(graph, demand.source, session), reverseDistancesFor(graph, demand.target, session));
    }
    return singleRouteFromTree(demand, singleTreeFor(graph, demand.source, session));
  });
  if (timings) timings.pathComputationMs = profilingNow() - pathsStartedAt;

  const flowStartedAt = profilingNow();
  const linkLoadsGbps = Object.fromEntries(project.links.map((link) => [link.id, 0])) as Record<string, number>;
  routes.forEach((route, index) => {
    if (!route.reachable) return;
    const demand = project.demands[index];
    for (const [linkId, fraction] of Object.entries(route.linkFractions)) linkLoadsGbps[linkId] = (linkLoadsGbps[linkId] ?? 0) + demand.bandwidthGbps * fraction;
  });
  if (timings) timings.flowAccumulationMs = profilingNow() - flowStartedAt;

  const capacityStartedAt = profilingNow();
  const linkById = new Map<string, LinkModel>(project.links.map((link) => [link.id, link]));
  const linkUtilizationPct: Record<string, number> = {};
  for (const [linkId, load] of Object.entries(linkLoadsGbps)) {
    const link = linkById.get(linkId);
    linkUtilizationPct[linkId] = link ? (load / link.capacityGbps) * 100 : 0;
  }
  const result = {
    mode: project.routingProfile.mode,
    routes,
    linkLoadsGbps,
    linkUtilizationPct,
    peakUtilizationPct: Math.max(0, ...Object.values(linkUtilizationPct)),
    unroutedDemandIds: routes.filter((route) => !route.reachable).map((route) => route.demandId),
  };
  if (timings) timings.capacityComputationMs = profilingNow() - capacityStartedAt;
  return result;
}

export function routeProject(project: NetworkProject, session: RoutingSession = createRoutingSession()): RoutingResult {
  assertValidNetworkProject(project);
  return routeProjectCore(project, session);
}

/** Measured routing stages for Phase 3.5C benchmarking. Semantics are identical to routeProject. */
export function routeProjectProfiled(project: NetworkProject, session: RoutingSession = createRoutingSession()): { result: RoutingResult; profile: RoutingExecutionProfile } {
  const startedAt = profilingNow();
  const validationStartedAt = profilingNow();
  assertValidNetworkProject(project);
  const validationMs = profilingNow() - validationStartedAt;
  const before = { ...session.stats };
  const partial: Partial<RoutingExecutionProfile> = { validationMs };
  const result = routeProjectCore(project, session, partial);
  const profile: RoutingExecutionProfile = {
    validationMs,
    graphBuildMs: partial.graphBuildMs ?? 0,
    pathComputationMs: partial.pathComputationMs ?? 0,
    flowAccumulationMs: partial.flowAccumulationMs ?? 0,
    capacityComputationMs: partial.capacityComputationMs ?? 0,
    totalMs: profilingNow() - startedAt,
    graphBuilds: session.stats.graphBuilds - before.graphBuilds,
    graphReuses: session.stats.graphReuses - before.graphReuses,
    sourceComputations: session.stats.sourceComputations - before.sourceComputations,
    sourceReuses: session.stats.sourceReuses - before.sourceReuses,
    reverseComputations: session.stats.reverseComputations - before.reverseComputations,
    reverseReuses: session.stats.reverseReuses - before.reverseReuses,
  };
  return { result, profile };
}

// Independent pre-3.5C reference implementation retained for semantic differential tests.
function referenceDijkstra(adjacency: Map<string, AdjacencyEdge[]>, sourceId: string, reverseDirection = false): Map<string, number> {
  const distance = new Map<string, number>();
  const unvisited = new Set(adjacency.keys());
  for (const id of unvisited) distance.set(id, Number.POSITIVE_INFINITY);
  if (!distance.has(sourceId)) return distance;
  distance.set(sourceId, 0);
  while (unvisited.size) {
    let current: string | null = null;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const candidate of unvisited) {
      const candidateDistance = distance.get(candidate) ?? Number.POSITIVE_INFINITY;
      if (candidateDistance < currentDistance - EPSILON || (Math.abs(candidateDistance - currentDistance) <= EPSILON && (current === null || candidate < current))) {
        current = candidate; currentDistance = candidateDistance;
      }
    }
    if (current === null || !Number.isFinite(currentDistance)) break;
    unvisited.delete(current);
    for (const edge of adjacency.get(current) ?? []) {
      const next = reverseDirection ? edge.from : edge.to;
      if (!unvisited.has(next)) continue;
      const candidateDistance = currentDistance + edge.weight;
      if (candidateDistance < (distance.get(next) ?? Number.POSITIVE_INFINITY) - EPSILON) distance.set(next, candidateDistance);
    }
  }
  return distance;
}

function referenceShortestPath(project: NetworkProject, demand: DemandModel): DemandRoute {
  const { adjacency } = buildArcs(project);
  if (!adjacency.has(demand.source) || !adjacency.has(demand.target)) return unreachableRoute(demand.id);
  if (demand.source === demand.target) return { demandId: demand.id, reachable: true, nodeIds: [demand.source], linkIds: [], totalWeight: 0, paths: [{ nodeIds: [demand.source], linkIds: [], fraction: 1 }], ...pathCountFields(1n, 1), linkFractions: {} };
  const distance = new Map<string, number>();
  const signature = new Map<string, string>();
  const previous = new Map<string, { nodeId: string; linkId: string }>();
  const unvisited = new Set(adjacency.keys());
  for (const id of unvisited) distance.set(id, Number.POSITIVE_INFINITY);
  distance.set(demand.source, 0);
  signature.set(demand.source, demand.source);
  while (unvisited.size) {
    const current = [...unvisited].sort((a, b) => {
      const da = distance.get(a) ?? Number.POSITIVE_INFINITY;
      const db = distance.get(b) ?? Number.POSITIVE_INFINITY;
      if (Math.abs(da - db) > EPSILON) return da - db;
      return (signature.get(a) ?? a).localeCompare(signature.get(b) ?? b);
    })[0];
    if (!current || !Number.isFinite(distance.get(current) ?? Number.POSITIVE_INFINITY)) break;
    unvisited.delete(current);
    if (current === demand.target) break;
    for (const edge of adjacency.get(current) ?? []) {
      if (!unvisited.has(edge.to)) continue;
      const candidateDistance = (distance.get(current) ?? 0) + edge.weight;
      const candidateSignature = `${signature.get(current) ?? current}>${edge.linkId}>${edge.to}`;
      const knownDistance = distance.get(edge.to) ?? Number.POSITIVE_INFINITY;
      const knownSignature = signature.get(edge.to);
      if (candidateDistance < knownDistance - EPSILON || (Math.abs(candidateDistance - knownDistance) <= EPSILON && (knownSignature === undefined || candidateSignature < knownSignature))) {
        distance.set(edge.to, candidateDistance); signature.set(edge.to, candidateSignature); previous.set(edge.to, { nodeId: current, linkId: edge.linkId });
      }
    }
  }
  return singleRouteFromTree(demand, { distance, signature, previous });
}

function referenceEcmpRoute(project: NetworkProject, demand: DemandModel): DemandRoute {
  const graph = buildArcs(project);
  if (!graph.adjacency.has(demand.source) || !graph.adjacency.has(demand.target)) return unreachableRoute(demand.id);
  for (const edges of graph.adjacency.values()) if (edges.some((edge) => edge.weight <= 0)) throw new Error('ECMP routing requires strictly positive link weights to keep the shortest-path DAG acyclic.');
  const fromSource = referenceDijkstra(graph.adjacency, demand.source);
  const toTarget = referenceDijkstra(graph.reverse, demand.target, true);
  return ecmpRouteFromDistances(graph, demand, fromSource, toTarget);
}

export function routeProjectReference(project: NetworkProject): RoutingResult {
  assertValidNetworkProject(project);
  const routes = project.demands.map((demand) => project.routingProfile.mode === 'ecmp' ? referenceEcmpRoute(project, demand) : referenceShortestPath(project, demand));
  const linkLoadsGbps = Object.fromEntries(project.links.map((link) => [link.id, 0])) as Record<string, number>;
  routes.forEach((route, index) => {
    if (!route.reachable) return;
    const demand = project.demands[index];
    for (const [linkId, fraction] of Object.entries(route.linkFractions)) linkLoadsGbps[linkId] = (linkLoadsGbps[linkId] ?? 0) + demand.bandwidthGbps * fraction;
  });
  const linkById = new Map(project.links.map((link) => [link.id, link]));
  const linkUtilizationPct: Record<string, number> = {};
  for (const [linkId, load] of Object.entries(linkLoadsGbps)) {
    const link = linkById.get(linkId);
    linkUtilizationPct[linkId] = link ? (load / link.capacityGbps) * 100 : 0;
  }
  return { mode: project.routingProfile.mode, routes, linkLoadsGbps, linkUtilizationPct, peakUtilizationPct: Math.max(0, ...Object.values(linkUtilizationPct)), unroutedDemandIds: routes.filter((route) => !route.reachable).map((route) => route.demandId) };
}

export function connectedComponents(project: NetworkProject): ComponentResult {
  assertValidNetworkProject(project);
  const availableNodes = project.nodes.filter((node) => node.available !== false).map((node) => node.id).sort();
  const neighbors = new Map<string, Set<string>>(availableNodes.map((id) => [id, new Set<string>()]));
  for (const link of project.links) {
    if (link.available === false || !neighbors.has(link.source) || !neighbors.has(link.target)) continue;
    neighbors.get(link.source)?.add(link.target);
    neighbors.get(link.target)?.add(link.source);
  }
  const unseen = new Set(availableNodes);
  const components: string[][] = [];
  while (unseen.size) {
    const seed = [...unseen].sort()[0];
    const queue = [seed];
    const component: string[] = [];
    unseen.delete(seed);
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      for (const next of [...(neighbors.get(current) ?? [])].sort()) {
        if (!unseen.has(next)) continue;
        unseen.delete(next);
        queue.push(next);
      }
    }
    components.push(component.sort());
  }
  components.sort((a, b) => a[0].localeCompare(b[0]));
  const componentByNodeId: Record<string, number> = {};
  components.forEach((component, index) => component.forEach((nodeId) => { componentByNodeId[nodeId] = index; }));
  return { components, componentByNodeId };
}

export function minCut(project: NetworkProject, sourceId: string, targetId: string): CutResult {
  assertValidNetworkProject(project);
  const availableNodes = new Set(project.nodes.filter((node) => node.available !== false).map((node) => node.id));
  if (!availableNodes.has(sourceId) || !availableNodes.has(targetId)) throw new Error('minCut source and target must be available nodes');
  if (sourceId === targetId) return { sourceId, targetId, maxFlowGbps: 0, cutCapacityGbps: 0, cutLinkIds: [], reachableNodeIds: [sourceId] };

  const residual = new Map<string, Map<string, number>>();
  for (const nodeId of availableNodes) residual.set(nodeId, new Map());
  const addCapacity = (from: string, to: string, capacity: number) => {
    const row = residual.get(from)!;
    row.set(to, (row.get(to) ?? 0) + capacity);
    if (!residual.get(to)!.has(from)) residual.get(to)!.set(from, 0);
  };
  for (const link of project.links) {
    if (link.available === false || !availableNodes.has(link.source) || !availableNodes.has(link.target)) continue;
    addCapacity(link.source, link.target, link.capacityGbps);
    if (link.bidirectional !== false) addCapacity(link.target, link.source, link.capacityGbps);
  }

  let maxFlow = 0;
  while (true) {
    const parent = new Map<string, string>();
    const queue = [sourceId];
    const seen = new Set<string>([sourceId]);
    while (queue.length && !seen.has(targetId)) {
      const current = queue.shift()!;
      for (const [next, capacity] of [...(residual.get(current)?.entries() ?? [])].sort(([a], [b]) => a.localeCompare(b))) {
        if (capacity <= EPSILON || seen.has(next)) continue;
        seen.add(next); parent.set(next, current); queue.push(next);
      }
    }
    if (!seen.has(targetId)) break;
    let pathCapacity = Number.POSITIVE_INFINITY;
    let cursor = targetId;
    while (cursor !== sourceId) {
      const previous = parent.get(cursor)!;
      pathCapacity = Math.min(pathCapacity, residual.get(previous)?.get(cursor) ?? 0);
      cursor = previous;
    }
    cursor = targetId;
    while (cursor !== sourceId) {
      const previous = parent.get(cursor)!;
      residual.get(previous)!.set(cursor, (residual.get(previous)!.get(cursor) ?? 0) - pathCapacity);
      residual.get(cursor)!.set(previous, (residual.get(cursor)!.get(previous) ?? 0) + pathCapacity);
      cursor = previous;
    }
    maxFlow += pathCapacity;
  }

  const reachable = new Set<string>([sourceId]);
  const queue = [sourceId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const [next, capacity] of residual.get(current)?.entries() ?? []) {
      if (capacity <= EPSILON || reachable.has(next)) continue;
      reachable.add(next); queue.push(next);
    }
  }

  const cutLinkIds = project.links
    .filter((link) => link.available !== false && availableNodes.has(link.source) && availableNodes.has(link.target))
    .filter((link) => {
      const sourceReachable = reachable.has(link.source);
      const targetReachable = reachable.has(link.target);
      if (link.bidirectional !== false) return sourceReachable !== targetReachable;
      return sourceReachable && !targetReachable;
    })
    .map((link) => link.id)
    .sort();
  const cutLinkSet = new Set(cutLinkIds);
  const cutCapacityGbps = project.links.filter((link) => cutLinkSet.has(link.id)).reduce((sum, link) => sum + link.capacityGbps, 0);
  return { sourceId, targetId, maxFlowGbps: round(maxFlow), cutCapacityGbps: round(cutCapacityGbps), cutLinkIds, reachableNodeIds: [...reachable].sort() };
}

export interface RoutingWorkloadEstimate {
  nodes: number;
  links: number;
  directedArcs: number;
  demands: number;
  uniqueSources: number;
  uniqueTargets: number;
  shortestPathRuns: number;
  estimatedWorkUnits: number;
}

/** Deterministic complexity estimate used only for execution-mode selection; it is not a runtime prediction. */
export function estimateRoutingWorkload(project: NetworkProject): RoutingWorkloadEstimate {
  const availableNodes = new Set(project.nodes.filter((node) => node.available !== false).map((node) => node.id));
  let directedArcs = 0;
  for (const link of project.links) {
    if (link.available === false || !availableNodes.has(link.source) || !availableNodes.has(link.target)) continue;
    directedArcs += link.bidirectional === false ? 1 : 2;
  }
  const routableDemands = project.demands.filter((demand) => availableNodes.has(demand.source) && availableNodes.has(demand.target));
  const uniqueSources = new Set(routableDemands.map((demand) => demand.source)).size;
  const uniqueTargets = new Set(routableDemands.map((demand) => demand.target)).size;
  const shortestPathRuns = uniqueSources + (project.routingProfile.mode === 'ecmp' ? uniqueTargets : 0);
  const graphComplexity = (availableNodes.size + directedArcs) * Math.max(1, Math.log2(Math.max(2, availableNodes.size)));
  return {
    nodes: project.nodes.length,
    links: project.links.length,
    directedArcs,
    demands: project.demands.length,
    uniqueSources,
    uniqueTargets,
    shortestPathRuns,
    estimatedWorkUnits: Math.round(shortestPathRuns * graphComplexity),
  };
}
