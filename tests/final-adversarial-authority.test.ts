import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChangePlan,
  modelHash,
  type ChangePlan,
  type NetworkProject,
} from '../packages/model/src/index.ts';
import {
  analyzeChangePlan,
  type ChangePlanAnalysis,
} from '../packages/evidence/src/index.ts';
import {
  CollaborativeWorkspaceService,
  type CollaborativeWorkspaceAdapters,
  type PublishedVerification,
  type WorkspaceDesignState,
  type WorkspaceSelection,
} from '../packages/application/src/index.ts';
import type { CandidatePlan } from '../packages/model/src/index.ts';
import { getScenarioDefinition } from '../packages/scenarios/src/index.ts';

const T0 = '2026-08-30T23:15:00.000Z';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function createHarness() {
  let project = structuredClone(getScenarioDefinition('maintenance-trap').project);
  let plan: ChangePlan = createChangePlan(project, 'Final adversarial authority', { id: 'final-authority-plan', now: T0 });
  let selection: WorkspaceSelection = null;
  let destination: 'network' | 'analysis' | 'plans' | 'settings' = 'network';
  let analysis: ChangePlanAnalysis | null = null;
  let candidate: CandidatePlan | null = null;
  let design: WorkspaceDesignState | null = null;
  let verification: PublishedVerification | null = null;
  let analysisPublishes = 0;
  let candidatePublishes = 0;
  let designPublishes = 0;
  let verificationPublishes = 0;

  const adapters: CollaborativeWorkspaceAdapters = {
    getProject: () => project,
    getPlan: () => plan,
    setPlan: (next) => { plan = next; },
    getSelection: () => selection,
    setSelection: (next) => { selection = next; },
    getDestination: () => destination,
    setDestination: (next) => { destination = next; },
    getAnalysis: () => analysis,
    publishAnalysis: (next) => { analysisPublishes += 1; analysis = next; },
    getCandidate: () => candidate,
    publishCandidate: (next) => { candidatePublishes += 1; candidate = next; },
    getDesignState: () => design,
    publishDesignState: (next) => { designPublishes += 1; design = next; },
    getVerification: () => verification,
    publishVerification: (next) => { verificationPublishes += 1; verification = next; },
    now: () => T0,
  };
  const service = new CollaborativeWorkspaceService(adapters);
  return {
    service,
    adapters,
    get project() { return project; },
    replaceProject(next: NetworkProject) { project = next; },
    get plan() { return plan; },
    get analysis() { return analysis; },
    set analysis(next: ChangePlanAnalysis | null) { analysis = next; },
    get candidate() { return candidate; },
    set candidate(next: CandidatePlan | null) { candidate = next; },
    get design() { return design; },
    get verification() { return verification; },
    counts: () => ({ analysisPublishes, candidatePublishes, designPublishes, verificationPublishes }),
  };
}

const semanticMutators: Array<[string, (h: ReturnType<typeof createHarness>) => void]> = [
  ['budget change', (h) => h.service.setPlanConstraint('budgetCostUnits', 7, 'human')],
  ['human lock', (h) => h.service.setPlanRestriction('link', h.project.links[0].id, true, 'human')],
  ['routing restriction', (h) => h.service.setRoutingRestriction('link', h.project.links[0].id, true, 'human')],
  ['base network replacement', (h) => {
    const next = structuredClone(h.project);
    next.links[0].weight += 0.125;
    h.replaceProject(next);
  }],
];

test('AV-03: in-flight analysis is rejected across independent semantic mutation axes', async () => {
  for (const [label, mutate] of semanticMutators) {
    const h = createHarness();
    const gate = deferred<void>();
    h.adapters.analyzePlanAsync = async (project, plan) => {
      const result = analyzeChangePlan(project, plan);
      await gate.promise;
      return result;
    };
    const running = h.service.analyzePlan(undefined, 'agent');
    mutate(h);
    gate.resolve();
    await assert.rejects(running, /Stale analysis discarded/i, label);
    assert.equal(h.counts().analysisPublishes, 0, `${label}: stale analysis must never publish`);
  }
});

