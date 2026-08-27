import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChangePlan, runLinkContingencies } from '../packages/evidence/src/index.ts';
import { createRoutingSession, estimateRoutingWorkload, routeProject, routeProjectReference } from '../packages/graph-engine/src/index.ts';
import { cloneProject, createChangePlan, modelHash, type NetworkProject } from '../packages/model/src/index.ts';
import { estimateTrafficAllocationLP } from '../packages/optimizer/src/index.ts';
import { generateScaleProject } from '../packages/scenarios/src/scale-generator.ts';
import { executeChangePlanAnalysisWorkerKernel } from '../apps/web/lib/analysis-worker-core.ts';
import { analysisExecutionProfile, createAnalysisAuthorityToken, isAnalysisAuthorityTokenCurrent } from '../apps/web/lib/analysis-execution.ts';

function fixture(mode: 'single-shortest-path' | 'ecmp', seed = 351): NetworkProject {
  return generateScaleProject({ id: 'A', name: 'property', nodes: 18, links: 42, demands: 30, regions: 3, seed, routingMode: mode, workload: 'concentrated-sources', sourceConcentration: 4, serviceClassCount: 3, upgradeOptionDensity: 0.25 });
}

function comparable(result: ReturnType<typeof routeProject>) {
  return {
    mode: result.mode,
    unroutedDemandIds: result.unroutedDemandIds,
    peakUtilizationPct: result.peakUtilizationPct,
    linkLoadsGbps: result.linkLoadsGbps,
    linkUtilizationPct: result.linkUtilizationPct,
    routes: result.routes.map((route) => ({
      demandId: route.demandId, reachable: route.reachable, nodeIds: route.nodeIds, linkIds: route.linkIds,
      totalWeight: route.totalWeight, equalCostPathCountExact: route.equalCostPathCountExact,
      equalCostPathCount: route.equalCostPathCount, materializedPathCount: route.materializedPathCount,
      pathsTruncated: route.pathsTruncated, linkFractions: route.linkFractions,
    })),
  };
}

test('Phase 3.5C A: accelerated single-shortest-path is semantically identical to independent O(V²) reference across deterministic seeds', () => {
  for (const seed of [351, 352, 353, 354, 355]) {
    const project = fixture('single-shortest-path', seed);
    assert.deepEqual(comparable(routeProject(project)), comparable(routeProjectReference(project)));
  }
});

test('Phase 3.5C B: accelerated ECMP preserves path counts, fractions, routes, and loads against the independent reference', () => {
  for (const seed of [401, 402, 403, 404]) {
    const project = fixture('ecmp', seed);
    assert.deepEqual(comparable(routeProject(project)), comparable(routeProjectReference(project)));
  }
});

test('Phase 3.5C C: operation-scoped routing session reuses topology/source structures without changing answers', () => {
  const project = fixture('single-shortest-path');
  const session = createRoutingSession();
  const first = routeProject(project, session);
  const graphBuilds = session.stats.graphBuilds;
  const sourceComputations = session.stats.sourceComputations;
  const second = routeProject(cloneProject(project), session);
  assert.deepEqual(comparable(second), comparable(first));
  assert.equal(session.stats.graphBuilds, graphBuilds);
  assert.equal(session.stats.graphReuses > 0, true);
  assert.equal(session.stats.sourceComputations, sourceComputations);
  assert.equal(session.stats.sourceReuses >= new Set(project.demands.map((demand) => demand.source)).size, true);
});

test('Phase 3.5C D: availability/weight topology edits invalidate routing structures and cannot return a stale cached route', () => {
  const project = fixture('single-shortest-path');
  const session = createRoutingSession();
  routeProject(project, session);
  const beforeBuilds = session.stats.graphBuilds;
  const edited = cloneProject(project);
  edited.links[0].available = false;
  edited.links[1].weight += 7;
  const cachedSessionResult = routeProject(edited, session);
  const independent = routeProject(edited);
  assert.deepEqual(comparable(cachedSessionResult), comparable(independent));
  assert.equal(session.stats.graphBuilds, beforeBuilds + 1);
});

test('Phase 3.5C E: bandwidth-only changes reuse shortest-path structures while recomputing flow accumulation', () => {
  const project = fixture('single-shortest-path');
  const session = createRoutingSession();
  const before = routeProject(project, session);
  const graphBuilds = session.stats.graphBuilds;
  const sourceComputations = session.stats.sourceComputations;
  const edited = cloneProject(project);
  edited.demands[0].bandwidthGbps *= 2;
  const after = routeProject(edited, session);
  assert.equal(session.stats.graphBuilds, graphBuilds);
  assert.equal(session.stats.sourceComputations, sourceComputations);
  assert.notDeepEqual(after.linkLoadsGbps, before.linkLoadsGbps);
  assert.deepEqual(after.routes.map((route) => route.linkIds), before.routes.map((route) => route.linkIds));
});

