import type { CandidatePlan, NetworkProject, ScenarioPatch } from '../../model/src/index.ts';
import { applyCandidatePlan, modelHash, scenarioHash } from '../../model/src/index.ts';
import {
  analyzeBottleneck,
  compareCandidate,
  proposeCapacityMitigation,
  runScenarioCapacityAnalysis,
  type BottleneckAnalysis,
  type CandidateComparison,
  type CapacityAnalysis,
  type ContingencyAnalysis,
  type ContingencyRunOptions,
  type EvidenceRef,
  type Violation,
} from '../../evidence/src/index.ts';
import type { CapacityOptimizationResult, CapacityPlanRequirements, CandidateVerification, TrafficAllocationResult } from '../../optimizer/src/index.ts';

export interface InspectNetworkSummary {
  projectId: string;
  name: string;
  modelHash: string;
  scenarioHash: string;
  scenarioName: string;
  routingMode: string;
  nodeCount: number;
  linkCount: number;
  demandCount: number;
  availableLinkCount: number;
  disabledLinkIds: string[];
  verdict: string;
  peakUtilizationPct: number;
  violations: Array<{ id: string; type: string; linkId?: string; demandId?: string; message: string }>;
}

export interface InspectDemandsSummary {
  modelHash: string;
  scenarioHash: string;
  demandCount: number;
  totalDemandGbps: number;
  demands: Array<{
    id: string;
    name: string;
    source: string;
    target: string;
    bandwidthGbps: number;
    serviceClassId: string;
    serviceClassName: string;
    maxUtilizationPct: number;
    reachable: boolean;
    routeLinkIds: string[];
    equalCostPathCount: number;
  }>;
}

export type ToolActivityStatus = 'success' | 'error' | 'cancelled';
export interface ToolActivityEvent {
  id: string;
  tool: string;
  readOnly: boolean;
  status: ToolActivityStatus;
  startedAt: string;
  durationMs: number;
  summary: string;
}

export interface ToolExecuteOptions { signal?: AbortSignal }
export interface WebMCPTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (input: Record<string, unknown>, options?: ToolExecuteOptions) => unknown | Promise<unknown>;
}

export interface ModelContextLike {
  registerTool(tool: WebMCPTool, options?: { signal?: AbortSignal }): Promise<void> | void;
}

export interface InfraTwinToolServices {
  getProject(): NetworkProject;
  setProject(project: NetworkProject): void;
  getActiveScenario(): ScenarioPatch | null;
  setActiveScenario(patch: ScenarioPatch | null): void;
  getCapacityAnalysis?(): CapacityAnalysis;
  publishCapacityAnalysis(analysis: CapacityAnalysis): void;
  runContingencies?(options?: ContingencyRunOptions): Promise<ContingencyAnalysis>;
  getContingencyAnalysis?(): ContingencyAnalysis | null;
  publishContingencyAnalysis(analysis: ContingencyAnalysis): void;
  publishBottleneckAnalysis?(analysis: BottleneckAnalysis | null): void;
  selectEvidence?(evidence: EvidenceRef | null): void;
  getCandidate(): CandidatePlan | null;
  setCandidate(candidate: CandidatePlan | null): void;
  publishCandidateComparison(comparison: CandidateComparison | null): void;
  optimizeCapacity?(requirements: CapacityPlanRequirements, options?: ToolExecuteOptions): Promise<CapacityOptimizationResult>;
  optimizeRouting?(options?: ToolExecuteOptions): Promise<TrafficAllocationResult>;
  verifyCandidate?(candidate: CandidatePlan, requirements: CapacityPlanRequirements, options?: ToolExecuteOptions): Promise<CandidateVerification>;
  publishOptimizationResult?(result: CapacityOptimizationResult | null): void;
  publishCandidateVerification?(result: CandidateVerification | null): void;
  onActivity(event: ToolActivityEvent): void;
}

