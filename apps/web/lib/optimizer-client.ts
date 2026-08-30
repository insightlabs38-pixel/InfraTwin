import type { CandidatePlan, NetworkProject } from '@infratwin/model';
import type { AdaptiveDesignRequirements, AdaptiveDesignResult, AdaptiveDesignVariant, CapacityOptimizationResult, CapacityPlanRequirements, CandidateVerification, TrafficAllocationResult } from '@infratwin/optimizer';

interface WorkerResponse { taskId: string; ok: boolean; result?: unknown; error?: string }
type WorkerWaiter = { resolve:(worker:Worker)=>void; reject:(error:Error)=>void; signal?:AbortSignal; onAbort?:()=>void };

const idleWorkers:Worker[]=[];
const workerWaiters:WorkerWaiter[]=[];
let liveWorkerCount=0;
function maxWorkerCount():number { return typeof navigator === 'undefined' ? 1 : Math.min(4,Math.max(1,(navigator.hardwareConcurrency || 4)-1)); }
function createWorker():Worker { liveWorkerCount+=1; return new Worker(new URL('../workers/optimizer.worker.ts', import.meta.url), { type: 'module' }); }
function abortError(): Error { if (typeof DOMException !== 'undefined') return new DOMException('Optimizer execution cancelled', 'AbortError'); const error = new Error('Optimizer execution cancelled'); error.name = 'AbortError'; return error; }
function acquireWorker(signal?:AbortSignal):Promise<Worker>{
  if(signal?.aborted)return Promise.reject(abortError());
  const idle=idleWorkers.pop();if(idle)return Promise.resolve(idle);
  if(liveWorkerCount<maxWorkerCount())return Promise.resolve(createWorker());
  return new Promise((resolve,reject)=>{const waiter:WorkerWaiter={resolve,reject,signal};const onAbort=()=>{const index=workerWaiters.indexOf(waiter);if(index>=0)workerWaiters.splice(index,1);reject(abortError());};waiter.onAbort=onAbort;signal?.addEventListener('abort',onAbort,{once:true});workerWaiters.push(waiter);});
}
function clearWaiter(waiter:WorkerWaiter):void{if(waiter.onAbort)waiter.signal?.removeEventListener('abort',waiter.onAbort);}
function releaseWorker(worker:Worker):void{
  worker.onmessage=null;worker.onerror=null;
  while(workerWaiters.length){const waiter=workerWaiters.shift()!;clearWaiter(waiter);if(waiter.signal?.aborted){waiter.reject(abortError());continue;}waiter.resolve(worker);return;}
  idleWorkers.push(worker);
}
function destroyWorker(worker:Worker):void{
  worker.onmessage=null;worker.onerror=null;worker.terminate();liveWorkerCount=Math.max(0,liveWorkerCount-1);
  while(workerWaiters.length&&liveWorkerCount<maxWorkerCount()){const waiter=workerWaiters.shift()!;clearWaiter(waiter);if(waiter.signal?.aborted){waiter.reject(abortError());continue;}waiter.resolve(createWorker());break;}
}
export function browserOptimizerWorkerPoolStats():{live:number;idle:number;queued:number;max:number}{return{live:liveWorkerCount,idle:idleWorkers.length,queued:workerWaiters.length,max:maxWorkerCount()};}

async function runWorker<T>(payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw abortError();
  const worker=await acquireWorker(signal);
  if(signal?.aborted){releaseWorker(worker);throw abortError();}
  return new Promise<T>((resolve, reject) => {
    const taskId = `optimizer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let settled=false;
    const cleanup=(reuse:boolean)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',onAbort);if(reuse)releaseWorker(worker);else destroyWorker(worker);};
    const onAbort=()=>{cleanup(false);reject(abortError());};
    signal?.addEventListener('abort',onAbort,{once:true});
    worker.onerror=(event)=>{cleanup(false);reject(new Error(event.message || 'Optimizer worker crashed.'));};
    worker.onmessage=(event:MessageEvent<WorkerResponse>)=>{if(event.data.taskId!==taskId)return;cleanup(true);if(!event.data.ok)reject(new Error(event.data.error || 'Optimizer worker failed.'));else resolve(event.data.result as T);};
    worker.postMessage({ ...payload, taskId });
  });
}
export function probeBrowserOptimizer(signal?: AbortSignal): Promise<{ solver: string; solverVersion: string; status: string }> { return runWorker({ kind: 'probe' }, signal); }
export function optimizeCapacityInBrowser(project: NetworkProject, requirements: CapacityPlanRequirements, timeLimitMs = 8_000, signal?: AbortSignal): Promise<CapacityOptimizationResult> { return runWorker({ kind: 'capacity', project, requirements, timeLimitMs }, signal); }
export function optimizeRoutingInBrowser(project: NetworkProject, timeLimitMs = 5_000, signal?: AbortSignal): Promise<TrafficAllocationResult> { return runWorker({ kind: 'routing', project, timeLimitMs }, signal); }
export function verifyCandidateInBrowser(project: NetworkProject, candidate: CandidatePlan, requirements: CapacityPlanRequirements, signal?: AbortSignal): Promise<CandidateVerification> { return runWorker({ kind: 'verify', project, candidate, requirements }, signal); }
export function optimizeAdaptiveDesignInBrowser(project: NetworkProject, requirements: AdaptiveDesignRequirements, timeLimitMs = 10_000, signal?: AbortSignal, sourcePlanHash?: string): Promise<AdaptiveDesignResult> { return runWorker({ kind: 'adaptive-design', project, requirements, timeLimitMs, sourcePlanHash }, signal); }
export function optimizeDesignParetoInBrowser(project: NetworkProject, requirements: AdaptiveDesignRequirements, timeLimitMs = 10_000, signal?: AbortSignal, sourcePlanHash?: string): Promise<AdaptiveDesignVariant[]> { return runWorker({ kind: 'adaptive-pareto', project, requirements, timeLimitMs, sourcePlanHash }, signal); }
