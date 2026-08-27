import type { CandidatePlan, ChangePlan, NetworkProject, PlanEvidenceStamp, ScenarioPatch } from '../../model/src/index.ts';
import { applyCandidatePlan, applyScenario, changePlanEvidenceStamp, compileChangePlanToScenarioPatch, isPlanEvidenceFresh, modelHash, scenarioHash } from '../../model/src/index.ts';
import { minCut, routeProject, type CutResult, type RoutingResult } from '../../graph-engine/src/index.ts';

export type Verdict = 'PASS' | 'FAIL' | 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'CANCELLED' | 'ERROR';
export type AnalysisType = 'capacity' | 'growth' | 'contingency' | 'bottleneck';

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
  type: 'link' | 'demand' | 'route' | 'scenario' | 'cut';
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

export interface ChangePlanAnalysis {
  stamp: PlanEvidenceStamp;
  planHash: string;
  patch: ScenarioPatch;
  capacity: CapacityAnalysis;
  verdict: 'PASS' | 'FAIL';
  targetUtilizationPct: number;
  targetUtilizationSatisfied: boolean;
  protectedServiceClassIds: string[];
  protectedViolationIds: string[];
  reasons: string[];
}

export interface ContingencyCase {
  linkId: string;
  score: number;
  criticalUnsatisfiedGbps: number;
  verdict: Verdict;
  peakUtilizationPct: number;
  unroutedDemandGbps: number;
  severeOverloadGbps: number;
  affectedDemandIds: string[];
  patch: ScenarioPatch;
  analysis: CapacityAnalysis;
}

export type ContingencyRunStatus = 'complete' | 'cancelled' | 'partial';
export type ContingencyExecutionMode = 'sequential' | 'worker-pool' | 'async-fallback';

export interface ContingencyAnalysis {
  cases: ContingencyCase[];
  worst: ContingencyCase | null;
  totalEligibleScenarios: number;
  completedScenarios: number;
  status: ContingencyRunStatus;
  workerCount: number;
  executionMode: ContingencyExecutionMode;
  rankingDefinition: string;
  result: AnalysisResult;
}

export interface ContingencyProgress {
  total: number;
  completed: number;
  running: number;
  percentage: number;
  workerCount: number;
  executionMode: ContingencyExecutionMode;
}

export interface CandidateComparison {
  candidate: CandidatePlan;
  before: CapacityAnalysis;
  after: CapacityAnalysis;
  deltaPeakUtilizationPct: number;
  deltaViolationCount: number;
  improved: boolean;
}

export interface BottleneckAnalysis {
  sourceId: string;
  targetId: string;
  requestedDemandGbps: number;
  cut: CutResult;
  headroomGbps: number;
  constrained: boolean;
  evidence: EvidenceRef;
  result: AnalysisResult;
}

export interface ComputeCapabilities {
  workerSupported: boolean;
  hardwareConcurrency: number;
  recommendedWorkerCount: number;
  sharedArrayBufferSupported: boolean;
  crossOriginIsolated: boolean;
  executionMode: 'worker-pool' | 'async-fallback';
}

export interface ContingencyWorkerLike {
  onmessage: ((event: MessageEvent<ContingencyWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: ContingencyWorkerRequest): void;
  terminate(): void;
}

export interface ContingencyWorkerRequest {
  taskId: string;
  project: NetworkProject;
  basePatch: ScenarioPatch | null;
  linkId: string;
}

export type ContingencyWorkerResponse =
  | { taskId: string; ok: true; contingency: ContingencyCase }
  | { taskId: string; ok: false; error: string };

export interface ContingencyRunOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ContingencyProgress) => void;
  maxScenarios?: number;
  workerCount?: number;
  timeLimitMs?: number;
  workerFactory?: () => ContingencyWorkerLike;
}

const RANKING_DEFINITION = '1000×critical unsatisfied Gbps + 100×total unsatisfied Gbps + 10×severe overload Gbps + peak utilization percent';
const MAX_N1_SCENARIOS = 500;
const MAX_WORKERS = 8;