export const CORE_TOOL_NAMES = ['inspect_network', 'inspect_demands', 'simulate_change', 'run_capacity_analysis', 'propose_change'] as const;
export const RESILIENCE_TOOL_NAMES = ['run_contingencies'] as const;
export const VIOLATION_TOOL_NAMES = ['inspect_violation', 'find_bottlenecks'] as const;
export const COUNTEREXAMPLE_TOOL_NAMES = ['show_counterexample'] as const;
export const CANDIDATE_TOOL_NAMES = ['compare_candidate', 'apply_candidate', 'discard_candidate'] as const;
export const OPTIMIZER_TOOL_NAMES = ['optimize_capacity_plan', 'optimize_routing', 'verify_candidate'] as const;
export const BASE_TOOL_NAMES = [...CORE_TOOL_NAMES, ...RESILIENCE_TOOL_NAMES] as const;

function round(value: number): number { return Math.round(value * 1000) / 1000; }
function elapsed(start: number): number { return round(Date.now() - start); }
function isAbort(error: unknown): boolean { return error instanceof Error && error.name === 'AbortError'; }

export function inspectNetwork(project: NetworkProject, patch?: ScenarioPatch | null): InspectNetworkSummary {
  const analysis = runScenarioCapacityAnalysis(project, patch);
  return {
    projectId: project.id,
    name: project.name,
    modelHash: modelHash(project),
    scenarioHash: scenarioHash(patch),
    scenarioName: patch?.name ?? 'Baseline',
    routingMode: project.routingProfile.mode,
    nodeCount: analysis.snapshot.nodes.length,
    linkCount: analysis.snapshot.links.length,
    demandCount: analysis.snapshot.demands.length,
    availableLinkCount: analysis.snapshot.links.filter((link) => link.available !== false).length,
    disabledLinkIds: analysis.snapshot.links.filter((link) => link.available === false).map((link) => link.id).sort(),
    verdict: analysis.result.verdict,
    peakUtilizationPct: Number(analysis.result.metrics.peakUtilizationPct),
    violations: analysis.result.violations.map(({ id, type, linkId, demandId, message }) => ({ id, type, linkId, demandId, message })),
  };
}

export function inspectDemands(project: NetworkProject, patch?: ScenarioPatch | null): InspectDemandsSummary {
  const analysis = runScenarioCapacityAnalysis(project, patch);
  const classById = new Map(analysis.snapshot.serviceClasses.map((serviceClass) => [serviceClass.id, serviceClass]));
  const routeByDemand = new Map(analysis.routing.routes.map((route) => [route.demandId, route]));
  return {
    modelHash: modelHash(project),
    scenarioHash: scenarioHash(patch),
    demandCount: analysis.snapshot.demands.length,
    totalDemandGbps: round(analysis.snapshot.demands.reduce((sum, demand) => sum + demand.bandwidthGbps, 0)),
    demands: analysis.snapshot.demands.map((demand) => {
      const serviceClass = classById.get(demand.serviceClassId);
      const route = routeByDemand.get(demand.id);
      return {
        id: demand.id,
        name: demand.name ?? demand.id,
        source: demand.source,
        target: demand.target,
        bandwidthGbps: round(demand.bandwidthGbps),
        serviceClassId: demand.serviceClassId,
        serviceClassName: serviceClass?.name ?? demand.serviceClassId,
        maxUtilizationPct: serviceClass?.maxUtilizationPct ?? 100,
        reachable: route?.reachable ?? false,
        routeLinkIds: route ? Object.keys(route.linkFractions).filter((linkId) => route.linkFractions[linkId] > 0).sort() : [],
        equalCostPathCount: route?.paths.length ?? 0,
      };
    }),
  };
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    if (typeof DOMException !== 'undefined') throw new DOMException('Tool execution cancelled', 'AbortError');
    const error = new Error('Tool execution cancelled'); error.name = 'AbortError'; throw error;
  }
}

