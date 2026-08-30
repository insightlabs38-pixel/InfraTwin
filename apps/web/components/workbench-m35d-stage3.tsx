'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CandidatePlan, ChangePlan, NetworkProject, PlanChange, PlanEvidenceStamp, PlanRevisionStamp, ScenarioPatch } from '@infratwin/model';
import { acceptAllCandidateChanges, acceptCandidateChange, addPlanChange, changePlanHash, changePlanEvidenceStamp, changePlanRevisionStamp, cloneProject, compileChangePlanToScenarioPatch, createChangePlan, discardCandidateProposals, isPlanEvidenceFresh, isPlanRevisionFresh, modelHash, rejectCandidateChange, removePlanChange, renameChangePlan, setCandidateProposals, setChangePlanStatus, setPlanConstraint, setPlanLinkLocked, setPlanNodeLocked } from '@infratwin/model';
import { analyzeBottleneck, analyzeChangePlan, compareCandidate, detectComputeCapabilities, proposeCapacityMitigation, runLinkContingenciesAsync, runScenarioCapacityAnalysis, type BottleneckAnalysis, type CandidateComparison, type ChangePlanAnalysis, type ComputeCapabilities, type ContingencyAnalysis, type ContingencyProgress, type ContingencyRunOptions, type ContingencyWorkerLike, type EvidenceRef, type CapacityAnalysis } from '@infratwin/evidence';
import { getScenarioDefinition, listBundledScenarios, loadScenario, type BundledScenarioId, type ScenarioDefinition } from '@infratwin/scenarios';
import { estimateCapacityMILP, estimateTrafficAllocationLP } from '@infratwin/optimizer';
import type { CapacityOptimizationResult, CapacityPlanRequirements, CandidateVerification, TrafficAllocationResult } from '@infratwin/optimizer';
import { CollaborativeWorkspaceService, type PublishedVerification, type WorkspaceActivityEvent, type WorkspaceSelection } from '../../../packages/application/src/index.ts';
import { optimizeAdaptiveDesignInBrowser, optimizeCapacityInBrowser, optimizeDesignParetoInBrowser, optimizeRoutingInBrowser, probeBrowserOptimizer, verifyCandidateInBrowser } from '../lib/optimizer-client';
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
import { registerCollaborativeTools, type ModelContextLike, type ToolActivityEvent, type WebMCPRegistration } from '@infratwin/webmcp';

function pct(value: number): string { return `${Math.round(value * 10) / 10}%`; }
function gbps(value: number): string { return `${Math.round(value * 100) / 100} Gbps`; }
function shortHash(value: string): string { return value.includes(':') ? value.split(':')[1].slice(0, 8) : value.slice(0, 8); }
function clonePlan(plan: ChangePlan): ChangePlan { return JSON.parse(JSON.stringify(plan)) as ChangePlan; }
function allRouteLinks(route: CapacityAnalysis['routing']['routes'][number] | undefined): string[] { return route ? Object.keys(route.linkFractions).filter((linkId) => route.linkFractions[linkId] > 0).sort() : []; }
function createBrowserWorker(): ContingencyWorkerLike { return new Worker(new URL('../workers/contingency.worker.ts', import.meta.url), { type: 'module' }) as unknown as ContingencyWorkerLike; }
function pendingCapacityAnalysis(project: NetworkProject): CapacityAnalysis { const linkLoadsGbps = Object.fromEntries(project.links.map((link) => [link.id, 0])) as Record<string, number>; const linkUtilizationPct = Object.fromEntries(project.links.map((link) => [link.id, 0])) as Record<string, number>; return { snapshot: project, routing: { mode: project.routingProfile.mode, routes: [], linkLoadsGbps, linkUtilizationPct, peakUtilizationPct: 0, unroutedDemandIds: [] }, result: { id: `pending:${project.id}`, type: 'capacity', verdict: 'CANCELLED', modelHash: '', scenarioHash: 'pending', solver: { id: 'not-run', version: '3.5c' }, assumptions: [], metrics: { pending: true }, violations: [], witnesses: [], runtimeMs: 0 } }; }
const VIOLATION_RENDER_BATCH_SIZE = 200;
const networkTemplates = listBundledScenarios();
type SelectedScenarioId = BundledScenarioId | 'imported';
const initialCompute: ComputeCapabilities = { workerSupported: false, hardwareConcurrency: 1, recommendedWorkerCount: 1, sharedArrayBufferSupported: false, crossOriginIsolated: false, executionMode: 'async-fallback' };
const initialProject = loadScenario('continental-service-network');

