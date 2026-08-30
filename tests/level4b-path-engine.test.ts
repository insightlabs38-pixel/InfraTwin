import test from 'node:test';
import assert from 'node:assert/strict';
import type { CandidateLinkOption, NetworkProject, ScenarioPatch } from '../packages/model/src/index.ts';
import {
  compileDesignGraph,
  designTopologyFingerprint,
  generateCandidatePaths,
  generateCandidatePathsReference,
  level4PathCachePolicy,
  resetLevel4PathCaches,
} from '../packages/optimizer/src/index.ts';
import { createLevel4NewLinkReference, createLevel4ReplanReference, level4NewLinkCandidate } from '../packages/scenarios/src/index.ts';

const topologyOptions = (extra: Partial<Parameters<typeof compileDesignGraph>[1]> = {}) => ({
  forbiddenRoutingLinkIds: [] as string[],
  forbiddenRoutingNodeIds: [] as string[],
  lockedNodeIds: [] as string[],
  candidateLinkOptions: [] as CandidateLinkOption[],
  includeCandidateLinks: false,
  maxCandidatePaths: 5,
  diversityPenalty: 0.35,
  ...extra,
});

function canonicalPathSet(value: ReturnType<typeof generateCandidatePaths>) {
  return {
    pathsByScenarioDemand: value.pathsByScenarioDemand,
    hash: value.hash,
    totalPaths: value.totalPaths,
    generatedAtModelHash: value.generatedAtModelHash,
    maxCandidatePaths: value.maxCandidatePaths,
  };
}

function trafficPatch(project: NetworkProject, multiplier = 1.2): ScenarioPatch {
  return {
    id: 'traffic-only', name: 'Traffic only', disabledNodeIds: [], disabledLinkIds: [],
    demandMultipliers: project.demands.slice(0, 1).map(demand => ({ demandId: demand.id, multiplier })),
    addedDemands: [], linkCapacityOverrides: [],
  };
}

function topologyPatch(project: NetworkProject): ScenarioPatch {
  return {
    id: 'topology-change', name: 'Topology change', disabledNodeIds: [],
    disabledLinkIds: project.links.slice(0, 1).map(link => link.id), demandMultipliers: [],
    addedDemands: [], linkCapacityOverrides: [],
  };
}

function smallProject(seed: number): NetworkProject {
  const nodes = ['A','B','C','D','E','F'].map(id => ({ id, name: id }));
  const links: NetworkProject['links'] = [];
  let serial = 0;
  const add = (source: string, target: string, weight: number, bidirectional: boolean) => links.push({
    id: `L${seed}-${serial++}`, source, target, capacityGbps: 20, weight, bidirectional,
  });
  // A connected backbone plus deterministic chords. Equal weights intentionally exercise tie-breaking.
  add('A','B',1,true); add('B','C',1,true); add('C','D',1,true); add('D','E',1,true); add('E','F',1,true);
  if (seed & 1) add('A','C',2,false); else add('A','D',3,true);
  if (seed & 2) add('B','E',2,true); else add('C','F',3,false);
  if (seed & 4) add('A','F',5,false); else add('B','D',2,true);
  return {
    schemaVersion:'0.1', id:`random-${seed}`, name:`Random ${seed}`, nodes, links,
    demands:[
      { id:'D1', source:'A', target:'F', bandwidthGbps:4, serviceClassId:'gold' },
      { id:'D2', source:'F', target:'A', bandwidthGbps:3, serviceClassId:'gold' },
      { id:'D3', source:'A', target:'D', bandwidthGbps:2, serviceClassId:'gold' },
    ],
    serviceClasses:[{ id:'gold', name:'Gold', priority:100, maxUtilizationPct:100, allowShedding:false }],
    routingProfile:{ mode:'single-shortest-path' },
  };
}

test('Level 4B compiled graph structure and fingerprint are deterministic and ignore non-routing capacity changes', () => {
  resetLevel4PathCaches();
  const project = createLevel4ReplanReference();
  const opts = topologyOptions();
  const first = compileDesignGraph(project, opts);
  const second = compileDesignGraph(structuredClone(project), opts);
  assert.equal(first, second, 'identical topology should reuse the compiled graph object');
  assert.deepEqual(first.nodeIds, [...first.nodeIds].sort());
  assert.ok(first.edges.every((edge, index) => edge.id === index));
  const capacityOnly = structuredClone(project);
  capacityOnly.links[0].capacityGbps += 999;
  assert.equal(designTopologyFingerprint(project, opts), designTopologyFingerprint(capacityOnly, opts));
  const weightChanged = structuredClone(project);
  weightChanged.links[0].weight += 0.25;
  assert.notEqual(designTopologyFingerprint(project, opts), designTopologyFingerprint(weightChanged, opts));
});

test('Level 4B optimized K paths are exactly equivalent to the frozen Level 4A reference', () => {
  for (const project of [createLevel4ReplanReference(), createLevel4NewLinkReference(), ...Array.from({length:8}, (_, i) => smallProject(i + 1))]) {
    for (const k of [1,2,3,5,8]) {
      for (const extra of [
        {},
        { forbiddenRoutingLinkIds: project.links.length > 2 ? [project.links[1].id] : [] },
        { forbiddenRoutingNodeIds: project.nodes.length > 4 ? [project.nodes[2].id] : [] },
      ]) {
        resetLevel4PathCaches();
        const input = { maxCandidatePaths:k, diversityPenalty:0.35, ...extra };
        const expected = generateCandidatePathsReference(project, input);
        const actual = generateCandidatePaths(project, input);
        assert.deepEqual(canonicalPathSet(actual), canonicalPathSet(expected), `${project.id}, K=${k}, ${JSON.stringify(extra)}`);
      }
    }
  }
});

