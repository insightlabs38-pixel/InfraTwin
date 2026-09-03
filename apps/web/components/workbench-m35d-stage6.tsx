'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CandidatePlan, ChangePlan, NetworkProject, PlanChange, PlanEvidenceStamp, PlanRevisionStamp, ScenarioPatch } from '@infratwin/model';
import {
  acceptAllCandidateChanges,
  acceptCandidateChange,
  addPlanChange,
  changePlanHash,
  changePlanEvidenceStamp,
  changePlanRevisionStamp,
  cloneProject,
  compileChangePlanToScenarioPatch,
  createChangePlan,
  discardCandidateProposals,
  isPlanEvidenceFresh,
  isPlanRevisionFresh,
  modelHash,
  rejectCandidateChange,
  removePlanChange,
  renameChangePlan,
  setCandidateProposals,
  setChangePlanStatus,
  setPlanConstraint,
  setPlanLinkLocked,
  setPlanNodeLocked,
} from '@infratwin/model';
import {
  analyzeBottleneck,
  analyzeChangePlan,
  compareCandidate,
  detectComputeCapabilities,
  proposeCapacityMitigation,
  runLinkContingenciesAsync,
  runScenarioCapacityAnalysis,
  type BottleneckAnalysis,
  type CandidateComparison,
  type ChangePlanAnalysis,
  type ComputeCapabilities,
  type ContingencyAnalysis,
  type ContingencyProgress,
  type ContingencyRunOptions,
  type ContingencyWorkerLike,
  type EvidenceRef,
  type CapacityAnalysis,
} from '@infratwin/evidence';
import { getScenarioDefinition, listBundledScenarios, loadScenario, type BundledScenarioId, type ScenarioDefinition } from '@infratwin/scenarios';
import { estimateCapacityMILP, estimateTrafficAllocationLP } from '@infratwin/optimizer';
import type { CapacityOptimizationResult, CapacityPlanRequirements, CandidateVerification, TrafficAllocationResult } from '@infratwin/optimizer';
import { CollaborativeWorkspaceService, type PublishedVerification, type WorkspaceActivityEvent, type WorkspaceSelection } from '../../../packages/application/src/index.ts';
import { optimizeCapacityInBrowser, optimizeRoutingInBrowser, probeBrowserOptimizer, verifyCandidateInBrowser } from '../lib/optimizer-client';
import { analyzeChangePlanInBrowserWorker } from '../lib/analysis-client';
import { analysisExecutionProfile, createAnalysisAuthorityToken, isAnalysisAuthorityTokenCurrent, n1ExecutionPolicy, N1_ENGINE_HARD_CAP, type CapacityExecutionMode } from '../lib/analysis-execution';
import { APP_DESTINATIONS, ANALYSIS_TABS, semanticStateFingerprint, type AppDestination, type AnalysisTab } from '../lib/application-shell';
import { ChangePlanPanel } from './change-plan-panel';
import { PlanHistory } from './plan-history';
import { UpgradeProfileEditor } from './upgrade-profile-editor';
import { ScenarioSelector } from './scenario-selector';
import { TopologyCanvas } from './topology-canvas';
import { ImportNetworkDialog } from './import-network-dialog';
import { applyUpgradeProfile } from '../lib/upgrade-catalog';
import {
  registerCollaborativeTools,
  type ModelContextLike,
  type ToolActivityEvent,
  type WebMCPRegistration,
} from '@infratwin/webmcp';

function pct(value: number): string { return `${Math.round(value * 10) / 10}%`; }
function gbps(value: number): string { return `${Math.round(value * 100) / 100} Gbps`; }
function shortHash(value: string): string { return value.includes(':') ? value.split(':')[1].slice(0, 8) : value.slice(0, 8); }
function clonePlan(plan: ChangePlan): ChangePlan { return JSON.parse(JSON.stringify(plan)) as ChangePlan; }
function allRouteLinks(route: CapacityAnalysis['routing']['routes'][number] | undefined): string[] { return route ? Object.keys(route.linkFractions).filter((linkId) => route.linkFractions[linkId] > 0).sort() : []; }
function createBrowserWorker(): ContingencyWorkerLike { return new Worker(new URL('../workers/contingency.worker.ts', import.meta.url), { type: 'module' }) as unknown as ContingencyWorkerLike; }

