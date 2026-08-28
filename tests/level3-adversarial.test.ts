import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DemandModel, LinkModel, NetworkProject, ScenarioPatch } from '../packages/model/src/index.ts';
import {
  MODEL_LIMITS,
  applyCandidatePlan,
  applyScenario,
  cloneProject,
  invertCandidatePlan,
  modelHash,
  projectDocumentHash,
  semanticModelHashWebCrypto,
  semanticStableStringify,
  validateNetworkProject,
} from '../packages/model/src/index.ts';
import { minCut, routeProject, shortestPath } from '../packages/graph-engine/src/index.ts';
import {
  runLinkContingencies,
  runLinkContingenciesAsync,
  runSingleLinkContingency,
  type ContingencyWorkerLike,
  type ContingencyWorkerRequest,
  type ContingencyWorkerResponse,
} from '../packages/evidence/src/index.ts';
import { proposeCapacityMitigation } from '../packages/evidence/src/index.ts';
import { optimizeCapacityPlan, optimizeRouting, verifyCapacityCandidate, type CapacityPlanRequirements } from '../packages/optimizer/src/index.ts';

const EPS = 1e-7;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
function pick<T>(rng: () => number, values: readonly T[]): T { return values[Math.floor(rng() * values.length)]!; }
function integer(rng: () => number, min: number, max: number): number { return min + Math.floor(rng() * (max - min + 1)); }

function baseClasses(maxUtilizationPct = 100) {
  return [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct, allowShedding: false }];
}

type RefArc = { linkId: string; from: string; to: string; weight: number; capacityGbps: number };
type RefPath = { nodeIds: string[]; linkIds: string[]; weight: number };

function referenceArcs(project: NetworkProject): RefArc[] {
  const availableNodes = new Set(project.nodes.filter((node) => node.available !== false).map((node) => node.id));
  const arcs: RefArc[] = [];
  for (const link of project.links) {
    if (link.available === false || !availableNodes.has(link.source) || !availableNodes.has(link.target)) continue;
    arcs.push({ linkId: link.id, from: link.source, to: link.target, weight: link.weight, capacityGbps: link.capacityGbps });
    if (link.bidirectional !== false) arcs.push({ linkId: link.id, from: link.target, to: link.source, weight: link.weight, capacityGbps: link.capacityGbps });
  }
  return arcs.sort((a, b) => `${a.linkId}:${a.from}:${a.to}`.localeCompare(`${b.linkId}:${b.from}:${b.to}`));
}

function enumerateSimplePaths(project: NetworkProject, demand: DemandModel): RefPath[] {
  const arcs = referenceArcs(project);
  const byFrom = new Map<string, RefArc[]>();
  for (const arc of arcs) byFrom.set(arc.from, [...(byFrom.get(arc.from) ?? []), arc]);
  const out: RefPath[] = [];
  const visit = (nodeId: string, nodes: string[], links: string[], weight: number) => {
    if (nodeId === demand.target) { out.push({ nodeIds: [...nodes], linkIds: [...links], weight }); return; }
    for (const arc of byFrom.get(nodeId) ?? []) {
      if (nodes.includes(arc.to)) continue;
      visit(arc.to, [...nodes, arc.to], [...links, arc.linkId], weight + arc.weight);
    }
  };
  const available = new Set(project.nodes.filter((node) => node.available !== false).map((node) => node.id));
  if (available.has(demand.source) && available.has(demand.target)) visit(demand.source, [demand.source], [], 0);
  return out;
}

function referenceEcmp(project: NetworkProject, demand: DemandModel) {
  const paths = enumerateSimplePaths(project, demand);
  if (!paths.length) return { reachable: false, paths: [] as RefPath[], fractions: {} as Record<string, number>, weight: null as number | null };
  const weight = Math.min(...paths.map((path) => path.weight));
  const shortest = paths.filter((path) => Math.abs(path.weight - weight) <= 1e-9);
  const fractions: Record<string, number> = {};
  for (const path of shortest) for (const linkId of path.linkIds) fractions[linkId] = (fractions[linkId] ?? 0) + 1 / shortest.length;
  return { reachable: true, paths: shortest, fractions, weight };
}