export function useWorkbenchStage3(scope: any) {
  const { selectedScenarioId, setSelectedScenarioId, project, setProject, plan, setPlan, ephemeralPatch, setEphemeralPatch, publishedPlanAnalysis, setPublishedPlanAnalysis, candidate, setCandidate, comparison, setComparison, contingencies, setContingencies, contingencyStamp, setContingencyStamp, bottleneck, setBottleneck, selectedEvidence, setSelectedEvidence, selectedLinkId, setSelectedLinkId, selectedNodeId, setSelectedNodeId, activity, setActivity, webmcpStatus, setWebmcpStatus, registeredTools, setRegisteredTools, importMessage, setImportMessage, lastToolAnalysis, setLastToolAnalysis, compute, setCompute, progress, setProgress, resilienceStatus, setResilienceStatus, resilienceMessage, setResilienceMessage, analysisStatus, setAnalysisStatus, analysisMessage, setAnalysisMessage, lastAnalysisRuntimeMs, setLastAnalysisRuntimeMs, lastAnalysisExecution, setLastAnalysisExecution, optimizerStatus, setOptimizerStatus, optimizerMessage, setOptimizerMessage, optimizerResult, setOptimizerResult, routingOptimization, setRoutingOptimization, candidateVerification, setCandidateVerification, candidateVerificationStamp, setCandidateVerificationStamp, sharedVerification, setSharedVerification, designState, setDesignState, collaborationNotice, setCollaborationNotice, importDialogOpen, setImportDialogOpen, activeView, setActiveView, analysisTab, setAnalysisTab, leftPanelCollapsed, setLeftPanelCollapsed, rightPanelCollapsed, setRightPanelCollapsed, advancedOpen, setAdvancedOpen, trafficEditorOpen, setTrafficEditorOpen, settingsLinkId, setSettingsLinkId, newPlanName, setNewPlanName, inspectorCapacityDraft, setInspectorCapacityDraft, violationDisplay, setViolationDisplay, directRunControllerRef, analysisControllerRef, optimizerControllerRef, webmcpRegistrationRef, analysisEpochRef, planCounterRef, changeCounterRef, demandCounterRef, projectRef, planRef, ephemeralRef, candidateRef, contingencyRef, contingencyStampRef, analysisRef, verificationRef, designStateRef, destinationRef, selectedLinkRef, selectedNodeRef, selectedEvidenceRef, definition, compiledPlanPatch, solverPatch, executionProfile, semanticFingerprint, currentProjectHash, currentPlanHash, analysisFresh, syncLivePlanAnalysis, displayedPlanAnalysis, pendingAnalysis, analysis, analysisAuthoritative, snapshot, routeByDemand, selectedCanonicalLink, selectedCanonicalNode, selectedDemandId, selectedCanonicalDemand, n1Fresh, verificationFresh, pendingProposals, candidateStale, plannedOutageLinkIds, plannedOutageNodeIds, plannedChangedLinkIds, plannedChangedNodeIds, proposalLinkIds, proposalNodeIds, lockedLinkIds, lockedNodeIds, violationLinkIds, visibleViolationCount, visibleViolations, selectedLinkIds, cancelAsync, commitPlan, mutatePlan, setStatusOnly, clearAllDerived, replaceBaseProject, publishCandidate, executeContingencies } = scope;
  const workspaceService = useMemo(() => new CollaborativeWorkspaceService({
    getProject: () => projectRef.current,
    getPlan: () => planRef.current,
    setPlan: (next) => { planRef.current = next; setPlan(next); },
    getSelection: () => { if (selectedLinkRef.current) return { kind: 'link', id: selectedLinkRef.current } as WorkspaceSelection; if (selectedNodeRef.current) return { kind: 'node', id: selectedNodeRef.current } as WorkspaceSelection; const evidence = selectedEvidenceRef.current; if (evidence && (evidence.type === 'demand' || evidence.type === 'route')) return { kind: 'demand', id: evidence.demandId ?? evidence.id.replace(/^route:/, '') } as WorkspaceSelection; return null; },
    setSelection: (selection) => { if (!selection) { selectedLinkRef.current = null; selectedNodeRef.current = null; selectedEvidenceRef.current = null; setSelectedLinkId(null); setSelectedNodeId(null); setSelectedEvidence(null); return; } if (selection.kind === 'link') { selectedLinkRef.current = selection.id; selectedNodeRef.current = null; selectedEvidenceRef.current = { type: 'link', id: selection.id }; setSelectedLinkId(selection.id); setSelectedNodeId(null); setSelectedEvidence({ type: 'link', id: selection.id }); } else if (selection.kind === 'node') { selectedNodeRef.current = selection.id; selectedLinkRef.current = null; selectedEvidenceRef.current = null; setSelectedNodeId(selection.id); setSelectedLinkId(null); setSelectedEvidence(null); } else { selectedLinkRef.current = null; selectedNodeRef.current = null; selectedEvidenceRef.current = { type: 'demand', id: selection.id, demandId: selection.id }; setSelectedLinkId(null); setSelectedNodeId(null); setSelectedEvidence({ type: 'demand', id: selection.id, demandId: selection.id }); } },
    getDestination: () => destinationRef.current,
    setDestination: (destination) => { destinationRef.current = destination; setActiveView(destination); },
    getFocusedEvidence: () => selectedEvidenceRef.current,
    setFocusedEvidence: (evidence) => { selectedEvidenceRef.current = evidence; setSelectedEvidence(evidence); },
    getAnalysis: () => analysisRef.current,
    publishAnalysis: (next) => { analysisRef.current = next; setPublishedPlanAnalysis(next); if (next) { setAnalysisStatus('complete'); setAnalysisMessage(`${next.verdict} · deterministic shared-plan evidence published by agent.`); setLastAnalysisRuntimeMs(next.capacity.result.runtimeMs); } },
    getContingencies: () => contingencyRef.current && contingencyStampRef.current ? { analysis: contingencyRef.current, stamp: contingencyStampRef.current } : null,
    publishContingencies: (next, stamp) => { contingencyRef.current = next; contingencyStampRef.current = stamp; setContingencies(next); setContingencyStamp(stamp); },
    getCandidate: () => candidateRef.current,
    publishCandidate: (next) => { candidateRef.current = next; setCandidate(next); },
    getVerification: () => verificationRef.current,
    getDesignState: () => designStateRef.current,
    publishDesignState: (next) => { designStateRef.current = next; setDesignState(next); },
    publishVerification: (next) => { verificationRef.current = next; setSharedVerification(next); if (next?.result.candidateVerification) { setCandidateVerification(next.result.candidateVerification); setCandidateVerificationStamp(next.stamp); } },
    analyzePlanAsync: async (base, planSnapshot, signal) => { const profile = analysisExecutionProfile(base); setAnalysisStatus('running'); setAnalysisMessage(profile.mode === 'worker' && typeof Worker === 'function' ? 'Agent analysis is running in a browser Worker…' : 'Agent analysis is running deterministically on the main thread…'); if (profile.mode === 'worker' && typeof Worker === 'function') { const result = await analyzeChangePlanInBrowserWorker(base, planSnapshot, signal); setLastAnalysisExecution('worker'); setLastAnalysisRuntimeMs(result.runtimeMs); return result.analysis; } const started = performance.now(); const result = analyzeChangePlan(base, planSnapshot); setLastAnalysisExecution('main-thread'); setLastAnalysisRuntimeMs(Math.round((performance.now() - started) * 1000) / 1000); return result; },
    runContingenciesAsync: (base, patch, options) => executeContingencies(options, { project: base, patch }),
    optimizeCapacity: async (base, requirements, signal) => { setOptimizerStatus('running'); setOptimizerMessage('Solving constrained capacity MILP off the main thread…'); const result = await optimizeCapacityInBrowser(base, requirements, 8_000, signal); setOptimizerResult(result); setOptimizerStatus('ready'); setOptimizerMessage(`${result.diagnostics.status} · ${result.diagnostics.proof} · ${result.diagnostics.runtimeMs} ms${result.diagnostics.message ? ` · ${result.diagnostics.message}` : ''}`); return result; },
    optimizeAdaptiveDesign: async (base, requirements, signal, sourcePlanHash) => { setOptimizerStatus('running'); setOptimizerMessage('Exploring bounded candidate routes and declared design actions off the main thread…'); const result = await optimizeAdaptiveDesignInBrowser(base, requirements, 10_000, signal, sourcePlanHash, setOptimizerMessage); setOptimizerStatus('ready'); setOptimizerMessage(result.variant ? `${result.variant.verification.status} adaptive design · cost ${result.variant.totalCost} · peak ${Math.round(result.variant.peakUtilizationPct * 10) / 10}%` : `${result.failureReason ?? result.diagnostics.status} · ${result.diagnostics.message}`); return result; },
    optimizeDesignPareto: async (base, requirements, signal, sourcePlanHash) => { setOptimizerStatus('running'); setOptimizerMessage('Generating a bounded nondominated adaptive-design frontier…'); const variants = await optimizeDesignParetoInBrowser(base, requirements, 10_000, signal, sourcePlanHash, setOptimizerMessage); setOptimizerStatus('ready'); setOptimizerMessage(`${variants.length} verified nondominated adaptive design variant(s).`); return variants; },
    verifyCandidate: async (base, nextCandidate, requirements, signal) => { const result = await verifyCandidateInBrowser(base, nextCandidate, requirements, signal); setCandidateVerification(result); return result; },
    onSemanticMutation: () => { cancelAsync(); ephemeralRef.current = null; setEphemeralPatch(null); setBottleneck(null); setComparison(null); setRoutingOptimization(null); designStateRef.current = null; setDesignState(null); },
    onActivity: (event: WorkspaceActivityEvent) => { if (event.actor === 'agent' && !event.action.startsWith('inspect')) setCollaborationNotice(`Agent · ${event.summary}`); },
  }), []);
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context?.registerTool) { setWebmcpStatus('unsupported'); setRegisteredTools([]); return; }
    let active = true;
    delete (window as Window & { __infratwinWebMCPRegistrationError?: string }).__infratwinWebMCPRegistrationError;
    const register = async () => {
      // React Strict Mode mounts, cleans up, and remounts effects in development. Yield once so
      // the abandoned first effect cannot overlap native registerTool calls with the live mount.
      await Promise.resolve();
      if (!active) return;
      try {
        const registration = await registerCollaborativeTools(context, workspaceService, {
          onActivity: (event: ToolActivityEvent) => setActivity((current: ToolActivityEvent[]) => [event, ...current].slice(0, 40)),
          onToolSetChanged: (names: string[]) => setRegisteredTools(names),
        });
        if (!active) registration.dispose();
        else {
          webmcpRegistrationRef.current = registration;
          setWebmcpStatus('registered');
          setRegisteredTools(registration.getRegisteredNames());
        }
      } catch (error: unknown) {
        if (!active) return;
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        (window as Window & { __infratwinWebMCPRegistrationError?: string }).__infratwinWebMCPRegistrationError = message;
        console.error('[InfraTwin WebMCP] registration failed', error);
        setWebmcpStatus('error');
      }
    };
    void register();
    return () => { active = false; webmcpRegistrationRef.current?.dispose(); webmcpRegistrationRef.current = null; };
  }, [workspaceService]);
  useEffect(() => { const registration = webmcpRegistrationRef.current; if (!registration) return; void registration.refresh().catch((error: unknown) => { const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error); (window as Window & { __infratwinWebMCPRegistrationError?: string }).__infratwinWebMCPRegistrationError = message; console.error('[InfraTwin WebMCP] refresh failed', error); setWebmcpStatus('error'); }); }, [currentPlanHash, plan.proposals, analysisFresh, publishedPlanAnalysis?.verdict, optimizerStatus, workspaceService]);
  const runWorkspaceAction = (fn: () => void) => { try { fn(); setImportMessage(''); } catch (error) { setImportMessage(error instanceof Error ? error.message : 'Change Plan action failed.'); } };
  const removeMatchingChanges = (predicate: (item: PlanChange) => boolean) => { for (const item of [...planRef.current.changes].filter(predicate)) workspaceService.removePlanChange(item.id, 'human'); };
  const handleLinkAvailability = (linkId: string, plannedOutage: boolean) => runWorkspaceAction(() => { removeMatchingChanges((item) => (item.type === 'disable_link' || item.type === 'enable_link') && item.target.id === linkId); if (!plannedOutage) workspaceService.addPlanChange({ type: 'disable_link', linkId }, 'human'); });
  const handleNodeAvailability = (nodeId: string, plannedOutage: boolean) => runWorkspaceAction(() => { removeMatchingChanges((item) => (item.type === 'disable_node' || item.type === 'enable_node') && item.target.id === nodeId); if (!plannedOutage) workspaceService.addPlanChange({ type: 'disable_node', nodeId }, 'human'); });
  const handleLinkCapacity = (linkId: string, capacityGbps: number) => runWorkspaceAction(() => { const base = projectRef.current.links.find((item:any) => item.id === linkId); if (!base || !Number.isFinite(capacityGbps) || capacityGbps <= 0) return; removeMatchingChanges((item) => item.type === 'set_link_capacity' && item.target.id === linkId); if (Math.abs(base.capacityGbps - capacityGbps) > 1e-9) workspaceService.addPlanChange({ type: 'set_link_capacity', linkId, capacityGbps }, 'human'); });
  const handleDemandBandwidth = (demandId: string, bandwidthGbps: number) => runWorkspaceAction(() => { const base = projectRef.current.demands.find((item:any) => item.id === demandId); if (!base || !Number.isFinite(bandwidthGbps) || bandwidthGbps < 0) return; removeMatchingChanges((item) => item.type === 'set_demand_bandwidth' && item.target.id === demandId); if (Math.abs(base.bandwidthGbps - bandwidthGbps) > 1e-9) workspaceService.addPlanChange({ type: 'set_demand_bandwidth', demandId, bandwidthGbps }, 'human'); });
  const handleAddDemand = (input: { name: string; source: string; target: string; bandwidthGbps: number; serviceClassId: string }) => runWorkspaceAction(() => { let id = `PD${++demandCounterRef.current}`; while (projectRef.current.demands.some((item:any) => item.id === id) || planRef.current.changes.some((item:any) => item.type === 'add_demand' && item.target.id === id)) id = `PD${++demandCounterRef.current}`; workspaceService.addPlanChange({ type: 'add_demand', demand: { id, ...input } }, 'human'); });
  const handleGrowth = (demandIds: string[], multiplier: number) => runWorkspaceAction(() => { workspaceService.addPlanChange({ type: 'demand_growth', demandIds, multiplier }, 'human'); });
  const batchPlanOutage = (linkIds: string[]) => runWorkspaceAction(() => { for (const linkId of [...new Set(linkIds)].sort()) { removeMatchingChanges((change) => (change.type === 'disable_link' || change.type === 'enable_link') && change.target.id === linkId); workspaceService.addPlanChange({ type: 'disable_link', linkId }, 'human'); } });
  const batchLockLinks = (linkIds: string[], locked: boolean) => runWorkspaceAction(() => { for (const linkId of [...new Set(linkIds)].sort()) workspaceService.setPlanRestriction('link', linkId, locked, 'human'); });
  const editUpgradeCatalog = (linkIds: string[], options: import('@infratwin/model').LinkUpgradeOption[]) => { try { const nextProject = applyUpgradeProfile(projectRef.current, linkIds, options); setSelectedScenarioId('imported'); replaceBaseProject(nextProject, `${nextProject.name} change plan`); setImportMessage(`Updated the base-network upgrade catalog for ${linkIds.length} link${linkIds.length === 1 ? '' : 's'}. This is a canonical network-assumption edit, so the prior Change Plan was reset rather than silently rebased.`); } catch (error) { setImportMessage(error instanceof Error ? error.message : 'Upgrade catalog edit failed.'); } };
  const loadNetworkTemplate = (id: BundledScenarioId) => { const next = loadScenario(id); setSelectedScenarioId(id); replaceBaseProject(next, `${getScenarioDefinition(id).title} change plan`); setImportMessage(''); };
  const loadPlanTemplate = () => { if (!definition.changePlanTemplate) return; clearAllDerived(); const next = clonePlan(definition.changePlanTemplate); planRef.current = next; setPlan(next); };
  const newPlan = (name: string) => { clearAllDerived(); const next = createChangePlan(projectRef.current, name, { id: `plan-${projectRef.current.id}-${++planCounterRef.current}` }); planRef.current = next; setPlan(next); };
  const clearPlan = () => newPlan(planRef.current.name);
  Object.assign(scope, { workspaceService, runWorkspaceAction, removeMatchingChanges, handleLinkAvailability, handleNodeAvailability, handleLinkCapacity, handleDemandBandwidth, handleAddDemand, handleGrowth, batchPlanOutage, batchLockLinks, editUpgradeCatalog, loadNetworkTemplate, loadPlanTemplate, newPlan, clearPlan });
}
