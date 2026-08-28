'use client';

import { WorkbenchM35dMainView } from './workbench-m35d-main-view';
import { WorkbenchM35dAdvancedView } from './workbench-m35d-advanced-view';

export function WorkbenchM35dView({scope}:{scope:any}){
  return <main className="shell" data-testid="application-shell"><WorkbenchM35dMainView scope={scope}/><WorkbenchM35dAdvancedView scope={scope}/></main>;
}
