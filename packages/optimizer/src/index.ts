import type { CandidatePlan, NetworkProject, ScenarioPatch } from '../../model/src/index.ts';
import { applyCandidatePlan, applyScenario, modelHash, scenarioHash } from '../../model/src/index.ts';
import { routeProject } from '../../graph-engine/src/index.ts';

export const HIGHS_PACKAGE_VERSION = '1.15.2';
export const HIGHS_SOLVER_NAME = 'HiGHS WASM';

export type OptimizationProof = 'optimal' | 'feasible-incumbent' | 'infeasible' | 'unknown';

export interface SolverDiagnostics {
  solver: typeof HIGHS_SOLVER_NAME;
  solverVersion: string;
  status: string;
  proof: OptimizationProof;
  objectiveValue: number | null;
  mipGap: number | null;
  timedOut: boolean;
  timeLimitMs: number;
  runtimeMs: number;
  modelConstructionMs: number;
  wasmInitializationMs: number;
  solveRuntimeMs: number;
  modelHash: string;
  scenarioHashes: string[];
  problemHash: string;
  message: string;
}

export interface TrafficAllocationVerification {
  valid: boolean;
  nonnegativeFlows: boolean;
  flowConservation: boolean;
  capacityConstraints: boolean;
  objectiveConsistent: boolean;
  computedMaxUtilizationPct: number | null;
  violations: string[];
}

export interface TrafficAllocationResult {
  diagnostics: SolverDiagnostics;
  maxUtilizationPct: number | null;
  allocations: Array<{ demandId: string; linkId: string; direction: 'forward' | 'reverse'; flowGbps: number }>;
  verification: TrafficAllocationVerification | null;
}

export interface CapacityPlanRequirements {
  targetUtilizationPct?: number;
  budgetCostUnits?: number;
  scenarioPatches?: ScenarioPatch[];
  includeBaseline?: boolean;
  /** Human collaboration restriction: these links must never receive upgrade variables. */
  lockedLinkIds?: string[];
}

export interface CapacityOptimizationResult {
  diagnostics: SolverDiagnostics;
  candidate: CandidatePlan | null;
  selectedUpgrades: Array<{ linkId: string; fromCapacityGbps: number; toCapacityGbps: number; cost: number }>;
  requirements: Required<Pick<CapacityPlanRequirements, 'targetUtilizationPct' | 'includeBaseline'>> & { budgetCostUnits: number | null; lockedLinkIds: string[] };
  scenarioHashes: string[];
}

export interface CandidateVerification {
  status: 'verified' | 'disagreement';
  modelHash: string;
  candidateBaseModelHash: string;
  candidateResultModelHash: string | null;
  objectiveMatches: boolean;
  constraintsSatisfied: boolean;
  calculatedCost: number | null;
  expectedCost: number;
  violations: string[];
  checkedScenarioHashes: string[];
  verifier: 'deterministic-independent-checker-v1';
}

export interface SolverRunOptions {
  timeLimitMs?: number;
  locateFile?: (file: string) => string;
  /** Explicit expert override for measured scale guardrails. Normal UI paths leave this false. */
  allowLargeModel?: boolean;
}

type HighsOneShotResult = {
  Status?: unknown;
  ObjectiveValue?: unknown;
  Columns?: Record<string, { Primal?: unknown }>;
  MipGap?: unknown;
};