function pendingCapacityAnalysis(project: NetworkProject): CapacityAnalysis {
  const linkLoadsGbps = Object.fromEntries(project.links.map((link) => [link.id, 0])) as Record<string, number>;
  const linkUtilizationPct = Object.fromEntries(project.links.map((link) => [link.id, 0])) as Record<string, number>;
  return {
    snapshot: project,
    routing: { mode: project.routingProfile.mode, routes: [], linkLoadsGbps, linkUtilizationPct, peakUtilizationPct: 0, unroutedDemandIds: [] },
    result: { id: `pending:${project.id}`, type: 'capacity', verdict: 'CANCELLED', modelHash: '', scenarioHash: 'pending', solver: { id: 'not-run', version: '3.5c' }, assumptions: [], metrics: { pending: true }, violations: [], witnesses: [], runtimeMs: 0 },
  };
}

const VIOLATION_RENDER_BATCH_SIZE = 200;
const networkTemplates = listBundledScenarios();
type SelectedScenarioId = BundledScenarioId | 'imported';
const initialCompute: ComputeCapabilities = { workerSupported: false, hardwareConcurrency: 1, recommendedWorkerCount: 1, sharedArrayBufferSupported: false, crossOriginIsolated: false, executionMode: 'async-fallback' };
const initialProject = loadScenario('continental-service-network');