function now(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
function round(value: number): number { return Math.round(value * 1000) / 1000; }
function abortError(message = 'Analysis cancelled'): Error {
  if (typeof DOMException !== 'undefined') return new DOMException(message, 'AbortError');
  const error = new Error(message); error.name = 'AbortError'; return error;
}
function isAbortError(error: unknown): boolean { return error instanceof Error && error.name === 'AbortError'; }

export function detectComputeCapabilities(env: { Worker?: unknown; navigator?: { hardwareConcurrency?: number }; SharedArrayBuffer?: unknown; crossOriginIsolated?: boolean } = globalThis): ComputeCapabilities {
  const hardwareConcurrency = Math.max(1, Math.floor(Number(env.navigator?.hardwareConcurrency ?? 2) || 2));
  const recommendedWorkerCount = Math.min(Math.max(2, hardwareConcurrency - 1), MAX_WORKERS);
  const workerSupported = typeof env.Worker === 'function';
  return {
    workerSupported,
    hardwareConcurrency,
    recommendedWorkerCount,
    sharedArrayBufferSupported: typeof env.SharedArrayBuffer === 'function',
    crossOriginIsolated: env.crossOriginIsolated === true,
    executionMode: workerSupported ? 'worker-pool' : 'async-fallback',
  };
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
        id: `capacity:${link.id}`, type: 'CAPACITY', linkId: link.id, actual: round(utilization), limit: 100, unit: '%',
        message: `Link ${link.id} is at ${round(utilization)}% of capacity.`,
      });
      witnesses.push({ type: 'link', id: link.id });
    }
  }

  for (const route of routing.routes) {
    if (!route.reachable) continue;
    const demand = demandById.get(route.demandId);
    const serviceClass = demand ? serviceById.get(demand.serviceClassId) : undefined;
    if (!demand || !serviceClass) continue;
    for (const [linkId, fraction] of Object.entries(route.linkFractions)) {
      if (fraction <= 1e-9) continue;
      const utilization = routing.linkUtilizationPct[linkId] ?? 0;
      if (utilization > serviceClass.maxUtilizationPct + 1e-9) {
        violations.push({
          id: `service:${demand.id}:${linkId}`, type: 'SERVICE_UTILIZATION', linkId, demandId: demand.id,
          actual: round(utilization), limit: serviceClass.maxUtilizationPct, unit: '%',
          message: `${serviceClass.name} demand ${demand.id} uses ${linkId} at ${round(utilization)}%, above its ${serviceClass.maxUtilizationPct}% modeled utilization target.`,
        });
        witnesses.push({ type: 'route', id: `route:${demand.id}`, demandId: demand.id, linkIds: Object.keys(route.linkFractions).sort() });
      }
    }
  }

  const baseHash = modelHash(baseProject);
  const end = now();
  const ecmp = routing.mode === 'ecmp';
  return {
    snapshot,
    routing,
    result: {
      id: `capacity:${baseHash}:${patchHash}`,
      type: 'capacity',
      verdict: violations.length ? 'FAIL' : 'PASS',
      modelHash: baseHash,
      scenarioHash: patchHash,
      solver: { id: ecmp ? 'ts-ecmp-shortest-path' : 'ts-deterministic-shortest-path', version: '0.3.0' },
      assumptions: [
        ecmp
          ? 'ECMP splits each demand equally across all equal-cost shortest paths by positive link weight; link loads aggregate fractional demand flow.'
          : 'Single deterministic shortest path by non-negative link weight; equal-cost ties use a stable path signature.',
        'Bidirectional links use one shared planning-capacity value for aggregate routed load.',
        'Utilization targets are modeled planning/SLA proxies, not packet-level QoS guarantees.',
      ],
      metrics: {
        peakUtilizationPct: round(routing.peakUtilizationPct),
        routedDemandCount: routing.routes.filter((route) => route.reachable).length,
        unroutedDemandCount: routing.unroutedDemandIds.length,
        violationCount: violations.length,
        routingMode: routing.mode,
      },
      violations,
      witnesses,
      runtimeMs: round(end - start),
    },
  };
}

export function runCapacityAnalysis(project: NetworkProject): CapacityAnalysis { return analyzeSnapshot(project, project, 'baseline'); }
export function runScenarioCapacityAnalysis(project: NetworkProject, patch?: ScenarioPatch | null): CapacityAnalysis {
  return patch ? analyzeSnapshot(project, applyScenario(project, patch), scenarioHash(patch)) : runCapacityAnalysis(project);
}

