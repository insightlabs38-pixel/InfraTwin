import { useEffect, useState } from 'react';
import type { CandidateLinkOption, ChangePlan, NetworkProject, PlanChange, PlanConstraints } from '@infratwin/model';
import { describePlanChange } from '@infratwin/model';
import { CandidateProposalList } from './candidate-proposal-list';
import { DemandPlanEditor } from './demand-plan-editor';

interface Props {
  project: NetworkProject;
  plan: ChangePlan;
  trafficEditorOpen: boolean;
  onTrafficEditorOpenChange: (open: boolean) => void;
  onRenamePlan: (name: string) => void;
  onRemoveChange: (id: string) => void;
  onSetConstraint: <K extends keyof PlanConstraints>(key: K, value: PlanConstraints[K]) => void;
  onSetBandwidth: (demandId: string, bandwidthGbps: number) => void;
  onAddDemand: (input: { name: string; source: string; target: string; bandwidthGbps: number; serviceClassId: string }) => void;
  onAddGrowth: (demandIds: string[], multiplier: number) => void;
  onAcceptProposal: (id: string) => void;
  onRejectProposal: (id: string) => void;
  onAcceptAll: () => void;
  onDiscardCandidate: () => void;
  onVerifyProposal?: () => void;
  candidateStale?: boolean;
}

