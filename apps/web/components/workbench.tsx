'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { NetworkProject } from '@infratwin/model';
import { modelHash } from '@infratwin/model';
import { runCapacityAnalysis } from '@infratwin/evidence';
import { loadMaintenanceTrap } from '@infratwin/scenarios';
import { registerInspectNetworkTool, type ModelContextLike } from '@infratwin/webmcp';

function pct(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

export function Workbench() {
  const [project, setProject] = useState<NetworkProject>(() => loadMaintenanceTrap());
  const [webmcpStatus, setWebmcpStatus] = useState<'checking' | 'registered' | 'unsupported' | 'error'>('checking');
  const projectRef = useRef(project);
  projectRef.current = project;
  const analysis = useMemo(() => runCapacityAnalysis(project), [project]);
  const nodeById = useMemo(() => new Map(project.nodes.map((node) => [node.id, node])), [project.nodes]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context?.registerTool) {
      setWebmcpStatus('unsupported');
      return;
    }
    let cleanup: (() => void) | undefined;
    let active = true;
    registerInspectNetworkTool(context, () => projectRef.current)
      .then((dispose) => {
        if (!active) dispose();
        else {
          cleanup = dispose;
          setWebmcpStatus('registered');
        }
      })
      .catch(() => setWebmcpStatus('error'));
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);

  const toggleLink = (linkId: string) => {
    setProject((current) => ({
      ...current,
      links: current.links.map((link) => link.id === linkId ? { ...link, available: link.available === false } : link),
    }));
  };

  const updateDemand = (demandId: string, bandwidthGbps: number) => {
    setProject((current) => ({
      ...current,
      demands: current.demands.map((demand) => demand.id === demandId ? { ...demand, bandwidthGbps: Math.max(0, bandwidthGbps) } : demand),
    }));
  };

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">InfraTwin · Level 0</p>
          <h1>{project.name}</h1>
          <p className="subtitle">Executable network model shared by human edits, deterministic analysis, and WebMCP.</p>
        </div>
        <div className="header-actions">
          <span className={`status-chip ${analysis.result.verdict === 'PASS' ? 'pass' : 'fail'}`}>{analysis.result.verdict}</span>
          <button onClick={() => setProject(loadMaintenanceTrap())}>Reset scenario</button>
        </div>
      </header>

      <section className="summary-grid" aria-label="Network summary">
        <article><span>Model hash</span><strong className="mono">{modelHash(project)}</strong></article>
        <article><span>Peak utilization</span><strong>{pct(Number(analysis.result.metrics.peakUtilizationPct))}</strong></article>
        <article><span>Routing</span><strong>Single shortest path</strong></article>
        <article><span>WebMCP</span><strong>{webmcpStatus}</strong></article>
      </section>

      <section className="workspace-grid">
        <article className="panel graph-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Canonical topology</p><h2>Click any link to toggle availability</h2></div>
            <span className="hint">Try CHI–DAL / L1</span>
          </div>
          <svg className="topology" viewBox="0 0 660 450" role="img" aria-label="Network topology">
            {project.links.map((link) => {
              const source = nodeById.get(link.source);
              const target = nodeById.get(link.target);
              if (!source || !target) return null;
              const utilization = analysis.routing.linkUtilizationPct[link.id] ?? 0;
              const disabled = link.available === false;
              const overloaded = utilization > 100;
              return (
                <g key={link.id} className="link-group" onClick={() => toggleLink(link.id)} tabIndex={0} role="button"
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') toggleLink(link.id); }}>
                  <line x1={source.x} y1={source.y} x2={target.x} y2={target.y}
                    className={`link-line ${disabled ? 'disabled' : overloaded ? 'overloaded' : ''}`} />
                  <text x={((source.x ?? 0) + (target.x ?? 0)) / 2} y={((source.y ?? 0) + (target.y ?? 0)) / 2 - 10}
                    className="link-label">{link.id} · {disabled ? 'OFF' : pct(utilization)}</text>
                </g>
              );
            })}
            {project.nodes.map((node) => (
              <g key={node.id} transform={`translate(${node.x ?? 0} ${node.y ?? 0})`}>
                <circle r="31" className="node-circle" />
                <text y="4" textAnchor="middle" className="node-id">{node.id}</text>
                <text y="49" textAnchor="middle" className="node-name">{node.name}</text>
              </g>
            ))}
          </svg>
          <p className="assumption">Level 0 model: deterministic weighted shortest-path routing. This is planning simulation, not router-protocol emulation.</p>
        </article>

        <aside className="panel evidence-panel">
          <div className="panel-heading"><div><p className="eyebrow">Evidence</p><h2>{analysis.result.verdict === 'PASS' ? 'No modeled violations' : `${analysis.result.violations.length} violation(s)`}</h2></div></div>
          <dl className="metrics">
            <div><dt>Peak</dt><dd>{pct(analysis.routing.peakUtilizationPct)}</dd></div>
            <div><dt>Unrouted demands</dt><dd>{analysis.routing.unroutedDemandIds.length}</dd></div>
            <div><dt>Solver</dt><dd>{analysis.result.solver.id}</dd></div>
          </dl>
          <div className="violation-list">
            {analysis.result.violations.length === 0 ? <p className="empty">Baseline is healthy under the stated assumptions.</p> : analysis.result.violations.map((violation) => (
              <div className="violation" key={violation.id}>
                <strong>{violation.type.replaceAll('_', ' ')}</strong>
                <p>{violation.message}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="workspace-grid lower-grid">
        <article className="panel">
          <div className="panel-heading"><div><p className="eyebrow">Demands</p><h2>Manual traffic edit</h2></div></div>
          <div className="demand-list">
            {project.demands.map((demand) => {
              const route = analysis.routing.routes.find((item) => item.demandId === demand.id);
              return (
                <label className="demand-row" key={demand.id}>
                  <span><strong>{demand.id} · {demand.name}</strong><small>{route?.reachable ? route.nodeIds.join(' → ') : 'unreachable'}</small></span>
                  <span className="number-control"><input type="number" min="0" step="1" value={demand.bandwidthGbps}
                    onChange={(event) => updateDemand(demand.id, Number(event.target.value))} /><em>Gbps</em></span>
                </label>
              );
            })}
          </div>
        </article>
        <article className="panel">
          <div className="panel-heading"><div><p className="eyebrow">Tool contract</p><h2>inspect_network</h2></div></div>
          <p className="tool-copy">Read-only WebMCP capability. It inspects the same <span className="mono">projectRef</span> the canvas edits, so agent inspection cannot silently drift from the visible network.</p>
          <pre>{JSON.stringify({
            modelHash: analysis.result.modelHash,
            disabledLinkIds: project.links.filter((link) => link.available === false).map((link) => link.id),
            verdict: analysis.result.verdict,
            peakUtilizationPct: analysis.result.metrics.peakUtilizationPct,
          }, null, 2)}</pre>
        </article>
      </section>
    </main>
  );
}