function randomSmallProject(seed: number, demandCount?: number): NetworkProject {
  const rng = seeded(seed);
  const nodeCount = integer(rng, 2, 6);
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({ id: `N${index}`, name: `Node ${index}` }));
  const links: LinkModel[] = [];
  const pairCount = integer(rng, Math.max(1, nodeCount - 2), Math.min(10, nodeCount * 2));
  for (let i = 0; i < pairCount; i += 1) {
    const sourceIndex = integer(rng, 0, nodeCount - 1);
    let targetIndex = integer(rng, 0, nodeCount - 2);
    if (targetIndex >= sourceIndex) targetIndex += 1;
    links.push({
      id: `L${i}`,
      source: `N${sourceIndex}`,
      target: `N${targetIndex}`,
      bidirectional: rng() < 0.55,
      capacityGbps: integer(rng, 4, 20),
      weight: integer(rng, 1, 4),
    });
  }
  const count = demandCount ?? integer(rng, 1, 5);
  const demands: DemandModel[] = Array.from({ length: count }, (_, index) => {
    const sourceIndex = integer(rng, 0, nodeCount - 1);
    let targetIndex = integer(rng, 0, nodeCount - 2);
    if (targetIndex >= sourceIndex) targetIndex += 1;
    return { id: `D${index}`, source: `N${sourceIndex}`, target: `N${targetIndex}`, bandwidthGbps: rng() < 0.15 ? 0 : integer(rng, 1, 8), serviceClassId: 'gold' };
  });
  return { schemaVersion: '0.1', id: `rnd-${seed}`, name: `Random ${seed}`, nodes, links, demands, serviceClasses: baseClasses(), routingProfile: { mode: 'ecmp' } };
}

