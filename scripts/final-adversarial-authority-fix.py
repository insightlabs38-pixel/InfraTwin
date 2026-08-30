from pathlib import Path

# F-003: proposal acceptance must be bound to the current base project, not only the current plan hash.
p = Path('packages/application/src/index.ts')
s = p.read_text()
old = """  acceptProposalChange(id:string,actor:PlanActor='human'){const next=retag(acceptCandidateChange(this.a.getPlan(),id,this.now()),actor,'accepted_proposal');this.publishPlan(next);this.activity(actor,'accepted_proposal',`Accepted proposal ${id}`,id);return next;}
  acceptAllProposalChanges(actor:PlanActor='human'){let next=this.a.getPlan();const ids=next.proposals.filter(x=>x.state==='pending').map(x=>x.id);for(const id of ids)next=retag(acceptCandidateChange(next,id,this.now()),actor,'accepted_proposal');this.publishPlan(next);this.activity(actor,'accepted_all_proposals','Accepted all current proposal changes');return next;}
"""
new = """  acceptProposalChange(id:string,actor:PlanActor='human'){const project=this.a.getProject(),plan=this.a.getPlan();if(plan.baseModelHash!==modelHash(project))throw new Error('Optimizer proposal is stale because the base network changed. Re-run candidate generation.');const next=retag(acceptCandidateChange(plan,id,this.now()),actor,'accepted_proposal');this.publishPlan(next);this.activity(actor,'accepted_proposal',`Accepted proposal ${id}`,id);return next;}
  acceptAllProposalChanges(actor:PlanActor='human'){const project=this.a.getProject();let next=this.a.getPlan();if(next.baseModelHash!==modelHash(project))throw new Error('Optimizer proposal is stale because the base network changed. Re-run candidate generation.');const ids=next.proposals.filter(x=>x.state==='pending').map(x=>x.id);for(const id of ids)next=retag(acceptCandidateChange(next,id,this.now()),actor,'accepted_proposal');this.publishPlan(next);this.activity(actor,'accepted_all_proposals','Accepted all current proposal changes');return next;}
"""
if old not in s:
    raise SystemExit('proposal acceptance target not found')
p.write_text(s.replace(old, new))

p = Path('tests/final-adversarial.test.ts')
s = p.read_text()
old_import = "import type { NetworkProject } from '../packages/model/src/index.ts';"
new_import = """import {
  createChangePlan,
  modelHash,
  setCandidateProposals,
  type CandidatePlan,
  type ChangePlan,
  type NetworkProject,
} from '../packages/model/src/index.ts';
import { CollaborativeWorkspaceService } from '../packages/application/src/index.ts';"""
if old_import in s:
    s = s.replace(old_import, new_import)
marker = "test('AV-11/F-003: proposal acceptance rejects a candidate after the base network changes'"
if marker not in s:
    s += r'''

test('AV-11/F-003: proposal acceptance rejects a candidate after the base network changes', () => {
  let project = collisionProject('proposal-authority', [
    { id: 'L1', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: false },
    { id: 'L2', source: 'B', target: 'C', capacityGbps: 10, weight: 1, bidirectional: false },
  ]);
  let plan: ChangePlan = createChangePlan(project, 'Authority test', { id: 'authority-plan', now: '2026-08-30T22:00:00.000Z' });
  const candidate: CandidatePlan = {
    id: 'authority-candidate',
    name: 'Upgrade L1',
    baseModelHash: modelHash(project),
    commands: [{ id: 'upgrade-l1', type: 'set_link_capacity', actor: 'agent', args: { linkId: 'L1', capacityGbps: 20 }, createdAt: '2026-08-30T22:00:01.000Z' }],
    objective: { name: 'cost', value: 1, unit: 'cost-units' },
    rationaleEvidenceIds: [],
  };
  plan = setCandidateProposals(project, plan, candidate, '2026-08-30T22:00:02.000Z');
  const proposalId = plan.proposals[0].id;
  const service = new CollaborativeWorkspaceService({
    getProject: () => project,
    getPlan: () => plan,
    setPlan: (next) => { plan = next; },
  });

  // Simulate a project replacement/revision racing with stale proposal UI state. The old service path
  // checked only sourcePlanHash and would accept this proposal against the wrong base network.
  project = structuredClone(project);
  project.links[0].weight = 2;
  assert.notEqual(plan.baseModelHash, modelHash(project));
  assert.throws(() => service.acceptProposalChange(proposalId, 'agent'), /stale.*base network changed/i);
  assert.equal(plan.proposals[0].state, 'pending');
  assert.equal(plan.changes.length, 0);
  assert.throws(() => service.acceptAllProposalChanges('agent'), /stale.*base network changed/i);
  assert.equal(plan.proposals[0].state, 'pending');
});
'''
p.write_text(s)
