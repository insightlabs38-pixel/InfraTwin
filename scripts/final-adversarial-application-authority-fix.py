from pathlib import Path

# Temporary focused patcher for F-005/F-006/F-007. Remove before final freeze.
p = Path('packages/application/src/index.ts')
s = p.read_text()

old = """  private proposal(){ const p=this.a.getPlan(), hash=changePlanHash(p), proposals=p.proposals.filter(x=>x.state==='pending'); return {candidate:this.a.getCandidate?.()??null,proposals:clone(proposals),stale:proposals.some(x=>x.sourcePlanHash!==hash)}; }
"""
new = """  private proposal(){ const project=this.a.getProject(),p=this.a.getPlan(),hash=changePlanHash(p),baseStale=p.baseModelHash!==modelHash(project),proposals=p.proposals.filter(x=>x.state==='pending'); return {candidate:this.a.getCandidate?.()??null,proposals:clone(proposals),stale:baseStale||proposals.some(x=>x.sourcePlanHash!==hash)}; }
"""
if old not in s:
    raise SystemExit('proposal helper anchor not found')
s = s.replace(old, new, 1)

old = "proposals:proposals.map(q=>({id:q.id,summary:describePlanChange(q.change),stale:q.sourcePlanHash!==changePlanHash(plan)}))"
new = "proposals:proposals.map(q=>({id:q.id,summary:describePlanChange(q.change),stale:plan.baseModelHash!==modelHash(p)||q.sourcePlanHash!==changePlanHash(plan)}))"
if old not in s:
    raise SystemExit('selection proposal stale anchor not found')
s = s.replace(old, new, 1)

old = "  inspectPlan(){const p=this.a.getPlan(),h=changePlanHash(p);return{id:p.id,name:p.name,status:p.status,hash:h,changeCount:p.changes.length,changes:p.changes.slice(0,100).map(c=>({id:c.id,actor:c.actor,type:c.type,summary:describePlanChange(c)})),constraints:clone(p.constraints),restrictions:clone(p.restrictions),proposalCount:p.proposals.length,proposals:p.proposals.slice(0,100).map(q=>({id:q.id,candidateId:q.candidateId,sourcePlanHash:q.sourcePlanHash,state:q.state,stale:q.sourcePlanHash!==h,type:q.change.type,target:clone(q.change.target),summary:describePlanChange(q.change)}))};}"
new = "  inspectPlan(){const project=this.a.getProject(),p=this.a.getPlan(),h=changePlanHash(p),baseStale=p.baseModelHash!==modelHash(project);return{id:p.id,name:p.name,status:p.status,hash:h,changeCount:p.changes.length,changes:p.changes.slice(0,100).map(c=>({id:c.id,actor:c.actor,type:c.type,summary:describePlanChange(c)})),constraints:clone(p.constraints),restrictions:clone(p.restrictions),proposalCount:p.proposals.length,proposals:p.proposals.slice(0,100).map(q=>({id:q.id,candidateId:q.candidateId,sourcePlanHash:q.sourcePlanHash,state:q.state,stale:baseStale||q.sourcePlanHash!==h,type:q.change.type,target:clone(q.change.target),summary:describePlanChange(q.change)}))};}"
if old not in s:
    raise SystemExit('inspectPlan anchor not found')
s = s.replace(old, new, 1)

old = "  setRoutingRestriction(kind:'link'|'node',id:string,forbidden:boolean,actor:PlanActor='human'){const p=this.a.getProject();if(kind==='link'&&!p.links.some(x=>x.id===id))throw new Error(`Unknown link ${id}`);if(kind==='node'&&!p.nodes.some(x=>x.id===id))throw new Error(`Unknown node ${id}`);const raw=kind==='link'?setPlanLinkRoutingForbidden(this.a.getPlan(),id,forbidden,this.now()):setPlanNodeRoutingForbidden(this.a.getPlan(),id,forbidden,this.now());const next=retag(raw,actor,'set_routing_restriction');this.publishPlan(next);this.activity(actor,'set_routing_restriction',`${forbidden?'Avoid':'Allow'} ${id} in proposed routing`,id);return next;}"
new = "  setRoutingRestriction(kind:'link'|'node',id:string,forbidden:boolean,actor:PlanActor='human'){const p=this.a.getProject();if(kind==='link'&&!p.links.some(x=>x.id===id))throw new Error(`Unknown link ${id}`);if(kind==='node'&&!p.nodes.some(x=>x.id===id))throw new Error(`Unknown node ${id}`);if(actor==='agent'&&!forbidden)throw new Error('Agent cannot remove a human routing restriction.');const raw=kind==='link'?setPlanLinkRoutingForbidden(this.a.getPlan(),id,forbidden,this.now()):setPlanNodeRoutingForbidden(this.a.getPlan(),id,forbidden,this.now());const next=retag(raw,actor,'set_routing_restriction');this.publishPlan(next);this.activity(actor,'set_routing_restriction',`${forbidden?'Avoid':'Allow'} ${id} in proposed routing`,id);return next;}"
if old not in s:
    raise SystemExit('routing restriction anchor not found')
