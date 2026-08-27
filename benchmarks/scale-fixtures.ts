import type { NetworkProject } from '../packages/model/src/index.ts';

export type ScaleTierId = 'A' | 'B' | 'C' | 'D' | 'E';
export type ScaleWorkloadVariant = 'concentrated-sources' | 'unique-sources' | 'dense-cross-region' | 'sparse' | 'failure-recompute';

export interface ScaleTier {
  id: ScaleTierId;
  name: string;
  nodes: number;
  links: number;
  demands: number;
  regions: number;
}

export interface GenerateScaleOptions extends ScaleTier {
  seed: number;
  routingMode: 'single-shortest-path' | 'ecmp';
  workload: ScaleWorkloadVariant;
  serviceClassCount?: number;
  sourceConcentration?: number;
  upgradeOptionDensity?: number;
}

export const SCALE_TIERS: ScaleTier[] = [
  { id: 'A', name: 'flagship', nodes: 128, links: 304, demands: 96, regions: 6 },
  { id: 'B', name: 'medium-large', nodes: 250, links: 600, demands: 200, regions: 8 },
  { id: 'C', name: 'large', nodes: 500, links: 1200, demands: 400, regions: 12 },
  { id: 'D', name: 'stress', nodes: 750, links: 1900, demands: 750, regions: 16 },
  { id: 'E', name: 'declared-limit-probe', nodes: 500, links: 2000, demands: 2000, regions: 12 },
];

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicPair(index: number, nodeCount: number, rng: () => number): [number, number] {
  const source = index % nodeCount;
  const span = 1 + Math.floor(rng() * Math.max(1, nodeCount - 1));
  const target = (source + span) % nodeCount;
  return source === target ? [source, (target + 1) % nodeCount] : [source, target];
}

export function generateScaleProject(options: GenerateScaleOptions): NetworkProject {
  const rng = createRng(options.seed);
  const nodes = Array.from({ length: options.nodes }, (_, index) => ({
    id: `n-${String(index).padStart(4, '0')}`,
    name: `Node ${index + 1}`,
    region: `region-${index % options.regions}`,
    type: index % 11 === 0 ? 'core' : index % 5 === 0 ? 'aggregation' : 'edge',
    available: true,
  }));

  const linkKeys = new Set<string>();
  const links: NetworkProject['links'] = [];
  const addLink = (sourceIndex: number, targetIndex: number) => {
    const a = Math.min(sourceIndex, targetIndex);
    const b = Math.max(sourceIndex, targetIndex);
    const key = `${a}:${b}`;
    if (a === b || linkKeys.has(key) || links.length >= options.links) return;
    linkKeys.add(key);
    const index = links.length;
    const upgrades = rng() < (options.upgradeOptionDensity ?? 0.35)
      ? [
          { capacityGbps: 200, cost: 4 + (index % 7) },
          { capacityGbps: 400, cost: 8 + (index % 11) },
        ]
      : undefined;
    links.push({
      id: `l-${String(index).padStart(5, '0')}`,
      source: nodes[sourceIndex].id,
      target: nodes[targetIndex].id,
      bidirectional: true,
      capacityGbps: 100 + (index % 4) * 50,
      latencyMs: 1 + (index % 17),
      weight: 1 + (index % 9),
      available: true,
      ...(upgrades ? { upgradeOptions: upgrades } : {}),
    });
  };

  // Always begin with a connected ring.
  for (let index = 0; index < options.nodes && links.length < options.links; index += 1) addLink(index, (index + 1) % options.nodes);
  // Add deterministic region-crossing chords before pseudo-random chords.
  for (let stride = 2; stride < options.nodes && links.length < options.links; stride += 1) {
    for (let index = 0; index < options.nodes && links.length < options.links; index += 1) {
      if ((index + stride) % options.regions === index % options.regions && stride < options.regions) continue;
      addLink(index, (index + stride) % options.nodes);
    }
  }
  let guard = 0;
  while (links.length < options.links && guard < options.links * 50) {
    const [source, target] = deterministicPair(guard, options.nodes, rng);
    addLink(source, target);
    guard += 1;
  }
  if (links.length !== options.links) throw new Error(`Unable to generate requested deterministic link count ${options.links}; generated ${links.length}.`);

  const serviceClassCount = Math.max(1, Math.min(options.serviceClassCount ?? 3, 16));
  const serviceClasses = Array.from({ length: serviceClassCount }, (_, index) => ({
    id: `class-${index + 1}`,
    name: `Service ${index + 1}`,
    priority: index + 1,
    maxUtilizationPct: 70 + Math.min(index * 5, 20),
    allowShedding: index === serviceClassCount - 1,
  }));

  const sourcePool = Math.max(1, Math.min(options.nodes, options.sourceConcentration ?? Math.max(4, Math.ceil(options.nodes * 0.08))));
  const demands = Array.from({ length: options.demands }, (_, index) => {
    let sourceIndex: number;
    let targetIndex: number;
    if (options.workload === 'unique-sources') {
      sourceIndex = index % options.nodes;
      targetIndex = (sourceIndex + 1 + Math.floor(rng() * Math.max(1, options.nodes - 1))) % options.nodes;
    } else if (options.workload === 'dense-cross-region') {
      sourceIndex = index % options.nodes;
      const sourceRegion = sourceIndex % options.regions;
      let candidate = (sourceIndex + Math.floor(options.nodes / 2) + index * 7) % options.nodes;
      if (candidate % options.regions === sourceRegion) candidate = (candidate + 1) % options.nodes;
      targetIndex = candidate;
    } else if (options.workload === 'sparse') {
      sourceIndex = (index * 17) % options.nodes;
      targetIndex = (sourceIndex + 1 + (index % Math.max(2, Math.floor(options.nodes / 12)))) % options.nodes;
    } else {
      sourceIndex = index % sourcePool;
      targetIndex = (sourceIndex + 1 + Math.floor(rng() * Math.max(1, options.nodes - 1))) % options.nodes;
    }
    if (sourceIndex === targetIndex) targetIndex = (targetIndex + 1) % options.nodes;
    return {
      id: `d-${String(index).padStart(5, '0')}`,
      name: `Demand ${index + 1}`,
      source: nodes[sourceIndex].id,
      target: nodes[targetIndex].id,
      bandwidthGbps: 0.5 + (index % 13) * 0.25,
      serviceClassId: serviceClasses[index % serviceClasses.length].id,
    };
  });

  return {
    schemaVersion: '0.1',
    id: `scale-${options.id.toLowerCase()}-${options.workload}-${options.routingMode}`,
    name: `Scale ${options.id} ${options.name}`,
    nodes,
    links,
    demands,
    serviceClasses,
    routingProfile: { mode: options.routingMode },
    metadata: {
      benchmark: true,
      scaleTier: options.id,
      seed: options.seed,
      workload: options.workload,
      generatedCounts: { nodes: options.nodes, links: options.links, demands: options.demands, regions: options.regions },
    },
  };
}
