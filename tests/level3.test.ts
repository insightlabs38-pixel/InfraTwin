import test from 'node:test';
import assert from 'node:assert/strict';
import type { CandidatePlan, NetworkProject, ScenarioPatch } from '../packages/model/src/index.ts';
import { applyCandidatePlan, invertCandidatePlan, modelHash } from '../packages/model/src/index.ts';
import { runLinkContingencies } from '../packages/evidence/src/index.ts';
import { getScenarioDefinition, loadGrowthWall, loadResilienceGap } from '../packages/scenarios/src/index.ts';
import {
  HIGHS_PACKAGE_VERSION,
  normalizeSolverStatus,
  optimizeCapacityPlan,
  optimizeRouting,
  verifyCapacityCandidate,
  type CapacityOptimizationResult,
  type CapacityPlanRequirements,
  type CandidateVerification,
  type TrafficAllocationResult,
} from '../packages/optimizer/src/index.ts';
import {
  OPTIMIZER_TOOL_NAMES,
  registerOptimizerTools,
  type InfraTwinToolServices,
  type ModelContextLike,
  type ToolActivityEvent,
  type WebMCPTool,
} from '../packages/webmcp/src/index.ts';

function serviceClasses() {
  return [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 100, allowShedding: false }];
}

function diamondProject(): NetworkProject {
  return {
    schemaVersion: '0.1', id: 'l3-diamond', name: 'Level 3 diamond LP',
    nodes: ['A', 'B', 'C', 'D'].map((id) => ({ id, name: id })),
    links: [
      { id: 'AB', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: true },
      { id: 'AC', source: 'A', target: 'C', capacityGbps: 10, weight: 1, bidirectional: true },
      { id: 'BD', source: 'B', target: 'D', capacityGbps: 10, weight: 1, bidirectional: true },
      { id: 'CD', source: 'C', target: 'D', capacityGbps: 10, weight: 1, bidirectional: true },
    ],
    demands: [{ id: 'D1', source: 'A', target: 'D', bandwidthGbps: 8, serviceClassId: 'gold' }],
    serviceClasses: serviceClasses(), routingProfile: { mode: 'ecmp' },
  };
}

function disconnectedProject(): NetworkProject {
  return {
    schemaVersion: '0.1', id: 'l3-disconnected', name: 'Level 3 infeasible LP',
    nodes: ['A', 'B', 'C'].map((id) => ({ id, name: id })),
    links: [{ id: 'AB', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: true }],
    demands: [{ id: 'D1', source: 'A', target: 'C', bandwidthGbps: 4, serviceClassId: 'gold' }],
    serviceClasses: serviceClasses(), routingProfile: { mode: 'ecmp' },
  };
}

function growthPatch(): ScenarioPatch {
  const definition = getScenarioDefinition('growth-wall');
  return {
    id: 'l3-growth-1.4', name: 'Growth Wall +40%', disabledNodeIds: [], disabledLinkIds: [],
    demandMultipliers: (definition.growthDemandIds ?? []).map((demandId) => ({ demandId, multiplier: 1.4 })),
    addedDemands: [], linkCapacityOverrides: [],
  };
}

const growthRequirements = (budgetCostUnits?: number): CapacityPlanRequirements => ({
  targetUtilizationPct: 80,
  budgetCostUnits,
  includeBaseline: true,
  scenarioPatches: [growthPatch()],
});

test('Level 3 reference LP: HiGHS minimizes diamond maximum utilization to 40%', async () => {
  const result = await optimizeRouting(diamondProject(), { timeLimitMs: 5_000 });
  assert.equal(result.diagnostics.solverVersion, HIGHS_PACKAGE_VERSION);
  assert.equal(result.diagnostics.proof, 'optimal');
  assert.equal(result.maxUtilizationPct, 40);
  assert.equal(result.allocations.filter((row) => row.flowGbps > 0).reduce((sum, row) => sum + row.flowGbps, 0), 16);
});

