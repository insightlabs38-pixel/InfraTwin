import test from 'node:test';
import assert from 'node:assert/strict';
import type { CandidatePlan, NetworkProject, ScenarioPatch } from '../packages/model/src/index.ts';
import {
  applyCandidatePlan,
  applyScenario,
  cloneProject,
  createChangePlan,
  modelHash,
  scenarioHash,
  validateNetworkProject,
} from '../packages/model/src/index.ts';
import {
  compareCandidate,
  proposeCapacityMitigation,
  runGrowthAnalysis,
  runLinkContingencies,
  runScenarioCapacityAnalysis,
} from '../packages/evidence/src/index.ts';
import {
  getScenarioDefinition,
  listBundledScenarios,
  loadGrowthWall,
  loadMaintenanceTrap,
  loadResilienceGap,
} from '../packages/scenarios/src/index.ts';
import { CollaborativeWorkspaceService } from '../packages/application/src/index.ts';
import {
  CORE_TOOL_NAMES,
  PROPOSAL_TOOL_NAMES,
  registerCollaborativeTools,
  type ModelContextLike,
  type ToolActivityEvent,
  type WebMCPTool,
} from '../packages/webmcp/src/m35d.ts';

test('bundled scenarios preserve the three Level 1 demos plus blank alongside the Phase 3.5B flagship', () => {
  const scenarios = listBundledScenarios();
  assert.deepEqual(scenarios.map((item) => item.id), ['continental-service-network', 'national-backbone-scale-test', 'maintenance-trap', 'growth-wall', 'resilience-gap', 'blank']);
  for (const scenario of scenarios) assert.equal(validateNetworkProject(scenario.project).valid, true);
});

test('scenario patches are pure and preserve the baseline model hash', () => {
  const project = loadMaintenanceTrap();
  const before = modelHash(project);
  const patch = getScenarioDefinition('maintenance-trap').recommendedPatch!;
  const snapshot = applyScenario(project, patch);
  assert.equal(modelHash(project), before);
  assert.equal(project.links.find((link) => link.id === 'L1')?.available, true);
  assert.equal(snapshot.links.find((link) => link.id === 'L1')?.available, false);
  assert.notEqual(scenarioHash(patch), 'baseline');
});

test('Maintenance Trap golden path: baseline PASS, maintenance FAIL at L3 120%', () => {
  const project = loadMaintenanceTrap();
  const patch = getScenarioDefinition('maintenance-trap').recommendedPatch!;
  const baseline = runScenarioCapacityAnalysis(project, null);
  const simulated = runScenarioCapacityAnalysis(project, patch);
  assert.equal(baseline.result.verdict, 'PASS');
  assert.equal(simulated.result.verdict, 'FAIL');
  assert.equal(simulated.routing.linkUtilizationPct.L3, 120);
  assert.deepEqual(simulated.routing.routes.find((route) => route.demandId === 'D1')?.linkIds, ['L2', 'L3', 'L6']);
  assert.ok(simulated.result.violations.some((violation) => violation.linkId === 'L3'));
  assert.equal(simulated.result.modelHash, modelHash(project));
  assert.equal(simulated.result.scenarioHash, scenarioHash(patch));
});

test('Maintenance Trap candidate diff restores the maintenance scenario without mutating before apply', () => {
  const project = loadMaintenanceTrap();
  const patch = getScenarioDefinition('maintenance-trap').recommendedPatch!;
  const beforeHash = modelHash(project);
  const candidate = proposeCapacityMitigation(project, patch, 20);
  assert.ok(candidate);
  assert.equal(candidate!.baseModelHash, beforeHash);
  assert.deepEqual(candidate!.commands.map((command) => command.args.linkId), ['L3']);
  assert.equal(candidate!.commands[0].args.capacityGbps, 15);
  const comparison = compareCandidate(project, candidate!, patch);
  assert.equal(comparison.before.result.verdict, 'FAIL');
  assert.equal(comparison.after.result.verdict, 'PASS');
  assert.equal(modelHash(project), beforeHash);
  const applied = applyCandidatePlan(project, candidate!);
  assert.equal(applied.links.find((link) => link.id === 'L3')?.capacityGbps, 15);
  assert.notEqual(modelHash(applied), beforeHash);
});

test('stale candidate is rejected after a human semantic edit', () => {
  const project = loadMaintenanceTrap();
  const patch = getScenarioDefinition('maintenance-trap').recommendedPatch!;
  const candidate = proposeCapacityMitigation(project, patch)!;
  const edited = cloneProject(project);
  edited.demands[0].bandwidthGbps += 1;
  assert.throws(() => applyCandidatePlan(edited, candidate), /stale/i);
});

