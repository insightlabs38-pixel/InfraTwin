'use client';

import { PlanHistory } from './plan-history';

export function WorkbenchM35dPlansView({scope}:{scope:any}){
  const { activeView, plan, newPlanName, setNewPlanName, newPlan, clearPlan, definition, loadPlanTemplate } = scope;
  if(activeView !== 'plans') return null;
  return <section className="destination-view plans-view" data-testid="plans-view">
    <header className="destination-heading"><div><span className="section-kicker">Plans</span><h1>Change Plan workspace</h1><p>Organize current plan metadata, examples, and semantic activity. Edit operational changes in Network.</p></div></header>
    <div className="destination-scroll"><div className="plans-grid">
      <section className="plain-section"><h2>Current plan</h2><dl className="compact-metrics">
        <div><dt>Name</dt><dd>{plan.name}</dd></div><div><dt>Status</dt><dd>{plan.status}</dd></div><div><dt>Changes</dt><dd>{plan.changes.length}</dd></div><div><dt>Locks</dt><dd>{plan.restrictions.lockedLinkIds.length + plan.restrictions.lockedNodeIds.length}</dd></div>
      </dl><div className="new-plan-row"><input aria-label="New plan name" value={newPlanName} onChange={(event) => setNewPlanName(event.target.value)} /><button data-testid="new-plan" onClick={() => newPlan(newPlanName.trim() || 'Change Plan')}>New plan</button><button data-testid="clear-plan" onClick={clearPlan}>Clear plan</button></div></section>
      <section className="plain-section"><h2>Template / example plan</h2>{definition.changePlanTemplate ? <><p>{definition.title} includes a prepared Change Plan for this network.</p><button data-testid="load-plan-template" onClick={loadPlanTemplate}>Load example plan</button></> : <p className="muted">This network does not include a prepared plan template.</p>}</section>
      <section className="plain-section plan-history-section"><h2>History / activity</h2><PlanHistory events={plan.history} /></section>
    </div></div>
  </section>;
}