export function useWorkbenchStage6(scope: any) {
  const { selectedScenarioId, setSelectedScenarioId, project, setProject, plan, setPlan, ephemeralPatch, setEphemeralPatch, publishedPlanAnalysis, setPublishedPlanAnalysis, candidate, setCandidate, comparison, setComparison, contingencies, setContingencies, contingencyStamp, setContingencyStamp, bottleneck, setBottleneck, selectedEvidence, setSelectedEvidence, selectedLinkId, setSelectedLinkId, selectedNodeId, setSelectedNodeId, activity, setActivity, webmcpStatus, setWebmcpStatus, registeredTools, setRegisteredTools, importMessage, setImportMessage, lastToolAnalysis, setLastToolAnalysis, compute, setCompute, progress, setProgress, resilienceStatus, setResilienceStatus, resilienceMessage, setResilienceMessage, analysisStatus, setAnalysisStatus, analysisMessage, setAnalysisMessage, lastAnalysisRuntimeMs, setLastAnalysisRuntimeMs, lastAnalysisExecution, setLastAnalysisExecution, optimizerStatus, setOptimizerStatus, optimizerMessage, setOptimizerMessage, optimizerResult, setOptimizerResult, routingOptimization, setRoutingOptimization, candidateVerification, setCandidateVerification, candidateVerificationStamp, setCandidateVerificationStamp, sharedVerification, setSharedVerification, designState, setDesignState, collaborationNotice, setCollaborationNotice, importDialogOpen, setImportDialogOpen, activeView, setActiveView, analysisTab, setAnalysisTab, leftPanelCollapsed, setLeftPanelCollapsed, rightPanelCollapsed, setRightPanelCollapsed, advancedOpen, setAdvancedOpen, trafficEditorOpen, setTrafficEditorOpen, settingsLinkId, setSettingsLinkId, newPlanName, setNewPlanName, inspectorCapacityDraft, setInspectorCapacityDraft, violationDisplay, setViolationDisplay, directRunControllerRef, analysisControllerRef, optimizerControllerRef, webmcpRegistrationRef, analysisEpochRef, planCounterRef, changeCounterRef, demandCounterRef, projectRef, planRef, ephemeralRef, candidateRef, contingencyRef, contingencyStampRef, analysisRef, verificationRef, designStateRef, destinationRef, selectedLinkRef, selectedNodeRef, selectedEvidenceRef, definition, compiledPlanPatch, solverPatch, executionProfile, semanticFingerprint, currentProjectHash, currentPlanHash, analysisFresh, syncLivePlanAnalysis, displayedPlanAnalysis, pendingAnalysis, analysis, analysisAuthoritative, snapshot, routeByDemand, selectedCanonicalLink, selectedCanonicalNode, selectedDemandId, selectedCanonicalDemand, n1Fresh, verificationFresh, pendingProposals, candidateStale, plannedOutageLinkIds, plannedOutageNodeIds, plannedChangedLinkIds, plannedChangedNodeIds, proposalLinkIds, proposalNodeIds, lockedLinkIds, lockedNodeIds, violationLinkIds, visibleViolationCount, visibleViolations, selectedLinkIds, cancelAsync, commitPlan, mutatePlan, setStatusOnly, clearAllDerived, replaceBaseProject, publishCandidate, executeContingencies, workspaceService, runWorkspaceAction, removeMatchingChanges, handleLinkAvailability, handleNodeAvailability, handleLinkCapacity, handleDemandBandwidth, handleAddDemand, handleGrowth, batchPlanOutage, batchLockLinks, editUpgradeCatalog, loadNetworkTemplate, loadPlanTemplate, newPlan, clearPlan, analyzeCurrentPlan, runPlanN1, replayContingency, inspectCurrentBottleneck, optimizerRequirements, runOptimizer, quickMitigation, verifyCurrentCandidate, runRoutingOptimizer, acceptProposal, rejectProposal, acceptAll, discardCandidate, exportProject, openImportedProject, selectViolation, authority, peak, primaryFailure, progressLabel, regionCount, n1Policy, eligibleN1, routingLpEstimate, capacityMilpEstimate, n1Guidance, selectedSnapshotLink, selectedRoute, settingsLink, currentDesignState, selectedDesignVariant, selectedDesignAllocations, selectedDesignRoutes, canCompareDesignVariants, analysisStatusLabel } = scope;
  const renderPlanResultSummary = () => (
    <section data-testid="plan-analysis-status" className={`plan-result-summary result-${authority.toLowerCase()}`} aria-label="Current plan result">
      <div data-testid="evidence-panel" className="result-evidence">
        <div><span className="section-kicker">{ephemeralPatch ? 'Counterexample replay' : 'Plan result'}</span>{' '}<strong data-testid="verdict">{ephemeralPatch ? analysis.result.verdict : authority}</strong></div>
        <p>{ephemeralPatch ? `${ephemeralPatch.name} · ${analysis.result.violations.length} modeled violation${analysis.result.violations.length === 1 ? '' : 's'}.` : analysisStatusLabel}</p>
        {ephemeralPatch && analysis.result.violations.length > 0 && <small>Replay issues: {analysis.result.violations.slice(0, 8).map((item:any) => item.linkId ?? item.demandId ?? item.message).filter(Boolean).join(', ')}</small>}
        {!ephemeralPatch && authority === 'FAIL' && primaryFailure && <small>Primary issue: {primaryFailure}</small>}
      </div>
      {selectedDesignVariant && <div className="evidence-block" data-testid="network-design-summary"><strong>{selectedDesignVariant.label} · cost {selectedDesignVariant.totalCost} · peak {pct(selectedDesignVariant.peakUtilizationPct)} · {selectedDesignVariant.verification.status}</strong><small>{selectedDesignVariant.selectedUpgrades.map((item:any) => `${item.linkId}→${item.toCapacityGbps}`).join(', ') || 'routing-only'}{selectedDesignVariant.selectedNewLinks.length ? ` · new ${selectedDesignVariant.selectedNewLinks.map((item:any) => item.id).join(', ')}` : ''}</small></div>}
      {analysisStatus !== 'idle' && <small data-testid="capacity-analysis-status">Analysis {analysisStatus} · {lastAnalysisExecution ?? executionProfile.mode}{lastAnalysisRuntimeMs === null ? '' : ` · ${lastAnalysisRuntimeMs} ms measured on this browser run`}</small>}
      {resilienceStatus !== 'idle' && <small data-testid="resilience-status">N-1 {resilienceStatus} · {progressLabel} · {resilienceMessage}</small>}
      {contingencies && n1Fresh && <small data-testid="resilience-evidence">{contingencies.completedScenarios}/{contingencies.totalEligibleScenarios} failures tested · {contingencies.status.toUpperCase()} · {contingencies.result.metrics.failingScenarios} failing</small>}
      <button type="button" className="text-action" onClick={() => { setActiveView('analysis'); setAnalysisTab('summary'); }}>Inspect analysis</button>
    </section>
  );
  const renderInspector = () => (
    <aside className="workspace-pane inspector-pane" data-testid="object-inspector" aria-label="Inspector">
      {renderPlanResultSummary()}
      <div className="inspector-header"><span className="section-kicker">Inspector</span><button type="button" className="icon-button" aria-label="Collapse inspector" onClick={() => setRightPanelCollapsed(true)}>×</button></div>
      {!selectedCanonicalLink && !selectedCanonicalNode && !selectedCanonicalDemand && <section className="inspector-section" data-testid="network-inspector-empty"><h3>{project.name}</h3><dl className="compact-metrics"><div><dt>Nodes</dt><dd>{project.nodes.length}</dd></div><div><dt>Links</dt><dd>{project.links.length}</dd></div><div><dt>Demands</dt><dd>{project.demands.length}</dd></div><div><dt>Regions</dt><dd>{regionCount}</dd></div></dl><p className="muted compact-copy">Select a link, node, or demand in the topology to inspect and edit relevant plan state.</p></section>}
      {selectedCanonicalLink && <section className="inspector-section" data-testid={`link-inspector-${selectedCanonicalLink.id}`}><div className="inspector-title"><div><span>Link</span><h3>{selectedCanonicalLink.id}</h3></div><strong className="mono">{selectedCanonicalLink.id}</strong></div><dl className="compact-metrics"><div><dt>Endpoints</dt><dd>{selectedCanonicalLink.source} ↔ {selectedCanonicalLink.target}</dd></div><div><dt>Capacity</dt><dd>{gbps(selectedSnapshotLink?.capacityGbps ?? selectedCanonicalLink.capacityGbps)}</dd></div><div><dt>Load</dt><dd>{gbps(analysis.routing.linkLoadsGbps[selectedCanonicalLink.id] ?? 0)}</dd></div><div><dt>Utilization</dt><dd>{pct(analysis.routing.linkUtilizationPct[selectedCanonicalLink.id] ?? 0)}</dd></div><div><dt>Availability</dt><dd>{selectedSnapshotLink?.available === false ? 'Unavailable' : 'Available'}</dd></div><div><dt>Plan state</dt><dd>{plannedOutageLinkIds.has(selectedCanonicalLink.id) ? 'Planned outage' : plannedChangedLinkIds.has(selectedCanonicalLink.id) ? 'Modified' : 'Unchanged'}</dd></div></dl><div className="inspector-actions"><button type="button" data-testid={`plan-link-outage-${selectedCanonicalLink.id}`} onClick={() => handleLinkAvailability(selectedCanonicalLink.id, plannedOutageLinkIds.has(selectedCanonicalLink.id))}>{plannedOutageLinkIds.has(selectedCanonicalLink.id) ? 'Remove planned outage' : 'Add outage'}</button><label className="check-action"><input type="checkbox" data-testid={`lock-link-${selectedCanonicalLink.id}`} checked={lockedLinkIds.has(selectedCanonicalLink.id)} onChange={(event) => runWorkspaceAction(() => { workspaceService.setPlanRestriction('link', selectedCanonicalLink.id, event.target.checked, 'human'); })} />Lock link</label><label className="check-action"><input type="checkbox" data-testid={`avoid-link-${selectedCanonicalLink.id}`} checked={(plan.restrictions.forbiddenRoutingLinkIds ?? []).includes(selectedCanonicalLink.id)} onChange={(event) => runWorkspaceAction(() => { workspaceService.setRoutingRestriction('link', selectedCanonicalLink.id, event.target.checked, 'human'); })} />Avoid in proposed routing</label></div><div className="inline-edit"><label>Planned capacity (Gbps)<input data-testid="link-capacity-input" type="number" min="0.1" step="1" value={inspectorCapacityDraft ?? ''} onChange={(event) => setInspectorCapacityDraft(event.target.value === '' ? null : Number(event.target.value))} /></label><button type="button" data-testid={`plan-link-capacity-${selectedCanonicalLink.id}`} disabled={inspectorCapacityDraft === null} onClick={() => inspectorCapacityDraft !== null && handleLinkCapacity(selectedCanonicalLink.id, inspectorCapacityDraft)}>Apply</button></div><button type="button" className="text-action" onClick={() => { setSettingsLinkId(selectedCanonicalLink.id); setActiveView('settings'); }}>Edit upgrade catalog</button></section>}
      {selectedCanonicalNode && <section className="inspector-section" data-testid={`node-inspector-${selectedCanonicalNode.id}`}><div className="inspector-title"><div><span>Node</span><h3>{selectedCanonicalNode.name ?? selectedCanonicalNode.id}</h3></div><strong className="mono">{selectedCanonicalNode.id}</strong></div><dl className="compact-metrics"><div><dt>Region</dt><dd>{selectedCanonicalNode.region ?? 'Unassigned'}</dd></div><div><dt>Type</dt><dd>{selectedCanonicalNode.type ?? 'node'}</dd></div><div><dt>Availability</dt><dd>{selectedCanonicalNode.available === false || plannedOutageNodeIds.has(selectedCanonicalNode.id) ? 'Unavailable in plan' : 'Available'}</dd></div><div><dt>Plan state</dt><dd>{plannedChangedNodeIds.has(selectedCanonicalNode.id) ? 'Modified' : 'Unchanged'}</dd></div></dl><div className="inspector-actions"><button type="button" data-testid={`plan-node-outage-${selectedCanonicalNode.id}`} onClick={() => handleNodeAvailability(selectedCanonicalNode.id, plannedOutageNodeIds.has(selectedCanonicalNode.id))}>{plannedOutageNodeIds.has(selectedCanonicalNode.id) ? 'Remove planned outage' : 'Add outage'}</button><label className="check-action"><input type="checkbox" data-testid={`lock-node-${selectedCanonicalNode.id}`} checked={lockedNodeIds.has(selectedCanonicalNode.id)} onChange={(event) => runWorkspaceAction(() => { workspaceService.setPlanRestriction('node', selectedCanonicalNode.id, event.target.checked, 'human'); })} />Lock node</label><label className="check-action"><input type="checkbox" data-testid={`avoid-node-${selectedCanonicalNode.id}`} checked={(plan.restrictions.forbiddenRoutingNodeIds ?? []).includes(selectedCanonicalNode.id)} onChange={(event) => runWorkspaceAction(() => { workspaceService.setRoutingRestriction('node', selectedCanonicalNode.id, event.target.checked, 'human'); })} />Avoid in proposed routing</label></div></section>}
      {selectedCanonicalDemand && <section className="inspector-section" data-testid={`demand-inspector-${selectedCanonicalDemand.id}`}><div className="inspector-title"><div><span>Demand</span><h3>{selectedCanonicalDemand.name ?? selectedCanonicalDemand.id}</h3></div><strong className="mono">{selectedCanonicalDemand.id}</strong></div><dl className="compact-metrics"><div><dt>Path</dt><dd>{selectedCanonicalDemand.source} → {selectedCanonicalDemand.target}</dd></div><div><dt>Bandwidth</dt><dd>{gbps(selectedCanonicalDemand.bandwidthGbps)}</dd></div><div><dt>Service class</dt><dd>{selectedCanonicalDemand.serviceClassId}</dd></div><div><dt>Default route</dt><dd>{selectedRoute?.reachable ? `${selectedRoute.equalCostPathCountExact} equal-cost path(s) · ${allRouteLinks(selectedRoute).join(' / ') || 'local'}` : 'Unreachable / not analyzed'}</dd></div></dl>{selectedDesignVariant && <div className="design-route-comparison" data-testid="selected-demand-design-routes"><span className="mini-label">Proposed · {selectedDesignVariant.label}</span>{selectedDesignRoutes.length ? selectedDesignRoutes.map((row:any) => <div key={row.pathId} className="compact-copy"><strong>{Math.round(row.fraction * 1000) / 10}%</strong> {row.linkIds.join(' → ') || 'local'}</div>) : <p className="muted compact-copy">No baseline optimized allocation for this demand.</p>}</div>}<button type="button" className="primary wide" data-testid="edit-demand-plan" onClick={() => { setTrafficEditorOpen(true); setLeftPanelCollapsed(false); }}>Edit traffic plan</button></section>}
      {ephemeralPatch && <section className="inspector-section counterexample-state"><span className="section-kicker">Counterexample replay</span><strong>{ephemeralPatch.name}</strong><button data-testid="return-to-plan" onClick={() => { ephemeralRef.current = null; setEphemeralPatch(null); }}>Return to planned state</button></section>}
    </aside>
  );
  const analysisTabs: { id: AnalysisTab; label: string }[] = ANALYSIS_TABS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) }));
  Object.assign(scope, { renderPlanResultSummary, renderInspector, analysisTabs });
}