test('Growth Wall golden path: baseline ~60%, +40% fails, first failure is 1.35x on G2', () => {
  const project = loadGrowthWall();
  const baseline = runScenarioCapacityAnalysis(project, null);
  const growth = runGrowthAnalysis(project, ['GD1', 'GD2'], 1.4, 0.05);
  assert.equal(baseline.result.verdict, 'PASS');
  assert.equal(baseline.routing.linkUtilizationPct.G2, 60);
  assert.equal(growth.target.result.verdict, 'FAIL');
  assert.equal(Math.round(growth.target.routing.linkUtilizationPct.G2 * 1000) / 1000, 84);
  assert.equal(growth.firstFailureMultiplier, 1.35);
  assert.equal(growth.firstFailureLinkId, 'G2');
});

test('Growth Wall deterministic capacity candidate restores 20% headroom at +40%', () => {
  const project = loadGrowthWall();
  const patch: ScenarioPatch = {
    id: 'growth-test', name: 'Growth +40%', disabledNodeIds: [], disabledLinkIds: [],
    demandMultipliers: ['GD1', 'GD2'].map((demandId) => ({ demandId, multiplier: 1.4 })), addedDemands: [], linkCapacityOverrides: [],
  };
  const candidate = proposeCapacityMitigation(project, patch, 20)!;
  assert.deepEqual(candidate.commands.map((command) => command.args.linkId), ['G2']);
  assert.equal(candidate.commands[0].args.capacityGbps, 22);
  const comparison = compareCandidate(project, candidate, patch);
  assert.equal(comparison.before.result.verdict, 'FAIL');
  assert.equal(comparison.after.result.verdict, 'PASS');
  assert.ok(comparison.after.routing.peakUtilizationPct < 80);
});

test('Resilience Gap N-1 ranks R2 as worst and exposes both southern overloads', () => {
  const project = loadResilienceGap();
  const analysis = runLinkContingencies(project);
  assert.equal(analysis.cases.length, project.links.length);
  assert.equal(analysis.worst?.linkId, 'R2');
  assert.equal(analysis.worst?.verdict, 'FAIL');
  assert.equal(analysis.worst?.peakUtilizationPct, 110);
  assert.ok(analysis.worst?.analysis.result.violations.some((violation) => violation.linkId === 'R4'));
  assert.ok(analysis.worst?.analysis.result.violations.some((violation) => violation.linkId === 'R5'));
});

test('Resilience Gap mitigation upgrades both overloaded southern links and improves replay', () => {
  const project = loadResilienceGap();
  const contingency = runLinkContingencies(project).worst!;
  const candidate = proposeCapacityMitigation(project, contingency.patch, 20)!;
  assert.deepEqual(candidate.commands.map((command) => command.args.linkId), ['R4', 'R5']);
  assert.deepEqual(candidate.commands.map((command) => command.args.capacityGbps), [14, 14]);
  const comparison = compareCandidate(project, candidate, contingency.patch);
  assert.equal(comparison.before.result.verdict, 'FAIL');
  assert.equal(comparison.after.result.verdict, 'PASS');
  assert.ok(comparison.after.routing.peakUtilizationPct < 80);
});

test('inspect_selection demand view reports current shared ChangePlan demand values and deterministic routes', async () => {
  const project = loadGrowthWall();
  let plan = createChangePlan(project, 'Growth inspect');
  let analysis = null as ReturnType<typeof runScenarioCapacityAnalysis> | null;
  const service = new CollaborativeWorkspaceService({
    getProject: () => project,
    getPlan: () => plan,
    setPlan: (next) => { plan = next; },
    getSelection: () => ({ kind: 'demand', id: 'GD1' }),
    getAnalysis: () => analysis ? { planHash: '', stamp: { baseModelHash: modelHash(project), planHash: '' }, verdict: analysis.result.verdict, capacity: analysis, reasons: [] } as any : null,
  });
  service.addPlanChange({ type: 'demand_growth', demandIds: ['GD1'], multiplier: 1.4 }, 'human');
  await service.analyzePlan(undefined, 'human');
  const selected = service.inspectSelection();
  assert.equal(selected.kind, 'demand');
  assert.equal(selected.id, 'GD1');
  assert.ok(selected.planChanges.some((item) => item.summary.includes('40%')));
});

