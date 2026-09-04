'use client';

import { useEffect, useRef } from 'react';
import { N1_ENGINE_HARD_CAP } from '../lib/analysis-execution';

function pct(value:number){return `${Math.round(value*10)/10}%`;}
function titleCase(value:string){return value.replaceAll('_',' ').replace(/\b\w/g,(c)=>c.toUpperCase());}
function toolGroup(name:string){
  if(name.startsWith('inspect_')||name.startsWith('focus_'))return 'Inspect';
  if(name.includes('plan')||name.includes('change')||name.includes('constraint'))return 'Plan';
  if(name.includes('analy')||name.includes('conting')||name.includes('bottleneck')||name.includes('cut'))return 'Analyze';
  if(name.includes('mitig')||name.includes('optim')||name.includes('propos'))return 'Mitigate';
  if(name.includes('verify'))return 'Verify';
  return 'Other';
}
function humanActivity(event:any){
  if(event.summary && !/[{}\[\]]/.test(event.summary) && event.summary.length<150)return event.summary;
  return `${titleCase(event.tool)} ${event.status}`;
}

export function WorkbenchM35dAdvancedView({scope}:{scope:any}){
  const { advancedOpen, setAdvancedOpen, currentProjectHash, currentPlanHash, analysisFresh, publishedPlanAnalysis, executionProfile, compute, lastAnalysisRuntimeMs, lastAnalysisExecution, contingencies, n1Fresh, eligibleN1, routingLpEstimate, optimizerStatus, optimizerMessage, capacityMilpEstimate, optimizerResult, candidateVerification, verificationFresh, runRoutingOptimizer, routingOptimization, webmcpStatus, registeredTools, lastToolAnalysis, activity } = scope;
  const closeRef=useRef<HTMLButtonElement>(null);
  const previousFocusRef=useRef<HTMLElement | null>(null);
  useEffect(()=>{
    if(!advancedOpen)return;
    previousFocusRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    closeRef.current?.focus();
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setAdvancedOpen(false);}};
    window.addEventListener('keydown',onKey);
    return()=>{window.removeEventListener('keydown',onKey);previousFocusRef.current?.focus();previousFocusRef.current=null;};
  },[advancedOpen,setAdvancedOpen]);
  const groups=['Inspect','Plan','Analyze','Mitigate','Verify','Other'].map(label=>({label,tools:registeredTools.filter((name:string)=>toolGroup(name)===label)})).filter(group=>group.tools.length);
  const optimizerClass=optimizerStatus==='error'?'error':optimizerStatus==='running'||optimizerStatus==='loading'?'running':optimizerStatus==='ready'?'ready':'complete';
  return <aside id="advanced-drawer" className={`advanced-drawer ${advancedOpen ? 'open' : ''}`} data-testid="advanced-drawer" aria-hidden={!advancedOpen} aria-label="Advanced diagnostics">
    <header><div><span className="section-kicker">Advanced</span><h2>Diagnostics and provenance</h2><p>Technical detail behind the decision-facing workspace.</p></div><button ref={closeRef} className="icon-button" aria-label="Close advanced details" title="Close" onClick={() => setAdvancedOpen(false)}>×</button></header>
    <div className="advanced-scroll">
      <section><h3>Provenance</h3><dl className="advanced-list"><div><dt>Base model hash</dt><dd data-testid="base-model-hash" className="mono">{currentProjectHash}</dd></div><div><dt>ChangePlan hash</dt><dd data-testid="plan-hash" className="mono">{currentPlanHash}</dd></div><div><dt>Current-plan evidence</dt><dd>{analysisFresh ? 'Current' : publishedPlanAnalysis ? 'Stale after workspace change' : 'Not published'}</dd></div></dl></section>
      <section data-testid="compute-profile"><h3>Compute profile</h3><p>{executionProfile.mode === 'worker' ? 'Worker preferred for this workload.' : 'Main-thread fast path for this workload.'}</p><dl className="advanced-list"><div><dt>Execution</dt><dd>{executionProfile.mode}</dd></div><div><dt>Estimated work</dt><dd>{executionProfile.estimatedWorkUnits.toLocaleString()}</dd></div><div><dt>Workers</dt><dd>{compute.workerSupported ? `${compute.recommendedWorkerCount} recommended` : 'Unsupported'}</dd></div><div><dt>SharedArrayBuffer</dt><dd>{compute.sharedArrayBufferSupported ? 'Available' : 'Unavailable'}</dd></div><div><dt>Last analysis</dt><dd>{lastAnalysisRuntimeMs === null ? 'Not run' : `${lastAnalysisExecution} · ${lastAnalysisRuntimeMs} ms live`}</dd></div><div><dt>N-1 coverage</dt><dd>{contingencies && n1Fresh ? `${contingencies.completedScenarios}/${contingencies.totalEligibleScenarios} ${contingencies.status}` : `${eligibleN1} eligible link failures`}</dd></div><div><dt>Routing LP</dt><dd>{routingLpEstimate.recommended ? 'Within interactive envelope' : 'Outside interactive envelope'}</dd></div></dl></section>
      <section><h3>Optimizer diagnostics</h3><div data-testid="optimizer-status" className={`compute-card ${optimizerClass}`}><strong>{titleCase(optimizerStatus)} · HiGHS WASM</strong><p>{optimizerMessage}</p>{(optimizerStatus==='running'||optimizerStatus==='loading')&&<span className="indeterminate-progress" aria-hidden="true"/>}</div><p>Capacity MILP: {capacityMilpEstimate.reason}</p>{optimizerResult && <div data-testid="capacity-optimizer-result"><strong>{optimizerResult.diagnostics.status} · {optimizerResult.diagnostics.proof}</strong><p>{optimizerResult.selectedUpgrades.length} upgrade{optimizerResult.selectedUpgrades.length===1?'':'s'} · objective {optimizerResult.diagnostics.objectiveValue ?? 'n/a'}</p></div>}{candidateVerification && <div data-testid="candidate-verification"><strong>{verificationFresh ? candidateVerification.status.toUpperCase() : 'STALE'}</strong><p>{verificationFresh ? candidateVerification.violations.join(' ') || `Verified declared cost ${candidateVerification.calculatedCost}` : 'Plan or proposal revision changed after verification.'}</p></div>}<button data-testid="routing-lp-action" disabled={!routingLpEstimate.recommended} title={!routingLpEstimate.recommended?routingLpEstimate.reason:undefined} onClick={() => void runRoutingOptimizer()}>Solve diagnostic routing LP</button><p data-testid="routing-lp-guidance">{routingLpEstimate.reason}</p>{routingOptimization && <div data-testid="routing-lp-result"><strong>{routingOptimization.diagnostics.status}</strong><p>Minimum max utilization {routingOptimization.maxUtilizationPct === null ? 'n/a' : pct(routingOptimization.maxUtilizationPct)}</p></div>}</section>
      <section data-testid="advanced-inspector"><div className="section-heading-row"><div><h3>WebMCP diagnostics</h3><p>Status: <strong>{webmcpStatus}</strong> · {registeredTools.length} registered capabilities</p></div><span className={`integration-status ${webmcpStatus}`}>{webmcpStatus==='registered'?'Connected':webmcpStatus==='unsupported'?'Unavailable':titleCase(webmcpStatus)}</span></div>{webmcpStatus === 'unsupported' && <p>Native WebMCP is not available in this browser. Deterministic planning remains fully usable.</p>}<div className="tool-groups">{groups.map(group=><div key={group.label}><strong>{group.label}</strong><div className="tool-badges">{group.tools.map((name:string) => <span key={name}>{name}</span>)}</div></div>)}</div>{lastToolAnalysis && <p>Latest tool-published analysis: {lastToolAnalysis}</p>}<h4>Tool activity</h4><div className="activity-list">{activity.length === 0 ? <p className="muted">No WebMCP activity recorded.</p> : activity.map((event:any) => <div key={event.id} className="activity-row"><time>{event.startedAt.slice(11, 19)}</time><span className="mono-inline">{event.tool}</span><strong className={`activity-${event.status}`}>{titleCase(event.status)}</strong><small>{humanActivity(event)} · {event.durationMs} ms</small></div>)}</div></section>
      <section><h3>Scale guards</h3><dl className="advanced-list"><div><dt>N-1 eligible</dt><dd>{eligibleN1} · engine cap {N1_ENGINE_HARD_CAP}</dd></div><div><dt>Routing LP</dt><dd>{routingLpEstimate.flowVariables.toLocaleString()} flow variables</dd></div><div><dt>Capacity MILP</dt><dd>{capacityMilpEstimate.decisionScenarioProduct.toLocaleString()} decision×scenario</dd></div></dl></section>
    </div>
  </aside>;
}
