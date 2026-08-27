import type { ChangePlan, NetworkProject } from '@infratwin/model';
import { changePlanHash, modelHash } from '@infratwin/model';
import { estimateRoutingWorkload } from '@infratwin/graph-engine';

/**
 * Phase 3.5C adaptive execution threshold. This is a complexity envelope, not a runtime prediction.
 * It is deliberately conservative: workloads above it are moved off the main thread even when a
 * fast machine might finish quickly. The value is validated by the reproducible scale benchmark.
 */
export const ANALYSIS_WORKER_THRESHOLD_UNITS = 4_000_000;

export type CapacityExecutionMode = 'main-thread' | 'worker';

export interface AnalysisExecutionProfile {
  mode: CapacityExecutionMode;
  estimatedWorkUnits: number;
  shortestPathRuns: number;
  directedArcs: number;
}

export function analysisExecutionProfile(project: NetworkProject): AnalysisExecutionProfile {
  const estimate = estimateRoutingWorkload(project);
  return {
    mode: estimate.estimatedWorkUnits > ANALYSIS_WORKER_THRESHOLD_UNITS ? 'worker' : 'main-thread',
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
