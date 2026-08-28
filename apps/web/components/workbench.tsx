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
  CANDIDATE_TOOL_NAMES,
  COUNTEREXAMPLE_TOOL_NAMES,
  OPTIMIZER_TOOL_NAMES,
  CORE_TOOL_NAMES,
  RESILIENCE_TOOL_NAMES,
  VIOLATION_TOOL_NAMES,
  registerCandidateTools,
  registerCounterexampleTools,
  registerCoreTools,
  registerOptimizerTools,
  registerResilienceTools,
  registerViolationTools,
  type InfraTwinToolServices,
  type ModelContextLike,
  type ToolActivityEvent,
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

export function Workbench() {
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
  const directRunControllerRef = useRef<AbortController | null>(null);
  const analysisControllerRef = useRef<AbortController | null>(null);
  const optimizerControllerRef = useRef<AbortController | null>(null);
  const analysisEpochRef = useRef(0);
  const planCounterRef = useRef(1);
  const changeCounterRef = useRef(1);
  const demandCounterRef = useRef(1);

  const projectRef = useRef(project); const planRef = useRef(plan); const ephemeralRef = useRef(ephemeralPatch); const candidateRef = useRef(candidate); const contingencyRef = useRef(contingencies);
  projectRef.current = project; planRef.current = plan; ephemeralRef.current = ephemeralPatch; candidateRef.current = candidate; contingencyRef.current = contingencies;

  useEffect(() => { setCompute(detectComputeCapabilities()); }, []);
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

  const plannedOutageLinkIds = useMemo(() => new Set(plan.changes.flatMap((item) => item.type === 'disable_link' && item.target.kind === 'link' ? [item.target.id] : [])), [plan.changes]);
  const plannedOutageNodeIds = useMemo(() => new Set(plan.changes.flatMap((item) => item.type === 'disable_node' && item.target.kind === 'node' ? [item.target.id] : [])), [plan.changes]);
  const plannedChangedLinkIds = useMemo(() => new Set(plan.changes.flatMap((item) => item.target.kind === 'link' ? [item.target.id] : [])), [plan.changes]);
  const plannedChangedNodeIds = useMemo(() => new Set(plan.changes.flatMap((item) => item.target.kind === 'node' ? [item.target.id] : [])), [plan.changes]);
  const proposalLinkIds = useMemo(() => new Set(plan.proposals.filter((item) => item.state === 'pending' && item.change.target.kind === 'link').map((item) => item.change.target.kind === 'link' ? item.change.target.id : '')), [plan.proposals]);
  const proposalNodeIds = useMemo(() => new Set(plan.proposals.filter((item) => item.state === 'pending' && item.change.target.kind === 'node').map((item) => item.change.target.kind === 'node' ? item.change.target.id : '')), [plan.proposals]);
  const lockedLinkIds = useMemo(() => new Set(plan.restrictions.lockedLinkIds), [plan.restrictions.lockedLinkIds]);
  const lockedNodeIds = useMemo(() => new Set(plan.restrictions.lockedNodeIds), [plan.restrictions.lockedNodeIds]);
  const violationLinkIds = useMemo(() => new Set(analysis.result.violations.map((item) => item.linkId).filter((id): id is string => Boolean(id))), [analysis.result.violations]);
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
    setContingencies(null); setContingencyStamp(null); setBottleneck(null); setSelectedEvidence(null); setComparison(null); setRoutingOptimization(null);
  };
  const mutatePlan = (fn: (current: ChangePlan) => ChangePlan) => { try { commitPlan(fn(planRef.current)); setImportMessage(''); } catch (error) { setImportMessage(error instanceof Error ? error.message : 'Change Plan action failed.'); } };
  const setStatusOnly = (status: ChangePlan['status'], summary: string) => {
    const next = setChangePlanStatus(planRef.current, status, summary); planRef.current = next; setPlan(next);
  };
  const clearAllDerived = () => {
    cancelAsync(); setPublishedPlanAnalysis(null); setCandidate(null); candidateRef.current = null; setComparison(null); setContingencies(null); setContingencyStamp(null); setBottleneck(null); setSelectedEvidence(null); setSelectedLinkId(null); setSelectedNodeId(null); setOptimizerResult(null); setRoutingOptimization(null); setCandidateVerification(null); setCandidateVerificationStamp(null); setLastToolAnalysis(''); setEphemeralPatch(null); ephemeralRef.current = null;
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

  const toolServices = useMemo<InfraTwinToolServices>(() => ({
    getProject: () => projectRef.current,
    setProject: (next) => replaceBaseProject(next, 'Plan after external apply'),
    getActiveScenario: () => ephemeralRef.current ?? (planRef.current.changes.length ? compileChangePlanToScenarioPatch(projectRef.current, planRef.current) : null),
    setActiveScenario: (next) => { ephemeralRef.current = next; setEphemeralPatch(next); },
    getCapacityAnalysis: () => runScenarioCapacityAnalysis(projectRef.current, ephemeralRef.current ?? (planRef.current.changes.length ? compileChangePlanToScenarioPatch(projectRef.current, planRef.current) : null)),
    publishCapacityAnalysis: (next) => setLastToolAnalysis(`${next.result.verdict} · ${next.routing.mode} · peak ${pct(next.routing.peakUtilizationPct)}`),
    runContingencies: (options) => executeContingencies(options),
    getContingencyAnalysis: () => contingencyRef.current,
    publishContingencyAnalysis: (next) => { if (next.status !== 'cancelled') { contingencyRef.current = next; setContingencies(next); setLastToolAnalysis(`${next.completedScenarios}/${next.totalEligibleScenarios} N-1 scenarios · ${next.status.toUpperCase()} · worst ${next.result.metrics.worstLinkId}`); } },
    publishBottleneckAnalysis: (next) => setBottleneck(next), selectEvidence: (next) => setSelectedEvidence(next),
    getCandidate: () => candidateRef.current, getLockedLinkIds: () => [...planRef.current.restrictions.lockedLinkIds], setCandidate: (next) => { if (next) publishCandidate(next); else { if (planRef.current.proposals.some((proposal) => proposal.state === 'pending')) { const nextPlan = discardCandidateProposals(planRef.current, new Date().toISOString(), 'agent'); planRef.current = nextPlan; setPlan(nextPlan); } candidateRef.current = null; setCandidate(null); } }, publishCandidateComparison: (next) => setComparison(next),
    optimizeCapacity: (requirements, options) => optimizeCapacityInBrowser(projectRef.current, { ...requirements, lockedLinkIds: [...new Set([...(requirements.lockedLinkIds ?? []), ...planRef.current.restrictions.lockedLinkIds])] }, 8_000, options?.signal),
    optimizeRouting: (options) => optimizeRoutingInBrowser(runScenarioCapacityAnalysis(projectRef.current, ephemeralRef.current ?? (planRef.current.changes.length ? compileChangePlanToScenarioPatch(projectRef.current, planRef.current) : null)).snapshot, 5_000, options?.signal),
    verifyCandidate: (nextCandidate, requirements, options) => verifyCandidateInBrowser(projectRef.current, nextCandidate, { ...requirements, lockedLinkIds: [...new Set([...(requirements.lockedLinkIds ?? []), ...planRef.current.restrictions.lockedLinkIds])] }, options?.signal),
    publishOptimizationResult: (next) => setOptimizerResult(next), publishCandidateVerification: (next) => setCandidateVerification(next),
    onActivity: (event) => setActivity((current) => [event, ...current].slice(0, 20)),
  // Services deliberately read refs so registration lifetimes do not churn with React state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext; if (!context?.registerTool) { setWebmcpStatus('unsupported'); setRegisteredTools([]); return; }
    let cleanup: (() => void) | undefined; let active = true; registerCoreTools(context, toolServices).then((dispose) => { if (!active) dispose(); else { cleanup = dispose; setWebmcpStatus('registered'); setRegisteredTools([...CORE_TOOL_NAMES]); } }).catch(() => setWebmcpStatus('error'));
    return () => { active = false; cleanup?.(); };
  }, [toolServices]);
  const canRunResilience = project.links.some((link) => link.available !== false);
  useEffect(() => {
    const names = RESILIENCE_TOOL_NAMES as readonly string[]; if (!canRunResilience) { setRegisteredTools((current) => current.filter((name) => !names.includes(name))); return; }
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext; if (!context?.registerTool) return; let cleanup: (() => void) | undefined; let active = true;
    registerResilienceTools(context, toolServices).then((dispose) => { if (!active) dispose(); else { cleanup = dispose; setRegisteredTools((current) => [...new Set([...current, ...RESILIENCE_TOOL_NAMES])]); } }).catch(() => setWebmcpStatus('error'));
    return () => { active = false; cleanup?.(); setRegisteredTools((current) => current.filter((name) => !names.includes(name))); };
  }, [canRunResilience, toolServices]);
  const hasViolation = analysisAuthoritative && analysis.result.verdict === 'FAIL';
  useEffect(() => {
    const names = VIOLATION_TOOL_NAMES as readonly string[]; if (!hasViolation) { setRegisteredTools((current) => current.filter((name) => !names.includes(name))); return; }
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext; if (!context?.registerTool) return; let cleanup: (() => void) | undefined; let active = true;
    registerViolationTools(context, toolServices).then((dispose) => { if (!active) dispose(); else { cleanup = dispose; setRegisteredTools((current) => [...new Set([...current, ...VIOLATION_TOOL_NAMES])]); } }).catch(() => setWebmcpStatus('error'));
    return () => { active = false; cleanup?.(); setRegisteredTools((current) => current.filter((name) => !names.includes(name))); };
  }, [hasViolation, toolServices]);
  const hasCounterexample = contingencies?.status === 'complete' && Boolean(contingencies.worst);
  useEffect(() => {
    const names = COUNTEREXAMPLE_TOOL_NAMES as readonly string[]; if (!hasCounterexample) { setRegisteredTools((current) => current.filter((name) => !names.includes(name))); return; }
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext; if (!context?.registerTool) return; let cleanup: (() => void) | undefined; let active = true;
    registerCounterexampleTools(context, toolServices).then((dispose) => { if (!active) dispose(); else { cleanup = dispose; setRegisteredTools((current) => [...new Set([...current, ...COUNTEREXAMPLE_TOOL_NAMES])]); } }).catch(() => setWebmcpStatus('error'));
    return () => { active = false; cleanup?.(); setRegisteredTools((current) => current.filter((name) => !names.includes(name))); };
  }, [hasCounterexample, toolServices]);
  const optimizerReady = optimizerStatus === 'ready' || optimizerStatus === 'running';
  useEffect(() => {
    const names = OPTIMIZER_TOOL_NAMES as readonly string[]; if (!optimizerReady) { setRegisteredTools((current) => current.filter((name) => !names.includes(name))); return; }
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext; if (!context?.registerTool) return; let cleanup: (() => void) | undefined; let active = true;
    registerOptimizerTools(context, toolServices).then((dispose) => { if (!active) dispose(); else { cleanup = dispose; setRegisteredTools((current) => [...new Set([...current, ...OPTIMIZER_TOOL_NAMES])]); } }).catch(() => setWebmcpStatus('error'));
    return () => { active = false; cleanup?.(); setRegisteredTools((current) => current.filter((name) => !names.includes(name))); };
  }, [optimizerReady, toolServices]);
  useEffect(() => {
    const names = CANDIDATE_TOOL_NAMES as readonly string[]; if (!candidate) { setRegisteredTools((current) => current.filter((name) => !names.includes(name))); return; }
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext; if (!context?.registerTool) return; let cleanup: (() => void) | undefined; let active = true;
    registerCandidateTools(context, toolServices).then((dispose) => { if (!active) dispose(); else { cleanup = dispose; setRegisteredTools((current) => [...new Set([...current, ...CANDIDATE_TOOL_NAMES])]); } }).catch(() => setWebmcpStatus('error'));
    return () => { active = false; cleanup?.(); setRegisteredTools((current) => current.filter((name) => !names.includes(name))); };
  }, [Boolean(candidate), toolServices]);

  const nextChangeId = (prefix: string) => `${prefix}-${++changeCounterRef.current}`;
  const replaceMatchingChange = (predicate: (item: PlanChange) => boolean, nextChange?: PlanChange) => mutatePlan((current) => {
    let next = current; for (const item of current.changes.filter(predicate)) next = removePlanChange(next, item.id); return nextChange ? addPlanChange(next, nextChange) : next;
  });
  const handleLinkAvailability = (linkId: string, available: boolean) => {
    const existing = [...planRef.current.changes].reverse().find((item) => (item.type === 'disable_link' || item.type === 'enable_link') && item.target.id === linkId);
    const desiredType = available ? 'enable_link' : 'disable_link';
    if (existing?.type === desiredType) return replaceMatchingChange((item) => (item.type === 'disable_link' || item.type === 'enable_link') && item.target.id === linkId);
    replaceMatchingChange((item) => (item.type === 'disable_link' || item.type === 'enable_link') && item.target.id === linkId, { id: nextChangeId('link-availability'), actor: 'human', type: desiredType, target: { kind: 'link', id: linkId }, payload: {}, createdAt: new Date().toISOString() });
  };
  const handleNodeAvailability = (nodeId: string, available: boolean) => {
    const existing = [...planRef.current.changes].reverse().find((item) => (item.type === 'disable_node' || item.type === 'enable_node') && item.target.id === nodeId); const desiredType = available ? 'enable_node' : 'disable_node';
    if (existing?.type === desiredType) return replaceMatchingChange((item) => (item.type === 'disable_node' || item.type === 'enable_node') && item.target.id === nodeId);
    replaceMatchingChange((item) => (item.type === 'disable_node' || item.type === 'enable_node') && item.target.id === nodeId, { id: nextChangeId('node-availability'), actor: 'human', type: desiredType, target: { kind: 'node', id: nodeId }, payload: {}, createdAt: new Date().toISOString() });
  };
  const handleLinkCapacity = (linkId: string, capacityGbps: number) => {
    const base = projectRef.current.links.find((item) => item.id === linkId); if (!base || !Number.isFinite(capacityGbps) || capacityGbps <= 0) return;
    replaceMatchingChange((item) => item.type === 'set_link_capacity' && item.target.id === linkId, Math.abs(base.capacityGbps - capacityGbps) <= 1e-9 ? undefined : { id: nextChangeId('link-capacity'), actor: 'human', type: 'set_link_capacity', target: { kind: 'link', id: linkId }, payload: { capacityGbps }, createdAt: new Date().toISOString() });
  };
  const handleDemandBandwidth = (demandId: string, bandwidthGbps: number) => {
    const base = projectRef.current.demands.find((item) => item.id === demandId); if (!base || !Number.isFinite(bandwidthGbps) || bandwidthGbps < 0) return;
    replaceMatchingChange((item) => item.type === 'set_demand_bandwidth' && item.target.id === demandId, Math.abs(base.bandwidthGbps - bandwidthGbps) <= 1e-9 ? undefined : { id: nextChangeId('demand-bandwidth'), actor: 'human', type: 'set_demand_bandwidth', target: { kind: 'demand', id: demandId }, payload: { bandwidthGbps }, createdAt: new Date().toISOString() });
  };
  const handleAddDemand = (input: { name: string; source: string; target: string; bandwidthGbps: number; serviceClassId: string }) => {
    let id = `PD${++demandCounterRef.current}`; while (projectRef.current.demands.some((item) => item.id === id) || planRef.current.changes.some((item) => item.type === 'add_demand' && item.target.id === id)) id = `PD${++demandCounterRef.current}`;
    mutatePlan((current) => addPlanChange(current, { id: nextChangeId('add-demand'), actor: 'human', type: 'add_demand', target: { kind: 'demand', id }, payload: { demand: { id, ...input } }, createdAt: new Date().toISOString() }));
  };
  const handleGrowth = (demandIds: string[], multiplier: number) => mutatePlan((current) => addPlanChange(current, { id: nextChangeId('growth'), actor: 'human', type: 'demand_growth', target: { kind: 'demands', ids: [...new Set(demandIds)].sort() }, payload: { multiplier }, createdAt: new Date().toISOString() }));

  const batchPlanOutage = (linkIds: string[]) => mutatePlan((current) => {
    let next = current;
    for (const linkId of [...new Set(linkIds)].sort()) {
      for (const item of next.changes.filter((change) => (change.type === 'disable_link' || change.type === 'enable_link') && change.target.id === linkId)) next = removePlanChange(next, item.id);
      next = addPlanChange(next, { id: nextChangeId('link-availability'), actor: 'human', type: 'disable_link', target: { kind: 'link', id: linkId }, payload: {}, createdAt: new Date().toISOString() });
    }
    return next;
  });
  const batchLockLinks = (linkIds: string[], locked: boolean) => mutatePlan((current) => [...new Set(linkIds)].sort().reduce((next, linkId) => setPlanLinkLocked(next, linkId, locked), current));
  const editUpgradeCatalog = (linkIds: string[], options: import('@infratwin/model').LinkUpgradeOption[]) => {
    try {
      const nextProject = applyUpgradeProfile(projectRef.current, linkIds, options);
      setSelectedScenarioId('imported');
      replaceBaseProject(nextProject, `${nextProject.name} change plan`);
      setImportMessage(`Updated the base-network upgrade catalog for ${linkIds.length} link${linkIds.length === 1 ? '' : 's'}. This is a canonical network-assumption edit, so the prior Change Plan was reset rather than silently rebased.`);
    } catch (error) { setImportMessage(error instanceof Error ? error.message : 'Upgrade catalog edit failed.'); }
  };

  const loadNetworkTemplate = (id: BundledScenarioId) => { const next = loadScenario(id); setSelectedScenarioId(id); replaceBaseProject(next, `${getScenarioDefinition(id).title} change plan`); setImportMessage(''); };
  const loadPlanTemplate = () => { if (!definition.changePlanTemplate) return; clearAllDerived(); const next = clonePlan(definition.changePlanTemplate); planRef.current = next; setPlan(next); };
  const newPlan = (name: string) => { clearAllDerived(); const next = createChangePlan(projectRef.current, name, { id: `plan-${projectRef.current.id}-${++planCounterRef.current}` }); planRef.current = next; setPlan(next); };
  const clearPlan = () => newPlan(planRef.current.name);

  const analyzeCurrentPlan = async () => {
    ephemeralRef.current = null; setEphemeralPatch(null); cancelAsync();
    const base = cloneProject(projectRef.current); const planSnapshot = clonePlan(planRef.current);
    const runEpoch = analysisEpochRef.current;
    const token = createAnalysisAuthorityToken(base, planSnapshot, runEpoch);
    const preferredMode = analysisExecutionProfile(base).mode;
    const mode: CapacityExecutionMode = preferredMode === 'worker' && typeof Worker === 'function' ? 'worker' : 'main-thread';
    setAnalysisStatus('running'); setAnalysisMessage(mode === 'worker' ? 'Deterministic Change Plan analysis is running in a browser Worker…' : 'Deterministic Change Plan analysis is running on the main thread…');
    let result: ChangePlanAnalysis;
    let runtimeMs = 0;
    try {
      if (mode === 'worker') {
        const controller = new AbortController(); analysisControllerRef.current = controller;
        const workerResult = await analyzeChangePlanInBrowserWorker(base, planSnapshot, controller.signal);
        result = workerResult.analysis; runtimeMs = workerResult.runtimeMs;
        if (analysisControllerRef.current === controller) analysisControllerRef.current = null;
      } else {
        const startedAt = performance.now(); result = analyzeChangePlan(base, planSnapshot); runtimeMs = Math.round((performance.now() - startedAt) * 1000) / 1000;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') { setAnalysisStatus('cancelled'); setAnalysisMessage('Analysis cancelled; no result was published.'); return; }
      setAnalysisStatus('error'); setAnalysisMessage(error instanceof Error ? error.message : 'Capacity analysis failed.'); return;
    }
    if (!isAnalysisAuthorityTokenCurrent(token, projectRef.current, planRef.current, runEpoch)) { setAnalysisStatus('cancelled'); setAnalysisMessage('Stale analysis result discarded because the network or Change Plan changed.'); return; }
    setPublishedPlanAnalysis(result); setLastAnalysisRuntimeMs(runtimeMs); setLastAnalysisExecution(mode); setAnalysisStatus('complete'); setAnalysisMessage(`${mode === 'worker' ? 'Worker' : 'Main thread'} · ${runtimeMs} ms measured on this browser run.`);
    setBottleneck(null); setSelectedEvidence(result.capacity.result.witnesses.find((item) => item.type === 'route' || item.type === 'link') ?? null);
    let n1Fail = false; let n1Incomplete = false;
    if (planSnapshot.constraints.requireN1 && base.links.some((link) => link.available !== false)) {
      const controller = new AbortController(); directRunControllerRef.current = controller;
      try {
        const next = await executeContingencies({ signal: controller.signal, ...(() => { const policy = n1ExecutionPolicy(base); return { maxScenarios: policy.maxScenarios, timeLimitMs: policy.timeLimitMs }; })() }, { project: base, patch: result.patch });
        if (next.status === 'cancelled' || !isPlanEvidenceFresh(result.stamp, projectRef.current, planRef.current)) return;
        contingencyRef.current = next; setContingencies(next); setContingencyStamp(result.stamp); n1Fail = Number(next.result.metrics.failingScenarios ?? 0) > 0; n1Incomplete = next.status !== 'complete';
      } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) { setResilienceStatus('error'); setResilienceMessage(error instanceof Error ? error.message : 'N-1 analysis failed.'); } return; }
      finally { if (directRunControllerRef.current === controller) directRunControllerRef.current = null; }
    } else { setContingencies(null); setContingencyStamp(null); }
    if (!isPlanEvidenceFresh(result.stamp, projectRef.current, planRef.current)) return;
    const fail = result.verdict === 'FAIL' || n1Fail || n1Incomplete;
    const n1Summary = planSnapshot.constraints.requireN1 ? (n1Incomplete ? ' with partial N-1 coverage' : ' including complete N-1') : '';
    setStatusOnly(fail ? 'failing' : 'analyzed', `Plan analyzed: ${fail ? 'FAIL' : 'PASS'}${n1Summary}.`);
  };
  const runPlanN1 = async () => {
    ephemeralRef.current = null; setEphemeralPatch(null); const stamp = changePlanEvidenceStamp(projectRef.current, planRef.current); const patch = compileChangePlanToScenarioPatch(projectRef.current, planRef.current); const controller = new AbortController(); directRunControllerRef.current = controller; const policy = n1ExecutionPolicy(projectRef.current);
    try { const next = await executeContingencies({ signal: controller.signal, maxScenarios: policy.maxScenarios, timeLimitMs: policy.timeLimitMs }, { project: cloneProject(projectRef.current), patch }); if (next.status !== 'cancelled' && isPlanEvidenceFresh(stamp, projectRef.current, planRef.current)) { contingencyRef.current = next; setContingencies(next); setContingencyStamp(stamp); } }
    catch (error) { setResilienceStatus(error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'error'); setResilienceMessage(error instanceof Error ? error.message : 'N-1 failed.'); }
    finally { if (directRunControllerRef.current === controller) directRunControllerRef.current = null; }
  };
  const replayContingency = (linkId: string) => { const item = contingencies?.cases.find((entry) => entry.linkId === linkId); if (!item) return; ephemeralRef.current = item.patch; setEphemeralPatch(item.patch); setSelectedEvidence({ type: 'link', id: item.linkId }); setSelectedLinkId(item.linkId); setSelectedNodeId(null); setBottleneck(null); };
  const inspectCurrentBottleneck = () => { const demandId = analysis.result.violations.find((item) => item.demandId)?.demandId; const demand = demandId ? snapshot.demands.find((item) => item.id === demandId) : [...snapshot.demands].sort((a, b) => b.bandwidthGbps - a.bandwidthGbps)[0]; if (!demand) return; const next = analyzeBottleneck(projectRef.current, demand.source, demand.target, solverPatch); setBottleneck(next); setSelectedEvidence(next.evidence); };

  const optimizerRequirements = (n1 = contingencies): CapacityPlanRequirements => {
    const currentPlan = planRef.current; const patches: ScenarioPatch[] = [];
    if (currentPlan.changes.length) patches.push(compileChangePlanToScenarioPatch(projectRef.current, currentPlan));
    if (currentPlan.constraints.requireN1 && n1?.status === 'complete') for (const item of n1.cases) patches.push(item.patch);
    return { targetUtilizationPct: currentPlan.constraints.targetUtilizationPct, budgetCostUnits: currentPlan.constraints.budgetCostUnits ?? undefined, includeBaseline: true, scenarioPatches: patches, lockedLinkIds: [...currentPlan.restrictions.lockedLinkIds] };
  };
  const runOptimizer = async () => {
    optimizerControllerRef.current?.abort(); const controller = new AbortController(); optimizerControllerRef.current = controller; setOptimizerStatus('running'); setOptimizerMessage('Solving constrained capacity MILP off the main thread…'); setOptimizerResult(null); setCandidateVerification(null); setCandidateVerificationStamp(null);
    const expectedPlanHash = changePlanHash(planRef.current); const expectedModelHash = modelHash(projectRef.current); let currentN1 = contingencies;
    try {
      if (planRef.current.constraints.requireN1 && !n1Fresh) {
        const stamp = changePlanEvidenceStamp(projectRef.current, planRef.current); const planPatch = compileChangePlanToScenarioPatch(projectRef.current, planRef.current); const policy = n1ExecutionPolicy(projectRef.current); currentN1 = await executeContingencies({ signal: controller.signal, maxScenarios: policy.maxScenarios, timeLimitMs: policy.timeLimitMs }, { project: cloneProject(projectRef.current), patch: planPatch });
        if (currentN1.status !== 'complete') throw new Error('N-1 constraint was not fully evaluated; optimizer candidate was not published.');
        if (!isPlanEvidenceFresh(stamp, projectRef.current, planRef.current)) throw new Error('Plan changed during N-1 evaluation.');
        setContingencies(currentN1); setContingencyStamp(stamp);
      }
      const requirements = optimizerRequirements(currentN1); const result = await optimizeCapacityInBrowser(cloneProject(projectRef.current), requirements, 8_000, controller.signal);
      if (modelHash(projectRef.current) !== expectedModelHash || changePlanHash(planRef.current) !== expectedPlanHash) { setOptimizerStatus('ready'); setOptimizerMessage('Stale optimizer result discarded because the base or Change Plan changed.'); return; }
      setOptimizerResult(result); if (result.candidate) { publishCandidate(result.candidate); setComparison(compareCandidate(projectRef.current, result.candidate, planRef.current.changes.length ? compileChangePlanToScenarioPatch(projectRef.current, planRef.current) : null)); } else { candidateRef.current = null; setCandidate(null); }
      setOptimizerStatus('ready'); setOptimizerMessage(`${result.diagnostics.status} · ${result.diagnostics.proof} · ${result.diagnostics.runtimeMs} ms${result.diagnostics.message ? ` · ${result.diagnostics.message}` : ''}`);
    } catch (error) { if (error instanceof Error && error.name === 'AbortError') { setOptimizerStatus('ready'); setOptimizerMessage('Optimizer cancelled; no candidate was published.'); } else { setOptimizerStatus('ready'); setOptimizerMessage(error instanceof Error ? error.message : 'Optimizer failed.'); } }
    finally { if (optimizerControllerRef.current === controller) optimizerControllerRef.current = null; }
  };
  const quickMitigation = () => { const headroom = Math.max(0, 100 - planRef.current.constraints.targetUtilizationPct); const next = proposeCapacityMitigation(projectRef.current, planRef.current.changes.length ? compileChangePlanToScenarioPatch(projectRef.current, planRef.current) : null, headroom, planRef.current.restrictions.lockedLinkIds); if (next) publishCandidate(next); else setOptimizerMessage('No unlocked deterministic capacity mitigation is available for the current plan.'); };
  const verifyCurrentCandidate = async () => {
    if (!candidateRef.current) return; if (candidateStale) { setOptimizerMessage('Candidate is stale because the Change Plan changed. Re-run optimization.'); return; }
    const stamp = changePlanRevisionStamp(projectRef.current, planRef.current); const currentCandidate = candidateRef.current; const requirements = optimizerRequirements();
    try { const result = await verifyCandidateInBrowser(cloneProject(projectRef.current), currentCandidate, requirements); if (!isPlanRevisionFresh(stamp, projectRef.current, planRef.current)) { setOptimizerMessage('Stale candidate verification discarded because the plan changed.'); return; } setCandidateVerification(result); setCandidateVerificationStamp(stamp); if (result.status === 'verified') setStatusOnly('verified', 'Optimizer candidate independently verified against the current Change Plan.'); }
    catch (error) { setOptimizerMessage(error instanceof Error ? error.message : 'Candidate verification failed.'); }
  };
  const runRoutingOptimizer = async () => { try { const result = await optimizeRoutingInBrowser(analysis.snapshot, 5_000); setRoutingOptimization(result); } catch (error) { setOptimizerMessage(error instanceof Error ? error.message : 'Routing LP failed.'); } };
  const acceptProposal = (id: string) => { try { const next = acceptCandidateChange(planRef.current, id); commitPlan(next); if (!next.proposals.some((item) => item.state === 'pending')) { candidateRef.current = null; setCandidate(null); } } catch (error) { setImportMessage(error instanceof Error ? error.message : 'Proposal could not be accepted.'); } };
  const rejectProposal = (id: string) => { try { const next = rejectCandidateChange(planRef.current, id); commitPlan(next); if (!next.proposals.some((item) => item.state === 'pending')) { candidateRef.current = null; setCandidate(null); } } catch (error) { setImportMessage(error instanceof Error ? error.message : 'Proposal could not be rejected.'); } };
  const acceptAll = () => { try { const next = acceptAllCandidateChanges(planRef.current); commitPlan(next); candidateRef.current = null; setCandidate(null); } catch (error) { setImportMessage(error instanceof Error ? error.message : 'Proposals could not be accepted.'); } };
  const discardCandidate = () => { const next = discardCandidateProposals(planRef.current); commitPlan(next); candidateRef.current = null; setCandidate(null); };

  const exportProject = () => { const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${project.id}.json`; anchor.click(); URL.revokeObjectURL(url); };
  const openImportedProject = (next: NetworkProject, message: string) => { setSelectedScenarioId('imported'); replaceBaseProject(cloneProject(next), `${next.name} change plan`); setImportMessage(`${message} External text is treated as project data, not instructions.`); };
  const selectViolation = (violation: CapacityAnalysis['result']['violations'][number]) => { if (violation.demandId) { const route = routeByDemand.get(violation.demandId); setSelectedEvidence({ type: 'route', id: `route:${violation.demandId}`, demandId: violation.demandId, linkIds: allRouteLinks(route) }); } else if (violation.linkId) setSelectedEvidence({ type: 'link', id: violation.linkId }); };

  const authority: 'DRAFT' | 'PASS' | 'FAIL' | 'STALE' = publishedPlanAnalysis ? (analysisFresh ? publishedPlanAnalysis.verdict : 'STALE') : 'DRAFT';
  const peak = analysis.routing.peakUtilizationPct;
  const primaryFailure = analysis.result.violations[0]?.linkId ?? analysis.result.violations[0]?.demandId ?? null;
  const progressLabel = progress ? `${progress.completed}/${progress.total} · ${pct(progress.percentage)}` : 'idle';
  const regionCount = new Set(project.nodes.map((node) => node.region).filter(Boolean)).size;
  const n1Policy = useMemo(() => n1ExecutionPolicy(project), [project]);
  const eligibleN1 = n1Policy.eligibleScenarios;
  const routingLpEstimate = useMemo(() => estimateTrafficAllocationLP(project), [project]);
  const capacityMilpEstimate = useMemo(() => estimateCapacityMILP(project, { includeBaseline: true, targetUtilizationPct: plan.constraints.targetUtilizationPct, budgetCostUnits: plan.constraints.budgetCostUnits ?? undefined, scenarioPatches: plan.changes.length ? [compiledPlanPatch] : [] }), [project, plan.constraints.targetUtilizationPct, plan.constraints.budgetCostUnits, plan.changes.length, compiledPlanPatch]);
  const n1Guidance = n1Policy.guidance;
  const selectedSnapshotLink = selectedCanonicalLink ? snapshot.links.find((link) => link.id === selectedCanonicalLink.id) : undefined;
  const selectedRoute = selectedCanonicalDemand ? routeByDemand.get(selectedCanonicalDemand.id) : undefined;
  const settingsLink = project.links.find((link) => link.id === settingsLinkId);
  const analysisStatusLabel = authority === 'DRAFT' ? 'Plan has not been analyzed.' : authority === 'STALE' ? 'Plan changed since the last analysis.' : authority === 'PASS' ? 'No modeled violations.' : `${analysis.result.violations.length} violation${analysis.result.violations.length === 1 ? '' : 's'} · Peak ${pct(peak)}`;

  const renderPlanResultSummary = () => (
    <section data-testid="plan-analysis-status" className={`plan-result-summary result-${authority.toLowerCase()}`} aria-label="Current plan result">
      <div data-testid="evidence-panel" className="result-evidence">
        <div>
          <span className="section-kicker">{ephemeralPatch ? 'Counterexample replay' : 'Plan result'}</span>
          <strong data-testid="verdict">{ephemeralPatch ? analysis.result.verdict : authority}</strong>
        </div>
        <p>{ephemeralPatch ? `${ephemeralPatch.name} · ${analysis.result.violations.length} modeled violation${analysis.result.violations.length === 1 ? '' : 's'}.` : analysisStatusLabel}</p>
        {ephemeralPatch && analysis.result.violations.length > 0 && <small>Replay issues: {analysis.result.violations.slice(0, 8).map((item) => item.linkId ?? item.demandId ?? item.message).filter(Boolean).join(', ')}</small>}
        {!ephemeralPatch && authority === 'FAIL' && primaryFailure && <small>Primary issue: {primaryFailure}</small>}
      </div>
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
      {!selectedCanonicalLink && !selectedCanonicalNode && !selectedCanonicalDemand && <section className="inspector-section" data-testid="network-inspector-empty">
        <h3>{project.name}</h3>
        <dl className="compact-metrics"><div><dt>Nodes</dt><dd>{project.nodes.length}</dd></div><div><dt>Links</dt><dd>{project.links.length}</dd></div><div><dt>Demands</dt><dd>{project.demands.length}</dd></div><div><dt>Regions</dt><dd>{regionCount}</dd></div></dl>
        <p className="muted compact-copy">Select a link, node, or demand in the topology to inspect and edit relevant plan state.</p>
      </section>}
      {selectedCanonicalLink && <section className="inspector-section" data-testid={`link-inspector-${selectedCanonicalLink.id}`}>
        <div className="inspector-title"><div><span>Link</span><h3>{selectedCanonicalLink.id}</h3></div><strong className="mono">{selectedCanonicalLink.id}</strong></div>
        <dl className="compact-metrics"><div><dt>Endpoints</dt><dd>{selectedCanonicalLink.source} ↔ {selectedCanonicalLink.target}</dd></div><div><dt>Capacity</dt><dd>{gbps(selectedSnapshotLink?.capacityGbps ?? selectedCanonicalLink.capacityGbps)}</dd></div><div><dt>Load</dt><dd>{gbps(analysis.routing.linkLoadsGbps[selectedCanonicalLink.id] ?? 0)}</dd></div><div><dt>Utilization</dt><dd>{pct(analysis.routing.linkUtilizationPct[selectedCanonicalLink.id] ?? 0)}</dd></div><div><dt>Availability</dt><dd>{selectedSnapshotLink?.available === false ? 'Unavailable' : 'Available'}</dd></div><div><dt>Plan state</dt><dd>{plannedOutageLinkIds.has(selectedCanonicalLink.id) ? 'Planned outage' : plannedChangedLinkIds.has(selectedCanonicalLink.id) ? 'Modified' : 'Unchanged'}</dd></div></dl>
        <div className="inspector-actions"><button type="button" data-testid={`plan-link-outage-${selectedCanonicalLink.id}`} onClick={() => handleLinkAvailability(selectedCanonicalLink.id, plannedOutageLinkIds.has(selectedCanonicalLink.id))}>{plannedOutageLinkIds.has(selectedCanonicalLink.id) ? 'Remove planned outage' : 'Add outage'}</button><label className="check-action"><input type="checkbox" data-testid={`lock-link-${selectedCanonicalLink.id}`} checked={lockedLinkIds.has(selectedCanonicalLink.id)} onChange={(event) => mutatePlan((current) => setPlanLinkLocked(current, selectedCanonicalLink.id, event.target.checked))} />Lock link</label></div>
        <div className="inline-edit"><label>Planned capacity (Gbps)<input data-testid="link-capacity-input" type="number" min="0.1" step="1" value={inspectorCapacityDraft ?? ''} onChange={(event) => setInspectorCapacityDraft(event.target.value === '' ? null : Number(event.target.value))} /></label><button type="button" data-testid={`plan-link-capacity-${selectedCanonicalLink.id}`} disabled={inspectorCapacityDraft === null} onClick={() => inspectorCapacityDraft !== null && handleLinkCapacity(selectedCanonicalLink.id, inspectorCapacityDraft)}>Apply</button></div>
        <button type="button" className="text-action" onClick={() => { setSettingsLinkId(selectedCanonicalLink.id); setActiveView('settings'); }}>Edit upgrade catalog</button>
      </section>}
      {selectedCanonicalNode && <section className="inspector-section" data-testid={`node-inspector-${selectedCanonicalNode.id}`}>
        <div className="inspector-title"><div><span>Node</span><h3>{selectedCanonicalNode.name ?? selectedCanonicalNode.id}</h3></div><strong className="mono">{selectedCanonicalNode.id}</strong></div>
        <dl className="compact-metrics"><div><dt>Region</dt><dd>{selectedCanonicalNode.region ?? 'Unassigned'}</dd></div><div><dt>Type</dt><dd>{selectedCanonicalNode.type ?? 'node'}</dd></div><div><dt>Availability</dt><dd>{selectedCanonicalNode.available === false || plannedOutageNodeIds.has(selectedCanonicalNode.id) ? 'Unavailable in plan' : 'Available'}</dd></div><div><dt>Plan state</dt><dd>{plannedChangedNodeIds.has(selectedCanonicalNode.id) ? 'Modified' : 'Unchanged'}</dd></div></dl>
        <div className="inspector-actions"><button type="button" data-testid={`plan-node-outage-${selectedCanonicalNode.id}`} onClick={() => handleNodeAvailability(selectedCanonicalNode.id, plannedOutageNodeIds.has(selectedCanonicalNode.id))}>{plannedOutageNodeIds.has(selectedCanonicalNode.id) ? 'Remove planned outage' : 'Add outage'}</button><label className="check-action"><input type="checkbox" data-testid={`lock-node-${selectedCanonicalNode.id}`} checked={lockedNodeIds.has(selectedCanonicalNode.id)} onChange={(event) => mutatePlan((current) => setPlanNodeLocked(current, selectedCanonicalNode.id, event.target.checked))} />Lock node</label></div>
      </section>}
      {selectedCanonicalDemand && <section className="inspector-section" data-testid={`demand-inspector-${selectedCanonicalDemand.id}`}>
        <div className="inspector-title"><div><span>Demand</span><h3>{selectedCanonicalDemand.name ?? selectedCanonicalDemand.id}</h3></div><strong className="mono">{selectedCanonicalDemand.id}</strong></div>
        <dl className="compact-metrics"><div><dt>Path</dt><dd>{selectedCanonicalDemand.source} → {selectedCanonicalDemand.target}</dd></div><div><dt>Bandwidth</dt><dd>{gbps(selectedCanonicalDemand.bandwidthGbps)}</dd></div><div><dt>Service class</dt><dd>{selectedCanonicalDemand.serviceClassId}</dd></div><div><dt>Route</dt><dd>{selectedRoute?.reachable ? `${selectedRoute.equalCostPathCountExact} equal-cost path(s)` : 'Unreachable / not analyzed'}</dd></div></dl>
        <button type="button" className="primary wide" data-testid="edit-demand-plan" onClick={() => { setTrafficEditorOpen(true); setLeftPanelCollapsed(false); }}>Edit traffic plan</button>
      </section>}
      {ephemeralPatch && <section className="inspector-section counterexample-state"><span className="section-kicker">Counterexample replay</span><strong>{ephemeralPatch.name}</strong><button data-testid="return-to-plan" onClick={() => { ephemeralRef.current = null; setEphemeralPatch(null); }}>Return to planned state</button></section>}
    </aside>
  );

  const analysisTabs: { id: AnalysisTab; label: string }[] = ANALYSIS_TABS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) }));

  return <main className="shell" data-testid="application-shell">
    <header className="appbar">
      <div className="brand-block"><strong>InfraTwin</strong><span>Plan and verify network changes before production.</span></div>
      <nav className="destination-nav" aria-label="Primary application views">
        {APP_DESTINATIONS.map((view) => <button key={view} data-testid={`nav-${view}`} className={activeView === view ? 'active' : ''} onClick={() => setActiveView(view)}>{view === 'settings' ? 'Settings / Model' : view[0].toUpperCase() + view.slice(1)}</button>)}
      </nav>
      <ScenarioSelector scenarios={networkTemplates} selectedId={selectedScenarioId} selectedLabel={project.name} onSelect={(id) => loadNetworkTemplate(id)} />
      <div className="appbar-actions"><button data-testid="import-json" onClick={() => setImportDialogOpen(true)}>Import</button><button data-testid="export-json" onClick={exportProject}>Export</button><button data-testid="advanced-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value) => !value)}>Advanced</button></div>
    </header>
    <ImportNetworkDialog open={importDialogOpen} onClose={() => setImportDialogOpen(false)} onOpenProject={openImportedProject} />
    {importMessage && <div className="floating-notice" role="status">{importMessage}</div>}

    <div className="app-main">
      <section className="network-view" data-testid="network-view" hidden={activeView !== 'network'}>
        <div className="network-toolbar">
          <div className="toolbar-context" data-testid="network-scale"><h1>{project.name}</h1><span>{project.nodes.length} nodes · {project.links.length} links · {project.demands.length} demands</span><span className="toolbar-plan">{plan.name} · {plan.changes.length} change{plan.changes.length === 1 ? '' : 's'} · {plan.restrictions.lockedLinkIds.length + plan.restrictions.lockedNodeIds.length} lock{plan.restrictions.lockedLinkIds.length + plan.restrictions.lockedNodeIds.length === 1 ? '' : 's'}</span></div>
          <div className="primary-actions">{analysisStatus !== 'running' ? <button data-testid="analyze-plan" className="primary" onClick={() => void analyzeCurrentPlan()}>Analyze Plan</button> : <button data-testid="cancel-analysis" className="danger" onClick={() => analysisControllerRef.current?.abort()}>Cancel analysis</button>}{resilienceStatus !== 'running' ? <button data-testid="run-resilience" disabled={!canRunResilience} onClick={() => void runPlanN1()}>Run N-1</button> : <button data-testid="cancel-resilience" className="danger" onClick={() => directRunControllerRef.current?.abort()}>Cancel N-1</button>}<button data-testid="run-optimizer" disabled={!optimizerReady || optimizerStatus === 'running'} onClick={() => void runOptimizer()}>Find Mitigation</button></div>
          <div className="panel-controls"><button data-testid="toggle-left-panel" aria-pressed={leftPanelCollapsed} onClick={() => setLeftPanelCollapsed((value) => !value)}>{leftPanelCollapsed ? 'Show plan' : 'Hide plan'}</button><button data-testid="toggle-right-panel" aria-pressed={rightPanelCollapsed} onClick={() => setRightPanelCollapsed((value) => !value)}>{rightPanelCollapsed ? 'Show inspector' : 'Hide inspector'}</button></div>
        </div>
        <div className={`network-workspace ${leftPanelCollapsed ? 'left-collapsed' : ''} ${rightPanelCollapsed ? 'right-collapsed' : ''}`}>
          <div className="workspace-pane plan-pane" aria-hidden={leftPanelCollapsed}>
            <ChangePlanPanel project={project} plan={plan} trafficEditorOpen={trafficEditorOpen} onTrafficEditorOpenChange={setTrafficEditorOpen} onRenamePlan={(name) => { if (name.trim() && name.trim() !== planRef.current.name) mutatePlan((current) => renameChangePlan(current, name)); }} onRemoveChange={(id) => mutatePlan((current) => removePlanChange(current, id))} onSetConstraint={(key, value) => mutatePlan((current) => setPlanConstraint(current, key, value as never))} onSetBandwidth={handleDemandBandwidth} onAddDemand={handleAddDemand} onAddGrowth={handleGrowth} onAcceptProposal={acceptProposal} onRejectProposal={rejectProposal} onAcceptAll={acceptAll} onDiscardCandidate={discardCandidate} onVerifyProposal={() => void verifyCurrentCandidate()} candidateStale={candidateStale} />
          </div>
          <section className="topology-pane" data-testid="topology-pane" aria-label="Network topology workspace">
            <TopologyCanvas project={project} analysis={analysis} selectedLinkIds={selectedLinkIds} selectedLinkId={selectedLinkId} selectedNodeId={selectedNodeId} selectedDemandId={selectedDemandId} plannedOutageLinkIds={plannedOutageLinkIds} plannedOutageNodeIds={plannedOutageNodeIds} plannedChangedLinkIds={plannedChangedLinkIds} plannedChangedNodeIds={plannedChangedNodeIds} proposalLinkIds={proposalLinkIds} proposalNodeIds={proposalNodeIds} lockedLinkIds={lockedLinkIds} lockedNodeIds={lockedNodeIds} violationLinkIds={violationLinkIds} onSelectLink={(id) => { setSelectedLinkId(id); setSelectedNodeId(null); setSelectedEvidence({ type: 'link', id }); }} onSelectNode={(id) => { setSelectedNodeId(id); setSelectedLinkId(null); setSelectedEvidence(null); }} onSelectDemand={(id) => { setSelectedLinkId(null); setSelectedNodeId(null); setSelectedEvidence({ type: 'demand', id, demandId: id, linkIds: allRouteLinks(routeByDemand.get(id)) }); }} onBatchPlannedOutage={batchPlanOutage} onBatchLockLinks={batchLockLinks} />
          </section>
          <div className="inspector-slot" aria-hidden={rightPanelCollapsed}>{renderInspector()}</div>
        </div>
      </section>

      {activeView === 'analysis' && <section className="destination-view analysis-view" data-testid="analysis-view">
        <header className="destination-heading"><div><span className="section-kicker">Analysis</span><h1>{project.name}</h1></div><div className={`destination-verdict result-${authority.toLowerCase()}`}><strong>{authority}</strong><span>{analysisStatusLabel}</span></div></header>
        <nav className="subtab-nav" aria-label="Analysis sections">{analysisTabs.map((tab) => <button key={tab.id} data-testid={`analysis-tab-${tab.id}`} className={analysisTab === tab.id ? 'active' : ''} onClick={() => setAnalysisTab(tab.id)}>{tab.label}</button>)}</nav>
        <div className="destination-scroll">
          {analysisTab === 'summary' && <div className="analysis-section" data-testid="analysis-summary"><div className="section-grid"><section><h2>Current result</h2><dl className="compact-metrics"><div><dt>Verdict</dt><dd>{authority}</dd></div><div><dt>Peak utilization</dt><dd>{analysisAuthoritative ? pct(peak) : 'Not analyzed'}</dd></div><div><dt>Unrouted demands</dt><dd>{analysisAuthoritative ? analysis.routing.unroutedDemandIds.length : '—'}</dd></div><div><dt>Target</dt><dd>{pct(plan.constraints.targetUtilizationPct)}</dd></div></dl>{publishedPlanAnalysis && <p>{analysisFresh ? publishedPlanAnalysis.reasons.join(' ') : 'Evidence is stale because the base network or Change Plan changed.'}</p>}</section><section><h2>Execution</h2><p>{analysisStatus === 'idle' ? 'No explicit analysis run is active.' : analysisMessage}</p>{resilienceStatus !== 'idle' && <div data-testid="analysis-resilience-status"><strong>N-1 {resilienceStatus}</strong><p>{resilienceMessage || progressLabel}</p></div>}</section><section><h2>Mitigation</h2><p>{pendingProposals.length ? `${pendingProposals.length} proposal changes are waiting for review in the Change Plan.` : 'No mitigation proposal is pending.'}</p><div className="inline-actions"><button data-testid="propose-deterministic" disabled={!analysisAuthoritative || analysis.result.verdict !== 'FAIL'} onClick={quickMitigation}>Quick deterministic proposal</button></div>{comparison && <p>Candidate peak: {pct(comparison.after.routing.peakUtilizationPct)} from {pct(comparison.before.routing.peakUtilizationPct)}.</p>}</section></div></div>}
          {analysisTab === 'routes' && <div className="analysis-section" data-testid="analysis-routes"><h2>Routes</h2><div className="demand-list">{snapshot.demands.length === 0 ? <p className="empty">No demands in the effective snapshot.</p> : snapshot.demands.map((demand) => { const route = routeByDemand.get(demand.id); const links = allRouteLinks(route); return <button className="demand-route standalone" key={demand.id} onClick={() => setSelectedEvidence({ type: 'route', id: `route:${demand.id}`, demandId: demand.id, linkIds: links })}><strong>{demand.id} · {demand.name ?? demand.id} · {gbps(demand.bandwidthGbps)}</strong><small>{route?.reachable ? `${route.equalCostPathCountExact} equal-cost path(s) · ${links.join(' / ') || 'local'}` : 'unreachable'} · {demand.serviceClassId}</small></button>; })}</div></div>}
          {analysisTab === 'violations' && <div className="analysis-section" data-testid="analysis-violations"><h2>Violations</h2><div className="violation-list">{!analysisAuthoritative ? <p className="empty">Analyze the current plan to publish authoritative violations.</p> : analysis.result.violations.length === 0 ? <p className="empty">No modeled routing/capacity violations.</p> : <>{visibleViolations.map((violation) => <button className="violation" key={violation.id} onClick={() => selectViolation(violation)}><strong>{violation.type.replaceAll('_', ' ')}</strong><p>{violation.message}</p></button>)}{visibleViolations.length < analysis.result.violations.length && <button type="button" className="secondary wide" data-testid="show-more-violations" onClick={() => setViolationDisplay({ resultId: analysis.result.id, count: Math.min(analysis.result.violations.length, visibleViolations.length + VIOLATION_RENDER_BATCH_SIZE) })}>Show more violations · {visibleViolations.length.toLocaleString()} / {analysis.result.violations.length.toLocaleString()} shown</button>}</>}</div></div>}
          {analysisTab === 'contingencies' && <div className="analysis-section" data-testid="analysis-contingencies"><div className="section-heading-row"><div><h2>Contingencies</h2><p>{n1Fresh && contingencies ? `${contingencies.completedScenarios}/${contingencies.totalEligibleScenarios} failures tested · ${contingencies.status.toUpperCase()}` : 'No current N-1 result.'}</p></div><button data-testid="run-resilience-analysis" disabled={!canRunResilience || resilienceStatus === 'running'} onClick={() => void runPlanN1()}>Run N-1</button></div>{contingencies && n1Fresh ? <div data-testid="contingency-list" className="contingency-list">{contingencies.cases.slice(0, 50).map((item, index) => <button data-testid={`counterexample-${item.linkId}`} key={item.linkId} className={ephemeralPatch?.id === item.patch.id ? 'active' : ''} onClick={() => { replayContingency(item.linkId); setActiveView('network'); }}><span>#{index + 1} · {item.linkId}</span><strong>{item.verdict}</strong><small>score {item.score} · peak {pct(item.peakUtilizationPct)} · unsatisfied {gbps(item.unroutedDemandGbps)}</small></button>)}</div> : <p className="muted">Run exact bounded N-1 to generate replayable single-link cases.</p>}</div>}
          {analysisTab === 'bottlenecks' && <div className="analysis-section" data-testid="analysis-bottlenecks"><div className="section-heading-row"><div><h2>Bottlenecks</h2><p>Inspect deterministic min-cut evidence for the current failing flow.</p></div><button disabled={!analysisAuthoritative || analysis.result.verdict !== 'FAIL'} onClick={inspectCurrentBottleneck}>Find min-cut bottleneck</button></div>{bottleneck ? <div className="evidence-block cut-block"><strong>{bottleneck.sourceId} → {bottleneck.targetId}: {gbps(bottleneck.cut.cutCapacityGbps)}</strong><p>Cut links: {bottleneck.cut.cutLinkIds.join(', ') || 'none'} · headroom {gbps(bottleneck.headroomGbps)}</p></div> : <p className="muted">No bottleneck inspection selected.</p>}</div>}
          {analysisTab === 'evidence' && <div className="analysis-section" data-testid="analysis-evidence"><h2>Evidence</h2><div className={`evidence-currentness ${analysisFresh ? 'current' : 'stale'}`}><span>Evidence</span><strong>{analysisFresh ? '✓ Current' : publishedPlanAnalysis ? 'STALE' : 'Not published'}</strong></div>{analysisAuthoritative && analysis.result.witnesses.length ? <div className="evidence-list">{analysis.result.witnesses.slice(0, 100).map((witness) => <button key={witness.id} onClick={() => setSelectedEvidence(witness)}><strong>{witness.type}</strong><span>{witness.id}</span></button>)}</div> : <p className="muted">No published evidence for the current plan.</p>}</div>}
        </div>
      </section>}

      {activeView === 'plans' && <section className="destination-view plans-view" data-testid="plans-view"><header className="destination-heading"><div><span className="section-kicker">Plans</span><h1>Change Plan workspace</h1><p>Organize current plan metadata, examples, and semantic activity. Edit operational changes in Network.</p></div></header><div className="destination-scroll"><div className="plans-grid"><section className="plain-section"><h2>Current plan</h2><dl className="compact-metrics"><div><dt>Name</dt><dd>{plan.name}</dd></div><div><dt>Status</dt><dd>{plan.status}</dd></div><div><dt>Changes</dt><dd>{plan.changes.length}</dd></div><div><dt>Locks</dt><dd>{plan.restrictions.lockedLinkIds.length + plan.restrictions.lockedNodeIds.length}</dd></div></dl><div className="new-plan-row"><input aria-label="New plan name" value={newPlanName} onChange={(event) => setNewPlanName(event.target.value)} /><button data-testid="new-plan" onClick={() => newPlan(newPlanName.trim() || 'Change Plan')}>New plan</button><button data-testid="clear-plan" onClick={clearPlan}>Clear plan</button></div></section><section className="plain-section"><h2>Template / example plan</h2>{definition.changePlanTemplate ? <><p>{definition.title} includes a prepared Change Plan for this network.</p><button data-testid="load-plan-template" onClick={loadPlanTemplate}>Load example plan</button></> : <p className="muted">This network does not include a prepared plan template.</p>}</section><section className="plain-section plan-history-section"><h2>History / activity</h2><PlanHistory events={plan.history} /></section></div></div></section>}

      {activeView === 'settings' && <section className="destination-view settings-view" data-testid="settings-view"><header className="destination-heading"><div><span className="section-kicker">Settings / Model</span><h1>Network model and assumptions</h1><p>These settings define the canonical network design space. They are separate from the current Change Plan.</p></div></header><div className="destination-scroll"><div className="settings-grid"><section className="plain-section"><h2>Routing profile</h2><dl className="compact-metrics"><div><dt>Mode</dt><dd>{project.routingProfile.mode}</dd></div><div><dt>Routing policy</dt><dd>Link weight</dd></div><div><dt>Service classes</dt><dd>{project.serviceClasses.length}</dd></div></dl><div className="service-class-list">{project.serviceClasses.map((item) => <div key={item.id}><strong>{item.name}</strong><span>{item.id}</span></div>)}</div></section><section className="plain-section settings-upgrades"><h2>Upgrade catalog</h2><label>Link<select data-testid="settings-upgrade-link" value={settingsLinkId} onChange={(event) => setSettingsLinkId(event.target.value)}>{project.links.map((link) => <option key={link.id} value={link.id}>{link.id} · {link.source} ↔ {link.target}</option>)}</select></label>{settingsLink && <UpgradeProfileEditor links={[settingsLink]} onApply={editUpgradeCatalog} />}</section><section className="plain-section"><h2>Import / model assumptions</h2><p>Imported JSON or CSV is validated into the same canonical browser-local NetworkProject. Editing an upgrade catalog changes the base model and intentionally starts a fresh Change Plan rather than silently rebasing an existing one.</p><button onClick={() => setImportDialogOpen(true)}>Import network data</button></section><section className="plain-section"><h2>Compute guidance</h2><dl className="compact-metrics"><div><dt>Plan analysis</dt><dd>{executionProfile.mode === 'worker' ? 'Worker preferred' : 'Main-thread fast path'}</dd></div><div><dt>N-1</dt><dd>{n1Guidance} · max {n1Policy.maxScenarios}</dd></div><div><dt>Capacity optimizer</dt><dd>{capacityMilpEstimate.recommended ? 'Available' : 'Guarded at this size'}</dd></div></dl></section></div></div></section>}
    </div>

    <aside className={`advanced-drawer ${advancedOpen ? 'open' : ''}`} data-testid="advanced-drawer" aria-hidden={!advancedOpen}>
      <header><div><span className="section-kicker">Developer details</span><h2>Diagnostics and provenance</h2></div><button aria-label="Close advanced details" onClick={() => setAdvancedOpen(false)}>×</button></header>
      <div className="advanced-scroll">
        <section><h3>Provenance</h3><dl className="advanced-list"><div><dt>Base model hash</dt><dd data-testid="base-model-hash" className="mono">{currentProjectHash}</dd></div><div><dt>Change Plan hash</dt><dd data-testid="plan-hash" className="mono">{currentPlanHash}</dd></div><div><dt>Evidence</dt><dd>{analysisFresh ? 'Current' : publishedPlanAnalysis ? 'Stale' : 'Not published'}</dd></div></dl></section>
        <section data-testid="compute-profile"><h3>Compute profile</h3><p>{executionProfile.mode === 'worker' ? 'Worker preferred' : 'Main-thread fast path'}</p><dl className="advanced-list"><div><dt>Execution</dt><dd>{executionProfile.mode}</dd></div><div><dt>Estimated work</dt><dd>{executionProfile.estimatedWorkUnits.toLocaleString()}</dd></div><div><dt>Workers</dt><dd>{compute.workerSupported ? `${compute.recommendedWorkerCount} recommended` : 'unsupported'}</dd></div><div><dt>SharedArrayBuffer</dt><dd>{compute.sharedArrayBufferSupported ? 'available' : 'unavailable'}</dd></div><div><dt>Last analysis</dt><dd>{lastAnalysisRuntimeMs === null ? 'not run' : `Last execution: ${lastAnalysisExecution} · ${lastAnalysisRuntimeMs} ms live`}</dd></div><div><dt>N-1 coverage</dt><dd>{contingencies && n1Fresh ? `${contingencies.completedScenarios}/${contingencies.totalEligibleScenarios} ${contingencies.status.toUpperCase()}` : `${eligibleN1} eligible link failures`}</dd></div><div><dt>Routing LP</dt><dd>{routingLpEstimate.recommended ? 'RECOMMENDED' : 'NOT RECOMMENDED'}</dd></div></dl></section>
        <section><h3>Optimizer diagnostics</h3><div data-testid="optimizer-status" className={`compute-card ${optimizerStatus === 'error' ? 'error' : optimizerStatus === 'running' ? 'running' : 'complete'}`}><strong>{optimizerStatus} · HiGHS WASM</strong><p>{optimizerMessage}</p></div><p>Capacity MILP: {capacityMilpEstimate.reason}</p>{optimizerResult && <div data-testid="capacity-optimizer-result"><strong>{optimizerResult.diagnostics.status} · {optimizerResult.diagnostics.proof}</strong><p>{optimizerResult.selectedUpgrades.length} upgrade(s) · objective {optimizerResult.diagnostics.objectiveValue ?? 'n/a'}</p></div>}{candidateVerification && <div data-testid="candidate-verification"><strong>{verificationFresh ? candidateVerification.status.toUpperCase() : 'STALE'}</strong><p>{verificationFresh ? candidateVerification.violations.join(' ') || `Verified cost ${candidateVerification.calculatedCost}` : 'Plan/proposal revision changed after verification.'}</p></div>}<button data-testid="routing-lp-action" onClick={() => void runRoutingOptimizer()}>Solve diagnostic routing LP</button><p data-testid="routing-lp-guidance">{routingLpEstimate.reason}</p>{routingOptimization && <div data-testid="routing-lp-result"><strong>{routingOptimization.diagnostics.status}</strong><p>Minimum max utilization {routingOptimization.maxUtilizationPct === null ? 'n/a' : pct(routingOptimization.maxUtilizationPct)}</p></div>}</section>
        <section data-testid="advanced-inspector"><h3>WebMCP diagnostics</h3><p>Status: {webmcpStatus}. {registeredTools.length} registered capabilities.</p>{webmcpStatus === 'unsupported' && <p>WebMCP is not available in this browser. Core planning remains fully usable.</p>}<div className="tool-badges">{registeredTools.map((name) => <span key={name}>{name}</span>)}</div>{lastToolAnalysis && <p>Latest tool-published analysis: {lastToolAnalysis}</p>}<div className="activity-list">{activity.length === 0 ? <p className="muted">No tool activity recorded.</p> : activity.map((event) => <div key={event.id} className="activity-row"><time>{event.startedAt.slice(11, 19)}</time><span>{event.tool}</span><strong>{event.status}</strong><small>{event.summary} · {event.durationMs} ms</small></div>)}</div></section>
        <section><h3>Scale guards</h3><dl className="advanced-list"><div><dt>N-1 eligible</dt><dd>{eligibleN1} · engine cap {N1_ENGINE_HARD_CAP}</dd></div><div><dt>Routing LP</dt><dd>{routingLpEstimate.flowVariables.toLocaleString()} flow variables</dd></div><div><dt>Capacity MILP</dt><dd>{capacityMilpEstimate.decisionScenarioProduct.toLocaleString()} decision×scenario</dd></div></dl></section>
      </div>
    </aside>
  </main>;
}
