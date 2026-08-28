import type { ChangePlan, LinkModel, NetworkProject, NodeModel, PlanChange, ScenarioPatch } from '../../model/src/index.ts';
import { addPlanChange, cloneProject, createChangePlan, setPlanConstraint, setPlanLinkLocked } from '../../model/src/index.ts';
import { generateScaleProject } from './scale-generator.ts';

export type BundledScenarioId = 'continental-service-network' | 'national-backbone-scale-test' | 'maintenance-trap' | 'growth-wall' | 'resilience-gap' | 'blank';
export type ScenarioKind = 'flagship' | 'scale' | 'maintenance' | 'growth' | 'resilience' | 'blank';

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
  changePlanTemplate?: ChangePlan;
}

const serviceClasses = [
  { id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 80, allowShedding: false },
  { id: 'silver', name: 'Silver', priority: 50, maxUtilizationPct: 90, allowShedding: false },
];

const flagshipServiceClasses = [
  { id: 'gold', name: 'Gold interactive', priority: 100, maxUtilizationPct: 80, allowShedding: false },
  { id: 'silver', name: 'Silver platform', priority: 60, maxUtilizationPct: 90, allowShedding: false },
  { id: 'bronze', name: 'Bronze batch', priority: 20, maxUtilizationPct: 95, allowShedding: true },
];

const TEMPLATE_TIME = '2026-01-01T00:00:00.000Z';

interface FlagshipRegionSpec {
  id: string;
  name: string;
  cities: Array<{ code: string; name: string }>;
  edgeCount: number;
}

const FLAGSHIP_REGIONS: FlagshipRegionSpec[] = [
  { id: 'Northeast', name: 'Northeast', edgeCount: 18, cities: [{ code: 'NYC', name: 'New York' }, { code: 'BOS', name: 'Boston' }, { code: 'PHL', name: 'Philadelphia' }, { code: 'PIT', name: 'Pittsburgh' }] },
  { id: 'Southeast', name: 'Southeast', edgeCount: 18, cities: [{ code: 'ATL', name: 'Atlanta' }, { code: 'CLT', name: 'Charlotte' }, { code: 'MIA', name: 'Miami' }, { code: 'RDU', name: 'Raleigh' }] },
  { id: 'Central', name: 'Central', edgeCount: 17, cities: [{ code: 'CHI', name: 'Chicago' }, { code: 'STL', name: 'St. Louis' }, { code: 'MSP', name: 'Minneapolis' }, { code: 'KC', name: 'Kansas City' }] },
  { id: 'Mountain', name: 'Mountain', edgeCount: 17, cities: [{ code: 'DEN', name: 'Denver' }, { code: 'SLC', name: 'Salt Lake City' }, { code: 'PHX', name: 'Phoenix' }, { code: 'ABQ', name: 'Albuquerque' }] },
  { id: 'West', name: 'West', edgeCount: 17, cities: [{ code: 'SEA', name: 'Seattle' }, { code: 'SFO', name: 'San Francisco' }, { code: 'LAX', name: 'Los Angeles' }, { code: 'PDX', name: 'Portland' }] },
  { id: 'Cloud', name: 'Cloud', edgeCount: 17, cities: [{ code: 'IAD', name: 'Ashburn Cloud' }, { code: 'DFW', name: 'Dallas Cloud' }, { code: 'ORD', name: 'Chicago Cloud' }, { code: 'SJC', name: 'San Jose Cloud' }] },
];


