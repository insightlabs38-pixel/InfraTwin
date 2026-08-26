import type { NetworkProject, ScenarioPatch } from '../../model/src/index.ts';
import { cloneProject } from '../../model/src/index.ts';

export type BundledScenarioId = 'maintenance-trap' | 'growth-wall' | 'resilience-gap' | 'blank';
export type ScenarioKind = 'maintenance' | 'growth' | 'resilience' | 'blank';

export interface ScenarioDefinition {
  id: BundledScenarioId;
  title: string;
  kind: ScenarioKind;
  description: string;
  suggestedPrompt: string;
  project: NetworkProject;
  recommendedPatch?: ScenarioPatch;
  growthDemandIds?: string[];
  defaultGrowthMultiplier?: number;
}

const serviceClasses = [
  { id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 80, allowShedding: false },
  { id: 'silver', name: 'Silver', priority: 50, maxUtilizationPct: 90, allowShedding: false },
];

const maintenanceTrap: NetworkProject = {
  schemaVersion: '0.1',
  id: 'maintenance-trap-l1',
  name: 'Maintenance Trap',
  nodes: [
    { id: 'CHI', name: 'Chicago', region: 'central', type: 'core', available: true, x: 105, y: 120 },
    { id: 'DAL', name: 'Dallas', region: 'south', type: 'core', available: true, x: 325, y: 120 },
    { id: 'NYC', name: 'New York', region: 'east', type: 'core', available: true, x: 555, y: 120 },
    { id: 'DEN', name: 'Denver', region: 'west', type: 'core', available: true, x: 105, y: 340 },
    { id: 'ATL', name: 'Atlanta', region: 'south-east', type: 'core', available: true, x: 325, y: 340 },
  ],
  links: [
    { id: 'L1', source: 'CHI', target: 'DAL', bidirectional: true, capacityGbps: 20, latencyMs: 18, weight: 1, available: true },
    { id: 'L2', source: 'CHI', target: 'DEN', bidirectional: true, capacityGbps: 20, latencyMs: 21, weight: 1, available: true },
    { id: 'L3', source: 'DEN', target: 'ATL', bidirectional: true, capacityGbps: 10, latencyMs: 24, weight: 1, available: true, upgradeOptions: [{ capacityGbps: 15, cost: 5 }, { capacityGbps: 20, cost: 8 }] },
    { id: 'L4', source: 'ATL', target: 'DAL', bidirectional: true, capacityGbps: 10, latencyMs: 15, weight: 1, available: true },
    { id: 'L5', source: 'DAL', target: 'NYC', bidirectional: true, capacityGbps: 20, latencyMs: 22, weight: 1, available: true },
    { id: 'L6', source: 'ATL', target: 'NYC', bidirectional: true, capacityGbps: 20, latencyMs: 19, weight: 1, available: true },
  ],
  demands: [
    { id: 'D1', name: 'Checkout replication', source: 'CHI', target: 'NYC', bandwidthGbps: 8, serviceClassId: 'gold' },
    { id: 'D2', name: 'Dallas API traffic', source: 'DAL', target: 'NYC', bandwidthGbps: 6, serviceClassId: 'silver' },
    { id: 'D3', name: 'Denver analytics', source: 'DEN', target: 'NYC', bandwidthGbps: 4, serviceClassId: 'silver' },
  ],
  serviceClasses,
  routingProfile: { mode: 'ecmp' },
  metadata: {
    description: 'Healthy baseline. Taking CHI–DAL out for maintenance reroutes gold traffic through DEN–ATL and overloads the hidden L3 bottleneck.',
    suggestedPrompt: 'Can I take the Chicago–Dallas link down for maintenance without violating critical-service constraints? Don’t apply any changes.',
  },
};

const maintenancePatch: ScenarioPatch = {
  id: 'maintenance-chi-dal',
  name: 'CHI–DAL maintenance',
  disabledNodeIds: [],
  disabledLinkIds: ['L1'],
  demandMultipliers: [],
  addedDemands: [],
  linkCapacityOverrides: [],
};