test('WebMCP core tools expose shared-state schemas/annotations and never create hidden persistent scenarios', async () => {
  const project = loadMaintenanceTrap();
  let plan = createChangePlan(project, 'Shared plan');
  const tools = new Map<string, WebMCPTool>();
  const signals = new Map<string, AbortSignal | undefined>();
  const activities: ToolActivityEvent[] = [];
  const service = new CollaborativeWorkspaceService({ getProject: () => project, getPlan: () => plan, setPlan: (next) => { plan = next; } });
  const context: ModelContextLike = { registerTool(tool, options) { tools.set(tool.name, tool); signals.set(tool.name, options?.signal); options?.signal?.addEventListener('abort', () => tools.delete(tool.name), { once: true }); } };
  const registration = await registerCollaborativeTools(context, service, { onActivity: (event) => activities.push(event) });
  for (const name of CORE_TOOL_NAMES) assert.ok(tools.has(name));
  assert.equal(tools.get('inspect_workspace')?.annotations?.readOnlyHint, true);
  assert.equal(tools.get('simulate_change')?.annotations?.readOnlyHint, true);
  assert.equal(tools.get('add_plan_change')?.annotations?.readOnlyHint, false);
  assert.equal(tools.get('simulate_change')?.annotations?.untrustedContentHint, true);

  const beforeHash = modelHash(project);
  const simulated = await tools.get('simulate_change')!.execute({ type: 'disable_link', linkId: 'L1' }) as { verdict: string; peakUtilizationPct: number };
  assert.equal(simulated.verdict, 'FAIL');
  assert.equal(modelHash(project), beforeHash);
  assert.equal(plan.changes.length, 0, 'read-only simulation cannot create hidden shared state');

  await tools.get('add_plan_change')!.execute({ type: 'disable_link', linkId: 'L1' });
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].actor, 'agent');
  assert.equal(activities.at(-1)?.tool, 'add_plan_change');
  registration.dispose();
  for (const signal of signals.values()) assert.equal(signal?.aborted, true);
});

test('proposal WebMCP tools operate only on visible ChangePlan proposal state and cannot apply the canonical network', async () => {
  const project = loadMaintenanceTrap();
  let plan = createChangePlan(project, 'Proposal review');
  let candidate: CandidatePlan | null = null;
  let analysis: ReturnType<typeof import('../packages/evidence/src/index.ts')['analyzeChangePlan']> | null = null as any;
  const tools = new Map<string, WebMCPTool>();
  const service = new CollaborativeWorkspaceService({
    getProject: () => project, getPlan: () => plan, setPlan: (next) => { plan = next; },
    getAnalysis: () => analysis as any, publishAnalysis: (next) => { analysis = next as any; },
    getCandidate: () => candidate, publishCandidate: (next) => { candidate = next; },
    optimizeCapacity: async () => ({
      diagnostics: {
        solver: 'HiGHS WASM',
        solverVersion: 'test',
        status: 'Optimal',
        proof: 'optimal',
        objectiveValue: 4,
        mipGap: 0,
        timedOut: false,
        timeLimitMs: 0,
        runtimeMs: 1,
        modelConstructionMs: 0,
        wasmInitializationMs: 0,
        solveRuntimeMs: 1,
        modelHash: modelHash(project),
        scenarioHashes: [],
        problemHash: 'test',
        message: 'deterministic test result',
      },
      candidate: { id: 'candidate-visible', name: 'Upgrade L3', baseModelHash: modelHash(project), commands: [{ id: 'cmd-l3', type: 'set_link_capacity', actor: 'agent', args: { linkId: 'L3', capacityGbps: 15 }, createdAt: new Date(0).toISOString() }], objective: { name: 'cost', value: 5, unit: 'cost-units' }, rationaleEvidenceIds: ['capacity:L3'] },
      selectedUpgrades: [{ linkId: 'L3', fromCapacityGbps: 10, toCapacityGbps: 15, cost: 5 }],
      requirements: { targetUtilizationPct: 80, includeBaseline: true, budgetCostUnits: null, lockedLinkIds: [] }, scenarioHashes: [],
    }),
  });
  const context: ModelContextLike = { registerTool(tool, options) { tools.set(tool.name, tool); options?.signal?.addEventListener('abort', () => tools.delete(tool.name), { once: true }); } };
  const registration = await registerCollaborativeTools(context, service);
  await tools.get('add_plan_change')!.execute({ type: 'disable_link', linkId: 'L1' });
  await tools.get('analyze_plan')!.execute({});
  await registration.refresh();
  assert.ok(tools.has('propose_mitigation'));
  await tools.get('propose_mitigation')!.execute({});
  await registration.refresh();
  for (const name of PROPOSAL_TOOL_NAMES) assert.ok(tools.has(name));
  assert.equal(tools.has('apply_candidate'), false, 'canonical apply is intentionally absent from WebMCP');
  const baseCapacity = project.links.find((link) => link.id === 'L3')!.capacityGbps;
  const proposalId = plan.proposals.find((item) => item.state === 'pending')!.id;
  await tools.get('accept_proposal_change')!.execute({ proposalId });
  assert.equal(project.links.find((link) => link.id === 'L3')!.capacityGbps, baseCapacity, 'proposal acceptance edits the ChangePlan, not the base network');
  assert.ok(plan.changes.some((change) => change.type === 'set_link_capacity' && change.actor === 'agent'));
  registration.dispose();
});