function buildFlagshipProject(): NetworkProject {
  const nodes: NodeModel[] = [];
  const regionNodes = new Map<string, { cores: NodeModel[]; edges: NodeModel[] }>();

  for (const region of FLAGSHIP_REGIONS) {
    const cores = region.cities.map((city) => ({ id: `${city.code}-CORE-1`, name: `${city.name} Core`, region: region.name, type: 'core', available: true }));
    const edges: NodeModel[] = [];
    for (let index = 0; index < region.edgeCount; index += 1) {
      const city = region.cities[index % region.cities.length];
      edges.push({ id: `${city.code}-EDGE-${String(index + 1).padStart(2, '0')}`, name: `${city.name} Edge ${index + 1}`, region: region.name, type: 'edge', available: true });
    }
    nodes.push(...cores, ...edges);
    regionNodes.set(region.id, { cores, edges });
  }

  const links: LinkModel[] = [];
  for (const region of FLAGSHIP_REGIONS) {
    const group = regionNodes.get(region.id)!;
    for (let left = 0; left < group.cores.length; left += 1) {
      for (let right = left + 1; right < group.cores.length; right += 1) {
        links.push({
          id: `INTRA-${region.id.slice(0, 2).toUpperCase()}-${left + 1}-${right + 1}`,
          source: group.cores[left].id,
          target: group.cores[right].id,
          bidirectional: true,
          capacityGbps: 160,
          weight: 0.12 + (right - left) * 0.01,
          available: true,
        });
      }
    }
    group.edges.forEach((edge, index) => {
      const primary = group.cores[index % group.cores.length];
      const backup = group.cores[(index + 1 + (index % 2)) % group.cores.length];
      const baseCapacity = 40 + (index % 3) * 20;
      links.push({ id: `ACCESS-${edge.id}-A`, source: edge.id, target: primary.id, bidirectional: true, capacityGbps: baseCapacity, weight: 0.2, available: true });
      links.push({ id: `ACCESS-${edge.id}-B`, source: edge.id, target: backup.id, bidirectional: true, capacityGbps: baseCapacity, weight: 0.38, available: true });
    });
  }

  const crossPairs: Array<{ a: string; b: string; count: number; primaryWeight: number; primaryCapacity: number }> = [
    { a: 'Northeast', b: 'Southeast', count: 6, primaryWeight: 1.05, primaryCapacity: 180 },
    { a: 'Southeast', b: 'Central', count: 6, primaryWeight: 1.05, primaryCapacity: 80 },
    { a: 'Central', b: 'Mountain', count: 6, primaryWeight: 1.0, primaryCapacity: 200 },
    { a: 'Mountain', b: 'West', count: 6, primaryWeight: 1.0, primaryCapacity: 200 },
    { a: 'West', b: 'Cloud', count: 6, primaryWeight: 1.0, primaryCapacity: 220 },
    { a: 'Cloud', b: 'Northeast', count: 6, primaryWeight: 1.1, primaryCapacity: 220 },
    { a: 'Northeast', b: 'Central', count: 4, primaryWeight: 0.85, primaryCapacity: 100 },
    { a: 'Southeast', b: 'Mountain', count: 4, primaryWeight: 1.15, primaryCapacity: 200 },
    { a: 'Central', b: 'West', count: 4, primaryWeight: 1.15, primaryCapacity: 200 },
    { a: 'Mountain', b: 'Cloud', count: 4, primaryWeight: 1.2, primaryCapacity: 220 },
    { a: 'Northeast', b: 'West', count: 4, primaryWeight: 1.25, primaryCapacity: 220 },
    { a: 'Southeast', b: 'Cloud', count: 4, primaryWeight: 1.25, primaryCapacity: 220 },
  ];
  const endpointPairs = [[0, 0], [1, 1], [2, 2], [3, 3], [0, 2], [2, 0]] as const;
  const pairCode = (value: string) => value === 'Northeast' ? 'NE' : value === 'Southeast' ? 'SE' : value === 'Central' ? 'CE' : value === 'Mountain' ? 'MT' : value === 'West' ? 'WE' : 'CL';

  for (const pair of crossPairs) {
    const left = regionNodes.get(pair.a)!.cores;
    const right = regionNodes.get(pair.b)!.cores;
    for (let index = 0; index < pair.count; index += 1) {
      const [leftIndex, rightIndex] = endpointPairs[index];
      const id = `BB-${pairCode(pair.a)}-${pairCode(pair.b)}-${String(index + 1).padStart(2, '0')}`;
      const primary = index === 0;
      const capacityGbps = primary ? pair.primaryCapacity : 140 + (index % 3) * 40;
      const link: LinkModel = {
        id,
        source: left[leftIndex].id,
        target: right[rightIndex].id,
        bidirectional: true,
        capacityGbps,
        weight: primary ? pair.primaryWeight : 3.3 + index * 0.22,
        available: true,
      };
      if (id === 'BB-SE-CE-01') link.upgradeOptions = [{ capacityGbps: 120, cost: 5 }, { capacityGbps: 160, cost: 8 }, { capacityGbps: 240, cost: 12 }];
      else if (id === 'BB-NE-CE-01') link.upgradeOptions = [{ capacityGbps: 160, cost: 5 }, { capacityGbps: 240, cost: 9 }];
      else if (primary && pair.primaryCapacity <= 200) link.upgradeOptions = [{ capacityGbps: Math.max(240, pair.primaryCapacity + 80), cost: 7 }];
      links.push(link);
    }
  }

  const demands: NetworkProject['demands'] = [];
  const neEdges = regionNodes.get('Northeast')!.edges;
  const seEdges = regionNodes.get('Southeast')!.edges;
  const ceEdges = regionNodes.get('Central')!.edges;
  for (let index = 0; index < 10; index += 1) {
    demands.push({ id: `PAY-NECE-${String(index + 1).padStart(2, '0')}`, name: `Payments east-central ${index + 1}`, source: neEdges[index].id, target: ceEdges[index].id, bandwidthGbps: 4, serviceClassId: 'gold' });
  }
  for (let index = 0; index < 5; index += 1) {
    demands.push({ id: `PLAT-SECE-${String(index + 1).padStart(2, '0')}`, name: `Southeast platform ${index + 1}`, source: seEdges[index].id, target: ceEdges[index + 10].id, bandwidthGbps: 4, serviceClassId: index < 2 ? 'gold' : 'silver' });
  }

  const safePairs: Array<[string, string]> = [
    ['Central', 'Mountain'], ['Mountain', 'West'], ['West', 'Cloud'], ['Cloud', 'Northeast'], ['Southeast', 'Mountain'],
    ['Central', 'West'], ['Mountain', 'Cloud'], ['Northeast', 'West'], ['Southeast', 'Cloud'], ['Northeast', 'Southeast'],
  ];
  const bandwidths = [0.75, 1.25, 1.75, 2.25, 3];
  const classes = ['gold', 'silver', 'bronze'];
  for (let index = 0; index < 81; index += 1) {
    const [sourceRegion, targetRegion] = safePairs[index % safePairs.length];
    const sourceEdges = regionNodes.get(sourceRegion)!.edges;
    const targetEdges = regionNodes.get(targetRegion)!.edges;
    demands.push({
      id: `FLOW-${String(index + 1).padStart(3, '0')}`,
      name: `${sourceRegion} to ${targetRegion} service ${index + 1}`,
      source: sourceEdges[(index * 3 + 1) % sourceEdges.length].id,
      target: targetEdges[(index * 5 + 2) % targetEdges.length].id,
      bandwidthGbps: bandwidths[index % bandwidths.length],
      serviceClassId: classes[index % classes.length],
    });
  }

  return {
    schemaVersion: '0.1',
    id: 'continental-service-network-v1',
    name: 'Continental Service Network',
    nodes,
    links,
    demands,
    serviceClasses: flagshipServiceClasses,
    routingProfile: { mode: 'single-shortest-path' },
    metadata: {
      description: 'Realistic synthetic network planning model with six logical regions, dual-homed edge sites, redundant regional cores, and a multi-corridor backbone.',
      suggestedPrompt: 'Open Saturday Backbone Maintenance, inspect the distant Southeast–Central overload, and evaluate an upgrade without changing the base network.',
      realisticSynthetic: true,
      topologyScale: { nodes: 128, links: 304, demands: 96, regions: 6 },
    },
  };
}