test('AV-04/AV-07: capacity optimizer result cannot publish after budget, lock, or network revision', async () => {
  const mutators = semanticMutators.filter(([label]) => label !== 'routing restriction');
  for (const [label, mutate] of mutators) {
    const h = createHarness();
    const gate = deferred<any>();
    h.adapters.optimizeCapacity = async () => gate.promise;
    const running = h.service.generateMitigation(undefined, 'agent');
    mutate(h);
    gate.resolve({ candidate: null } as any);
    await assert.rejects(running, /Stale optimizer result discarded/i, label);
    assert.equal(h.counts().candidatePublishes, 0, `${label}: stale candidate must never publish`);
    assert.equal(h.plan.proposals.length, 0, `${label}: stale optimizer must not create proposal rows`);
  }
});

test('AV-04/AV-07: adaptive and Pareto results cannot publish after routing/action-space edits', async () => {
  {
    const h = createHarness();
    h.service.setPlanConstraint('allowedMitigationActions', { capacityUpgrades: false, routingChanges: true, newLinks: false }, 'human');
    const gate = deferred<any>();
    h.adapters.optimizeAdaptiveDesign = async () => gate.promise;
    const before = h.counts();
    const running = h.service.generateMitigation(undefined, 'agent');
    h.service.setRoutingRestriction('link', h.project.links[0].id, true, 'human');
    gate.resolve({ variant: null, failureReason: 'NO_PATH_CANDIDATES', diagnostics: {} } as any);
    await assert.rejects(running, /Stale adaptive optimizer result discarded/i);
    assert.equal(h.counts().candidatePublishes, before.candidatePublishes);
    assert.equal(h.counts().designPublishes, before.designPublishes);
  }

  {
    const h = createHarness();
    h.service.setPlanConstraint('allowedMitigationActions', { capacityUpgrades: false, routingChanges: true, newLinks: false }, 'human');
    const gate = deferred<any[]>();
    h.adapters.optimizeDesignPareto = async () => gate.promise;
    const before = h.counts();
    const running = h.service.compareMitigationVariants(undefined, 'agent');
    h.service.setPlanConstraint('allowedMitigationActions', { capacityUpgrades: false, routingChanges: true, newLinks: true }, 'human');
    gate.resolve([]);
    await assert.rejects(running, /Stale design variants discarded/i);
    assert.equal(h.counts().designPublishes, before.designPublishes, 'stale Pareto frontier must never publish');
  }
});

test('AV-09/AV-10: adaptive requirements preserve human locks and forbidden-routing semantics', async () => {
  const h = createHarness();
  const lockedLink = h.project.links[0].id;
  const forbiddenLink = h.project.links[1].id;
  const lockedNode = h.project.nodes[0].id;
  const forbiddenNode = h.project.nodes[1].id;
  h.service.setPlanRestriction('link', lockedLink, true, 'human');
  h.service.setPlanRestriction('node', lockedNode, true, 'human');
  h.service.setRoutingRestriction('link', forbiddenLink, true, 'human');
  h.service.setRoutingRestriction('node', forbiddenNode, true, 'human');
  h.service.setPlanConstraint('allowedMitigationActions', { capacityUpgrades: false, routingChanges: true, newLinks: false }, 'human');

  let captured: any = null;
  h.adapters.optimizeAdaptiveDesign = async (_project, requirements) => {
    captured = structuredClone(requirements);
    return { variant: null, failureReason: 'NO_PATH_CANDIDATES', diagnostics: {} } as any;
  };
  const result = await h.service.generateMitigation(undefined, 'agent');
  assert.equal(result?.status, 'infeasible');
  assert.deepEqual(captured.lockedLinkIds, [lockedLink]);
  assert.deepEqual(captured.lockedNodeIds, [lockedNode]);
  assert.deepEqual(captured.forbiddenRoutingLinkIds, [forbiddenLink]);
  assert.deepEqual(captured.forbiddenRoutingNodeIds, [forbiddenNode]);
  assert.throws(() => h.service.setPlanRestriction('link', lockedLink, false, 'agent'), /cannot remove a human restriction/i);
  assert.throws(() => h.service.setRoutingRestriction('link', forbiddenLink, false, 'agent'), /cannot remove a human routing restriction/i);
});

