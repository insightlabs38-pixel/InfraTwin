import test from 'node:test';
import assert from 'node:assert/strict';
import type { CandidatePlan, NetworkProject, ScenarioPatch } from '../packages/model/src/index.ts';
import {
  applyCandidatePlan,
  applyScenario,
  cloneProject,
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
import {
  BASE_TOOL_NAMES,
  CANDIDATE_TOOL_NAMES,
  inspectDemands,
  registerBaseTools,
  registerCandidateTools,
  type InfraTwinToolServices,
  type ModelContextLike,
  type ToolActivityEvent,
  type WebMCPTool,
} from '../packages/webmcp/src/index.ts';

test('Level 1 bundles the three polished demo scenarios plus blank', () => {
  const scenarios = listBundledScenarios();
  assert.deepEqual(scenarios.map((item) => item.id), ['maintenance-trap', 'growth-wall', 'resilience-gap', 'blank']);
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
  assert.ok(comparison.after.routing.linkUtilizationPct.G2 < 80);
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

test('inspect_demands reports current active scenario values and routes', () => {
  const project = loadGrowthWall();
  const patch: ScenarioPatch = {
    id: 'growth-inspect', name: 'Growth inspect', disabledNodeIds: [], disabledLinkIds: [],
    demandMultipliers: [{ demandId: 'GD1', multiplier: 1.4 }], addedDemands: [], linkCapacityOverrides: [],
  };
  const summary = inspectDemands(project, patch);
  const demand = summary.demands.find((item) => item.id === 'GD1')!;
  assert.equal(demand.bandwidthGbps, 11.2);
  assert.deepEqual(demand.routeLinkIds, ['G1', 'G2', 'G3']);
});

test('WebMCP base tools expose schemas/annotations and drive shared application services', async () => {
  let project = loadMaintenanceTrap();
  let activePatch: ScenarioPatch | null = null;
  let candidate: CandidatePlan | null = null;
  const tools = new Map<string, WebMCPTool>();
  const signals = new Map<string, AbortSignal | undefined>();
  const activities: ToolActivityEvent[] = [];
  const context: ModelContextLike = { registerTool(tool, options) { tools.set(tool.name, tool); signals.set(tool.name, options?.signal); } };
  const services: InfraTwinToolServices = {
    getProject: () => project,
    setProject: (next) => { project = next; },
    getActiveScenario: () => activePatch,
    setActiveScenario: (next) => { activePatch = next; },
    publishCapacityAnalysis: () => {},
    publishContingencyAnalysis: () => {},
    getCandidate: () => candidate,
    setCandidate: (next) => { candidate = next; },
    publishCandidateComparison: () => {},
    onActivity: (event) => activities.push(event),
  };

  const cleanup = await registerBaseTools(context, services);
  assert.deepEqual([...tools.keys()], [...BASE_TOOL_NAMES]);
  assert.equal(tools.get('inspect_network')?.annotations?.readOnlyHint, true);
  assert.equal(tools.get('inspect_demands')?.annotations?.readOnlyHint, true);
  assert.equal(tools.get('simulate_change')?.annotations?.readOnlyHint, true);
  assert.equal(tools.get('run_capacity_analysis')?.annotations?.readOnlyHint, true);
  assert.equal(tools.get('propose_change')?.annotations?.readOnlyHint, false);

  await tools.get('simulate_change')!.execute({ disabledLinkIds: ['L1'], name: 'Agent maintenance' });
  assert.deepEqual(services.getActiveScenario()?.disabledLinkIds, ['L1']);
  assert.equal(project.links.find((link) => link.id === 'L1')?.available, true);
  await tools.get('propose_change')!.execute({ strategy: 'auto_mitigate', targetHeadroomPct: 20 });
  assert.ok(candidate);
  assert.equal(activities.at(-1)?.tool, 'propose_change');
  assert.equal(activities.at(-1)?.status, 'success');
  cleanup();
  for (const name of BASE_TOOL_NAMES) assert.equal(signals.get(name)?.aborted, true);
});

test('candidate WebMCP tools compare, apply, and discard against current shared state', async () => {
  let project = loadMaintenanceTrap();
  const patch = getScenarioDefinition('maintenance-trap').recommendedPatch!;
  let activePatch: ScenarioPatch | null = patch;
  let candidate: CandidatePlan | null = proposeCapacityMitigation(project, patch, 20)!;
  const tools = new Map<string, WebMCPTool>();
  const activities: ToolActivityEvent[] = [];
  const context: ModelContextLike = { registerTool(tool) { tools.set(tool.name, tool); } };
  const services: InfraTwinToolServices = {
    getProject: () => project,
    setProject: (next) => { project = next; },
    getActiveScenario: () => activePatch,
    setActiveScenario: (next) => { activePatch = next; },
    publishCapacityAnalysis: () => {},
    publishContingencyAnalysis: () => {},
    getCandidate: () => candidate,
    setCandidate: (next) => { candidate = next; },
    publishCandidateComparison: () => {},
    onActivity: (event) => activities.push(event),
  };
  const cleanup = await registerCandidateTools(context, services);
  assert.deepEqual([...tools.keys()], [...CANDIDATE_TOOL_NAMES]);
  const comparison = await tools.get('compare_candidate')!.execute({}) as ReturnType<typeof compareCandidate>;
  assert.equal(comparison.after.result.verdict, 'PASS');
  await tools.get('apply_candidate')!.execute({});
  assert.equal(candidate, null);
  assert.equal(project.links.find((link) => link.id === 'L3')?.capacityGbps, 15);
  assert.equal(runScenarioCapacityAnalysis(project, patch).result.verdict, 'PASS');
  assert.equal(activities.some((event) => event.tool === 'apply_candidate'), true);
  cleanup();

  candidate = proposeCapacityMitigation(loadResilienceGap(), runLinkContingencies(loadResilienceGap()).worst!.patch, 20);
  project = loadResilienceGap();
  activePatch = runLinkContingencies(project).worst!.patch;
  tools.clear();
  const cleanupDiscard = await registerCandidateTools(context, services);
  await tools.get('discard_candidate')!.execute({});
  assert.equal(candidate, null);
  assert.equal(modelHash(project), modelHash(loadResilienceGap()));
  cleanupDiscard();
});