const continentalServiceNetwork = buildFlagshipProject();

const nationalBackboneScaleTest = generateScaleProject({
  id: 'C',
  name: 'national-backbone-scale-test',
  nodes: 500,
  links: 1200,
  demands: 400,
  regions: 12,
  seed: 3553,
  routingMode: 'single-shortest-path',
  workload: 'concentrated-sources',
  sourceConcentration: 30,
  serviceClassCount: 3,
  upgradeOptionDensity: 0.4,
});
nationalBackboneScaleTest.id = 'national-backbone-scale-test-v1';
nationalBackboneScaleTest.name = 'National Backbone Scale Test';
nationalBackboneScaleTest.metadata = {
  ...(nationalBackboneScaleTest.metadata ?? {}),
  description: 'Deterministic 500-node / 1,200-link / 400-demand synthetic backbone used to demonstrate browser-scale deterministic analysis and workspace responsiveness.',
  suggestedPrompt: 'Inspect this scale-proof network, run deterministic Change Plan analysis, and use Compute Profile to understand which operations are interactive, bounded, or not recommended.',
  realisticSynthetic: true,
  scaleProof: true,
};

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
  metadata: { description: 'A valid empty project for manual import or construction.', suggestedPrompt: 'Import a project JSON or CSV bundle to begin.' },
};

