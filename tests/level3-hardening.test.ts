import test from 'node:test';
import assert from 'node:assert/strict';
import type { CandidatePlan, NetworkProject, ScenarioPatch } from '../packages/model/src/index.ts';
import {
  applyCandidatePlan,
  applyModelCommand,
  cloneProject,
  invertCandidatePlan,
  modelHash,
  projectDocumentHash,
  semanticModelHash,
  semanticModelHashWebCrypto,
} from '../packages/model/src/index.ts';
import {
  assertContingencyFresh,
  proposeCapacityMitigation,
  runLinkContingencies,
  runScenarioCapacityAnalysis,
} from '../packages/evidence/src/index.ts';
import { getScenarioDefinition, loadGrowthWall, loadMaintenanceTrap, loadResilienceGap } from '../packages/scenarios/src/index.ts';
import { optimizeCapacityPlan } from '../packages/optimizer/src/index.ts';
import {
  COUNTEREXAMPLE_TOOL_NAMES,
  CORE_TOOL_NAMES,
  VIOLATION_TOOL_NAMES,
  registerCoreTools,
  registerCounterexampleTools,
  registerOptimizerTools,
  registerResilienceTools,
  registerViolationTools,
  type InfraTwinToolServices,
  type ModelContextLike,
  type ToolActivityEvent,
  type WebMCPTool,
} from '../packages/webmcp/src/index.ts';

function contextHarness() {
  const tools = new Map<string, WebMCPTool>();
  const signals = new Map<string, AbortSignal | undefined>();
  const context: ModelContextLike = {
    registerTool(tool, options) {
      tools.set(tool.name, tool);
      signals.set(tool.name, options?.signal);
    },
  };
  return { tools, signals, context };
}

function baseServices(projectRef: { value: NetworkProject }, patchRef: { value: ScenarioPatch | null }, activities: ToolActivityEvent[] = []): InfraTwinToolServices {
  let candidate: CandidatePlan | null = null;
  return {
    getProject: () => projectRef.value,
    setProject: (next) => { projectRef.value = next; },
    getActiveScenario: () => patchRef.value,
    setActiveScenario: (next) => { patchRef.value = next; },
    getCapacityAnalysis: () => runScenarioCapacityAnalysis(projectRef.value, patchRef.value),
    publishCapacityAnalysis: () => {},
    publishContingencyAnalysis: () => {},
    getCandidate: () => candidate,
    setCandidate: (next) => { candidate = next; },
    publishCandidateComparison: () => {},
    onActivity: (event) => activities.push(event),
  };
}

test('semantic SHA-256 model identity ignores presentation layout but document identity does not', async () => {
  const project = loadMaintenanceTrap();
  const semantic = semanticModelHash(project);
  const document = projectDocumentHash(project);
  assert.match(semantic, /^sha256:[0-9a-f]{64}$/);
  assert.equal(modelHash(project), semantic);

  const moved = cloneProject(project);
  moved.nodes[0].x = (moved.nodes[0].x ?? 0) + 137;
  moved.nodes[0].y = (moved.nodes[0].y ?? 0) - 41;
  moved.metadata = { ...moved.metadata, ui: { selectedNodeId: moved.nodes[0].id }, layout: { zoom: 1.25 } };
  assert.equal(modelHash(moved), semantic, 'layout-only changes must not invalidate engineering provenance');
  assert.notEqual(projectDocumentHash(moved), document, 'full document identity must still detect layout changes');

  const engineeringEdit = cloneProject(project);
  engineeringEdit.demands[0].bandwidthGbps += 1;
  assert.notEqual(modelHash(engineeringEdit), semantic);
  assert.equal(await semanticModelHashWebCrypto(project), semantic);
});

test('human semantic edits use the same validated ModelCommand application layer', () => {
  const project = loadMaintenanceTrap();
  const unavailable = applyModelCommand(project, {
    id: 'human-link', type: 'set_link_availability', actor: 'human', args: { linkId: 'L1', available: false }, createdAt: new Date(0).toISOString(),
  });
  assert.equal(unavailable.links.find((link) => link.id === 'L1')?.available, false);

  const capacity = applyModelCommand(project, {
    id: 'human-capacity', type: 'set_link_capacity', actor: 'human', args: { linkId: 'L3', capacityGbps: 15 }, createdAt: new Date(0).toISOString(),
  });
  assert.equal(capacity.links.find((link) => link.id === 'L3')?.capacityGbps, 15);

  const demand = applyModelCommand(project, {
    id: 'human-demand', type: 'set_demand_bandwidth', actor: 'human', args: { demandId: 'D1', bandwidthGbps: 9 }, createdAt: new Date(0).toISOString(),
  });
  assert.equal(demand.demands.find((item) => item.id === 'D1')?.bandwidthGbps, 9);
});

test('layout movement does not make deterministic contingency evidence stale', () => {
  const project = loadResilienceGap();
  const result = runLinkContingencies(project);
  const moved = cloneProject(project);
  moved.nodes[0].x = (moved.nodes[0].x ?? 0) + 200;
  moved.nodes[0].y = (moved.nodes[0].y ?? 0) + 80;
  assert.doesNotThrow(() => assertContingencyFresh(result, moved, null));
  moved.links[0].capacityGbps += 1;
  assert.throws(() => assertContingencyFresh(result, moved, null), /stale/i);
});

