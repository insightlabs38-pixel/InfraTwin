'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CandidatePlan, ModelCommand, NetworkProject, ScenarioPatch } from '@infratwin/model';
import { applyCandidatePlan, applyModelCommand, applyScenario, cloneProject, invertCandidatePlan, modelHash, scenarioHash, validateNetworkProject } from '@infratwin/model';
import {
  analyzeBottleneck,
  assertContingencyFresh,
  compareCandidate,
  detectComputeCapabilities,
  proposeCapacityMitigation,
  runGrowthAnalysis,
  runLinkContingenciesAsync,
  runScenarioCapacityAnalysis,
  type BottleneckAnalysis,
  type CandidateComparison,
  type ComputeCapabilities,
  type ContingencyAnalysis,
  type ContingencyProgress,
  type ContingencyRunOptions,
  type ContingencyWorkerLike,
  type EvidenceRef,
  type GrowthAnalysis,
  type CapacityAnalysis,
} from '@infratwin/evidence';
import { getScenarioDefinition, listBundledScenarios, loadScenario, type BundledScenarioId, type ScenarioDefinition } from '@infratwin/scenarios';
import type { CapacityOptimizationResult, CapacityPlanRequirements, CandidateVerification, TrafficAllocationResult } from '@infratwin/optimizer';
import { optimizeCapacityInBrowser, optimizeRoutingInBrowser, probeBrowserOptimizer, verifyCandidateInBrowser } from '../lib/optimizer-client';
import { AnalysisJourney } from './analysis-journey';
import { ScenarioSelector } from './scenario-selector';
import { TopologyCanvas } from './topology-canvas';
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
function allRouteLinks(route: CapacityAnalysis['routing']['routes'][number] | undefined): string[] {
  return route ? Object.keys(route.linkFractions).filter((linkId) => route.linkFractions[linkId] > 0).sort() : [];
}

const demoScenarios = listBundledScenarios();
type SelectedScenarioId = BundledScenarioId | 'imported';
const initialCompute: ComputeCapabilities = {
  workerSupported: false,
  hardwareConcurrency: 1,
  recommendedWorkerCount: 1,
  sharedArrayBufferSupported: false,
  crossOriginIsolated: false,
  executionMode: 'async-fallback',
};

function targetGrowthPatch(definition: ScenarioDefinition, multiplier: number): ScenarioPatch {
  return {
    id: `growth-ui-${multiplier}`, name: `Forecast growth +${Math.round((multiplier - 1) * 100)}%`,
    disabledNodeIds: [], disabledLinkIds: [],
    demandMultipliers: (definition.growthDemandIds ?? []).map((demandId) => ({ demandId, multiplier })),
    addedDemands: [], linkCapacityOverrides: [],
  };
}

function createBrowserWorker(): ContingencyWorkerLike {
  return new Worker(new URL('../workers/contingency.worker.ts', import.meta.url), { type: 'module' }) as unknown as ContingencyWorkerLike;
}

