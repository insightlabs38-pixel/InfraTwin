import type { CandidatePlan, NetworkProject, ScenarioPatch } from '../../model/src/index.ts';
import { applyCandidatePlan, applyScenario, modelHash, scenarioHash } from '../../model/src/index.ts';
import { routeProject, type RoutingResult } from '../../graph-engine/src/index.ts';

export type Verdict = 'PASS' | 'FAIL' | 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'CANCELLED' | 'ERROR';
export type AnalysisType = 'capacity' | 'growth' | 'contingency';

export interface Violation {
  id: string;
  type: 'UNROUTABLE_DEMAND' | 'CAPACITY' | 'SERVICE_UTILIZATION';
  message: string;
  linkId?: string;
  demandId?: string;
  actual?: number;
  limit?: number;
  unit?: string;
}

export interface EvidenceRef {
  type: 'link' | 'demand' | 'route' | 'scenario';
  id: string;
  demandId?: string;
  linkIds?: string[];
}

export interface AnalysisResult {
  id: string;
  type: AnalysisType;
  verdict: Verdict;
  modelHash: string;
  scenarioHash: string;
  solver: { id: string; version: string };
  assumptions: string[];
  metrics: Record<string, number | string | boolean>;
  violations: Violation[];
  witnesses: EvidenceRef[];
  runtimeMs: number;
}

export interface CapacityAnalysis {
  snapshot: NetworkProject;
  routing: RoutingResult;
  result: AnalysisResult;
}

export interface GrowthAnalysis {
  demandIds: string[];
  targetMultiplier: number;
  step: number;
  firstFailureMultiplier: number | null;
  firstFailureLinkId: string | null;
  baseline: CapacityAnalysis;
  target: CapacityAnalysis;
  result: AnalysisResult;
}

export interface ContingencyCase {
  linkId: string;
  score: number;
  verdict: Verdict;
  peakUtilizationPct: number;
  unroutedDemandGbps: number;
  severeOverloadGbps: number;
  affectedDemandIds: string[];
  patch: ScenarioPatch;
  analysis: CapacityAnalysis;
}

export interface ContingencyAnalysis {
  cases: ContingencyCase[];
  worst: ContingencyCase | null;
  result: AnalysisResult;
}

