'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChangePlan, NetworkProject } from '@infratwin/model';
import { parseCsvBundle, reviewNetworkProject, type ImportReview } from '../lib/csv-import';
import { parsePlanBundle, parseWorkspaceBundle, type PlanBundle, type WorkspaceBundle } from '../lib/workspace-persistence';

interface ImportNetworkDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenProject: (project: NetworkProject, message: string) => void;
  onOpenWorkspace: (workspace: WorkspaceBundle, message: string) => void;
  onOpenPlan: (bundle: PlanBundle, message: string) => void;
}

type ImportMode = 'json' | 'csv';

async function readFile(file: File | undefined, label: string): Promise<string> {
  if (!file) throw new Error(`${label} is required.`);
  if (file.size > 2_000_000) throw new Error(`${label} exceeds the 2 MB browser safety limit.`);
  return file.text();
}

export function ImportNetworkDialog({ open, onClose, onOpenProject, onOpenWorkspace, onOpenPlan }: ImportNetworkDialogProps) {
  const [mode, setMode] = useState<ImportMode>('csv');
  const [review, setReview] = useState<ImportReview | null>(null);
  const [workspaceReview, setWorkspaceReview] = useState<WorkspaceBundle | null>(null);
  const [planReview, setPlanReview] = useState<PlanBundle | null>(null);
  const [error, setError] = useState('');
  const [projectName, setProjectName] = useState('Imported CSV Network');
  const [nodesFile, setNodesFile] = useState<File>();
  const [linksFile, setLinksFile] = useState<File>();
  const [demandsFile, setDemandsFile] = useState<File>();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;

  const resetReview = () => { setReview(null); setWorkspaceReview(null); setPlanReview(null); setError(''); };
  const reviewJson = async (file?: File) => {
    try {
      resetReview();
      const text = await readFile(file, 'InfraTwin JSON');
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object') {
        const format=(parsed as { format?: string }).format;
        if (format === 'infratwin-workspace') { setWorkspaceReview(parseWorkspaceBundle(parsed)); return; }
        if (format === 'infratwin-change-plan') { setPlanReview(parsePlanBundle(parsed)); return; }
      }
      setReview(reviewNetworkProject(parsed as NetworkProject));
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Invalid InfraTwin JSON.'); }
  };
  const reviewCsv = async () => {
    try {
      resetReview();
      const [nodesCsv, linksCsv, demandsCsv] = await Promise.all([
        readFile(nodesFile, 'nodes.csv'),
        readFile(linksFile, 'links.csv'),
        demandsFile ? readFile(demandsFile, 'demands.csv') : Promise.resolve(''),
      ]);
      setReview(parseCsvBundle({ nodesCsv, linksCsv, demandsCsv, projectName }));
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'CSV import failed.'); }
  };
  const openProject = () => {
    if (!review) return;
    const warningSummary = review.warnings.length ? ` ${review.warnings.join(' ')}` : '';
    onOpenProject(review.project, `Imported ${review.project.name}.${warningSummary}`);
    onClose();
  };
  const openPlan = () => { if (!planReview) return; onOpenPlan(planReview, `Loaded ${planReview.plan.name} ChangePlan.`); onClose(); };
  const openWorkspace = () => {
    if (!workspaceReview) return;
    onOpenWorkspace(workspaceReview, `Restored ${workspaceReview.plan.name} with its matching ${workspaceReview.project.name} base network.`);
    onClose();
  };

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="import-dialog panel" role="dialog" aria-modal="true" aria-labelledby="import-network-title" data-testid="import-network-dialog">
      <div className="panel-heading"><div><p className="eyebrow">Import / restore</p><h2 id="import-network-title">Review data before opening it</h2></div><button ref={closeRef} type="button" onClick={onClose} aria-label="Close import dialog">Close</button></div>
      <p className="dialog-intro">Upload nodes and links as CSV, or open a network, ChangePlan, or workspace JSON file. InfraTwin validates the data before replacing the current workspace.</p>
      <div className="segmented-control" aria-label="Import format">
        <button type="button" className={mode === 'csv' ? 'active' : ''} onClick={() => { setMode('csv'); resetReview(); }}>CSV bundle</button>
        <button type="button" aria-label="Canonical JSON" className={mode === 'json' ? 'active' : ''} onClick={() => { setMode('json'); resetReview(); }}>InfraTwin JSON</button>
      </div>

      {mode === 'csv' ? <div key="csv" className="import-fields">
        <label>Project name<input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label>
        <label>nodes.csv<input data-testid="csv-nodes-file" type="file" accept=".csv,text/csv" onChange={(event) => { setNodesFile(event.target.files?.[0]); resetReview(); }} /></label>
        <label>links.csv<input data-testid="csv-links-file" type="file" accept=".csv,text/csv" onChange={(event) => { setLinksFile(event.target.files?.[0]); resetReview(); }} /></label>
        <label>demands.csv <small>optional</small><input data-testid="csv-demands-file" type="file" accept=".csv,text/csv" onChange={(event) => { setDemandsFile(event.target.files?.[0]); resetReview(); }} /></label>
        <details className="schema-details"><summary>CSV column requirements</summary><p>Nodes: ID/name/region/type. Links: ID/source/target/capacityGbps/weight/bidirectional. Demands: ID/name/source/target/bandwidthGbps/serviceClassId. Blank/default demand classes map to one disclosed imported default class when no service-class catalog is supplied.</p></details>
        <button type="button" className="primary" data-testid="review-csv-import" onClick={() => void reviewCsv()}>Review CSV import</button>
      </div> : <div key="json" className="import-fields">
        <label>Network or workspace JSON<input data-testid="json-import-file" type="file" accept="application/json,.json" onChange={(event) => void reviewJson(event.target.files?.[0])} /></label>
        <p className="muted compact-copy">Workspace exports restore the matching base network and ChangePlan together. ChangePlan exports load only when their base network matches the current network. Canonical network JSON starts a fresh ChangePlan.</p>
      </div>}

      {error && <div className="notice warning" role="alert" data-testid="import-error">{error}</div>}
      {review && <section className="import-review" data-testid="import-review">
        <p className="eyebrow">Imported network</p>
        <div className="import-counts"><strong>{review.counts.nodes}<span>nodes</span></strong><strong>{review.counts.links}<span>links</span></strong><strong>{review.counts.demands}<span>demands</span></strong><strong>{review.counts.regions}<span>regions</span></strong></div>
        {review.defaults.length > 0 && <div><strong>Defaults applied</strong><ul>{review.defaults.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        {review.warnings.length > 0 && <div><strong>Warnings</strong><ul>{review.warnings.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        <button type="button" className="primary wide" data-testid="open-imported-network" onClick={openProject}>Open network</button>
      </section>}
      {planReview && <section className="import-review" data-testid="plan-import-review"><p className="eyebrow">ChangePlan export</p><h3>{planReview.plan.name}</h3><div className="import-counts"><strong>{planReview.plan.changes.length}<span>changes</span></strong><strong>{planReview.plan.restrictions.lockedLinkIds.length + planReview.plan.restrictions.lockedNodeIds.length}<span>locks</span></strong><strong>{planReview.plan.proposals.length}<span>proposals</span></strong><strong>{planReview.plan.history.length}<span>activity entries</span></strong></div><p>Base network identity <span className="mono-inline">{planReview.baseModelHash}</span></p><button type="button" className="primary wide" data-testid="open-imported-plan" onClick={openPlan}>Load ChangePlan</button></section>}
      {workspaceReview && <section className="import-review" data-testid="workspace-import-review"><p className="eyebrow">Workspace export</p><h3>{workspaceReview.plan.name}</h3><div className="import-counts"><strong>{workspaceReview.project.nodes.length}<span>nodes</span></strong><strong>{workspaceReview.project.links.length}<span>links</span></strong><strong>{workspaceReview.plan.changes.length}<span>changes</span></strong><strong>{workspaceReview.plan.restrictions.lockedLinkIds.length + workspaceReview.plan.restrictions.lockedNodeIds.length}<span>locks</span></strong></div><p>Saved {new Date(workspaceReview.savedAt).toLocaleString()} · base network {workspaceReview.project.name}</p><button type="button" className="primary wide" data-testid="open-imported-workspace" onClick={openWorkspace}>Restore workspace</button></section>}
    </section>
  </div>;
}