export function Workbench() {
  const [selectedScenarioId, setSelectedScenarioId] = useState<SelectedScenarioId>('maintenance-trap');
  const [project, setProject] = useState<NetworkProject>(() => loadScenario('maintenance-trap'));
  const resetSeedRef = useRef<NetworkProject>(loadScenario('maintenance-trap'));
  const [activePatch, setActivePatch] = useState<ScenarioPatch | null>(null);
  const [candidate, setCandidate] = useState<CandidatePlan | null>(null);
  const [comparison, setComparison] = useState<CandidateComparison | null>(null);
  const [growth, setGrowth] = useState<GrowthAnalysis | null>(null);
  const [contingencies, setContingencies] = useState<ContingencyAnalysis | null>(null);
  const [bottleneck, setBottleneck] = useState<BottleneckAnalysis | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceRef | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
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
  const [optimizerBudget, setOptimizerBudget] = useState<number>(20);
  const [optimizerRequirements, setOptimizerRequirements] = useState<CapacityPlanRequirements | null>(null);
  const [undoCandidate, setUndoCandidate] = useState<CandidatePlan | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directRunControllerRef = useRef<AbortController | null>(null);
  const optimizerControllerRef = useRef<AbortController | null>(null);
  const analysisEpochRef = useRef(0);
  const humanCommandCounterRef = useRef(0);

  const projectRef = useRef(project);
  const patchRef = useRef(activePatch);
  const candidateRef = useRef(candidate);
  const contingencyRef = useRef(contingencies);
  projectRef.current = project;
  patchRef.current = activePatch;
  candidateRef.current = candidate;
  contingencyRef.current = contingencies;

  useEffect(() => { setCompute(detectComputeCapabilities()); }, []);
  useEffect(() => {
    const controller = new AbortController();
    probeBrowserOptimizer(controller.signal).then((probe) => { setOptimizerStatus('ready'); setOptimizerMessage(`${probe.solver} ${probe.solverVersion} · ${probe.status}`); }).catch((error) => { if (error instanceof Error && error.name === 'AbortError') return; setOptimizerStatus('error'); setOptimizerMessage(error instanceof Error ? error.message : 'HiGHS WASM failed to load.'); });
    return () => controller.abort();
  }, []);

  const definition = useMemo<ScenarioDefinition>(() => {
    if (selectedScenarioId === 'imported') {
      return { id: 'blank', title: project.name, kind: 'blank', description: 'Imported canonical project.', suggestedPrompt: 'Ask the agent to inspect the imported network, then make a manual edit and ask what changed.', project };
    }
    return getScenarioDefinition(selectedScenarioId);
  }, [selectedScenarioId, project]);

  const analysis = useMemo(() => runScenarioCapacityAnalysis(project, activePatch), [project, activePatch]);
  const snapshot = analysis.snapshot;
  const routeByDemand = useMemo(() => new Map(analysis.routing.routes.map((route) => [route.demandId, route])), [analysis.routing.routes]);
  const classById = useMemo(() => new Map(snapshot.serviceClasses.map((serviceClass) => [serviceClass.id, serviceClass])), [snapshot.serviceClasses]);
  const selectedCanonicalLink = useMemo(() => selectedLinkId ? project.links.find((link) => link.id === selectedLinkId) : undefined, [project.links, selectedLinkId]);
  const candidateLinkIds = useMemo(() => new Set(candidate?.commands.map((command) => String(command.args.linkId ?? '')).filter(Boolean) ?? []), [candidate]);
  const selectedLinkIds = useMemo(() => {
    if (!selectedEvidence) return new Set<string>();
    if (selectedEvidence.type === 'link') return new Set([selectedEvidence.id]);
    if (selectedEvidence.type === 'route' || selectedEvidence.type === 'cut') return new Set(selectedEvidence.linkIds ?? []);
    if (selectedEvidence.type === 'demand') return new Set(allRouteLinks(routeByDemand.get(selectedEvidence.demandId ?? selectedEvidence.id)));
    return new Set<string>();
  }, [selectedEvidence, routeByDemand]);

  const executeContingencies = async (options: ContingencyRunOptions = {}): Promise<ContingencyAnalysis> => {
    const runEpoch = ++analysisEpochRef.current;
    const baseProject = cloneProject(projectRef.current);
    const basePatch = patchRef.current ? JSON.parse(JSON.stringify(patchRef.current)) as ScenarioPatch : null;
    const capabilities = detectComputeCapabilities();
    setCompute(capabilities);
    setResilienceStatus('running');
    setResilienceMessage('');
    setProgress({ total: 0, completed: 0, running: 0, percentage: 0, workerCount: options.workerCount ?? capabilities.recommendedWorkerCount, executionMode: capabilities.executionMode });
    const externalProgress = options.onProgress;
    const next = await runLinkContingenciesAsync(baseProject, basePatch, {
      ...options,
      workerCount: options.workerCount ?? capabilities.recommendedWorkerCount,
      workerFactory: capabilities.workerSupported ? createBrowserWorker : undefined,
      onProgress: (value) => { if (analysisEpochRef.current !== runEpoch) return; setProgress(value); externalProgress?.(value); },
    });
    if (analysisEpochRef.current !== runEpoch) return { ...next, status: 'cancelled' };
    if (next.status === 'cancelled') {
      setResilienceStatus('cancelled');
      setResilienceMessage(`Cancelled after ${next.completedScenarios}/${Math.min(next.totalEligibleScenarios, options.maxScenarios ?? next.totalEligibleScenarios)} scenarios; no partial result was applied.`);
      return next;
    }
    assertContingencyFresh(next, projectRef.current, patchRef.current);
    setResilienceStatus('complete');
    setResilienceMessage(`${next.completedScenarios} scenarios completed via ${next.executionMode} with ${next.workerCount} worker slot(s).`);
    return next;
  };

  const toolServices = useMemo<InfraTwinToolServices>(() => ({
    getProject: () => projectRef.current,
    setProject: (next) => setProject(next),
    getActiveScenario: () => patchRef.current,
    setActiveScenario: (next) => setActivePatch(next),
    getCapacityAnalysis: () => runScenarioCapacityAnalysis(projectRef.current, patchRef.current),
    publishCapacityAnalysis: (next) => setLastToolAnalysis(`${next.result.verdict} · ${next.routing.mode} · peak ${pct(next.routing.peakUtilizationPct)}`),
    runContingencies: (options) => executeContingencies(options),
    getContingencyAnalysis: () => contingencyRef.current,
    publishContingencyAnalysis: (next) => {
      if (next.status !== 'complete') return;
      setContingencies(next); setGrowth(null); setBottleneck(null);
      setLastToolAnalysis(`${next.completedScenarios} N-1 scenarios · worst ${next.result.metrics.worstLinkId}`);
    },
    publishBottleneckAnalysis: (next) => setBottleneck(next),
    selectEvidence: (next) => setSelectedEvidence(next),
    getCandidate: () => candidateRef.current,
    setCandidate: (next) => setCandidate(next),
    publishCandidateComparison: (next) => setComparison(next),
    optimizeCapacity: (requirements, options) => optimizeCapacityInBrowser(projectRef.current, requirements, 8_000, options?.signal),
    optimizeRouting: (options) => optimizeRoutingInBrowser(applyScenario(projectRef.current, patchRef.current), 5_000, options?.signal),
    verifyCandidate: (nextCandidate, requirements, options) => verifyCandidateInBrowser(projectRef.current, nextCandidate, requirements, options?.signal),
    publishOptimizationResult: (next) => setOptimizerResult(next),
    publishCandidateVerification: (next) => setCandidateVerification(next),
    onActivity: (event) => setActivity((current) => [event, ...current].slice(0, 20)),
  // executeContingencies intentionally reads refs so the service object remains stable for registration lifetimes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context?.registerTool) { setWebmcpStatus('unsupported'); setRegisteredTools([]); return; }
    let cleanup: (() => void) | undefined; let active = true;
    registerCoreTools(context, toolServices).then((dispose) => {
      if (!active) dispose(); else { cleanup = dispose; setWebmcpStatus('registered'); setRegisteredTools([...CORE_TOOL_NAMES]); }
    }).catch(() => setWebmcpStatus('error'));
    return () => { active = false; cleanup?.(); };
  }, [toolServices]);

  const canRunResilience = project.links.some((link) => link.available !== false);
  useEffect(() => {
    const names = RESILIENCE_TOOL_NAMES as readonly string[];
    if (!canRunResilience) { setRegisteredTools((current) => current.filter((name) => !names.includes(name))); return; }
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context?.registerTool) return;
    let cleanup: (() => void) | undefined; let active = true;
    registerResilienceTools(context, toolServices).then((dispose) => {
      if (!active) dispose(); else { cleanup = dispose; setRegisteredTools((current) => [...new Set([...current, ...RESILIENCE_TOOL_NAMES])]); }
    }).catch(() => setWebmcpStatus('error'));
    return () => { active = false; cleanup?.(); setRegisteredTools((current) => current.filter((name) => !names.includes(name))); };
  }, [canRunResilience, toolServices]);

  const hasViolation = analysis.result.verdict === 'FAIL';
  useEffect(() => {
    const names = VIOLATION_TOOL_NAMES as readonly string[];
    if (!hasViolation) { setRegisteredTools((current) => current.filter((name) => !names.includes(name))); return; }
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context?.registerTool) return;
    let cleanup: (() => void) | undefined; let active = true;
    registerViolationTools(context, toolServices).then((dispose) => {
      if (!active) dispose(); else { cleanup = dispose; setRegisteredTools((current) => [...new Set([...current, ...VIOLATION_TOOL_NAMES])]); }
    }).catch(() => setWebmcpStatus('error'));
    return () => { active = false; cleanup?.(); setRegisteredTools((current) => current.filter((name) => !names.includes(name))); };
  }, [hasViolation, toolServices]);

  const hasCounterexample = contingencies?.status === 'complete' && Boolean(contingencies.worst);
  useEffect(() => {
    const names = COUNTEREXAMPLE_TOOL_NAMES as readonly string[];
    if (!hasCounterexample) { setRegisteredTools((current) => current.filter((name) => !names.includes(name))); return; }
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context?.registerTool) return;
    let cleanup: (() => void) | undefined; let active = true;
    registerCounterexampleTools(context, toolServices).then((dispose) => {
      if (!active) dispose(); else { cleanup = dispose; setRegisteredTools((current) => [...new Set([...current, ...COUNTEREXAMPLE_TOOL_NAMES])]); }
    }).catch(() => setWebmcpStatus('error'));
    return () => { active = false; cleanup?.(); setRegisteredTools((current) => current.filter((name) => !names.includes(name))); };
  }, [hasCounterexample, toolServices]);

  const optimizerReady = optimizerStatus === 'ready' || optimizerStatus === 'running';
  useEffect(() => {
    const names = OPTIMIZER_TOOL_NAMES as readonly string[];
    if (!optimizerReady) { setRegisteredTools((current) => current.filter((name) => !names.includes(name))); return; }
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context?.registerTool) return;
    let cleanup: (() => void) | undefined; let active = true;
    registerOptimizerTools(context, toolServices).then((dispose) => {
      if (!active) dispose(); else { cleanup = dispose; setRegisteredTools((current) => [...new Set([...current, ...OPTIMIZER_TOOL_NAMES])]); }
    }).catch(() => setWebmcpStatus('error'));
    return () => { active = false; cleanup?.(); setRegisteredTools((current) => current.filter((name) => !names.includes(name))); };
  }, [optimizerReady, toolServices]);

  useEffect(() => {
    const names = CANDIDATE_TOOL_NAMES as readonly string[];
    if (!candidate) { setRegisteredTools((current) => current.filter((name) => !names.includes(name))); return; }
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context?.registerTool) return;
    let cleanup: (() => void) | undefined; let active = true;
    registerCandidateTools(context, toolServices).then((dispose) => {
      if (!active) dispose(); else { cleanup = dispose; setRegisteredTools((current) => [...new Set([...current, ...CANDIDATE_TOOL_NAMES])]); }
    }).catch(() => setWebmcpStatus('error'));
    return () => { active = false; cleanup?.(); setRegisteredTools((current) => current.filter((name) => !names.includes(name))); };
  }, [Boolean(candidate), toolServices]);

  const cancelDirectRun = () => directRunControllerRef.current?.abort();
  const clearDerived = (keepPatch = false) => {
    analysisEpochRef.current += 1;
    cancelDirectRun();
    optimizerControllerRef.current?.abort(); optimizerControllerRef.current = null;
    if (!keepPatch) setActivePatch(null);
    setCandidate(null); setComparison(null); setGrowth(null); setContingencies(null); setBottleneck(null); setSelectedEvidence(null); setSelectedLinkId(null); setLastToolAnalysis('');
    setProgress(null); setResilienceStatus('idle'); setResilienceMessage(''); setOptimizerResult(null); setRoutingOptimization(null); setCandidateVerification(null); setOptimizerRequirements(null); setUndoCandidate(null);
    if (optimizerStatus === 'running') { setOptimizerStatus('ready'); setOptimizerMessage('Run cancelled because the shared model or scenario changed.'); }
  };

  const loadDemo = (id: BundledScenarioId) => {
    const next = loadScenario(id); resetSeedRef.current = cloneProject(next); setSelectedScenarioId(id); setProject(next); setImportMessage(''); clearDerived();
  };
  const resetDemo = () => { setProject(cloneProject(resetSeedRef.current)); clearDerived(); };

  const runMaintenance = () => {
    const patch = definition.recommendedPatch ?? null;
    setActivePatch(patch); setGrowth(null); setContingencies(null); setBottleneck(null); setCandidate(null); setComparison(null);
    const result = runScenarioCapacityAnalysis(project, patch);
    setSelectedEvidence(result.result.witnesses.find((item) => item.type === 'route' || item.type === 'link') ?? null);
  };

  const runGrowth = () => {
    const multiplier = definition.defaultGrowthMultiplier ?? 1.4;
    const nextGrowth = runGrowthAnalysis(project, definition.growthDemandIds ?? project.demands.map((demand) => demand.id), multiplier, 0.05);
    setGrowth(nextGrowth); setContingencies(null); setBottleneck(null); setCandidate(null); setComparison(null);
    setActivePatch(targetGrowthPatch(definition, multiplier));
    setSelectedEvidence(nextGrowth.firstFailureLinkId ? { type: 'link', id: nextGrowth.firstFailureLinkId } : null);
  };

  const runResilience = async () => {
    cancelDirectRun();
    const expectedRunEpoch = analysisEpochRef.current + 1;
    const controller = new AbortController(); directRunControllerRef.current = controller;
    setContingencies(null); setGrowth(null); setBottleneck(null); setCandidate(null); setComparison(null);
    try {
      const next = await executeContingencies({ signal: controller.signal, maxScenarios: 500, timeLimitMs: 30_000 });
      if (analysisEpochRef.current !== expectedRunEpoch || next.status !== 'complete') return;
      setContingencies(next);
      if (next.worst) { setSelectedEvidence({ type: 'link', id: next.worst.linkId }); setSelectedLinkId(next.worst.linkId); }
    } catch (error) {
      if (analysisEpochRef.current !== expectedRunEpoch) return;
      setResilienceStatus(error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'error');
      setResilienceMessage(error instanceof Error ? error.message : 'Resilience analysis failed.');
    } finally { if (directRunControllerRef.current === controller) directRunControllerRef.current = null; }
  };

  const replayContingency = (linkId: string) => {
    const item = contingencies?.cases.find((entry) => entry.linkId === linkId); if (!item) return;
    setActivePatch(item.patch); setSelectedEvidence({ type: 'link', id: item.linkId }); setBottleneck(null);
  };

  const inspectCurrentBottleneck = () => {
    const violationDemandId = analysis.result.violations.find((item) => item.demandId)?.demandId;
    const demand = violationDemandId ? snapshot.demands.find((item) => item.id === violationDemandId) : [...snapshot.demands].sort((a, b) => b.bandwidthGbps - a.bandwidthGbps)[0];
    if (!demand) return;
    const next = analyzeBottleneck(project, demand.source, demand.target, activePatch);
    setBottleneck(next); setSelectedEvidence(next.evidence);
  };

  const proposeMitigation = () => { setCandidate(proposeCapacityMitigation(project, activePatch, 20)); setComparison(null); setOptimizerResult(null); setCandidateVerification(null); };
  const compareCurrentCandidate = () => { if (candidate) setComparison(compareCandidate(project, candidate, activePatch)); };
  const selectedOptimizerScenarios = (): ScenarioPatch[] => activePatch ? [activePatch] : [];
  const runOptimizer = async () => {
    optimizerControllerRef.current?.abort();
    const controller = new AbortController(); optimizerControllerRef.current = controller;
    const requirements: CapacityPlanRequirements = { targetUtilizationPct: 80, budgetCostUnits: optimizerBudget, includeBaseline: true, scenarioPatches: selectedOptimizerScenarios() };
    setOptimizerRequirements(requirements); setOptimizerStatus('running'); setOptimizerMessage('Solving capacity MILP off the main thread…'); setOptimizerResult(null); setCandidateVerification(null);
    const expectedModelHash = modelHash(projectRef.current); const expectedScenarioHash = scenarioHash(patchRef.current);
    try {
      const result = await optimizeCapacityInBrowser(cloneProject(projectRef.current), requirements, 8_000, controller.signal);
      if (modelHash(projectRef.current) !== expectedModelHash || scenarioHash(patchRef.current) !== expectedScenarioHash) {
        setOptimizerStatus('ready'); setOptimizerMessage('Stale optimizer result discarded because the model or scenario changed.'); return;
      }
      setOptimizerResult(result); if (result.candidate) { setCandidate(result.candidate); setComparison(null); }
      setOptimizerStatus('ready'); setOptimizerMessage(`${result.diagnostics.status} · ${result.diagnostics.proof} · ${result.diagnostics.runtimeMs} ms`);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') { setOptimizerStatus('ready'); setOptimizerMessage('Optimizer run cancelled; no candidate was published.'); }
      else { setOptimizerStatus('error'); setOptimizerMessage(error instanceof Error ? error.message : 'Optimizer failed.'); }
    } finally { if (optimizerControllerRef.current === controller) optimizerControllerRef.current = null; }
  };
  const runRoutingOptimizer = async () => {
    const controller = new AbortController(); const expectedModelHash = modelHash(projectRef.current); const expectedScenarioHash = scenarioHash(patchRef.current);
    try {
      const result = await optimizeRoutingInBrowser(applyScenario(cloneProject(projectRef.current), patchRef.current), 5_000, controller.signal);
      if (modelHash(projectRef.current) !== expectedModelHash || scenarioHash(patchRef.current) !== expectedScenarioHash) { setOptimizerMessage('Stale routing result discarded because the model or scenario changed.'); return; }
      setRoutingOptimization(result); setOptimizerMessage(`Routing LP: ${result.diagnostics.status} · max ${result.maxUtilizationPct ?? 'n/a'}%`);
    } catch (error) { setOptimizerMessage(error instanceof Error ? error.message : 'Routing LP failed.'); }
  };
  const verifyCurrentCandidate = async () => {
    if (!candidate) return;
    const requirements = optimizerRequirements ?? { targetUtilizationPct: 80, budgetCostUnits: optimizerBudget, includeBaseline: true, scenarioPatches: selectedOptimizerScenarios() };
    const expectedModelHash = modelHash(projectRef.current);
    try {
      const result = await verifyCandidateInBrowser(cloneProject(projectRef.current), candidate, requirements);
      if (modelHash(projectRef.current) !== expectedModelHash) { setOptimizerMessage('Stale verification result discarded because the model changed.'); return; }
      setCandidateVerification(result);
    } catch (error) { setOptimizerMessage(error instanceof Error ? error.message : 'Candidate verification failed.'); }
  };
  const applyCurrentCandidate = () => {
    if (!candidate) return;
    try { const undo = invertCandidatePlan(project, candidate); setProject(applyCandidatePlan(project, candidate)); setUndoCandidate(undo); setCandidate(null); setComparison(null); setCandidateVerification(null); }
    catch (error) { setImportMessage(error instanceof Error ? error.message : 'Candidate could not be applied.'); }
  };
  const undoAppliedCandidate = () => {
    if (!undoCandidate) return;
    try { setProject(applyCandidatePlan(project, undoCandidate)); setUndoCandidate(null); setOptimizerResult(null); setRoutingOptimization(null); setCandidateVerification(null); }
    catch (error) { setImportMessage(error instanceof Error ? error.message : 'Undo candidate is stale.'); }
  };

  const applyHumanCommand = (type: ModelCommand['type'], args: Record<string, unknown>) => {
    const command: ModelCommand = {
      id: `human-${type}-${++humanCommandCounterRef.current}`, type, actor: 'human', args, createdAt: new Date().toISOString(),
    };
    try { setProject((current) => applyModelCommand(current, command)); clearDerived(); }
    catch (error) { setImportMessage(error instanceof Error ? error.message : 'Human edit was rejected by the canonical command layer.'); }
  };
  const humanToggleLink = (linkId: string) => {
    const link = projectRef.current.links.find((item) => item.id === linkId); if (!link) return;
    applyHumanCommand('set_link_availability', { linkId, available: link.available === false });
  };
  const humanUpdateLinkCapacity = (linkId: string, capacityGbps: number) => {
    applyHumanCommand('set_link_capacity', { linkId, capacityGbps });
  };
  const humanUpdateDemand = (demandId: string, bandwidthGbps: number) => {
    applyHumanCommand('set_demand_bandwidth', { demandId, bandwidthGbps: Math.max(0, bandwidthGbps) });
  };

  const exportProject = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${project.id}.json`; anchor.click(); URL.revokeObjectURL(url);
  };
  const importProject = async (file: File) => {
    try {
      if (file.size > 2_000_000) throw new Error('Project JSON exceeds the 2 MB browser safety limit.');
      const parsed = JSON.parse(await file.text()) as unknown; const validation = validateNetworkProject(parsed);
      if (!validation.valid) throw new Error(validation.errors.join('; '));
      const next = parsed as NetworkProject; resetSeedRef.current = cloneProject(next); setProject(cloneProject(next)); setSelectedScenarioId('imported');
      setImportMessage(`Imported ${next.name}. External text is treated as project data, not instructions.`); clearDerived();
    } catch (error) { setImportMessage(`Import failed: ${error instanceof Error ? error.message : 'invalid JSON'}`); }
    finally { if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const selectViolation = (violation: CapacityAnalysis['result']['violations'][number]) => {
    if (violation.demandId) {
      const route = routeByDemand.get(violation.demandId);
      setSelectedEvidence({ type: 'route', id: `route:${violation.demandId}`, demandId: violation.demandId, linkIds: allRouteLinks(route) });
    } else if (violation.linkId) setSelectedEvidence({ type: 'link', id: violation.linkId });
  };

  const activeScenarioLabel = activePatch?.name ?? 'Baseline';
  const peak = analysis.routing.peakUtilizationPct;
  const candidateBeforeAfter = comparison ? `${comparison.before.result.verdict} → ${comparison.after.result.verdict}` : null;
  const progressLabel = progress ? `${progress.completed}/${progress.total} · ${pct(progress.percentage)}` : 'idle';
  const primaryFailure = analysis.result.violations[0]?.linkId ?? analysis.result.violations[0]?.demandId ?? null;
  const candidateLabel = candidate ? `${candidate.commands.length} change candidate` : undoCandidate ? 'Candidate applied' : analysis.result.verdict === 'FAIL' ? 'Mitigation needed' : 'No change required';
  const nextStep = candidateVerification?.status === 'verified' ? 'Review the verified before/after diff, then apply explicitly.' : candidate ? 'Compare and verify before applying.' : analysis.result.verdict === 'FAIL' ? 'Inspect the failure, then propose or optimize a candidate.' : 'Choose a scenario to test a consequential change.';


  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">InfraTwin · Level 3 optimization workbench</p>
          <h1>{project.name}</h1>
          <p className="subtitle">Deterministic resilience plus browser-local HiGHS LP/MILP optimization, reversible candidate plans, independent verification, and state-derived WebMCP capabilities over one canonical model.</p>
        </div>
        <div className="header-actions">
          <span data-testid="header-verdict" className={`status-chip ${analysis.result.verdict === 'PASS' ? 'pass' : 'fail'}`}>{analysis.result.verdict}</span>
          <button data-testid="reset-demo" onClick={resetDemo}>Reset demo</button><button data-testid="export-json" onClick={exportProject}>Export JSON</button><button data-testid="import-json" onClick={() => fileInputRef.current?.click()}>Import JSON</button>
          <input ref={fileInputRef} data-testid="import-file" className="hidden-input" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importProject(file); }} />
        </div>
      </header>

      {importMessage && <div className="notice" role="status">{importMessage}</div>}
      {webmcpStatus === 'unsupported' && <div className="notice warning" role="status">WebMCP is not available in this browser. The engineering workbench still works; use ChatGPT’s in-app browser or a supported Chrome WebMCP configuration for agent tools.</div>}

      <AnalysisJourney
        scenarioLabel={activeScenarioLabel}
        verdict={analysis.result.verdict === 'PASS' ? 'PASS' : 'FAIL'}
        peakUtilizationPct={peak}
        violationCount={analysis.result.violations.length}
        primaryFailure={primaryFailure}
        candidateLabel={candidateLabel}
        verificationStatus={candidateVerification?.status ?? null}
        nextStep={nextStep}
      />

      <section className="summary-grid" aria-label="Network summary">
        <article><span>Semantic model / scenario</span><strong data-testid="semantic-model-hash" className="mono">{shortHash(modelHash(project))} / {shortHash(scenarioHash(activePatch))}</strong></article>
        <article><span>Routing</span><strong>{analysis.routing.mode === 'ecmp' ? 'ECMP equal-cost split' : 'Single shortest path'}</strong></article>
        <article><span>Peak utilization</span><strong>{pct(peak)}</strong></article>
        <article><span>Compute / optimizer</span><strong>{compute.executionMode} · HiGHS {optimizerStatus}</strong></article>
      </section>

      <section className="workbench-grid">
        <aside className="panel scenario-panel">
          <div className="panel-heading compact"><div><p className="eyebrow">Scenario workspace</p><h2>Open a judge-ready demo</h2></div></div>
          <ScenarioSelector scenarios={demoScenarios} selectedId={selectedScenarioId} onSelect={loadDemo} />
          <div className="scenario-story"><strong>{definition.title}</strong><p>{definition.description}</p></div>
          <div className="workflow-actions">
            <button data-testid="run-baseline" onClick={() => { setActivePatch(null); setSelectedEvidence(null); setGrowth(null); setContingencies(null); setBottleneck(null); }}>Run baseline</button>
            {definition.kind === 'maintenance' && <button data-testid="run-maintenance" className="primary" onClick={runMaintenance}>Simulate maintenance</button>}
            {definition.kind === 'growth' && <button data-testid="run-growth" className="primary" onClick={runGrowth}>Run +40% growth</button>}
            {(definition.kind === 'resilience' || selectedScenarioId === 'imported') && canRunResilience && resilienceStatus !== 'running' && <button data-testid="run-resilience" className="primary" onClick={() => void runResilience()}>Run worker N-1</button>}
            {resilienceStatus === 'running' && <button data-testid="cancel-resilience" className="danger" onClick={cancelDirectRun}>Cancel N-1</button>}
            
            {optimizerReady && optimizerStatus !== 'running' && hasViolation && <button data-testid="run-optimizer" className="primary" onClick={() => void runOptimizer()}>Find cheapest mitigation</button>}
            {optimizerStatus === 'running' && <button data-testid="cancel-optimizer" className="danger" onClick={() => optimizerControllerRef.current?.abort()}>Cancel optimizer</button>}
          </div>
          {resilienceStatus !== 'idle' && <div data-testid="resilience-status" className={`compute-card ${resilienceStatus}`}><span>N-1 execution</span><strong>{resilienceStatus} · {progressLabel}</strong><p>{resilienceMessage || `${progress?.running ?? 0} scenario(s) currently running.`}</p></div>}
          <div data-testid="optimizer-status" className={`compute-card ${optimizerStatus === 'error' ? 'error' : optimizerStatus === 'running' ? 'running' : 'complete'}`}><span>Optimizer</span><strong>{optimizerStatus} · HiGHS WASM</strong><p>{optimizerMessage}</p><label className="number-control"><input aria-label="Optimizer budget cost units" type="number" min="0" step="1" value={optimizerBudget} onChange={(event) => setOptimizerBudget(Math.max(0, Number(event.target.value)))} /><em>budget</em></label></div>
          <div className="prompt-card"><span>Suggested agent prompt</span><p>{definition.suggestedPrompt}</p></div>
          <details className="scenario-advanced"><summary>Advanced compute assumptions</summary><div className="assumptions-card"><span>Routing + compute contract</span><p>ECMP equally splits a demand across all equal-cost shortest paths. N-1 uses up to {compute.recommendedWorkerCount} bounded worker slots; SharedArrayBuffer is {compute.sharedArrayBufferSupported && compute.crossOriginIsolated ? 'available but not required' : 'not required / fallback active'}.</p><button type="button" onClick={() => void runRoutingOptimizer()}>Solve diagnostic routing LP</button></div></details>
        </aside>

        <article className="panel graph-panel">
          <div className="panel-heading"><div><p className="eyebrow">Network topology</p><h2>Visual center · live routes, failures, and candidate diff</h2></div><span className="hint">Select a link, then edit explicitly</span></div>
          <TopologyCanvas project={project} analysis={analysis} selectedLinkIds={selectedLinkIds} candidateLinkIds={candidateLinkIds} selectedLinkId={selectedLinkId} onSelectLink={(linkId) => { setSelectedLinkId(linkId); setSelectedEvidence({ type: 'link', id: linkId }); }} />
          {selectedCanonicalLink && <div className="link-edit-card" data-testid="link-editor">
            <div><span>Selected link</span><strong>{selectedCanonicalLink.id} · {selectedCanonicalLink.source} ↔ {selectedCanonicalLink.target}</strong><small>{selectedCanonicalLink.available === false ? 'Administratively unavailable' : 'Available'} · canonical capacity {gbps(selectedCanonicalLink.capacityGbps)}</small></div>
            <div className="link-edit-actions">
              <button data-testid={`link-toggle-${selectedCanonicalLink.id}`} type="button" onClick={() => humanToggleLink(selectedCanonicalLink.id)}>{selectedCanonicalLink.available === false ? 'Restore link' : 'Disable link'}</button>
              <label className="number-control"><input key={`${selectedCanonicalLink.id}:${selectedCanonicalLink.capacityGbps}`} data-testid={`link-capacity-${selectedCanonicalLink.id}`} aria-label={`${selectedCanonicalLink.id} capacity Gbps`} type="number" min="0.001" step="1" defaultValue={selectedCanonicalLink.capacityGbps} onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0 && value !== selectedCanonicalLink.capacityGbps) humanUpdateLinkCapacity(selectedCanonicalLink.id, value); }} /><em>Gbps</em></label>
            </div>
          </div>}
          <div className="legend" aria-label="Graph legend"><span><i className="legend-line normal" />normal</span><span><i className="legend-line thick" />loaded</span><span><i className="legend-line dashed" />failed / candidate</span><span><i className="legend-line selected" />selected evidence</span></div>
        </article>

        <aside data-testid="evidence-panel" className="panel evidence-panel">
          <div className="panel-heading compact"><div><p className="eyebrow">Evidence</p><h2>{analysis.result.verdict === 'PASS' ? 'No modeled violations' : `${analysis.result.violations.length} violation(s)`}</h2></div></div>
          <dl className="metrics evidence-metrics"><div><dt>Verdict</dt><dd>{analysis.result.verdict}</dd></div><div><dt>Peak</dt><dd>{pct(peak)}</dd></div><div><dt>Unrouted</dt><dd>{analysis.routing.unroutedDemandIds.length}</dd></div><div><dt>Routing mode</dt><dd>{analysis.routing.mode === 'ecmp' ? 'ECMP' : 'Shortest path'}</dd></div></dl>
          {growth && <div data-testid="growth-evidence" className="evidence-block"><span className="block-label">Growth evidence</span><strong>First failure: {growth.firstFailureMultiplier ? `${growth.firstFailureMultiplier}×` : 'none'}</strong><p>{growth.firstFailureLinkId ? `${growth.firstFailureLinkId} is the first constraint; target peak ${pct(growth.target.routing.peakUtilizationPct)}.` : 'No failure in tested range.'}</p></div>}
          {contingencies && <div data-testid="resilience-evidence" className="evidence-block"><span className="block-label">Resilience evidence</span><strong>{contingencies.completedScenarios}/{contingencies.totalEligibleScenarios} single-link failures · {contingencies.executionMode}</strong><p>Worst: {String(contingencies.result.metrics.worstLinkId)} · score {String(contingencies.result.metrics.worstScore)} · peak {pct(Number(contingencies.result.metrics.worstPeakUtilizationPct))}</p></div>}
          {bottleneck && <div className="evidence-block cut-block"><span className="block-label">Min-cut evidence</span><strong>{bottleneck.sourceId} → {bottleneck.targetId}: {gbps(bottleneck.cut.cutCapacityGbps)}</strong><p>Cut links: {bottleneck.cut.cutLinkIds.join(', ') || 'none'} · requested direct demand {gbps(bottleneck.requestedDemandGbps)} · headroom {gbps(bottleneck.headroomGbps)}</p></div>}
          <div className="violation-list">{analysis.result.violations.length === 0 ? <p className="empty">PASS under the displayed ECMP/capacity assumptions.</p> : analysis.result.violations.map((violation) => <button className="violation" key={violation.id} onClick={() => selectViolation(violation)}><strong>{violation.type.replaceAll('_', ' ')}</strong><p>{violation.message}</p></button>)}</div>
          {analysis.result.verdict === 'FAIL' && <button className="wide" onClick={inspectCurrentBottleneck}>Find min-cut bottleneck</button>}
          {routingOptimization && <div className="evidence-block"><span className="block-label">Traffic allocation LP</span><strong>{routingOptimization.diagnostics.status} · {routingOptimization.diagnostics.proof}</strong><p>Minimum max utilization {routingOptimization.maxUtilizationPct === null ? 'n/a' : pct(routingOptimization.maxUtilizationPct)} · solver {routingOptimization.diagnostics.solver} {routingOptimization.diagnostics.solverVersion} · model {shortHash(routingOptimization.diagnostics.modelHash)}</p></div>}
          {optimizerResult && <div data-testid="capacity-optimizer-result" className="evidence-block"><span className="block-label">Capacity MILP</span><strong>{optimizerResult.diagnostics.status} · {optimizerResult.diagnostics.proof}</strong><p>{optimizerResult.selectedUpgrades.length} upgrade(s) · objective {optimizerResult.diagnostics.objectiveValue ?? 'n/a'} · {optimizerResult.diagnostics.runtimeMs} ms · problem {shortHash(optimizerResult.diagnostics.problemHash)}</p>{optimizerResult.diagnostics.proof !== 'optimal' && <small>No optimality claim is shown without solver proof.</small>}</div>}
          {candidateVerification && <div data-testid="candidate-verification" className={`comparison ${candidateVerification.status === 'verified' ? 'comparison-pass' : ''}`}><span>Independent candidate verification</span><strong>{candidateVerification.status === 'verified' ? 'VERIFIED' : 'DISAGREEMENT'}</strong><p>{candidateVerification.status === 'verified' ? `Cost ${candidateVerification.calculatedCost}; all selected scenarios satisfy constraints.` : candidateVerification.violations.join(' ')}</p></div>}
          {undoCandidate && <button data-testid="undo-candidate" className="wide" onClick={undoAppliedCandidate}>Undo applied candidate</button>}
          {candidate && <div data-testid="candidate-card" className="candidate-card"><div className="candidate-title"><span>Candidate plan</span><strong>{candidate.name}</strong></div>{candidate.commands.map((command) => <p key={command.id}><span className="mono">{String(command.args.linkId)}</span> → {String(command.args.capacityGbps)} Gbps</p>)}<small>{candidate.objective.name}: {candidate.objective.value} {candidate.objective.unit}</small><div className="candidate-actions"><button onClick={compareCurrentCandidate}>Compare</button>{optimizerResult && <button data-testid="verify-candidate" onClick={() => void verifyCurrentCandidate()}>Verify</button>}<button data-testid="apply-candidate" className="primary" onClick={applyCurrentCandidate}>Apply</button><button onClick={() => { setCandidate(null); setComparison(null); }}>Discard</button></div></div>}
          {!candidate && analysis.result.verdict === 'FAIL' && <button data-testid="propose-deterministic" className="wide" onClick={proposeMitigation}>Quick deterministic mitigation</button>}
          {comparison && <div className={`comparison ${comparison.after.result.verdict === 'PASS' ? 'comparison-pass' : ''}`}><span>Before → proposed</span><strong>{candidateBeforeAfter}</strong><p>Peak {pct(comparison.before.routing.peakUtilizationPct)} → {pct(comparison.after.routing.peakUtilizationPct)} · violations {comparison.before.result.violations.length} → {comparison.after.result.violations.length}</p></div>}
        </aside>
      </section>

      <section className="lower-grid">
        <article className="panel demand-panel">
          <div className="panel-heading"><div><p className="eyebrow">Demands</p><h2>ECMP route evidence + human edit</h2></div><span className="hint">Edits cancel stale analyses</span></div>
          <div className="demand-list">{project.demands.length === 0 ? <p className="empty">No demands in this project.</p> : project.demands.map((demand) => {
            const effectiveDemand = snapshot.demands.find((item) => item.id === demand.id) ?? demand; const route = routeByDemand.get(demand.id); const serviceClass = classById.get(demand.serviceClassId); const links = allRouteLinks(route);
            return <div className="demand-row" key={demand.id}><button className="demand-route" onClick={() => setSelectedEvidence({ type: 'route', id: `route:${demand.id}`, demandId: demand.id, linkIds: links })}><strong>{demand.id} · {demand.name ?? demand.id}</strong><small>{route?.reachable ? `${route.equalCostPathCountExact} equal-cost path(s)${route.pathsTruncated ? ` · showing ${route.materializedPathCount}` : ''} · ${links.join(' / ') || 'local'}` : 'unreachable'} · {serviceClass?.name ?? demand.serviceClassId} ≤ {serviceClass?.maxUtilizationPct ?? 100}%</small>{effectiveDemand.bandwidthGbps !== demand.bandwidthGbps && <em>scenario: {gbps(effectiveDemand.bandwidthGbps)}</em>}</button><span className="number-control"><input data-testid={`demand-input-${demand.id}`} aria-label={`${demand.id} bandwidth Gbps`} type="number" min="0" step="1" value={demand.bandwidthGbps} onChange={(event) => humanUpdateDemand(demand.id, Number(event.target.value))} /><em>Gbps</em></span></div>;
          })}</div>
        </article>

        <article className="panel contingency-panel">
          <div className="panel-heading"><div><p className="eyebrow">Counterexample replay</p><h2>{contingencies ? 'Ranked N-1 cases' : 'Worker-parallel resilience'}</h2></div></div>
          {contingencies ? <div data-testid="contingency-list" className="contingency-list">{contingencies.cases.slice(0, 8).map((item, index) => <button data-testid={`counterexample-${item.linkId}`} key={item.linkId} className={activePatch?.id === item.patch.id ? 'active' : ''} onClick={() => replayContingency(item.linkId)}><span>#{index + 1} · {item.linkId}</span><strong>{item.verdict}</strong><small>score {item.score} · peak {pct(item.peakUtilizationPct)} · unsatisfied {gbps(item.unroutedDemandGbps)}</small></button>)}</div> : <p className="muted">Run N-1 to enumerate bounded single-link failures. The browser uses real Web Workers when available and a deterministic bounded fallback otherwise.</p>}
        </article>

        <details className="panel agent-panel advanced-disclosure" data-testid="advanced-inspector">
          <summary><span>Advanced / Inspector</span><strong>{registeredTools.length} WebMCP capabilities · {compute.executionMode}</strong></summary>
          <div className="advanced-body">
            <div className="panel-heading"><div><p className="eyebrow">Agent activity / WebMCP</p><h2>State-derived semantic capabilities</h2></div><span className={`status-dot ${webmcpStatus}`} /></div>
            <div className="tool-badges">{registeredTools.map((name) => <span key={name} className={['propose_change', 'show_counterexample', 'apply_candidate', 'discard_candidate', 'optimize_capacity_plan'].includes(name) ? 'mutating' : ''}>{name}</span>)}</div>
            <p className="capability-note">Violation tools require current FAIL evidence. Counterexample replay appears only after a valid N-1 ranking exists. Optimizer tools appear only after the HiGHS worker probes successfully. Registration groups are revoked with AbortSignal lifetimes.</p>
            <dl className="metrics inspector-metrics"><div><dt>Worker mode</dt><dd>{compute.executionMode}</dd></div><div><dt>Worker slots</dt><dd>{compute.recommendedWorkerCount}</dd></div><div><dt>SharedArrayBuffer</dt><dd>{compute.sharedArrayBufferSupported && compute.crossOriginIsolated ? 'available' : 'not required'}</dd></div><div><dt>Optimizer</dt><dd>{optimizerStatus}</dd></div></dl>
            {lastToolAnalysis && <p className="tool-result">Latest tool-published analysis: {lastToolAnalysis}</p>}
            <div className="activity-list">{activity.length === 0 ? <p className="muted">Tool calls appear here with classification, duration, cancellation/error state, and compact result summaries.</p> : activity.map((event) => <div key={event.id} className="activity-row"><time>{event.startedAt.slice(11, 19)}</time><span className="activity-tool">{event.tool}</span><span className={`activity-kind ${event.readOnly ? 'readonly' : 'mutating'}`}>{event.readOnly ? 'read-only' : 'mutating'}</span><strong className={event.status}>{event.status === 'success' ? '✓' : event.status === 'cancelled' ? '■' : '✕'}</strong><small>{event.summary} · {event.durationMs} ms</small></div>)}</div>
          </div>
        </details>
      </section>
    </main>
  );
}
