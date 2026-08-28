import { useEffect, useState } from 'react';
import type { ChangePlan, NetworkProject } from '@infratwin/model';
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
  onSetConstraint: (key: 'targetUtilizationPct' | 'budgetCostUnits' | 'requireN1' | 'protectedServiceClassIds', value: number | null | boolean | string[]) => void;
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
  useEffect(() => setPlanNameDraft(plan.name), [plan.id, plan.name]);
  const pending = plan.proposals.filter((proposal) => proposal.state === 'pending').length;
  const lockCount = plan.restrictions.lockedLinkIds.length + plan.restrictions.lockedNodeIds.length;

  return (
    <aside className="plan-panel" data-testid="change-plan-panel" aria-label="Current Change Plan">
      <div className="plan-panel-header">
        <div><span className="section-kicker">Change Plan</span><input data-testid="plan-name" value={planNameDraft} aria-label="Change Plan name" onChange={(event) => setPlanNameDraft(event.target.value)} onBlur={() => { if (planNameDraft.trim() && planNameDraft.trim() !== plan.name) props.onRenamePlan(planNameDraft); }} /></div>
        <span className={`plan-status ${plan.status}`}>{plan.status}</span>
      </div>

      <section className="compact-section" data-testid="plan-change-list">
        <div className="section-row"><span>Changes</span><strong>{plan.changes.length}</strong></div>
        {plan.changes.length === 0 ? <p className="muted compact-copy">No planned changes.</p> : <div className="compact-list">{plan.changes.map((item) => <div className={`plan-change-row actor-${item.actor}`} key={item.id}><div><strong>{describePlanChange(item)}</strong><small>{item.actor === 'agent' ? 'Accepted optimizer proposal' : 'Human-authored'}</small></div><button aria-label={`Remove ${item.id}`} data-testid={`remove-plan-change-${item.id}`} onClick={() => props.onRemoveChange(item.id)}>×</button></div>)}</div>}
      </section>

      <details className="compact-disclosure" data-testid="plan-constraints">
        <summary><span>Constraints</span><strong>{plan.constraints.targetUtilizationPct}% target · {plan.constraints.budgetCostUnits === null ? 'no budget cap' : `budget ${plan.constraints.budgetCostUnits}`} · N-1 {plan.constraints.requireN1 ? 'on' : 'off'}</strong></summary>
        <div className="compact-disclosure-body">
          <div className="compact-form two-col">
            <label>Target utilization %<input data-testid="constraint-target-utilization" type="number" min="0.1" max="100" step="1" value={plan.constraints.targetUtilizationPct} onChange={(event) => props.onSetConstraint('targetUtilizationPct', Number(event.target.value))} /></label>
            <label>Budget cost units<input data-testid="constraint-budget" type="number" min="0" step="1" value={plan.constraints.budgetCostUnits ?? ''} placeholder="optional" onChange={(event) => props.onSetConstraint('budgetCostUnits', event.target.value === '' ? null : Number(event.target.value))} /></label>
          </div>
          <label className="check-row"><input data-testid="constraint-require-n1" type="checkbox" checked={plan.constraints.requireN1} onChange={(event) => props.onSetConstraint('requireN1', event.target.checked)} />Require N-1 resilience</label>
          <span className="mini-label">Protected service classes</span>
          <div className="checkbox-grid">{project.serviceClasses.map((item) => <label className="check-row" key={item.id}><input data-testid={`protected-class-${item.id}`} type="checkbox" checked={plan.constraints.protectedServiceClassIds.includes(item.id)} onChange={(event) => props.onSetConstraint('protectedServiceClassIds', event.target.checked ? [...new Set([...plan.constraints.protectedServiceClassIds, item.id])] : plan.constraints.protectedServiceClassIds.filter((id) => id !== item.id))} />{item.name}</label>)}</div>
        </div>
      </details>

      <details className="compact-disclosure" open={props.trafficEditorOpen} onToggle={(event) => props.onTrafficEditorOpenChange((event.currentTarget as HTMLDetailsElement).open)}>
        <summary><span>Traffic changes</span><strong>{plan.changes.filter((item) => item.type === 'set_demand_bandwidth' || item.type === 'add_demand' || item.type === 'scale_demands').length} planned</strong></summary>
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
