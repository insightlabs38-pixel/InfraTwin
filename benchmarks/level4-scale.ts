import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import {
  approximateLevel4PathCacheBytes,
  generateCandidatePaths,
  generateCandidatePathsReference,
  optimizeAdaptiveDesign,
  resetLevel4PathCaches,
} from '../packages/optimizer/src/index.ts';
import { createLevel4ReplanReference } from '../packages/scenarios/src/index.ts';
import { generateScaleProject, SCALE_TIERS } from './scale-fixtures.ts';

const BASELINE_MS = { A:4731.222, B:41262.530, C:354586.969 } as const;
type TierId = keyof typeof BASELINE_MS;
type Row = Record<string, unknown>;
const now = () => performance.now();
const round = (value:number, digits=3) => Math.round(value * 10 ** digits) / 10 ** digits;
const timed = async <T>(fn:()=>T|Promise<T>) => { const started=now(); const result=await fn(); return { result, runtimeMs:round(now()-started) }; };

mkdirSync('benchmark-results',{recursive:true});
const generatedAt = new Date().toISOString();
const rows: Row[] = [];

// Small exact differential timing anchors the optimized implementation to the frozen reference implementation.
const referenceProject = createLevel4ReplanReference();
resetLevel4PathCaches();
const referenceSlow = await timed(() => generateCandidatePathsReference(referenceProject,{targetUtilizationPct:80,maxCandidatePaths:5}));
resetLevel4PathCaches();
const referenceFast = await timed(() => generateCandidatePaths(referenceProject,{targetUtilizationPct:80,maxCandidatePaths:5}));
if (referenceFast.result.hash !== referenceSlow.result.hash) throw new Error(`reference path hash mismatch: ${referenceFast.result.hash} != ${referenceSlow.result.hash}`);
rows.push({
  fixture:'lock-replan-reference', operation:'reference-equivalence', beforeMs:referenceSlow.runtimeMs, afterMs:referenceFast.runtimeMs,
  speedup:round(referenceSlow.runtimeMs/Math.max(referenceFast.runtimeMs,0.001),2), pathSetHash:referenceFast.result.hash,
});

for (const tierId of ['A','B','C'] as const) {
  const tier = SCALE_TIERS.find(item => item.id === tierId)!;
  const project = generateScaleProject({
    ...tier,
    seed:4400+tier.nodes,
    routingMode:'single-shortest-path',
    workload:'concentrated-sources',
    sourceConcentration:Math.max(8,Math.ceil(tier.nodes*0.06)),
    serviceClassCount:3,
    upgradeOptionDensity:0.25,
  });
  const heapBefore = process.memoryUsage().heapUsed;
  resetLevel4PathCaches();
  const cold = await timed(() => generateCandidatePaths(project,{targetUtilizationPct:80,maxCandidatePaths:3}));
  const heapAfterCold = process.memoryUsage().heapUsed;
  const diagnostics = cold.result.generationDiagnostics!;
  const warm = await timed(() => generateCandidatePaths(project,{targetUtilizationPct:60,budgetCostUnits:1,maxCandidatePaths:3}));
  const warmDiagnostics = warm.result.generationDiagnostics!;
  const retained = approximateLevel4PathCacheBytes();
  const before = BASELINE_MS[tierId];
  const row: Row = {
    fixture:`tier-${tierId}`,
    operation:'level4b-path-generation',
    counts:{nodes:project.nodes.length,links:project.links.length,demands:project.demands.length,scenarios:1},
    k:3,
    uniqueSourceTargetPairs:diagnostics.uniqueSourceTargetPairs,
    topologyFingerprints:diagnostics.topologyFingerprints,
    totalPaths:cold.result.totalPaths,
    cacheHits:diagnostics.cacheHits,
    cacheMisses:diagnostics.cacheMisses,
    graphCompiles:diagnostics.graphCompiles,
    graphReuses:diagnostics.graphReuses,
    graphCompileMs:round(diagnostics.graphCompileMs),
    firstPathMs:round(diagnostics.firstPathMs),
    yenAlternativeMs:round(diagnostics.yenAlternativeMs),
    diversityMs:round(diagnostics.diversityMs),
    pathSetHashMs:round(diagnostics.pathSetHashMs),
    beforePathGenerationMs:before,
    afterPathGenerationMs:cold.runtimeMs,
    speedup:round(before/Math.max(cold.runtimeMs,0.001),2),
    warmReuseMs:warm.runtimeMs,
    warmCacheHits:warmDiagnostics.cacheHits,
    warmCacheMisses:warmDiagnostics.cacheMisses,
    pathSetHash:cold.result.hash,
    approximateCompiledGraphBytes:diagnostics.approximateGraphBytes,
    approximatePathBytes:diagnostics.approximatePathCacheBytes,
    approximateRetainedCacheBytes:retained,
    observedHeapDeltaBytes:heapAfterCold-heapBefore,
    workerOverheadMs:0,
    execution:'node-synchronous-benchmark; browser application delegates the complete optimizer operation to a Worker',
  };
  if (tierId === 'A') {
    resetLevel4PathCaches();
    const solved = await timed(() => optimizeAdaptiveDesign(project,{targetUtilizationPct:80,maxCandidatePaths:3},{timeLimitMs:4_000}));
    Object.assign(row,{
      adaptiveDesignEndToEndMs:solved.runtimeMs,
      optimizationPathGenerationMs:solved.result.diagnostics.pathGenerationMs,
      optimizationSolveMs:solved.result.diagnostics.solveRuntimeMs,
      optimizationVerificationApproxMs:round(Math.max(0,solved.result.diagnostics.runtimeMs-solved.result.diagnostics.solveRuntimeMs-solved.result.diagnostics.pathGenerationMs)),
      optimizationStatus:solved.result.diagnostics.status,
      optimizationProof:solved.result.diagnostics.proof,
      optimizationVerification:solved.result.variant?.verification.status ?? null,
    });
  }
  rows.push(row);
}

