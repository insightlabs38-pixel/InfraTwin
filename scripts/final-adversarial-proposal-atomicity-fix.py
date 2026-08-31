from pathlib import Path

# Temporary patcher for F-013. Remove before final freeze.
model = Path('packages/model/src/index.ts')
s = model.read_text()
old = """export function acceptAllCandidateChanges(plan: ChangePlan, now = new Date().toISOString()): ChangePlan {\n  let next = cloneChangePlan(plan);\n  for (const proposal of next.proposals.filter((item) => item.state === 'pending')) next = acceptCandidateChange(next, proposal.id, now);\n  return next;\n}\n"""
new = """export function acceptAllCandidateChanges(plan: ChangePlan, now = new Date().toISOString()): ChangePlan {\n  const next = cloneChangePlan(plan);\n  const pending = next.proposals.filter((item) => item.state === 'pending');\n  if (!pending.length) return next;\n  const sourcePlanHash = changePlanHash(next);\n  const existingChangeIds = new Set(next.changes.map((change) => change.id));\n  const batchChangeIds = new Set<string>();\n  for (const proposal of pending) {\n    if (proposal.sourcePlanHash !== sourcePlanHash) throw new Error('Optimizer proposal is stale because the Change Plan changed. Re-run candidate generation.');\n    if (existingChangeIds.has(proposal.change.id) || batchChangeIds.has(proposal.change.id)) throw new Error(`Accepted proposal change ${proposal.change.id} already exists in the plan.`);\n    batchChangeIds.add(proposal.change.id);\n  }\n  for (const proposal of pending) {\n    proposal.state = 'accepted'; proposal.decidedAt = now;\n    next.changes.push(JSON.parse(JSON.stringify(proposal.change)) as PlanChange);\n    next.history.push(historyEvent(next, 'human', 'accepted_proposal', `Accepted ${describePlanChange(proposal.change)}`, now, proposal.id));\n    next.history.push(historyEvent(next, 'system', 'verification_invalidated', 'Verification invalidated because an optimizer proposal was accepted.', now, proposal.id));\n  }\n  next.status = 'draft'; next.updatedAt = now;\n  return next;\n}\n"""
if old not in s:
    raise SystemExit('model accept-all anchor not found')
s = s.replace(old, new, 1)
model.write_text(s)

app = Path('packages/application/src/index.ts')
s = app.read_text()
old = "import { acceptCandidateChange, addPlanChange,"
new = "import { acceptAllCandidateChanges, acceptCandidateChange, addPlanChange,"
if old not in s:
    raise SystemExit('application import anchor not found')
s = s.replace(old, new, 1)
old = "  acceptAllProposalChanges(actor:PlanActor='human'){const project=this.a.getProject();let next=this.a.getPlan();if(next.baseModelHash!==modelHash(project))throw new Error('Optimizer proposal is stale because the base network changed. Re-run candidate generation.');const ids=next.proposals.filter(x=>x.state==='pending').map(x=>x.id);for(const id of ids)next=retag(acceptCandidateChange(next,id,this.now()),actor,'accepted_proposal');this.publishPlan(next);this.activity(actor,'accepted_all_proposals','Accepted all current proposal changes');return next;}"
new = "  acceptAllProposalChanges(actor:PlanActor='human'){const project=this.a.getProject(),plan=this.a.getPlan();if(plan.baseModelHash!==modelHash(project))throw new Error('Optimizer proposal is stale because the base network changed. Re-run candidate generation.');const next=retag(acceptAllCandidateChanges(plan,this.now()),actor,'accepted_proposal');this.publishPlan(next);this.activity(actor,'accepted_all_proposals','Accepted all current proposal changes');return next;}"
if old not in s:
    raise SystemExit('application accept-all anchor not found')
s = s.replace(old, new, 1)
app.write_text(s)
