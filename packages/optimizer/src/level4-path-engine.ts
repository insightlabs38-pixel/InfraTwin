import type { CandidateLinkOption, LinkModel, NetworkProject } from '../../model/src/index.ts';

export interface PathEngineHop {
  linkId: string;
  source: string;
  target: string;
  direction: 'forward' | 'reverse';
  candidateLink: boolean;
}

export interface PathEngineRawPath {
  nodes: string[];
  hops: PathEngineHop[];
  cost: number;
}

interface InternalRawPath extends PathEngineRawPath {
  nodeIndexes: number[];
  edgeIds: number[];
  signature: string;
  linkSet: Set<string>;
}

export interface DesignPathTopologyOptions {
  forbiddenRoutingLinkIds: readonly string[];
  forbiddenRoutingNodeIds: readonly string[];
  lockedNodeIds: readonly string[];
  candidateLinkOptions: readonly CandidateLinkOption[];
  includeCandidateLinks: boolean;
  maxCandidatePaths: number;
  diversityPenalty: number;
}

export interface PathEngineProfile {
  topologyFingerprints: number;
  uniqueSourceTargetPairs: number;
  pathGenerationRequests: number;
  cacheHits: number;
  cacheMisses: number;
  graphCompiles: number;
  graphReuses: number;
  shortestPathRuns: number;
  heapPushes: number;
  heapPops: number;
  yenSpurSearches: number;
  graphCompileMs: number;
  firstPathMs: number;
  yenAlternativeMs: number;
  diversityMs: number;
  approximateGraphBytes: number;
  approximatePathCacheBytes: number;
}

export interface CompiledDesignGraph {
  fingerprint: string;
  nodeIds: readonly string[];
  nodeIndexById: ReadonlyMap<string, number>;
  edges: readonly CompiledDesignEdge[];
  adjacency: readonly (readonly number[])[];
  approximateBytes: number;
}

interface CompiledDesignEdge {
  id: number;
  linkId: string;
  source: string;
  target: string;
  sourceIndex: number;
  targetIndex: number;
  weight: number;
  candidateLink: boolean;
  direction: 'forward' | 'reverse';
}

interface HeapNode {
  nodeIndex: number;
  cost: number;
  signature: string;
}

interface CandidateHeapNode {
  path: InternalRawPath;
}

const EPSILON = 1e-12;
const GRAPH_CACHE_LIMIT = 32;
const ROUTE_CACHE_LIMIT = 4096;

