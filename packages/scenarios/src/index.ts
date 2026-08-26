import type { NetworkProject } from '../../model/src/index.ts';
import { cloneProject } from '../../model/src/index.ts';
const maintenanceTrap: NetworkProject = {
  schemaVersion: '0.1', id: 'maintenance-trap-l0', name: 'Maintenance Trap — Level 0',
  nodes: [
    { id: 'CHI', name: 'Chicago', region: 'central', type: 'core', available: true, x: 110, y: 130 },
    { id: 'DAL', name: 'Dallas', region: 'south', type: 'core', available: true, x: 330, y: 130 },
    { id: 'NYC', name: 'New York', region: 'east', type: 'core', available: true, x: 550, y: 130 },
    { id: 'DEN', name: 'Denver', region: 'west', type: 'core', available: true, x: 110, y: 330 },
    { id: 'ATL', name: 'Atlanta', region: 'south-east', type: 'core', available: true, x: 330, y: 330 }
  ],
  links: [
    { id: 'L1', source: 'CHI', target: 'DAL', bidirectional: true, capacityGbps: 20, latencyMs: 18, weight: 1, available: true },
    { id: 'L2', source: 'CHI', target: 'DEN', bidirectional: true, capacityGbps: 20, latencyMs: 21, weight: 1, available: true },
    { id: 'L3', source: 'DEN', target: 'ATL', bidirectional: true, capacityGbps: 10, latencyMs: 24, weight: 1, available: true },
    { id: 'L4', source: 'ATL', target: 'DAL', bidirectional: true, capacityGbps: 10, latencyMs: 15, weight: 1, available: true },
    { id: 'L5', source: 'DAL', target: 'NYC', bidirectional: true, capacityGbps: 20, latencyMs: 22, weight: 1, available: true },
    { id: 'L6', source: 'ATL', target: 'NYC', bidirectional: true, capacityGbps: 12, latencyMs: 19, weight: 1, available: true }
  ],
  demands: [
    { id: 'D1', name: 'Checkout replication', source: 'CHI', target: 'NYC', bandwidthGbps: 8, serviceClassId: 'gold' },
    { id: 'D2', name: 'Dallas API traffic', source: 'DAL', target: 'NYC', bandwidthGbps: 6, serviceClassId: 'silver' },
    { id: 'D3', name: 'Denver analytics', source: 'DEN', target: 'NYC', bandwidthGbps: 4, serviceClassId: 'silver' }
  ],
  serviceClasses: [
    { id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 80, allowShedding: false },
    { id: 'silver', name: 'Silver', priority: 50, maxUtilizationPct: 90, allowShedding: false }
  ],
  routingProfile: { mode: 'single-shortest-path' },
  metadata: { description: 'Healthy baseline. Disable CHI–DAL (L1) to reveal the alternate-path bottleneck on DEN–ATL.', suggestedPrompt: 'Can I take the Chicago–Dallas link down for maintenance without violating critical-service constraints? Don’t apply any changes.' }
};
export function loadMaintenanceTrap(): NetworkProject { return cloneProject(maintenanceTrap); }
