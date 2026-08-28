'use client';
import { APP_DESTINATIONS } from '../lib/application-shell';
import { listBundledScenarios } from '@infratwin/scenarios';
import { ScenarioSelector } from './scenario-selector';
import { ImportNetworkDialog } from './import-network-dialog';
import { WorkbenchM35dNetworkView } from './workbench-m35d-network-view';
import { WorkbenchM35dAnalysisView } from './workbench-m35d-analysis-view';
import { WorkbenchM35dPlansView } from './workbench-m35d-plans-view';
import { WorkbenchM35dSettingsView } from './workbench-m35d-settings-view';
const networkTemplates=listBundledScenarios();
export function WorkbenchM35dMainView({scope}:{scope:any}){
  const { selectedScenarioId, project, activeView, setActiveView, loadNetworkTemplate, setImportDialogOpen, exportProject, advancedOpen, setAdvancedOpen, importDialogOpen, openImportedProject, importMessage } = scope;
  return <><header className="appbar">
      <div className="brand-block"><strong>InfraTwin</strong><span>Plan and verify network changes before production.</span></div>
      <nav className="destination-nav" aria-label="Primary application views">
        {APP_DESTINATIONS.map((view) => <button key={view} data-testid={`nav-${view}`} className={activeView === view ? 'active' : ''} onClick={() => setActiveView(view)}>{view === 'settings' ? 'Settings / Model' : view[0].toUpperCase() + view.slice(1)}</button>)}
      </nav>
      <ScenarioSelector scenarios={networkTemplates} selectedId={selectedScenarioId} selectedLabel={project.name} onSelect={(id) => loadNetworkTemplate(id)} />
      <div className="appbar-actions"><button data-testid="import-json" onClick={() => setImportDialogOpen(true)}>Import</button><button data-testid="export-json" onClick={exportProject}>Export</button><button data-testid="advanced-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value:boolean) => !value)}>Advanced</button></div>
    </header>
<ImportNetworkDialog open={importDialogOpen} onClose={() => setImportDialogOpen(false)} onOpenProject={openImportedProject} />
{importMessage && <div className="floating-notice" role="status">{importMessage}</div>}
<div className="app-main"><WorkbenchM35dNetworkView scope={scope}/><WorkbenchM35dAnalysisView scope={scope}/><WorkbenchM35dPlansView scope={scope}/><WorkbenchM35dSettingsView scope={scope}/></div></>;
}
