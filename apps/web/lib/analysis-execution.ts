import type { ChangePlan, NetworkProject } from '@infratwin/model';
import { changePlanHash, modelHash } from '@infratwin/model';
import { estimateRoutingWorkload } from '@infratwin/graph-engine';

/**
 * Phase 3.5C adaptive execution threshold. This is a complexity envelope, not a runtime prediction.
 * It is deliberately conservative: workloads at or above the measured Tier-C class are moved off the main thread even when a
 * fast machine might finish quickly. The value is validated by the reproducible browser benchmark.
 */
export const ANALYSIS_WORKER_THRESHOLD_UNITS = 700_000;

export type CapacityExecutionMode = 'main-thread' | 'worker';

export const N1_ENGINE_HARD_CAP = 500;
export const LARGE_SCALE_N1_WORK_UNITS = 700_000;
export const LARGE_SCALE_N1_RECOMMENDED_CAP = 50;

export interface N1ExecutionPolicy {
  eligibleScenarios: number;
  maxScenarios: number;
  timeLimitMs: number;
  guidance: 'AVAILABLE' | 'LONG-RUNNING' | 'BOUNDED';
  reason: string;
}

/**
 * Browser N-1 policy derived from the Phase 3.5C Tier-C browser measurement.
 * The evidence engine retains its exact 500-scenario hard cap; this product policy lowers the
 * recommended browser batch only when routing complexity reaches the measured large-scale class.
 */
export function n1ExecutionPolicy(project: NetworkProject): N1ExecutionPolicy {
  const estimate = estimateRoutingWorkload(project);
  const eligibleScenarios = project.links.filter((link) => link.available !== false).length;
  const largeMeasuredClass = estimate.estimatedWorkUnits >= LARGE_SCALE_N1_WORK_UNITS;
  const maxScenarios = Math.min(
    N1_ENGINE_HARD_CAP,
    eligibleScenarios,
    largeMeasuredClass ? LARGE_SCALE_N1_RECOMMENDED_CAP : N1_ENGINE_HARD_CAP,
  );
  const guidance: N1ExecutionPolicy['guidance'] = eligibleScenarios > maxScenarios
    ? 'BOUNDED'
    : eligibleScenarios > 100
      ? 'LONG-RUNNING'
      : 'AVAILABLE';
  return {
    eligibleScenarios,
    maxScenarios: Math.max(1, maxScenarios),
    timeLimitMs: 30_000,
    guidance,
    reason: largeMeasuredClass && eligibleScenarios > LARGE_SCALE_N1_RECOMMENDED_CAP
      ? `Measured large-scale routing workload; run the first ${LARGE_SCALE_N1_RECOMMENDED_CAP} exact link failures per browser batch.`
      : eligibleScenarios > N1_ENGINE_HARD_CAP
        ? `Exact link-failure enumeration is bounded by the ${N1_ENGINE_HARD_CAP}-scenario engine cap.`
        : 'Exact link-failure enumeration is available within the current engine cap.',
  };
}

export interface AnalysisExecutionProfile {
  mode: CapacityExecutionMode;
  estimatedWorkUnits: number;
  shortestPathRuns: number;
  directedArcs: number;
}

export function analysisExecutionProfile(project: NetworkProject): AnalysisExecutionProfile {
  const estimate = estimateRoutingWorkload(project);
  return {
    mode: estimate.estimatedWorkUnits >= ANALYSIS_WORKER_THRESHOLD_UNITS ? 'worker' : 'main-thread',
    estimatedWorkUnits: estimate.estimatedWorkUnits,
    shortestPathRuns: estimate.shortestPathRuns,
    directedArcs: estimate.directedArcs,
  };
}

export interface AnalysisAuthorityToken {
  projectHash: string;
  planHash: string;
  epoch: number;
}

export function createAnalysisAuthorityToken(project: NetworkProject, plan: ChangePlan, epoch: number): AnalysisAuthorityToken {
  return { projectHash: modelHash(project), planHash: changePlanHash(plan), epoch };
}

export function isAnalysisAuthorityTokenCurrent(token: AnalysisAuthorityToken, project: NetworkProject, plan: ChangePlan, epoch: number): boolean {
  return token.epoch === epoch && token.projectHash === modelHash(project) && token.planHash === changePlanHash(plan);
}
