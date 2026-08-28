import type { ChangePlan, NetworkProject } from '@infratwin/model';
import type { ChangePlanAnalysis } from '@infratwin/evidence';

interface WorkerResponse {
  taskId: string;
  ok: boolean;
  result?: ChangePlanAnalysis;
  runtimeMs?: number;
  error?: string;
}

export interface BrowserAnalysisResult {
  analysis: ChangePlanAnalysis;
  runtimeMs: number;
}

function abortError(message = 'Capacity analysis cancelled'): Error {
  if (typeof DOMException !== 'undefined') return new DOMException(message, 'AbortError');
  const error = new Error(message); error.name = 'AbortError'; return error;
}

export function analyzeChangePlanInBrowserWorker(project: NetworkProject, plan: ChangePlan, signal?: AbortSignal): Promise<BrowserAnalysisResult> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' });
    const taskId = `analysis-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled = false;
    const cleanup = () => { signal?.removeEventListener('abort', onAbort); worker.terminate(); };
    const finish = (fn: () => void) => { if (settled) return; settled = true; cleanup(); fn(); };
    const onAbort = () => finish(() => reject(abortError()));
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onerror = (event) => finish(() => reject(new Error(event.message || 'Capacity analysis worker crashed.')));
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (!event.data || event.data.taskId !== taskId) return;
      if (!event.data.ok || !event.data.result) finish(() => reject(new Error(event.data.error || 'Capacity analysis worker failed.')));
      else finish(() => resolve({ analysis: event.data.result!, runtimeMs: Number(event.data.runtimeMs ?? event.data.result!.capacity.result.runtimeMs) }));
    };
    worker.postMessage({ taskId, project, plan });
  });
}