test('Level 3 reference LP: disconnected demand is explicitly infeasible', async () => {
  const result = await optimizeRouting(disconnectedProject(), { timeLimitMs: 5_000 });
  assert.equal(result.diagnostics.proof, 'infeasible');
  assert.match(result.diagnostics.status.toLowerCase(), /infeasible/);
});

test('Growth Wall MILP finds the proven minimum-cost 22 Gbps G2 upgrade at cost 6', async () => {
  const project = loadGrowthWall();
  const result = await optimizeCapacityPlan(project, growthRequirements(), { timeLimitMs: 8_000 });
  assert.equal(result.diagnostics.proof, 'optimal');
  assert.equal(result.diagnostics.objectiveValue, 6);
  assert.deepEqual(result.selectedUpgrades, [{ linkId: 'G2', fromCapacityGbps: 20, toCapacityGbps: 22, cost: 6 }]);
  assert.ok(result.candidate);
  assert.equal(result.candidate?.objective.name, 'minimumUpgradeCost');
});

test('Growth Wall MILP explains infeasibility when budget is below the cheapest valid upgrade', async () => {
  const result = await optimizeCapacityPlan(loadGrowthWall(), growthRequirements(5), { timeLimitMs: 8_000 });
  assert.equal(result.diagnostics.proof, 'infeasible');
  assert.equal(result.candidate, null);
});

test('Resilience Gap selected worst failure requires both southern 14 Gbps upgrades at cost 8', async () => {
  const project = loadResilienceGap();
  const worst = runLinkContingencies(project).worst;
  assert.equal(worst?.linkId, 'R2');
  const requirements: CapacityPlanRequirements = { targetUtilizationPct: 80, includeBaseline: true, scenarioPatches: [worst!.patch] };
  const result = await optimizeCapacityPlan(project, requirements, { timeLimitMs: 8_000 });
  assert.equal(result.diagnostics.proof, 'optimal');
  assert.equal(result.diagnostics.objectiveValue, 8);
  assert.deepEqual(result.selectedUpgrades, [
    { linkId: 'R4', fromCapacityGbps: 10, toCapacityGbps: 14, cost: 4 },
    { linkId: 'R5', fromCapacityGbps: 10, toCapacityGbps: 14, cost: 4 },
  ]);
});

test('time-limit status can expose an incumbent but never claims optimality', () => {
  assert.deepEqual(normalizeSolverStatus('Time limit reached', true), { status: 'Time limit reached', proof: 'feasible-incumbent', timedOut: true });
  assert.deepEqual(normalizeSolverStatus('Time limit reached', false), { status: 'Time limit reached', proof: 'unknown', timedOut: true });
});

test('independent verifier confirms a valid optimizer candidate and blocks tampered evidence', async () => {
  const project = loadGrowthWall();
  const requirements = growthRequirements();
  const optimized = await optimizeCapacityPlan(project, requirements, { timeLimitMs: 8_000 });
  assert.ok(optimized.candidate);
  const verified = verifyCapacityCandidate(project, optimized.candidate!, requirements);
  assert.equal(verified.status, 'verified');
  assert.equal(verified.calculatedCost, 6);

  const tampered: CandidatePlan = JSON.parse(JSON.stringify(optimized.candidate)) as CandidatePlan;
  tampered.objective.value = 1;
  const disagreement = verifyCapacityCandidate(project, tampered, requirements);
  assert.equal(disagreement.status, 'disagreement');
  assert.ok(disagreement.violations.some((message) => message.includes('independently calculated cost')));
});

test('optimizer candidates are reversible back to the exact original model hash', async () => {
  const project = loadGrowthWall();
  const optimized = await optimizeCapacityPlan(project, growthRequirements(), { timeLimitMs: 8_000 });
  assert.ok(optimized.candidate);
  const undo = invertCandidatePlan(project, optimized.candidate!);
  const applied = applyCandidatePlan(project, optimized.candidate!);
  const restored = applyCandidatePlan(applied, undo);
  assert.equal(modelHash(restored), modelHash(project));
});

