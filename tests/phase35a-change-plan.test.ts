import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptCandidateChange,
  addPlanChange,
  applyChangePlan,
  changePlanEvidenceStamp,
  changePlanHash,
  changePlanRevisionStamp,
  compileChangePlanToScenarioPatch,
  createChangePlan,
  isPlanEvidenceFresh,
  isPlanRevisionFresh,
  modelHash,
  rejectCandidateChange,
  setCandidateProposals,
  setChangePlanStatus,
  setPlanConstraint,
  setPlanLinkLocked,
  type CandidatePlan,
  type NetworkProject,
  type PlanChange,
} from '../packages/model/src/index.ts';
import { analyzeChangePlan, proposeCapacityMitigation, runScenarioCapacityAnalysis } from '../packages/evidence/src/index.ts';
import { buildCapacityUpgradeMILP, verifyCapacityCandidate } from '../packages/optimizer/src/index.ts';
import { getScenarioDefinition } from '../packages/scenarios/src/index.ts';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T00:01:00.000Z';
const T2 = '2026-01-01T00:02:00.000Z';

function change<T extends PlanChange>(value: T): T { return value; }

function newPlan(project: NetworkProject, name = 'Operator plan') {
  return createChangePlan(project, name, { id: `plan-${project.id}`, now: T0 });
}

test('Phase 3.5A A: ChangePlan authoring is non-destructive to the canonical NetworkProject', () => {
  const { project } = getScenarioDefinition('maintenance-trap');
  const before = modelHash(project);
  let plan = newPlan(project);
  plan = addPlanChange(plan, change({ id: 'outage-l1', actor: 'human', type: 'disable_link', target: { kind: 'link', id: 'L1' }, payload: {}, createdAt: T1 }));
  plan = setPlanConstraint(plan, 'targetUtilizationPct', 75, T2);
  plan = setPlanLinkLocked(plan, 'L3', true, T2);
  assert.equal(modelHash(project), before);
  assert.equal(project.links.find((link) => link.id === 'L1')?.available, true);
  assert.equal(plan.baseModelHash, before);
});

test('Phase 3.5A B: same semantic plan compiles deterministically regardless of history/timestamps', () => {
  const { project } = getScenarioDefinition('maintenance-trap');
  let a = newPlan(project, 'A');
  a = addPlanChange(a, change({ id: 'x', actor: 'human', type: 'disable_link', target: { kind: 'link', id: 'L1' }, payload: {}, createdAt: T1 }));
  const b = { ...a, name: 'B', createdAt: T2, updatedAt: T2, history: [], status: 'verified' as const };
  assert.equal(changePlanHash(a), changePlanHash(b));
  assert.deepEqual(compileChangePlanToScenarioPatch(project, a), { ...compileChangePlanToScenarioPatch(project, b), name: 'A' });
  assert.equal(modelHash(applyChangePlan(project, a)), modelHash(applyChangePlan(project, b)));
});

test('Phase 3.5A C: semantic plan change invalidates prior analysis and revision verification', () => {
  const { project } = getScenarioDefinition('maintenance-trap');
  let plan = newPlan(project);
  const analysis = analyzeChangePlan(project, plan);
  plan = setChangePlanStatus(plan, 'verified', 'Verified prior plan', T1);
  const revision = changePlanRevisionStamp(project, plan);
  plan = addPlanChange(plan, change({ id: 'outage', actor: 'human', type: 'disable_link', target: { kind: 'link', id: 'L1' }, payload: {}, createdAt: T2 }));
  assert.equal(isPlanEvidenceFresh(analysis.stamp, project, plan), false);
  assert.equal(isPlanRevisionFresh(revision, project, plan), false);
  assert.equal(plan.status, 'draft');
  assert.ok(plan.history.some((item) => item.actor === 'system' && item.action === 'verification_invalidated'));
});

test('Phase 3.5A D: topology layout movement does not invalidate semantic plan evidence', () => {
  const { project } = getScenarioDefinition('maintenance-trap');
  const plan = newPlan(project);
  const stamp = changePlanEvidenceStamp(project, plan);
  const moved = structuredClone(project);
  moved.nodes[0].x = (moved.nodes[0].x ?? 0) + 73;
  moved.nodes[0].y = (moved.nodes[0].y ?? 0) - 11;
  assert.equal(modelHash(moved), modelHash(project));
  assert.equal(isPlanEvidenceFresh(stamp, moved, plan), true);
});

test('Phase 3.5A E: manual L1 outage is semantically equivalent to Maintenance Trap template patch', () => {
  const definition = getScenarioDefinition('maintenance-trap');
  let plan = newPlan(definition.project);
  plan = addPlanChange(plan, change({ id: 'manual-l1', actor: 'human', type: 'disable_link', target: { kind: 'link', id: 'L1' }, payload: {}, createdAt: T1 }));
  const manual = applyChangePlan(definition.project, plan);
  const legacy = runScenarioCapacityAnalysis(definition.project, definition.recommendedPatch!).snapshot;
  assert.equal(modelHash(manual), modelHash(legacy));
  assert.equal(runScenarioCapacityAnalysis(definition.project, compileChangePlanToScenarioPatch(definition.project, plan)).result.verdict, 'FAIL');
});

