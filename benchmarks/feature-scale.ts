import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { createChangePlan, compileChangePlanToScenarioPatch } from '../packages/model/src/index.ts';
import { runCapacityAnalysis, runLinkContingencies } from '../packages/evidence/src/index.ts';
import { minCut } from '../packages/graph-engine/src/index.ts';
import { estimateTrafficAllocationLP, optimizeRouting } from '../packages/optimizer/src/index.ts';
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
  problemBytes?: number;
  message?: string;
  isolatedProbe?: boolean;
}

type ChildPayload = Record<string, unknown> & {
  operation?: string;
  runtimeMs?: number;
  success?: boolean;
  message?: string;
  estimate?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
};

function countsOf(project: ReturnType<typeof generateScaleProject>) {
  return {
    nodes: project.nodes.length,
    links: project.links.length,
    demands: project.demands.length,
    regions: new Set(project.nodes.map((node) => node.region).filter(Boolean)).size,
  };
}

const context = {
  generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
  cpuCount: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? 'unknown', totalMemoryBytes: os.totalmem(),
  commit: process.env.GITHUB_SHA ?? 'local', benchmarkKind: 'phase35c-feature-envelopes',
};
const measurements: FeatureMeasurement[] = [];
mkdirSync('benchmark-results', { recursive: true });

function persist(): void {
  writeFileSync('benchmark-results/feature-scale.json', `${JSON.stringify({ context, measurements }, null, 2)}\n`, 'utf8');
}

function add(row: FeatureMeasurement): void {
  measurements.push(row);
  persist();
  console.log(`${row.operation.padEnd(22)} ${row.fixture.padEnd(42)} ${row.success ? `${row.runtimeMs.toFixed(1)} ms` : `BOUNDARY ${row.message ?? ''}`}${row.solverStatus ? ` · ${row.solverStatus}` : ''}`);
}

function childProbe(operation: string): { payload: ChildPayload | null; message: string } {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--max-old-space-size=4096', 'benchmarks/feature-probe-child.ts', operation],
    { encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024, env: process.env },
  );
  const marker = (result.stdout ?? '').split(/\r?\n/).findLast((line) => line.startsWith('PHASE35C_RESULT='));
  if (marker) {
    try { return { payload: JSON.parse(marker.slice('PHASE35C_RESULT='.length)) as ChildPayload, message: '' }; }
    catch { /* fall through to process-level failure evidence */ }
  }
  const stderr = (result.stderr ?? '').trim().split(/\r?\n/).slice(-8).join(' | ');
  const processMessage = result.error
    ? `${result.error.name}: ${result.error.message}`
    : `isolated process exited status=${String(result.status)} signal=${String(result.signal)}${stderr ? `; ${stderr}` : ''}`;
  return { payload: null, message: processMessage };
}

console.log('\nInfraTwin Phase 3.5C feature-scale benchmark');

const tierC = generateScaleProject({
  id: 'C', name: 'feature-tier-c', nodes: 500, links: 1200, demands: 400, regions: 12,
  seed: 3651, routingMode: 'single-shortest-path', workload: 'concentrated-sources', sourceConcentration: 24, upgradeOptionDensity: 0.4,
});
const cCounts = countsOf(tierC);
let startedAt = performance.now();
const plan = createChangePlan(tierC, 'Scale benchmark plan', { id: 'scale-benchmark-plan', now: new Date(0).toISOString() });
compileChangePlanToScenarioPatch(tierC, plan);
add({ fixture: 'Tier C concentrated-source', counts: cCounts, operation: 'changeplan-compile', runtimeMs: performance.now() - startedAt, success: true });

startedAt = performance.now();
const capacityAnalysis = runCapacityAnalysis(tierC);
add({ fixture: 'Tier C concentrated-source', counts: cCounts, operation: 'capacity-analysis', runtimeMs: performance.now() - startedAt, success: Boolean(capacityAnalysis.result.verdict) });

const representativeDemand = tierC.demands[0];
startedAt = performance.now();
const cut = minCut(tierC, representativeDemand.source, representativeDemand.target);
add({ fixture: 'Tier C concentrated-source', counts: cCounts, operation: 'min-cut-max-flow', runtimeMs: performance.now() - startedAt, success: Number.isFinite(cut.maxFlowGbps) });

for (const scenarioCount of [50, 100]) {
  startedAt = performance.now();
  try {
    const result = runLinkContingencies(tierC, null, scenarioCount);
    add({ fixture: 'Tier C concentrated-source', counts: cCounts, operation: 'n1-sequential', runtimeMs: performance.now() - startedAt, success: true, scenarioCount, completedScenarios: result.completedScenarios, coverageStatus: result.status });
  } catch (error) {
    add({ fixture: 'Tier C concentrated-source', counts: cCounts, operation: 'n1-sequential', runtimeMs: performance.now() - startedAt, success: false, scenarioCount, message: error instanceof Error ? error.message : String(error) });
  }
}

// The exact 500-scenario engine cap is a boundary probe, not a normal browser recommendation. Run it in
// isolation so a measured heap/OOM boundary is recorded without taking down the rest of the quality gate.
const n1Boundary = childProbe('n1-500');
if (n1Boundary.payload) {
  add({
    fixture: 'Tier C concentrated-source', counts: cCounts, operation: 'n1-sequential', isolatedProbe: true,
    runtimeMs: Number(n1Boundary.payload.runtimeMs ?? 0), success: Boolean(n1Boundary.payload.success), scenarioCount: 500,
    completedScenarios: Number(n1Boundary.payload.completedScenarios ?? 0), coverageStatus: String(n1Boundary.payload.coverageStatus ?? ''),
    message: n1Boundary.payload.message ? String(n1Boundary.payload.message) : undefined,
  });
} else {
  add({ fixture: 'Tier C concentrated-source', counts: cCounts, operation: 'n1-sequential', isolatedProbe: true, runtimeMs: 120_000, success: false, scenarioCount: 500, message: n1Boundary.message });
}

