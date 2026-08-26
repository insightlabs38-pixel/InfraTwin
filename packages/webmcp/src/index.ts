import type { CandidatePlan, NetworkProject, ScenarioPatch } from '../../model/src/index.ts';
import { applyCandidatePlan, applyScenario, modelHash, scenarioHash } from '../../model/src/index.ts';
import {
  compareCandidate,
  proposeCapacityMitigation,
  runLinkContingencies,
  runScenarioCapacityAnalysis,
  type CandidateComparison,
  type CapacityAnalysis,
  type ContingencyAnalysis,
} from '../../evidence/src/index.ts';

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
  violations: Array<{ type: string; linkId?: string; demandId?: string; message: string }>;
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
  publishCapacityAnalysis(analysis: CapacityAnalysis): void;
  publishContingencyAnalysis(analysis: ContingencyAnalysis): void;
  getCandidate(): CandidatePlan | null;
  setCandidate(candidate: CandidatePlan | null): void;
  publishCandidateComparison(comparison: CandidateComparison | null): void;
  onActivity(event: ToolActivityEvent): void;
}

export const BASE_TOOL_NAMES = [
  'inspect_network',
  'inspect_demands',
  'simulate_change',
  'run_capacity_analysis',
  'run_contingencies',
  'propose_change',
] as const;
export const CANDIDATE_TOOL_NAMES = ['compare_candidate', 'apply_candidate', 'discard_candidate'] as const;

function round(value: number): number { return Math.round(value * 1000) / 1000; }
function elapsed(start: number): number { return round(Date.now() - start); }

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
    violations: analysis.result.violations.map(({ type, linkId, demandId, message }) => ({ type, linkId, demandId, message })),
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
        routeLinkIds: route?.linkIds ?? [],
      };
    }),
  };
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Tool execution cancelled', 'AbortError');
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
      const cancelled = options?.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError');
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
    id: `webmcp-simulation-${Date.now()}`,
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Agent what-if simulation',
    disabledNodeIds: [],
    disabledLinkIds,
    demandMultipliers,
    addedDemands: [],
    linkCapacityOverrides,
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
    commands: [{
      id: `cmd-capacity-${linkId}`,
      type: 'set_link_capacity',
      actor: 'agent',
      args: { linkId, capacityGbps },
      createdAt: new Date(0).toISOString(),
    }],
    objective: { name: 'manualProposal', value: 0, unit: 'cost-units' },
    rationaleEvidenceIds: [],
  };
}