export function analyzeChangePlan(project: NetworkProject, plan: ChangePlan): ChangePlanAnalysis {
  const patch = compileChangePlanToScenarioPatch(project, plan);
  const capacity = runScenarioCapacityAnalysis(project, patch);
  const target = plan.constraints.targetUtilizationPct;
  const peak = capacity.routing.peakUtilizationPct;
  const targetUtilizationSatisfied = peak <= target + 1e-9;
  const protectedClasses = new Set(plan.constraints.protectedServiceClassIds);
  const protectedViolationIds = capacity.result.violations.filter((violation) => {
    if (!violation.demandId) return false;
    const demand = capacity.snapshot.demands.find((item) => item.id === violation.demandId);
    return Boolean(demand && protectedClasses.has(demand.serviceClassId));
  }).map((violation) => violation.id).sort();
  const reasons: string[] = [];
  if (capacity.result.verdict === 'FAIL') reasons.push(`${capacity.result.violations.length} deterministic routing/capacity violation${capacity.result.violations.length === 1 ? '' : 's'}.`);
  if (!targetUtilizationSatisfied) reasons.push(`Peak utilization ${round(peak)}% exceeds the Change Plan target of ${round(target)}%.`);
  if (protectedViolationIds.length) reasons.push(`${protectedViolationIds.length} violation${protectedViolationIds.length === 1 ? '' : 's'} affect protected service classes.`);
  if (!reasons.length) reasons.push(`Planned state satisfies deterministic routing/capacity checks and the ${round(target)}% utilization target.`);
  const stamp = changePlanEvidenceStamp(project, plan);
  return {
    stamp,
    planHash: stamp.planHash,
    patch,
    capacity,
    verdict: capacity.result.verdict === 'PASS' && targetUtilizationSatisfied ? 'PASS' : 'FAIL',
    targetUtilizationPct: target,
    targetUtilizationSatisfied,
    protectedServiceClassIds: [...protectedClasses].sort(),
    protectedViolationIds,
    reasons,
  };
}

export function assertChangePlanAnalysisFresh(analysis: ChangePlanAnalysis, project: NetworkProject, plan: ChangePlan): void {
  if (!isPlanEvidenceFresh(analysis.stamp, project, plan)) throw new Error('Change Plan analysis is stale because the base network or plan semantics changed.');
}

export function runGrowthAnalysis(project: NetworkProject, demandIds: string[], targetMultiplier: number, step = 0.05): GrowthAnalysis {
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
        id: `growth-${roundedMultiplier}`, name: `Demand growth ×${roundedMultiplier}`,
        disabledNodeIds: [], disabledLinkIds: [], demandMultipliers: normalizedIds.map((demandId) => ({ demandId, multiplier: roundedMultiplier })),
        addedDemands: [], linkCapacityOverrides: [],
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
    id: `growth-target-${round(targetMultiplier)}`, name: `Target demand growth ×${round(targetMultiplier)}`,
    disabledNodeIds: [], disabledLinkIds: [], demandMultipliers: normalizedIds.map((demandId) => ({ demandId, multiplier: targetMultiplier })),
    addedDemands: [], linkCapacityOverrides: [],
  };
  const target = runScenarioCapacityAnalysis(project, targetPatch);
  const baseHash = modelHash(project);
  const end = now();
  const result: AnalysisResult = {
    id: `growth:${baseHash}:${round(targetMultiplier)}`, type: 'growth', verdict: target.result.verdict,
    modelHash: baseHash, scenarioHash: scenarioHash(targetPatch), solver: { id: 'ts-stepped-growth-sweep', version: '0.3.0' },
    assumptions: [`Selected demands are scaled together from 1.0× to ${round(targetMultiplier)}× in ${round(step)}× deterministic steps.`, ...target.result.assumptions],
    metrics: {
      targetMultiplier: round(targetMultiplier), firstFailureMultiplier: firstFailureMultiplier ?? 'none', firstFailureLinkId: firstFailureLinkId ?? 'none',
      baselinePeakUtilizationPct: baseline.result.metrics.peakUtilizationPct, targetPeakUtilizationPct: target.result.metrics.peakUtilizationPct,
    },
    violations: target.result.violations, witnesses: target.result.witnesses, runtimeMs: round(end - start),
  };
  return { demandIds: normalizedIds, targetMultiplier, step, firstFailureMultiplier, firstFailureLinkId, baseline, target, result };
}

