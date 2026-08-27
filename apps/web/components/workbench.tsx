'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CandidatePlan, ChangePlan, NetworkProject, PlanChange, PlanEvidenceStamp, PlanRevisionStamp, ScenarioPatch } from '@infratwin/model';
import {
  acceptAllCandidateChanges,
  acceptCandidateChange,
  addPlanChange,
  changePlanHash,
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
import type { CapacityOptimizationResult, CapacityPlanRequirements, CandidateVerification, TrafficAllocationResult } from '@infratwin/optimizer';
import { optimizeCapacityInBrowser, optimizeRoutingInBrowser, probeBrowserOptimizer, verifyCandidateInBrowser } from '../lib/optimizer-client';
import { AnalysisJourney } from './analysis-journey';
import { ChangePlanPanel } from './change-plan-panel';
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
  const [resilienceStatus, setResilienceStatus] = useState<'idle' | 'running' | 'complete' | 'cancelled' | 'error'>('idle');
  const [resilienceMessage, setResilienceMessage] = useState('');
  const [optimizerStatus, setOptimizerStatus] = useState<'loading' | 'ready' | 'running' | 'error'>('loading');
  const [optimizerMessage, setOptimizerMessage] = useState('Loading HiGHS WASM in a worker…');
  const [optimizerResult, setOptimizerResult] = useState<CapacityOptimizationResult | null>(null);
  const [routingOptimization, setRoutingOptimization] = useState<TrafficAllocationResult | null>(null);
  const [candidateVerification, setCandidateVerification] = useState<CandidateVerification | null>(null);
  const [candidateVerificationStamp, setCandidateVerificationStamp] = useState<PlanRevisionStamp | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const directRunControllerRef = useRef<AbortController | null>(null);
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
  const livePlanAnalysis = useMemo(() => analyzeChangePlan(project, plan), [project, plan]);
  const analysis = useMemo(() => ephemeralPatch ? runScenarioCapacityAnalysis(project, ephemeralPatch) : livePlanAnalysis.capacity, [project, ephemeralPatch, livePlanAnalysis]);
  const snapshot = analysis.snapshot;
  const routeByDemand = useMemo(() => new Map(analysis.routing.routes.map((route) => [route.demandId, route])), [analysis.routing.routes]);
  const selectedCanonicalLink = useMemo(() => selectedLinkId ? project.links.find((link) => link.id === selectedLinkId) : undefined, [project.links, selectedLinkId]);
  const selectedCanonicalNode = useMemo(() => selectedNodeId ? project.nodes.find((node) => node.id === selectedNodeId) : undefined, [project.nodes, selectedNodeId]);
  const selectedDemandId = selectedEvidence?.type === 'demand' ? (selectedEvidence.demandId ?? selectedEvidence.id) : null;
  const analysisFresh = Boolean(publishedPlanAnalysis && isPlanEvidenceFresh(publishedPlanAnalysis.stamp, project, plan));
  const n1Fresh = Boolean(contingencyStamp && isPlanEvidenceFresh(contingencyStamp, project, plan));
  const verificationFresh = Boolean(candidateVerification && candidateVerificationStamp && isPlanRevisionFresh(candidateVerificationStamp, project, plan));
  const currentPlanHash = changePlanHash(plan);
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
    optimizerControllerRef.current?.abort(); optimizerControllerRef.current = null;
    setProgress(null); setResilienceStatus('idle'); setResilienceMessage('');
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
    setResilienceStatus('complete'); setResilienceMessage(`${next.completedScenarios} scenarios completed via ${next.executionMode} with ${next.workerCount} worker slot(s).`); return next;
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
    publishContingencyAnalysis: (next) => { if (next.status === 'complete') { contingencyRef.current = next; setContingencies(next); setLastToolAnalysis(`${next.completedScenarios} N-1 scenarios · worst ${next.result.metrics.worstLinkId}`); } },
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
  const hasViolation = analysis.result.verdict === 'FAIL';
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
    const base = cloneProject(projectRef.current); const planSnapshot = clonePlan(planRef.current); const result = analyzeChangePlan(base, planSnapshot); setPublishedPlanAnalysis(result); setBottleneck(null); setSelectedEvidence(result.capacity.result.witnesses.find((item) => item.type === 'route' || item.type === 'link') ?? null);
    let n1Fail = false;
    if (planSnapshot.constraints.requireN1 && base.links.some((link) => link.available !== false)) {
      const controller = new AbortController(); directRunControllerRef.current = controller;
      try {
        const next = await executeContingencies({ signal: controller.signal, maxScenarios: 500, timeLimitMs: 30_000 }, { project: base, patch: result.patch });
        if (next.status !== 'complete' || !isPlanEvidenceFresh(result.stamp, projectRef.current, planRef.current)) return;
        contingencyRef.current = next; setContingencies(next); setContingencyStamp(result.stamp); n1Fail = Number(next.result.metrics.failingScenarios ?? 0) > 0;
      } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) { setResilienceStatus('error'); setResilienceMessage(error instanceof Error ? error.message : 'N-1 analysis failed.'); } return; }
      finally { if (directRunControllerRef.current === controller) directRunControllerRef.current = null; }
    } else { setContingencies(null); setContingencyStamp(null); }
    if (!isPlanEvidenceFresh(result.stamp, projectRef.current, planRef.current)) return;
    const fail = result.verdict === 'FAIL' || n1Fail; setStatusOnly(fail ? 'failing' : 'analyzed', `Plan analyzed: ${fail ? 'FAIL' : 'PASS'}${planSnapshot.constraints.requireN1 ? ' including N-1' : ''}.`);
  };
  const runPlanN1 = async () => {
    ephemeralRef.current = null; setEphemeralPatch(null); const stamp = livePlanAnalysis.stamp; const controller = new AbortController(); directRunControllerRef.current = controller;
    try { const next = await executeContingencies({ signal: controller.signal, maxScenarios: 500, timeLimitMs: 30_000 }, { project: cloneProject(projectRef.current), patch: livePlanAnalysis.patch }); if (next.status === 'complete' && isPlanEvidenceFresh(stamp, projectRef.current, planRef.current)) { contingencyRef.current = next; setContingencies(next); setContingencyStamp(stamp); } }
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
        const stamp = livePlanAnalysis.stamp; currentN1 = await executeContingencies({ signal: controller.signal, maxScenarios: 500, timeLimitMs: 30_000 }, { project: cloneProject(projectRef.current), patch: livePlanAnalysis.patch });
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
  const verificationStatus = candidateVerification ? (verificationFresh ? candidateVerification.status : 'stale') : null;
  const peak = analysis.routing.peakUtilizationPct; const primaryFailure = analysis.result.violations[0]?.linkId ?? analysis.result.violations[0]?.demandId ?? null;
  const candidateLabel = pendingProposals.length ? `${pendingProposals.length} proposed change${pendingProposals.length === 1 ? '' : 's'}` : analysis.result.verdict === 'FAIL' ? 'Mitigation available' : 'No proposal pending';
  const nextStep = verificationStatus === 'verified' ? 'Accept or reject individual proposals; any revision invalidates verification.' : verificationStatus === 'stale' ? 'The plan changed. Re-run optimization/verification before acceptance.' : pendingProposals.length ? 'Verify, then accept or reject individual proposed changes.' : 'Analyze the plan, inspect evidence, and request mitigation when needed.';
  const progressLabel = progress ? `${progress.completed}/${progress.total} · ${pct(progress.percentage)}` : 'idle';
  const regionCount = new Set(project.nodes.map((node) => node.region).filter(Boolean)).size;

  return <main className="shell">
    <header className="topbar"><div><p className="eyebrow">InfraTwin</p><h1>{project.name}</h1><p className="subtitle">Plan and verify network changes before production. The base network stays canonical while humans and optimizer proposals collaborate inside one visible Change Plan.</p></div><div className="header-actions"><span data-testid="header-verdict" className={`status-chip ${authority === 'PASS' ? 'pass' : authority === 'FAIL' ? 'fail' : 'draft'}`}>{authority}</span><button data-testid="export-json" onClick={exportProject}>Export base JSON</button><button data-testid="import-json" onClick={() => setImportDialogOpen(true)}>Import network</button></div></header>
    <ImportNetworkDialog open={importDialogOpen} onClose={() => setImportDialogOpen(false)} onOpenProject={openImportedProject} />
    {importMessage && <div className="notice" role="status">{importMessage}</div>}{webmcpStatus === 'unsupported' && <div className="notice warning" role="status">WebMCP is not available in this browser. The collaborative planning workspace remains fully usable; WebMCP-specific coactivity expansion is intentionally deferred.</div>}
    <AnalysisJourney planLabel={ephemeralPatch ? `Counterexample replay: ${ephemeralPatch.name}` : plan.name} authority={authority} peakUtilizationPct={peak} violationCount={analysis.result.violations.length} primaryFailure={primaryFailure} candidateLabel={candidateLabel} verificationStatus={verificationStatus} nextStep={nextStep} />
    <section className="summary-grid"><article><span>Base model</span><strong data-testid="base-model-hash" className="mono">{shortHash(modelHash(project))}</strong></article><article><span>Change Plan</span><strong data-testid="plan-hash" className="mono">{shortHash(changePlanHash(plan))} · {plan.changes.length} change(s)</strong></article><article><span>Planned peak</span><strong>{pct(peak)} / target {pct(plan.constraints.targetUtilizationPct)}</strong></article><article><span>Constraints</span><strong>{plan.constraints.budgetCostUnits === null ? 'No budget cap' : `Budget ${plan.constraints.budgetCostUnits}`} · N-1 {plan.constraints.requireN1 ? 'required' : 'optional'}</strong></article></section>
    <div className="network-scale-strip" data-testid="network-scale"><span><strong>{project.nodes.length}</strong> nodes</span><span><strong>{project.links.length}</strong> links</span><span><strong>{project.demands.length}</strong> demands</span><span><strong>{regionCount}</strong> regions</span>{project.metadata?.realisticSynthetic === true && <span>Realistic synthetic planning model</span>}</div>

    <section className="template-strip panel"><div><p className="eyebrow">Examples / Reference Networks</p><h2>Open a network, then author or load a Change Plan</h2></div><ScenarioSelector scenarios={networkTemplates} selectedId={selectedScenarioId} onSelect={loadNetworkTemplate} /></section>

    <section className="workbench-grid plan-centric-grid">
      <ChangePlanPanel project={project} plan={plan} selectedLinkId={selectedLinkId} selectedNodeId={selectedNodeId} hasTemplate={Boolean(definition.changePlanTemplate)} onNewPlan={newPlan} onClearPlan={clearPlan} onRenamePlan={(name) => { if (name.trim() && name.trim() !== planRef.current.name) mutatePlan((current) => renameChangePlan(current, name)); }} onLoadTemplate={loadPlanTemplate} onRemoveChange={(id) => mutatePlan((current) => removePlanChange(current, id))} onLinkAvailability={handleLinkAvailability} onLinkCapacity={handleLinkCapacity} onNodeAvailability={handleNodeAvailability} onLockLink={(id, locked) => mutatePlan((current) => setPlanLinkLocked(current, id, locked))} onLockNode={(id, locked) => mutatePlan((current) => setPlanNodeLocked(current, id, locked))} onSetConstraint={(key, value) => mutatePlan((current) => setPlanConstraint(current, key, value as never))} onSetBandwidth={handleDemandBandwidth} onAddDemand={handleAddDemand} onAddGrowth={handleGrowth} onAcceptProposal={acceptProposal} onRejectProposal={rejectProposal} onAcceptAll={acceptAll} onDiscardCandidate={discardCandidate} />

      <article className="panel graph-panel"><div className="panel-heading"><div><p className="eyebrow">Network + current plan</p><h2>Scalable topology workspace</h2></div><span className="hint">Search, zoom, focus, then author plan actions</span></div>
        <TopologyCanvas project={project} analysis={analysis} selectedLinkIds={selectedLinkIds} selectedLinkId={selectedLinkId} selectedNodeId={selectedNodeId} selectedDemandId={selectedDemandId} plannedOutageLinkIds={plannedOutageLinkIds} plannedOutageNodeIds={plannedOutageNodeIds} plannedChangedLinkIds={plannedChangedLinkIds} plannedChangedNodeIds={plannedChangedNodeIds} proposalLinkIds={proposalLinkIds} proposalNodeIds={proposalNodeIds} lockedLinkIds={lockedLinkIds} lockedNodeIds={lockedNodeIds} violationLinkIds={violationLinkIds} onSelectLink={(id) => { setSelectedLinkId(id); setSelectedNodeId(null); setSelectedEvidence({ type: 'link', id }); }} onSelectNode={(id) => { setSelectedNodeId(id); setSelectedLinkId(null); setSelectedEvidence(null); }} onSelectDemand={(id) => { setSelectedLinkId(null); setSelectedNodeId(null); setSelectedEvidence({ type: 'demand', id, demandId: id, linkIds: allRouteLinks(routeByDemand.get(id)) }); }} onBatchPlannedOutage={batchPlanOutage} onBatchLockLinks={batchLockLinks} onApplyUpgradeProfile={editUpgradeCatalog} />
        {(selectedCanonicalLink || selectedCanonicalNode) && <div className="selection-note"><strong>Selected {selectedCanonicalLink ? `link ${selectedCanonicalLink.id}` : `node ${selectedCanonicalNode?.id}`}</strong><span>Selection and viewport state are presentation-only. Use the Change Plan panel for operational changes; upgrade-catalog edits deliberately change the canonical design space.</span></div>}
      </article>

      <aside data-testid="evidence-panel" className="panel evidence-panel"><div className="panel-heading compact"><div><p className="eyebrow">Analysis / Evidence</p><h2>{ephemeralPatch ? 'Counterexample replay' : authority === 'DRAFT' ? 'Plan not analyzed' : authority === 'STALE' ? 'Evidence stale' : `${authority} · ${analysis.result.violations.length} violation(s)`}</h2></div></div>
        <div className="workflow-actions"><button data-testid="analyze-plan" className="primary" onClick={() => void analyzeCurrentPlan()}>Analyze Change Plan</button>{resilienceStatus !== 'running' && canRunResilience && <button data-testid="run-resilience" onClick={() => void runPlanN1()}>Run N-1 now</button>}{resilienceStatus === 'running' && <button data-testid="cancel-resilience" className="danger" onClick={() => directRunControllerRef.current?.abort()}>Cancel N-1</button>}{ephemeralPatch && <button data-testid="return-to-plan" onClick={() => { ephemeralRef.current = null; setEphemeralPatch(null); }}>Return to planned state</button>}</div>
        {publishedPlanAnalysis && <div data-testid="plan-analysis-status" className={`evidence-block ${analysisFresh ? '' : 'stale-evidence'}`}><span className="block-label">Plan evidence</span><strong>{analysisFresh ? publishedPlanAnalysis.verdict : 'STALE'} · target {pct(publishedPlanAnalysis.targetUtilizationPct)}</strong><p>{analysisFresh ? publishedPlanAnalysis.reasons.join(' ') : 'The base network or semantic Change Plan changed after this analysis. Re-run before relying on it.'}</p></div>}
        {resilienceStatus !== 'idle' && <div data-testid="resilience-status" className={`compute-card ${resilienceStatus}`}><span>N-1 execution</span><strong>{resilienceStatus} · {progressLabel}</strong><p>{resilienceMessage}</p></div>}
        {contingencies && n1Fresh && <div data-testid="resilience-evidence" className="evidence-block"><span className="block-label">N-1 evidence</span><strong>{contingencies.completedScenarios}/{contingencies.totalEligibleScenarios} failures tested · {contingencies.result.metrics.failingScenarios} failing</strong><p>Worst {String(contingencies.result.metrics.worstLinkId)} · peak {pct(Number(contingencies.result.metrics.worstPeakUtilizationPct))}</p></div>}
        <dl className="metrics evidence-metrics"><div><dt>Live routing</dt><dd>{analysis.routing.mode.toUpperCase()}</dd></div><div><dt>Live peak</dt><dd>{pct(peak)}</dd></div><div><dt>Unrouted</dt><dd>{analysis.routing.unroutedDemandIds.length}</dd></div><div><dt>Protected services</dt><dd>{plan.constraints.protectedServiceClassIds.join(', ') || 'none'}</dd></div></dl>
        <div className="violation-list">{analysis.result.violations.length === 0 ? <p className="empty">No deterministic routing/capacity violations in the displayed planned snapshot.</p> : analysis.result.violations.map((violation) => <button className="violation" key={violation.id} onClick={() => selectViolation(violation)}><strong>{violation.type.replaceAll('_', ' ')}</strong><p>{violation.message}</p></button>)}</div>
        {analysis.result.verdict === 'FAIL' && <button className="wide" onClick={inspectCurrentBottleneck}>Find min-cut bottleneck</button>}{bottleneck && <div className="evidence-block cut-block"><span className="block-label">Min-cut evidence</span><strong>{bottleneck.sourceId} → {bottleneck.targetId}: {gbps(bottleneck.cut.cutCapacityGbps)}</strong><p>Cut links: {bottleneck.cut.cutLinkIds.join(', ') || 'none'} · headroom {gbps(bottleneck.headroomGbps)}</p></div>}
        <div className="optimizer-actions"><button data-testid="run-optimizer" className="primary" disabled={!optimizerReady || optimizerStatus === 'running'} onClick={() => void runOptimizer()}>Generate constrained mitigation</button><button data-testid="propose-deterministic" disabled={analysis.result.verdict !== 'FAIL'} onClick={quickMitigation}>Quick deterministic proposal</button>{candidate && <button data-testid="verify-candidate" disabled={candidateStale} onClick={() => void verifyCurrentCandidate()}>Verify proposal</button>}</div>
        <div data-testid="optimizer-status" className={`compute-card ${optimizerStatus === 'error' ? 'error' : optimizerStatus === 'running' ? 'running' : 'complete'}`}><span>Optimizer</span><strong>{optimizerStatus} · HiGHS WASM</strong><p>{optimizerMessage}</p></div>
        {optimizerResult && <div data-testid="capacity-optimizer-result" className="evidence-block"><span className="block-label">Capacity MILP</span><strong>{optimizerResult.diagnostics.status} · {optimizerResult.diagnostics.proof}</strong><p>{optimizerResult.selectedUpgrades.length} upgrade(s) · objective {optimizerResult.diagnostics.objectiveValue ?? 'n/a'} · locks enforced: {optimizerResult.requirements.lockedLinkIds.join(', ') || 'none'}</p></div>}
        {candidateVerification && <div data-testid="candidate-verification" className={`comparison ${verificationFresh && candidateVerification.status === 'verified' ? 'comparison-pass' : ''}`}><span>Independent candidate verification</span><strong>{verificationFresh ? candidateVerification.status.toUpperCase() : 'STALE'}</strong><p>{verificationFresh ? (candidateVerification.status === 'verified' ? `Cost ${candidateVerification.calculatedCost}; current selected scenarios satisfy constraints.` : candidateVerification.violations.join(' ')) : 'Plan/proposal revision changed after verification. Re-run verification.'}</p></div>}
        {comparison && <div className="comparison"><span>Current planned state → optimizer candidate</span><strong>{comparison.before.result.verdict} → {comparison.after.result.verdict}</strong><p>Peak {pct(comparison.before.routing.peakUtilizationPct)} → {pct(comparison.after.routing.peakUtilizationPct)} · candidate is not applied to the base network.</p></div>}
        {routingOptimization && <div className="evidence-block"><span className="block-label">Diagnostic traffic allocation LP</span><strong>{routingOptimization.diagnostics.status}</strong><p>Minimum max utilization {routingOptimization.maxUtilizationPct === null ? 'n/a' : pct(routingOptimization.maxUtilizationPct)}</p></div>}
      </aside>
    </section>

    <section className="lower-grid phase35-lower"><article className="panel demand-panel"><div className="panel-heading"><div><p className="eyebrow">Planned traffic evidence</p><h2>Routes in the effective snapshot</h2></div></div><div className="demand-list">{snapshot.demands.length === 0 ? <p className="empty">No demands in the planned snapshot.</p> : snapshot.demands.map((demand) => { const route = routeByDemand.get(demand.id); const links = allRouteLinks(route); return <button className="demand-route standalone" key={demand.id} onClick={() => setSelectedEvidence({ type: 'route', id: `route:${demand.id}`, demandId: demand.id, linkIds: links })}><strong>{demand.id} · {demand.name ?? demand.id} · {gbps(demand.bandwidthGbps)}</strong><small>{route?.reachable ? `${route.equalCostPathCountExact} equal-cost path(s) · ${links.join(' / ') || 'local'}` : 'unreachable'} · {demand.serviceClassId}</small></button>; })}</div></article>
      <article className="panel contingency-panel"><div className="panel-heading"><div><p className="eyebrow">Counterexample replay</p><h2>{contingencies && n1Fresh ? 'Ranked N-1 cases' : 'No current ranking'}</h2></div></div>{contingencies && n1Fresh ? <div data-testid="contingency-list" className="contingency-list">{contingencies.cases.slice(0, 8).map((item, index) => <button data-testid={`counterexample-${item.linkId}`} key={item.linkId} className={ephemeralPatch?.id === item.patch.id ? 'active' : ''} onClick={() => replayContingency(item.linkId)}><span>#{index + 1} · {item.linkId}</span><strong>{item.verdict}</strong><small>score {item.score} · peak {pct(item.peakUtilizationPct)} · unsatisfied {gbps(item.unroutedDemandGbps)}</small></button>)}</div> : <p className="muted">Analyze a plan with N-1 required or run N-1 directly to generate replayable single-link counterexamples.</p>}</article>
      <details className="panel agent-panel advanced-disclosure" data-testid="advanced-inspector"><summary><span>Advanced / Inspector</span><strong>{registeredTools.length} WebMCP capabilities · {compute.executionMode}</strong></summary><div className="advanced-body"><div className="panel-heading"><div><p className="eyebrow">Agent activity / WebMCP</p><h2>Existing capabilities over shared application services</h2></div><span className={`status-dot ${webmcpStatus}`} /></div><div className="tool-badges">{registeredTools.map((name) => <span key={name} className={['propose_change', 'show_counterexample', 'apply_candidate', 'discard_candidate', 'optimize_capacity_plan'].includes(name) ? 'mutating' : ''}>{name}</span>)}</div><p className="capability-note">Phase 3.5A preserves the existing WebMCP surface. Change Plan services and locks are shared internally; broader coactivity tool design is deferred.</p><button onClick={() => void runRoutingOptimizer()}>Solve diagnostic routing LP</button>{lastToolAnalysis && <p className="tool-result">Latest tool-published analysis: {lastToolAnalysis}</p>}<div className="activity-list">{activity.length === 0 ? <p className="muted">Tool calls appear here with classification and compact summaries.</p> : activity.map((event) => <div key={event.id} className="activity-row"><time>{event.startedAt.slice(11, 19)}</time><span className="activity-tool">{event.tool}</span><span className={`activity-kind ${event.readOnly ? 'readonly' : 'mutating'}`}>{event.readOnly ? 'read-only' : 'mutating'}</span><strong className={event.status}>{event.status === 'success' ? '✓' : event.status === 'cancelled' ? '■' : '✕'}</strong><small>{event.summary} · {event.durationMs} ms</small></div>)}</div></div></details>
    </section>
  </main>;
}
