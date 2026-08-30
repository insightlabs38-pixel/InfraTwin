import type { NetworkProject, ScenarioPatch } from '../../model/src/index.ts';

const classes = [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 80, allowShedding: false }];

export function createLevel4ReplanReference(): NetworkProject {
  return {
    schemaVersion: '0.1', id: 'level4a-replan-reference', name: 'Level 4A Lock and Replan Reference',
    nodes: [
      { id: 'A', name: 'Ingress', region: 'west', type: 'core', available: true },
      { id: 'B', name: 'Primary Hub', region: 'central', type: 'core', available: true },
      { id: 'C', name: 'Alternate Hub', region: 'south', type: 'core', available: true },
      { id: 'D', name: 'Egress', region: 'east', type: 'core', available: true },
    ],
    links: [
      { id: 'X', source: 'A', target: 'B', bidirectional: true, capacityGbps: 10, weight: 1, available: true, upgradeOptions: [{ capacityGbps: 15, cost: 5 }] },
      { id: 'BD', source: 'B', target: 'D', bidirectional: true, capacityGbps: 20, weight: 1, available: true },
      { id: 'AC', source: 'A', target: 'C', bidirectional: true, capacityGbps: 20, weight: 2, available: true },
      { id: 'Y', source: 'C', target: 'D', bidirectional: true, capacityGbps: 2, weight: 2, available: true, upgradeOptions: [{ capacityGbps: 5, cost: 8 }, { capacityGbps: 8, cost: 12 }, { capacityGbps: 12, cost: 16 }] },
    ],
    demands: [{ id: 'D1', name: 'Reference traffic', source: 'A', target: 'D', bandwidthGbps: 12, serviceClassId: 'gold' }],
    serviceClasses: classes.map((item) => ({ ...item })), routingProfile: { mode: 'single-shortest-path' },
    metadata: { level4Reference: 'lock-replan', expectedCapacityOnlyCost: 5, expectedLockedAdaptiveCost: 8 },
  };
}

export function createLevel4NewLinkReference(): NetworkProject {
  return {
    schemaVersion: '0.1', id: 'level4a-new-link-reference', name: 'Level 4A Declared New Link Reference',
    nodes: [{ id: 'A', name: 'A' },{id:'B',name:'B'},{id:'C',name:'C'}],
    links: [
      { id:'AB',source:'A',target:'B',bidirectional:true,capacityGbps:6,weight:1,available:true,upgradeOptions:[{capacityGbps:13,cost:9}] },
      { id:'BC',source:'B',target:'C',bidirectional:true,capacityGbps:6,weight:1,available:true,upgradeOptions:[{capacityGbps:13,cost:9}] },
    ],
    demands:[{ id:'D1',name:'A to C',source:'A',target:'C',bandwidthGbps:10,serviceClassId:'gold' }],
    serviceClasses: classes.map((item)=>({...item})), routingProfile:{mode:'single-shortest-path'},
    metadata:{level4Reference:'new-link',expectedUpgradeOnlyCost:18,expectedCandidateLinkCost:11},
  };
}

export const level4NewLinkCandidate = { id:'AC-DIRECT',source:'A',target:'C',bidirectional:true,capacityGbps:12,weight:3,cost:11 } as const;

export function createLevel4ScenarioReference(): NetworkProject {
  return {
    schemaVersion:'0.1',id:'level4a-scenario-reference',name:'Level 4A Scenario-aware Reference',
    nodes:[{id:'A',name:'A'},{id:'B',name:'B'},{id:'C',name:'C'},{id:'D',name:'D'}],
    links:[
      { id:'AB',source:'A',target:'B',bidirectional:true,capacityGbps:10,weight:1,available:true },
      { id:'BD',source:'B',target:'D',bidirectional:true,capacityGbps:10,weight:1,available:true },
      { id:'AC',source:'A',target:'C',bidirectional:true,capacityGbps:5,weight:2,available:true,upgradeOptions:[{capacityGbps:15,cost:6}] },
      { id:'CD',source:'C',target:'D',bidirectional:true,capacityGbps:5,weight:2,available:true,upgradeOptions:[{capacityGbps:15,cost:6}] },
    ],
    demands:[{id:'D1',name:'Resilient demand',source:'A',target:'D',bandwidthGbps:12,serviceClassId:'gold'}],
    serviceClasses:classes.map(item=>({...item})),routingProfile:{mode:'single-shortest-path'},
    metadata:{level4Reference:'scenario-aware',expectedScenarioAwareCost:12},
  };
}
export function createLevel4ScenarioFailure(): ScenarioPatch {
  return {id:'fail-ab',name:'Primary corridor AB unavailable',disabledNodeIds:[],disabledLinkIds:['AB'],demandMultipliers:[],addedDemands:[],linkCapacityOverrides:[]};
}
