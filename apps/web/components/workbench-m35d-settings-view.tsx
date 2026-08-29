'use client';

import { UpgradeProfileEditor } from './upgrade-profile-editor';

export function WorkbenchM35dSettingsView({scope}:{scope:any}){
  const { activeView, project, settingsLinkId, setSettingsLinkId, settingsLink, editUpgradeCatalog, setImportDialogOpen, executionProfile, n1Guidance, n1Policy, capacityMilpEstimate } = scope;
  if(activeView !== 'settings') return null;
  return <section className="destination-view settings-view" data-testid="settings-view">
    <header className="destination-heading"><div><span className="section-kicker">Settings / Model</span><h1>Network model and assumptions</h1><p>These settings define the canonical network design space. They are separate from the current Change Plan.</p></div></header>
    <div className="destination-scroll"><div className="settings-grid">
      <section className="plain-section"><h2>Routing profile</h2><dl className="compact-metrics"><div><dt>Mode</dt><dd>{project.routingProfile.mode}</dd></div><div><dt>Routing policy</dt><dd>Link weight</dd></div><div><dt>Service classes</dt><dd>{project.serviceClasses.length}</dd></div></dl><div className="service-class-list">{project.serviceClasses.map((item:any) => <div key={item.id}><strong>{item.name}</strong><span>{item.id}</span></div>)}</div></section>
      <section className="plain-section settings-upgrades"><h2>Upgrade catalog</h2><label>Link<select data-testid="settings-upgrade-link" value={settingsLinkId} onChange={(event) => setSettingsLinkId(event.target.value)}>{project.links.map((link:any) => <option key={link.id} value={link.id}>{link.id} · {link.source} ↔ {link.target}</option>)}</select></label>{settingsLink && <UpgradeProfileEditor links={[settingsLink]} onApply={editUpgradeCatalog} />}</section>
      <section className="plain-section"><h2>Import / model assumptions</h2><p>Imported JSON or CSV is validated into the same canonical browser-local NetworkProject. Editing an upgrade catalog changes the base model and intentionally starts a fresh Change Plan rather than silently rebasing an existing one.</p><button onClick={() => setImportDialogOpen(true)}>Import network data</button></section>
      <section className="plain-section"><h2>Compute guidance</h2><dl className="compact-metrics"><div><dt>Plan analysis</dt><dd>{executionProfile.mode === 'worker' ? 'Worker preferred' : 'Main-thread fast path'}</dd></div><div><dt>N-1</dt><dd>{n1Guidance} · max {n1Policy.maxScenarios}</dd></div><div><dt>Capacity optimizer</dt><dd>{capacityMilpEstimate.recommended ? 'Available' : 'Guarded at this size'}</dd></div></dl></section>
    </div></div>
  </section>;
}