const lpCounts = { nodes: 160, links: 360, demands: 135, regions: 8 };
for (const [childOperation, featureOperation] of [['routing-lp-build', 'routing-lp-build'], ['routing-lp-solve', 'routing-lp-solve']] as const) {
  const probe = childProbe(childOperation);
  if (!probe.payload) {
    add({ fixture: 'Routing LP ~100k variable probe', counts: lpCounts, operation: featureOperation, isolatedProbe: true, runtimeMs: 120_000, success: false, message: probe.message });
    continue;
  }
  const estimate = probe.payload.estimate ?? {};
  const diagnostics = probe.payload.diagnostics ?? {};
  add({
    fixture: 'Routing LP ~100k variable probe', counts: lpCounts, operation: featureOperation, isolatedProbe: true,
    runtimeMs: Number(probe.payload.runtimeMs ?? 0), success: Boolean(probe.payload.success),
    directedArcs: Number(estimate.directedArcs ?? 0), flowVariables: Number(estimate.flowVariables ?? 0), constraints: Number(estimate.constraints ?? 0),
    modelConstructionMs: Number(probe.payload.modelConstructionMs ?? diagnostics.modelConstructionMs ?? 0),
    wasmInitializationMs: Number(diagnostics.wasmInitializationMs ?? 0), solveRuntimeMs: Number(diagnostics.solveRuntimeMs ?? 0),
    solverStatus: diagnostics.status ? String(diagnostics.status) : undefined, proof: diagnostics.proof ? String(diagnostics.proof) : undefined,
    problemBytes: probe.payload.problemBytes === undefined ? undefined : Number(probe.payload.problemBytes),
    message: probe.payload.message ? String(probe.payload.message) : diagnostics.message ? String(diagnostics.message) : undefined,
  });
}

const lpGuard = generateScaleProject({
  id: 'B', name: 'routing-lp-guard-probe', nodes: 250, links: 600, demands: 200, regions: 8,
  seed: 3673, routingMode: 'single-shortest-path', workload: 'concentrated-sources', sourceConcentration: 20, upgradeOptionDensity: 0.3,
});
const lpGuardEstimate = estimateTrafficAllocationLP(lpGuard);
startedAt = performance.now();
const guarded = await optimizeRouting(lpGuard, { timeLimitMs: 2_000 });
add({
  fixture: 'Tier B routing-LP guard', counts: countsOf(lpGuard), operation: 'routing-lp-guard', runtimeMs: performance.now() - startedAt,
  success: guarded.diagnostics.status === 'Not recommended at this scale', directedArcs: lpGuardEstimate.directedArcs,
  flowVariables: lpGuardEstimate.flowVariables, constraints: lpGuardEstimate.constraints,
  solverStatus: guarded.diagnostics.status, proof: guarded.diagnostics.proof, message: guarded.diagnostics.message,
});

const capacityCounts = { nodes: 250, links: 600, demands: 200, regions: 8 };
for (const [childOperation, featureOperation] of [['capacity-milp-build', 'capacity-milp-build'], ['capacity-milp-solve', 'capacity-milp-solve']] as const) {
  const probe = childProbe(childOperation);
  if (!probe.payload) {
    add({ fixture: 'Tier B capacity-MILP 21-scenario probe', counts: capacityCounts, operation: featureOperation, isolatedProbe: true, runtimeMs: 120_000, success: false, message: probe.message });
    continue;
  }
  const estimate = probe.payload.estimate ?? {};
  const diagnostics = probe.payload.diagnostics ?? {};
  add({
    fixture: 'Tier B capacity-MILP 21-scenario probe', counts: capacityCounts, operation: featureOperation, isolatedProbe: true,
    runtimeMs: Number(probe.payload.runtimeMs ?? 0), success: Boolean(probe.payload.success),
    scenarioCount: Number(estimate.scenarioCount ?? 0), decisionVariables: Number(estimate.decisionVariables ?? 0),
    decisionScenarioProduct: Number(estimate.decisionScenarioProduct ?? 0), constraints: Number(estimate.estimatedConstraints ?? 0),
    modelConstructionMs: Number(probe.payload.modelConstructionMs ?? diagnostics.modelConstructionMs ?? 0),
    wasmInitializationMs: Number(diagnostics.wasmInitializationMs ?? 0), solveRuntimeMs: Number(diagnostics.solveRuntimeMs ?? 0),
    solverStatus: diagnostics.status ? String(diagnostics.status) : undefined, proof: diagnostics.proof ? String(diagnostics.proof) : undefined,
    problemBytes: probe.payload.problemBytes === undefined ? undefined : Number(probe.payload.problemBytes),
    message: probe.payload.message ? String(probe.payload.message) : diagnostics.message ? String(diagnostics.message) : undefined,
  });
}

console.log('\nMachine-readable output: benchmark-results/feature-scale.json');

// Correctness/guardrail assertions only; runtime and isolated failure boundaries remain report-oriented.
const requiredN1 = measurements.filter((row) => row.operation === 'n1-sequential' && (row.scenarioCount === 50 || row.scenarioCount === 100));
if (requiredN1.length !== 2 || requiredN1.some((row) => !row.success)) throw new Error('Tier C 50- and 100-scenario N-1 probes must complete.');
if (!guarded.diagnostics.status.includes('Not recommended')) throw new Error('Routing-LP scale guard did not activate above its declared envelope.');
