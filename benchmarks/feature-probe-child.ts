import { performance } from 'node:perf_hooks';
import { runLinkContingencies } from '../packages/evidence/src/index.ts';
import {
  buildCapacityUpgradeMILP,
  buildTrafficAllocationLP,
  estimateCapacityMILP,
  estimateTrafficAllocationLP,
  optimizeCapacityPlan,
  optimizeRouting,
} from '../packages/optimizer/src/index.ts';
import { generateScaleProject } from './scale-fixtures.ts';

const operation = process.argv[2] ?? '';
const startedAt = performance.now();
const emit = (payload: Record<string, unknown>) => {
  console.log(`PHASE35C_RESULT=${JSON.stringify({ operation, runtimeMs: performance.now() - startedAt, ...payload })}`);
};

function outagePatches(project: ReturnType<typeof generateScaleProject>, count: number) {
  return project.links.slice(0, count).map((link, index) => ({
    id: `feature-bench-outage-${index}`,
    name: `Feature benchmark outage ${index + 1}`,
    disabledNodeIds: [],
    disabledLinkIds: [link.id],
    demandMultipliers: [],
    addedDemands: [],
    linkCapacityOverrides: [],
  }));
}

const routingLpSolveProbes: Record<string, { name: string; nodes: number; links: number; demands: number; seed: number; sourceConcentration: number; timeLimitMs: number }> = {
  'routing-lp-solve-10k': { name: 'routing-lp-10k-probe', nodes: 60, links: 100, demands: 50, seed: 3681, sourceConcentration: 8, timeLimitMs: 5_000 },
  'routing-lp-solve-20k': { name: 'routing-lp-20k-probe', nodes: 70, links: 140, demands: 70, seed: 3683, sourceConcentration: 9, timeLimitMs: 5_000 },
  'routing-lp-solve-30k': { name: 'routing-lp-30k-probe', nodes: 85, links: 175, demands: 85, seed: 3685, sourceConcentration: 10, timeLimitMs: 5_000 },
  'routing-lp-solve-40k': { name: 'routing-lp-40k-probe', nodes: 100, links: 220, demands: 90, seed: 3675, sourceConcentration: 12, timeLimitMs: 5_000 },
  'routing-lp-solve-60k': { name: 'routing-lp-60k-probe', nodes: 120, links: 270, demands: 110, seed: 3677, sourceConcentration: 14, timeLimitMs: 5_000 },
  'routing-lp-solve-80k': { name: 'routing-lp-80k-probe', nodes: 140, links: 315, demands: 125, seed: 3679, sourceConcentration: 16, timeLimitMs: 5_000 },
  'routing-lp-solve': { name: 'routing-lp-envelope-probe', nodes: 160, links: 360, demands: 135, seed: 3671, sourceConcentration: 16, timeLimitMs: 8_000 },
};

try {
  if (operation === 'n1-500') {
    const project = generateScaleProject({ id: 'C', name: 'feature-tier-c-n1-500', nodes: 500, links: 1200, demands: 400, regions: 12, seed: 3651, routingMode: 'single-shortest-path', workload: 'concentrated-sources', sourceConcentration: 24, upgradeOptionDensity: 0.4 });
    const result = runLinkContingencies(project, null, 500);
    emit({ success: true, scenarioCount: 500, completedScenarios: result.completedScenarios, coverageStatus: result.status });
  } else if (operation === 'routing-lp-build') {
    const project = generateScaleProject({ id: 'B', name: 'routing-lp-envelope-probe', nodes: 160, links: 360, demands: 135, regions: 8, seed: 3671, routingMode: 'single-shortest-path', workload: 'concentrated-sources', sourceConcentration: 16, upgradeOptionDensity: 0.3 });
    const estimate = estimateTrafficAllocationLP(project);
    const buildStartedAt = performance.now();
    const { problem } = buildTrafficAllocationLP(project);
    emit({ success: true, estimate, modelConstructionMs: performance.now() - buildStartedAt, problemBytes: Buffer.byteLength(problem, 'utf8') });
  } else if (routingLpSolveProbes[operation]) {
    const config = routingLpSolveProbes[operation];
    const project = generateScaleProject({ id: 'B', name: config.name, nodes: config.nodes, links: config.links, demands: config.demands, regions: 8, seed: config.seed, routingMode: 'single-shortest-path', workload: 'concentrated-sources', sourceConcentration: config.sourceConcentration, upgradeOptionDensity: 0.3 });
    const estimate = estimateTrafficAllocationLP(project);
    const result = await optimizeRouting(project, { timeLimitMs: config.timeLimitMs, allowLargeModel: true });
    const usable = result.diagnostics.proof === 'optimal' || (result.diagnostics.proof === 'feasible-incumbent' && result.verification?.valid === true);
    emit({ success: usable, estimate, diagnostics: result.diagnostics, verificationValid: result.verification?.valid ?? null });
  } else if (operation === 'capacity-milp-build' || operation === 'capacity-milp-solve') {
    const project = generateScaleProject({ id: 'B', name: 'capacity-milp-probe', nodes: 250, links: 600, demands: 200, regions: 8, seed: 3691, routingMode: 'single-shortest-path', workload: 'concentrated-sources', sourceConcentration: 20, upgradeOptionDensity: 0.4 });
    const requirements = { includeBaseline: true, targetUtilizationPct: 95, scenarioPatches: outagePatches(project, 20) };
    const estimate = estimateCapacityMILP(project, requirements);
    if (operation === 'capacity-milp-build') {
      const buildStartedAt = performance.now();
      const { problem } = buildCapacityUpgradeMILP(project, requirements);
      emit({ success: true, estimate, modelConstructionMs: performance.now() - buildStartedAt, problemBytes: Buffer.byteLength(problem, 'utf8') });
    } else {
      const result = await optimizeCapacityPlan(project, requirements, { timeLimitMs: 8_000, allowLargeModel: true });
      emit({ success: result.diagnostics.proof !== 'unknown' && result.diagnostics.status !== 'Not recommended at this scale', estimate, diagnostics: result.diagnostics });
    }
  } else {
    throw new Error(`Unknown Phase 3.5C child probe: ${operation}`);
  }
} catch (error) {
  emit({ success: false, message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
