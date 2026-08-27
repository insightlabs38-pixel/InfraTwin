import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { createChangePlan, compileChangePlanToScenarioPatch, type ScenarioPatch } from '../packages/model/src/index.ts';
import { runCapacityAnalysis, runLinkContingencies } from '../packages/evidence/src/index.ts';
import { maxFlowMinCut } from '../packages/graph-engine/src/index.ts';
import {
  buildCapacityUpgradeMILP,
  buildTrafficAllocationLP,
  estimateCapacityMILP,
  estimateTrafficAllocationLP,
  optimizeCapacityPlan,
  optimizeRouting,
} from '../packages/optimizer/src/index.ts';
import { generateScaleProject } from './scale-fixtures.ts';

type FeatureOperation =
  | 'changeplan-compile'
  | 'capacity-analysis'
  | 'min-cut-max-flow'
  | 'n1-sequential'
  | 'routing-lp-build'
  | 'routing-lp-solve'
  | 'routing-lp-guard'
  | 'capacity-milp-build'
  | 'capacity-milp-solve';

interface FeatureMeasurement {
  fixture: string;
  counts: { nodes: number; links: number; demands: number; regions: number };
  operation: FeatureOperation;
  runtimeMs: number;
  success: boolean;
  scenarioCount?: number;
  completedScenarios?: number;
  coverageStatus?: string;
  directedArcs?: number;
  flowVariables?: number;
  constraints?: number;
  decisionVariables?: number;
  decisionScenarioProduct?: number;
  modelConstructionMs?: number;
  wasmInitializationMs?: number;
  solveRuntimeMs?: number;
  solverStatus?: string;
  proof?: string;
  message?: string;
}

function countsOf(project: ReturnType<typeof generateScaleProject>) {
  return {
    nodes: project.nodes.length,
    links: project.links.length,
    demands: project.demands.length,
    regions: new Set(project.nodes.map((node) => node.region).filter(Boolean)).size,
  };
}