function mergeFailurePatch(basePatch: ScenarioPatch | null | undefined, linkId: string): ScenarioPatch {
  return {
    id: `${basePatch?.id ?? 'baseline'}:n1-link-${linkId}`,
    name: `${basePatch?.name ? `${basePatch.name} + ` : ''}single-link failure ${linkId}`,
    disabledNodeIds: [...new Set(basePatch?.disabledNodeIds ?? [])].sort(),
    disabledLinkIds: [...new Set([...(basePatch?.disabledLinkIds ?? []), linkId])].sort(),
    demandMultipliers: (basePatch?.demandMultipliers ?? []).map((item) => ({ ...item })),
    addedDemands: (basePatch?.addedDemands ?? []).map((item) => ({ ...item })),
    linkCapacityOverrides: (basePatch?.linkCapacityOverrides ?? []).map((item) => ({ ...item })),
  };
}

function contingencyScore(analysis: CapacityAnalysis): { score: number; criticalUnsatisfiedGbps: number; unroutedDemandGbps: number; severeOverloadGbps: number; affectedDemandIds: string[] } {
  const unrouted = new Set(analysis.routing.unroutedDemandIds);
  let criticalUnsatisfiedGbps = 0;
  let totalUnsatisfiedGbps = 0;
  const classById = new Map(analysis.snapshot.serviceClasses.map((serviceClass) => [serviceClass.id, serviceClass]));
  const affectedDemandIds = new Set<string>();
  for (const demand of analysis.snapshot.demands) {
    if (!unrouted.has(demand.id)) continue;
    totalUnsatisfiedGbps += demand.bandwidthGbps;
    if ((classById.get(demand.serviceClassId)?.priority ?? 0) >= 80) criticalUnsatisfiedGbps += demand.bandwidthGbps;
    affectedDemandIds.add(demand.id);
  }
  let severeOverloadGbps = 0;
  for (const link of analysis.snapshot.links) {
    if (link.available === false) continue;
    severeOverloadGbps += Math.max(0, (analysis.routing.linkLoadsGbps[link.id] ?? 0) - link.capacityGbps);
  }
  for (const violation of analysis.result.violations) if (violation.demandId) affectedDemandIds.add(violation.demandId);
  return {
    score: round(1000 * criticalUnsatisfiedGbps + 100 * totalUnsatisfiedGbps + 10 * severeOverloadGbps + analysis.routing.peakUtilizationPct),
    criticalUnsatisfiedGbps: round(criticalUnsatisfiedGbps),
    unroutedDemandGbps: round(totalUnsatisfiedGbps),
    severeOverloadGbps: round(severeOverloadGbps),
    affectedDemandIds: [...affectedDemandIds].sort(),
  };
}

export function runSingleLinkContingency(project: NetworkProject, linkId: string, basePatch?: ScenarioPatch | null): ContingencyCase {
  const link = project.links.find((item) => item.id === linkId);
  if (!link || link.available === false) throw new Error(`Link ${linkId} is not eligible for N-1 analysis.`);
  const patch = mergeFailurePatch(basePatch, linkId);
  const analysis = runScenarioCapacityAnalysis(project, patch);
  const scoring = contingencyScore(analysis);
  return {
    linkId, score: scoring.score, criticalUnsatisfiedGbps: scoring.criticalUnsatisfiedGbps, verdict: analysis.result.verdict,
    peakUtilizationPct: round(analysis.routing.peakUtilizationPct), unroutedDemandGbps: scoring.unroutedDemandGbps,
    severeOverloadGbps: scoring.severeOverloadGbps, affectedDemandIds: scoring.affectedDemandIds, patch, analysis,
  };
}

