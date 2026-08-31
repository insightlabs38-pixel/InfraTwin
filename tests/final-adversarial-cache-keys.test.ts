import test from 'node:test';
import assert from 'node:assert/strict';
import type { NetworkProject } from '../packages/model/src/index.ts';
import {
  designTopologyCacheKey,
  generateCandidatePaths,
  resetLevel4PathCaches,
} from '../packages/optimizer/src/index.ts';
import { createLevel4ReplanReference } from '../packages/scenarios/src/index.ts';

const baseOptions = {
  forbiddenRoutingLinkIds: [] as string[],
  forbiddenRoutingNodeIds: [] as string[],
  lockedNodeIds: [] as string[],
  candidateLinkOptions: [],
  includeCandidateLinks: false,
  maxCandidatePaths: 3,
  diversityPenalty: 0.35,
};

test('AV-06: route-cache identity distinguishes exact K and sub-nanoscopic diversity changes', () => {
  const project = createLevel4ReplanReference();

  resetLevel4PathCaches();
  const first = generateCandidatePaths(project, { maxCandidatePaths: 3, diversityPenalty: 0.35 });
  assert.ok((first.generationDiagnostics?.cacheMisses ?? 0) > 0);

  const changedK = generateCandidatePaths(project, { maxCandidatePaths: 4, diversityPenalty: 0.35 });
  assert.ok((changedK.generationDiagnostics?.cacheMisses ?? 0) > 0, 'K is route-selection authority and must not reuse K=3 entries');

  const tinyDiversityChange = generateCandidatePaths(project, { maxCandidatePaths: 3, diversityPenalty: 0.3500000001 });
  assert.ok((tinyDiversityChange.generationDiagnostics?.cacheMisses ?? 0) > 0, 'diversity must not be rounded in cache identity');
});

test('AV-05/AV-06: order-equivalent routing restrictions share cache identity and results', () => {
  const project = createLevel4ReplanReference();
  assert.ok(project.links.length >= 2);
  const forbidden = [project.links[0].id, project.links[1].id];

  resetLevel4PathCaches();
  const first = generateCandidatePaths(project, { maxCandidatePaths: 3, forbiddenRoutingLinkIds: forbidden });
  const second = generateCandidatePaths(project, { maxCandidatePaths: 3, forbiddenRoutingLinkIds: [...forbidden].reverse() });

  assert.deepEqual(second.pathsByScenarioDemand, first.pathsByScenarioDemand);
  assert.equal(second.hash, first.hash);
  assert.equal(second.generationDiagnostics?.cacheMisses, 0, 'set-like restriction ordering must not fragment cache identity');
  assert.ok((second.generationDiagnostics?.cacheHits ?? 0) >= project.demands.length);
});

function delimiterProject(kind: 'left' | 'right'): NetworkProject {
  if (kind === 'left') {
    return {
      schemaVersion: '0.1', id: 'delimiter-left', name: 'Delimiter left',
      nodes: [{ id: 'A|B', name: 'A|B' }, { id: 'C#D', name: 'C#D' }],
      links: [{ id: 'L:1|2', source: 'A|B', target: 'C#D', capacityGbps: 10, weight: 1, bidirectional: false }],
      demands: [{ id: 'D,1', source: 'A|B', target: 'C#D', bandwidthGbps: 1, serviceClassId: 'gold' }],
      serviceClasses: [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 100, allowShedding: false }],
      routingProfile: { mode: 'single-shortest-path' },
    };
  }
  return {
    schemaVersion: '0.1', id: 'delimiter-right', name: 'Delimiter right',
    nodes: [{ id: 'A', name: 'A' }, { id: 'B|C#D', name: 'B|C#D' }],
    links: [{ id: 'L:1', source: 'A', target: 'B|C#D', capacityGbps: 10, weight: 1, bidirectional: false }],
    demands: [{ id: 'D,1', source: 'A', target: 'B|C#D', bandwidthGbps: 1, serviceClassId: 'gold' }],
    serviceClasses: [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 100, allowShedding: false }],
    routingProfile: { mode: 'single-shortest-path' },
  };
}

test('AV-06: delimiter-heavy identifiers cannot alias structural topology cache authority', () => {
  const left = delimiterProject('left');
  const right = delimiterProject('right');
  const leftKey = designTopologyCacheKey(left, baseOptions);
  const rightKey = designTopologyCacheKey(right, baseOptions);
  assert.notEqual(leftKey, rightKey);

  resetLevel4PathCaches();
  const leftPaths = generateCandidatePaths(left, { maxCandidatePaths: 3 });
  const rightPaths = generateCandidatePaths(right, { maxCandidatePaths: 3 });
  assert.ok((leftPaths.generationDiagnostics?.cacheMisses ?? 0) > 0);
  assert.ok((rightPaths.generationDiagnostics?.cacheMisses ?? 0) > 0, 'second structurally distinct project must not hit the first project cache');
  assert.deepEqual(leftPaths.pathsByScenarioDemand['baseline:D,1'][0].nodes, ['A|B', 'C#D']);
  assert.deepEqual(rightPaths.pathsByScenarioDemand['baseline:D,1'][0].nodes, ['A', 'B|C#D']);
});