function outagePatches(project: ReturnType<typeof generateScaleProject>, count: number): ScenarioPatch[] {
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

const measurements: FeatureMeasurement[] = [];

const tierC = generateScaleProject({
  id: 'C', name: 'feature-tier-c', nodes: 500, links: 1200, demands: 400, regions: 12,
  seed: 3651, routingMode: 'single-shortest-path', workload: 'concentrated-sources', sourceConcentration: 24, upgradeOptionDensity: 0.4,
});
const cCounts = countsOf(tierC);
const compileStart = performance.now();
const plan = createChangePlan(tierC, 'Scale benchmark plan', { id: 'scale-benchmark-plan', now: new Date(0).toISOString() });
compileChangePlanToScenarioPatch(tierC, plan);
measurements.push({ fixture: 'Tier C concentrated-source', counts: cCounts, operation: 'changeplan-compile', runtimeMs: performance.now() - compileStart, success: true });

const capacityStartedAt = performance.now();
const capacityAnalysis = runCapacityAnalysis(tierC);
measurements.push({ fixture: 'Tier C concentrated-source', counts: cCounts, operation: 'capacity-analysis', runtimeMs: performance.now() - capacityStartedAt, success: Boolean(capacityAnalysis.result.verdict) });
const representativeDemand = tierC.demands[0];
const minCutStartedAt = performance.now();
const minCut = maxFlowMinCut(tierC, representativeDemand.source, representativeDemand.target);
measurements.push({ fixture: 'Tier C concentrated-source', counts: cCounts, operation: 'min-cut-max-flow', runtimeMs: performance.now() - minCutStartedAt, success: Number.isFinite(minCut.maxFlowGbps) });

for (const scenarioCount of [50, 100, 500]) {
  const startedAt = performance.now();
  try {
    const result = runLinkContingencies(tierC, null, scenarioCount);
    measurements.push({
      fixture: 'Tier C concentrated-source', counts: cCounts, operation: 'n1-sequential',
      runtimeMs: performance.now() - startedAt, success: true, scenarioCount,
      completedScenarios: result.completedScenarios, coverageStatus: result.status,
    });
  } catch (error) {
    measurements.push({ fixture: 'Tier C concentrated-source', counts: cCounts, operation: 'n1-sequential', runtimeMs: performance.now() - startedAt, success: false, scenarioCount, message: error instanceof Error ? error.message : String(error) });
  }
}

// Probe the current routing-LP envelope immediately below the 100k flow-variable guard.
const lpProbe = generateScaleProject({
  id: 'B', name: 'routing-lp-envelope-probe', nodes: 160, links: 360, demands: 135, regions: 8,
  seed: 3671, routingMode: 'single-shortest-path', workload: 'concentrated-sources', sourceConcentration: 16, upgradeOptionDensity: 0.3,
});
const lpCounts = countsOf(lpProbe);
const lpEstimate = estimateTrafficAllocationLP(lpProbe);
const lpBuildStart = performance.now();
try {
  buildTrafficAllocationLP(lpProbe);
  measurements.push({ fixture: 'Routing LP ~100k variable probe', counts: lpCounts, operation: 'routing-lp-build', runtimeMs: performance.now() - lpBuildStart, success: true, directedArcs: lpEstimate.directedArcs, flowVariables: lpEstimate.flowVariables, constraints: lpEstimate.constraints });
} catch (error) {
  measurements.push({ fixture: 'Routing LP ~100k variable probe', counts: lpCounts, operation: 'routing-lp-build', runtimeMs: performance.now() - lpBuildStart, success: false, directedArcs: lpEstimate.directedArcs, flowVariables: lpEstimate.flowVariables, constraints: lpEstimate.constraints, message: error instanceof Error ? error.message : String(error) });
}
const lpSolveStart = performance.now();
try {
  const result = await optimizeRouting(lpProbe, { timeLimitMs: 8_000 });
  measurements.push({
    fixture: 'Routing LP ~100k variable probe', counts: lpCounts, operation: 'routing-lp-solve', runtimeMs: performance.now() - lpSolveStart,
    success: result.diagnostics.status !== 'Not recommended at this scale', directedArcs: lpEstimate.directedArcs, flowVariables: lpEstimate.flowVariables,
    constraints: lpEstimate.constraints, modelConstructionMs: result.diagnostics.modelConstructionMs,
    wasmInitializationMs: result.diagnostics.wasmInitializationMs, solveRuntimeMs: result.diagnostics.solveRuntimeMs,
    solverStatus: result.diagnostics.status, proof: result.diagnostics.proof, message: result.diagnostics.message,
  });
} catch (error) {
  measurements.push({ fixture: 'Routing LP ~100k variable probe', counts: lpCounts, operation: 'routing-lp-solve', runtimeMs: performance.now() - lpSolveStart, success: false, directedArcs: lpEstimate.directedArcs, flowVariables: lpEstimate.flowVariables, constraints: lpEstimate.constraints, message: error instanceof Error ? error.message : String(error) });
}

const lpGuard = generateScaleProject({
  id: 'B', name: 'routing-lp-guard-probe', nodes: 250, links: 600, demands: 200, regions: 8,
  seed: 3673, routingMode: 'single-shortest-path', workload: 'concentrated-sources', sourceConcentration: 20, upgradeOptionDensity: 0.3,
});
const lpGuardEstimate = estimateTrafficAllocationLP(lpGuard);
const guardStart = performance.now();
const guarded = await optimizeRouting(lpGuard, { timeLimitMs: 2_000 });
measurements.push({
  fixture: 'Tier B routing-LP guard', counts: countsOf(lpGuard), operation: 'routing-lp-guard', runtimeMs: performance.now() - guardStart,
  success: guarded.diagnostics.status === 'Not recommended at this scale', directedArcs: lpGuardEstimate.directedArcs,
  flowVariables: lpGuardEstimate.flowVariables, constraints: lpGuardEstimate.constraints,
  solverStatus: guarded.diagnostics.status, proof: guarded.diagnostics.proof, message: guarded.diagnostics.message,
});

// Capacity MILP is measured separately because its scale is decisions × selected scenarios, not demand × arc count.
const capacityProbe = generateScaleProject({
  id: 'B', name: 'capacity-milp-probe', nodes: 250, links: 600, demands: 200, regions: 8,
  seed: 3691, routingMode: 'single-shortest-path', workload: 'concentrated-sources', sourceConcentration: 20, upgradeOptionDensity: 0.4,
});
const capacityRequirements = { includeBaseline: true, targetUtilizationPct: 95, scenarioPatches: outagePatches(capacityProbe, 20) };
const capacityEstimate = estimateCapacityMILP(capacityProbe, capacityRequirements);
const capacityBuildStart = performance.now();
try {
  buildCapacityUpgradeMILP(capacityProbe, capacityRequirements);
  measurements.push({
    fixture: 'Tier B capacity-MILP 21-scenario probe', counts: countsOf(capacityProbe), operation: 'capacity-milp-build',
    runtimeMs: performance.now() - capacityBuildStart, success: true, scenarioCount: capacityEstimate.scenarioCount,
    decisionVariables: capacityEstimate.decisionVariables, decisionScenarioProduct: capacityEstimate.decisionScenarioProduct,
    constraints: capacityEstimate.estimatedConstraints,
  });
} catch (error) {
  measurements.push({ fixture: 'Tier B capacity-MILP 21-scenario probe', counts: countsOf(capacityProbe), operation: 'capacity-milp-build', runtimeMs: performance.now() - capacityBuildStart, success: false, scenarioCount: capacityEstimate.scenarioCount, decisionVariables: capacityEstimate.decisionVariables, decisionScenarioProduct: capacityEstimate.decisionScenarioProduct, constraints: capacityEstimate.estimatedConstraints, message: error instanceof Error ? error.message : String(error) });
}
const capacitySolveStart = performance.now();
try {
  const result = await optimizeCapacityPlan(capacityProbe, capacityRequirements, { timeLimitMs: 8_000 });
  measurements.push({
    fixture: 'Tier B capacity-MILP 21-scenario probe', counts: countsOf(capacityProbe), operation: 'capacity-milp-solve',
    runtimeMs: performance.now() - capacitySolveStart, success: result.diagnostics.status !== 'Not recommended at this scale',
    scenarioCount: capacityEstimate.scenarioCount, decisionVariables: capacityEstimate.decisionVariables,
    decisionScenarioProduct: capacityEstimate.decisionScenarioProduct, constraints: capacityEstimate.estimatedConstraints,
    modelConstructionMs: result.diagnostics.modelConstructionMs, wasmInitializationMs: result.diagnostics.wasmInitializationMs,
    solveRuntimeMs: result.diagnostics.solveRuntimeMs, solverStatus: result.diagnostics.status,
    proof: result.diagnostics.proof, message: result.diagnostics.message,
  });
} catch (error) {
  measurements.push({ fixture: 'Tier B capacity-MILP 21-scenario probe', counts: countsOf(capacityProbe), operation: 'capacity-milp-solve', runtimeMs: performance.now() - capacitySolveStart, success: false, scenarioCount: capacityEstimate.scenarioCount, decisionVariables: capacityEstimate.decisionVariables, decisionScenarioProduct: capacityEstimate.decisionScenarioProduct, constraints: capacityEstimate.estimatedConstraints, message: error instanceof Error ? error.message : String(error) });
}

const context = {
  generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
  cpuCount: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? 'unknown', totalMemoryBytes: os.totalmem(),
  commit: process.env.GITHUB_SHA ?? 'local', benchmarkKind: 'phase35c-feature-envelopes',
};
mkdirSync('benchmark-results', { recursive: true });
writeFileSync('benchmark-results/feature-scale.json', `${JSON.stringify({ context, measurements }, null, 2)}\n`, 'utf8');
console.log('\nInfraTwin Phase 3.5C feature-scale benchmark');
for (const row of measurements) console.log(`${row.operation.padEnd(22)} ${row.fixture.padEnd(42)} ${row.success ? `${row.runtimeMs.toFixed(1)} ms` : `FAILED ${row.message ?? ''}`}${row.solverStatus ? ` · ${row.solverStatus}` : ''}`);
console.log('\nMachine-readable output: benchmark-results/feature-scale.json');

// Correctness/guardrail assertions only; runtime remains report-oriented.
if (!measurements.filter((row) => row.operation === 'n1-sequential').every((row) => row.success)) throw new Error('All bounded N-1 benchmark probes must complete.');
if (!guarded.diagnostics.status.includes('Not recommended')) throw new Error('Routing-LP scale guard did not activate above its declared envelope.');
