'use client';

import { UpgradeProfileEditor } from './upgrade-profile-editor';
import { SearchableSelect } from './searchable-select';

function routingModeLabel(mode:string){return mode==='ssp'?'Single shortest path (SSP)':mode==='ecmp'?'Equal-cost multipath (ECMP)':mode.toUpperCase();}

export function WorkbenchM35dSettingsView({scope}:{scope:any}){
  const { activeView, project, settingsLinkId, setSettingsLinkId, settingsLink, editUpgradeCatalog, setImportDialogOpen, executionProfile, n1Guidance, n1Policy, capacityMilpEstimate, exportProject } = scope;
  if(activeView !== 'settings') return null;
  const linkOptions=project.links.map((link:any)=>({value:link.id,label:`${link.id} · ${link.source} ↔ ${link.target}`,keywords:`${link.name??''} ${link.source} ${link.target}`}));
  return <section className="destination-view settings-view" data-testid="settings-view">
    <header className="destination-heading"><div><span className="section-kicker">Settings / Model</span><h1>Network model and assumptions</h1><p>These settings define the base network design space. They are separate from the live ChangePlan.</p></div><div className="heading-actions"><button onClick={exportProject}>Export network</button><button onClick={() => setImportDialogOpen(true)}>Import data</button></div></header>
    <div className="destination-scroll"><div className="settings-grid">
      <section className="plain-section"><h2>Routing profile</h2><dl className="compact-metrics"><div><dt>Mode</dt><dd>{routingModeLabel(project.routingProfile.mode)}</dd></div><div><dt>Routing policy</dt><dd>Link weight</dd></div><div><dt>Service classes</dt><dd>{project.serviceClasses.length}</dd></div></dl><div className="service-class-list">{project.serviceClasses.map((item:any) => <div key={item.id}><strong>{item.name}</strong><span>{item.id}</span></div>)}</div></section>
      <section className="plain-section settings-upgrades"><h2>Upgrade catalog</h2><p>Declare the capacity choices and abstract cost units the optimizer may use.</p><SearchableSelect label="Link" value={settingsLinkId} options={linkOptions} onChange={setSettingsLinkId} testId="settings-upgrade-link" placeholder="Search links"/>{settingsLink && <UpgradeProfileEditor links={[settingsLink]} onApply={editUpgradeCatalog} />}</section>
      <section className="plain-section"><h2>Import behavior</h2><p>Imported data replaces the base network and starts a new ChangePlan. Existing plan changes are never silently transferred to a different network.</p><button onClick={() => setImportDialogOpen(true)}>Import network or workspace</button></section>
      <section className="plain-section"><h2>Compute guidance</h2><dl className="compact-metrics"><div><dt>Plan analysis</dt><dd>{executionProfile.mode === 'worker' ? 'Worker preferred' : 'Main-thread fast path'}</dd></div><div><dt>N-1</dt><dd>{n1Guidance} · max {n1Policy.maxScenarios}</dd></div><div><dt>Capacity optimizer</dt><dd>{capacityMilpEstimate.recommended ? 'Within interactive envelope' : 'Guarded at this size'}</dd></div></dl></section>
    </div></div>
  </section>;
}
