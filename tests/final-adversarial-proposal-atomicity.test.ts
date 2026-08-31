import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptAllCandidateChanges,
  changePlanHash,
  createChangePlan,
  modelHash,
  setCandidateProposals,
  setPlanConstraint,
  type CandidatePlan,
  type ChangePlan,
  type NetworkProject,
} from '../packages/model/src/index.ts';
import { CollaborativeWorkspaceService } from '../packages/application/src/index.ts';

function project(): NetworkProject {
  return {
    schemaVersion: '0.1', id: 'accept-all-atomicity', name: 'Accept all atomicity',
    nodes: ['A', 'B', 'C'].map((id) => ({ id, name: id })),
    links: [
      { id: 'L1', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: true, upgradeOptions: [{ capacityGbps: 20, cost: 1 }] },
      { id: 'L2', source: 'B', target: 'C', capacityGbps: 10, weight: 1, bidirectional: true, upgradeOptions: [{ capacityGbps: 20, cost: 1 }] },
    ],
    demands: [{ id: 'D', source: 'A', target: 'C', bandwidthGbps: 5, serviceClassId: 'gold' }],
    serviceClasses: [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 80, allowShedding: false }],
    routingProfile: { mode: 'single-shortest-path' },
  };
}

function candidate(base: NetworkProject): CandidatePlan {
  return {
    id: 'two-change-candidate', name: 'Upgrade both corridor links', baseModelHash: modelHash(base),
    commands: [
      { id: 'c1', type: 'set_link_capacity', actor: 'agent', args: { linkId: 'L1', capacityGbps: 20 }, createdAt: '2026-08-31T03:00:00.000Z' },
      { id: 'c2', type: 'set_link_capacity', actor: 'agent', args: { linkId: 'L2', capacityGbps: 20 }, createdAt: '2026-08-31T03:00:00.000Z' },
    ],
    objective: { name: 'cost', value: 2, unit: 'cost-units' }, rationaleEvidenceIds: [],
  };
}

function proposed(base: NetworkProject): ChangePlan {
  return setCandidateProposals(base, createChangePlan(base, 'Atomic proposal plan', { id: 'atomic-plan', now: '2026-08-31T03:00:00.000Z' }), candidate(base), '2026-08-31T03:00:01.000Z');
}

test('AV-38/F-013: accept-all applies one multi-change candidate atomically against its original source plan hash', () => {
  const base = project();
  const plan = proposed(base);
  assert.equal(plan.proposals.length, 2);
  assert.equal(new Set(plan.proposals.map((item) => item.sourcePlanHash)).size, 1);
  assert.equal(plan.proposals[0].sourcePlanHash, changePlanHash(plan));

  const accepted = acceptAllCandidateChanges(plan, '2026-08-31T03:00:02.000Z');
  assert.deepEqual(accepted.proposals.map((item) => item.state), ['accepted', 'accepted']);
  assert.deepEqual(accepted.changes.map((item) => item.target.kind === 'link' ? item.target.id : ''), ['L1', 'L2']);
  assert.equal(plan.proposals.every((item) => item.state === 'pending'), true, 'batch acceptance must not mutate the caller on the way through');
  assert.equal(plan.changes.length, 0);
});

test('AV-38/F-013: shared service Accept all publishes both proposal changes, not a partially accepted batch', () => {
  const base = project();
  let plan = proposed(base);
  const service = new CollaborativeWorkspaceService({
    getProject: () => base,
    getPlan: () => plan,
    setPlan: (next) => { plan = next; },
    now: () => '2026-08-31T03:00:02.000Z',
  });

  service.acceptAllProposalChanges('human');
  assert.deepEqual(plan.proposals.map((item) => item.state), ['accepted', 'accepted']);
  assert.equal(plan.changes.length, 2);
  assert.deepEqual(plan.changes.map((item) => item.target.kind === 'link' ? item.target.id : ''), ['L1', 'L2']);
});

test('AV-11/F-013: stale accept-all rejects the entire batch before any proposal is accepted', () => {
  const base = project();
  const original = proposed(base);
  const stale = setPlanConstraint(original, 'targetUtilizationPct', 70, '2026-08-31T03:00:02.000Z');
  assert.throws(() => acceptAllCandidateChanges(stale, '2026-08-31T03:00:03.000Z'), /stale/i);
  assert.equal(stale.proposals.every((item) => item.state === 'pending'), true);
  assert.equal(stale.changes.length, 0);
});