test('inverse preserves an originally absent optional availability property', () => {
  const project = loadGrowthWall();
  const linkId = project.links[0].id;
  delete project.links[0].available;
  const candidate: CandidatePlan = {
    id: 'candidate:availability-round-trip',
    name: 'Availability round trip',
    baseModelHash: modelHash(project),
    commands: [{ id: 'cmd-disable', type: 'set_link_availability', actor: 'agent', args: { linkId, available: false }, createdAt: new Date(0).toISOString() }],
    objective: { name: 'test', value: 0 },
    rationaleEvidenceIds: [],
  };
  const undo = invertCandidatePlan(project, candidate);
  const restored = applyCandidatePlan(applyCandidatePlan(project, candidate), undo);
  assert.equal(modelHash(restored), modelHash(project));
  assert.equal(Object.prototype.hasOwnProperty.call(restored.links.find((link) => link.id === linkId)!, 'available'), false);
});

test('optimizer WebMCP group exposes candidate-only solve, routing LP, and independent verification', async () => {
  let project = loadGrowthWall();
  let patch: ScenarioPatch | null = growthPatch();
  let candidate: CandidatePlan | null = null;
  let optimization: CapacityOptimizationResult | null = null;
  let verification: CandidateVerification | null = null;
  const activities: ToolActivityEvent[] = [];
  const tools = new Map<string, WebMCPTool>();
  const signals = new Map<string, AbortSignal | undefined>();
  const context: ModelContextLike = { registerTool(tool, options) { tools.set(tool.name, tool); signals.set(tool.name, options?.signal); } };
  const services: InfraTwinToolServices = {
    getProject: () => project,
    setProject: (next) => { project = next; },
    getActiveScenario: () => patch,
    setActiveScenario: (next) => { patch = next; },
    publishCapacityAnalysis: () => {},
    publishContingencyAnalysis: () => {},
    getCandidate: () => candidate,
    setCandidate: (next) => { candidate = next; },
    publishCandidateComparison: () => {},
    onActivity: (event) => activities.push(event),
    optimizeCapacity: async (requirements) => optimizeCapacityPlan(project, requirements, { timeLimitMs: 8_000 }),
    optimizeRouting: async () => optimizeRouting(project, { timeLimitMs: 5_000 }),
    verifyCandidate: async (nextCandidate, requirements) => verifyCapacityCandidate(project, nextCandidate, requirements),
    publishOptimizationResult: (result) => { optimization = result; },
    publishCandidateVerification: (result) => { verification = result; },
  };

  const dispose = await registerOptimizerTools(context, services);
  assert.deepEqual([...tools.keys()], [...OPTIMIZER_TOOL_NAMES]);
  assert.equal(tools.get('optimize_capacity_plan')?.annotations?.readOnlyHint, false);
  assert.equal(tools.get('optimize_routing')?.annotations?.readOnlyHint, true);
  assert.equal(tools.get('verify_candidate')?.annotations?.readOnlyHint, true);

  await tools.get('optimize_capacity_plan')!.execute({ targetUtilizationPct: 80 });
  assert.equal((optimization as CapacityOptimizationResult | null)?.diagnostics.proof, 'optimal');
  assert.ok(candidate);
  assert.equal(modelHash(project), modelHash(loadGrowthWall()), 'optimizer tool must not mutate canonical project');

  const routeResult = await tools.get('optimize_routing')!.execute({}) as TrafficAllocationResult;
  assert.equal(routeResult.diagnostics.proof, 'optimal');
  await tools.get('verify_candidate')!.execute({ targetUtilizationPct: 80 });
  assert.equal((verification as CandidateVerification | null)?.status, 'verified');
  assert.ok(activities.some((event) => event.tool === 'optimize_capacity_plan' && event.status === 'success'));

  dispose();
  for (const name of OPTIMIZER_TOOL_NAMES) assert.equal(signals.get(name)?.aborted, true);
});
