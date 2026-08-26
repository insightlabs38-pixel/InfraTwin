import type { NetworkProject } from '../../model/src/index.ts';
import { modelHash } from '../../model/src/index.ts';
import { routeProject, type RoutingResult } from '../../graph-engine/src/index.ts';

export type Verdict = 'PASS' | 'FAIL' | 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'CANCELLED' | 'ERROR';
export interface Violation { id: string; type: 'UNROUTABLE_DEMAND' | 'CAPACITY' | 'SERVICE_UTILIZATION'; message: string; linkId?: string; demandId?: string; actual?: number; limit?: number; unit?: string; }
export interface EvidenceRef { type: 'link' | 'demand' | 'route'; id: string; demandId?: string; linkIds?: string[]; }
export interface AnalysisResult { id: string; type: 'capacity'; verdict: Verdict; modelHash: string; scenarioHash: string; solver: { id: string; version: string }; assumptions: string[]; metrics: Record<string, number | string | boolean>; violations: Violation[]; witnesses: EvidenceRef[]; runtimeMs: number; }
export interface CapacityAnalysis { routing: RoutingResult; result: AnalysisResult; }
function round(value: number): number { return Math.round(value * 1000) / 1000; }
export function runCapacityAnalysis(project: NetworkProject): CapacityAnalysis {
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const routing = routeProject(project); const violations: Violation[] = []; const witnesses: EvidenceRef[] = [];
  const serviceById = new Map(project.serviceClasses.map((serviceClass) => [serviceClass.id, serviceClass]));
  const demandById = new Map(project.demands.map((demand) => [demand.id, demand]));
  for (const demandId of routing.unroutedDemandIds) { violations.push({ id: `unrouted:${demandId}`, type: 'UNROUTABLE_DEMAND', demandId, message: `Demand ${demandId} has no available route.` }); witnesses.push({ type: 'demand', id: demandId, demandId }); }
  for (const link of project.links) { const utilization = routing.linkUtilizationPct[link.id] ?? 0; if (link.available !== false && utilization > 100 + 1e-9) { violations.push({ id: `capacity:${link.id}`, type: 'CAPACITY', linkId: link.id, actual: round(utilization), limit: 100, unit: '%', message: `Link ${link.id} is at ${round(utilization)}% of capacity.` }); witnesses.push({ type: 'link', id: link.id }); } }
  for (const route of routing.routes) { if (!route.reachable) continue; const demand = demandById.get(route.demandId); if (!demand) continue; const serviceClass = serviceById.get(demand.serviceClassId); if (!serviceClass) continue; for (const linkId of route.linkIds) { const utilization = routing.linkUtilizationPct[linkId] ?? 0; if (utilization > serviceClass.maxUtilizationPct + 1e-9) { violations.push({ id: `service:${demand.id}:${linkId}`, type: 'SERVICE_UTILIZATION', linkId, demandId: demand.id, actual: round(utilization), limit: serviceClass.maxUtilizationPct, unit: '%', message: `${serviceClass.name} demand ${demand.id} crosses ${linkId} at ${round(utilization)}%, above its ${serviceClass.maxUtilizationPct}% modeled utilization target.` }); witnesses.push({ type: 'route', id: `route:${demand.id}`, demandId: demand.id, linkIds: route.linkIds }); } } }
  const end = typeof performance !== 'undefined' ? performance.now() : Date.now(); const semanticHash = modelHash(project);
  return { routing, result: { id: `capacity:${semanticHash}`, type: 'capacity', verdict: violations.length ? 'FAIL' : 'PASS', modelHash: semanticHash, scenarioHash: 'baseline', solver: { id: 'ts-deterministic-shortest-path', version: '0.1.0' }, assumptions: ['Single deterministic shortest path by non-negative link weight; equal-cost ties use a stable path signature.','Bidirectional links use one shared planning-capacity value for aggregate routed load.','Utilization targets are modeled planning/SLA proxies, not packet-level QoS guarantees.'], metrics: { peakUtilizationPct: round(routing.peakUtilizationPct), routedDemandCount: routing.routes.filter((route) => route.reachable).length, unroutedDemandCount: routing.unroutedDemandIds.length, violationCount: violations.length }, violations, witnesses, runtimeMs: round(end - start) } };
}
