import { useEffect, useState } from 'react';
import type { ChangePlan, NetworkProject } from '@infratwin/model';
import { describePlanChange } from '@infratwin/model';
import { CandidateProposalList } from './candidate-proposal-list';
import { DemandPlanEditor } from './demand-plan-editor';
import { PlanHistory } from './plan-history';

interface Props {
  project: NetworkProject;
  plan: ChangePlan;
  selectedLinkId: string | null;
  selectedNodeId: string | null;
  hasTemplate: boolean;
  onNewPlan: (name: string) => void;
  onClearPlan: () => void;
  onRenamePlan: (name: string) => void;
  onLoadTemplate: () => void;
  onRemoveChange: (id: string) => void;
  onLinkAvailability: (linkId: string, available: boolean) => void;
  onLinkCapacity: (linkId: string, capacityGbps: number) => void;
  onNodeAvailability: (nodeId: string, available: boolean) => void;
  onLockLink: (linkId: string, locked: boolean) => void;
  onLockNode: (nodeId: string, locked: boolean) => void;
  onSetConstraint: (key: 'targetUtilizationPct' | 'budgetCostUnits' | 'requireN1' | 'protectedServiceClassIds', value: number | null | boolean | string[]) => void;
  onSetBandwidth: (demandId: string, bandwidthGbps: number) => void;
  onAddDemand: (input: { name: string; source: string; target: string; bandwidthGbps: number; serviceClassId: string }) => void;
  onAddGrowth: (demandIds: string[], multiplier: number) => void;
  onAcceptProposal: (id: string) => void;
  onRejectProposal: (id: string) => void;
  onAcceptAll: () => void;
  onDiscardCandidate: () => void;
}