const growthWall: NetworkProject = {
  schemaVersion: '0.1',
  id: 'growth-wall-l1',
  name: 'Growth Wall',
  nodes: [
    { id: 'NYC', name: 'New York', region: 'east', type: 'edge', available: true, x: 90, y: 170 },
    { id: 'CHI', name: 'Chicago', region: 'central', type: 'core', available: true, x: 250, y: 170 },
    { id: 'DEN', name: 'Denver', region: 'mountain', type: 'core', available: true, x: 410, y: 170 },
    { id: 'SEA', name: 'Seattle', region: 'west', type: 'edge', available: true, x: 575, y: 170 },
    { id: 'ATL', name: 'Atlanta', region: 'south-east', type: 'edge', available: true, x: 250, y: 350 },
  ],
  links: [
    { id: 'G1', source: 'NYC', target: 'CHI', bidirectional: true, capacityGbps: 30, weight: 1, available: true },
    { id: 'G2', source: 'CHI', target: 'DEN', bidirectional: true, capacityGbps: 20, weight: 1, available: true, upgradeOptions: [{ capacityGbps: 22, cost: 6 }, { capacityGbps: 25, cost: 9 }, { capacityGbps: 30, cost: 14 }] },
    { id: 'G3', source: 'DEN', target: 'SEA', bidirectional: true, capacityGbps: 30, weight: 1, available: true },
    { id: 'G4', source: 'ATL', target: 'CHI', bidirectional: true, capacityGbps: 20, weight: 1, available: true },
    { id: 'G5', source: 'ATL', target: 'DEN', bidirectional: true, capacityGbps: 18, weight: 1.5, available: true },
  ],
  demands: [
    { id: 'GD1', name: 'East–west checkout', source: 'NYC', target: 'SEA', bandwidthGbps: 8, serviceClassId: 'gold' },
    { id: 'GD2', name: 'Central replication', source: 'CHI', target: 'SEA', bandwidthGbps: 4, serviceClassId: 'silver' },
    { id: 'GD3', name: 'Atlanta batch', source: 'ATL', target: 'DEN', bandwidthGbps: 3, serviceClassId: 'silver' },
  ],
  serviceClasses,
  routingProfile: { mode: 'ecmp' },
  metadata: {
    description: 'The east–west core runs at 60% today. Coordinated forecast growth crosses the gold 80% planning target before +40%.',
    suggestedPrompt: 'If east-to-west demand grows 40%, what becomes the first bottleneck, and what is the cheapest upgrade plan that keeps at least 20% headroom?',
  },
};

const resilienceGap: NetworkProject = {
  schemaVersion: '0.1',
  id: 'resilience-gap-l1',
  name: 'Resilience Gap',
  nodes: [
    { id: 'NYC', name: 'New York', region: 'east', type: 'edge', available: true, x: 80, y: 210 },
    { id: 'CHI', name: 'Chicago', region: 'central', type: 'core', available: true, x: 270, y: 95 },
    { id: 'ATL', name: 'Atlanta', region: 'south-east', type: 'core', available: true, x: 270, y: 330 },
    { id: 'DAL', name: 'Dallas', region: 'south', type: 'core', available: true, x: 450, y: 330 },
    { id: 'SEA', name: 'Seattle', region: 'west', type: 'edge', available: true, x: 610, y: 190 },
  ],
  links: [
    { id: 'R1', source: 'NYC', target: 'CHI', bidirectional: true, capacityGbps: 12, weight: 1, available: true },
    { id: 'R1B', source: 'NYC', target: 'CHI', bidirectional: true, capacityGbps: 12, weight: 1.2, available: true },
    { id: 'R2', source: 'CHI', target: 'SEA', bidirectional: true, capacityGbps: 12, weight: 1, available: true },
    { id: 'R3', source: 'NYC', target: 'ATL', bidirectional: true, capacityGbps: 20, weight: 1, available: true },
    { id: 'R4', source: 'ATL', target: 'DAL', bidirectional: true, capacityGbps: 10, weight: 1, available: true, upgradeOptions: [{ capacityGbps: 14, cost: 4 }, { capacityGbps: 18, cost: 7 }] },
    { id: 'R5', source: 'DAL', target: 'SEA', bidirectional: true, capacityGbps: 10, weight: 1, available: true, upgradeOptions: [{ capacityGbps: 14, cost: 4 }, { capacityGbps: 18, cost: 7 }] },
    { id: 'R6', source: 'CHI', target: 'DAL', bidirectional: true, capacityGbps: 20, weight: 1.5, available: true },
  ],
  demands: [
    { id: 'RD1', name: 'Premium east–west', source: 'NYC', target: 'SEA', bandwidthGbps: 7, serviceClassId: 'gold' },
    { id: 'RD2', name: 'Southern API', source: 'ATL', target: 'SEA', bandwidthGbps: 4, serviceClassId: 'silver' },
  ],
  serviceClasses,
  routingProfile: { mode: 'ecmp' },
  metadata: {
    description: 'The topology looks redundant, but failure of CHI–SEA reroutes premium traffic onto a 10 Gbps southern corridor and overloads both links.',
    suggestedPrompt: 'Find the worst single-link failure and tell me exactly what it breaks. Then propose the cheapest mitigation, but don’t apply it.',
  },
};