test('Phase 3.5A F: generic +40% selected-demand growth reproduces Growth Wall failure', () => {
  const definition = getScenarioDefinition('growth-wall');
  let plan = newPlan(definition.project);
  plan = addPlanChange(plan, change({ id: 'growth', actor: 'human', type: 'demand_growth', target: { kind: 'demands', ids: ['GD1', 'GD2'] }, payload: { multiplier: 1.4 }, createdAt: T1 }));
  const analysis = analyzeChangePlan(definition.project, plan);
  assert.equal(analysis.verdict, 'FAIL');
  assert.ok(Math.abs(analysis.capacity.routing.linkUtilizationPct.G2 - 84) < 1e-8);
  assert.equal(modelHash(definition.project), plan.baseModelHash);
});

test('Phase 3.5A G: added demand exists only in the effective planned snapshot', () => {
  const definition = getScenarioDefinition('growth-wall');
  let plan = newPlan(definition.project);
  plan = addPlanChange(plan, change({
    id: 'new-service', actor: 'human', type: 'add_demand', target: { kind: 'demand', id: 'PAYMENTS' }, createdAt: T1,
    payload: { demand: { id: 'PAYMENTS', name: 'Payments replication', source: 'NYC', target: 'SEA', bandwidthGbps: 12, serviceClassId: 'gold' } },
  }));
  const effective = applyChangePlan(definition.project, plan);
  assert.equal(definition.project.demands.some((demand) => demand.id === 'PAYMENTS'), false);
  assert.equal(effective.demands.find((demand) => demand.id === 'PAYMENTS')?.bandwidthGbps, 12);
  assert.equal(modelHash(definition.project), plan.baseModelHash);
});

test('Phase 3.5A H: locked link is omitted from optimizer variables and deterministic mitigation', () => {
  const definition = getScenarioDefinition('growth-wall');
  const plan = definition.changePlanTemplate!;
  const patch = compileChangePlanToScenarioPatch(definition.project, plan);
  const built = buildCapacityUpgradeMILP(definition.project, { targetUtilizationPct: 80, includeBaseline: true, scenarioPatches: [patch], lockedLinkIds: ['G2'] });
  assert.equal(built.variables.some((item) => item.linkId === 'G2'), false);
  assert.match(built.preflightError ?? '', /G2.*locked/i);
  assert.equal(proposeCapacityMitigation(definition.project, patch, 20, ['G2']), null);
});

test('Phase 3.5A I: locking all feasible capacity repair paths reports infeasible/no-plan truth', () => {
  const definition = getScenarioDefinition('resilience-gap');
  const patch = compileChangePlanToScenarioPatch(definition.project, definition.changePlanTemplate!);
  const built = buildCapacityUpgradeMILP(definition.project, { targetUtilizationPct: 80, includeBaseline: true, scenarioPatches: [patch], lockedLinkIds: ['R4', 'R5'] });
  assert.equal(built.preflightError !== null, true);
  assert.match(built.preflightError ?? '', /locked/i);
});

test('Phase 3.5A J/L: accept A + reject B keeps only A, preserves agent authorship, and invalidates candidate revision', () => {
  const definition = getScenarioDefinition('resilience-gap');
  let plan = newPlan(definition.project);
  const candidate: CandidatePlan = {
    id: 'candidate-two', name: 'Two-link mitigation', baseModelHash: modelHash(definition.project),
    commands: [
      { id: 'a', type: 'set_link_capacity', actor: 'agent', args: { linkId: 'R4', capacityGbps: 14 }, createdAt: T1 },
      { id: 'b', type: 'set_link_capacity', actor: 'agent', args: { linkId: 'R5', capacityGbps: 14 }, createdAt: T1 },
    ],
    objective: { name: 'minimumUpgradeCost', value: 8, unit: 'cost-units' }, rationaleEvidenceIds: ['v1'],
  };
  plan = setCandidateProposals(definition.project, plan, candidate, T1);
  const revision = changePlanRevisionStamp(definition.project, plan);
  const [first, second] = plan.proposals;
  plan = acceptCandidateChange(plan, first.id, T2);
  plan = rejectCandidateChange(plan, second.id, T2);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].target.kind, 'link');
  assert.equal(plan.changes[0].actor, 'agent');
  assert.equal(plan.proposals.find((item) => item.id === first.id)?.state, 'accepted');
  assert.equal(plan.proposals.find((item) => item.id === second.id)?.state, 'rejected');
  assert.equal(isPlanRevisionFresh(revision, definition.project, plan), false);
});

