import test from 'node:test';
import assert from 'node:assert/strict';
import type { NetworkProject } from '../packages/model/src/index.ts';
import { cloneProject, modelHash, validateNetworkProject } from '../packages/model/src/index.ts';
import { routeProject } from '../packages/graph-engine/src/index.ts';
import { runCapacityAnalysis } from '../packages/evidence/src/index.ts';
import { loadMaintenanceTrap } from '../packages/scenarios/src/index.ts';
import { inspectNetwork, registerInspectNetworkTool, type ModelContextLike } from '../packages/webmcp/src/index.ts';

function lineProject(bandwidthGbps: number): NetworkProject {
  return {
    schemaVersion: '0.1', id: `line-${bandwidthGbps}`, name: 'Line reference',
    nodes: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }],
    links: [
      { id: 'AB', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: true },
      { id: 'BC', source: 'B', target: 'C', capacityGbps: 10, weight: 1, bidirectional: true },
    ],
    demands: [{ id: 'D', source: 'A', target: 'C', bandwidthGbps, serviceClassId: 'best-effort' }],
    serviceClasses: [{ id: 'best-effort', name: 'Best effort', priority: 0, maxUtilizationPct: 100 }],
    routingProfile: { mode: 'single-shortest-path' },
  };
}

test('canonical model validates and JSON round-trips without semantic loss', () => {
  const project = loadMaintenanceTrap();
  assert.equal(validateNetworkProject(project).valid, true);
  const roundTripped = JSON.parse(JSON.stringify(project)) as NetworkProject;
  assert.deepEqual(roundTripped, project);
  assert.equal(modelHash(roundTripped), modelHash(project));
});

test('Reference A: line network demand 8 routes over both links at 80%', () => {
  const analysis = runCapacityAnalysis(lineProject(8));
  assert.equal(analysis.result.verdict, 'PASS');
  assert.equal(analysis.routing.linkUtilizationPct.AB, 80);
  assert.equal(analysis.routing.linkUtilizationPct.BC, 80);
  assert.deepEqual(analysis.routing.routes[0].linkIds, ['AB', 'BC']);
});

test('Reference B: line network demand 12 overloads both links to 120%', () => {
  const analysis = runCapacityAnalysis(lineProject(12));
  assert.equal(analysis.result.verdict, 'FAIL');
  assert.equal(analysis.routing.linkUtilizationPct.AB, 120);
  assert.equal(analysis.routing.linkUtilizationPct.BC, 120);
  assert.equal(analysis.result.violations.filter((v) => v.type === 'CAPACITY').length, 2);
});

test('Maintenance Trap reroutes deterministically and exposes L3 at 120% when L1 is disabled', () => {
  const project = loadMaintenanceTrap();
  const before = routeProject(project);
  assert.deepEqual(before.routes.find((r) => r.demandId === 'D1')?.linkIds, ['L1', 'L5']);
  assert.equal(runCapacityAnalysis(project).result.verdict, 'PASS');
  const edited = cloneProject(project);
  edited.links.find((link) => link.id === 'L1')!.available = false;
  const after = runCapacityAnalysis(edited);
  assert.deepEqual(after.routing.routes.find((r) => r.demandId === 'D1')?.linkIds, ['L2', 'L3', 'L6']);
  assert.equal(after.routing.linkUtilizationPct.L3, 120);
  assert.equal(after.result.verdict, 'FAIL');
  assert.ok(after.result.violations.some((v) => v.type === 'CAPACITY' && v.linkId === 'L3'));
  assert.notEqual(after.result.modelHash, modelHash(project));
});

test('inspect_network summarizes the actual current project', () => {
  const project = loadMaintenanceTrap();
  project.links.find((link) => link.id === 'L1')!.available = false;
  const summary = inspectNetwork(project);
  assert.deepEqual(summary.disabledLinkIds, ['L1']);
  assert.equal(summary.verdict, 'FAIL');
  assert.equal(summary.peakUtilizationPct, 120);
});

test('inspect_network tool is read-only and reads state at execution time', async () => {
  const project = loadMaintenanceTrap();
  let registered: Parameters<ModelContextLike['registerTool']>[0] | undefined;
  let registrationSignal: AbortSignal | undefined;
  const context: ModelContextLike = { registerTool(tool, options) { registered = tool; registrationSignal = options?.signal; } };
  const cleanup = await registerInspectNetworkTool(context, () => project);
  assert.equal(registered?.name, 'inspect_network');
  assert.equal(registered?.annotations?.readOnlyHint, true);
  project.links.find((link) => link.id === 'L1')!.available = false;
  const result = await registered!.execute({}) as ReturnType<typeof inspectNetwork>;
  assert.deepEqual(result.disabledLinkIds, ['L1']);
  assert.equal(result.peakUtilizationPct, 120);
  assert.equal(registrationSignal?.aborted, false);
  cleanup();
  assert.equal(registrationSignal?.aborted, true);
});