function activityWrapper(
  services: InfraTwinToolServices,
  tool: string,
  readOnly: boolean,
  summarize: (result: unknown) => string,
  fn: (input: Record<string, unknown>, options?: ToolExecuteOptions) => unknown | Promise<unknown>,
): WebMCPTool['execute'] {
  return async (input, options) => {
    const start = Date.now();
    const startedAt = new Date(start).toISOString();
    try {
      assertNotAborted(options?.signal);
      const result = await fn(input, options);
      assertNotAborted(options?.signal);
      services.onActivity({ id: `${tool}:${start}`, tool, readOnly, status: 'success', startedAt, durationMs: elapsed(start), summary: summarize(result) });
      return result;
    } catch (error) {
      const cancelled = options?.signal?.aborted || isAbort(error);
      services.onActivity({
        id: `${tool}:${start}`,
        tool,
        readOnly,
        status: cancelled ? 'cancelled' : 'error',
        startedAt,
        durationMs: elapsed(start),
        summary: cancelled ? 'cancelled' : error instanceof Error ? error.message : 'tool execution failed',
      });
      throw error;
    }
  };
}

function buildSimulationPatch(project: NetworkProject, input: Record<string, unknown>): ScenarioPatch {
  const disabledLinkIds = Array.isArray(input.disabledLinkIds) ? input.disabledLinkIds.map(String) : [];
  const knownLinks = new Set(project.links.map((link) => link.id));
  for (const linkId of disabledLinkIds) if (!knownLinks.has(linkId)) throw new Error(`Unknown link ${linkId}`);

  const demandMultipliers = Array.isArray(input.demandMultipliers)
    ? input.demandMultipliers.map((item) => {
        if (!item || typeof item !== 'object') throw new Error('demandMultipliers entries must be objects');
        const row = item as Record<string, unknown>;
        const demandId = String(row.demandId ?? '');
        const multiplier = Number(row.multiplier);
        if (!project.demands.some((demand) => demand.id === demandId)) throw new Error(`Unknown demand ${demandId}`);
        if (!Number.isFinite(multiplier) || multiplier < 0) throw new Error('Demand multiplier must be >= 0');
        return { demandId, multiplier };
      })
    : [];

  const linkCapacityOverrides = Array.isArray(input.linkCapacityOverrides)
    ? input.linkCapacityOverrides.map((item) => {
        if (!item || typeof item !== 'object') throw new Error('linkCapacityOverrides entries must be objects');
        const row = item as Record<string, unknown>;
        const linkId = String(row.linkId ?? '');
        const capacityGbps = Number(row.capacityGbps);
        if (!knownLinks.has(linkId)) throw new Error(`Unknown link ${linkId}`);
        if (!Number.isFinite(capacityGbps) || capacityGbps <= 0) throw new Error('Capacity override must be > 0');
        return { linkId, capacityGbps };
      })
    : [];

  return {
    id: 'webmcp-simulation',
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Agent what-if simulation',
    disabledNodeIds: [], disabledLinkIds, demandMultipliers, addedDemands: [], linkCapacityOverrides,
  };
}

function createExplicitCapacityCandidate(project: NetworkProject, linkId: string, capacityGbps: number): CandidatePlan {
  const link = project.links.find((item) => item.id === linkId);
  if (!link) throw new Error(`Unknown link ${linkId}`);
  if (!Number.isFinite(capacityGbps) || capacityGbps <= link.capacityGbps) throw new Error('Proposed capacity must be above current capacity');
  return {
    id: `candidate:explicit:${modelHash(project)}:${linkId}:${capacityGbps}`,
    name: `Increase ${linkId} to ${capacityGbps} Gbps`,
    baseModelHash: modelHash(project),
    commands: [{ id: `cmd-capacity-${linkId}`, type: 'set_link_capacity', actor: 'agent', args: { linkId, capacityGbps }, createdAt: new Date(0).toISOString() }],
    objective: { name: 'manualProposal', value: 0, unit: 'cost-units' }, rationaleEvidenceIds: [],
  };
}

async function registerGroup(context: ModelContextLike, tools: WebMCPTool[]): Promise<() => void> {
  const controller = new AbortController();
  for (const tool of tools) await context.registerTool(tool, { signal: controller.signal });
  return () => controller.abort();
}

