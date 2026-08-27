import type { ChangePlan } from '@infratwin/model';
import { changePlanHash, describePlanChange } from '@infratwin/model';

interface Props {
  plan: ChangePlan;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onAcceptAll: () => void;
  onDiscard: () => void;
}

export function CandidateProposalList({ plan, onAccept, onReject, onAcceptAll, onDiscard }: Props) {
  const pending = plan.proposals.filter((proposal) => proposal.state === 'pending');
  if (!plan.proposals.length) return null;
  const currentHash = changePlanHash(plan);
  return (
    <section className="plan-subsection candidate-proposals" data-testid="candidate-proposals">
      <div className="subsection-title"><span>Agent proposals</span><strong>{pending.length} pending</strong></div>
      {plan.proposals.map((proposal) => {
        const stale = proposal.sourcePlanHash !== currentHash;
        return (
          <div className={`proposal-row ${proposal.state} ${stale ? 'stale' : ''}`} key={proposal.id} data-testid={`proposal-${proposal.change.target.kind === 'link' ? proposal.change.target.id : proposal.id}`}>
            <div><strong>{describePlanChange(proposal.change)}</strong><small>Optimizer · {proposal.state}{stale ? ' · stale after plan revision' : ''}</small></div>
            {proposal.state === 'pending' && <div className="proposal-actions"><button type="button" disabled={stale} onClick={() => onAccept(proposal.id)}>Accept</button><button type="button" onClick={() => onReject(proposal.id)}>Reject</button></div>}
          </div>
        );
      })}
      {pending.length > 0 && <div className="proposal-toolbar"><button type="button" disabled={pending.some((proposal) => proposal.sourcePlanHash !== currentHash)} onClick={onAcceptAll}>Accept all</button><button type="button" onClick={onDiscard}>Discard candidate</button></div>}
    </section>
  );
}
