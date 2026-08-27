import test from 'node:test';
import assert from 'node:assert/strict';
import type { NetworkProject, ScenarioPatch } from '../packages/model/src/index.ts';
import { cloneProject, validateNetworkProject } from '../packages/model/src/index.ts';
import { minCut, routeProject } from '../packages/graph-engine/src/index.ts';
import {
  assertContingencyFresh,
  detectComputeCapabilities,
  runCapacityAnalysis,
  runScenarioCapacityAnalysis,
  runLinkContingencies,
  runLinkContingenciesAsync,
  runSingleLinkContingency,
  type ContingencyWorkerLike,
  type ContingencyWorkerRequest,
  type ContingencyWorkerResponse,
  type EvidenceRef,
} from '../packages/evidence/src/index.ts';
import { loadResilienceGap } from '../packages/scenarios/src/index.ts';
import {
  CANDIDATE_TOOL_NAMES,
  COUNTEREXAMPLE_TOOL_NAMES,
  CORE_TOOL_NAMES,
  RESILIENCE_TOOL_NAMES,
  VIOLATION_TOOL_NAMES,
  registerCandidateTools,
  registerCounterexampleTools,
  registerCoreTools,
  registerResilienceTools,
  registerViolationTools,
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
    schemaVersion: '0.1', id: 'diamond', name: 'Diamond ECMP',
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

function triangleProject(): NetworkProject {
  return {
    schemaVersion: '0.1', id: 'triangle', name: 'Triangle N-1',
    nodes: ['A', 'B', 'C'].map((id) => ({ id, name: id })),
    links: [
      { id: 'AB', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: true },
      { id: 'BC', source: 'B', target: 'C', capacityGbps: 10, weight: 1, bidirectional: true },
      { id: 'AC', source: 'A', target: 'C', capacityGbps: 10, weight: 1, bidirectional: true },
    ],
    demands: [{ id: 'D1', source: 'A', target: 'C', bandwidthGbps: 8, serviceClassId: 'gold' }],
    serviceClasses: serviceClasses(), routingProfile: { mode: 'ecmp' },
  };
}

function lineProject(): NetworkProject {
  const project = triangleProject();
  project.id = 'line-n1'; project.name = 'Line N-1'; project.links = project.links.filter((link) => link.id !== 'AC');
  return project;
}

class FakeWorker implements ContingencyWorkerLike {
  static terminated = 0;
  onmessage: ((event: MessageEvent<ContingencyWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private project: NetworkProject | null = null;
  private basePatch: ScenarioPatch | null = null;
  private baseModelHash = '';
  postMessage(request: ContingencyWorkerRequest): void {
    if (request.type === 'init') { this.project = request.project; this.basePatch = request.basePatch; this.baseModelHash = request.baseModelHash; return; }
    queueMicrotask(() => {
      try {
        if (!this.project) throw new Error('not initialized');
        const contingency = runSingleLinkContingency(this.project, request.linkId, this.basePatch, { baseModelHash: this.baseModelHash });
        this.onmessage?.({ data: { taskId: request.taskId, ok: true, contingency } } as MessageEvent<ContingencyWorkerResponse>);
      } catch (error) {
        this.onmessage?.({ data: { taskId: request.taskId, ok: false, error: error instanceof Error ? error.message : 'failed' } } as MessageEvent<ContingencyWorkerResponse>);
      }
    });
  }
  terminate(): void { FakeWorker.terminated += 1; }
}

test('Reference C: ECMP splits equal-cost diamond demand evenly across both paths', () => {
  const routing = routeProject(diamondProject());
  const route = routing.routes[0];
  assert.equal(routing.mode, 'ecmp');
  assert.equal(route.paths.length, 2);
  assert.deepEqual(route.paths.map((path) => path.linkIds), [['AB', 'BD'], ['AC', 'CD']]);
  assert.deepEqual(route.linkFractions, { AB: 0.5, AC: 0.5, BD: 0.5, CD: 0.5 });
  assert.deepEqual(routing.linkLoadsGbps, { AB: 4, AC: 4, BD: 4, CD: 4 });
  assert.deepEqual(routing.linkUtilizationPct, { AB: 40, AC: 40, BD: 40, CD: 40 });
});

test('ECMP mode requires positive weights so the equal-cost DAG is acyclic', () => {
  const project = diamondProject();
  project.links[0].weight = 0;
  const validation = validateNetworkProject(project);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes('must be > 0 when routingProfile.mode is ecmp')));
});

test('Reference D: max-flow/min-cut returns the known 20 Gbps diamond cut with stable link IDs', () => {
  const cut = minCut(diamondProject(), 'A', 'D');
  assert.equal(cut.maxFlowGbps, 20);
  assert.equal(cut.cutCapacityGbps, 20);
  assert.deepEqual(cut.cutLinkIds, ['AB', 'AC']);
  assert.deepEqual(cut.reachableNodeIds, ['A']);
});

test('Reference E: triangle survives every link N-1 while line fails every link N-1', () => {
  const triangle = runLinkContingencies(triangleProject());
  assert.equal(triangle.result.verdict, 'PASS');
  assert.equal(triangle.cases.length, 3);
  assert.ok(triangle.cases.every((item) => item.verdict === 'PASS'));

  const line = runLinkContingencies(lineProject());
  assert.equal(line.result.verdict, 'FAIL');
  assert.equal(line.cases.length, 2);
  assert.ok(line.cases.every((item) => item.verdict === 'FAIL'));
  assert.ok(line.cases.every((item) => item.unroutedDemandGbps === 8));
});

test('N-1 ranking is deterministic across repeated runs including score components', () => {
  const project = loadResilienceGap();
  const normalize = () => runLinkContingencies(project).cases.map((item) => ({
    linkId: item.linkId, score: item.score, critical: item.criticalUnsatisfiedGbps, unrouted: item.unroutedDemandGbps,
    overload: item.severeOverloadGbps, peak: item.peakUtilizationPct, affected: item.affectedDemandIds,
  }));
  assert.deepEqual(normalize(), normalize());
  assert.equal(normalize()[0].linkId, 'R2');
});

test('bounded async fallback reports monotonic progress and produces the same ranking as sequential N-1', async () => {
  const project = loadResilienceGap();
  const progress: number[] = [];
  const parallel = await runLinkContingenciesAsync(project, null, { workerCount: 3, onProgress: (item) => progress.push(item.completed) });
  const sequential = runLinkContingencies(project);
  assert.equal(parallel.status, 'complete');
  assert.equal(parallel.executionMode, 'async-fallback');
  assert.equal(parallel.workerCount, 3);
  assert.deepEqual(parallel.cases.map((item) => [item.linkId, item.score]), sequential.cases.map((item) => [item.linkId, item.score]));
  assert.equal(progress.at(-1), parallel.completedScenarios);
  for (let i = 1; i < progress.length; i += 1) assert.ok(progress[i] >= progress[i - 1]);
});

test('worker-pool execution protocol returns deterministic results and terminates its workers', async () => {
  FakeWorker.terminated = 0;
  const result = await runLinkContingenciesAsync(loadResilienceGap(), null, { workerCount: 2, workerFactory: () => new FakeWorker() });
  assert.equal(result.status, 'complete');
  assert.equal(result.executionMode, 'worker-pool');
  assert.equal(result.workerCount, 2);
  assert.equal(result.worst?.linkId, 'R2');
  assert.equal(FakeWorker.terminated, 2);
});

test('cancellation returns CANCELLED partial evidence and never fabricates PASS', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runLinkContingenciesAsync(loadResilienceGap(), null, { signal: controller.signal, workerCount: 2 });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.result.verdict, 'CANCELLED');
  assert.equal(result.completedScenarios, 0);
});

