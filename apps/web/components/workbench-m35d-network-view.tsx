'use client';
import { useEffect } from 'react';
type WorkbenchScope = any;
import { renameChangePlan } from '@infratwin/model';
import { ChangePlanPanel } from './change-plan-panel';
import { TopologyCanvas } from './topology-canvas';

function webmcpLabel(status:string){return status==='registered'?'WebMCP connected':status==='checking'?'WebMCP checking':status==='unsupported'?'WebMCP unavailable':'WebMCP error';}

export function WorkbenchM35dNetworkView({scope}:{scope:WorkbenchScope}){
  const { project, plan, collaborationNotice, webmcpStatus, analysisStatus, analyzeCurrentPlan, analysisControllerRef, resilienceStatus, canRunResilience, runPlanN1, directRunControllerRef, optimizerReady, optimizerStatus, runOptimizer, canRunMitigation, mitigationDisabledReason, n1DisabledReason, workflowGuidance, leftPanelCollapsed, setLeftPanelCollapsed, rightPanelCollapsed, setRightPanelCollapsed, trafficEditorOpen, setTrafficEditorOpen, planRef, mutatePlan, runWorkspaceAction, workspaceService, handleDemandBandwidth, handleAddDemand, handleGrowth, acceptProposal, rejectProposal, acceptAll, discardCandidate, verifyCurrentCandidate, candidateStale, analysis, analysisAuthoritative, selectedLinkIds, selectedLinkId, selectedNodeId, selectedDemandId, plannedOutageLinkIds, plannedOutageNodeIds, plannedChangedLinkIds, plannedChangedNodeIds, proposalLinkIds, proposalNodeIds, lockedLinkIds, lockedNodeIds, violationLinkIds, batchPlanOutage, batchLockLinks, activeView, renderInspector } = scope;
  useEffect(()=>{
    let lastBucket='';
    const applyResponsivePanelDefaults=()=>{
      const bucket=window.innerWidth<=760?'mobile':window.innerWidth<=1024?'tablet':'desktop';
      if(bucket===lastBucket)return;
      lastBucket=bucket;
      if(bucket==='mobile'){
        setLeftPanelCollapsed(true);
        setRightPanelCollapsed(true);
      }else if(bucket==='tablet'){
        setRightPanelCollapsed(true);
      }
    };
    applyResponsivePanelDefaults();
    window.addEventListener('resize',applyResponsivePanelDefaults);
    return ()=>window.removeEventListener('resize',applyResponsivePanelDefaults);
  },[setLeftPanelCollapsed,setRightPanelCollapsed]);
  const openPlan=()=>{setLeftPanelCollapsed(false); if(window.innerWidth<=1024)setRightPanelCollapsed(true);};
  const openInspector=()=>{setRightPanelCollapsed(false); if(window.innerWidth<=1024)setLeftPanelCollapsed(true);};
  return <section className="network-view" data-testid="network-view" hidden={activeView !== 'network'}>
    <div className="network-toolbar">
      <div className="toolbar-context" data-testid="network-scale"><h1 title={plan.name}>{plan.name}</h1><span>{plan.changes.length} planned change{plan.changes.length===1?'':'s'} · {plan.restrictions.lockedLinkIds.length+plan.restrictions.lockedNodeIds.length} lock{plan.restrictions.lockedLinkIds.length+plan.restrictions.lockedNodeIds.length===1?'':'s'}</span><span className="network-counts">{project.nodes.length} nodes · {project.links.length} links · {project.demands.length} demands</span></div>
      <div className={`collaboration-indicator ${collaborationNotice ? 'active' : ''}`} data-testid="collaboration-indicator" aria-live="polite"><div><span className={`status-dot ${webmcpStatus}`} aria-hidden="true"/><span>Shared ChangePlan</span><em className={`webmcp-health ${webmcpStatus}`}>{webmcpLabel(webmcpStatus)}</em></div><strong>{collaborationNotice || 'Human and agent share this live browser-local plan'}</strong></div>
      <div className="workflow-actions"><div className="primary-actions">{analysisStatus !== 'running' ? <button data-testid="analyze-plan" className="primary" onClick={() => void analyzeCurrentPlan()}>Analyze</button> : <button data-testid="cancel-analysis" className="danger" onClick={() => analysisControllerRef.current?.abort()}>Cancel analysis</button>}{resilienceStatus !== 'running' ? <button data-testid="run-resilience" disabled={!canRunResilience} title={!canRunResilience?n1DisabledReason:undefined} onClick={() => void runPlanN1()}>Run N-1</button> : <button data-testid="cancel-resilience" className="danger" onClick={() => directRunControllerRef.current?.abort()}>Cancel N-1</button>}<button data-testid="run-optimizer" disabled={!optimizerReady || optimizerStatus === 'running' || !canRunMitigation} title={mitigationDisabledReason || undefined} onClick={() => void runOptimizer()}>Find mitigation</button></div><span className="workflow-guidance" data-testid="workflow-guidance">{workflowGuidance}</span></div>
      <div className="panel-controls"><button data-testid="toggle-left-panel" aria-expanded={!leftPanelCollapsed} aria-controls="change-plan-panel" onClick={() => leftPanelCollapsed?openPlan():setLeftPanelCollapsed(true)}>{leftPanelCollapsed ? 'Show plan' : 'Hide plan'}</button><button data-testid="toggle-right-panel" aria-expanded={!rightPanelCollapsed} aria-controls="object-inspector" onClick={() => rightPanelCollapsed?openInspector():setRightPanelCollapsed(true)}>{rightPanelCollapsed ? 'Show inspector' : 'Hide inspector'}</button></div>
    </div>
    <div className={`network-workspace ${leftPanelCollapsed ? 'left-collapsed' : ''} ${rightPanelCollapsed ? 'right-collapsed' : ''}`}>
      <div className="workspace-pane plan-pane" aria-hidden={leftPanelCollapsed}>
        <ChangePlanPanel project={project} plan={plan} trafficEditorOpen={trafficEditorOpen} onTrafficEditorOpenChange={setTrafficEditorOpen} onRenamePlan={(name) => { if (name.trim() && name.trim() !== planRef.current.name) mutatePlan((current:any) => renameChangePlan(current, name)); }} onRemoveChange={(id) => runWorkspaceAction(() => { workspaceService.removePlanChange(id, 'human'); })} onSetConstraint={(key, value) => runWorkspaceAction(() => { workspaceService.setPlanConstraint(key, value as never, 'human'); })} onSetBandwidth={handleDemandBandwidth} onAddDemand={handleAddDemand} onAddGrowth={handleGrowth} onAcceptProposal={acceptProposal} onRejectProposal={rejectProposal} onAcceptAll={acceptAll} onDiscardCandidate={discardCandidate} onVerifyProposal={() => void verifyCurrentCandidate()} candidateStale={candidateStale} />
      </div>
      <section className="topology-pane" data-testid="topology-pane" aria-label="Network topology workspace">
        <TopologyCanvas project={project} analysis={analysis} analysisAuthoritative={analysisAuthoritative} selectedLinkIds={selectedLinkIds} selectedLinkId={selectedLinkId} selectedNodeId={selectedNodeId} selectedDemandId={selectedDemandId} plannedOutageLinkIds={plannedOutageLinkIds} plannedOutageNodeIds={plannedOutageNodeIds} plannedChangedLinkIds={plannedChangedLinkIds} plannedChangedNodeIds={plannedChangedNodeIds} proposalLinkIds={proposalLinkIds} proposalNodeIds={proposalNodeIds} lockedLinkIds={lockedLinkIds} lockedNodeIds={lockedNodeIds} violationLinkIds={violationLinkIds} onSelectLink={(id) => { workspaceService.select({ kind: 'link', id }); if(window.innerWidth<=1024)openInspector(); }} onSelectNode={(id) => { workspaceService.select({ kind: 'node', id }); if(window.innerWidth<=1024)openInspector(); }} onSelectDemand={(id) => { workspaceService.select({ kind: 'demand', id }); if(window.innerWidth<=1024)openInspector(); }} onBatchPlannedOutage={batchPlanOutage} onBatchLockLinks={batchLockLinks} />
      </section>
      <div className="inspector-slot" aria-hidden={rightPanelCollapsed}>{renderInspector()}</div>
    </div>
  </section>;
  const { project, plan, collaborationNotice, analysisStatus, analyzeCurrentPlan, analysisControllerRef, resilienceStatus, canRunResilience, runPlanN1, directRunControllerRef, optimizerReady, optimizerStatus, runOptimizer, leftPanelCollapsed, setLeftPanelCollapsed, rightPanelCollapsed, setRightPanelCollapsed, trafficEditorOpen, setTrafficEditorOpen, planRef, mutatePlan, runWorkspaceAction, workspaceService, handleDemandBandwidth, handleAddDemand, handleGrowth, acceptProposal, rejectProposal, acceptAll, discardCandidate, verifyCurrentCandidate, candidateStale, analysis, selectedLinkIds, selectedLinkId, selectedNodeId, selectedDemandId, plannedOutageLinkIds, plannedOutageNodeIds, plannedChangedLinkIds, plannedChangedNodeIds, proposalLinkIds, proposalNodeIds, lockedLinkIds, lockedNodeIds, violationLinkIds, batchPlanOutage, batchLockLinks, activeView, renderInspector } = scope;
  return (<section className="network-view" data-testid="network-view" hidden={activeView !== 'network'}>
        <div className="network-toolbar">
          <div className="toolbar-context" data-testid="network-scale"><h1>{project.name}</h1><span>{project.nodes.length} nodes · {project.links.length} links · {project.demands.length} demands</span><span className="toolbar-plan">{plan.name} · {plan.changes.length} change{plan.changes.length === 1 ? '' : 's'} · {plan.restrictions.lockedLinkIds.length + plan.restrictions.lockedNodeIds.length} lock{plan.restrictions.lockedLinkIds.length + plan.restrictions.lockedNodeIds.length === 1 ? '' : 's'}</span></div>
          <div className={`collaboration-indicator ${collaborationNotice ? 'active' : ''}`} data-testid="collaboration-indicator" aria-live="polite"><span>Shared workspace</span>{' '}<strong>{collaborationNotice || 'Human + agent share this ChangePlan'}</strong></div>
          <div className="primary-actions">{analysisStatus !== 'running' ? <button data-testid="analyze-plan" className="primary" onClick={() => void analyzeCurrentPlan()}>Analyze Plan</button> : <button data-testid="cancel-analysis" className="danger" onClick={() => analysisControllerRef.current?.abort()}>Cancel analysis</button>}{resilienceStatus !== 'running' ? <button data-testid="run-resilience" disabled={!canRunResilience} onClick={() => void runPlanN1()}>Run N-1</button> : <button data-testid="cancel-resilience" className="danger" onClick={() => directRunControllerRef.current?.abort()}>Cancel N-1</button>}<button data-testid="run-optimizer" disabled={!optimizerReady || optimizerStatus === 'running'} onClick={() => void runOptimizer()}>Find Mitigation</button></div>
          <div className="panel-controls"><button data-testid="toggle-left-panel" aria-pressed={leftPanelCollapsed} onClick={() => setLeftPanelCollapsed((value:boolean) => !value)}>{leftPanelCollapsed ? 'Show plan' : 'Hide plan'}</button><button data-testid="toggle-right-panel" aria-pressed={rightPanelCollapsed} onClick={() => setRightPanelCollapsed((value:boolean) => !value)}>{rightPanelCollapsed ? 'Show inspector' : 'Hide inspector'}</button></div>
        </div>
        <div className={`network-workspace ${leftPanelCollapsed ? 'left-collapsed' : ''} ${rightPanelCollapsed ? 'right-collapsed' : ''}`}>
          <div className="workspace-pane plan-pane" aria-hidden={leftPanelCollapsed}>
            <ChangePlanPanel project={project} plan={plan} trafficEditorOpen={trafficEditorOpen} onTrafficEditorOpenChange={setTrafficEditorOpen} onRenamePlan={(name) => { if (name.trim() && name.trim() !== planRef.current.name) mutatePlan((current:any) => renameChangePlan(current, name)); }} onRemoveChange={(id) => runWorkspaceAction(() => { workspaceService.removePlanChange(id, 'human'); })} onSetConstraint={(key, value) => runWorkspaceAction(() => { workspaceService.setPlanConstraint(key, value as never, 'human'); })} onSetBandwidth={handleDemandBandwidth} onAddDemand={handleAddDemand} onAddGrowth={handleGrowth} onAcceptProposal={acceptProposal} onRejectProposal={rejectProposal} onAcceptAll={acceptAll} onDiscardCandidate={discardCandidate} onVerifyProposal={() => void verifyCurrentCandidate()} candidateStale={candidateStale} />
          </div>
          <section className="topology-pane" data-testid="topology-pane" aria-label="Network topology workspace">
            <TopologyCanvas project={project} analysis={analysis} selectedLinkIds={selectedLinkIds} selectedLinkId={selectedLinkId} selectedNodeId={selectedNodeId} selectedDemandId={selectedDemandId} plannedOutageLinkIds={plannedOutageLinkIds} plannedOutageNodeIds={plannedOutageNodeIds} plannedChangedLinkIds={plannedChangedLinkIds} plannedChangedNodeIds={plannedChangedNodeIds} proposalLinkIds={proposalLinkIds} proposalNodeIds={proposalNodeIds} lockedLinkIds={lockedLinkIds} lockedNodeIds={lockedNodeIds} violationLinkIds={violationLinkIds} onSelectLink={(id) => workspaceService.select({ kind: 'link', id })} onSelectNode={(id) => workspaceService.select({ kind: 'node', id })} onSelectDemand={(id) => workspaceService.select({ kind: 'demand', id })} onBatchPlannedOutage={batchPlanOutage} onBatchLockLinks={batchLockLinks} />
          </section>
          <div className="inspector-slot" aria-hidden={rightPanelCollapsed}>{renderInspector()}</div>
        </div>
      </section>);
}