test('AV-12/AV-35: presentation changes preserve verification freshness while semantic edits stale it immediately', async () => {
  const h = createHarness();
  const result = await h.service.verifyPlan(undefined, 'agent');
  assert.ok(['verified', 'failed', 'partial'].includes(result.status));
  assert.equal(h.counts().verificationPublishes, 1);
  assert.equal(h.service.getWorkspaceSummary().verification.current, true);

  h.service.select({ kind: 'link', id: h.project.links[0].id });
  h.service.focusEvidence({ type: 'link', id: h.project.links[0].id }, true);
  assert.equal(h.service.getWorkspaceSummary().verification.current, true, 'selection/navigation are presentation-only');

  h.service.setPlanConstraint('targetUtilizationPct', 77, 'human');
  const summary = h.service.getWorkspaceSummary();
  assert.equal(summary.verification.current, false);
  assert.equal(summary.verification.status, 'stale');
});

test('AV-35: in-flight verification rejects a concurrent semantic revision but ignores presentation churn', async () => {
  {
    const h = createHarness();
    const gate = deferred<void>();
    h.adapters.analyzePlanAsync = async (project, plan) => {
      const result = analyzeChangePlan(project, plan);
      await gate.promise;
      return result;
    };
    const running = h.service.verifyPlan(undefined, 'agent');
    h.service.select({ kind: 'link', id: h.project.links[0].id });
    gate.resolve();
    await running;
    assert.equal(h.counts().verificationPublishes, 1, 'presentation churn must not discard valid verification');
  }

  {
    const h = createHarness();
    const gate = deferred<void>();
    h.adapters.analyzePlanAsync = async (project, plan) => {
      const result = analyzeChangePlan(project, plan);
      await gate.promise;
      return result;
    };
    const running = h.service.verifyPlan(undefined, 'agent');
    h.service.setPlanRestriction('link', h.project.links[0].id, true, 'human');
    gate.resolve();
    await assert.rejects(running, /Stale verification discarded/i);
    assert.equal(h.counts().verificationPublishes, 0);
  }
});

test('AV-36: long-running analysis exceptions preserve prior valid evidence and a retry succeeds', async () => {
  const h = createHarness();
  const previous = analyzeChangePlan(h.project, h.plan);
  h.analysis = previous;
  let attempts = 0;
  h.adapters.analyzePlanAsync = async (project, plan) => {
    attempts += 1;
    if (attempts === 1) throw new Error('injected worker failure');
    return analyzeChangePlan(project, plan);
  };

  await assert.rejects(h.service.analyzePlan(undefined, 'agent'), /injected worker failure/);
  assert.equal(h.analysis, previous, 'failed recomputation must not erase prior evidence');
  assert.equal(h.counts().analysisPublishes, 0);

  const retry = await h.service.analyzePlan(undefined, 'agent');
  assert.equal(retry.state, 'current');
  assert.equal(h.counts().analysisPublishes, 1);
  assert.notEqual(h.analysis, null);
});

test('AV-40: semantic network replacement changes model identity used by authority checks', () => {
  const h = createHarness();
  const before = modelHash(h.project);
  const next = structuredClone(h.project);
  next.links[0].weight += 0.001;
  h.replaceProject(next);
  assert.notEqual(modelHash(h.project), before);
  assert.notEqual(h.plan.baseModelHash, modelHash(h.project));
});