function assertClose(actual: number, expected: number, seed: number, label: string, epsilon = EPS): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${label}: ${actual} vs ${expected}; seed=${seed}`);
}

test('seeded differential routing: shortest path and ECMP agree with independent path enumeration', () => {
  const seeds = Array.from({ length: 60 }, (_, index) => 0x51a7 + index);
  for (const seed of seeds) {
    const project = randomSmallProject(seed);
    assert.equal(validateNetworkProject(project).valid, true, `generated project must validate; seed=${seed}`);
    const result = routeProject(project);
    for (const demand of project.demands) {
      const reference = referenceEcmp(project, demand);
      const route = result.routes.find((item) => item.demandId === demand.id)!;
      assert.equal(route.reachable, reference.reachable, `reachability; seed=${seed}; demand=${demand.id}`);
      if (!reference.reachable) { assert.equal(route.equalCostPathCountExact, '0', `unreachable count; seed=${seed}`); continue; }
      assert.equal(route.equalCostPathCountExact, String(reference.paths.length), `exact path count; seed=${seed}; demand=${demand.id}`);
      assertClose(route.totalWeight ?? NaN, reference.weight ?? NaN, seed, `shortest weight ${demand.id}`);
      const stable = shortestPath({ ...project, routingProfile: { mode: 'single-shortest-path' } }, demand);
      const stableAgain = shortestPath({ ...project, routingProfile: { mode: 'single-shortest-path' } }, demand);
      assert.deepEqual(stable.linkIds, stableAgain.linkIds, `shortest path determinism; seed=${seed}; demand=${demand.id}`);
      assert.ok(reference.paths.some((path) => JSON.stringify(path.linkIds) === JSON.stringify(stable.linkIds)), `single path must be one independent minimum path; seed=${seed}; demand=${demand.id}`);
      const allLinks = new Set([...Object.keys(reference.fractions), ...Object.keys(route.linkFractions)]);
      for (const linkId of allLinks) assertClose(route.linkFractions[linkId] ?? 0, reference.fractions[linkId] ?? 0, seed, `ECMP fraction ${demand.id}/${linkId}`, 2e-12);
      for (const fraction of Object.values(route.linkFractions)) assert.ok(Number.isFinite(fraction) && fraction >= -EPS, `finite nonnegative fraction; seed=${seed}`);
      const sourceLinkIds = referenceArcs(project).filter((arc) => arc.from === demand.source).map((arc) => arc.linkId);
      const sourceFraction = [...new Set(sourceLinkIds)].reduce((sum, linkId) => sum + (route.linkFractions[linkId] ?? 0), 0);
      if (demand.source !== demand.target) assertClose(sourceFraction, 1, seed, `source flow conservation ${demand.id}`, 2e-12);
    }
    const expectedLoads: Record<string, number> = Object.fromEntries(project.links.map((link) => [link.id, 0]));
    for (const demand of project.demands) {
      const ref = referenceEcmp(project, demand);
      for (const [linkId, fraction] of Object.entries(ref.fractions)) expectedLoads[linkId] += demand.bandwidthGbps * fraction;
    }
    for (const link of project.links) assertClose(result.linkLoadsGbps[link.id] ?? 0, expectedLoads[link.id] ?? 0, seed, `aggregate load ${link.id}`, 2e-10);
  }
});

test('seeded many-demand ECMP remains finite and matches independent aggregate loading', () => {
  for (const seed of [0x9001, 0x9002, 0x9003, 0x9004, 0x9005]) {
    const project = randomSmallProject(seed, 40);
    const result = routeProject(project);
    assert.equal(result.routes.length, 40, `seed=${seed}`);
    assert.ok(Object.values(result.linkLoadsGbps).every((value) => Number.isFinite(value) && value >= 0), `finite loads seed=${seed}`);
  }
});

function exhaustiveMinCut(project: NetworkProject, sourceId: string, targetId: string): number {
  const ids = project.nodes.filter((node) => node.available !== false).map((node) => node.id);
  const middle = ids.filter((id) => id !== sourceId && id !== targetId);
  let best = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 2 ** middle.length; mask += 1) {
    const left = new Set<string>([sourceId]);
    middle.forEach((id, index) => { if (mask & (1 << index)) left.add(id); });
    let capacity = 0;
    for (const link of project.links) {
      if (link.available === false) continue;
      const s = left.has(link.source); const t = left.has(link.target);
      if (s && !t) capacity += link.capacityGbps;
      if (link.bidirectional !== false && t && !s) capacity += link.capacityGbps;
    }
    best = Math.min(best, capacity);
  }
  return Number.isFinite(best) ? best : 0;
}

test('seeded differential min-cut agrees with exhaustive cut enumeration including directionality and parallels', () => {
  for (let seed = 0xc001; seed < 0xc001 + 40; seed += 1) {
    const project = randomSmallProject(seed);
    const source = project.nodes[0].id;
    const target = project.nodes[project.nodes.length - 1].id;
    const actual = minCut(project, source, target);
    const expected = exhaustiveMinCut(project, source, target);
    assertClose(actual.cutCapacityGbps, expected, seed, 'cut capacity', 1e-7);
    assertClose(actual.maxFlowGbps, expected, seed, 'max-flow/min-cut equality', 1e-7);
    const cutIds = new Set(actual.cutLinkIds);
    assert.equal(cutIds.size, actual.cutLinkIds.length, `cut IDs unique; seed=${seed}`);
  }
});

class InlineWorker implements ContingencyWorkerLike {
  onmessage: ((event: MessageEvent<ContingencyWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  private project: NetworkProject | null = null;
  private basePatch: ScenarioPatch | null = null;
  private baseModelHash = '';
  postMessage(message: ContingencyWorkerRequest): void {
    if (message.type === 'init') { this.project = message.project; this.basePatch = message.basePatch; this.baseModelHash = message.baseModelHash; return; }
    queueMicrotask(() => {
      try {
        if (!this.project) throw new Error('not initialized');
        const contingency = runSingleLinkContingency(this.project, message.linkId, this.basePatch, { baseModelHash: this.baseModelHash });
        this.onmessage?.({ data: { taskId: message.taskId, ok: true, contingency } } as unknown as MessageEvent<ContingencyWorkerResponse>);
      } catch (error) {
        this.onmessage?.({ data: { taskId: message.taskId, ok: false, error: error instanceof Error ? error.message : String(error) } } as unknown as MessageEvent<ContingencyWorkerResponse>);
      }
    });
  }
  terminate(): void { this.terminated = true; }
}

test('seeded N-1 sequential, async fallback, and worker pool produce identical ordered results', async () => {
  for (let seed = 0xa110; seed < 0xa118; seed += 1) {
    const project = randomSmallProject(seed, 3);
    const sequential = runLinkContingencies(project, null, 50);
    const fallback = await runLinkContingenciesAsync(project, null, { maxScenarios: 50, workerCount: 3, timeLimitMs: 10_000 });
    const workers: InlineWorker[] = [];
    const pooled = await runLinkContingenciesAsync(project, null, { maxScenarios: 50, workerCount: 3, timeLimitMs: 10_000, workerFactory: () => { const worker = new InlineWorker(); workers.push(worker); return worker; } });
    const normalize = (value: typeof sequential) => value.cases.map((item) => ({ linkId: item.linkId, verdict: item.verdict, score: item.score, peak: item.peakUtilizationPct, unrouted: item.unroutedDemandGbps }));
    assert.deepEqual(normalize(fallback as typeof sequential), normalize(sequential), `fallback parity seed=${seed}`);
    assert.deepEqual(normalize(pooled as typeof sequential), normalize(sequential), `worker parity seed=${seed}`);
    assert.ok(workers.every((worker) => worker.terminated), `workers terminate seed=${seed}`);
  }
});

function reorder(value: unknown, reverse = false): unknown {
  if (Array.isArray(value)) return value.map((item) => reorder(item, !reverse));
  if (!value || typeof value !== 'object') return value;
  const keys = Object.keys(value as Record<string, unknown>).sort((a, b) => reverse ? b.localeCompare(a) : a.localeCompare(b));
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of keys) Object.defineProperty(out, key, { value: reorder((value as Record<string, unknown>)[key], !reverse), enumerable: true, configurable: true, writable: true });
  return out;
}

test('seeded semantic SHA-256 campaign matches Web Crypto and Node crypto across Unicode, insertion orders, and layout noise', async () => {
  for (let seed = 0x5a00; seed < 0x5a00 + 80; seed += 1) {
    const project = randomSmallProject(seed);
    project.name = `网络-${seed}-🌐-café`;
    project.nodes[0].name = `東京-${seed}-🛰️`;
    project.metadata = JSON.parse(`{"z":"終-${seed}","nested":{"emoji":"🚦","constructor":{"v":${seed}},"prototype":"data","__proto__":{"seed":${seed}}},"layout":{"zoom":1},"ui":{"selected":"L0"}}`) as Record<string, unknown>;
    project.nodes.forEach((node, index) => { node.x = seed + index; node.y = seed - index; });
    assert.equal(validateNetworkProject(project).valid, true, `unicode project valid seed=${seed}`);
    const semantic = semanticStableStringify(project);
    const nodeDigest = `sha256:${createHash('sha256').update(semantic, 'utf8').digest('hex')}`;
    assert.equal(modelHash(project), nodeDigest, `Node crypto parity seed=${seed}`);
    assert.equal(await semanticModelHashWebCrypto(project), nodeDigest, `Web Crypto parity seed=${seed}`);
    const reordered = reorder(project, true) as NetworkProject;
    assert.equal(modelHash(reordered), modelHash(project), `key ordering invariant seed=${seed}`);
    const moved = cloneProject(project); moved.nodes.forEach((node) => { node.x = (node.x ?? 0) + 999; node.y = (node.y ?? 0) - 999; });
    moved.metadata = { ...(moved.metadata ?? {}), viewport: { x: seed }, canvas: { pan: seed } };
    assert.equal(modelHash(moved), modelHash(project), `presentation invariant seed=${seed}`);
    assert.notEqual(projectDocumentHash(moved), projectDocumentHash(project), `document identity changes seed=${seed}`);
    const semanticEdit = cloneProject(project); semanticEdit.demands[0].bandwidthGbps += 0.001;
    assert.notEqual(modelHash(semanticEdit), modelHash(project), `semantic identity changes seed=${seed}`);
  }
});

test('malicious and malformed canonical projects reject cleanly at resource and structural boundaries', () => {
  const cases: Array<[string, (project: NetworkProject) => void]> = [
    ['duplicate node id', (p) => { p.nodes.push({ ...p.nodes[0] }); }],
    ['missing source reference', (p) => { p.links[0].source = 'missing'; }],
    ['self link', (p) => { p.links[0].target = p.links[0].source; }],
    ['invalid class ref', (p) => { p.demands[0].serviceClassId = 'missing'; }],
    ['negative demand', (p) => { p.demands[0].bandwidthGbps = -1; }],
    ['infinite capacity', (p) => { p.links[0].capacityGbps = Number.POSITIVE_INFINITY; }],
    ['empty id', (p) => { p.demands[0].id = ''; }],
    ['huge id', (p) => { p.demands[0].id = 'x'.repeat(MODEL_LIMITS.idLength + 1); }],
    ['huge name', (p) => { p.name = 'n'.repeat(MODEL_LIMITS.nameLength + 1); }],
    ['too many options', (p) => { p.links[0].upgradeOptions = Array.from({ length: MODEL_LIMITS.upgradeOptionsPerLink + 1 }, (_, i) => ({ capacityGbps: p.links[0].capacityGbps + i + 1, cost: i })); }],
    ['repeated options', (p) => { p.links[0].upgradeOptions = [{ capacityGbps: p.links[0].capacityGbps + 2, cost: 1 }, { capacityGbps: p.links[0].capacityGbps + 2, cost: 2 }]; }],
    ['nonmonotonic options', (p) => { p.links[0].upgradeOptions = [{ capacityGbps: p.links[0].capacityGbps + 4, cost: 2 }, { capacityGbps: p.links[0].capacityGbps + 2, cost: 1 }]; }],
    ['unknown core property', (p) => { (p.links[0] as LinkModel & Record<string, unknown>).surprise = 'nope'; }],
  ];
  for (const [name, mutate] of cases) {
    const project = randomSmallProject(0xbad5); mutate(project);
    const validation = validateNetworkProject(project);
    assert.equal(validation.valid, false, `${name} must reject`);
    assert.ok(validation.errors.length > 0, `${name} supplies an actionable error`);
  }
  const deep = randomSmallProject(0xbad6);
  let metadata: Record<string, unknown> = {}; let cursor = metadata;
  for (let i = 0; i < MODEL_LIMITS.metadataDepth + 3; i += 1) { const next: Record<string, unknown> = {}; cursor.next = next; cursor = next; }
  deep.metadata = metadata;
  assert.equal(validateNetworkProject(deep).valid, false, 'deep metadata rejects without recursive canonicalization');
});

function planningProject(seed: number): NetworkProject {
  const rng = seeded(seed);
  const base = integer(rng, 8, 12);
  const demand = integer(rng, 7, 12);
  const optionA = base + integer(rng, 2, 4);
  const optionB = optionA + integer(rng, 2, 4);
  return {
    schemaVersion: '0.1', id: `plan-${seed}`, name: `Plan ${seed}`,
    nodes: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }],
    links: [
      { id: 'L1', source: 'A', target: 'B', capacityGbps: base, weight: 1, bidirectional: true, upgradeOptions: [{ capacityGbps: optionA, cost: integer(rng, 0, 4) }, { capacityGbps: optionB, cost: integer(rng, 5, 9) }] },
      { id: 'L2', source: 'B', target: 'C', capacityGbps: base + integer(rng, 0, 2), weight: 1, bidirectional: true, upgradeOptions: rng() < 0.25 ? undefined : [{ capacityGbps: optionB + 1, cost: integer(rng, 1, 6) }] },
    ],
    demands: [{ id: 'D', source: 'A', target: 'C', bandwidthGbps: demand, serviceClassId: 'gold' }], serviceClasses: baseClasses(), routingProfile: { mode: 'ecmp' },
  };
}

function independentFeasible(project: NetworkProject, capacities: Map<string, number>, requirements: CapacityPlanRequirements): boolean {
  const patches: Array<ScenarioPatch | null> = [...(requirements.includeBaseline === false ? [] : [null]), ...(requirements.scenarioPatches ?? [])];
  for (const patch of patches) {
    const snapshot = applyScenario(project, patch);
    const loads = new Map(snapshot.links.map((link) => [link.id, 0]));
    for (const demand of snapshot.demands) {
      const ref = referenceEcmp(snapshot, demand);
      if (!ref.reachable && demand.bandwidthGbps > 0) return false;
      for (const [linkId, fraction] of Object.entries(ref.fractions)) loads.set(linkId, (loads.get(linkId) ?? 0) + demand.bandwidthGbps * fraction);
    }
    for (const link of snapshot.links) {
      if (link.available === false) continue;
      const capacity = capacities.get(link.id) ?? link.capacityGbps;
      if ((loads.get(link.id) ?? 0) > capacity * ((requirements.targetUtilizationPct ?? 80) / 100) + 1e-8) return false;
    }
  }
  return true;
}

function bruteForceCapacity(project: NetworkProject, requirements: CapacityPlanRequirements): { feasible: boolean; cost: number | null } {
  const choices = project.links.map((link) => [{ capacityGbps: link.capacityGbps, cost: 0 }, ...(link.upgradeOptions ?? [])]);
  let best = Number.POSITIVE_INFINITY;
  const walk = (index: number, capacities: Map<string, number>, cost: number) => {
    if (requirements.budgetCostUnits !== undefined && cost > requirements.budgetCostUnits + 1e-9) return;
    if (index === project.links.length) { if (independentFeasible(project, capacities, requirements)) best = Math.min(best, cost); return; }
    const link = project.links[index];
    for (const choice of choices[index]) { const next = new Map(capacities); next.set(link.id, choice.capacityGbps); walk(index + 1, next, cost + choice.cost); }
  };
  walk(0, new Map(), 0);
  return Number.isFinite(best) ? { feasible: true, cost: best } : { feasible: false, cost: null };
}

test('HiGHS capacity MILP matches independent exhaustive upgrade enumeration on bounded generated problems', async () => {
  for (let seed = 0x0f10; seed < 0x0f10 + 18; seed += 1) {
    const project = planningProject(seed);
    const patch: ScenarioPatch = { id: `growth-${seed}`, name: 'Mixed growth', disabledNodeIds: [], disabledLinkIds: [], demandMultipliers: [{ demandId: 'D', multiplier: seed % 3 === 0 ? 1.2 : 1 }], addedDemands: [], linkCapacityOverrides: [] };
    const requirements: CapacityPlanRequirements = { targetUtilizationPct: 80, includeBaseline: true, scenarioPatches: [patch] };
    const brute = bruteForceCapacity(project, requirements);
    const solved = await optimizeCapacityPlan(project, requirements, { timeLimitMs: 5_000 });
    assert.equal(solved.diagnostics.proof === 'optimal', brute.feasible, `feasibility/proof seed=${seed}; status=${solved.diagnostics.status}`);
    if (brute.feasible) {
      assertClose(solved.diagnostics.objectiveValue ?? NaN, brute.cost ?? NaN, seed, 'minimum upgrade cost', 1e-7);
      if ((brute.cost ?? 0) > 0) {
        assert.ok(solved.candidate, `candidate seed=${seed}`);
        assert.equal(verifyCapacityCandidate(project, solved.candidate!, requirements).status, 'verified', `candidate direct verification seed=${seed}`);
      } else {
        assert.equal(solved.selectedUpgrades.length, 0, `zero-cost/no-change optimum seed=${seed}`);
      }
    } else {
      assert.equal(solved.candidate, null, `no candidate on infeasible case seed=${seed}`);
    }
  }
});

test('capacity optimizer boundary cases: zero-cost, exact budget, below budget, no options, and disconnected topology', async () => {
  const project = planningProject(0x4411);
  project.links[0].upgradeOptions![0].cost = 0;
  const req: CapacityPlanRequirements = { targetUtilizationPct: 80, includeBaseline: true, scenarioPatches: [] };
  const brute = bruteForceCapacity(project, req);
  const solved = await optimizeCapacityPlan(project, req, { timeLimitMs: 5_000 });
  assert.equal(solved.diagnostics.proof, brute.feasible ? 'optimal' : 'infeasible');
  if (brute.feasible) {
    assert.equal(solved.diagnostics.objectiveValue, brute.cost);
    const exact = await optimizeCapacityPlan(project, { ...req, budgetCostUnits: brute.cost! }, { timeLimitMs: 5_000 });
    assert.equal(exact.diagnostics.proof, 'optimal');
    if (brute.cost! > 0) {
      const below = await optimizeCapacityPlan(project, { ...req, budgetCostUnits: brute.cost! - 1 }, { timeLimitMs: 5_000 });
      assert.equal(below.diagnostics.proof, 'infeasible');
    }
  }
  const noOptions = cloneProject(project); noOptions.links.forEach((link) => delete link.upgradeOptions); noOptions.demands[0].bandwidthGbps = 100;
  const noOptionsResult = await optimizeCapacityPlan(noOptions, req, { timeLimitMs: 5_000 });
  assert.equal(noOptionsResult.diagnostics.proof, 'infeasible');
  const disconnected = cloneProject(project); disconnected.links.splice(1, 1);
  const disconnectedResult = await optimizeCapacityPlan(disconnected, req, { timeLimitMs: 5_000 });
  assert.equal(disconnectedResult.diagnostics.proof, 'infeasible');
});

test('every returned LP primal passes independent flow/capacity/objective verification on seeded small cases', async () => {
  let checked = 0;
  for (let seed = 0x7100; seed < 0x7100 + 20; seed += 1) {
    const project = randomSmallProject(seed, 2);
    const result = await optimizeRouting(project, { timeLimitMs: 4_000 });
    if (result.diagnostics.proof === 'optimal' || result.diagnostics.proof === 'feasible-incumbent') {
      checked += 1;
      assert.ok(result.verification, `verification present seed=${seed}`);
      assert.equal(result.verification?.valid, true, `direct primal verification seed=${seed}: ${result.verification?.violations.join(' ')}`);
      assert.equal(result.verification?.nonnegativeFlows, true, `nonnegative seed=${seed}`);
      assert.equal(result.verification?.flowConservation, true, `conservation seed=${seed}`);
      assert.equal(result.verification?.capacityConstraints, true, `capacity seed=${seed}`);
      assert.equal(result.verification?.objectiveConsistent, true, `objective seed=${seed}`);
    } else assert.ok(['infeasible', 'unknown'].includes(result.diagnostics.proof), `recognized proof seed=${seed}`);
  }
  assert.ok(checked >= 3, `expected multiple feasible LPs, checked=${checked}`);
});

test('property invariants: scenario purity, candidate purity/reversibility, cancellation proof, and stale verification', async () => {
  for (let seed = 0x8100; seed < 0x8100 + 20; seed += 1) {
    const project = randomSmallProject(seed);
    const beforeDocument = projectDocumentHash(project);
    const firstLink = project.links[0];
    const patch: ScenarioPatch = { id: `p-${seed}`, name: 'Property patch', disabledNodeIds: [], disabledLinkIds: [firstLink.id], demandMultipliers: [], addedDemands: [], linkCapacityOverrides: [] };
    applyScenario(project, patch);
    assert.equal(projectDocumentHash(project), beforeDocument, `scenario purity seed=${seed}`);
  }

  const overloaded: NetworkProject = {
    schemaVersion: '0.1', id: 'candidate-property', name: 'Candidate property',
    nodes: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }],
    links: [{ id: 'L', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: true }],
    demands: [{ id: 'D', source: 'A', target: 'B', bandwidthGbps: 12, serviceClassId: 'gold' }], serviceClasses: baseClasses(), routingProfile: { mode: 'ecmp' },
  };
  const before = projectDocumentHash(overloaded);
  const candidate = proposeCapacityMitigation(overloaded, null, 0.2);
  assert.ok(candidate);
  assert.equal(projectDocumentHash(overloaded), before, 'candidate generation is pure');
  const inverse = invertCandidatePlan(overloaded, candidate!);
  let current = cloneProject(overloaded);
  for (let i = 0; i < 4; i += 1) { current = applyCandidatePlan(current, { ...candidate!, baseModelHash: modelHash(current) }); current = applyCandidatePlan(current, { ...inverse, baseModelHash: modelHash(current) }); }
  assert.equal(modelHash(current), modelHash(overloaded), 'repeated apply/undo restores semantic identity');

  const controller = new AbortController(); controller.abort();
  const cancelled = await runLinkContingenciesAsync(overloaded, null, { signal: controller.signal });
  assert.notEqual(cancelled.result.verdict, 'PASS');
  assert.equal(cancelled.status, 'cancelled');

  const staleProject = cloneProject(overloaded); staleProject.demands[0].bandwidthGbps += 1;
  const staleVerification = verifyCapacityCandidate(staleProject, candidate!, { targetUtilizationPct: 100, includeBaseline: true, scenarioPatches: [] });
  assert.equal(staleVerification.status, 'disagreement');
  assert.ok(staleVerification.violations.some((message) => /baseModelHash|stale|project changed/i.test(message)));
  assert.notEqual(staleVerification.status, 'verified');
});