test('stale N-1 result is rejected when model or scenario changes before publication', async () => {
  const project = loadResilienceGap();
  const result = await runLinkContingenciesAsync(project, null, { workerCount: 2 });
  const edited = cloneProject(project);
  edited.demands[0].bandwidthGbps += 1;
  assert.throws(() => assertContingencyFresh(result, edited, null), /stale/);
  const patch: ScenarioPatch = { id: 'changed', name: 'Changed scenario', disabledNodeIds: [], disabledLinkIds: ['R1'], demandMultipliers: [], addedDemands: [], linkCapacityOverrides: [] };
  assert.throws(() => assertContingencyFresh(result, project, patch), /stale/);
});

test('compute capability detection selects bounded workers and deterministic fallback without SharedArrayBuffer dependency', () => {
  const worker = detectComputeCapabilities({ Worker: function Worker() {}, navigator: { hardwareConcurrency: 12 }, SharedArrayBuffer: function SharedArrayBuffer() {}, crossOriginIsolated: true });
  assert.equal(worker.executionMode, 'worker-pool');
  assert.equal(worker.recommendedWorkerCount, 8);
  assert.equal(worker.sharedArrayBufferSupported, true);
  const fallback = detectComputeCapabilities({ navigator: { hardwareConcurrency: 1 }, crossOriginIsolated: false });
  assert.equal(fallback.executionMode, 'async-fallback');
  assert.equal(fallback.recommendedWorkerCount, 2);
  assert.equal(fallback.sharedArrayBufferSupported, false);
});