function finalizeContingencies(
  project: NetworkProject,
  basePatch: ScenarioPatch | null | undefined,
  casesInput: ContingencyCase[],
  start: number,
  totalEligibleScenarios: number,
  status: ContingencyRunStatus,
  workerCount: number,
  executionMode: ContingencyExecutionMode,
): ContingencyAnalysis {
  const cases = [...casesInput].sort((a, b) => b.score - a.score || a.linkId.localeCompare(b.linkId));
  const worst = cases[0] ?? null;
  const failedCases = cases.filter((item) => item.verdict === 'FAIL').length;
  const baseHash = modelHash(project);
  const patchHash = scenarioHash(basePatch);
  const verdict: Verdict = status === 'cancelled' ? 'CANCELLED' : status === 'partial' ? 'CANCELLED' : failedCases ? 'FAIL' : 'PASS';
  const result: AnalysisResult = {
    id: `contingency:${baseHash}:${patchHash}`, type: 'contingency', verdict, modelHash: baseHash, scenarioHash: patchHash,
    solver: { id: executionMode === 'worker-pool' ? 'ts-worker-pool-n1-link-enumerator' : 'ts-bounded-n1-link-enumerator', version: '0.3.0' },
    assumptions: [
      'Each eligible link is disabled independently on the same immutable model/scenario snapshot and routing/capacity are recomputed.',
      `Impact score = ${RANKING_DEFINITION}.`,
      'Scenario count, worker count, and runtime are bounded; cancellation never publishes a PASS result.',
      'This N-1 analysis is a planning model, not a universal reliability guarantee.',
    ],
    metrics: {
      totalEligibleScenarios, completedScenarios: cases.length, scenariosTested: cases.length,
      passingScenarios: cases.length - failedCases, failingScenarios: failedCases,
      worstLinkId: worst?.linkId ?? 'none', worstScore: worst?.score ?? 0, worstPeakUtilizationPct: worst?.peakUtilizationPct ?? 0,
      worstUnroutedDemandGbps: worst?.unroutedDemandGbps ?? 0, workerCount, executionMode, status,
    },
    violations: worst?.analysis.result.violations ?? [],
    witnesses: worst ? [{ type: 'scenario', id: worst.patch.id }, { type: 'link', id: worst.linkId }, ...worst.analysis.result.witnesses] : [],
    runtimeMs: round(now() - start),
  };
  return { cases, worst, totalEligibleScenarios, completedScenarios: cases.length, status, workerCount, executionMode, rankingDefinition: RANKING_DEFINITION, result };
}

function eligibleLinkIds(project: NetworkProject, maxScenarios = MAX_N1_SCENARIOS): { ids: string[]; totalEligible: number } {
  const all = project.links.filter((link) => link.available !== false).map((link) => link.id).sort();
  const boundedMax = Math.max(1, Math.min(MAX_N1_SCENARIOS, Math.floor(maxScenarios)));
  return { ids: all.slice(0, boundedMax), totalEligible: all.length };
}

export function runLinkContingencies(project: NetworkProject, basePatch?: ScenarioPatch | null, maxScenarios = MAX_N1_SCENARIOS): ContingencyAnalysis {
  const start = now();
  const { ids, totalEligible } = eligibleLinkIds(project, maxScenarios);
  const cases = ids.map((linkId) => runSingleLinkContingency(project, linkId, basePatch));
  return finalizeContingencies(project, basePatch, cases, start, totalEligible, ids.length < totalEligible ? 'partial' : 'complete', 1, 'sequential');
}

function boundedWorkerCount(value: number | undefined): number {
  const fallback = detectComputeCapabilities().recommendedWorkerCount;
  return Math.max(1, Math.min(MAX_WORKERS, Math.floor(value ?? fallback)));
}

function workerTask(worker: ContingencyWorkerLike, request: ContingencyWorkerRequest, signal: AbortSignal | undefined, timeoutMs: number): Promise<ContingencyCase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
    };
    const finish = (fn: () => void) => { if (settled) return; settled = true; cleanup(); fn(); };
    const onAbort = () => finish(() => reject(abortError()));
    const timer = setTimeout(() => finish(() => reject(new Error('Contingency worker task exceeded the runtime limit.'))), Math.max(1, timeoutMs));
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event) => {
      const response = event.data;
      if (!response || response.taskId !== request.taskId) return;
      if (response.ok) finish(() => resolve(response.contingency));
      else finish(() => reject(new Error(response.error)));
    };
    worker.onerror = (event) => finish(() => reject(new Error(event.message || 'Contingency worker failed.')));
    worker.postMessage(request);
  });
}