test('Phase 3.5C F: browser-worker analysis kernel is semantically identical to the synchronous analysis path after structured cloning', () => {
  const project = fixture('ecmp');
  const plan = createChangePlan(project, 'worker parity', { id: 'phase35c-worker-parity', now: '2026-01-01T00:00:00.000Z' });
  const sync = analyzeChangePlan(project, plan);
  const worker = executeChangePlanAnalysisWorkerKernel(structuredClone(project), structuredClone(plan));
  const normalize = (value: typeof sync) => ({ ...value, capacity: { ...value.capacity, result: { ...value.capacity.result, runtimeMs: 0 } } });
  assert.deepEqual(normalize(worker), normalize(sync));
});

test('Phase 3.5C G: scale/execution estimator is deterministic and sends high-unique-source ECMP work to a Worker', () => {
  const small = fixture('single-shortest-path');
  assert.deepEqual(estimateRoutingWorkload(small), estimateRoutingWorkload(structuredClone(small)));
  assert.deepEqual(analysisExecutionProfile(small), analysisExecutionProfile(structuredClone(small)));
  const large = generateScaleProject({ id: 'C', name: 'worker-threshold', nodes: 500, links: 1200, demands: 400, regions: 12, seed: 3553, routingMode: 'ecmp', workload: 'unique-sources', serviceClassCount: 3, upgradeOptionDensity: 0.1 });
  assert.equal(analysisExecutionProfile(large).mode, 'worker');
});

test('Phase 3.5C H: routing-LP size estimator exactly matches demand × active directed-arc construction', () => {
  const project = fixture('ecmp');
  project.links[0].bidirectional = false;
  project.links[1].available = false;
  const activeLinks = project.links.filter((link) => link.available !== false);
  const directedArcs = activeLinks.reduce((sum, link) => sum + (link.bidirectional === false ? 1 : 2), 0);
  const estimate = estimateTrafficAllocationLP(project);
  assert.equal(estimate.directedArcs, directedArcs);
  assert.equal(estimate.flowVariables, project.demands.length * directedArcs);
  assert.equal(estimate.constraints, project.demands.length * project.nodes.length + activeLinks.length);
});

test('Phase 3.5C I: exact N-1 explicitly distinguishes complete and partial coverage', () => {
  const project = fixture('single-shortest-path');
  const partial = runLinkContingencies(project, null, 5);
  assert.equal(partial.status, 'partial');
  assert.equal(partial.completedScenarios, 5);
  assert.equal(partial.totalEligibleScenarios, project.links.length);
  assert.equal(partial.result.verdict, 'CANCELLED');
  const complete = runLinkContingencies(project, null, project.links.length);
  assert.equal(complete.status, 'complete');
  assert.equal(complete.completedScenarios, complete.totalEligibleScenarios);
});

test('Phase 3.5C J: workload generator is hash-stable for equal seeds and changes semantic hash for a different seeded design space', () => {
  const options = { id: 'B' as const, name: 'hash', nodes: 64, links: 150, demands: 80, regions: 5, routingMode: 'ecmp' as const, workload: 'concentrated-sources' as const, sourceConcentration: 8, serviceClassCount: 3, upgradeOptionDensity: 0.5 };
  const one = generateScaleProject({ ...options, seed: 9001 });
  const two = generateScaleProject({ ...options, seed: 9001 });
  const other = generateScaleProject({ ...options, seed: 9002 });
  assert.equal(modelHash(one), modelHash(two));
  assert.notEqual(modelHash(one), modelHash(other));
});

test('Phase 3.5C K: worker authority token rejects stale results after a nontrivial plan or network revision', () => {
  const project = fixture('ecmp');
  const plan = createChangePlan(project, 'stale-race', { id: 'phase35c-stale-race', now: '2026-01-01T00:00:00.000Z' });
  const token = createAnalysisAuthorityToken(project, plan, 7);
  assert.equal(isAnalysisAuthorityTokenCurrent(token, project, plan, 7), true);
  const editedProject = cloneProject(project); editedProject.demands[0].bandwidthGbps += 1;
  assert.equal(isAnalysisAuthorityTokenCurrent(token, editedProject, plan, 7), false);
  assert.equal(isAnalysisAuthorityTokenCurrent(token, project, plan, 8), false);
});