function toolHarness(projectInput = loadResilienceGap()) {
  let project = projectInput;
  let activePatch: ScenarioPatch | null = null;
  let candidate = null as ReturnType<typeof import('../packages/evidence/src/index.ts')['proposeCapacityMitigation']>;
  let contingencies: ReturnType<typeof runLinkContingencies> | null = null;
  const selected: EvidenceRef[] = [];
  const activities: ToolActivityEvent[] = [];
  const tools = new Map<string, WebMCPTool>();
  const signals = new Map<string, AbortSignal | undefined>();
  const context: ModelContextLike = {
    registerTool(tool, options) { tools.set(tool.name, tool); signals.set(tool.name, options?.signal); },
  };
  const services: InfraTwinToolServices = {
    getProject: () => project,
    setProject: (next) => { project = next; },
    getActiveScenario: () => activePatch,
    setActiveScenario: (next) => { activePatch = next; },
    getCapacityAnalysis: () => runScenarioCapacityAnalysis(project, activePatch),
    publishCapacityAnalysis: () => {},
    runContingencies: async (options) => {
      const result = await runLinkContingenciesAsync(project, activePatch, { ...options, workerCount: 2 });
      if (result.status === 'complete') contingencies = result;
      return result;
    },
    getContingencyAnalysis: () => contingencies,
    publishContingencyAnalysis: (next) => { contingencies = next; },
    publishBottleneckAnalysis: () => {},
    selectEvidence: (evidence) => { if (evidence) selected.push(evidence); },
    getCandidate: () => candidate,
    setCandidate: (next) => { candidate = next; },
    publishCandidateComparison: () => {},
    onActivity: (event) => activities.push(event),
  };
  return { context, services, tools, signals, activities, selected, getProject: () => project, getPatch: () => activePatch, setPatch: (patch: ScenarioPatch | null) => { activePatch = patch; }, setContingencies: (value: ReturnType<typeof runLinkContingencies> | null) => { contingencies = value; } };
}

test('dynamic WebMCP registration groups expose only their state capabilities and revoke cleanly', async () => {
  const harness = toolHarness();
  const disposeCore = await registerCoreTools(harness.context, harness.services);
  assert.deepEqual([...harness.tools.keys()], [...CORE_TOOL_NAMES]);
  const disposeResilience = await registerResilienceTools(harness.context, harness.services);
  assert.deepEqual([...harness.tools.keys()].slice(-1), [...RESILIENCE_TOOL_NAMES]);
  const disposeViolation = await registerViolationTools(harness.context, harness.services);
  assert.deepEqual([...harness.tools.keys()].slice(-2), [...VIOLATION_TOOL_NAMES]);
  assert.equal(harness.tools.has('show_counterexample'), false);
  harness.setContingencies(runLinkContingencies(loadResilienceGap()));
  const disposeCounterexample = await registerCounterexampleTools(harness.context, harness.services);
  assert.deepEqual([...harness.tools.keys()].slice(-1), [...COUNTEREXAMPLE_TOOL_NAMES]);
  const candidate = (await harness.tools.get('propose_change')!.execute({ strategy: 'set_link_capacity', linkId: 'R4', capacityGbps: 14 })) as NonNullable<ReturnType<typeof harness.services.getCandidate>>;
  assert.ok(candidate);
  const disposeCandidate = await registerCandidateTools(harness.context, harness.services);
  assert.deepEqual([...harness.tools.keys()].slice(-3), [...CANDIDATE_TOOL_NAMES]);

  disposeCandidate(); disposeCounterexample(); disposeViolation(); disposeResilience(); disposeCore();
  for (const name of [...CORE_TOOL_NAMES, ...RESILIENCE_TOOL_NAMES, ...VIOLATION_TOOL_NAMES, ...COUNTEREXAMPLE_TOOL_NAMES, ...CANDIDATE_TOOL_NAMES]) assert.equal(harness.signals.get(name)?.aborted, true, `${name} registration should be aborted`);
});

test('Level 2 WebMCP violation tools inspect, replay, and map min-cut evidence to graph IDs', async () => {
  const harness = toolHarness();
  const ranking = runLinkContingencies(loadResilienceGap());
  harness.setContingencies(ranking);
  harness.setPatch(ranking.worst!.patch);
  const disposeViolation = await registerViolationTools(harness.context, harness.services);
  assert.equal(harness.tools.has('show_counterexample'), false);
  const disposeCounterexample = await registerCounterexampleTools(harness.context, harness.services);

  const violation = await harness.tools.get('inspect_violation')!.execute({});
  assert.ok((violation as { violation: { id: string } }).violation.id);
  const bottleneck = await harness.tools.get('find_bottlenecks')!.execute({ sourceId: 'NYC', targetId: 'SEA' });
  const cutLinkIds = (bottleneck as { cut: { cutLinkIds: string[] } }).cut.cutLinkIds;
  assert.ok(cutLinkIds.length > 0);
  assert.deepEqual(harness.selected.at(-1)?.linkIds, cutLinkIds);
  const replay = await harness.tools.get('show_counterexample')!.execute({ linkId: 'R2' });
  assert.equal((replay as { linkId: string }).linkId, 'R2');
  assert.ok(harness.getPatch()?.disabledLinkIds.includes('R2'));
  disposeCounterexample(); disposeViolation();
});

test('WebMCP contingency execution honors AbortSignal and records cancellation activity', async () => {
  const harness = toolHarness();
  const dispose = await registerResilienceTools(harness.context, harness.services);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(async () => await harness.tools.get('run_contingencies')!.execute({}, { signal: controller.signal }), (error: unknown) => error instanceof Error && error.name === 'AbortError');
  assert.equal(harness.activities.at(-1)?.tool, 'run_contingencies');
  assert.equal(harness.activities.at(-1)?.status, 'cancelled');
  dispose();
});