export async function runLinkContingenciesAsync(project: NetworkProject, basePatch?: ScenarioPatch | null, options: ContingencyRunOptions = {}): Promise<ContingencyAnalysis> {
  const start = now();
  const timeLimitMs = Math.max(50, Math.min(120_000, Math.floor(options.timeLimitMs ?? 30_000)));
  const { ids, totalEligible } = eligibleLinkIds(project, options.maxScenarios ?? MAX_N1_SCENARIOS);
  const workerCount = Math.min(boundedWorkerCount(options.workerCount), Math.max(1, ids.length));
  const executionMode: ContingencyExecutionMode = options.workerFactory ? 'worker-pool' : 'async-fallback';
  const cases: ContingencyCase[] = [];
  let cursor = 0;
  let running = 0;
  const workers: ContingencyWorkerLike[] = [];

  const progress = () => options.onProgress?.({
    total: ids.length,
    completed: cases.length,
    running,
    percentage: ids.length ? round((cases.length / ids.length) * 100) : 100,
    workerCount,
    executionMode,
  });
  progress();

  const nextLinkId = (): string | null => {
    if (cursor >= ids.length) return null;
    const linkId = ids[cursor]; cursor += 1; return linkId;
  };
  const checkBudget = () => {
    if (options.signal?.aborted) throw abortError();
    if (now() - start > timeLimitMs) throw abortError('Analysis time limit reached');
  };

  try {
    if (options.workerFactory) {
      for (let i = 0; i < workerCount; i += 1) workers.push(options.workerFactory());
      await Promise.all(workers.map(async (worker, workerIndex) => {
        while (true) {
          checkBudget();
          const linkId = nextLinkId();
          if (!linkId) return;
          running += 1; progress();
          try {
            const remaining = Math.max(1, timeLimitMs - (now() - start));
            const contingency = await workerTask(worker, { taskId: `${workerIndex}:${linkId}`, project, basePatch: basePatch ?? null, linkId }, options.signal, remaining);
            cases.push(contingency);
          } finally {
            running -= 1; progress();
          }
        }
      }));
    } else {
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (true) {
          checkBudget();
          const linkId = nextLinkId();
          if (!linkId) return;
          running += 1; progress();
          try {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            checkBudget();
            cases.push(runSingleLinkContingency(project, linkId, basePatch));
          } finally {
            running -= 1; progress();
          }
        }
      }));
    }
  } catch (error) {
    if (!isAbortError(error)) throw error;
    return finalizeContingencies(project, basePatch, cases, start, totalEligible, 'cancelled', workerCount, executionMode);
  } finally {
    for (const worker of workers) worker.terminate();
  }

  const status: ContingencyRunStatus = ids.length < totalEligible ? 'partial' : 'complete';
  return finalizeContingencies(project, basePatch, cases, start, totalEligible, status, workerCount, executionMode);
}

export function assertContingencyFresh(analysis: ContingencyAnalysis, project: NetworkProject, patch?: ScenarioPatch | null): void {
  if (analysis.result.modelHash !== modelHash(project) || analysis.result.scenarioHash !== scenarioHash(patch)) {
    throw new Error('Contingency result is stale because the model or active scenario changed while analysis was running.');
  }
}

