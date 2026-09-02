'use client';

import { useWorkbenchStage1 } from './workbench-m35d-stage1';
import { useWorkbenchStage2 } from './workbench-m35d-stage2';
import { useWorkbenchStage3 } from './workbench-m35d-stage3';
import { useWorkbenchStage4 } from './workbench-m35d-stage4';
import { useWorkbenchStage5 } from './workbench-m35d-stage5';
import { useWorkbenchStage6 } from './workbench-m35d-stage6';
import { WorkbenchM35dView } from './workbench-m35d-view';
import { AppErrorBoundary } from './app-error-boundary';

export function Workbench() {
  const scope: any = {};
  useWorkbenchStage1(scope);
  useWorkbenchStage2(scope);
  useWorkbenchStage3(scope);
  useWorkbenchStage4(scope);
  useWorkbenchStage5(scope);
  useWorkbenchStage6(scope);
  return <AppErrorBoundary><WorkbenchM35dView scope={scope} /></AppErrorBoundary>;
}
