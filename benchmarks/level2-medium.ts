import type { NetworkProject } from '../packages/model/src/index.ts';
import { runCapacityAnalysis, runLinkContingencies, runLinkContingenciesAsync } from '../packages/evidence/src/index.ts';

function mediumProject(): NetworkProject {
  const nodes = Array.from({ length: 50 }, (_, i) => ({ id: `N${i}`, name: `Node ${i}` }));
  const links: NetworkProject['links'] = [];
  const seen = new Set<string>();
  const add = (a: number, b: number, weight: number) => {
    const lo = Math.min(a, b); const hi = Math.max(a, b); const key = `${lo}-${hi}`;
    if (lo === hi || seen.has(key) || links.length >= 120) return;
    seen.add(key);
    links.push({ id: `L${links.length}`, source: `N${a}`, target: `N${b}`, capacityGbps: 40 + (links.length % 5) * 10, weight, bidirectional: true, available: true });
  };
  for (let i = 0; i < 50; i += 1) add(i, (i + 1) % 50, 1);
  for (let offset = 3; links.length < 120; offset += 2) {
    for (let i = 0; i < 50 && links.length < 120; i += 1) add(i, (i + offset) % 50, 1 + (offset % 5) * 0.2);
  }
  const demands = Array.from({ length: 60 }, (_, i) => ({
    id: `D${i}`, name: `Demand ${i}`, source: `N${i % 50}`, target: `N${(i * 7 + 13) % 50}`,
    bandwidthGbps: 1 + (i % 5), serviceClassId: 'standard',
  })).filter((demand) => demand.source !== demand.target);
  while (demands.length < 60) {
    const i = demands.length;
    demands.push({ id: `D${i}`, name: `Demand ${i}`, source: `N${i % 50}`, target: `N${(i + 17) % 50}`, bandwidthGbps: 2, serviceClassId: 'standard' });
  }
  return {
    schemaVersion: '0.1', id: 'level2-medium-benchmark', name: 'Level 2 Medium Benchmark', nodes, links, demands,
    serviceClasses: [{ id: 'standard', name: 'Standard', priority: 50, maxUtilizationPct: 95 }], routingProfile: { mode: 'ecmp' },
  };
}

const project = mediumProject();
const baseStart = performance.now();
const base = runCapacityAnalysis(project);
const baseMs = performance.now() - baseStart;
const n1Start = performance.now();
const n1 = runLinkContingencies(project);
const n1Ms = performance.now() - n1Start;
const asyncStart = performance.now();
const asyncN1 = await runLinkContingenciesAsync(project, null, { workerCount: 4, timeLimitMs: 120_000 });
const asyncMs = performance.now() - asyncStart;

console.log(JSON.stringify({
  nodeCount: project.nodes.length,
  linkCount: project.links.length,
  demandCount: project.demands.length,
  baseRoutingMs: Math.round(baseMs * 1000) / 1000,
  sequentialN1Ms: Math.round(n1Ms * 1000) / 1000,
  sequentialScenariosPerSec: Math.round((n1.completedScenarios / (n1Ms / 1000)) * 100) / 100,
  fallbackWorkerCount: asyncN1.workerCount,
  fallbackN1Ms: Math.round(asyncMs * 1000) / 1000,
  fallbackScenariosPerSec: Math.round((asyncN1.completedScenarios / (asyncMs / 1000)) * 100) / 100,
  sharedMemory: false,
  routingMode: base.routing.mode,
  deterministicWorstLink: n1.worst?.linkId ?? null,
  sameRanking: JSON.stringify(n1.cases.map((item) => [item.linkId, item.score])) === JSON.stringify(asyncN1.cases.map((item) => [item.linkId, item.score])),
}, null, 2));
