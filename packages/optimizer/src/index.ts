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
  modelHash: string;
  scenarioHashes: string[];
  problemHash: string;
  message: string;
}

export interface TrafficAllocationResult {
  diagnostics: SolverDiagnostics;
  maxUtilizationPct: number | null;
  allocations: Array<{ demandId: string; linkId: string; direction: 'forward' | 'reverse'; flowGbps: number }>;
}

export interface CapacityPlanRequirements {
  targetUtilizationPct?: number;
  budgetCostUnits?: number;
  scenarioPatches?: ScenarioPatch[];
  includeBaseline?: boolean;
}

export interface CapacityOptimizationResult {
  diagnostics: SolverDiagnostics;
  candidate: CandidatePlan | null;
  selectedUpgrades: Array<{ linkId: string; fromCapacityGbps: number; toCapacityGbps: number; cost: number }>;
  requirements: Required<Pick<CapacityPlanRequirements, 'targetUtilizationPct' | 'includeBaseline'>> & { budgetCostUnits: number | null };
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
  startedAt: number,
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
    runtimeMs: round(performanceNow() - startedAt, 3),
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
  for (const link of project.links) {
    if (link.available === false) continue;
    arcs.push({ linkId: link.id, source: link.source, target: link.target, direction: 'forward' });
    if (link.bidirectional !== false) arcs.push({ linkId: link.id, source: link.target, target: link.source, direction: 'reverse' });
  }
  return arcs;
}

export function buildTrafficAllocationLP(project: NetworkProject): { problem: string; variables: Array<{ name: string; demandId: string; linkId: string; direction: 'forward' | 'reverse' }> } {
  const arcs = activeArcs(project);
  const variables: Array<{ name: string; demandId: string; linkId: string; direction: 'forward' | 'reverse' }> = [];
  project.demands.forEach((demand, demandIndex) => {
    arcs.forEach((arc, arcIndex) => variables.push({ name: `f_${demandIndex}_${arcIndex}`, demandId: demand.id, linkId: arc.linkId, direction: arc.direction }));
  });
  const lines = ['Minimize', ' obj: t', 'Subject To'];
  project.demands.forEach((demand, demandIndex) => {
    project.nodes.forEach((node, nodeIndex) => {
      const terms: Array<[number, string]> = [];
      arcs.forEach((arc, arcIndex) => {
        if (arc.source === node.id) terms.push([1, `f_${demandIndex}_${arcIndex}`]);
        if (arc.target === node.id) terms.push([-1, `f_${demandIndex}_${arcIndex}`]);
      });
      const rhs = node.id === demand.source ? demand.bandwidthGbps : node.id === demand.target ? -demand.bandwidthGbps : 0;
      lines.push(` flow_${demandIndex}_${nodeIndex}: ${expression(terms)} = ${round(rhs)}`);
    });
  });
  project.links.forEach((link, linkIndex) => {
    if (link.available === false) return;
    const terms: Array<[number, string]> = [];
    project.demands.forEach((_, demandIndex) => {
      arcs.forEach((arc, arcIndex) => { if (arc.linkId === link.id) terms.push([1, `f_${demandIndex}_${arcIndex}`]); });
    });
    terms.push([-link.capacityGbps, 't']);
    lines.push(` capacity_${linkIndex}: ${expression(terms)} <= 0`);
  });
  lines.push('Bounds', ' t >= 0');
  for (const variable of variables) lines.push(` ${variable.name} >= 0`);
  lines.push('End');
  return { problem: lines.join('\n'), variables };
}

export async function optimizeRouting(project: NetworkProject, options: SolverRunOptions = {}): Promise<TrafficAllocationResult> {
  const timeLimitMs = Math.max(50, options.timeLimitMs ?? 5_000);
  const { problem, variables } = buildTrafficAllocationLP(project);
  const startedAt = performanceNow();
  const highs = await loadHighs(options);
  const raw = highs.solve(problem, { output_flag: false, time_limit: timeLimitMs / 1000 });
  const diagnostics = diagnosticsFrom(raw, project, [null], problem, startedAt, timeLimitMs);
  const allocations = variables.map((variable) => ({ ...variable, flowGbps: round(numeric(raw.Columns?.[variable.name]?.Primal) ?? 0) })).filter((row) => row.flowGbps > 1e-8);
  const t = numeric(raw.Columns?.t?.Primal);
  return { diagnostics, maxUtilizationPct: t === null ? null : round(t * 100), allocations };
}

