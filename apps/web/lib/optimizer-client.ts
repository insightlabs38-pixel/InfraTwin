import type { CandidatePlan, NetworkProject } from '@infratwin/model';
import type { CapacityOptimizationResult, CapacityPlanRequirements, CandidateVerification, TrafficAllocationResult } from '@infratwin/optimizer';

interface WorkerResponse { taskId: string; ok: boolean; result?: unknown; error?: string }

function abortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('Optimizer execution cancelled', 'AbortError');
  const error = new Error('Optimizer execution cancelled'); error.name = 'AbortError'; return error;
}

function runWorker<T>(payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/optimizer.worker.ts', import.meta.url), { type: 'module' });
    const taskId = `optimizer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cleanup = () => { signal?.removeEventListener('abort', onAbort); worker.terminate(); };
    const onAbort = () => { cleanup(); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || 'Optimizer worker crashed.')); };
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.taskId !== taskId) return;
      cleanup();
      if (!event.data.ok) reject(new Error(event.data.error || 'Optimizer worker failed.'));
      else resolve(event.data.result as T);
    };
    worker.postMessage({ ...payload, taskId });
  });
}

export function probeBrowserOptimizer(signal?: AbortSignal): Promise<{ solver: string; solverVersion: string; status: string }> {
  return runWorker({ kind: 'probe' }, signal);
}
export function optimizeCapacityInBrowser(project: NetworkProject, requirements: CapacityPlanRequirements, timeLimitMs = 8_000, signal?: AbortSignal): Promise<CapacityOptimizationResult> {
  return runWorker({ kind: 'capacity', project, requirements, timeLimitMs }, signal);
}
export function optimizeRoutingInBrowser(project: NetworkProject, timeLimitMs = 5_000, signal?: AbortSignal): Promise<TrafficAllocationResult> {
  return runWorker({ kind: 'routing', project, timeLimitMs }, signal);
}
export function verifyCandidateInBrowser(project: NetworkProject, candidate: CandidatePlan, requirements: CapacityPlanRequirements, signal?: AbortSignal): Promise<CandidateVerification> {
  return runWorker({ kind: 'verify', project, candidate, requirements }, signal);
}
