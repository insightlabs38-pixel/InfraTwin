'use client';

import { PlanHistory } from './plan-history';

export function WorkbenchM35dPlansView({scope}:{scope:any}){
  const { activeView, plan, newPlanName, setNewPlanName, newPlan, clearPlan, definition, loadPlanTemplate, currentDesignState, selectedDesignVariant, canCompareDesignVariants, compareDesignVariants, selectDesignVariant, optimizerStatus } = scope;
  if(activeView !== 'plans') return null;
  return <section className="destination-view plans-view" data-testid="plans-view">
    <header className="destination-heading"><div><span className="section-kicker">Plans</span><h1>Change Plan workspace</h1><p>Compare the current browser-local plan with bounded optimizer alternatives. Operational edits remain in Network.</p></div></header>
    <div className="destination-scroll"><div className="plans-grid">
      <section className="plain-section"><h2>Current plan</h2><dl className="compact-metrics">
        <div><dt>Name</dt><dd>{plan.name}</dd></div><div><dt>Status</dt><dd>{plan.status}</dd></div><div><dt>Changes</dt><dd>{plan.changes.length}</dd></div><div><dt>Locks</dt><dd>{plan.restrictions.lockedLinkIds.length + plan.restrictions.lockedNodeIds.length}</dd></div>
      </dl><div className="new-plan-row"><input aria-label="New plan name" value={newPlanName} onChange={(event) => setNewPlanName(event.target.value)} /><button data-testid="new-plan" onClick={() => newPlan(newPlanName.trim() || 'Change Plan')}>New plan</button><button data-testid="clear-plan" onClick={clearPlan}>Clear plan</button></div></section>
      <section className="plain-section" data-testid="design-variants-section">
        <div className="section-heading-row"><div><h2>Adaptive design alternatives</h2><p>Small deterministic Pareto frontier over the allowed routing/design space.</p></div><button data-testid="compare-design-variants" disabled={!canCompareDesignVariants || optimizerStatus === 'running'} onClick={() => void compareDesignVariants()}>Compare alternatives</button></div>
        {!currentDesignState?.variants.length ? <p className="muted">No current adaptive design alternatives. Analyze a failing plan, then compare alternatives.</p> : <div className="variant-table" data-testid="design-variant-table">
          <div className="variant-row variant-header"><span>Variant</span><span>Cost</span><span>Peak</span><span>Changes</span><span>Verification</span></div>
          {currentDesignState.variants.map((variant:any) => <button type="button" key={variant.id} data-testid={`design-variant-${variant.id}`} className={`variant-row ${selectedDesignVariant?.id === variant.id ? 'selected' : ''}`} onClick={() => selectDesignVariant(variant.id)}>
            <span><strong>{variant.label}</strong><small>{variant.objectiveLabel ?? 'adaptive design'}</small></span><span>{variant.totalCost}</span><span>{Math.round(variant.peakUtilizationPct * 10) / 10}%</span><span>{variant.selectedUpgrades.length} upgrade{variant.selectedUpgrades.length === 1 ? '' : 's'} · {variant.selectedNewLinks.length} new · {variant.evidence.routingAllocationSummary.length} route</span><span>{variant.verification.status}</span>
          </button>)}
        </div>}
      </section>
      <section className="plain-section"><h2>Template / example plan</h2>{definition.changePlanTemplate ? <><p>{definition.title} includes a prepared Change Plan for this network.</p><button data-testid="load-plan-template" onClick={loadPlanTemplate}>Load example plan</button></> : <p className="muted">This network does not include a prepared plan template.</p>}</section>
      <section className="plain-section plan-history-section"><h2>History / activity</h2><PlanHistory events={plan.history} /></section>
    </div></div>
  </section>;
}
