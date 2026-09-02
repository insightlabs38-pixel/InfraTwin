'use client';

import { useEffect } from 'react';
import { APP_DESTINATIONS } from '../lib/application-shell';
import { listBundledScenarios } from '@infratwin/scenarios';
import { ScenarioSelector } from './scenario-selector';
import { ImportNetworkDialog } from './import-network-dialog';
import { ConfirmationDialog } from './confirmation-dialog';
import { WorkbenchM35dNetworkView } from './workbench-m35d-network-view';
import { WorkbenchM35dAnalysisView } from './workbench-m35d-analysis-view';
import { WorkbenchM35dPlansView } from './workbench-m35d-plans-view';
import { WorkbenchM35dSettingsView } from './workbench-m35d-settings-view';

const networkTemplates=listBundledScenarios();
const NAV_ICONS:Record<string,string>={network:'◈',analysis:'≋',plans:'▤',settings:'⚙'};

export function WorkbenchM35dMainView({scope}:{scope:any}){
  const { selectedScenarioId, project, activeView, setActiveView, loadNetworkTemplate, setImportDialogOpen, exportProject, exportWorkspace, advancedOpen, setAdvancedOpen, importDialogOpen, openImportedProject, openImportedWorkspace, openImportedPlan, importMessage, setImportMessage, pendingConfirmation, confirmPendingAction, cancelPendingAction, recoveryDraft, resumeLocalDraft, discardLocalDraft } = scope;
  useEffect(() => {
    if (!importMessage) return;
    const timer=window.setTimeout(()=>setImportMessage(''),5000);
    return ()=>window.clearTimeout(timer);
  },[importMessage,setImportMessage]);
  return <>
    <header className="appbar">
      <div className="brand-block"><strong>InfraTwin</strong><span>Plan and verify network changes before production.</span></div>
      <nav className="destination-nav" aria-label="Primary application views">
        {APP_DESTINATIONS.map((view) => { const label=view === 'settings' ? 'Settings / Model' : view[0].toUpperCase() + view.slice(1); return <button key={view} data-testid={`nav-${view}`} className={activeView === view ? 'active' : ''} aria-label={label} title={label} onClick={() => setActiveView(view)}><span className="nav-icon" aria-hidden="true">{NAV_ICONS[view]}</span><span className="nav-label">{label}</span></button>; })}
      </nav>
      <ScenarioSelector scenarios={networkTemplates} selectedId={selectedScenarioId} selectedLabel={project.name} onSelect={(id) => loadNetworkTemplate(id)} />
      <div className="appbar-actions"><button data-testid="save-workspace" className="save-workspace" onClick={exportWorkspace}>Save workspace</button><button data-testid="import-json" onClick={() => setImportDialogOpen(true)}>Import</button><button data-testid="export-json" title="Exports only the base network model" onClick={exportProject}>Export network</button><button data-testid="advanced-toggle" aria-expanded={advancedOpen} aria-controls="advanced-drawer" onClick={() => setAdvancedOpen((value:boolean) => !value)}>Advanced</button></div>
    </header>
    {recoveryDraft && <section className="recovery-banner" role="status" data-testid="draft-recovery-banner"><div><strong>Browser-local draft available</strong><span>{recoveryDraft.plan.name} · saved {new Date(recoveryDraft.savedAt).toLocaleString()}</span></div><div><button className="primary" data-testid="resume-local-draft" onClick={resumeLocalDraft}>Resume draft</button><button data-testid="discard-local-draft" onClick={discardLocalDraft}>Discard</button></div></section>}
    <ImportNetworkDialog open={importDialogOpen} onClose={() => setImportDialogOpen(false)} onOpenProject={openImportedProject} onOpenWorkspace={openImportedWorkspace} onOpenPlan={openImportedPlan} />
    <ConfirmationDialog request={pendingConfirmation} onCancel={cancelPendingAction} onConfirm={confirmPendingAction} />
    {importMessage && <div className="floating-notice" role="status"><span>{importMessage}</span><button type="button" aria-label="Dismiss notice" onClick={() => setImportMessage('')}>×</button></div>}
    <div className="app-main"><WorkbenchM35dNetworkView scope={scope}/><WorkbenchM35dAnalysisView scope={scope}/><WorkbenchM35dPlansView scope={scope}/><WorkbenchM35dSettingsView scope={scope}/></div>
  </>;
}