const blank: NetworkProject = {
  schemaVersion: '0.1',
  id: 'blank-project',
  name: 'Blank Network',
  nodes: [],
  links: [],
  demands: [],
  serviceClasses: [],
  routingProfile: { mode: 'ecmp' },
  metadata: { description: 'A valid empty project for manual import or construction.', suggestedPrompt: 'Import a project JSON file to begin.' },
};

const definitions: Record<BundledScenarioId, ScenarioDefinition> = {
  'maintenance-trap': {
    id: 'maintenance-trap', title: 'Maintenance Trap', kind: 'maintenance',
    description: String(maintenanceTrap.metadata?.description ?? ''),
    suggestedPrompt: String(maintenanceTrap.metadata?.suggestedPrompt ?? ''),
    project: maintenanceTrap,
    recommendedPatch: maintenancePatch,
  },
  'growth-wall': {
    id: 'growth-wall', title: 'Growth Wall', kind: 'growth',
    description: String(growthWall.metadata?.description ?? ''),
    suggestedPrompt: String(growthWall.metadata?.suggestedPrompt ?? ''),
    project: growthWall,
    growthDemandIds: ['GD1', 'GD2'],
    defaultGrowthMultiplier: 1.4,
  },
  'resilience-gap': {
    id: 'resilience-gap', title: 'Resilience Gap', kind: 'resilience',
    description: String(resilienceGap.metadata?.description ?? ''),
    suggestedPrompt: String(resilienceGap.metadata?.suggestedPrompt ?? ''),
    project: resilienceGap,
  },
  blank: {
    id: 'blank', title: 'Start Blank', kind: 'blank',
    description: String(blank.metadata?.description ?? ''),
    suggestedPrompt: String(blank.metadata?.suggestedPrompt ?? ''),
    project: blank,
  },
};

export function listBundledScenarios(): ScenarioDefinition[] {
  return (['maintenance-trap', 'growth-wall', 'resilience-gap', 'blank'] as BundledScenarioId[]).map((id) => ({ ...definitions[id], project: cloneProject(definitions[id].project) }));
}

export function getScenarioDefinition(id: BundledScenarioId): ScenarioDefinition {
  const definition = definitions[id];
  return { ...definition, project: cloneProject(definition.project), recommendedPatch: definition.recommendedPatch ? JSON.parse(JSON.stringify(definition.recommendedPatch)) as ScenarioPatch : undefined };
}

export function loadScenario(id: BundledScenarioId): NetworkProject {
  return cloneProject(definitions[id].project);
}

export function loadMaintenanceTrap(): NetworkProject { return loadScenario('maintenance-trap'); }
export function loadGrowthWall(): NetworkProject { return loadScenario('growth-wall'); }
export function loadResilienceGap(): NetworkProject { return loadScenario('resilience-gap'); }
export function createBlankProject(): NetworkProject { return loadScenario('blank'); }