function buildPlanTemplate(project: NetworkProject, id: string, name: string, changes: PlanChange[]): ChangePlan {
  let plan = createChangePlan(project, name, { id, now: TEMPLATE_TIME });
  for (const change of changes) plan = addPlanChange(plan, change, TEMPLATE_TIME);
  plan.status = 'draft';
  return plan;
}

const flagshipGrowthDemandIds = Array.from({ length: 10 }, (_, index) => `PAY-NECE-${String(index + 1).padStart(2, '0')}`);
let flagshipPlanTemplate = buildPlanTemplate(continentalServiceNetwork, 'template-saturday-backbone-maintenance', 'Saturday Backbone Maintenance', [
  { id: 'template-change-flagship-outage', actor: 'human', type: 'disable_link', target: { kind: 'link', id: 'BB-NE-CE-01' }, payload: {}, createdAt: TEMPLATE_TIME },
  { id: 'template-change-flagship-growth', actor: 'human', type: 'demand_growth', target: { kind: 'demands', ids: flagshipGrowthDemandIds }, payload: { multiplier: 1.35 }, createdAt: TEMPLATE_TIME },
]);
flagshipPlanTemplate = setPlanConstraint(flagshipPlanTemplate, 'targetUtilizationPct', 80, TEMPLATE_TIME);
flagshipPlanTemplate = setPlanConstraint(flagshipPlanTemplate, 'budgetCostUnits', 12, TEMPLATE_TIME);
flagshipPlanTemplate = setPlanLinkLocked(flagshipPlanTemplate, 'BB-SE-CE-02', true, TEMPLATE_TIME);
flagshipPlanTemplate.status = 'draft';

const maintenancePlanTemplate = buildPlanTemplate(maintenanceTrap, 'template-maintenance-chi-dal', 'CHI–DAL maintenance', [
  { id: 'template-change-maintenance-l1', actor: 'human', type: 'disable_link', target: { kind: 'link', id: 'L1' }, payload: {}, createdAt: TEMPLATE_TIME },
]);

const growthPlanTemplate = buildPlanTemplate(growthWall, 'template-growth-40', 'East–west +40% growth', [
  { id: 'template-change-growth-40', actor: 'human', type: 'demand_growth', target: { kind: 'demands', ids: ['GD1', 'GD2'] }, payload: { multiplier: 1.4 }, createdAt: TEMPLATE_TIME },
]);

const resiliencePlanTemplate = buildPlanTemplate(resilienceGap, 'template-resilience-r2', 'CHI–SEA failure replay', [
  { id: 'template-change-resilience-r2', actor: 'human', type: 'disable_link', target: { kind: 'link', id: 'R2' }, payload: {}, createdAt: TEMPLATE_TIME },
]);

