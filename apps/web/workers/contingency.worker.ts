/// <reference lib="webworker" />

import { runSingleLinkContingency, type AnalysisRunContext, type ContingencyWorkerRequest, type ContingencyWorkerResponse } from '@infratwin/evidence';
import type { NetworkProject, ScenarioPatch } from '@infratwin/model';

const scope = self as DedicatedWorkerGlobalScope;
let project: NetworkProject | null = null;
let basePatch: ScenarioPatch | null = null;
let context: AnalysisRunContext = {};

scope.onmessage = (event: MessageEvent<ContingencyWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'init') {
    project = request.project;
    basePatch = request.basePatch;
    context = { baseModelHash: request.baseModelHash };
    return;
  }
  try {
    if (!project) throw new Error('Contingency worker was not initialized.');
    const contingency = runSingleLinkContingency(project, request.linkId, basePatch, context);
    const response: ContingencyWorkerResponse = { taskId: request.taskId, ok: true, contingency };
    scope.postMessage(response);
  } catch (error) {
    const response: ContingencyWorkerResponse = {
      taskId: request.taskId,
      ok: false,
      error: error instanceof Error ? error.message : 'Contingency worker failed.',
    };
    scope.postMessage(response);
  }
};

export {};