export function analyzeBottleneck(project: NetworkProject, sourceId: string, targetId: string, patch?: ScenarioPatch | null): BottleneckAnalysis {
  const start = now();
  const snapshot = applyScenario(project, patch);
  const cut = minCut(snapshot, sourceId, targetId);
  const requestedDemandGbps = round(snapshot.demands
    .filter((demand) => demand.source === sourceId && demand.target === targetId)
    .reduce((sum, demand) => sum + demand.bandwidthGbps, 0));
  const headroomGbps = round(cut.cutCapacityGbps - requestedDemandGbps);
  const evidence: EvidenceRef = { type: 'cut', id: `cut:${sourceId}:${targetId}`, linkIds: cut.cutLinkIds };
  const baseHash = modelHash(project);
  const patchHash = scenarioHash(patch);
  const constrained = requestedDemandGbps > cut.cutCapacityGbps + 1e-9;
  const result: AnalysisResult = {
    id: `bottleneck:${baseHash}:${patchHash}:${sourceId}:${targetId}`, type: 'bottleneck', verdict: constrained ? 'FAIL' : 'PASS',
    modelHash: baseHash, scenarioHash: patchHash, solver: { id: 'ts-edmonds-karp-min-cut', version: '0.3.0' },
    assumptions: ['Max-flow/min-cut uses available link planning capacities on the active scenario snapshot.', 'Bidirectional links expose capacity in both traversal directions for source-to-target cut analysis.'],
    metrics: { sourceId, targetId, requestedDemandGbps, cutCapacityGbps: cut.cutCapacityGbps, maxFlowGbps: cut.maxFlowGbps, headroomGbps },
    violations: [], witnesses: [evidence], runtimeMs: round(now() - start),
  };
  return { sourceId, targetId, requestedDemandGbps, cut, headroomGbps, constrained, evidence, result };
}

function targetUtilizationForLink(analysis: CapacityAnalysis, linkId: string, fallbackHeadroomPct: number): number {
  const fallback = Math.max(1, 100 - fallbackHeadroomPct);
  const demandById = new Map(analysis.snapshot.demands.map((demand) => [demand.id, demand]));
  const classById = new Map(analysis.snapshot.serviceClasses.map((serviceClass) => [serviceClass.id, serviceClass]));
  let target = fallback;
  for (const route of analysis.routing.routes) {
    if (!route.reachable || (route.linkFractions[linkId] ?? 0) <= 1e-9) continue;
    const demand = demandById.get(route.demandId);
    if (!demand) continue;
    const limit = classById.get(demand.serviceClassId)?.maxUtilizationPct;
    if (limit !== undefined) target = Math.min(target, limit);
  }
  return target;
}

export function proposeCapacityMitigation(project: NetworkProject, patch?: ScenarioPatch | null, targetHeadroomPct = 20, lockedLinkIds: readonly string[] = []): CandidatePlan | null {
  const analysis = runScenarioCapacityAnalysis(project, patch);
  const locked = new Set(lockedLinkIds);
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
    if (locked.has(linkId)) return null;
    const upgrade = [...(link.upgradeOptions ?? [])]
      .filter((option) => option.capacityGbps + 1e-9 >= requiredCapacity)
      .sort((a, b) => a.cost - b.cost || a.capacityGbps - b.capacityGbps)[0];
    const capacityGbps = upgrade?.capacityGbps ?? Math.ceil(requiredCapacity * 10) / 10;
    const cost = upgrade?.cost ?? round(Math.max(0, capacityGbps - link.capacityGbps));
    totalCost += cost;
    commands.push({ id: `cmd-capacity-${linkId}`, type: 'set_link_capacity', actor: 'agent', args: { linkId, capacityGbps }, createdAt: new Date(0).toISOString() });
    rationaleEvidenceIds.push(...analysis.result.violations.filter((violation) => violation.linkId === linkId).map((violation) => violation.id));
  }

  if (!commands.length) return null;
  return {
    id: `candidate:${modelHash(project)}:${commands.map((command) => command.args.linkId).join(',')}`,
    name: `Capacity mitigation for ${patch?.name ?? 'current network'}`, baseModelHash: modelHash(project), commands,
    objective: { name: 'estimatedUpgradeCost', value: round(totalCost), unit: 'cost-units' }, rationaleEvidenceIds: [...new Set(rationaleEvidenceIds)].sort(),
  };
}

export function compareCandidate(project: NetworkProject, candidate: CandidatePlan, patch?: ScenarioPatch | null): CandidateComparison {
  const before = runScenarioCapacityAnalysis(project, patch);
  const candidateProject = applyCandidatePlan(project, candidate);
  const after = runScenarioCapacityAnalysis(candidateProject, patch);
  return {
    candidate, before, after,
    deltaPeakUtilizationPct: round(after.routing.peakUtilizationPct - before.routing.peakUtilizationPct),
    deltaViolationCount: after.result.violations.length - before.result.violations.length,
    improved: after.result.violations.length < before.result.violations.length || after.routing.peakUtilizationPct < before.routing.peakUtilizationPct,
  };
}
