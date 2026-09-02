import type { ChangePlan } from '@infratwin/model';
import { changePlanHash, describePlanChange } from '@infratwin/model';

interface Props { plan: ChangePlan; onAccept: (id: string) => void; onReject: (id: string) => void; onAcceptAll: () => void; onDiscard: () => void }

export function CandidateProposalList({ plan, onAccept, onReject, onAcceptAll, onDiscard }: Props) {
  const pending = plan.proposals.filter((proposal) => proposal.state === 'pending');
  if (!plan.proposals.length) return null;
  const currentHash = changePlanHash(plan);
  const anyStale=pending.some((proposal)=>proposal.sourcePlanHash!==currentHash);
  return <section className="plan-subsection candidate-proposals" data-testid="candidate-proposals"><div className="subsection-title"><span>Agent / optimizer proposals</span><strong>{pending.length} pending</strong></div>{plan.proposals.map((proposal)=>{const stale=proposal.sourcePlanHash!==currentHash;const lifecycle=proposal.state==='accepted'?'Accepted into ChangePlan':proposal.state==='rejected'?'Rejected by human':stale?'Stale · needs replanning':'Proposed · awaiting human review';return <div className={`proposal-row ${proposal.state} ${stale?'stale':''}`} key={proposal.id} data-testid={`proposal-${proposal.change.target.kind==='link'?proposal.change.target.id:proposal.id}`}><div><strong>{describePlanChange(proposal.change)}</strong><small><span className="actor-chip agent">Agent</span>{lifecycle}</small></div>{proposal.state==='pending'&&<div className="proposal-actions"><button type="button" disabled={stale} title={stale?'This proposal was generated for an older ChangePlan. Find mitigation again before accepting it.':undefined} onClick={()=>onAccept(proposal.id)}>Accept into plan</button><button type="button" onClick={()=>onReject(proposal.id)}>Reject</button></div>}</div>})}{pending.length>0&&<><div className="proposal-toolbar"><button type="button" disabled={anyStale} title={anyStale?'One or more proposals are stale after a plan edit.':undefined} onClick={onAcceptAll}>Accept all into plan</button><button type="button" onClick={onDiscard}>Discard proposal set</button></div><small className="proposal-boundary">Acceptance changes the browser-local ChangePlan. It does not mutate the base network.</small></>}</section>;
}