const definitions: Record<BundledScenarioId, ScenarioDefinition> = {
  'continental-service-network': {
    id: 'continental-service-network', title: 'Continental Service Network', kind: 'flagship',
    description: String(continentalServiceNetwork.metadata?.description ?? ''),
    suggestedPrompt: String(continentalServiceNetwork.metadata?.suggestedPrompt ?? ''),
    project: continentalServiceNetwork,
    growthDemandIds: flagshipGrowthDemandIds,
    defaultGrowthMultiplier: 1.35,
    changePlanTemplate: flagshipPlanTemplate,
  },
  'national-backbone-scale-test': {
    id: 'national-backbone-scale-test', title: 'National Backbone Scale Test', kind: 'scale',
    description: String(nationalBackboneScaleTest.metadata?.description ?? ''),
    suggestedPrompt: String(nationalBackboneScaleTest.metadata?.suggestedPrompt ?? ''),
    project: nationalBackboneScaleTest,
  },
  'maintenance-trap': {
    id: 'maintenance-trap', title: 'Maintenance Trap', kind: 'maintenance',
    description: String(maintenanceTrap.metadata?.description ?? ''),
    suggestedPrompt: String(maintenanceTrap.metadata?.suggestedPrompt ?? ''),
    project: maintenanceTrap,
    recommendedPatch: maintenancePatch,
    changePlanTemplate: maintenancePlanTemplate,
  },
  'growth-wall': {
    id: 'growth-wall', title: 'Growth Wall', kind: 'growth',
    description: String(growthWall.metadata?.description ?? ''),
    suggestedPrompt: String(growthWall.metadata?.suggestedPrompt ?? ''),
    project: growthWall,
    growthDemandIds: ['GD1', 'GD2'],
    defaultGrowthMultiplier: 1.4,
    changePlanTemplate: growthPlanTemplate,
  },
  'resilience-gap': {
    id: 'resilience-gap', title: 'Resilience Gap', kind: 'resilience',
    description: String(resilienceGap.metadata?.description ?? ''),
    suggestedPrompt: String(resilienceGap.metadata?.suggestedPrompt ?? ''),
    project: resilienceGap,
    changePlanTemplate: resiliencePlanTemplate,
  },
  blank: {
    id: 'blank', title: 'Start Blank', kind: 'blank',
    description: String(blank.metadata?.description ?? ''),
    suggestedPrompt: String(blank.metadata?.suggestedPrompt ?? ''),
    project: blank,
  },
};

function copyDefinition(definition: ScenarioDefinition): ScenarioDefinition {
  return {
    ...definition,
    project: cloneProject(definition.project),
    recommendedPatch: definition.recommendedPatch ? JSON.parse(JSON.stringify(definition.recommendedPatch)) as ScenarioPatch : undefined,
    changePlanTemplate: definition.changePlanTemplate ? JSON.parse(JSON.stringify(definition.changePlanTemplate)) as ChangePlan : undefined,
  };
}

export function listBundledScenarios(): ScenarioDefinition[] {
  return (['continental-service-network', 'national-backbone-scale-test', 'maintenance-trap', 'growth-wall', 'resilience-gap', 'blank'] as BundledScenarioId[]).map((id) => copyDefinition(definitions[id]));
}

export function getScenarioDefinition(id: BundledScenarioId): ScenarioDefinition {
  return copyDefinition(definitions[id]);
}

export function loadScenario(id: BundledScenarioId): NetworkProject {
  return cloneProject(definitions[id].project);
}

export function loadFlagshipNetwork(): NetworkProject { return loadScenario('continental-service-network'); }
export function loadNationalBackboneScaleTest(): NetworkProject { return loadScenario('national-backbone-scale-test'); }
export function loadMaintenanceTrap(): NetworkProject { return loadScenario('maintenance-trap'); }
export function loadGrowthWall(): NetworkProject { return loadScenario('growth-wall'); }
export function loadResilienceGap(): NetworkProject { return loadScenario('resilience-gap'); }
export function createBlankProject(): NetworkProject { return loadScenario('blank'); }
