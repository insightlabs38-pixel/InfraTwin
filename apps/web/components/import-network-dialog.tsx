'use client';

import { useState } from 'react';
import type { NetworkProject } from '@infratwin/model';
import { parseCsvBundle, reviewNetworkProject, type ImportReview } from '../lib/csv-import';

interface ImportNetworkDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenProject: (project: NetworkProject, message: string) => void;
}

type ImportMode = 'json' | 'csv';

async function readFile(file: File | undefined, label: string): Promise<string> {
  if (!file) throw new Error(`${label} is required.`);
  if (file.size > 2_000_000) throw new Error(`${label} exceeds the 2 MB browser safety limit.`);
  return file.text();
}

export function ImportNetworkDialog({ open, onClose, onOpenProject }: ImportNetworkDialogProps) {
  const [mode, setMode] = useState<ImportMode>('csv');
  const [review, setReview] = useState<ImportReview | null>(null);
  const [error, setError] = useState('');
  const [projectName, setProjectName] = useState('Imported CSV Network');
  const [nodesFile, setNodesFile] = useState<File>();
  const [linksFile, setLinksFile] = useState<File>();
  const [demandsFile, setDemandsFile] = useState<File>();

  if (!open) return null;

  const resetReview = () => { setReview(null); setError(''); };
  const reviewJson = async (file?: File) => {
    try {
      resetReview();
      const text = await readFile(file, 'Project JSON');
      const parsed = JSON.parse(text) as NetworkProject;
      setReview(reviewNetworkProject(parsed));
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'Invalid project JSON.'); }
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

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="import-dialog panel" role="dialog" aria-modal="true" aria-labelledby="import-network-title" data-testid="import-network-dialog">
        <div className="panel-heading"><div><p className="eyebrow">Import network</p><h2 id="import-network-title">Review external topology before opening it</h2></div><button type="button" onClick={onClose} aria-label="Close import dialog">Close</button></div>
        <div className="segmented-control" aria-label="Import format">
          <button type="button" className={mode === 'csv' ? 'active' : ''} onClick={() => { setMode('csv'); resetReview(); }}>CSV bundle</button>
          <button type="button" className={mode === 'json' ? 'active' : ''} onClick={() => { setMode('json'); resetReview(); }}>Canonical JSON</button>
        </div>

        {mode === 'csv' ? <div className="import-fields">
          <label>Project name<input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label>
          <label>nodes.csv<input data-testid="csv-nodes-file" type="file" accept=".csv,text/csv" onChange={(event) => { setNodesFile(event.target.files?.[0]); resetReview(); }} /></label>
          <label>links.csv<input data-testid="csv-links-file" type="file" accept=".csv,text/csv" onChange={(event) => { setLinksFile(event.target.files?.[0]); resetReview(); }} /></label>
          <label>demands.csv <small>optional</small><input data-testid="csv-demands-file" type="file" accept=".csv,text/csv" onChange={(event) => { setDemandsFile(event.target.files?.[0]); resetReview(); }} /></label>
          <p className="muted compact-copy">CSV supports node ID/name/region/type; link ID/source/target/capacityGbps/weight/bidirectional; and demand ID/name/source/target/bandwidthGbps/serviceClassId. Without a service-class catalog, blank/default demand classes map to one disclosed imported default class.</p>
          <button type="button" className="primary" data-testid="review-csv-import" onClick={() => void reviewCsv()}>Review CSV import</button>
        </div> : <div className="import-fields">
          <label>InfraTwin project JSON<input data-testid="json-import-file" type="file" accept="application/json,.json" onChange={(event) => void reviewJson(event.target.files?.[0])} /></label>
          <p className="muted compact-copy">Canonical JSON is validated before it can replace the current base network. Missing coordinates are treated as presentation state and auto-laid out.</p>
        </div>}

        {error && <div className="notice warning" role="alert" data-testid="import-error">{error}</div>}
        {review && <section className="import-review" data-testid="import-review">
          <p className="eyebrow">Imported Network</p>
          <div className="import-counts">
            <strong>{review.counts.nodes}<span>nodes</span></strong><strong>{review.counts.links}<span>links</span></strong><strong>{review.counts.demands}<span>demands</span></strong><strong>{review.counts.regions}<span>regions</span></strong>
          </div>
          {review.defaults.length > 0 && <div><strong>Defaults applied</strong><ul>{review.defaults.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {review.warnings.length > 0 && <div><strong>Warnings</strong><ul>{review.warnings.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          <button type="button" className="primary wide" data-testid="open-imported-network" onClick={openProject}>Open Network</button>
        </section>}
      </section>
    </div>
  );
}
