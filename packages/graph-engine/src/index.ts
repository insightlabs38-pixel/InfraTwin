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
const EPSILON = 1e-9;

function round(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }

function buildArcs(project: NetworkProject): { adjacency: Map<string, AdjacencyEdge[]>; reverse: Map<string, AdjacencyEdge[]> } {
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

function dijkstra(adjacency: Map<string, AdjacencyEdge[]>, sourceId: string, reverseDirection = false): Map<string, number> {
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
        current = candidate;
        currentDistance = candidateDistance;
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

function unreachableRoute(demandId: string): DemandRoute {
  return { demandId, reachable: false, nodeIds: [], linkIds: [], totalWeight: null, paths: [], linkFractions: {} };
}

export function shortestPath(project: NetworkProject, demand: DemandModel): DemandRoute {
  const { adjacency } = buildArcs(project);
  if (!adjacency.has(demand.source) || !adjacency.has(demand.target)) return unreachableRoute(demand.id);
  if (demand.source === demand.target) {
    return { demandId: demand.id, reachable: true, nodeIds: [demand.source], linkIds: [], totalWeight: 0, paths: [{ nodeIds: [demand.source], linkIds: [], fraction: 1 }], linkFractions: {} };
  }

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
        distance.set(edge.to, candidateDistance);
        signature.set(edge.to, candidateSignature);
        previous.set(edge.to, { nodeId: current, linkId: edge.linkId });
      }
    }
  }

  if (!previous.has(demand.target)) return unreachableRoute(demand.id);
  const nodeIds = [demand.target];
  const linkIds: string[] = [];
  let cursor = demand.target;
  while (cursor !== demand.source) {
    const step = previous.get(cursor);
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
    totalWeight: distance.get(demand.target) ?? null,
    paths: [{ nodeIds, linkIds, fraction: 1 }],
    linkFractions,
  };
}

export function ecmpRoute(project: NetworkProject, demand: DemandModel): DemandRoute {
  const { adjacency, reverse } = buildArcs(project);
  if (!adjacency.has(demand.source) || !adjacency.has(demand.target)) return unreachableRoute(demand.id);
  if (demand.source === demand.target) {
    return { demandId: demand.id, reachable: true, nodeIds: [demand.source], linkIds: [], totalWeight: 0, paths: [{ nodeIds: [demand.source], linkIds: [], fraction: 1 }], linkFractions: {} };
  }
  for (const edges of adjacency.values()) {
    if (edges.some((edge) => edge.weight <= 0)) throw new Error('ECMP routing requires strictly positive link weights to keep the shortest-path DAG acyclic.');
  }

  const fromSource = dijkstra(adjacency, demand.source);
  const toTarget = dijkstra(reverse, demand.target, true);
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
  const pathCount = new Map<string, number>();
  pathCount.set(demand.target, 1);
  for (const nodeId of nodesByDescendingDistance) {
    if (nodeId === demand.target) continue;
    const count = (dag.get(nodeId) ?? []).reduce((sum, edge) => sum + (pathCount.get(edge.to) ?? 0), 0);
    pathCount.set(nodeId, count);
  }
  const totalPaths = pathCount.get(demand.source) ?? 0;
  if (totalPaths <= 0) return unreachableRoute(demand.id);

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
    const edges = (dag.get(nodeId) ?? []).filter((edge) => (pathCount.get(edge.to) ?? 0) > 0);
    const denominator = edges.reduce((sum, edge) => sum + (pathCount.get(edge.to) ?? 0), 0);
    if (denominator <= 0) continue;
    for (const edge of edges) {
      const fraction = flow * ((pathCount.get(edge.to) ?? 0) / denominator);
      linkFractions[edge.linkId] = round((linkFractions[edge.linkId] ?? 0) + fraction);
      nodeFlow.set(edge.to, round((nodeFlow.get(edge.to) ?? 0) + fraction));
    }
  }

  const primaryNodeIds = [demand.source];
  const primaryLinkIds: string[] = [];
  let cursor = demand.source;
  const seen = new Set<string>();
  while (cursor !== demand.target) {
    if (seen.has(cursor)) return unreachableRoute(demand.id);
    seen.add(cursor);
    const next = (dag.get(cursor) ?? []).find((edge) => (pathCount.get(edge.to) ?? 0) > 0);
    if (!next) return unreachableRoute(demand.id);
    primaryLinkIds.push(next.linkId);
    primaryNodeIds.push(next.to);
    cursor = next.to;
  }

  const paths: RoutePath[] = [];
  const enumerate = (nodeId: string, nodeIds: string[], linkIds: string[]) => {
    if (paths.length >= 64) return;
    if (nodeId === demand.target) {
      paths.push({ nodeIds: [...nodeIds], linkIds: [...linkIds], fraction: round(1 / totalPaths) });
      return;
    }
    for (const edge of dag.get(nodeId) ?? []) {
      if ((pathCount.get(edge.to) ?? 0) <= 0) continue;
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
    linkFractions,
  };
}

export function routeProject(project: NetworkProject): RoutingResult {
  assertValidNetworkProject(project);
  const routes = project.demands.map((demand) => project.routingProfile.mode === 'ecmp' ? ecmpRoute(project, demand) : shortestPath(project, demand));
  const linkLoadsGbps = Object.fromEntries(project.links.map((link) => [link.id, 0])) as Record<string, number>;
  routes.forEach((route, index) => {
    if (!route.reachable) return;
    const demand = project.demands[index];
    for (const [linkId, fraction] of Object.entries(route.linkFractions)) linkLoadsGbps[linkId] = round((linkLoadsGbps[linkId] ?? 0) + demand.bandwidthGbps * fraction);
  });
  const linkById = new Map<string, LinkModel>(project.links.map((link) => [link.id, link]));
  const linkUtilizationPct: Record<string, number> = {};
  for (const [linkId, load] of Object.entries(linkLoadsGbps)) {
    const link = linkById.get(linkId);
    linkUtilizationPct[linkId] = link ? round((load / link.capacityGbps) * 100) : 0;
  }
  return {
    mode: project.routingProfile.mode,
    routes,
    linkLoadsGbps,
    linkUtilizationPct,
    peakUtilizationPct: Math.max(0, ...Object.values(linkUtilizationPct)),
    unroutedDemandIds: routes.filter((route) => !route.reachable).map((route) => route.demandId),
  };
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
        seen.add(next);
        parent.set(next, current);
        queue.push(next);
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
      reachable.add(next);
      queue.push(next);
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
  const cutCapacityGbps = project.links.filter((link) => cutLinkIds.includes(link.id)).reduce((sum, link) => sum + link.capacityGbps, 0);
  return {
    sourceId,
    targetId,
    maxFlowGbps: round(maxFlow),
    cutCapacityGbps: round(cutCapacityGbps),
    cutLinkIds,
    reachableNodeIds: [...reachable].sort(),
  };
}
