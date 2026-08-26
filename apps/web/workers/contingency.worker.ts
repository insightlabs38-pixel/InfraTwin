/// <reference lib="webworker" />

import { runSingleLinkContingency, type ContingencyWorkerRequest, type ContingencyWorkerResponse } from '@infratwin/evidence';

const scope = self as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<ContingencyWorkerRequest>) => {
  const request = event.data;
  try {
    const contingency = runSingleLinkContingency(request.project, request.linkId, request.basePatch);
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