export async function registerCoreTools(context: ModelContextLike, services: InfraTwinToolServices): Promise<() => void> {
  const tools: WebMCPTool[] = [
    {
      name: 'inspect_network', title: 'Inspect current network',
      description: 'Reads the current InfraTwin project plus active scenario and returns deterministic topology/capacity state with hashes. It does not modify project state.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: activityWrapper(services, 'inspect_network', true, (result) => {
        const summary = result as InspectNetworkSummary; return `${summary.verdict} · ${summary.routingMode} · peak ${summary.peakUtilizationPct}%`;
      }, async () => inspectNetwork(services.getProject(), services.getActiveScenario())),
    },
    {
      name: 'inspect_demands', title: 'Inspect demands and ECMP routes',
      description: 'Reads demands, service classes, current routed link sets, and equal-cost path counts from the shared model/scenario state.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: activityWrapper(services, 'inspect_demands', true, (result) => {
        const summary = result as InspectDemandsSummary; return `${summary.demandCount} demands · ${summary.totalDemandGbps} Gbps`;
      }, async () => inspectDemands(services.getProject(), services.getActiveScenario())),
    },
    {
      name: 'simulate_change', title: 'Simulate a what-if change',
      description: 'Creates an ephemeral scenario overlay for failures, demand multipliers, or capacity overrides and publishes deterministic evidence without changing the canonical project.',
      inputSchema: {
        type: 'object', properties: {
          name: { type: 'string' }, disabledLinkIds: { type: 'array', items: { type: 'string' } },
          demandMultipliers: { type: 'array', items: { type: 'object', properties: { demandId: { type: 'string' }, multiplier: { type: 'number', minimum: 0 } }, required: ['demandId', 'multiplier'], additionalProperties: false } },
          linkCapacityOverrides: { type: 'array', items: { type: 'object', properties: { linkId: { type: 'string' }, capacityGbps: { type: 'number', exclusiveMinimum: 0 } }, required: ['linkId', 'capacityGbps'], additionalProperties: false } },
        }, additionalProperties: false,
      }, annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: activityWrapper(services, 'simulate_change', true, (result) => {
        const analysis = result as CapacityAnalysis; return `${analysis.result.verdict} · peak ${analysis.result.metrics.peakUtilizationPct}% · ${analysis.result.violations.length} violations`;
      }, async (input) => {
        const project = services.getProject();
        const patch = buildSimulationPatch(project, input);
        // A read-only simulation never changes the active shared scenario or canonical project.
        // The caller can explicitly replay a scenario through a mutating capability if desired.
        return runScenarioCapacityAnalysis(project, patch);
      }),
    },
    {
      name: 'run_capacity_analysis', title: 'Run capacity analysis',
      description: 'Runs deterministic ECMP/single-path routing and capacity/service-target checks on the current model plus active scenario.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: activityWrapper(services, 'run_capacity_analysis', true, (result) => {
        const analysis = result as CapacityAnalysis; return `${analysis.result.verdict} · ${analysis.routing.mode} · peak ${analysis.result.metrics.peakUtilizationPct}%`;
      }, async () => { const analysis = services.getCapacityAnalysis?.() ?? runScenarioCapacityAnalysis(services.getProject(), services.getActiveScenario()); services.publishCapacityAnalysis(analysis); return analysis; }),
    },
    {
      name: 'propose_change', title: 'Propose a candidate change',
      description: 'Creates a visible, non-applied candidate plan. Auto mitigation proposes deterministic capacity upgrades for current violations; explicit mode proposes one link capacity change.',
      inputSchema: {
        type: 'object', properties: {
          strategy: { type: 'string', enum: ['auto_mitigate', 'set_link_capacity'] }, targetHeadroomPct: { type: 'number', minimum: 0, maximum: 90 },
          linkId: { type: 'string' }, capacityGbps: { type: 'number', exclusiveMinimum: 0 },
        }, required: ['strategy'], additionalProperties: false,
      }, annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: activityWrapper(services, 'propose_change', false, (result) => {
        const candidate = result as CandidatePlan; return `${candidate.commands.length} candidate change(s) · ${candidate.objective.value} ${candidate.objective.unit ?? ''}`.trim();
      }, async (input) => {
        const project = services.getProject();
        const candidate = String(input.strategy ?? '') === 'set_link_capacity'
          ? createExplicitCapacityCandidate(project, String(input.linkId ?? ''), Number(input.capacityGbps))
          : proposeCapacityMitigation(project, services.getActiveScenario(), Number(input.targetHeadroomPct ?? 20));
        if (!candidate) throw new Error('No capacity mitigation candidate is needed or available for the current evidence.');
        services.setCandidate(candidate); services.publishCandidateComparison(null); return candidate;
      }),
    },
  ];
  return registerGroup(context, tools);
}

