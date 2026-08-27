import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { routeProject } from '../packages/graph-engine/src/index.ts';
import { modelHash, validateNetworkProject } from '../packages/model/src/index.ts';
import { generateScaleProject, SCALE_TIERS, type ScaleTier, type ScaleWorkloadVariant } from './scale-fixtures.ts';

type Operation = 'validation' | 'semantic-hash' | 'route-project' | 'failure-recompute';

interface Measurement {
  fixture: string;
  tier: string;
  counts: { nodes: number; links: number; demands: number; regions: number };
  routingMode: 'single-shortest-path' | 'ecmp';
  workload: ScaleWorkloadVariant;
  operation: Operation;
  runtimeMs: number;
  success: boolean;
  execution: 'main-thread';
  scenarioCount?: number;
  heapDeltaBytes?: number;
  resultHash?: string;
  error?: string;
}

function elapsed<T>(fn: () => T): { value: T; runtimeMs: number; heapDeltaBytes: number } {
  const beforeHeap = process.memoryUsage().heapUsed;
  const start = performance.now();
  const value = fn();
  const runtimeMs = performance.now() - start;
  return { value, runtimeMs, heapDeltaBytes: process.memoryUsage().heapUsed - beforeHeap };
}

function stableRouteHash(result: ReturnType<typeof routeProject>): string {
  let hash = 2166136261 >>> 0;
  const text = JSON.stringify({
    mode: result.mode,
    peak: Math.round(result.peakUtilizationPct * 1e6),
    unrouted: result.unroutedDemandIds,
    routes: result.routes.map((route) => [route.demandId, route.reachable, route.totalWeight, route.linkIds, route.equalCostPathCountExact]),
    loads: Object.entries(result.linkLoadsGbps).map(([id, value]) => [id, Math.round(value * 1e9)]),
  });
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function measureCase(tier: ScaleTier, routingMode: 'single-shortest-path' | 'ecmp', workload: ScaleWorkloadVariant, seed: number): Measurement[] {
  const project = generateScaleProject({ ...tier, seed, routingMode, workload, sourceConcentration: Math.max(4, Math.ceil(tier.nodes * 0.06)), upgradeOptionDensity: 0.4 });
  const fixture = `${tier.id}-${routingMode}-${workload}`;
  const counts = { nodes: tier.nodes, links: tier.links, demands: tier.demands, regions: tier.regions };
  const output: Measurement[] = [];

  try {
    const validation = elapsed(() => validateNetworkProject(project));
    output.push({ fixture, tier: tier.id, counts, routingMode, workload, operation: 'validation', runtimeMs: validation.runtimeMs, success: validation.value.valid, execution: 'main-thread', heapDeltaBytes: validation.heapDeltaBytes, ...(validation.value.valid ? {} : { error: validation.value.errors.join('; ') }) });
    if (!validation.value.valid) return output;

    const hashing = elapsed(() => modelHash(project));
    output.push({ fixture, tier: tier.id, counts, routingMode, workload, operation: 'semantic-hash', runtimeMs: hashing.runtimeMs, success: true, execution: 'main-thread', heapDeltaBytes: hashing.heapDeltaBytes, resultHash: hashing.value });

    const routing = elapsed(() => routeProject(project));
    output.push({ fixture, tier: tier.id, counts, routingMode, workload, operation: 'route-project', runtimeMs: routing.runtimeMs, success: true, execution: 'main-thread', heapDeltaBytes: routing.heapDeltaBytes, resultHash: stableRouteHash(routing.value) });

    if (workload === 'failure-recompute') {
      const failedProject = { ...project, links: project.links.map((link, index) => index === Math.floor(project.links.length / 3) ? { ...link, available: false } : link) };
      const recompute = elapsed(() => routeProject(failedProject));
      output.push({ fixture, tier: tier.id, counts, routingMode, workload, operation: 'failure-recompute', runtimeMs: recompute.runtimeMs, success: true, execution: 'main-thread', scenarioCount: 1, heapDeltaBytes: recompute.heapDeltaBytes, resultHash: stableRouteHash(recompute.value) });
    }
  } catch (error) {
    output.push({ fixture, tier: tier.id, counts, routingMode, workload, operation: 'route-project', runtimeMs: 0, success: false, execution: 'main-thread', error: error instanceof Error ? error.message : String(error) });
  }
  return output;
}

const requiredWorkloads: ScaleWorkloadVariant[] = ['concentrated-sources', 'unique-sources', 'dense-cross-region', 'sparse', 'failure-recompute'];
const measurements: Measurement[] = [];

// Every tier is probed in both routing modes. Tier D intentionally records the current canonical-limit failure boundary.
for (const tier of SCALE_TIERS) {
  for (const routingMode of ['single-shortest-path', 'ecmp'] as const) {
    measurements.push(...measureCase(tier, routingMode, 'concentrated-sources', 3500 + tier.id.charCodeAt(0) * 17 + (routingMode === 'ecmp' ? 1 : 0)));
  }
}
// Workload-shape sensitivity is measured on Tier B to keep the complete gate repeatable.
const tierB = SCALE_TIERS.find((tier) => tier.id === 'B')!;
for (const workload of requiredWorkloads.filter((item) => item !== 'concentrated-sources')) {
  for (const routingMode of ['single-shortest-path', 'ecmp'] as const) measurements.push(...measureCase(tierB, routingMode, workload, 3551 + requiredWorkloads.indexOf(workload) * 31 + (routingMode === 'ecmp' ? 1 : 0)));
}

const context = {
  startedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cpuCount: os.cpus().length,
  cpuModel: os.cpus()[0]?.model ?? 'unknown',
  totalMemoryBytes: os.totalmem(),
  commit: process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
  benchmarkKind: 'node-engine-baseline',
};

mkdirSync('benchmark-results', { recursive: true });
writeFileSync('benchmark-results/scale.json', `${JSON.stringify({ context, measurements }, null, 2)}\n`, 'utf8');

const routeRows = measurements.filter((item) => item.operation === 'route-project' || item.operation === 'failure-recompute');
console.log('\nInfraTwin scale benchmark');
console.log(`${context.platform}/${context.arch} · ${context.cpuModel} · Node ${context.node}`);
for (const row of routeRows) {
  const status = row.success ? `${row.runtimeMs.toFixed(1)} ms` : `FAILED: ${row.error}`;
  console.log(`${row.fixture.padEnd(45)} ${row.operation.padEnd(18)} ${status}`);
}
console.log(`\nMachine-readable output: benchmark-results/scale.json (${measurements.length} measurements)`);

// Catastrophic-regression guard only: no fragile millisecond assertions.
const tierBMain = routeRows.find((row) => row.tier === 'B' && row.routingMode === 'single-shortest-path' && row.workload === 'concentrated-sources' && row.operation === 'route-project');
if (!tierBMain?.success) throw new Error('Tier B baseline routing benchmark must complete successfully.');
if (tierBMain.runtimeMs > 120_000) throw new Error(`Tier B routing exceeded catastrophic 120s guard (${tierBMain.runtimeMs.toFixed(1)} ms).`);
