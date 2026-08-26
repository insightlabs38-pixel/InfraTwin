/// <reference lib="webworker" />

import type { CandidatePlan, NetworkProject } from '@infratwin/model';
import {
  optimizeCapacityPlan,
  optimizeRouting,
  probeOptimizer,
  verifyCapacityCandidate,
  type CapacityPlanRequirements,
} from '@infratwin/optimizer';

type Request =
  | { taskId: string; kind: 'probe' }
  | { taskId: string; kind: 'capacity'; project: NetworkProject; requirements: CapacityPlanRequirements; timeLimitMs?: number }
  | { taskId: string; kind: 'routing'; project: NetworkProject; timeLimitMs?: number }
  | { taskId: string; kind: 'verify'; project: NetworkProject; candidate: CandidatePlan; requirements: CapacityPlanRequirements };

type Response = { taskId: string; ok: true; result: unknown } | { taskId: string; ok: false; error: string };

const locateFile = (file: string) => file.endsWith('.wasm') ? new URL('/solver-assets/highs.wasm', self.location.origin).href : file;

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    let result: unknown;
    if (request.kind === 'probe') result = await probeOptimizer({ locateFile });
    else if (request.kind === 'capacity') result = await optimizeCapacityPlan(request.project, request.requirements, { timeLimitMs: request.timeLimitMs, locateFile });
    else if (request.kind === 'routing') result = await optimizeRouting(request.project, { timeLimitMs: request.timeLimitMs, locateFile });
    else result = verifyCapacityCandidate(request.project, request.candidate, request.requirements);
    self.postMessage({ taskId: request.taskId, ok: true, result } satisfies Response);
  } catch (error) {
    self.postMessage({ taskId: request.taskId, ok: false, error: error instanceof Error ? error.message : 'Optimizer worker failed.' } satisfies Response);
  }
};