export async function registerBaseTools(context: ModelContextLike, services: InfraTwinToolServices): Promise<() => void> {
  const controller = new AbortController();
  const register = (tool: WebMCPTool) => context.registerTool(tool, { signal: controller.signal });

  await register({
    name: 'inspect_network',
    title: 'Inspect current network',
    description: 'Reads the current InfraTwin project and active what-if scenario, returning a compact deterministic topology/capacity summary. Does not modify project state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: activityWrapper(services, 'inspect_network', true, (result) => {
      const summary = result as InspectNetworkSummary;
      return `${summary.nodeCount} nodes · ${summary.linkCount} links · ${summary.verdict} · peak ${summary.peakUtilizationPct}%`;
    }, async () => inspectNetwork(services.getProject(), services.getActiveScenario())),
  });

  await register({
    name: 'inspect_demands',
    title: 'Inspect current demands',
    description: 'Reads demand, service-class, and current routed-path summaries from the visible InfraTwin workspace. Does not modify project state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: activityWrapper(services, 'inspect_demands', true, (result) => {
      const summary = result as InspectDemandsSummary;
      return `${summary.demandCount} demands · ${summary.totalDemandGbps} Gbps`;
    }, async () => inspectDemands(services.getProject(), services.getActiveScenario())),
  });

  await register({
    name: 'simulate_change',
    title: 'Simulate a network change',
    description: 'Creates an ephemeral scenario over the current project, recomputes deterministic routing/capacity, and displays the result in the shared UI. The persistent project is not changed.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        disabledLinkIds: { type: 'array', items: { type: 'string' } },
        demandMultipliers: {
          type: 'array',
          items: { type: 'object', properties: { demandId: { type: 'string' }, multiplier: { type: 'number', minimum: 0 } }, required: ['demandId', 'multiplier'], additionalProperties: false },
        },
        linkCapacityOverrides: {
          type: 'array',
          items: { type: 'object', properties: { linkId: { type: 'string' }, capacityGbps: { type: 'number', exclusiveMinimum: 0 } }, required: ['linkId', 'capacityGbps'], additionalProperties: false },
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: activityWrapper(services, 'simulate_change', true, (result) => {
      const analysis = result as CapacityAnalysis;
      return `${analysis.result.verdict} · peak ${analysis.result.metrics.peakUtilizationPct}% · ${analysis.result.violations.length} violations`;
    }, async (input) => {
      const project = services.getProject();
      const patch = buildSimulationPatch(project, input);
      const analysis = runScenarioCapacityAnalysis(project, patch);
      services.setActiveScenario(patch);
      services.publishCapacityAnalysis(analysis);
      return analysis;
    }),
  });

  await register({
    name: 'run_capacity_analysis',
    title: 'Run capacity analysis',
    description: 'Runs deterministic routing and capacity/SLA-proxy checks on the current project plus active scenario. Does not modify the project.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: activityWrapper(services, 'run_capacity_analysis', true, (result) => {
      const analysis = result as CapacityAnalysis;
      return `${analysis.result.verdict} · peak ${analysis.result.metrics.peakUtilizationPct}% · ${analysis.result.violations.length} violations`;
    }, async () => {
      const analysis = runScenarioCapacityAnalysis(services.getProject(), services.getActiveScenario());
      services.publishCapacityAnalysis(analysis);
      return analysis;
    }),
  });

  await register({
    name: 'run_contingencies',
    title: 'Run single-link contingencies',
    description: 'Tests every currently available single-link failure sequentially against the current canonical project, ranks impact, and replays the worst case in the shared UI. Does not commit a project mutation.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: activityWrapper(services, 'run_contingencies', true, (result) => {
      const analysis = result as ContingencyAnalysis;
      return `${analysis.result.metrics.scenariosTested} scenarios · worst ${analysis.result.metrics.worstLinkId} · ${analysis.result.verdict}`;
    }, async (_input, options) => {
      assertNotAborted(options?.signal);
      const analysis = runLinkContingencies(services.getProject());
      assertNotAborted(options?.signal);
      services.publishContingencyAnalysis(analysis);
      if (analysis.worst) services.setActiveScenario(analysis.worst.patch);
      return analysis;
    }),
  });

  await register({
    name: 'propose_change',
    title: 'Propose a candidate change',
    description: 'Creates a visible, non-applied candidate plan. Use auto_mitigate to propose deterministic capacity upgrades for current violations, or set_link_capacity for an explicit capacity proposal. Does not commit the candidate to the project.',
    inputSchema: {
      type: 'object',
      properties: {
        strategy: { type: 'string', enum: ['auto_mitigate', 'set_link_capacity'] },
        targetHeadroomPct: { type: 'number', minimum: 0, maximum: 90 },
        linkId: { type: 'string' },
        capacityGbps: { type: 'number', exclusiveMinimum: 0 },
      },
      required: ['strategy'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: activityWrapper(services, 'propose_change', false, (result) => {
      const candidate = result as CandidatePlan;
      return `${candidate.commands.length} candidate change(s) · ${candidate.objective.value} ${candidate.objective.unit ?? ''}`.trim();
    }, async (input) => {
      const project = services.getProject();
      const strategy = String(input.strategy ?? '');
      const candidate = strategy === 'set_link_capacity'
        ? createExplicitCapacityCandidate(project, String(input.linkId ?? ''), Number(input.capacityGbps))
        : proposeCapacityMitigation(project, services.getActiveScenario(), Number(input.targetHeadroomPct ?? 20));
      if (!candidate) throw new Error('No capacity mitigation candidate is needed or available for the current evidence.');
      services.setCandidate(candidate);
      services.publishCandidateComparison(null);
      return candidate;
    }),
  });

  return () => controller.abort();
}

export async function registerCandidateTools(context: ModelContextLike, services: InfraTwinToolServices): Promise<() => void> {
  const controller = new AbortController();
  const register = (tool: WebMCPTool) => context.registerTool(tool, { signal: controller.signal });

  await register({
    name: 'compare_candidate',
    title: 'Compare current candidate',
    description: 'Compares the visible candidate plan against the current project under the active scenario and publishes before/after deterministic metrics. Does not apply the candidate.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: activityWrapper(services, 'compare_candidate', true, (result) => {
      const comparison = result as CandidateComparison;
      return `${comparison.before.result.verdict} → ${comparison.after.result.verdict} · peak Δ ${comparison.deltaPeakUtilizationPct}%`;
    }, async () => {
      const candidate = services.getCandidate();
      if (!candidate) throw new Error('No candidate exists.');
      const comparison = compareCandidate(services.getProject(), candidate, services.getActiveScenario());
      services.publishCandidateComparison(comparison);
      return comparison;
    }),
  });

  await register({
    name: 'apply_candidate',
    title: 'Apply current candidate',
    description: 'Commits the currently visible candidate commands to the local canonical project after verifying the candidate base model hash. This mutates project state and clears the candidate.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false },
    execute: activityWrapper(services, 'apply_candidate', false, (result) => {
      const project = result as NetworkProject;
      return `applied · model ${modelHash(project)}`;
    }, async () => {
      const candidate = services.getCandidate();
      if (!candidate) throw new Error('No candidate exists.');
      const nextProject = applyCandidatePlan(services.getProject(), candidate);
      services.setProject(nextProject);
      services.setCandidate(null);
      services.publishCandidateComparison(null);
      services.publishCapacityAnalysis(runScenarioCapacityAnalysis(nextProject, services.getActiveScenario()));
      return nextProject;
    }),
  });

  await register({
    name: 'discard_candidate',
    title: 'Discard current candidate',
    description: 'Removes the visible candidate plan without changing the canonical project.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false },
    execute: activityWrapper(services, 'discard_candidate', false, () => 'candidate discarded', async () => {
      if (!services.getCandidate()) throw new Error('No candidate exists.');
      services.setCandidate(null);
      services.publishCandidateComparison(null);
      return { discarded: true, modelHash: modelHash(services.getProject()) };
    }),
  });

  return () => controller.abort();
}

export async function registerInspectNetworkTool(context: ModelContextLike, getProject: () => NetworkProject): Promise<() => void> {
  const controller = new AbortController();
  await context.registerTool({
    name: 'inspect_network',
    title: 'Inspect current network',
    description: 'Reads the currently open InfraTwin network and returns a compact deterministic topology/capacity summary. It does not modify project state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async () => inspectNetwork(getProject()),
  }, { signal: controller.signal });
  return () => controller.abort();
}