const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
const round = (value: number, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits;

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function abortError(): Error {
  const error = new Error('Operation cancelled');
  error.name = 'AbortError';
  return error;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

class BinaryMinHeap<T> {
  private values: T[] = [];
  private readonly compare: (left: T, right: T) => number;
  constructor(compare: (left: T, right: T) => number) { this.compare = compare; }
  get size(): number { return this.values.length; }
  push(value: T): void {
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
  pop(): T | undefined {
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

class BoundedLru<K, V> {
  private readonly values = new Map<K, V>();
  private readonly limit: number;
  constructor(limit: number) { this.limit = limit; }
  get size(): number { return this.values.size; }
  get(key: K): V | undefined {
    const value = this.values.get(key);
    if (value === undefined) return undefined;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }
  set(key: K, value: V): void {
    if (this.values.has(key)) this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > this.limit) this.values.delete(this.values.keys().next().value as K);
  }
  clear(): void { this.values.clear(); }
  entries(): IterableIterator<[K, V]> { return this.values.entries(); }
}

const graphCache = new BoundedLru<string, CompiledDesignGraph>(GRAPH_CACHE_LIMIT);
const routeCache = new BoundedLru<string, readonly InternalRawPath[]>(ROUTE_CACHE_LIMIT);

function emptyProfile(): PathEngineProfile {
  return {
    topologyFingerprints: 0,
    uniqueSourceTargetPairs: 0,
    pathGenerationRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    graphCompiles: 0,
    graphReuses: 0,
    shortestPathRuns: 0,
    heapPushes: 0,
    heapPops: 0,
    yenSpurSearches: 0,
    graphCompileMs: 0,
    firstPathMs: 0,
    yenAlternativeMs: 0,
    diversityMs: 0,
    approximateGraphBytes: 0,
    approximatePathCacheBytes: 0,
  };
}

export function createPathEngineProfile(): PathEngineProfile { return emptyProfile(); }

export function resetLevel4PathCaches(): void {
  graphCache.clear();
  routeCache.clear();
}

export function level4PathCachePolicy(): { graphEntries: number; routeEntries: number; maxGraphEntries: number; maxRouteEntries: number } {
  return { graphEntries: graphCache.size, routeEntries: routeCache.size, maxGraphEntries: GRAPH_CACHE_LIMIT, maxRouteEntries: ROUTE_CACHE_LIMIT };
}

function semanticCandidateRows(options: DesignPathTopologyOptions): string[] {
  if (!options.includeCandidateLinks) return [];
  const lockedNodes = new Set(options.lockedNodeIds);
  return options.candidateLinkOptions
    .filter((option) => !lockedNodes.has(option.source) && !lockedNodes.has(option.target))
    .map((option) => [option.id, option.source, option.target, option.bidirectional === false ? 0 : 1, option.weight].join(':'))
    .sort();
}

/** Only route-feasibility/cost semantics participate. Bandwidth, capacity, budget, upgrade costs and utilization targets do not. */
export function designTopologyFingerprint(project: NetworkProject, options: DesignPathTopologyOptions): string {
  const nodes = project.nodes.map((node) => `${node.id}:${node.available === false ? 0 : 1}`).sort();
  const links = project.links.map((link) => [link.id, link.source, link.target, link.bidirectional === false ? 0 : 1, link.available === false ? 0 : 1, link.weight].join(':')).sort();
  const restrictions = [
    [...options.forbiddenRoutingNodeIds].sort().join(','),
    [...options.forbiddenRoutingLinkIds].sort().join(','),
    semanticCandidateRows(options).join('|'),
  ].join('#');
  return `l4topo:${fnv1a(`${nodes.join('|')}#${links.join('|')}#${restrictions}`)}`;
}

function edgeCompare(left: Omit<CompiledDesignEdge, 'id' | 'sourceIndex' | 'targetIndex'>, right: Omit<CompiledDesignEdge, 'id' | 'sourceIndex' | 'targetIndex'>): number {
  return left.source.localeCompare(right.source)
    || left.weight - right.weight
    || left.linkId.localeCompare(right.linkId)
    || left.target.localeCompare(right.target)
    || left.direction.localeCompare(right.direction);
}

function approximateStringBytes(value: string): number { return value.length * 2; }

export function compileDesignGraph(project: NetworkProject, options: DesignPathTopologyOptions, signal?: AbortSignal): CompiledDesignGraph {
  checkAbort(signal);
  const fingerprint = designTopologyFingerprint(project, options);
  const cached = graphCache.get(fingerprint);
  if (cached) return cached;

  const nodeIds = project.nodes.map((node) => node.id).sort();
  const nodeIndexById = new Map(nodeIds.map((id, index) => [id, index]));
  const unavailableNodes = new Set(project.nodes.filter((node) => node.available === false).map((node) => node.id));
  const forbiddenNodes = new Set(options.forbiddenRoutingNodeIds);
  const forbiddenLinks = new Set(options.forbiddenRoutingLinkIds);
  const rows: Array<Omit<CompiledDesignEdge, 'id' | 'sourceIndex' | 'targetIndex'>> = [];
  const push = (link: Pick<LinkModel, 'id' | 'source' | 'target' | 'weight' | 'bidirectional' | 'available'>, candidateLink: boolean) => {
    if (link.available === false || forbiddenLinks.has(link.id) || unavailableNodes.has(link.source) || unavailableNodes.has(link.target) || forbiddenNodes.has(link.source) || forbiddenNodes.has(link.target)) return;
    rows.push({ linkId: link.id, source: link.source, target: link.target, weight: link.weight, candidateLink, direction: 'forward' });
    if (link.bidirectional !== false) rows.push({ linkId: link.id, source: link.target, target: link.source, weight: link.weight, candidateLink, direction: 'reverse' });
  };
  for (const link of project.links) push(link, false);
  if (options.includeCandidateLinks) {
    const lockedNodes = new Set(options.lockedNodeIds);
    for (const option of options.candidateLinkOptions) {
      if (!lockedNodes.has(option.source) && !lockedNodes.has(option.target)) push({ ...option, available: true }, true);
    }
  }
  rows.sort(edgeCompare);
  const edges: CompiledDesignEdge[] = rows.map((row, id) => ({
    ...row,
    id,
    sourceIndex: nodeIndexById.get(row.source) ?? -1,
    targetIndex: nodeIndexById.get(row.target) ?? -1,
  }));
  const adjacency: number[][] = Array.from({ length: nodeIds.length }, () => []);
  for (const edge of edges) if (edge.sourceIndex >= 0 && edge.targetIndex >= 0) adjacency[edge.sourceIndex].push(edge.id);
  let approximateBytes = nodeIds.reduce((sum, id) => sum + approximateStringBytes(id), 0) + nodeIds.length * 16 + edges.length * 72;
  for (const edge of edges) approximateBytes += approximateStringBytes(edge.linkId) + approximateStringBytes(edge.source) + approximateStringBytes(edge.target);
  approximateBytes += adjacency.reduce((sum, ids) => sum + ids.length * 8, 0);
  const compiled: CompiledDesignGraph = { fingerprint, nodeIds, nodeIndexById, edges, adjacency, approximateBytes };
  graphCache.set(fingerprint, compiled);
  return compiled;
}

function pathSignature(nodes: readonly string[], hops: readonly PathEngineHop[]): string {
  return `${nodes.join('>')}|${hops.map((hop) => `${hop.linkId}:${hop.direction}`).join('>')}`;
}

function toHop(edge: CompiledDesignEdge): PathEngineHop {
  return { linkId: edge.linkId, source: edge.source, target: edge.target, direction: edge.direction, candidateLink: edge.candidateLink };
}

function shortestPath(
  graph: CompiledDesignGraph,
  sourceIndex: number,
  targetIndex: number,
  bannedNodes: ReadonlySet<number>,
  bannedEdges: ReadonlySet<number>,
  signal: AbortSignal | undefined,
  profile: PathEngineProfile,
): InternalRawPath | null {
  profile.shortestPathRuns += 1;
  if (sourceIndex === targetIndex) {
    const node = graph.nodeIds[sourceIndex];
    return { nodes: [node], nodeIndexes: [sourceIndex], hops: [], edgeIds: [], cost: 0, signature: `${node}|`, linkSet: new Set() };
  }
  if (sourceIndex < 0 || targetIndex < 0 || bannedNodes.has(sourceIndex) || bannedNodes.has(targetIndex)) return null;
  const distance = new Float64Array(graph.nodeIds.length);
  distance.fill(Number.POSITIVE_INFINITY);
  const signatures: Array<string | undefined> = Array(graph.nodeIds.length);
  const previousNode = new Int32Array(graph.nodeIds.length); previousNode.fill(-1);
  const previousEdge = new Int32Array(graph.nodeIds.length); previousEdge.fill(-1);
  distance[sourceIndex] = 0;
  signatures[sourceIndex] = graph.nodeIds[sourceIndex];
  const heap = new BinaryMinHeap<HeapNode>((left, right) => {
    if (Math.abs(left.cost - right.cost) > EPSILON) return left.cost - right.cost;
    const signatureOrder = left.signature.localeCompare(right.signature);
    return signatureOrder || graph.nodeIds[left.nodeIndex].localeCompare(graph.nodeIds[right.nodeIndex]);
  });
  heap.push({ nodeIndex: sourceIndex, cost: 0, signature: graph.nodeIds[sourceIndex] });
  profile.heapPushes += 1;
  let iterations = 0;
  while (heap.size) {
    if ((iterations++ & 255) === 0) checkAbort(signal);
    const current = heap.pop()!;
    profile.heapPops += 1;
    if (current.cost > distance[current.nodeIndex] + EPSILON || current.signature !== signatures[current.nodeIndex]) continue;
    if (current.nodeIndex === targetIndex) break;
    for (const edgeId of graph.adjacency[current.nodeIndex]) {
      if (bannedEdges.has(edgeId)) continue;
      const edge = graph.edges[edgeId];
      if (bannedNodes.has(edge.targetIndex)) continue;
      const candidateCost = current.cost + edge.weight;
      const candidateSignature = `${current.signature}>${edge.linkId}:${edge.direction}>${edge.target}`;
      const oldCost = distance[edge.targetIndex];
      const oldSignature = signatures[edge.targetIndex] ?? '\uffff';
      if (candidateCost < oldCost - EPSILON || (Math.abs(candidateCost - oldCost) <= EPSILON && candidateSignature < oldSignature)) {
        distance[edge.targetIndex] = candidateCost;
        signatures[edge.targetIndex] = candidateSignature;
        previousNode[edge.targetIndex] = current.nodeIndex;
        previousEdge[edge.targetIndex] = edgeId;
        heap.push({ nodeIndex: edge.targetIndex, cost: candidateCost, signature: candidateSignature });
        profile.heapPushes += 1;
      }
    }
  }
  if (previousEdge[targetIndex] < 0) return null;
  const nodeIndexes = [targetIndex];
  const edgeIds: number[] = [];
  let cursor = targetIndex;
  while (cursor !== sourceIndex) {
    const edgeId = previousEdge[cursor];
    const prior = previousNode[cursor];
    if (edgeId < 0 || prior < 0) return null;
    edgeIds.push(edgeId);
    nodeIndexes.push(prior);
    cursor = prior;
  }
  nodeIndexes.reverse();
  edgeIds.reverse();
  if (new Set(nodeIndexes).size !== nodeIndexes.length) return null;
  const nodes = nodeIndexes.map((index) => graph.nodeIds[index]);
  const hops = edgeIds.map((id) => toHop(graph.edges[id]));
  return { nodes, nodeIndexes, hops, edgeIds, cost: round(distance[targetIndex]), signature: pathSignature(nodes, hops), linkSet: new Set(hops.map((hop) => hop.linkId)) };
}

function samePrefix(path: InternalRawPath, prefix: readonly number[]): boolean {
  if (path.nodeIndexes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) if (path.nodeIndexes[i] !== prefix[i]) return false;
  return true;
}

function internalPath(graph: CompiledDesignGraph, nodeIndexes: number[], edgeIds: number[]): InternalRawPath {
  const nodes = nodeIndexes.map((index) => graph.nodeIds[index]);
  const hops = edgeIds.map((id) => toHop(graph.edges[id]));
  const cost = round(edgeIds.reduce((sum, id) => sum + graph.edges[id].weight, 0));
  return { nodes, nodeIndexes, hops, edgeIds, cost, signature: pathSignature(nodes, hops), linkSet: new Set(hops.map((hop) => hop.linkId)) };
}

function yenKShortest(graph: CompiledDesignGraph, source: string, target: string, count: number, signal: AbortSignal | undefined, profile: PathEngineProfile): InternalRawPath[] {
  const sourceIndex = graph.nodeIndexById.get(source) ?? -1;
  const targetIndex = graph.nodeIndexById.get(target) ?? -1;
  const firstStarted = now();
  const first = shortestPath(graph, sourceIndex, targetIndex, new Set(), new Set(), signal, profile);
  profile.firstPathMs += now() - firstStarted;
  if (!first) return [];
  const accepted: InternalRawPath[] = [first];
  const acceptedSignatures = new Set([first.signature]);
  const candidates = new Map<string, InternalRawPath>();
  const candidateHeap = new BinaryMinHeap<CandidateHeapNode>((left, right) => left.path.cost - right.path.cost || left.path.signature.localeCompare(right.path.signature));
  const maxRaw = Math.min(Math.max(count, 1), 24);
  const alternativesStarted = now();
  for (let k = 1; k < maxRaw; k += 1) {
    checkAbort(signal);
    const prior = accepted[k - 1];
    for (let spur = 0; spur < prior.nodeIndexes.length - 1; spur += 1) {
      profile.yenSpurSearches += 1;
      if ((spur & 31) === 0) checkAbort(signal);
      const rootNodeIndexes = prior.nodeIndexes.slice(0, spur + 1);
      const rootEdgeIds = prior.edgeIds.slice(0, spur);
      const bannedEdges = new Set<number>();
      for (const path of accepted) if (samePrefix(path, rootNodeIndexes) && path.edgeIds[spur] !== undefined) bannedEdges.add(path.edgeIds[spur]);
      const bannedNodes = new Set(rootNodeIndexes.slice(0, -1));
      const spurPath = shortestPath(graph, rootNodeIndexes[rootNodeIndexes.length - 1], targetIndex, bannedNodes, bannedEdges, signal, profile);
      if (!spurPath) continue;
      const nodeIndexes = [...rootNodeIndexes.slice(0, -1), ...spurPath.nodeIndexes];
      if (new Set(nodeIndexes).size !== nodeIndexes.length) continue;
      const candidate = internalPath(graph, nodeIndexes, [...rootEdgeIds, ...spurPath.edgeIds]);
      if (acceptedSignatures.has(candidate.signature) || candidates.has(candidate.signature)) continue;
      candidates.set(candidate.signature, candidate);
      candidateHeap.push({ path: candidate });
    }
    let next: InternalRawPath | undefined;
    while (candidateHeap.size) {
      const item = candidateHeap.pop()!.path;
      if (candidates.get(item.signature) !== item) continue;
      candidates.delete(item.signature);
      next = item;
      break;
    }
    if (!next) break;
    accepted.push(next);
    acceptedSignatures.add(next.signature);
  }
  profile.yenAlternativeMs += now() - alternativesStarted;
  return accepted;
}

function chooseDiversePaths(raw: InternalRawPath[], k: number, penalty: number, profile: PathEngineProfile): InternalRawPath[] {
  const started = now();
  try {
    if (raw.length <= k || penalty <= EPSILON) return raw.slice(0, k);
    const selected = [raw[0]];
    const remaining = raw.slice(1);
    const base = Math.max(1e-9, raw[0].cost);
    while (selected.length < k && remaining.length) {
      let bestIndex = 0;
      let bestScore = Number.POSITIVE_INFINITY;
      let bestSignature = '';
      for (let i = 0; i < remaining.length; i += 1) {
        const candidate = remaining[i];
        let overlap = 0;
        for (const prior of selected) {
          let intersection = 0;
          for (const linkId of candidate.linkSet) if (prior.linkSet.has(linkId)) intersection += 1;
          const union = candidate.linkSet.size + prior.linkSet.size - intersection || 1;
          overlap = Math.max(overlap, intersection / union);
        }
        const score = candidate.cost + base * penalty * overlap;
        if (score < bestScore - EPSILON || (Math.abs(score - bestScore) <= EPSILON && candidate.signature < bestSignature)) {
          bestScore = score;
          bestIndex = i;
          bestSignature = candidate.signature;
        }
      }
      selected.push(remaining.splice(bestIndex, 1)[0]);
    }
    return selected;
  } finally {
    profile.diversityMs += now() - started;
  }
}

function routeCacheKey(graph: CompiledDesignGraph, source: string, target: string, options: DesignPathTopologyOptions): string {
  return `${graph.fingerprint}|${source}|${target}|k=${options.maxCandidatePaths}|div=${round(options.diversityPenalty, 9)}`;
}

function approximatePathBytes(paths: readonly InternalRawPath[]): number {
  let bytes = 0;
  for (const path of paths) {
    bytes += path.nodeIndexes.length * 8 + path.edgeIds.length * 8 + approximateStringBytes(path.signature) + 64;
    bytes += path.nodes.reduce((sum, node) => sum + approximateStringBytes(node), 0);
    bytes += path.hops.reduce((sum, hop) => sum + approximateStringBytes(hop.linkId) + 32, 0);
  }
  return bytes;
}

export function generateRoutePaths(
  project: NetworkProject,
  source: string,
  target: string,
  options: DesignPathTopologyOptions,
  profile: PathEngineProfile,
  signal?: AbortSignal,
): PathEngineRawPath[] {
  checkAbort(signal);
  profile.pathGenerationRequests += 1;
  const fingerprint = designTopologyFingerprint(project, options);
  const beforeGraph = graphCache.size;
  const compileStarted = now();
  let graph = graphCache.get(fingerprint);
  if (graph) {
    profile.graphReuses += 1;
  } else {
    graph = compileDesignGraph(project, options, signal);
    profile.graphCompiles += 1;
    profile.graphCompileMs += now() - compileStarted;
  }
  if (graphCache.size !== beforeGraph || profile.graphCompiles > 0) profile.approximateGraphBytes = Math.max(profile.approximateGraphBytes, graph.approximateBytes);
  const key = routeCacheKey(graph, source, target, options);
  const cached = routeCache.get(key);
  if (cached) {
    profile.cacheHits += 1;
    return cached.map(({ nodes, hops, cost }) => ({ nodes, hops, cost }));
  }
  profile.cacheMisses += 1;
  const raw = yenKShortest(graph, source, target, options.maxCandidatePaths * 3, signal, profile);
  const selected = chooseDiversePaths(raw, options.maxCandidatePaths, options.diversityPenalty, profile);
  routeCache.set(key, selected);
  profile.approximatePathCacheBytes += approximatePathBytes(selected);
  return selected.map(({ nodes, hops, cost }) => ({ nodes, hops, cost }));
}

/** Approximate retained bytes of the bounded caches; intended for benchmark diagnostics, not heap accounting. */
export function approximateLevel4PathCacheBytes(): number {
  let bytes = 0;
  for (const [, graph] of graphCache.entries()) bytes += graph.approximateBytes;
  for (const [, paths] of routeCache.entries()) bytes += approximatePathBytes(paths);
  return bytes;
}