interface UpgradeVariable { name: string; linkId: string; optionIndex: number; fromCapacityGbps: number; toCapacityGbps: number; deltaCapacityGbps: number; cost: number }

function normalizedRequirements(requirements: CapacityPlanRequirements): CapacityOptimizationResult['requirements'] {
  const targetUtilizationPct = Number(requirements.targetUtilizationPct ?? 80);
  if (!Number.isFinite(targetUtilizationPct) || targetUtilizationPct <= 0 || targetUtilizationPct > 100) throw new Error('targetUtilizationPct must be in (0,100].');
  const budget = requirements.budgetCostUnits;
  if (budget !== undefined && (!Number.isFinite(budget) || budget < 0)) throw new Error('budgetCostUnits must be >= 0.');
  return { targetUtilizationPct, includeBaseline: requirements.includeBaseline ?? true, budgetCostUnits: budget ?? null };
}

function selectedPatches(requirements: CapacityPlanRequirements): Array<ScenarioPatch | null> {
  const patches: Array<ScenarioPatch | null> = [];
  if (requirements.includeBaseline ?? true) patches.push(null);
  for (const patch of requirements.scenarioPatches ?? []) if (!patches.some((item) => scenarioHash(item) === scenarioHash(patch))) patches.push(patch);
  return patches.length ? patches : [null];
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
  project.links.forEach((link, linkIndex) => {
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
      if (maxImprovement + 1e-9 < rhs && !preflightError) preflightError = `No discrete upgrade option on ${snapshotLink.id} can satisfy ${requirements.targetUtilizationPct}% utilization in scenario ${patch?.name ?? 'Baseline'}.`;
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
  return { solver: HIGHS_SOLVER_NAME, solverVersion: HIGHS_PACKAGE_VERSION, status, proof, objectiveValue: null, mipGap: null, timedOut: false, timeLimitMs, runtimeMs: 0, modelHash: modelHash(project), scenarioHashes: patches.map((patch) => scenarioHash(patch)), problemHash: fnv1a(problem), message };
}

export async function optimizeCapacityPlan(project: NetworkProject, requirementsInput: CapacityPlanRequirements = {}, options: SolverRunOptions = {}): Promise<CapacityOptimizationResult> {
  const timeLimitMs = Math.max(50, options.timeLimitMs ?? 8_000);
  const built = buildCapacityUpgradeMILP(project, requirementsInput);
  const scenarioHashes = built.patches.map((patch) => scenarioHash(patch));
  if (built.preflightError) return { diagnostics: syntheticDiagnostics(project, built.patches, built.problem, timeLimitMs, 'Infeasible', 'infeasible', built.preflightError), candidate: null, selectedUpgrades: [], requirements: built.requirements, scenarioHashes };
  if (!built.variables.length) return { diagnostics: syntheticDiagnostics(project, built.patches, built.problem, timeLimitMs, 'Optimal', 'optimal', 'No upgrade decisions are required or available.'), candidate: null, selectedUpgrades: [], requirements: built.requirements, scenarioHashes };

  const startedAt = performanceNow();
  const highs = await loadHighs(options);
  const raw = highs.solve(built.problem, { output_flag: false, time_limit: timeLimitMs / 1000, mip_rel_gap: 0 });
  const diagnostics = diagnosticsFrom(raw, project, built.patches, built.problem, startedAt, timeLimitMs);
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
  if (candidate.baseModelHash !== modelHash(project)) violations.push('Candidate baseModelHash does not match the project snapshot.');
  let candidateProject: NetworkProject | null = null;
  try { candidateProject = applyCandidatePlan(project, candidate); } catch (error) { violations.push(error instanceof Error ? error.message : 'Candidate application failed.'); }
  let calculatedCost = 0;
  for (const command of candidate.commands) {
    if (command.type !== 'set_link_capacity') { violations.push(`Unsupported optimizer command ${command.type}.`); continue; }
    const linkId = String(command.args.linkId ?? '');
    const capacityGbps = Number(command.args.capacityGbps);
    const link = project.links.find((item) => item.id === linkId);
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
