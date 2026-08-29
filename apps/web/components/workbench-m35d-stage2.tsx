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


export function useWorkbenchStage2(scope: any) {
  const { selectedScenarioId, setSelectedScenarioId, project, setProject, plan, setPlan, ephemeralPatch, setEphemeralPatch, publishedPlanAnalysis, setPublishedPlanAnalysis, candidate, setCandidate, comparison, setComparison, contingencies, setContingencies, contingencyStamp, setContingencyStamp, bottleneck, setBottleneck, selectedEvidence, setSelectedEvidence, selectedLinkId, setSelectedLinkId, selectedNodeId, setSelectedNodeId, activity, setActivity, webmcpStatus, setWebmcpStatus, registeredTools, setRegisteredTools, importMessage, setImportMessage, lastToolAnalysis, setLastToolAnalysis, compute, setCompute, progress, setProgress, resilienceStatus, setResilienceStatus, resilienceMessage, setResilienceMessage, analysisStatus, setAnalysisStatus, analysisMessage, setAnalysisMessage, lastAnalysisRuntimeMs, setLastAnalysisRuntimeMs, lastAnalysisExecution, setLastAnalysisExecution, optimizerStatus, setOptimizerStatus, optimizerMessage, setOptimizerMessage, optimizerResult, setOptimizerResult, routingOptimization, setRoutingOptimization, candidateVerification, setCandidateVerification, candidateVerificationStamp, setCandidateVerificationStamp, sharedVerification, setSharedVerification, designState, setDesignState, collaborationNotice, setCollaborationNotice, importDialogOpen, setImportDialogOpen, activeView, setActiveView, analysisTab, setAnalysisTab, leftPanelCollapsed, setLeftPanelCollapsed, rightPanelCollapsed, setRightPanelCollapsed, advancedOpen, setAdvancedOpen, trafficEditorOpen, setTrafficEditorOpen, settingsLinkId, setSettingsLinkId, newPlanName, setNewPlanName, inspectorCapacityDraft, setInspectorCapacityDraft, violationDisplay, setViolationDisplay, directRunControllerRef, analysisControllerRef, optimizerControllerRef, webmcpRegistrationRef, analysisEpochRef, planCounterRef, changeCounterRef, demandCounterRef, projectRef, planRef, ephemeralRef, candidateRef, contingencyRef, contingencyStampRef, analysisRef, verificationRef, designStateRef, destinationRef, selectedLinkRef, selectedNodeRef, selectedEvidenceRef, definition, compiledPlanPatch, solverPatch, executionProfile, semanticFingerprint, currentProjectHash, currentPlanHash, analysisFresh, syncLivePlanAnalysis, displayedPlanAnalysis, pendingAnalysis, analysis, analysisAuthoritative, snapshot, routeByDemand, selectedCanonicalLink, selectedCanonicalNode, selectedDemandId, selectedCanonicalDemand, n1Fresh, verificationFresh, pendingProposals, candidateStale } = scope;
  const plannedOutageLinkIds = useMemo(() => new Set(plan.changes.flatMap((item:any) => item.type === 'disable_link' && item.target.kind === 'link' ? [item.target.id] : [])), [plan.changes]);
  const plannedOutageNodeIds = useMemo(() => new Set(plan.changes.flatMap((item:any) => item.type === 'disable_node' && item.target.kind === 'node' ? [item.target.id] : [])), [plan.changes]);
  const plannedChangedLinkIds = useMemo(() => new Set(plan.changes.flatMap((item:any) => item.target.kind === 'link' ? [item.target.id] : [])), [plan.changes]);
  const plannedChangedNodeIds = useMemo(() => new Set(plan.changes.flatMap((item:any) => item.target.kind === 'node' ? [item.target.id] : [])), [plan.changes]);
  const proposalLinkIds = useMemo(() => new Set(plan.proposals.filter((item:any) => item.state === 'pending' && item.change.target.kind === 'link').map((item:any) => item.change.target.kind === 'link' ? item.change.target.id : '')), [plan.proposals]);
  const proposalNodeIds = useMemo(() => new Set(plan.proposals.filter((item:any) => item.state === 'pending' && item.change.target.kind === 'node').map((item:any) => item.change.target.kind === 'node' ? item.change.target.id : '')), [plan.proposals]);
  const lockedLinkIds = useMemo(() => new Set(plan.restrictions.lockedLinkIds), [plan.restrictions.lockedLinkIds]);
  const lockedNodeIds = useMemo(() => new Set(plan.restrictions.lockedNodeIds), [plan.restrictions.lockedNodeIds]);
  const violationLinkIds = useMemo(() => new Set(analysis.result.violations.map((item:any) => item.linkId).filter((id:any): id is string => Boolean(id))), [analysis.result.violations]);
  const visibleViolationCount = violationDisplay.resultId === analysis.result.id ? violationDisplay.count : VIOLATION_RENDER_BATCH_SIZE;
  const visibleViolations = useMemo(() => analysis.result.violations.slice(0, visibleViolationCount), [analysis.result.violations, visibleViolationCount]);
  const selectedLinkIds = useMemo(() => {
    if (!selectedEvidence) return new Set<string>();
    if (selectedEvidence.type === 'link') return new Set([selectedEvidence.id]);
    if (selectedEvidence.type === 'route' || selectedEvidence.type === 'cut') return new Set(selectedEvidence.linkIds ?? []);
    if (selectedEvidence.type === 'demand') return new Set(allRouteLinks(routeByDemand.get(selectedEvidence.demandId ?? selectedEvidence.id)));
    return new Set<string>();
  }, [selectedEvidence, routeByDemand]);
  const cancelAsync = () => {
    analysisEpochRef.current += 1;
    directRunControllerRef.current?.abort(); directRunControllerRef.current = null;
    analysisControllerRef.current?.abort(); analysisControllerRef.current = null;
    optimizerControllerRef.current?.abort(); optimizerControllerRef.current = null;
    setProgress(null); setResilienceStatus('idle'); setResilienceMessage(''); setAnalysisStatus('idle'); setAnalysisMessage('');
    if (optimizerStatus === 'running') { setOptimizerStatus('ready'); setOptimizerMessage('Run cancelled because the Change Plan changed.'); }
  };
  const commitPlan = (next: ChangePlan) => {
    cancelAsync(); planRef.current = next; setPlan(next); ephemeralRef.current = null; setEphemeralPatch(null);
    setContingencies(null); setContingencyStamp(null); setBottleneck(null); setSelectedEvidence(null); setComparison(null); setRoutingOptimization(null); setDesignState(null); designStateRef.current = null;
  };
  const mutatePlan = (fn: (current: ChangePlan) => ChangePlan) => { try { commitPlan(fn(planRef.current)); setImportMessage(''); } catch (error) { setImportMessage(error instanceof Error ? error.message : 'Change Plan action failed.'); } };
  const setStatusOnly = (status: ChangePlan['status'], summary: string) => {
    const next = setChangePlanStatus(planRef.current, status, summary); planRef.current = next; setPlan(next);
  };
  const clearAllDerived = () => {
    cancelAsync(); setPublishedPlanAnalysis(null); analysisRef.current = null; setCandidate(null); candidateRef.current = null; setComparison(null); setContingencies(null); contingencyRef.current = null; setContingencyStamp(null); contingencyStampRef.current = null; setBottleneck(null); setSelectedEvidence(null); selectedEvidenceRef.current = null; setSelectedLinkId(null); selectedLinkRef.current = null; setSelectedNodeId(null); selectedNodeRef.current = null; setOptimizerResult(null); setRoutingOptimization(null); setCandidateVerification(null); setCandidateVerificationStamp(null); setSharedVerification(null); verificationRef.current = null; setDesignState(null); designStateRef.current = null; setCollaborationNotice(''); setLastToolAnalysis(''); setEphemeralPatch(null); ephemeralRef.current = null;
  };
  const replaceBaseProject = (next: NetworkProject, planName = 'Change Plan') => {
    clearAllDerived(); const fresh = createChangePlan(next, planName, { id: `plan-${next.id}-${++planCounterRef.current}` }); projectRef.current = next; planRef.current = fresh; setProject(next); setPlan(fresh);
  };
  const publishCandidate = (nextCandidate: CandidatePlan | null) => {
    candidateRef.current = nextCandidate; setCandidate(nextCandidate); setCandidateVerification(null); setCandidateVerificationStamp(null); setComparison(null);
    if (nextCandidate) {
      try { const nextPlan = setCandidateProposals(projectRef.current, planRef.current, nextCandidate); planRef.current = nextPlan; setPlan(nextPlan); }
      catch (error) { setImportMessage(error instanceof Error ? error.message : 'Candidate could not be represented in the Change Plan.'); candidateRef.current = null; setCandidate(null); }
    }
  };
  const executeContingencies = async (options: ContingencyRunOptions = {}, explicit?: { project: NetworkProject; patch: ScenarioPatch | null }): Promise<ContingencyAnalysis> => {
    const runEpoch = ++analysisEpochRef.current;
    const baseProject = cloneProject(explicit?.project ?? projectRef.current);
    const rawPatch = explicit?.patch ?? (ephemeralRef.current ?? (planRef.current.changes.length ? compileChangePlanToScenarioPatch(projectRef.current, planRef.current) : null));
    const basePatch = rawPatch ? JSON.parse(JSON.stringify(rawPatch)) as ScenarioPatch : null;
    const capabilities = detectComputeCapabilities(); setCompute(capabilities); setResilienceStatus('running'); setResilienceMessage('');
    setProgress({ total: 0, completed: 0, running: 0, percentage: 0, workerCount: options.workerCount ?? capabilities.recommendedWorkerCount, executionMode: capabilities.executionMode });
    const externalProgress = options.onProgress;
    const next = await runLinkContingenciesAsync(baseProject, basePatch, { ...options, workerCount: options.workerCount ?? capabilities.recommendedWorkerCount, workerFactory: capabilities.workerSupported ? createBrowserWorker : undefined, onProgress: (value) => { if (analysisEpochRef.current !== runEpoch) return; setProgress(value); externalProgress?.(value); } });
    if (analysisEpochRef.current !== runEpoch) return { ...next, status: 'cancelled' };
    if (next.status === 'cancelled') { setResilienceStatus('cancelled'); setResilienceMessage(`Cancelled after ${next.completedScenarios} scenario(s); no partial PASS was published.`); return next; }
    if (next.status === 'partial') { setResilienceStatus('partial'); setResilienceMessage(`${next.completedScenarios}/${next.totalEligibleScenarios} link failures tested; PARTIAL COVERAGE. Exact analysis is bounded to the requested scenario count.`); return next; }
    setResilienceStatus('complete'); setResilienceMessage(`${next.completedScenarios}/${next.totalEligibleScenarios} link failures tested; COMPLETE COVERAGE via ${next.executionMode} with ${next.workerCount} worker slot(s).`); return next;
  };
  Object.assign(scope, { plannedOutageLinkIds, plannedOutageNodeIds, plannedChangedLinkIds, plannedChangedNodeIds, proposalLinkIds, proposalNodeIds, lockedLinkIds, lockedNodeIds, violationLinkIds, visibleViolationCount, visibleViolations, selectedLinkIds, cancelAsync, commitPlan, mutatePlan, setStatusOnly, clearAllDerived, replaceBaseProject, publishCandidate, executeContingencies });
}
