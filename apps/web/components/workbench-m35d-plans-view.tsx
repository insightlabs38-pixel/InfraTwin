'use client';

import { PlanHistory } from './plan-history';

function countLabel(count:number,singular:string,plural=`${singular}s`){return count===0?`No ${plural}`:`${count} ${count===1?singular:plural}`;}
function variantSignature(variant:any){
  return JSON.stringify({
    cost:variant.totalCost,
    peak:Math.round(variant.peakUtilizationPct*1e6)/1e6,
    upgrades:variant.selectedUpgrades.map((x:any)=>[x.linkId,x.toCapacityGbps,x.cost]),
    newLinks:variant.selectedNewLinks.map((x:any)=>[x.id,x.source,x.target,x.capacityGbps,x.cost]),
    routing:variant.evidence.routingAllocationSummary,
    scenarios:[variant.scenarioPassCount,variant.scenarioCount],
  });
}

export function WorkbenchM35dPlansView({scope}:{scope:any}){
  const { activeView, plan, newPlanName, setNewPlanName, newPlan, clearPlan, definition, loadPlanTemplate, currentDesignState, selectedDesignVariant, canCompareDesignVariants, compareDesignVariants, selectDesignVariant, optimizerStatus, exportPlan, exportWorkspace } = scope;
  if(activeView !== 'plans') return null;
  const seen=new Set<string>();
  const variants=(currentDesignState?.variants??[]).filter((variant:any)=>{const signature=variantSignature(variant);if(seen.has(signature))return false;seen.add(signature);return true;});
  const compareDisabled=!canCompareDesignVariants||optimizerStatus==='running';
  return <section className="destination-view plans-view" data-testid="plans-view">
    <header className="destination-heading"><div><span className="section-kicker">Plans</span><h1>ChangePlan workspace</h1><p>Review the live browser-local plan, compare verified alternatives, and preserve the artifact without mutating the base network.</p></div><div className="heading-actions"><button onClick={exportPlan}>Export ChangePlan</button><button className="primary" onClick={exportWorkspace}>Export workspace</button></div></header>
    <div className="destination-scroll"><div className="plans-grid">
      <section className="plain-section"><div className="section-heading-row"><div><h2>Current plan</h2><p>Human and agent changes share this one live artifact.</p></div><span className={`state-chip ${plan.status==='draft'?'neutral':plan.status.toLowerCase()}`}>{plan.status[0].toUpperCase()+plan.status.slice(1)}</span></div><dl className="compact-metrics"><div><dt>Name</dt><dd>{plan.name}</dd></div><div><dt>Changes</dt><dd>{plan.changes.length}</dd></div><div><dt>Locks</dt><dd>{plan.restrictions.lockedLinkIds.length + plan.restrictions.lockedNodeIds.length}</dd></div><div><dt>Proposals</dt><dd>{plan.proposals.length}</dd></div></dl><div className="new-plan-row"><label><span>Plan name</span><input aria-label="New plan name" placeholder="New ChangePlan" value={newPlanName} onChange={(event) => setNewPlanName(event.target.value)} /></label><button data-testid="new-plan" onClick={() => newPlan(newPlanName.trim() || 'Change Plan')}>New plan</button><button className="danger-ghost" data-testid="clear-plan" onClick={clearPlan}>Clear plan</button></div></section>

      <section className="plain-section" data-testid="design-variants-section">
        <div className="section-heading-row"><div><h2>Verified alternatives</h2><p>Verified alternatives trading declared design cost against peak utilization.</p></div><button data-testid="compare-design-variants" disabled={compareDisabled} title={compareDisabled ? (optimizerStatus==='running'?'Alternative generation is already running':'Analyze a failing plan with adaptive routing enabled first') : undefined} onClick={() => void compareDesignVariants()}>{optimizerStatus==='running'?'Comparing…':'Compare alternatives'}</button></div>
        {optimizerStatus==='running'&&<div className="progress-card running"><strong>Generating adaptive alternatives</strong><span className="indeterminate-progress" aria-hidden="true"/><p>Preparing routes, building the optimization model, solving, and reconstructing verification.</p></div>}
        {!variants.length ? <p className="muted">No verified adaptive alternatives yet. Analyze a failing plan, then compare alternatives.</p> : <div className="variant-table" data-testid="design-variant-table">
          <div className="variant-row variant-header"><span>Alternative</span><span>Cost</span><span>Peak</span><span>Design changes</span><span>State</span></div>
          {variants.map((variant:any) => {const routingCount=variant.evidence.routingAllocationSummary.length;return <button type="button" key={variant.id} data-testid={`design-variant-${variant.id}`} className={`variant-row ${selectedDesignVariant?.id === variant.id ? 'selected' : ''}`} onClick={() => selectDesignVariant(variant.id)}>
            <span><strong>{variant.label}</strong><small>{variant.scenarioPassCount}/{variant.scenarioCount} scenarios pass</small></span><span>{variant.totalCost}</span><span>{Math.round(variant.peakUtilizationPct * 10) / 10}%</span><span>{countLabel(variant.selectedUpgrades.length,'upgrade')} · {countLabel(variant.selectedNewLinks.length,'new link')} · {countLabel(routingCount,'routing change')}</span><span><span className={`state-chip ${variant.verification.status==='verified'?'verified':'warning'}`}>{variant.verification.status==='verified'?'Verified':'Needs review'}</span><small>Not applied</small></span>
          </button>})}
        </div>}
        {selectedDesignVariant&&<div className="proposal-boundary"><strong>Human approval boundary</strong><p>The selected design is verified evidence, not an applied network change. Accepting proposal commands changes only the browser-local ChangePlan.</p></div>}
      </section>

      <section className="plain-section"><h2>Example plan</h2>{definition.changePlanTemplate ? <><p>{definition.title} includes a prepared ChangePlan for this network. Loading it replaces the current plan after confirmation when work exists.</p><button data-testid="load-plan-template" onClick={loadPlanTemplate}>Load example plan</button></> : <p className="muted">This network does not include a prepared plan template.</p>}</section>
      <section className="plain-section plan-history-section"><h2>Activity</h2><PlanHistory events={plan.history} /></section>
    </div></div>
  </section>;
}