export async function registerResilienceTools(context: ModelContextLike, services: InfraTwinToolServices): Promise<() => void> {
  return registerGroup(context, [{
    name: 'run_contingencies', title: 'Run bounded N-1 link contingencies',
    description: 'Runs cancellable bounded N-1 link failures through the browser worker pool when available, reports progress/ranking, and protects publication with model/scenario hashes.',
    inputSchema: {
      type: 'object', properties: {
        maxScenarios: { type: 'integer', minimum: 1, maximum: 500 }, workerCount: { type: 'integer', minimum: 1, maximum: 8 },
        timeLimitMs: { type: 'integer', minimum: 50, maximum: 120000 },
      }, additionalProperties: false,
    }, annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: activityWrapper(services, 'run_contingencies', true, (result) => {
      const analysis = result as ContingencyAnalysis;
      return `${analysis.completedScenarios}/${analysis.totalEligibleScenarios} scenarios · ${analysis.executionMode} · worst ${analysis.result.metrics.worstLinkId} · ${analysis.result.verdict}`;
    }, async (input, options) => {
      if (!services.runContingencies) throw new Error('The application did not provide a contingency execution service.');
      const analysis = await services.runContingencies({
        signal: options?.signal,
        maxScenarios: input.maxScenarios === undefined ? undefined : Number(input.maxScenarios),
        workerCount: input.workerCount === undefined ? undefined : Number(input.workerCount),
        timeLimitMs: input.timeLimitMs === undefined ? undefined : Number(input.timeLimitMs),
      });
      assertNotAborted(options?.signal);
      // Publishing the derived ranking is allowed; replaying a counterexample is a separate
      // mutating capability so this analysis call never changes the active scenario.
      services.publishContingencyAnalysis(analysis);
      return analysis;
    }),
  }]);
}

function pickViolation(analysis: CapacityAnalysis, violationId?: string): Violation {
  const violation = violationId ? analysis.result.violations.find((item) => item.id === violationId) : analysis.result.violations[0];
  if (!violation) throw new Error(violationId ? `Unknown current violation ${violationId}` : 'No current violation exists.');
  return violation;
}

function pickBottleneckEndpoints(analysis: CapacityAnalysis, sourceId?: string, targetId?: string): { sourceId: string; targetId: string } {
  if (sourceId && targetId) return { sourceId, targetId };
  const violation = analysis.result.violations.find((item) => item.demandId);
  const demand = violation?.demandId ? analysis.snapshot.demands.find((item) => item.id === violation.demandId) : undefined;
  const fallback = [...analysis.snapshot.demands].sort((a, b) => b.bandwidthGbps - a.bandwidthGbps || a.id.localeCompare(b.id))[0];
  const selected = demand ?? fallback;
  if (!selected) throw new Error('No demand is available to choose bottleneck endpoints.');
  return { sourceId: sourceId ?? selected.source, targetId: targetId ?? selected.target };
}

