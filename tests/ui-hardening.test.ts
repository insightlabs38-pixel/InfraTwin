import assert from 'node:assert/strict';
import test from 'node:test';
import { createChangePlan, formatPlanConstraintValue, modelHash, setPlanConstraint } from '../packages/model/src/index.ts';
import { loadScenario } from '../packages/scenarios/src/index.ts';
import { createPlanBundle, createWorkspaceBundle, hasMeaningfulPlanWork, parsePlanBundle, parseWorkspaceBundle, planMatchesProject, safeFilename } from '../apps/web/lib/workspace-persistence.ts';

test('UI hardening: object-valued plan constraints always produce human-readable history', () => {
  const project = loadScenario('maintenance-trap');
  let plan = createChangePlan(project, 'Readable constraints', { id: 'ui-readable', now: '2026-09-01T00:00:00.000Z' });
  plan = setPlanConstraint(plan, 'allowedMitigationActions', { capacityUpgrades: true, routingChanges: true, newLinks: false }, '2026-09-01T00:00:01.000Z');
  plan = setPlanConstraint(plan, 'candidateLinkOptions', [{ id: 'ALT-1', source: 'A', target: 'C', capacityGbps: 12, weight: 1, cost: 4 }], '2026-09-01T00:00:02.000Z');
  const summaries = plan.history.map((event) => event.summary).join('\n');
  assert.doesNotMatch(summaries, /\[object Object\]/);
  assert.match(summaries, /capacity upgrades, routing changes/);
  assert.match(summaries, /ALT-1 \(A↔C, 12 Gbps, cost 4\)/);
  assert.equal(formatPlanConstraintValue('candidateLinkOptions', []), 'no declared candidate links');
});

test('UI hardening: ChangePlan and workspace exports round-trip without semantic loss', () => {
  const project = loadScenario('growth-wall');
  const original = createChangePlan(project, 'Portable plan', { id: 'portable-plan', now: '2026-09-01T00:00:00.000Z' });
  const plan = setPlanConstraint(original, 'requireN1', true, '2026-09-01T00:00:01.000Z');
  const planBundle = createPlanBundle(project, plan, '2026-09-01T00:00:02.000Z');
  const parsedPlan = parsePlanBundle(JSON.parse(JSON.stringify(planBundle)));
  assert.deepEqual(parsedPlan.plan, JSON.parse(JSON.stringify(plan)));
  assert.equal(parsedPlan.baseModelHash, modelHash(project));
  assert.equal(planMatchesProject(project, parsedPlan.plan), true);

  const workspace = createWorkspaceBundle(project, plan, '2026-09-01T00:00:03.000Z');
  const restored = parseWorkspaceBundle(JSON.parse(JSON.stringify(workspace)));
  assert.deepEqual(restored.project, project);
  assert.deepEqual(restored.plan, JSON.parse(JSON.stringify(plan)));
  assert.equal(restored.savedAt, '2026-09-01T00:00:03.000Z');
});

test('UI hardening: meaningful-work detection protects non-default plan state', () => {
  const project = loadScenario('maintenance-trap');
  const empty = createChangePlan(project, 'Draft', { id: 'draft', now: '2026-09-01T00:00:00.000Z' });
  assert.equal(hasMeaningfulPlanWork(project, empty), false);
  const constrained = setPlanConstraint(empty, 'requireN1', true, '2026-09-01T00:00:01.000Z');
  assert.equal(hasMeaningfulPlanWork(project, constrained), true);
  assert.equal(safeFilename(' Backbone / Change Plan '), 'backbone-change-plan');
});