export function ChangePlanPanel(props: Props) {
  const { project, plan } = props;
  const [planNameDraft, setPlanNameDraft] = useState(plan.name);
  const [candidateLinkDraft, setCandidateLinkDraft] = useState<CandidateLinkOption>({ id: '', source: project.nodes[0]?.id ?? '', target: project.nodes[1]?.id ?? project.nodes[0]?.id ?? '', capacityGbps: 10, weight: 1, cost: 10 });
  useEffect(() => setPlanNameDraft(plan.name), [plan.id, plan.name]);
  const pending = plan.proposals.filter((proposal) => proposal.state === 'pending').length;
  const lockCount = plan.restrictions.lockedLinkIds.length + plan.restrictions.lockedNodeIds.length;
  const visibleChangeSummary = (item: PlanChange) => item.type === 'demand_growth' && item.target.ids.length > 4
    ? `Grow ${item.target.ids.length} demands by ${Math.round((item.payload.multiplier - 1) * 1000) / 10}%`
    : describePlanChange(item);
  const changeProvenance = (changeId: string, actor: 'human' | 'agent') => {
    if (actor === 'human') return 'Human-authored';
    const proposal = plan.proposals.find((item) => item.change.id === changeId && item.state === 'accepted');
    const humanAccepted = proposal && plan.history.some((event) => event.action === 'accepted_proposal' && event.actor === 'human' && event.relatedId === proposal.id);
    return humanAccepted ? 'Agent/optimizer proposal accepted by human' : 'Agent-authored';
  };

  return (
    <aside className="plan-panel" data-testid="change-plan-panel" aria-label="Current Change Plan">
      <div className="plan-panel-header">
        <div><span className="section-kicker">Change Plan</span><input data-testid="plan-name" value={planNameDraft} aria-label="Change Plan name" onChange={(event) => setPlanNameDraft(event.target.value)} onBlur={() => { if (planNameDraft.trim() && planNameDraft.trim() !== plan.name) props.onRenamePlan(planNameDraft); }} /></div>
        <span className={`plan-status ${plan.status}`}>{plan.status}</span>
      </div>

      <section className="compact-section" data-testid="plan-change-list">
        <div className="section-row"><span>Changes</span><strong>{plan.changes.length}</strong></div>
        {plan.changes.length === 0 ? <p className="muted compact-copy">No planned changes.</p> : <div className="compact-list">{plan.changes.map((item) => <div className={`plan-change-row actor-${item.actor}`} key={item.id}><div><strong>{visibleChangeSummary(item)}</strong><small>{changeProvenance(item.id, item.actor)}</small></div><button aria-label={`Remove ${item.id}`} data-testid={`remove-plan-change-${item.id}`} onClick={() => props.onRemoveChange(item.id)}>×</button></div>)}</div>}
      </section>

      <details className="compact-disclosure" data-testid="plan-constraints">
        <summary><span>Constraints</span><strong>{plan.constraints.targetUtilizationPct}% target · {plan.constraints.budgetCostUnits === null ? 'no budget cap' : `budget ${plan.constraints.budgetCostUnits}`} · N-1 {plan.constraints.requireN1 ? 'on' : 'off'}</strong></summary>
        <div className="compact-disclosure-body">
          <div className="compact-form two-col">
            <label>Target utilization %<input data-testid="constraint-target-utilization" type="number" min="0.1" max="100" step="1" value={plan.constraints.targetUtilizationPct} onChange={(event) => props.onSetConstraint('targetUtilizationPct', Number(event.target.value))} /></label>
            <label>Budget cost units<input data-testid="constraint-budget" type="number" min="0" step="1" value={plan.constraints.budgetCostUnits ?? ''} placeholder="optional" onChange={(event) => props.onSetConstraint('budgetCostUnits', event.target.value === '' ? null : Number(event.target.value))} /></label>
          </div>
          <label className="check-row"><input data-testid="constraint-require-n1" type="checkbox" checked={plan.constraints.requireN1} onChange={(event) => props.onSetConstraint('requireN1', event.target.checked)} />Require N-1 resilience</label>
          <span className="mini-label">Allowed mitigation actions</span>
          <div className="checkbox-grid">
            <label className="check-row"><input data-testid="allow-capacity-upgrades" type="checkbox" checked={plan.constraints.allowedMitigationActions.capacityUpgrades} onChange={(event) => props.onSetConstraint('allowedMitigationActions', { ...plan.constraints.allowedMitigationActions, capacityUpgrades: event.target.checked })} />Capacity upgrades</label>
            <label className="check-row"><input data-testid="allow-routing-changes" type="checkbox" checked={plan.constraints.allowedMitigationActions.routingChanges} onChange={(event) => props.onSetConstraint('allowedMitigationActions', { ...plan.constraints.allowedMitigationActions, routingChanges: event.target.checked })} />Routing changes</label>
            <label className="check-row"><input data-testid="allow-new-links" type="checkbox" checked={plan.constraints.allowedMitigationActions.newLinks} onChange={(event) => props.onSetConstraint('allowedMitigationActions', { ...plan.constraints.allowedMitigationActions, newLinks: event.target.checked })} />Declared new links</label>
          </div>
          <label>Candidate paths per demand<select data-testid="constraint-max-candidate-paths" value={plan.constraints.maxCandidatePaths} onChange={(event) => props.onSetConstraint('maxCandidatePaths', Number(event.target.value))}>{[1,2,3,4,5,6,7,8].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          {plan.constraints.allowedMitigationActions.newLinks && <div className="candidate-link-editor" data-testid="candidate-link-editor">
            <span className="mini-label">Declared candidate links</span>
            {plan.constraints.candidateLinkOptions.length > 0 && <div className="compact-list">{plan.constraints.candidateLinkOptions.map((item) => <div key={item.id} className="plan-change-row"><div><strong>{item.id}: {item.source} ↔ {item.target}</strong><small>{item.capacityGbps} Gbps · weight {item.weight} · cost {item.cost}</small></div><button type="button" aria-label={`Remove candidate ${item.id}`} onClick={() => props.onSetConstraint('candidateLinkOptions', plan.constraints.candidateLinkOptions.filter((candidate) => candidate.id !== item.id))}>×</button></div>)}</div>}
            <div className="compact-form two-col">
              <label>ID<input data-testid="candidate-link-id" value={candidateLinkDraft.id} onChange={(event) => setCandidateLinkDraft((current) => ({ ...current, id: event.target.value }))} /></label>
              <label>Source<select data-testid="candidate-link-source" value={candidateLinkDraft.source} onChange={(event) => setCandidateLinkDraft((current) => ({ ...current, source: event.target.value }))}>{project.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label>
              <label>Target<select data-testid="candidate-link-target" value={candidateLinkDraft.target} onChange={(event) => setCandidateLinkDraft((current) => ({ ...current, target: event.target.value }))}>{project.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label>
              <label>Capacity<input data-testid="candidate-link-capacity" type="number" min="0.1" step="1" value={candidateLinkDraft.capacityGbps} onChange={(event) => setCandidateLinkDraft((current) => ({ ...current, capacityGbps: Number(event.target.value) }))} /></label>
              <label>Weight<input data-testid="candidate-link-weight" type="number" min="0.1" step="0.1" value={candidateLinkDraft.weight} onChange={(event) => setCandidateLinkDraft((current) => ({ ...current, weight: Number(event.target.value) }))} /></label>
              <label>Cost<input data-testid="candidate-link-cost" type="number" min="0" step="1" value={candidateLinkDraft.cost} onChange={(event) => setCandidateLinkDraft((current) => ({ ...current, cost: Number(event.target.value) }))} /></label>
            </div>
            <button type="button" data-testid="add-candidate-link" disabled={!candidateLinkDraft.id.trim() || candidateLinkDraft.source === candidateLinkDraft.target} onClick={() => { const next = { ...candidateLinkDraft, id: candidateLinkDraft.id.trim() }; props.onSetConstraint('candidateLinkOptions', [...plan.constraints.candidateLinkOptions.filter((item) => item.id !== next.id), next]); setCandidateLinkDraft((current) => ({ ...current, id: '' })); }}>Declare candidate link</button>
          </div>}
          <span className="mini-label">Protected service classes</span>
          <div className="checkbox-grid">{project.serviceClasses.map((item) => <label className="check-row" key={item.id}><input data-testid={`protected-class-${item.id}`} type="checkbox" checked={plan.constraints.protectedServiceClassIds.includes(item.id)} onChange={(event) => props.onSetConstraint('protectedServiceClassIds', event.target.checked ? [...new Set([...plan.constraints.protectedServiceClassIds, item.id])] : plan.constraints.protectedServiceClassIds.filter((id) => id !== item.id))} />{item.name}</label>)}</div>
        </div>
      </details>

      <details className="compact-disclosure" open={props.trafficEditorOpen} onToggle={(event) => props.onTrafficEditorOpenChange((event.currentTarget as HTMLDetailsElement).open)}>
        <summary><span>Traffic changes</span><strong>{plan.changes.filter((item) => item.type === 'set_demand_bandwidth' || item.type === 'add_demand' || item.type === 'demand_growth').length} planned</strong></summary>
        <div className="compact-disclosure-body"><DemandPlanEditor project={project} plan={plan} onSetBandwidth={props.onSetBandwidth} onAddDemand={props.onAddDemand} onAddGrowth={props.onAddGrowth} /></div>
      </details>

      <section className="compact-section" data-testid="plan-restrictions">
        <div className="section-row"><span>Restrictions</span><strong>{lockCount} locked</strong></div>
        <p className="muted compact-copy">{lockCount ? `${plan.restrictions.lockedLinkIds.length} link(s) · ${plan.restrictions.lockedNodeIds.length} node(s)` : 'No locked objects.'}</p>
      </section>

      {pending > 0 && <section className="compact-section proposal-section"><div className="section-row"><span>Proposal</span><strong>{pending} pending</strong></div>{props.onVerifyProposal && <button type="button" className="wide" data-testid="verify-candidate" disabled={props.candidateStale} onClick={props.onVerifyProposal}>{props.candidateStale ? 'Re-run mitigation first' : 'Verify proposal'}</button>}<CandidateProposalList plan={plan} onAccept={props.onAcceptProposal} onReject={props.onRejectProposal} onAcceptAll={props.onAcceptAll} onDiscard={props.onDiscardCandidate} /></section>}
    </aside>
  );
}