export function ChangePlanPanel(props: Props) {
  const { project, plan } = props;
  const [newPlanName, setNewPlanName] = useState('Change Plan');
  const [planNameDraft, setPlanNameDraft] = useState(plan.name);
  useEffect(() => setPlanNameDraft(plan.name), [plan.id, plan.name]);
  const selectedLink = props.selectedLinkId ? project.links.find((item) => item.id === props.selectedLinkId) : undefined;
  const selectedNode = props.selectedNodeId ? project.nodes.find((item) => item.id === props.selectedNodeId) : undefined;
  const linkAvailabilityChange = selectedLink ? [...plan.changes].reverse().find((item) => (item.type === 'disable_link' || item.type === 'enable_link') && item.target.id === selectedLink.id) : undefined;
  const nodeAvailabilityChange = selectedNode ? [...plan.changes].reverse().find((item) => (item.type === 'disable_node' || item.type === 'enable_node') && item.target.id === selectedNode.id) : undefined;
  const plannedCapacity = selectedLink ? [...plan.changes].reverse().find((item) => item.type === 'set_link_capacity' && item.target.id === selectedLink.id) : undefined;
  const [capacityDraft, setCapacityDraft] = useState<number | null>(null);

  return (
    <aside className="panel plan-panel" data-testid="change-plan-panel">
      <div className="panel-heading compact"><div><p className="eyebrow">Current Change Plan</p><h2>Human + optimizer workspace</h2></div><span className={`plan-status ${plan.status}`}>{plan.status}</span></div>
      <div className="plan-name-row"><input data-testid="plan-name" value={planNameDraft} onChange={(event) => setPlanNameDraft(event.target.value)} onBlur={() => { if (planNameDraft.trim() && planNameDraft.trim() !== plan.name) props.onRenamePlan(planNameDraft); }} /><button data-testid="clear-plan" type="button" onClick={props.onClearPlan}>Clear</button></div>
      <div className="new-plan-row"><input aria-label="New plan name" value={newPlanName} onChange={(event) => setNewPlanName(event.target.value)} /><button data-testid="new-plan" type="button" onClick={() => props.onNewPlan(newPlanName)}>New Plan</button>{props.hasTemplate && <button data-testid="load-plan-template" type="button" onClick={props.onLoadTemplate}>Load example plan</button>}</div>

      {(selectedLink || selectedNode) && <section className="plan-subsection object-context" data-testid="plan-object-context">
        <div className="subsection-title"><span>Selected object</span><strong>{selectedLink?.id ?? selectedNode?.id}</strong></div>
        {selectedLink && <>
          <small>{selectedLink.source} ↔ {selectedLink.target} · base {selectedLink.capacityGbps} Gbps</small>
          <div className="context-actions">
            {selectedLink.available === false ? <button data-testid={`plan-link-restore-${selectedLink.id}`} onClick={() => props.onLinkAvailability(selectedLink.id, true)}>{linkAvailabilityChange?.type === 'enable_link' ? 'Remove planned restore' : 'Plan restore'}</button> : <button data-testid={`plan-link-outage-${selectedLink.id}`} onClick={() => props.onLinkAvailability(selectedLink.id, false)}>{linkAvailabilityChange?.type === 'disable_link' ? 'Remove planned outage' : 'Add outage'}</button>}
            <label className="check-row"><input data-testid={`lock-link-${selectedLink.id}`} type="checkbox" checked={plan.restrictions.lockedLinkIds.includes(selectedLink.id)} onChange={(event) => props.onLockLink(selectedLink.id, event.target.checked)} />Locked / do not modify</label>
          </div>
          <div className="capacity-plan-row"><label>Planned capacity<input data-testid={`plan-link-capacity-${selectedLink.id}`} type="number" min="0.001" step="1" value={capacityDraft ?? (plannedCapacity?.type === 'set_link_capacity' ? plannedCapacity.payload.capacityGbps : selectedLink.capacityGbps)} onChange={(event) => setCapacityDraft(Number(event.target.value))} /></label><button data-testid={`add-link-capacity-${selectedLink.id}`} onClick={() => props.onLinkCapacity(selectedLink.id, capacityDraft ?? selectedLink.capacityGbps)}>Add capacity change</button></div>
        </>}
        {selectedNode && <>
          <small>{selectedNode.name}</small>
          <div className="context-actions">
            {selectedNode.available === false ? <button data-testid={`plan-node-restore-${selectedNode.id}`} onClick={() => props.onNodeAvailability(selectedNode.id, true)}>{nodeAvailabilityChange?.type === 'enable_node' ? 'Remove planned restore' : 'Plan restore'}</button> : <button data-testid={`plan-node-outage-${selectedNode.id}`} onClick={() => props.onNodeAvailability(selectedNode.id, false)}>{nodeAvailabilityChange?.type === 'disable_node' ? 'Remove planned outage' : 'Add node outage'}</button>}
            <label className="check-row"><input data-testid={`lock-node-${selectedNode.id}`} type="checkbox" checked={plan.restrictions.lockedNodeIds.includes(selectedNode.id)} onChange={(event) => props.onLockNode(selectedNode.id, event.target.checked)} />Locked / do not modify</label>
          </div>
        </>}
      </section>}

      <section className="plan-subsection" data-testid="plan-change-list">
        <div className="subsection-title"><span>Planned changes</span><strong>{plan.changes.length}</strong></div>
        {plan.changes.length === 0 ? <p className="muted">Select a link/node or add traffic to construct the plan.</p> : plan.changes.map((item) => <div className={`plan-change-row actor-${item.actor}`} key={item.id}><div><strong>{describePlanChange(item)}</strong><small>{item.actor === 'agent' ? 'Agent/optimizer proposal accepted by human' : 'Human-authored'}</small></div><button aria-label={`Remove ${item.id}`} data-testid={`remove-plan-change-${item.id}`} onClick={() => props.onRemoveChange(item.id)}>×</button></div>)}
      </section>

      <DemandPlanEditor project={project} plan={plan} onSetBandwidth={props.onSetBandwidth} onAddDemand={props.onAddDemand} onAddGrowth={props.onAddGrowth} />

      <section className="plan-subsection" data-testid="plan-constraints">
        <div className="subsection-title"><span>Constraints</span><strong>Solver boundary</strong></div>
        <div className="compact-form two-col">
          <label>Target utilization %<input data-testid="constraint-target-utilization" type="number" min="0.1" max="100" step="1" value={plan.constraints.targetUtilizationPct} onChange={(event) => props.onSetConstraint('targetUtilizationPct', Number(event.target.value))} /></label>
          <label>Budget cost units<input data-testid="constraint-budget" type="number" min="0" step="1" value={plan.constraints.budgetCostUnits ?? ''} placeholder="optional" onChange={(event) => props.onSetConstraint('budgetCostUnits', event.target.value === '' ? null : Number(event.target.value))} /></label>
        </div>
        <label className="check-row"><input data-testid="constraint-require-n1" type="checkbox" checked={plan.constraints.requireN1} onChange={(event) => props.onSetConstraint('requireN1', event.target.checked)} />Require N-1 resilience</label>
        <span className="mini-label">Protected service classes</span>
        <div className="checkbox-grid">{project.serviceClasses.map((item) => <label className="check-row" key={item.id}><input data-testid={`protected-class-${item.id}`} type="checkbox" checked={plan.constraints.protectedServiceClassIds.includes(item.id)} onChange={(event) => props.onSetConstraint('protectedServiceClassIds', event.target.checked ? [...new Set([...plan.constraints.protectedServiceClassIds, item.id])] : plan.constraints.protectedServiceClassIds.filter((id) => id !== item.id))} />{item.name}</label>)}</div>
      </section>

      <section className="plan-subsection restrictions-summary" data-testid="plan-restrictions"><div className="subsection-title"><span>Restrictions</span><strong>Locked / do not modify</strong></div><p>Links: {plan.restrictions.lockedLinkIds.join(', ') || 'none'}</p><p>Nodes: {plan.restrictions.lockedNodeIds.join(', ') || 'none'}</p></section>
      <CandidateProposalList plan={plan} onAccept={props.onAcceptProposal} onReject={props.onRejectProposal} onAcceptAll={props.onAcceptAll} onDiscard={props.onDiscardCandidate} />
      <section className="plan-subsection"><div className="subsection-title"><span>History</span><strong>Semantic activity only</strong></div><PlanHistory events={plan.history} /></section>
    </aside>
  );
}