export async function registerViolationTools(context: ModelContextLike, services: InfraTwinToolServices): Promise<() => void> {
  const tools: WebMCPTool[] = [
    {
      name: 'inspect_violation', title: 'Inspect a current violation',
      description: 'Returns one concrete current violation plus stable-ID evidence from the shared capacity analysis.',
      inputSchema: { type: 'object', properties: { violationId: { type: 'string' } }, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: activityWrapper(services, 'inspect_violation', true, (result) => {
        const row = result as { violation: Violation }; return `${row.violation.type} · ${row.violation.linkId ?? row.violation.demandId ?? row.violation.id}`;
      }, async (input) => {
        const analysis = services.getCapacityAnalysis?.() ?? runScenarioCapacityAnalysis(services.getProject(), services.getActiveScenario());
        const violation = pickViolation(analysis, typeof input.violationId === 'string' ? input.violationId : undefined);
        const witnesses = analysis.result.witnesses.filter((item) => item.id === violation.linkId || item.demandId === violation.demandId || item.id === `route:${violation.demandId}`);
        return { modelHash: analysis.result.modelHash, scenarioHash: analysis.result.scenarioHash, violation, witnesses };
      }),
    },
    {
      name: 'find_bottlenecks', title: 'Find min-cut bottleneck evidence',
      description: 'Runs deterministic max-flow/min-cut for selected or inferred endpoints on the active scenario and maps cut edges to stable graph link IDs.',
      inputSchema: { type: 'object', properties: { sourceId: { type: 'string' }, targetId: { type: 'string' } }, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: activityWrapper(services, 'find_bottlenecks', true, (result) => {
        const analysis = result as BottleneckAnalysis; return `${analysis.sourceId}→${analysis.targetId} cut ${analysis.cut.cutCapacityGbps} Gbps · ${analysis.cut.cutLinkIds.join(', ') || 'no cut edges'}`;
      }, async (input) => {
        const capacity = services.getCapacityAnalysis?.() ?? runScenarioCapacityAnalysis(services.getProject(), services.getActiveScenario());
        const endpoints = pickBottleneckEndpoints(capacity, typeof input.sourceId === 'string' ? input.sourceId : undefined, typeof input.targetId === 'string' ? input.targetId : undefined);
        const analysis = analyzeBottleneck(services.getProject(), endpoints.sourceId, endpoints.targetId, services.getActiveScenario());
        services.publishBottleneckAnalysis?.(analysis); services.selectEvidence?.(analysis.evidence); return analysis;
      }),
    },
  ];
  return registerGroup(context, tools);
}

export async function registerCounterexampleTools(context: ModelContextLike, services: InfraTwinToolServices): Promise<() => void> {
  return registerGroup(context, [
    {
      name: 'show_counterexample', title: 'Show a contingency counterexample',
      description: 'Selects and replays a ranked N-1 counterexample in the shared UI. This changes only ephemeral scenario/evidence selection, not the canonical project.',
      inputSchema: { type: 'object', properties: { linkId: { type: 'string' } }, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: activityWrapper(services, 'show_counterexample', false, (result) => {
        const row = result as { linkId: string; verdict: string; score: number }; return `${row.linkId} · ${row.verdict} · score ${row.score}`;
      }, async (input) => {
        const contingencies = services.getContingencyAnalysis?.() ?? null;
        if (!contingencies) throw new Error('No contingency ranking exists. Run contingencies first.');
        const item = typeof input.linkId === 'string' ? contingencies.cases.find((entry) => entry.linkId === input.linkId) : contingencies.worst;
        if (!item) throw new Error('Requested contingency is not in the current ranking.');
        services.setActiveScenario(item.patch); services.selectEvidence?.({ type: 'link', id: item.linkId });
        return { linkId: item.linkId, verdict: item.verdict, score: item.score, patchId: item.patch.id, affectedDemandIds: item.affectedDemandIds };
      }),
    }
  ]);
}

export async function registerCandidateTools(context: ModelContextLike, services: InfraTwinToolServices): Promise<() => void> {
  const tools: WebMCPTool[] = [
    {
      name: 'compare_candidate', title: 'Compare current candidate',
      description: 'Compares the visible candidate against the current model under the active scenario and publishes deterministic before/after metrics.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: activityWrapper(services, 'compare_candidate', true, (result) => {
        const comparison = result as CandidateComparison; return `${comparison.before.result.verdict} → ${comparison.after.result.verdict} · peak Δ ${comparison.deltaPeakUtilizationPct}%`;
      }, async () => {
        const candidate = services.getCandidate(); if (!candidate) throw new Error('No candidate exists.');
        const comparison = compareCandidate(services.getProject(), candidate, services.getActiveScenario()); services.publishCandidateComparison(comparison); return comparison;
      }),
    },
    {
      name: 'apply_candidate', title: 'Apply current candidate',
      description: 'Commits the visible candidate to the local canonical project after base-hash verification. This mutates project state and clears the candidate.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: activityWrapper(services, 'apply_candidate', false, (result) => `applied · model ${modelHash(result as NetworkProject)}`, async () => {
        const candidate = services.getCandidate(); if (!candidate) throw new Error('No candidate exists.');
        const nextProject = applyCandidatePlan(services.getProject(), candidate);
        services.setProject(nextProject); services.setCandidate(null); services.publishCandidateComparison(null);
        services.publishCapacityAnalysis(runScenarioCapacityAnalysis(nextProject, services.getActiveScenario())); return nextProject;
      }),
    },
    {
      name: 'discard_candidate', title: 'Discard current candidate',
      description: 'Removes the visible candidate plan without changing the canonical project.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: activityWrapper(services, 'discard_candidate', false, () => 'candidate discarded', async () => {
        if (!services.getCandidate()) throw new Error('No candidate exists.');
        services.setCandidate(null); services.publishCandidateComparison(null); return { discarded: true, modelHash: modelHash(services.getProject()) };
      }),
    },
  ];
  return registerGroup(context, tools);
}