test('Level 4B candidate links retain exact Level 4A semantics', () => {
  resetLevel4PathCaches();
  const project = createLevel4NewLinkReference();
  const input = {
    maxCandidatePaths: 8,
    candidateLinkOptions: [{ ...level4NewLinkCandidate }],
    allowedActions: { capacityUpgrades:true, routingChanges:true, newLinks:true },
  };
  assert.deepEqual(canonicalPathSet(generateCandidatePaths(project, input)), canonicalPathSet(generateCandidatePathsReference(project, input)));
});

test('Level 4B reuses one semantic route request across duplicate demands', () => {
  resetLevel4PathCaches();
  const project = createLevel4ReplanReference();
  project.demands.push({ ...project.demands[0], id:'duplicate-demand', bandwidthGbps:project.demands[0].bandwidthGbps * 2 });
  const result = generateCandidatePaths(project, { maxCandidatePaths:5 });
  const d = result.generationDiagnostics!;
  assert.equal(d.totalDemands, 2);
  assert.equal(d.uniqueSourceTargetPairs, 1);
  assert.equal(d.cacheMisses, 1);
  assert.equal(d.cacheHits, 1);
  assert.equal(result.totalPaths, 4);
});

test('Level 4B bandwidth, budget, target utilization, and traffic-only scenarios reuse paths', () => {
  resetLevel4PathCaches();
  const project = createLevel4ReplanReference();
  const first = generateCandidatePaths(project, { maxCandidatePaths:5, targetUtilizationPct:80, budgetCostUnits:20 });
  assert.ok((first.generationDiagnostics?.cacheMisses ?? 0) > 0);

  const bandwidthChanged = structuredClone(project);
  bandwidthChanged.demands[0].bandwidthGbps *= 1.5;
  const second = generateCandidatePaths(bandwidthChanged, { maxCandidatePaths:5, targetUtilizationPct:60, budgetCostUnits:7 });
  assert.equal(second.generationDiagnostics?.cacheMisses, 0);
  assert.equal(second.generationDiagnostics?.cacheHits, bandwidthChanged.demands.length);

  resetLevel4PathCaches();
  const scenario = generateCandidatePaths(project, { maxCandidatePaths:5, scenarioPatches:[trafficPatch(project)] });
  assert.equal(scenario.generationDiagnostics?.topologyFingerprints, 1);
  assert.ok((scenario.generationDiagnostics?.cacheHits ?? 0) >= project.demands.length);
});

test('Level 4B topology, routing restriction, and candidate-link changes invalidate semantic path cache entries', () => {
  const project = createLevel4ReplanReference();
  resetLevel4PathCaches();
  generateCandidatePaths(project, { maxCandidatePaths:5 });
  const outage = structuredClone(project);
  outage.links[0].available = false;
  assert.ok((generateCandidatePaths(outage, { maxCandidatePaths:5 }).generationDiagnostics?.cacheMisses ?? 0) > 0);

  resetLevel4PathCaches();
  generateCandidatePaths(project, { maxCandidatePaths:5 });
  assert.ok((generateCandidatePaths(project, { maxCandidatePaths:5, forbiddenRoutingLinkIds:[project.links[0].id] }).generationDiagnostics?.cacheMisses ?? 0) > 0);

  const candidateProject = createLevel4NewLinkReference();
  resetLevel4PathCaches();
  const allowed = { capacityUpgrades:true, routingChanges:true, newLinks:true };
  generateCandidatePaths(candidateProject, { maxCandidatePaths:5, allowedActions:allowed, candidateLinkOptions:[{...level4NewLinkCandidate}] });
  const changed = { ...level4NewLinkCandidate, weight:level4NewLinkCandidate.weight + 1 };
  assert.ok((generateCandidatePaths(candidateProject, { maxCandidatePaths:5, allowedActions:allowed, candidateLinkOptions:[changed] }).generationDiagnostics?.cacheMisses ?? 0) > 0);
});

test('Level 4B distinct topology scenarios never share a topology fingerprint', () => {
  resetLevel4PathCaches();
  const project = createLevel4ReplanReference();
  const result = generateCandidatePaths(project, { maxCandidatePaths:5, scenarioPatches:[topologyPatch(project)] });
  assert.equal(result.generationDiagnostics?.topologyFingerprints, 2);
  assert.ok((result.generationDiagnostics?.cacheMisses ?? 0) >= 2);
});

test('Level 4B cancellation prevents an aborted path set from publishing', () => {
  resetLevel4PathCaches();
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => generateCandidatePaths(smallProject(7), { maxCandidatePaths:8 }, { signal:controller.signal }), (error: unknown) => error instanceof Error && error.name === 'AbortError');
});

test('Level 4B caches are bounded and evict historical topology state', () => {
  resetLevel4PathCaches();
  for (let i = 0; i < 40; i += 1) {
    const project = smallProject((i % 8) + 1);
    project.links[0].weight = 1 + i / 1000;
    compileDesignGraph(project, topologyOptions());
  }
  const policy = level4PathCachePolicy();
  assert.ok(policy.graphEntries <= policy.maxGraphEntries);
  assert.equal(policy.maxGraphEntries, 32);
  assert.equal(policy.maxRouteEntries, 4096);
});