test('simulate_change is genuinely read-only and marks model-derived output as untrusted', async () => {
  const projectRef = { value: loadMaintenanceTrap() };
  const patchRef = { value: null as ScenarioPatch | null };
  const harness = contextHarness();
  const services = baseServices(projectRef, patchRef);
  const dispose = await registerCoreTools(harness.context, services);
  assert.deepEqual([...harness.tools.keys()], [...CORE_TOOL_NAMES]);
  const tool = harness.tools.get('simulate_change')!;
  assert.equal(tool.annotations?.readOnlyHint, true);
  assert.equal(tool.annotations?.untrustedContentHint, true);
  const before = modelHash(projectRef.value);
  const result = await tool.execute({ disabledLinkIds: ['L1'], name: 'untrusted scenario label' }) as ReturnType<typeof runScenarioCapacityAnalysis>;
  assert.equal(result.result.verdict, 'FAIL');
  assert.equal(patchRef.value, null);
  assert.equal(modelHash(projectRef.value), before);
  dispose();
});

test('run_contingencies publishes ranking without implicitly replaying the worst failure', async () => {
  const projectRef = { value: loadResilienceGap() };
  const patchRef = { value: null as ScenarioPatch | null };
  let published = null as ReturnType<typeof runLinkContingencies> | null;
  const harness = contextHarness();
  const services: InfraTwinToolServices = {
    ...baseServices(projectRef, patchRef),
    runContingencies: async () => runLinkContingencies(projectRef.value, patchRef.value),
    publishContingencyAnalysis: (result) => { published = result; },
  };
  const dispose = await registerResilienceTools(harness.context, services);
  const result = await harness.tools.get('run_contingencies')!.execute({}) as ReturnType<typeof runLinkContingencies>;
  assert.equal(result.worst?.linkId, 'R2');
  assert.equal(published?.worst?.linkId, 'R2');
  assert.equal(patchRef.value, null, 'analysis must not silently change the active scenario');
  assert.equal(harness.tools.get('run_contingencies')?.annotations?.untrustedContentHint, true);
  dispose();
});

test('counterexample capability is separate from generic FAIL violation capabilities', async () => {
  const projectRef = { value: loadResilienceGap() };
  const ranking = runLinkContingencies(projectRef.value);
  const patchRef = { value: ranking.worst!.patch as ScenarioPatch | null };
  const harness = contextHarness();
  const services: InfraTwinToolServices = {
    ...baseServices(projectRef, patchRef),
    getContingencyAnalysis: () => ranking,
  };
  const disposeViolation = await registerViolationTools(harness.context, services);
  assert.deepEqual([...harness.tools.keys()], [...VIOLATION_TOOL_NAMES]);
  assert.equal(harness.tools.has('show_counterexample'), false);
  const disposeCounterexample = await registerCounterexampleTools(harness.context, services);
  assert.deepEqual([...harness.tools.keys()].slice(-1), [...COUNTEREXAMPLE_TOOL_NAMES]);
  assert.equal(harness.tools.get('show_counterexample')?.annotations?.readOnlyHint, false);
  assert.equal(harness.tools.get('show_counterexample')?.annotations?.untrustedContentHint, true);
  disposeCounterexample(); disposeViolation();
  assert.equal(harness.signals.get('show_counterexample')?.aborted, true);
});

test('optimizer WebMCP publication is rejected when the shared semantic model changes mid-run', async () => {
  const projectRef = { value: loadGrowthWall() };
  const patchRef = { value: getScenarioDefinition('growth-wall').growthDemandIds ? {
    id: 'growth-hardening', name: 'Growth +40%', disabledNodeIds: [], disabledLinkIds: [],
    demandMultipliers: ['GD1', 'GD2'].map((demandId) => ({ demandId, multiplier: 1.4 })), addedDemands: [], linkCapacityOverrides: [],
  } as ScenarioPatch : null };
  let candidate: CandidatePlan | null = null;
  let published = false;
  const harness = contextHarness();
  const services: InfraTwinToolServices = {
    ...baseServices(projectRef, patchRef),
    getCandidate: () => candidate,
    setCandidate: (next) => { candidate = next; },
    optimizeCapacity: async (requirements) => {
      const result = await optimizeCapacityPlan(projectRef.value, requirements, { timeLimitMs: 8_000 });
      const edited = cloneProject(projectRef.value); edited.demands[0].bandwidthGbps += 0.5; projectRef.value = edited;
      return result;
    },
    publishOptimizationResult: () => { published = true; },
  };
  const dispose = await registerOptimizerTools(harness.context, services);
  await assert.rejects(() => harness.tools.get('optimize_capacity_plan')!.execute({ targetUtilizationPct: 80 }), /stale/i);
  assert.equal(published, false);
  assert.equal(candidate, null);
  dispose();
});

test('candidate apply/undo still restores the exact full project document, not only semantic identity', () => {
  const project = loadMaintenanceTrap();
  const patch = getScenarioDefinition('maintenance-trap').recommendedPatch!;
  const candidate = proposeCapacityMitigation(project, patch, 20)!;
  const undo = invertCandidatePlan(project, candidate);
  const applied = applyCandidatePlan(project, candidate);
  const restored = applyCandidatePlan(applied, undo);
  assert.equal(modelHash(restored), modelHash(project));
  assert.equal(projectDocumentHash(restored), projectDocumentHash(project));
});