export interface CandidateComparison {
  candidate: CandidatePlan;
  before: CapacityAnalysis;
  after: CapacityAnalysis;
  deltaPeakUtilizationPct: number;
  deltaViolationCount: number;
  improved: boolean;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function analyzeSnapshot(baseProject: NetworkProject, snapshot: NetworkProject, patchHash: string): CapacityAnalysis {
  const start = now();
  const routing = routeProject(snapshot);
  const violations: Violation[] = [];
  const witnesses: EvidenceRef[] = [];
  const serviceById = new Map(snapshot.serviceClasses.map((serviceClass) => [serviceClass.id, serviceClass]));
  const demandById = new Map(snapshot.demands.map((demand) => [demand.id, demand]));

  for (const demandId of routing.unroutedDemandIds) {
    violations.push({ id: `unrouted:${demandId}`, type: 'UNROUTABLE_DEMAND', demandId, message: `Demand ${demandId} has no available route.` });
    witnesses.push({ type: 'demand', id: demandId, demandId });
  }

  for (const link of snapshot.links) {
    const utilization = routing.linkUtilizationPct[link.id] ?? 0;
    if (link.available !== false && utilization > 100 + 1e-9) {
      violations.push({
        id: `capacity:${link.id}`,
        type: 'CAPACITY',
        linkId: link.id,
        actual: round(utilization),
        limit: 100,
        unit: '%',
        message: `Link ${link.id} is at ${round(utilization)}% of capacity.`,
      });
      witnesses.push({ type: 'link', id: link.id });
    }
  }

  for (const route of routing.routes) {
    if (!route.reachable) continue;
    const demand = demandById.get(route.demandId);
    if (!demand) continue;
    const serviceClass = serviceById.get(demand.serviceClassId);
    if (!serviceClass) continue;
    for (const linkId of route.linkIds) {
      const utilization = routing.linkUtilizationPct[linkId] ?? 0;
      if (utilization > serviceClass.maxUtilizationPct + 1e-9) {
        violations.push({
          id: `service:${demand.id}:${linkId}`,
          type: 'SERVICE_UTILIZATION',
          linkId,
          demandId: demand.id,
          actual: round(utilization),
          limit: serviceClass.maxUtilizationPct,
          unit: '%',
          message: `${serviceClass.name} demand ${demand.id} crosses ${linkId} at ${round(utilization)}%, above its ${serviceClass.maxUtilizationPct}% modeled utilization target.`,
        });
        witnesses.push({ type: 'route', id: `route:${demand.id}`, demandId: demand.id, linkIds: route.linkIds });
      }
    }
  }

  const baseHash = modelHash(baseProject);
  const end = now();
  return {
    snapshot,
    routing,
    result: {
      id: `capacity:${baseHash}:${patchHash}`,
      type: 'capacity',
      verdict: violations.length ? 'FAIL' : 'PASS',
      modelHash: baseHash,
      scenarioHash: patchHash,
      solver: { id: 'ts-deterministic-shortest-path', version: '0.2.0' },
      assumptions: [
        'Single deterministic shortest path by non-negative link weight; equal-cost ties use a stable path signature.',
        'Bidirectional links use one shared planning-capacity value for aggregate routed load.',
        'Utilization targets are modeled planning/SLA proxies, not packet-level QoS guarantees.',
      ],
      metrics: {
        peakUtilizationPct: round(routing.peakUtilizationPct),
        routedDemandCount: routing.routes.filter((route) => route.reachable).length,
        unroutedDemandCount: routing.unroutedDemandIds.length,
        violationCount: violations.length,
      },
      violations,
      witnesses,
      runtimeMs: round(end - start),
    },
  };
}

export function runCapacityAnalysis(project: NetworkProject): CapacityAnalysis {
  return analyzeSnapshot(project, project, 'baseline');
}

export function runScenarioCapacityAnalysis(project: NetworkProject, patch?: ScenarioPatch | null): CapacityAnalysis {
  if (!patch) return runCapacityAnalysis(project);
  return analyzeSnapshot(project, applyScenario(project, patch), scenarioHash(patch));
}

export function runGrowthAnalysis(
  project: NetworkProject,
  demandIds: string[],
  targetMultiplier: number,
  step = 0.05,
): GrowthAnalysis {
  const start = now();
  const normalizedIds = [...new Set(demandIds)].sort();
  if (targetMultiplier < 1) throw new Error('targetMultiplier must be >= 1');
  if (step <= 0) throw new Error('step must be > 0');
  const baseline = runCapacityAnalysis(project);
  let firstFailureMultiplier: number | null = baseline.result.verdict === 'FAIL' ? 1 : null;
  let firstFailureLinkId: string | null = baseline.result.violations.find((violation) => violation.linkId)?.linkId ?? null;

  if (firstFailureMultiplier === null) {
    for (let multiplier = 1 + step; multiplier <= targetMultiplier + 1e-9; multiplier += step) {
      const roundedMultiplier = round(Math.min(multiplier, targetMultiplier));
      const patch: ScenarioPatch = {
        id: `growth-${roundedMultiplier}`,
        name: `Demand growth ×${roundedMultiplier}`,
        disabledNodeIds: [],
        disabledLinkIds: [],
        demandMultipliers: normalizedIds.map((demandId) => ({ demandId, multiplier: roundedMultiplier })),
        addedDemands: [],
        linkCapacityOverrides: [],
      };
      const analysis = runScenarioCapacityAnalysis(project, patch);
      if (analysis.result.verdict === 'FAIL') {
        firstFailureMultiplier = roundedMultiplier;
        firstFailureLinkId = analysis.result.violations.find((violation) => violation.linkId)?.linkId ?? null;
        break;
      }
      if (roundedMultiplier === targetMultiplier) break;
    }
  }

  const targetPatch: ScenarioPatch = {
    id: `growth-target-${round(targetMultiplier)}`,
    name: `Target demand growth ×${round(targetMultiplier)}`,
    disabledNodeIds: [],
    disabledLinkIds: [],
    demandMultipliers: normalizedIds.map((demandId) => ({ demandId, multiplier: targetMultiplier })),
    addedDemands: [],
    linkCapacityOverrides: [],
  };
  const target = runScenarioCapacityAnalysis(project, targetPatch);
  const baseHash = modelHash(project);
  const end = now();
  const violations = target.result.violations;
  const witnesses = target.result.witnesses;
  const result: AnalysisResult = {
    id: `growth:${baseHash}:${round(targetMultiplier)}`,
    type: 'growth',
    verdict: target.result.verdict,
    modelHash: baseHash,
    scenarioHash: scenarioHash(targetPatch),
    solver: { id: 'ts-stepped-growth-sweep', version: '0.2.0' },
    assumptions: [
      `Selected demands are scaled together from 1.0× to ${round(targetMultiplier)}× in ${round(step)}× deterministic steps.`,
      ...target.result.assumptions,
    ],
    metrics: {
      targetMultiplier: round(targetMultiplier),
      firstFailureMultiplier: firstFailureMultiplier ?? 'none',
      firstFailureLinkId: firstFailureLinkId ?? 'none',
      baselinePeakUtilizationPct: baseline.result.metrics.peakUtilizationPct,
      targetPeakUtilizationPct: target.result.metrics.peakUtilizationPct,
    },
    violations,
    witnesses,
    runtimeMs: round(end - start),
  };
  return { demandIds: normalizedIds, targetMultiplier, step, firstFailureMultiplier, firstFailureLinkId, baseline, target, result };
}

function contingencyScore(project: NetworkProject, analysis: CapacityAnalysis): { score: number; unroutedDemandGbps: number; severeOverloadGbps: number; affectedDemandIds: string[] } {
  const unrouted = new Set(analysis.routing.unroutedDemandIds);
  let criticalUnsatisfiedGbps = 0;
  let totalUnsatisfiedGbps = 0;
  const classById = new Map(project.serviceClasses.map((serviceClass) => [serviceClass.id, serviceClass]));
  const affectedDemandIds = new Set<string>();
  for (const demand of project.demands) {
    if (!unrouted.has(demand.id)) continue;
    totalUnsatisfiedGbps += demand.bandwidthGbps;
    if ((classById.get(demand.serviceClassId)?.priority ?? 0) >= 80) criticalUnsatisfiedGbps += demand.bandwidthGbps;
    affectedDemandIds.add(demand.id);
  }
  let severeOverloadGbps = 0;
  for (const link of analysis.snapshot.links) {
    if (link.available === false) continue;
    const load = analysis.routing.linkLoadsGbps[link.id] ?? 0;
    severeOverloadGbps += Math.max(0, load - link.capacityGbps);
  }
  for (const violation of analysis.result.violations) if (violation.demandId) affectedDemandIds.add(violation.demandId);
  const score = 1000 * criticalUnsatisfiedGbps
    + 100 * totalUnsatisfiedGbps
    + 10 * severeOverloadGbps
    + analysis.routing.peakUtilizationPct;
  return {
    score: round(score),
    unroutedDemandGbps: round(totalUnsatisfiedGbps),
    severeOverloadGbps: round(severeOverloadGbps),
    affectedDemandIds: [...affectedDemandIds].sort(),
  };
}

export function runLinkContingencies(project: NetworkProject): ContingencyAnalysis {
  const start = now();
  const cases: ContingencyCase[] = project.links
    .filter((link) => link.available !== false)
    .map((link) => {
      const patch: ScenarioPatch = {
        id: `n1-link-${link.id}`,
        name: `Single-link failure: ${link.id}`,
        disabledNodeIds: [],
        disabledLinkIds: [link.id],
        demandMultipliers: [],
        addedDemands: [],
        linkCapacityOverrides: [],
      };
      const analysis = runScenarioCapacityAnalysis(project, patch);
      const scoring = contingencyScore(project, analysis);
      return {
        linkId: link.id,
        score: scoring.score,
        verdict: analysis.result.verdict,
        peakUtilizationPct: round(analysis.routing.peakUtilizationPct),
        unroutedDemandGbps: scoring.unroutedDemandGbps,
        severeOverloadGbps: scoring.severeOverloadGbps,
        affectedDemandIds: scoring.affectedDemandIds,
        patch,
        analysis,
      };
    })
    .sort((a, b) => b.score - a.score || a.linkId.localeCompare(b.linkId));

  const worst = cases[0] ?? null;
  const end = now();
  const baseHash = modelHash(project);
  const failedCases = cases.filter((item) => item.verdict === 'FAIL').length;
  const result: AnalysisResult = {
    id: `contingency:${baseHash}`,
    type: 'contingency',
    verdict: failedCases ? 'FAIL' : 'PASS',
    modelHash: baseHash,
    scenarioHash: 'n-1-link-enumeration',
    solver: { id: 'ts-sequential-n1-link-enumerator', version: '0.2.0' },
    assumptions: [
      'Each currently available link is disabled independently and routing/capacity are recomputed from the same immutable base project.',
      'Impact score = 1000×critical unsatisfied Gbps + 100×total unsatisfied Gbps + 10×severe overload Gbps + peak utilization percent.',
      'This bounded N-1 analysis is not a universal reliability guarantee.',
    ],
    metrics: {
      scenariosTested: cases.length,
      passingScenarios: cases.length - failedCases,
      failingScenarios: failedCases,
      worstLinkId: worst?.linkId ?? 'none',
      worstScore: worst?.score ?? 0,
      worstPeakUtilizationPct: worst?.peakUtilizationPct ?? 0,
      worstUnroutedDemandGbps: worst?.unroutedDemandGbps ?? 0,
    },
    violations: worst?.analysis.result.violations ?? [],
    witnesses: worst ? [{ type: 'scenario', id: worst.patch.id }, { type: 'link', id: worst.linkId }, ...worst.analysis.result.witnesses] : [],
    runtimeMs: round(end - start),
  };
  return { cases, worst, result };
}

function targetUtilizationForLink(analysis: CapacityAnalysis, linkId: string, fallbackHeadroomPct: number): number {
  const fallback = Math.max(1, 100 - fallbackHeadroomPct);
  const demandById = new Map(analysis.snapshot.demands.map((demand) => [demand.id, demand]));
  const classById = new Map(analysis.snapshot.serviceClasses.map((serviceClass) => [serviceClass.id, serviceClass]));
  let target = fallback;
  for (const route of analysis.routing.routes) {
    if (!route.reachable || !route.linkIds.includes(linkId)) continue;
    const demand = demandById.get(route.demandId);
    if (!demand) continue;
    const limit = classById.get(demand.serviceClassId)?.maxUtilizationPct;
    if (limit !== undefined) target = Math.min(target, limit);
  }
  return target;
}

export function proposeCapacityMitigation(
  project: NetworkProject,
  patch?: ScenarioPatch | null,
  targetHeadroomPct = 20,
): CandidatePlan | null {
  const analysis = runScenarioCapacityAnalysis(project, patch);
  const violatingLinkIds = [...new Set(analysis.result.violations.map((violation) => violation.linkId).filter((id): id is string => Boolean(id)))].sort();
  if (!violatingLinkIds.length) return null;

  const commands: CandidatePlan['commands'] = [];
  const rationaleEvidenceIds: string[] = [];
  let totalCost = 0;

  for (const linkId of violatingLinkIds) {
    const link = project.links.find((item) => item.id === linkId);
    const snapshotLink = analysis.snapshot.links.find((item) => item.id === linkId);
    if (!link || !snapshotLink || link.available === false || snapshotLink.available === false) continue;
    const load = analysis.routing.linkLoadsGbps[linkId] ?? 0;
    if (load <= 0) continue;
    const targetUtilizationPct = targetUtilizationForLink(analysis, linkId, targetHeadroomPct);
    const requiredCapacity = load / (targetUtilizationPct / 100);
    if (requiredCapacity <= snapshotLink.capacityGbps + 1e-9) continue;
    const upgrade = [...(link.upgradeOptions ?? [])]
      .filter((option) => option.capacityGbps + 1e-9 >= requiredCapacity)
      .sort((a, b) => a.cost - b.cost || a.capacityGbps - b.capacityGbps)[0];
    const capacityGbps = upgrade?.capacityGbps ?? Math.ceil(requiredCapacity * 10) / 10;
    const cost = upgrade?.cost ?? round(Math.max(0, capacityGbps - link.capacityGbps));
    totalCost += cost;
    commands.push({
      id: `cmd-capacity-${linkId}`,
      type: 'set_link_capacity',
      actor: 'agent',
      args: { linkId, capacityGbps },
      createdAt: new Date(0).toISOString(),
    });
    rationaleEvidenceIds.push(...analysis.result.violations.filter((violation) => violation.linkId === linkId).map((violation) => violation.id));
  }

  if (!commands.length) return null;
  return {
    id: `candidate:${modelHash(project)}:${commands.map((command) => command.args.linkId).join(',')}`,
    name: `Capacity mitigation for ${patch?.name ?? 'current network'}`,
    baseModelHash: modelHash(project),
    commands,
    objective: { name: 'estimatedUpgradeCost', value: round(totalCost), unit: 'cost-units' },
    rationaleEvidenceIds: [...new Set(rationaleEvidenceIds)].sort(),
  };
}

export function compareCandidate(project: NetworkProject, candidate: CandidatePlan, patch?: ScenarioPatch | null): CandidateComparison {
  const before = runScenarioCapacityAnalysis(project, patch);
  const candidateProject = applyCandidatePlan(project, candidate);
  const after = runScenarioCapacityAnalysis(candidateProject, patch);
  const deltaPeakUtilizationPct = round(after.routing.peakUtilizationPct - before.routing.peakUtilizationPct);
  const deltaViolationCount = after.result.violations.length - before.result.violations.length;
  return {
    candidate,
    before,
    after,
    deltaPeakUtilizationPct,
    deltaViolationCount,
    improved: after.result.violations.length < before.result.violations.length || after.routing.peakUtilizationPct < before.routing.peakUtilizationPct,
  };
}