type HighsInstance = { solve(problem: string, options?: Record<string, unknown>): HighsOneShotResult };
type HighsLoader = (settings?: { locateFile?: (file: string) => string }) => Promise<HighsInstance>;

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function numeric(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeSolverStatus(rawStatus: string, hasIncumbent = false): Pick<SolverDiagnostics, 'status' | 'proof' | 'timedOut'> {
  const status = rawStatus || 'Unknown';
  const normalized = status.toLowerCase();
  if (normalized === 'optimal') return { status, proof: 'optimal', timedOut: false };
  if (normalized.includes('infeasible')) return { status, proof: 'infeasible', timedOut: false };
  if (normalized.includes('time limit') || normalized.includes('time_limit')) {
    return { status, proof: hasIncumbent ? 'feasible-incumbent' : 'unknown', timedOut: true };
  }
  return { status, proof: hasIncumbent ? 'feasible-incumbent' : 'unknown', timedOut: false };
}

async function loadHighs(options: SolverRunOptions): Promise<HighsInstance> {
  const module = await import('highs');
  const loader = module.default as unknown as HighsLoader;
  return loader(options.locateFile ? { locateFile: options.locateFile } : undefined);
}

export async function probeOptimizer(options: SolverRunOptions = {}): Promise<{ solver: typeof HIGHS_SOLVER_NAME; solverVersion: string; status: string }> {
  const highs = await loadHighs(options);
  const raw = highs.solve(`Minimize\n obj: x\nSubject To\n c1: x >= 1\nBounds\n x >= 0\nEnd`, { output_flag: false, time_limit: 1 });
  return { solver: HIGHS_SOLVER_NAME, solverVersion: HIGHS_PACKAGE_VERSION, status: String(raw.Status ?? 'Unknown') };
}

function diagnosticsFrom(
  raw: HighsOneShotResult,
  project: NetworkProject,
  patches: Array<ScenarioPatch | null>,
  problem: string,
  timings: { startedAt: number; modelConstructionMs: number; wasmInitializationMs: number; solveRuntimeMs: number },
  timeLimitMs: number,
  message = '',
): SolverDiagnostics {
  const columns = raw.Columns ?? {};
  const hasIncumbent = Object.values(columns).some((column) => numeric(column.Primal) !== null);
  const normalized = normalizeSolverStatus(String(raw.Status ?? 'Unknown'), hasIncumbent);
  return {
    solver: HIGHS_SOLVER_NAME,
    solverVersion: HIGHS_PACKAGE_VERSION,
    ...normalized,
    objectiveValue: numeric(raw.ObjectiveValue),
    mipGap: numeric(raw.MipGap),
    timeLimitMs,
    runtimeMs: round(performanceNow() - timings.startedAt, 3),
    modelConstructionMs: round(timings.modelConstructionMs, 3),
    wasmInitializationMs: round(timings.wasmInitializationMs, 3),
    solveRuntimeMs: round(timings.solveRuntimeMs, 3),
    modelHash: modelHash(project),
    scenarioHashes: patches.map((patch) => scenarioHash(patch)),
    problemHash: fnv1a(problem),
    message: message || normalized.status,
  };
}

function performanceNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function lpTerm(coefficient: number, variable: string): string {
  if (Math.abs(coefficient) < 1e-12) return '';
  const magnitude = Math.abs(coefficient);
  const coeff = Math.abs(magnitude - 1) < 1e-12 ? '' : `${round(magnitude)} `;
  return `${coefficient < 0 ? '- ' : '+ '}${coeff}${variable}`;
}

function expression(terms: Array<[number, string]>): string {
  const text = terms.map(([coefficient, variable]) => lpTerm(coefficient, variable)).filter(Boolean).join(' ');
  return text.replace(/^\+\s*/, '') || '0';
}

function activeArcs(project: NetworkProject): Array<{ linkId: string; source: string; target: string; direction: 'forward' | 'reverse' }> {
  const arcs: Array<{ linkId: string; source: string; target: string; direction: 'forward' | 'reverse' }> = [];
  const availableNodes = new Set(project.nodes.filter((node) => node.available !== false).map((node) => node.id));
  for (const link of project.links) {
    if (link.available === false || !availableNodes.has(link.source) || !availableNodes.has(link.target)) continue;
    arcs.push({ linkId: link.id, source: link.source, target: link.target, direction: 'forward' });
    if (link.bidirectional !== false) arcs.push({ linkId: link.id, source: link.target, target: link.source, direction: 'reverse' });
  }
  return arcs;
}

export const ROUTING_LP_RECOMMENDED_MAX_FLOW_VARIABLES = 10_000;
export const CAPACITY_MILP_RECOMMENDED_MAX_DECISION_SCENARIO_PRODUCT = 10_000;

export interface TrafficAllocationLPEstimate {
  directedArcs: number;
  demands: number;
  flowVariables: number;
  totalVariables: number;
  constraints: number;
  recommended: boolean;
  reason: string;
}

export function estimateTrafficAllocationLP(project: NetworkProject): TrafficAllocationLPEstimate {
  const arcs = activeArcs(project).length;
  const flowVariables = project.demands.length * arcs;
  const constraints = project.demands.length * project.nodes.length + project.links.filter((link) => link.available !== false).length;
  const recommended = flowVariables <= ROUTING_LP_RECOMMENDED_MAX_FLOW_VARIABLES;
  return {
    directedArcs: arcs,
    demands: project.demands.length,
    flowVariables,
    totalVariables: flowVariables + 1,
    constraints,
    recommended,
    reason: recommended
      ? `Estimated ${flowVariables.toLocaleString()} flow variables are within the measured Phase 3.5C routing-LP envelope.`
      : `Estimated ${flowVariables.toLocaleString()} flow variables exceed the measured Phase 3.5C routing-LP envelope of ${ROUTING_LP_RECOMMENDED_MAX_FLOW_VARIABLES.toLocaleString()}; deterministic routing and Change Plan analysis remain available.`,
  };
}

export function buildTrafficAllocationLP(project: NetworkProject): { problem: string; variables: Array<{ name: string; demandId: string; linkId: string; direction: 'forward' | 'reverse' }> } {
  const arcs = activeArcs(project);
  const variables: Array<{ name: string; demandId: string; linkId: string; direction: 'forward' | 'reverse' }> = [];
  const outgoingArcIndexes = new Map<string, number[]>();
  const incomingArcIndexes = new Map<string, number[]>();
  const arcIndexesByLink = new Map<string, number[]>();
  arcs.forEach((arc, arcIndex) => {
    const outgoing = outgoingArcIndexes.get(arc.source) ?? [];
    outgoing.push(arcIndex); outgoingArcIndexes.set(arc.source, outgoing);
    const incoming = incomingArcIndexes.get(arc.target) ?? [];
    incoming.push(arcIndex); incomingArcIndexes.set(arc.target, incoming);
    const linkIndexes = arcIndexesByLink.get(arc.linkId) ?? [];
    linkIndexes.push(arcIndex); arcIndexesByLink.set(arc.linkId, linkIndexes);
  });

  project.demands.forEach((demand, demandIndex) => {
    arcs.forEach((arc, arcIndex) => variables.push({ name: `f_${demandIndex}_${arcIndex}`, demandId: demand.id, linkId: arc.linkId, direction: arc.direction }));
  });
  const lines = ['Minimize', ' obj: t', 'Subject To'];
  project.demands.forEach((demand, demandIndex) => {
    project.nodes.forEach((node, nodeIndex) => {
      const terms: Array<[number, string]> = [];
      for (const arcIndex of outgoingArcIndexes.get(node.id) ?? []) terms.push([1, `f_${demandIndex}_${arcIndex}`]);
      for (const arcIndex of incomingArcIndexes.get(node.id) ?? []) terms.push([-1, `f_${demandIndex}_${arcIndex}`]);
      const rhs = node.id === demand.source ? demand.bandwidthGbps : node.id === demand.target ? -demand.bandwidthGbps : 0;
      lines.push(` flow_${demandIndex}_${nodeIndex}: ${expression(terms)} = ${round(rhs)}`);
    });
  });
  project.links.forEach((link, linkIndex) => {
    if (link.available === false) return;
    const arcIndexes = arcIndexesByLink.get(link.id) ?? [];
    const terms: Array<[number, string]> = [];
    project.demands.forEach((_, demandIndex) => {
      for (const arcIndex of arcIndexes) terms.push([1, `f_${demandIndex}_${arcIndex}`]);
    });
    terms.push([-link.capacityGbps, 't']);
    lines.push(` capacity_${linkIndex}: ${expression(terms)} <= 0`);
  });
  lines.push('Bounds', ' t >= 0');
  for (const variable of variables) lines.push(` ${variable.name} >= 0`);
  lines.push('End');
  return { problem: lines.join('\n'), variables };
}

export function verifyTrafficAllocationSolution(
  project: NetworkProject,
  allocations: TrafficAllocationResult['allocations'],
  maxUtilizationPct: number | null,
  tolerance = 1e-6,
): TrafficAllocationVerification {
  const violations: string[] = [];
  const arcs = activeArcs(project);
  const arcKey = new Set(arcs.map((arc) => `${arc.linkId}:${arc.direction}:${arc.source}:${arc.target}`));
  const demandById = new Map(project.demands.map((demand) => [demand.id, demand]));
  const linkById = new Map(project.links.map((link) => [link.id, link]));
  const flowByDemandNode = new Map<string, number>();
  const linkLoads = new Map<string, number>();
  let nonnegativeFlows = true;

  for (const row of allocations) {
    if (!Number.isFinite(row.flowGbps) || row.flowGbps < -tolerance) { nonnegativeFlows = false; violations.push(`Non-finite or negative flow for ${row.demandId}/${row.linkId}.`); continue; }
    const demand = demandById.get(row.demandId);
    const link = linkById.get(row.linkId);
    if (!demand || !link) { violations.push(`Allocation references unknown demand/link ${row.demandId}/${row.linkId}.`); continue; }
    const source = row.direction === 'forward' ? link.source : link.target;
    const target = row.direction === 'forward' ? link.target : link.source;
    if (!arcKey.has(`${row.linkId}:${row.direction}:${source}:${target}`)) { violations.push(`Allocation uses unavailable or invalid arc ${row.linkId}/${row.direction}.`); continue; }
    flowByDemandNode.set(`${row.demandId}:${source}`, (flowByDemandNode.get(`${row.demandId}:${source}`) ?? 0) + row.flowGbps);
    flowByDemandNode.set(`${row.demandId}:${target}`, (flowByDemandNode.get(`${row.demandId}:${target}`) ?? 0) - row.flowGbps);
    linkLoads.set(row.linkId, (linkLoads.get(row.linkId) ?? 0) + row.flowGbps);
  }

  let flowConservation = true;
  for (const demand of project.demands) {
    for (const node of project.nodes) {
      const expected = node.id === demand.source ? demand.bandwidthGbps : node.id === demand.target ? -demand.bandwidthGbps : 0;
      const actual = flowByDemandNode.get(`${demand.id}:${node.id}`) ?? 0;
      if (Math.abs(actual - expected) > tolerance) { flowConservation = false; violations.push(`Flow conservation failed for ${demand.id} at ${node.id}: ${actual} vs ${expected}.`); }
    }
  }

  let capacityConstraints = true;
  let computedMaxUtilizationPct = 0;
  for (const link of project.links) {
    if (link.available === false) continue;
    const load = linkLoads.get(link.id) ?? 0;
    const utilization = (load / link.capacityGbps) * 100;
    computedMaxUtilizationPct = Math.max(computedMaxUtilizationPct, utilization);
    if (maxUtilizationPct !== null && load > link.capacityGbps * (maxUtilizationPct / 100) + tolerance) { capacityConstraints = false; violations.push(`Capacity envelope failed for ${link.id}.`); }
  }
  const objectiveConsistent = maxUtilizationPct !== null && Math.abs(computedMaxUtilizationPct - maxUtilizationPct) <= Math.max(tolerance, 1e-5);
  if (!objectiveConsistent) violations.push(`Reported max utilization ${maxUtilizationPct} does not match calculated ${computedMaxUtilizationPct}.`);
  return { valid: nonnegativeFlows && flowConservation && capacityConstraints && objectiveConsistent && violations.length === 0, nonnegativeFlows, flowConservation, capacityConstraints, objectiveConsistent, computedMaxUtilizationPct: round(computedMaxUtilizationPct), violations };
}

export async function optimizeRouting(project: NetworkProject, options: SolverRunOptions = {}): Promise<TrafficAllocationResult> {
  const timeLimitMs = Math.max(50, options.timeLimitMs ?? 5_000);
  const estimate = estimateTrafficAllocationLP(project);
  if (!estimate.recommended && !options.allowLargeModel) {
    return {
      diagnostics: {
        solver: HIGHS_SOLVER_NAME,
        solverVersion: HIGHS_PACKAGE_VERSION,
        status: 'Not recommended at this scale',
        proof: 'unknown',
        objectiveValue: null,
        mipGap: null,
        timedOut: false,
        timeLimitMs,
        runtimeMs: 0,
        modelConstructionMs: 0,
        wasmInitializationMs: 0,
        solveRuntimeMs: 0,
        modelHash: modelHash(project),
        scenarioHashes: [scenarioHash(null)],
        problemHash: fnv1a(`routing-lp-guard:${estimate.flowVariables}:${estimate.constraints}`),
        message: estimate.reason,
      },
      maxUtilizationPct: null,
      allocations: [],
      verification: null,
    };
  }
  const startedAt = performanceNow();
  const modelStartedAt = performanceNow();
  const { problem, variables } = buildTrafficAllocationLP(project);
  const modelConstructionMs = performanceNow() - modelStartedAt;
  const wasmStartedAt = performanceNow();
  const highs = await loadHighs(options);
  const wasmInitializationMs = performanceNow() - wasmStartedAt;
  const solveStartedAt = performanceNow();
  const raw = highs.solve(problem, { output_flag: false, time_limit: timeLimitMs / 1000 });
  const solveRuntimeMs = performanceNow() - solveStartedAt;
  let diagnostics = diagnosticsFrom(raw, project, [null], problem, { startedAt, modelConstructionMs, wasmInitializationMs, solveRuntimeMs }, timeLimitMs);
  const allocations = variables.map((variable) => ({ ...variable, flowGbps: round(numeric(raw.Columns?.[variable.name]?.Primal) ?? 0) })).filter((row) => row.flowGbps > 1e-8);
  const t = numeric(raw.Columns?.t?.Primal);
  const maxUtilizationPct = t === null ? null : round(t * 100);
  const hasSolution = diagnostics.proof === 'optimal' || diagnostics.proof === 'feasible-incumbent';
  const verification = hasSolution ? verifyTrafficAllocationSolution(project, allocations, maxUtilizationPct) : null;
  if (verification && !verification.valid) {
    diagnostics = { ...diagnostics, proof: 'unknown', status: `Invalid primal (${diagnostics.status})`, message: `Solver primal failed independent verification: ${verification.violations.join(' ')}` };
  }
  return { diagnostics, maxUtilizationPct, allocations, verification };
}

interface UpgradeVariable { name: string; linkId: string; optionIndex: number; fromCapacityGbps: number; toCapacityGbps: number; deltaCapacityGbps: number; cost: number }

function normalizedRequirements(requirements: CapacityPlanRequirements): CapacityOptimizationResult['requirements'] {
  const targetUtilizationPct = Number(requirements.targetUtilizationPct ?? 80);
  if (!Number.isFinite(targetUtilizationPct) || targetUtilizationPct <= 0 || targetUtilizationPct > 100) throw new Error('targetUtilizationPct must be in (0,100].');
  const budget = requirements.budgetCostUnits;
  if (budget !== undefined && (!Number.isFinite(budget) || budget < 0)) throw new Error('budgetCostUnits must be >= 0.');
  const lockedLinkIds = [...new Set((requirements.lockedLinkIds ?? []).map(String).filter(Boolean))].sort();
  return { targetUtilizationPct, includeBaseline: requirements.includeBaseline ?? true, budgetCostUnits: budget ?? null, lockedLinkIds };
}

function selectedPatches(requirements: CapacityPlanRequirements): Array<ScenarioPatch | null> {
  const patches: Array<ScenarioPatch | null> = [];
  if (requirements.includeBaseline ?? true) patches.push(null);
  for (const patch of requirements.scenarioPatches ?? []) if (!patches.some((item) => scenarioHash(item) === scenarioHash(patch))) patches.push(patch);
  return patches.length ? patches : [null];
}

export interface CapacityMILPEstimate {
  decisionVariables: number;
  scenarioCount: number;
  decisionScenarioProduct: number;
  estimatedConstraints: number;
  recommended: boolean;
  reason: string;
}

export function estimateCapacityMILP(project: NetworkProject, requirementsInput: CapacityPlanRequirements = {}): CapacityMILPEstimate {
  const requirements = normalizedRequirements(requirementsInput);
  const locked = new Set(requirements.lockedLinkIds);
  const decisionVariables = project.links.reduce((sum, link) => sum + (locked.has(link.id) ? 0 : (link.upgradeOptions ?? []).filter((option) => option.capacityGbps > link.capacityGbps + 1e-9).length), 0);
  const scenarioCount = selectedPatches(requirementsInput).length;
  const decisionScenarioProduct = decisionVariables * scenarioCount;
  const estimatedConstraints = project.links.filter((link) => (link.upgradeOptions ?? []).some((option) => option.capacityGbps > link.capacityGbps + 1e-9) && !locked.has(link.id)).length
    + (requirements.budgetCostUnits === null ? 0 : 1)
    + scenarioCount * project.links.length;
  const recommended = decisionScenarioProduct <= CAPACITY_MILP_RECOMMENDED_MAX_DECISION_SCENARIO_PRODUCT;
  return {
    decisionVariables,
    scenarioCount,
    decisionScenarioProduct,
    estimatedConstraints,
    recommended,
    reason: recommended
      ? `Estimated ${decisionVariables.toLocaleString()} decisions across ${scenarioCount.toLocaleString()} scenario(s) are within the measured Phase 3.5C capacity-MILP envelope.`
      : `Estimated decision×scenario workload ${decisionScenarioProduct.toLocaleString()} exceeds the measured Phase 3.5C capacity-MILP envelope of ${CAPACITY_MILP_RECOMMENDED_MAX_DECISION_SCENARIO_PRODUCT.toLocaleString()}.`,
  };
}

export function buildCapacityUpgradeMILP(project: NetworkProject, requirementsInput: CapacityPlanRequirements = {}): {
  problem: string;
  variables: UpgradeVariable[];
  requirements: CapacityOptimizationResult['requirements'];
  patches: Array<ScenarioPatch | null>;
  preflightError: string | null;
} {
  const requirements = normalizedRequirements(requirementsInput);
  const patches = selectedPatches(requirementsInput);
  const ratio = requirements.targetUtilizationPct / 100;
  const variables: UpgradeVariable[] = [];
  const lockedLinkIds = new Set(requirements.lockedLinkIds);
  for (const linkId of lockedLinkIds) if (!project.links.some((link) => link.id === linkId)) throw new Error(`lockedLinkIds contains unknown link ${linkId}.`);
  project.links.forEach((link, linkIndex) => {
    if (lockedLinkIds.has(link.id)) return;
    (link.upgradeOptions ?? []).forEach((option, optionIndex) => {
      if (option.capacityGbps <= link.capacityGbps + 1e-9) return;
      variables.push({ name: `u_${linkIndex}_${optionIndex}`, linkId: link.id, optionIndex, fromCapacityGbps: link.capacityGbps, toCapacityGbps: option.capacityGbps, deltaCapacityGbps: option.capacityGbps - link.capacityGbps, cost: option.cost });
    });
  });

  const lines = ['Minimize', ` obj: ${expression(variables.map((variable) => [variable.cost, variable.name]))}`, 'Subject To'];
  project.links.forEach((link, linkIndex) => {
    const choices = variables.filter((variable) => variable.linkId === link.id);
    if (choices.length) lines.push(` choose_${linkIndex}: ${expression(choices.map((variable) => [1, variable.name]))} <= 1`);
  });
  if (requirements.budgetCostUnits !== null && variables.length) lines.push(` budget: ${expression(variables.map((variable) => [variable.cost, variable.name]))} <= ${round(requirements.budgetCostUnits)}`);

  let preflightError: string | null = null;
  patches.forEach((patch, scenarioIndex) => {
    const snapshot = applyScenario(project, patch);
    const routing = routeProject(snapshot);
    if (routing.unroutedDemandIds.length && !preflightError) preflightError = `Scenario ${patch?.name ?? 'Baseline'} has unrouted demand (${routing.unroutedDemandIds.join(', ')}); capacity-only upgrades cannot repair missing connectivity.`;
    snapshot.links.forEach((snapshotLink, linkIndex) => {
      if (snapshotLink.available === false) return;
      const canonical = project.links.find((link) => link.id === snapshotLink.id);
      if (!canonical) return;
      if (patch?.linkCapacityOverrides.some((entry) => entry.linkId === snapshotLink.id) && !preflightError) preflightError = `Scenario ${patch.name} overrides ${snapshotLink.id} capacity; capacity-upgrade optimization requires scenario capacity to derive from the candidate project.`;
      const load = routing.linkLoadsGbps[snapshotLink.id] ?? 0;
      const rhs = load - ratio * snapshotLink.capacityGbps;
      if (rhs <= 1e-9) return;
      const choices = variables.filter((variable) => variable.linkId === snapshotLink.id);
      const maxImprovement = choices.reduce((best, variable) => Math.max(best, ratio * variable.deltaCapacityGbps), 0);
      if (lockedLinkIds.has(snapshotLink.id) && !preflightError) preflightError = `Link ${snapshotLink.id} is locked by the Change Plan and cannot be upgraded to satisfy ${requirements.targetUtilizationPct}% utilization in scenario ${patch?.name ?? 'Baseline'}.`;
      else if (maxImprovement + 1e-9 < rhs && !preflightError) preflightError = `No discrete upgrade option on ${snapshotLink.id} can satisfy ${requirements.targetUtilizationPct}% utilization in scenario ${patch?.name ?? 'Baseline'}.`;
      lines.push(` cap_${scenarioIndex}_${linkIndex}: ${expression(choices.map((variable) => [ratio * variable.deltaCapacityGbps, variable.name]))} >= ${round(rhs)}`);
    });
  });
  lines.push('Bounds');
  for (const variable of variables) lines.push(` 0 <= ${variable.name} <= 1`);
  if (variables.length) lines.push('Binaries', ` ${variables.map((variable) => variable.name).join(' ')}`);
  lines.push('End');
  return { problem: lines.join('\n'), variables, requirements, patches, preflightError };
}

function syntheticDiagnostics(project: NetworkProject, patches: Array<ScenarioPatch | null>, problem: string, timeLimitMs: number, status: string, proof: OptimizationProof, message: string): SolverDiagnostics {
  return { solver: HIGHS_SOLVER_NAME, solverVersion: HIGHS_PACKAGE_VERSION, status, proof, objectiveValue: null, mipGap: null, timedOut: false, timeLimitMs, runtimeMs: 0, modelConstructionMs: 0, wasmInitializationMs: 0, solveRuntimeMs: 0, modelHash: modelHash(project), scenarioHashes: patches.map((patch) => scenarioHash(patch)), problemHash: fnv1a(problem), message };
}

export async function optimizeCapacityPlan(project: NetworkProject, requirementsInput: CapacityPlanRequirements = {}, options: SolverRunOptions = {}): Promise<CapacityOptimizationResult> {
  const timeLimitMs = Math.max(50, options.timeLimitMs ?? 8_000);
  const capacityEstimate = estimateCapacityMILP(project, requirementsInput);
  if (!capacityEstimate.recommended && !options.allowLargeModel) {
    const requirements = normalizedRequirements(requirementsInput);
    const patches = selectedPatches(requirementsInput);
    const problem = `capacity-milp-guard:${capacityEstimate.decisionVariables}:${capacityEstimate.scenarioCount}`;
    return {
      diagnostics: syntheticDiagnostics(project, patches, problem, timeLimitMs, 'Not recommended at this scale', 'unknown', capacityEstimate.reason),
      candidate: null,
      selectedUpgrades: [],
      requirements,
      scenarioHashes: patches.map((patch) => scenarioHash(patch)),
    };
  }
  const startedAt = performanceNow();
  const modelStartedAt = performanceNow();
  const built = buildCapacityUpgradeMILP(project, requirementsInput);
  const modelConstructionMs = performanceNow() - modelStartedAt;
  const scenarioHashes = built.patches.map((patch) => scenarioHash(patch));
  if (built.preflightError) return { diagnostics: syntheticDiagnostics(project, built.patches, built.problem, timeLimitMs, 'Infeasible', 'infeasible', built.preflightError), candidate: null, selectedUpgrades: [], requirements: built.requirements, scenarioHashes };
  if (!built.variables.length) return { diagnostics: syntheticDiagnostics(project, built.patches, built.problem, timeLimitMs, 'Optimal', 'optimal', 'No upgrade decisions are required or available.'), candidate: null, selectedUpgrades: [], requirements: built.requirements, scenarioHashes };

  const wasmStartedAt = performanceNow();
  const highs = await loadHighs(options);
  const wasmInitializationMs = performanceNow() - wasmStartedAt;
  const solveStartedAt = performanceNow();
  const raw = highs.solve(built.problem, { output_flag: false, time_limit: timeLimitMs / 1000, mip_rel_gap: 0 });
  const solveRuntimeMs = performanceNow() - solveStartedAt;
  const diagnostics = diagnosticsFrom(raw, project, built.patches, built.problem, { startedAt, modelConstructionMs, wasmInitializationMs, solveRuntimeMs }, timeLimitMs);
  const selectedUpgrades = built.variables.filter((variable) => (numeric(raw.Columns?.[variable.name]?.Primal) ?? 0) > 0.5).map(({ linkId, fromCapacityGbps, toCapacityGbps, cost }) => ({ linkId, fromCapacityGbps, toCapacityGbps, cost })).sort((a, b) => a.linkId.localeCompare(b.linkId));
  const canReturnCandidate = diagnostics.proof === 'optimal' || diagnostics.proof === 'feasible-incumbent';
  const objective = diagnostics.objectiveValue ?? selectedUpgrades.reduce((sum, item) => sum + item.cost, 0);
  const candidate: CandidatePlan | null = canReturnCandidate && selectedUpgrades.length ? {
    id: `candidate:highs:${modelHash(project)}:${fnv1a(built.problem)}`,
    name: diagnostics.proof === 'optimal' ? 'Minimum-cost HiGHS capacity plan' : 'Best feasible HiGHS incumbent',
    baseModelHash: modelHash(project),
    commands: selectedUpgrades.map((upgrade) => ({ id: `cmd-opt-${upgrade.linkId}`, type: 'set_link_capacity', actor: 'agent', args: { linkId: upgrade.linkId, capacityGbps: upgrade.toCapacityGbps }, createdAt: new Date(0).toISOString() })),
    objective: { name: diagnostics.proof === 'optimal' ? 'minimumUpgradeCost' : 'incumbentUpgradeCost', value: round(objective), unit: 'cost-units' },
    rationaleEvidenceIds: [`optimizer:${diagnostics.problemHash}`, ...scenarioHashes.map((hash) => `scenario:${hash}`)],
  } : null;
  return { diagnostics, candidate, selectedUpgrades, requirements: built.requirements, scenarioHashes };
}

export function verifyCapacityCandidate(project: NetworkProject, candidate: CandidatePlan, requirementsInput: CapacityPlanRequirements = {}): CandidateVerification {
  const requirements = normalizedRequirements(requirementsInput);
  const patches = selectedPatches(requirementsInput);
  const violations: string[] = [];
  const lockedLinkIds = new Set(requirements.lockedLinkIds);
  if (candidate.baseModelHash !== modelHash(project)) violations.push('Candidate baseModelHash does not match the project snapshot.');
  let candidateProject: NetworkProject | null = null;
  try { candidateProject = applyCandidatePlan(project, candidate); } catch (error) { violations.push(error instanceof Error ? error.message : 'Candidate application failed.'); }
  let calculatedCost = 0;
  for (const command of candidate.commands) {
    if (command.type !== 'set_link_capacity') { violations.push(`Unsupported optimizer command ${command.type}.`); continue; }
    const linkId = String(command.args.linkId ?? '');
    const capacityGbps = Number(command.args.capacityGbps);
    const link = project.links.find((item) => item.id === linkId);
    if (lockedLinkIds.has(linkId)) violations.push(`Candidate modifies locked link ${linkId}.`);
    const option = link?.upgradeOptions?.find((item) => Math.abs(item.capacityGbps - capacityGbps) < 1e-9);
    if (!link || !option) { violations.push(`${linkId || 'unknown link'} capacity ${capacityGbps} is not a declared discrete upgrade option.`); continue; }
    calculatedCost += option.cost;
  }
  const expectedCost = Number(candidate.objective.value);
  const objectiveMatches = Number.isFinite(expectedCost) && Math.abs(calculatedCost - expectedCost) <= 1e-6;
  if (!objectiveMatches) violations.push(`Candidate objective ${expectedCost} does not equal independently calculated cost ${calculatedCost}.`);
  if (requirements.budgetCostUnits !== null && calculatedCost > requirements.budgetCostUnits + 1e-9) violations.push(`Candidate cost ${calculatedCost} exceeds budget ${requirements.budgetCostUnits}.`);

  if (candidateProject) {
    const ratio = requirements.targetUtilizationPct / 100;
    for (const patch of patches) {
      const snapshot = applyScenario(candidateProject, patch);
      const routing = routeProject(snapshot);
      if (routing.unroutedDemandIds.length) violations.push(`${patch?.name ?? 'Baseline'} leaves demands unrouted: ${routing.unroutedDemandIds.join(', ')}.`);
      for (const link of snapshot.links) {
        if (link.available === false) continue;
        const load = routing.linkLoadsGbps[link.id] ?? 0;
        if (load > link.capacityGbps * ratio + 1e-7) violations.push(`${patch?.name ?? 'Baseline'}: ${link.id} load ${round(load)} exceeds ${requirements.targetUtilizationPct}% target on ${link.capacityGbps} Gbps.`);
      }
    }
  }
  const constraintsSatisfied = violations.length === 0;
  return {
    status: constraintsSatisfied && objectiveMatches ? 'verified' : 'disagreement',
    modelHash: modelHash(project), candidateBaseModelHash: candidate.baseModelHash,
    candidateResultModelHash: candidateProject ? modelHash(candidateProject) : null,
    objectiveMatches, constraintsSatisfied, calculatedCost: Number.isFinite(calculatedCost) ? round(calculatedCost) : null,
    expectedCost, violations, checkedScenarioHashes: patches.map((patch) => scenarioHash(patch)), verifier: 'deterministic-independent-checker-v1',
  };
}