function optimizerScenarioRequirements(services: InfraTwinToolServices, input: Record<string, unknown>): CapacityPlanRequirements {
  const scenarioPatches: ScenarioPatch[] = [];
  const active = services.getActiveScenario();
  if (active) scenarioPatches.push(active);
  const topCount = Math.max(0, Math.min(10, Number(input.includeTopContingencies ?? 0)));
  const contingencies = services.getContingencyAnalysis?.();
  for (const item of contingencies?.cases.slice(0, topCount) ?? []) {
    if (!scenarioPatches.some((patch) => scenarioHash(patch) === scenarioHash(item.patch))) scenarioPatches.push(item.patch);
  }
  return {
    targetUtilizationPct: input.targetUtilizationPct === undefined ? 80 : Number(input.targetUtilizationPct),
    budgetCostUnits: input.budgetCostUnits === undefined ? undefined : Number(input.budgetCostUnits),
    includeBaseline: input.includeBaseline === undefined ? true : Boolean(input.includeBaseline),
    scenarioPatches,
  };
}

export async function registerOptimizerTools(context: ModelContextLike, services: InfraTwinToolServices): Promise<() => void> {
  const tools: WebMCPTool[] = [
    {
      name: 'optimize_capacity_plan', title: 'Find minimum-cost capacity mitigation',
      description: 'Runs the browser-local HiGHS WASM capacity MILP against the current model, active scenario, and optionally top N-1 cases. Returns a candidate plan only; it never applies changes.',
      inputSchema: { type: 'object', properties: {
        targetUtilizationPct: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
        budgetCostUnits: { type: 'number', minimum: 0 }, includeBaseline: { type: 'boolean' },
        includeTopContingencies: { type: 'integer', minimum: 0, maximum: 10 }, timeLimitMs: { type: 'integer', minimum: 50, maximum: 30000 },
      }, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: activityWrapper(services, 'optimize_capacity_plan', false, (result) => {
        const row = result as CapacityOptimizationResult; return `${row.diagnostics.status} · ${row.diagnostics.proof} · ${row.selectedUpgrades.length} upgrade(s) · objective ${row.diagnostics.objectiveValue ?? 'n/a'}`;
      }, async (input, options) => {
        if (!services.optimizeCapacity) throw new Error('Optimizer is not loaded in the application.');
        const requirements = optimizerScenarioRequirements(services, input);
        const expectedModelHash = modelHash(services.getProject());
        const expectedScenarioHash = scenarioHash(services.getActiveScenario());
        const result = await services.optimizeCapacity(requirements, { signal: options?.signal });
        assertNotAborted(options?.signal);
        if (modelHash(services.getProject()) !== expectedModelHash || scenarioHash(services.getActiveScenario()) !== expectedScenarioHash) {
          throw new Error('Optimizer result is stale because the model or active scenario changed before publication.');
        }
        services.publishOptimizationResult?.(result);
        if (result.candidate) { services.setCandidate(result.candidate); services.publishCandidateComparison(null); services.publishCandidateVerification?.(null); }
        return result;
      }),
    },
    {
      name: 'optimize_routing', title: 'Solve traffic allocation LP',
      description: 'Runs a HiGHS flow-allocation LP on the current network snapshot and returns minimum possible maximum utilization plus per-link flow evidence. It does not mutate the project.',
      inputSchema: { type: 'object', properties: { timeLimitMs: { type: 'integer', minimum: 50, maximum: 30000 } }, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: activityWrapper(services, 'optimize_routing', true, (result) => {
        const row = result as TrafficAllocationResult; return `${row.diagnostics.status} · max utilization ${row.maxUtilizationPct ?? 'n/a'}% · ${row.allocations.length} flow rows`;
      }, async (_input, options) => {
        if (!services.optimizeRouting) throw new Error('Optimizer is not loaded in the application.');
        const expectedModelHash = modelHash(services.getProject());
        const expectedScenarioHash = scenarioHash(services.getActiveScenario());
        const result = await services.optimizeRouting({ signal: options?.signal });
        assertNotAborted(options?.signal);
        if (modelHash(services.getProject()) !== expectedModelHash || scenarioHash(services.getActiveScenario()) !== expectedScenarioHash) {
          throw new Error('Routing optimization result is stale because the model or active scenario changed.');
        }
        return result;
      }),
    },
    {
      name: 'verify_candidate', title: 'Independently verify optimizer candidate',
      description: 'Checks the visible candidate without trusting the optimizer result: recomputes declared upgrade cost and replays baseline/selected scenarios. Any disagreement blocks verified status.',
      inputSchema: { type: 'object', properties: {
        targetUtilizationPct: { type: 'number', exclusiveMinimum: 0, maximum: 100 }, budgetCostUnits: { type: 'number', minimum: 0 },
        includeBaseline: { type: 'boolean' }, includeTopContingencies: { type: 'integer', minimum: 0, maximum: 10 },
      }, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: activityWrapper(services, 'verify_candidate', true, (result) => {
        const row = result as CandidateVerification; return `${row.status} · cost ${row.calculatedCost ?? 'n/a'} · ${row.violations.length} disagreement(s)`;
      }, async (input, options) => {
        const candidate = services.getCandidate(); if (!candidate) throw new Error('No candidate exists.');
        if (!services.verifyCandidate) throw new Error('Independent verifier is not loaded in the application.');
        const requirements = optimizerScenarioRequirements(services, input);
        const result = await services.verifyCandidate(candidate, requirements, { signal: options?.signal });
        assertNotAborted(options?.signal);
        if (candidate.baseModelHash !== modelHash(services.getProject())) throw new Error('Candidate verification is stale because the project changed.');
        services.publishCandidateVerification?.(result); return result;
      }),
    },
  ];
  return registerGroup(context, tools);
}

export async function registerBaseTools(context: ModelContextLike, services: InfraTwinToolServices): Promise<() => void> {
  const disposeCore = await registerCoreTools(context, services);
  const disposeResilience = await registerResilienceTools(context, services);
  return () => { disposeResilience(); disposeCore(); };
}

export async function registerInspectNetworkTool(context: ModelContextLike, getProject: () => NetworkProject): Promise<() => void> {
  const controller = new AbortController();
  await context.registerTool({
    name: 'inspect_network', title: 'Inspect current network',
    description: 'Reads the currently open InfraTwin network and returns a compact deterministic topology/capacity summary. It does not modify project state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => inspectNetwork(getProject()),
  }, { signal: controller.signal });
  return () => controller.abort();
}
