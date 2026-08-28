/// <reference lib="webworker" />

import type { ChangePlan, NetworkProject } from '@infratwin/model';
import { executeChangePlanAnalysisWorkerKernel } from '../lib/analysis-worker-core';

type Request = { taskId: string; project: NetworkProject; plan: ChangePlan };

self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  const startedAt = performance.now();
  try {
    const result = executeChangePlanAnalysisWorkerKernel(request.project, request.plan);
    self.postMessage({ taskId: request.taskId, ok: true, result, runtimeMs: Math.round((performance.now() - startedAt) * 1000) / 1000 });
  } catch (error) {
    self.postMessage({ taskId: request.taskId, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