test('Phase 3.5A K: history contains only meaningful semantic human/agent/system actions with deterministic ordering', () => {
  const definition = getScenarioDefinition('maintenance-trap');
  let plan = newPlan(definition.project, 'Maintenance window');
  plan = addPlanChange(plan, change({ id: 'outage', actor: 'human', type: 'disable_link', target: { kind: 'link', id: 'L1' }, payload: {}, createdAt: T1 }));
  plan = setChangePlanStatus(plan, 'analyzed', 'Plan analyzed: FAIL', T2);
  plan = setPlanLinkLocked(plan, 'L3', true, '2026-01-01T00:03:00.000Z');
  assert.deepEqual(plan.history.map((item) => item.actor), ['human', 'human', 'system', 'human', 'system']);
  assert.deepEqual(plan.history.map((item) => item.id), ['history-1', 'history-2', 'history-3', 'history-4', 'history-5']);
  assert.equal(plan.history.some((item) => /hover|click/i.test(item.action)), false);
});

test('Phase 3.5A template plans reproduce legacy demo semantics without hidden product logic', () => {
  const maintenance = getScenarioDefinition('maintenance-trap');
  const growth = getScenarioDefinition('growth-wall');
  const resilience = getScenarioDefinition('resilience-gap');
  assert.equal(modelHash(applyChangePlan(maintenance.project, maintenance.changePlanTemplate!)), modelHash(runScenarioCapacityAnalysis(maintenance.project, maintenance.recommendedPatch!).snapshot));
  assert.ok(Math.abs(analyzeChangePlan(growth.project, growth.changePlanTemplate!).capacity.routing.linkUtilizationPct.G2 - 84) < 1e-8);
  assert.deepEqual(compileChangePlanToScenarioPatch(resilience.project, resilience.changePlanTemplate!).disabledLinkIds, ['R2']);
});

test('Phase 3.5A verifier rejects a candidate that changes a locked link', () => {
  const definition = getScenarioDefinition('growth-wall');
  const candidate: CandidatePlan = {
    id: 'locked-candidate', name: 'Locked', baseModelHash: modelHash(definition.project),
    commands: [{ id: 'x', type: 'set_link_capacity', actor: 'agent', args: { linkId: 'G2', capacityGbps: 22 }, createdAt: T1 }],
    objective: { name: 'minimumUpgradeCost', value: 6, unit: 'cost-units' }, rationaleEvidenceIds: [],
  };
  const verification = verifyCapacityCandidate(definition.project, candidate, { targetUtilizationPct: 80, includeBaseline: true, lockedLinkIds: ['G2'] });
  assert.equal(verification.status, 'disagreement');
  assert.ok(verification.violations.some((message) => /locked link G2/i.test(message)));
});


test('Phase 3.5A accepted capacity proposal yields a valid derived snapshot and preserves the base project', () => {
  const definition = getScenarioDefinition('resilience-gap');
  const baseR4 = definition.project.links.find((link) => link.id === 'R4')!;
  const baseOptions = baseR4.upgradeOptions?.map((option) => ({ ...option }));
  let plan = newPlan(definition.project);
  const candidate: CandidatePlan = {
    id: 'candidate-r4-upgrade', name: 'Upgrade R4', baseModelHash: modelHash(definition.project),
    commands: [{ id: 'r4-upgrade', type: 'set_link_capacity', actor: 'agent', args: { linkId: 'R4', capacityGbps: 14 }, createdAt: T1 }],
    objective: { name: 'minimumUpgradeCost', value: 4, unit: 'cost-units' }, rationaleEvidenceIds: ['v-r4'],
  };
  plan = setCandidateProposals(definition.project, plan, candidate, T1);
  plan = acceptCandidateChange(plan, plan.proposals[0].id, T2);
  const snapshot = applyChangePlan(definition.project, plan);
  const plannedR4 = snapshot.links.find((link) => link.id === 'R4')!;
  assert.equal(plannedR4.capacityGbps, 14);
  assert.deepEqual(plannedR4.upgradeOptions, [{ capacityGbps: 18, cost: 7 }]);
  assert.equal(baseR4.capacityGbps, 10);
  assert.deepEqual(baseR4.upgradeOptions, baseOptions);
});


test('Phase 3.5A regenerated candidate proposals keep unique plan identities', () => {
  const definition = getScenarioDefinition('growth-wall');
  let plan = newPlan(definition.project);
  const candidate: CandidatePlan = {
    id: 'repeatable-candidate', name: 'Repeatable proposal', baseModelHash: modelHash(definition.project),
    commands: [{ id: 'repeatable-command', type: 'set_link_capacity', actor: 'agent', args: { linkId: 'G2', capacityGbps: 22 }, createdAt: T1 }],
    objective: { name: 'minimumUpgradeCost', value: 6, unit: 'cost-units' }, rationaleEvidenceIds: ['v-g2'],
  };
  plan = setCandidateProposals(definition.project, plan, candidate, T1);
  const firstId = plan.proposals[0].id;
  plan = rejectCandidateChange(plan, firstId, T2);
  plan = setCandidateProposals(definition.project, plan, candidate, T2);
  const ids = plan.proposals.map((proposal) => proposal.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(plan.proposals.at(-1)?.id, firstId);
});