s = s.replace(old, new, 1)

old = "hasCompleteN1:this.a.getContingencies?.()?.analysis.status==='complete'"
new = "hasCompleteN1:(()=>{const c=this.a.getContingencies?.()??null;return !!c&&isPlanEvidenceFresh(c.stamp,p,plan)&&c.analysis.status==='complete';})()"
if old not in s:
    raise SystemExit('N-1 capability freshness anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)

p = Path('tests/final-adversarial.test.ts')
s = p.read_text()
old_import = "  createChangePlan,\n  modelHash,"
new_import = "  changePlanEvidenceStamp,\n  createChangePlan,\n  modelHash,"
if 'changePlanEvidenceStamp,' not in s:
    if old_import not in s:
        raise SystemExit('model import anchor not found')
    s = s.replace(old_import, new_import, 1)

# Strengthen F-003 into F-005 capability/UI truth on the same stale-base construction.
anchor = """  assert.notEqual(plan.baseModelHash, modelHash(project));
  assert.throws(() => service.acceptProposalChange(proposalId, 'agent'), /stale.*base network changed/i);
"""
replacement = """  assert.notEqual(plan.baseModelHash, modelHash(project));
  assert.equal(service.capabilityState().proposalStale, true);
  assert.equal(service.capabilityState().canDecideProposal, false);
  assert.equal(service.getWorkspaceSummary().proposal.stale, true);
  assert.equal(service.inspectPlan().proposals[0].stale, true);
  assert.throws(() => service.acceptProposalChange(proposalId, 'agent'), /stale.*base network changed/i);
"""
if replacement not in s:
    if anchor not in s:
        raise SystemExit('F-003 strengthening anchor not found')
    s = s.replace(anchor, replacement, 1)

marker = "test('AV-13/F-006: stale complete N-1 evidence is not advertised as current complete coverage'"
if marker not in s:
    s += r'''

test('AV-13/F-006: stale complete N-1 evidence is not advertised as current complete coverage', () => {
  const project = collisionProject('n1-freshness', [
    { id: 'L1', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: false },
    { id: 'L2', source: 'B', target: 'C', capacityGbps: 10, weight: 1, bidirectional: false },
  ]);
  let plan = createChangePlan(project, 'N-1 freshness', { id: 'n1-plan', now: '2026-08-30T22:10:00.000Z' });
  const stamp = changePlanEvidenceStamp(project, plan);
  const service = new CollaborativeWorkspaceService({
    getProject: () => project,
    getPlan: () => plan,
    setPlan: (next) => { plan = next; },
    getContingencies: () => ({ analysis: { status: 'complete' } as never, stamp }),
  });
  assert.equal(service.capabilityState().hasCompleteN1, true);
  service.setPlanConstraint('targetUtilizationPct', 75, 'human');
  assert.equal(service.capabilityState().hasCompleteN1, false, 'complete but stale N-1 evidence must not be advertised as current coverage');
});
'''

marker = "test('AV-09/F-007: agent cannot remove human routing restrictions through the shared service'"
if marker not in s:
    s += r'''

test('AV-09/F-007: agent cannot remove human routing restrictions through the shared service', () => {
  const project = collisionProject('routing-restriction-authority', [
    { id: 'L1', source: 'A', target: 'B', capacityGbps: 10, weight: 1, bidirectional: false },
    { id: 'L2', source: 'B', target: 'C', capacityGbps: 10, weight: 1, bidirectional: false },
  ]);
  let plan = createChangePlan(project, 'Routing restriction authority', { id: 'routing-plan', now: '2026-08-30T22:20:00.000Z' });
  const service = new CollaborativeWorkspaceService({
    getProject: () => project,
    getPlan: () => plan,
    setPlan: (next) => { plan = next; },
  });

  service.setRoutingRestriction('link', 'L1', true, 'human');
  service.setRoutingRestriction('node', 'B', true, 'human');
  assert.ok(plan.restrictions.forbiddenRoutingLinkIds.includes('L1'));
  assert.ok(plan.restrictions.forbiddenRoutingNodeIds.includes('B'));
  assert.throws(() => service.setRoutingRestriction('link', 'L1', false, 'agent'), /Agent cannot remove a human routing restriction/);
  assert.throws(() => service.setRoutingRestriction('node', 'B', false, 'agent'), /Agent cannot remove a human routing restriction/);
  assert.ok(plan.restrictions.forbiddenRoutingLinkIds.includes('L1'));
  assert.ok(plan.restrictions.forbiddenRoutingNodeIds.includes('B'));

  service.setRoutingRestriction('link', 'L1', false, 'human');
  service.setRoutingRestriction('node', 'B', false, 'human');
  assert.equal(plan.restrictions.forbiddenRoutingLinkIds.includes('L1'), false);
  assert.equal(plan.restrictions.forbiddenRoutingNodeIds.includes('B'), false);
});
'''
p.write_text(s)
