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
import { CollaborativeWorkspaceService, type PublishedVerification, type WorkspaceActivityEvent, type WorkspaceSelection, type WorkspaceDesignState } from '../../../packages/application/src/index.ts';
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
import type { ConfirmationRequest } from './confirmation-dialog';
import { hasMeaningfulPlanWork, readLocalWorkspaceDraft, writeLocalWorkspaceDraft, type WorkspaceBundle } from '../lib/workspace-persistence';
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


export function useWorkbenchStage1(scope: any) {
  const [selectedScenarioId, setSelectedScenarioId] = useState<SelectedScenarioId>('continental-service-network');
  const [project, setProject] = useState<NetworkProject>(() => cloneProject(initialProject));
  const [plan, setPlan] = useState<ChangePlan>(() => createChangePlan(initialProject, 'Backbone change plan', { id: 'plan-flagship-initial' }));
  const [ephemeralPatch, setEphemeralPatch] = useState<ScenarioPatch | null>(null);
  const [publishedPlanAnalysis, setPublishedPlanAnalysis] = useState<ChangePlanAnalysis | null>(null);
  const [candidate, setCandidate] = useState<CandidatePlan | null>(null);
  const [comparison, setComparison] = useState<CandidateComparison | null>(null);
  const [contingencies, setContingencies] = useState<ContingencyAnalysis | null>(null);
  const [contingencyStamp, setContingencyStamp] = useState<PlanEvidenceStamp | null>(null);
  const [bottleneck, setBottleneck] = useState<BottleneckAnalysis | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceRef | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activity, setActivity] = useState<ToolActivityEvent[]>([]);
  const [webmcpStatus, setWebmcpStatus] = useState<'checking' | 'registered' | 'unsupported' | 'error'>('checking');
  const [registeredTools, setRegisteredTools] = useState<string[]>([]);
  const [importMessage, setImportMessage] = useState('');
  const [lastToolAnalysis, setLastToolAnalysis] = useState('');
  const [compute, setCompute] = useState<ComputeCapabilities>(initialCompute);
  const [progress, setProgress] = useState<ContingencyProgress | null>(null);
  const [resilienceStatus, setResilienceStatus] = useState<'idle' | 'running' | 'complete' | 'partial' | 'cancelled' | 'error'>('idle');
  const [resilienceMessage, setResilienceMessage] = useState('');
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'running' | 'complete' | 'cancelled' | 'error'>('idle');
  const [analysisMessage, setAnalysisMessage] = useState('');
  const [lastAnalysisRuntimeMs, setLastAnalysisRuntimeMs] = useState<number | null>(null);
  const [lastAnalysisExecution, setLastAnalysisExecution] = useState<CapacityExecutionMode | null>(null);
  const [optimizerStatus, setOptimizerStatus] = useState<'loading' | 'ready' | 'running' | 'error'>('loading');
  const [optimizerMessage, setOptimizerMessage] = useState('Loading HiGHS WASM in a worker…');
  const [optimizerResult, setOptimizerResult] = useState<CapacityOptimizationResult | null>(null);
  const [routingOptimization, setRoutingOptimization] = useState<TrafficAllocationResult | null>(null);
  const [candidateVerification, setCandidateVerification] = useState<CandidateVerification | null>(null);
  const [candidateVerificationStamp, setCandidateVerificationStamp] = useState<PlanRevisionStamp | null>(null);
  const [sharedVerification, setSharedVerification] = useState<PublishedVerification | null>(null);
  const [designState, setDesignState] = useState<WorkspaceDesignState | null>(null);
  const [collaborationNotice, setCollaborationNotice] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [activeView, setActiveView] = useState<AppDestination>('network');
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>('summary');
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [trafficEditorOpen, setTrafficEditorOpen] = useState(false);
  const [settingsLinkId, setSettingsLinkId] = useState(initialProject.links[0]?.id ?? '');
  const [newPlanName, setNewPlanName] = useState('Change Plan');
  const [inspectorCapacityDraft, setInspectorCapacityDraft] = useState<number | null>(null);
  const [violationDisplay, setViolationDisplay] = useState<{ resultId: string; count: number }>({ resultId: '', count: VIOLATION_RENDER_BATCH_SIZE });
  const [recoveryDraft, setRecoveryDraft] = useState<WorkspaceBundle | null>(null);
  const [draftPersistenceEnabled, setDraftPersistenceEnabled] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<ConfirmationRequest | null>(null);
  const directRunControllerRef = useRef<AbortController | null>(null);
  const analysisControllerRef = useRef<AbortController | null>(null);
  const optimizerControllerRef = useRef<AbortController | null>(null);
  const webmcpRegistrationRef = useRef<WebMCPRegistration | null>(null);
  const analysisEpochRef = useRef(0);
  const planCounterRef = useRef(1);
  const changeCounterRef = useRef(1);
  const demandCounterRef = useRef(1);
  const projectRef = useRef(project);
  const planRef = useRef(plan);
  const ephemeralRef = useRef(ephemeralPatch);
  const candidateRef = useRef(candidate);
  const contingencyRef = useRef(contingencies);
  const contingencyStampRef = useRef(contingencyStamp);
  const analysisRef = useRef(publishedPlanAnalysis);
  const verificationRef = useRef(sharedVerification);
  const designStateRef = useRef(designState);
  const destinationRef = useRef(activeView);
  const selectedLinkRef = useRef(selectedLinkId);
  const selectedNodeRef = useRef(selectedNodeId);
  const selectedEvidenceRef = useRef(selectedEvidence);
  projectRef.current = project;
  planRef.current = plan;
  ephemeralRef.current = ephemeralPatch;
  candidateRef.current = candidate;
  contingencyRef.current = contingencies;
  contingencyStampRef.current = contingencyStamp;
  analysisRef.current = publishedPlanAnalysis;
  verificationRef.current = sharedVerification;
  designStateRef.current = designState;
  destinationRef.current = activeView;
  selectedLinkRef.current = selectedLinkId;
  selectedNodeRef.current = selectedNodeId;
  selectedEvidenceRef.current = selectedEvidence;
  useEffect(() => {
    setCompute(detectComputeCapabilities());
    const localDraft = readLocalWorkspaceDraft();
    setRecoveryDraft(localDraft);
    setDraftPersistenceEnabled(!localDraft);
  }, []);
  useEffect(() => {
    if (!draftPersistenceEnabled) return;
    writeLocalWorkspaceDraft(project, plan);
  }, [project, plan, draftPersistenceEnabled]);
  useEffect(() => {
    if (!hasMeaningfulPlanWork(project, plan)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [project, plan]);
  useEffect(() => {
    if (!collaborationNotice) return;
    const timer = window.setTimeout(() => setCollaborationNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [collaborationNotice]);
  useEffect(() => {
    const controller = new AbortController();
    probeBrowserOptimizer(controller.signal).then((probe) => { setOptimizerStatus('ready'); setOptimizerMessage(`${probe.solver} ${probe.solverVersion} · ${probe.status}`); }).catch((error) => { if (error instanceof Error && error.name === 'AbortError') return; setOptimizerStatus('error'); setOptimizerMessage(error instanceof Error ? error.message : 'HiGHS WASM failed to load.'); });
    return () => controller.abort();
  }, []);
  const definition = useMemo<ScenarioDefinition>(() => selectedScenarioId === 'imported'
    ? { id: 'blank', title: project.name, kind: 'blank', description: 'Imported canonical network.', suggestedPrompt: 'Inspect the current network and its visible Change Plan.', project }
    : getScenarioDefinition(selectedScenarioId), [selectedScenarioId, project]);
  const compiledPlanPatch = useMemo(() => compileChangePlanToScenarioPatch(project, plan), [project, plan]);
  const solverPatch = useMemo(() => ephemeralPatch ?? (plan.changes.length ? compiledPlanPatch : null), [ephemeralPatch, plan.changes.length, compiledPlanPatch]);
  const executionProfile = useMemo(() => analysisExecutionProfile(project), [project]);
  const semanticFingerprint = useMemo(() => semanticStateFingerprint(project, plan), [project, plan]);
  const currentProjectHash = semanticFingerprint.modelHash;
  const currentPlanHash = semanticFingerprint.planHash;
  const analysisFresh = Boolean(publishedPlanAnalysis && isPlanEvidenceFresh(publishedPlanAnalysis.stamp, project, plan));
  const syncLivePlanAnalysis = useMemo(() => executionProfile.mode === 'main-thread' ? analyzeChangePlan(project, plan) : null, [executionProfile.mode, project, plan]);
  const displayedPlanAnalysis = analysisFresh ? publishedPlanAnalysis : syncLivePlanAnalysis;
  const pendingAnalysis = useMemo(() => pendingCapacityAnalysis(project), [project]);
  const analysis = useMemo(() => ephemeralPatch ? runScenarioCapacityAnalysis(project, ephemeralPatch) : (displayedPlanAnalysis?.capacity ?? pendingAnalysis), [project, ephemeralPatch, displayedPlanAnalysis, pendingAnalysis]);
  const analysisAuthoritative = Boolean(ephemeralPatch || displayedPlanAnalysis);
  const snapshot = analysis.snapshot;
  const routeByDemand = useMemo(() => new Map(analysis.routing.routes.map((route) => [route.demandId, route])), [analysis.routing.routes]);
  const selectedCanonicalLink = useMemo(() => selectedLinkId ? project.links.find((link) => link.id === selectedLinkId) : undefined, [project.links, selectedLinkId]);
  const selectedCanonicalNode = useMemo(() => selectedNodeId ? project.nodes.find((node) => node.id === selectedNodeId) : undefined, [project.nodes, selectedNodeId]);
  const selectedDemandId = selectedEvidence && (selectedEvidence.type === 'demand' || selectedEvidence.type === 'route') ? (selectedEvidence.demandId ?? selectedEvidence.id.replace(/^route:/, '')) : null;
  const selectedCanonicalDemand = useMemo(() => selectedDemandId ? project.demands.find((demand) => demand.id === selectedDemandId) : undefined, [project.demands, selectedDemandId]);
  useEffect(() => {
    if (!project.links.some((link) => link.id === settingsLinkId)) setSettingsLinkId(project.links[0]?.id ?? '');
  }, [project.id, project.links, settingsLinkId]);
  useEffect(() => { setInspectorCapacityDraft(selectedCanonicalLink?.capacityGbps ?? null); }, [selectedCanonicalLink?.id, selectedCanonicalLink?.capacityGbps]);
  const n1Fresh = Boolean(contingencyStamp && isPlanEvidenceFresh(contingencyStamp, project, plan));
  const verificationFresh = Boolean(candidateVerification && candidateVerificationStamp && isPlanRevisionFresh(candidateVerificationStamp, project, plan));
  const pendingProposals = plan.proposals.filter((proposal) => proposal.state === 'pending');
  const candidateStale = pendingProposals.some((proposal) => proposal.sourcePlanHash !== currentPlanHash);
  Object.assign(scope, { selectedScenarioId, setSelectedScenarioId, project, setProject, plan, setPlan, ephemeralPatch, setEphemeralPatch, publishedPlanAnalysis, setPublishedPlanAnalysis, candidate, setCandidate, comparison, setComparison, contingencies, setContingencies, contingencyStamp, setContingencyStamp, bottleneck, setBottleneck, selectedEvidence, setSelectedEvidence, selectedLinkId, setSelectedLinkId, selectedNodeId, setSelectedNodeId, activity, setActivity, webmcpStatus, setWebmcpStatus, registeredTools, setRegisteredTools, importMessage, setImportMessage, lastToolAnalysis, setLastToolAnalysis, compute, setCompute, progress, setProgress, resilienceStatus, setResilienceStatus, resilienceMessage, setResilienceMessage, analysisStatus, setAnalysisStatus, analysisMessage, setAnalysisMessage, lastAnalysisRuntimeMs, setLastAnalysisRuntimeMs, lastAnalysisExecution, setLastAnalysisExecution, optimizerStatus, setOptimizerStatus, optimizerMessage, setOptimizerMessage, optimizerResult, setOptimizerResult, routingOptimization, setRoutingOptimization, candidateVerification, setCandidateVerification, candidateVerificationStamp, setCandidateVerificationStamp, sharedVerification, setSharedVerification, designState, setDesignState, collaborationNotice, setCollaborationNotice, importDialogOpen, setImportDialogOpen, activeView, setActiveView, analysisTab, setAnalysisTab, leftPanelCollapsed, setLeftPanelCollapsed, rightPanelCollapsed, setRightPanelCollapsed, advancedOpen, setAdvancedOpen, trafficEditorOpen, setTrafficEditorOpen, settingsLinkId, setSettingsLinkId, newPlanName, setNewPlanName, inspectorCapacityDraft, setInspectorCapacityDraft, violationDisplay, setViolationDisplay, recoveryDraft, setRecoveryDraft, draftPersistenceEnabled, setDraftPersistenceEnabled, pendingConfirmation, setPendingConfirmation, directRunControllerRef, analysisControllerRef, optimizerControllerRef, webmcpRegistrationRef, analysisEpochRef, planCounterRef, changeCounterRef, demandCounterRef, projectRef, planRef, ephemeralRef, candidateRef, contingencyRef, contingencyStampRef, analysisRef, verificationRef, designStateRef, destinationRef, selectedLinkRef, selectedNodeRef, selectedEvidenceRef, definition, compiledPlanPatch, solverPatch, executionProfile, semanticFingerprint, currentProjectHash, currentPlanHash, analysisFresh, syncLivePlanAnalysis, displayedPlanAnalysis, pendingAnalysis, analysis, analysisAuthoritative, snapshot, routeByDemand, selectedCanonicalLink, selectedCanonicalNode, selectedDemandId, selectedCanonicalDemand, n1Fresh, verificationFresh, pendingProposals, candidateStale });
}
