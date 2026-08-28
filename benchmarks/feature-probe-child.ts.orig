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
  } else if (operation === 'routing-lp-solve') {
    const project = generateScaleProject({ id: 'B', name: 'routing-lp-envelope-probe', nodes: 160, links: 360, demands: 135, regions: 8, seed: 3671, routingMode: 'single-shortest-path', workload: 'concentrated-sources', sourceConcentration: 16, upgradeOptionDensity: 0.3 });
    const estimate = estimateTrafficAllocationLP(project);
    const result = await optimizeRouting(project, { timeLimitMs: 8_000 });
    emit({ success: result.diagnostics.status !== 'Not recommended at this scale', estimate, diagnostics: result.diagnostics });
  } else if (operation === 'capacity-milp-build' || operation === 'capacity-milp-solve') {
    const project = generateScaleProject({ id: 'B', name: 'capacity-milp-probe', nodes: 250, links: 600, demands: 200, regions: 8, seed: 3691, routingMode: 'single-shortest-path', workload: 'concentrated-sources', sourceConcentration: 20, upgradeOptionDensity: 0.4 });
    const requirements = { includeBaseline: true, targetUtilizationPct: 95, scenarioPatches: outagePatches(project, 20) };
    const estimate = estimateCapacityMILP(project, requirements);
    if (operation === 'capacity-milp-build') {
      const buildStartedAt = performance.now();
      const problem = buildCapacityUpgradeMILP(project, requirements);
      emit({ success: true, estimate, modelConstructionMs: performance.now() - buildStartedAt, problemBytes: Buffer.byteLength(problem, 'utf8') });
    } else {
      const result = await optimizeCapacityPlan(project, requirements, { timeLimitMs: 8_000 });
      emit({ success: result.diagnostics.status !== 'Not recommended at this scale', estimate, diagnostics: result.diagnostics });
    }
  } else {
    throw new Error(`Unknown Phase 3.5C child probe: ${operation}`);
  }
} catch (error) {
  emit({ success: false, message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}