const tierRows = rows.filter((row:any) => row.operation === 'level4b-path-generation') as any[];
const output = {
  context:{
    generatedAt,
    commit:process.env.GITHUB_SHA ?? 'local',
    node:process.version,
    platform:process.platform,
    arch:process.arch,
    cpuModel:os.cpus()[0]?.model ?? 'unknown',
    cpuCount:os.cpus().length,
    benchmarkKind:'level4b-high-scale-adaptive-design',
    semanticWorkload:'identical to Level 4A benchmark: K=3, same seeds/tier fixtures/workload',
  },
  baselines:BASELINE_MS,
  rows,
};
writeFileSync('benchmark-results/level4-scale.json',`${JSON.stringify(output,null,2)}\n`,'utf8');
const md = [
  '# InfraTwin Level 4B high-scale design benchmark','',
  `Generated: ${generatedAt}`,'',
  'The Tier A/B/C rows use the same deterministic fixtures, seeds, demand counts, and K=3 semantics as the frozen Level 4A benchmark.','',
  '| Fixture | Nodes | Links | Demands | Unique pairs | Before path-gen | After path-gen | Speedup | Warm reuse | Cache misses | Approx retained cache |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...tierRows.map(row => `| ${row.fixture} | ${row.counts.nodes} | ${row.counts.links} | ${row.counts.demands} | ${row.uniqueSourceTargetPairs} | ${round(row.beforePathGenerationMs,1)} ms | ${round(row.afterPathGenerationMs,1)} ms | ${row.speedup}× | ${round(row.warmReuseMs,1)} ms | ${row.cacheMisses} | ${round(row.approximateRetainedCacheBytes/1024/1024,2)} MiB |`),
  '',
  '## Kernel breakdown','',
  '| Fixture | Graph compile | First paths | Yen alternatives | Diversity | Path-set hash | Cache hits/misses |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...tierRows.map(row => `| ${row.fixture} | ${row.graphCompileMs} ms | ${row.firstPathMs} ms | ${row.yenAlternativeMs} ms | ${row.diversityMs} ms | ${row.pathSetHashMs} ms | ${row.cacheHits}/${row.cacheMisses} |`),
  '',
  'Warm reuse changes only utilization/budget and therefore must have zero route-cache misses. The benchmark throws if the small frozen-reference path-set hash differs; the full randomized differential suite is in tests/level4b-path-engine.test.ts.',
].join('\n');
writeFileSync('benchmark-results/level4-scale.md',`${md}\n`,'utf8');
console.log(md);

for (const row of tierRows) {
  if (row.warmCacheMisses !== 0) throw new Error(`${row.fixture}: semantic warm reuse unexpectedly had ${row.warmCacheMisses} cache miss(es)`);
}
