import type { ChangePlan, NetworkProject } from '@infratwin/model';
import { analyzeChangePlan, type ChangePlanAnalysis } from '@infratwin/evidence';

/** Pure worker kernel kept separately so worker/synchronous semantic equivalence is directly testable. */
export function executeChangePlanAnalysisWorkerKernel(project: NetworkProject, plan: ChangePlan): ChangePlanAnalysis {
  return analyzeChangePlan(project, plan);
}
