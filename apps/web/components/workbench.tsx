'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CandidatePlan, NetworkProject, ScenarioPatch } from '@infratwin/model';
import { applyCandidatePlan, cloneProject, modelHash, validateNetworkProject } from '@infratwin/model';
import {
  compareCandidate,
  proposeCapacityMitigation,
  runGrowthAnalysis,
  runLinkContingencies,
  runScenarioCapacityAnalysis,
  type CandidateComparison,
  type ContingencyAnalysis,
  type EvidenceRef,
  type GrowthAnalysis,
  type CapacityAnalysis,
} from '@infratwin/evidence';
import {
  getScenarioDefinition,
  listBundledScenarios,
  loadScenario,
  type BundledScenarioId,
  type ScenarioDefinition,
} from '@infratwin/scenarios';
import {
  BASE_TOOL_NAMES,
  CANDIDATE_TOOL_NAMES,
  registerBaseTools,
  registerCandidateTools,
  type InfraTwinToolServices,
  type ModelContextLike,
  type ToolActivityEvent,
} from '@infratwin/webmcp';

function pct(value: number): string { return `${Math.round(value * 10) / 10}%`; }
function gbps(value: number): string { return `${Math.round(value * 100) / 100} Gbps`; }
function shortHash(value: string): string { return value.includes(':') ? value.split(':')[1].slice(0, 8) : value.slice(0, 8); }

const demoScenarios = listBundledScenarios();

type SelectedScenarioId = BundledScenarioId | 'imported';

function targetGrowthPatch(definition: ScenarioDefinition, multiplier: number): ScenarioPatch {
  return {
    id: `growth-ui-${multiplier}`,
    name: `Forecast growth +${Math.round((multiplier - 1) * 100)}%`,
    disabledNodeIds: [],
    disabledLinkIds: [],
    demandMultipliers: (definition.growthDemandIds ?? []).map((demandId) => ({ demandId, multiplier })),
    addedDemands: [],
    linkCapacityOverrides: [],
  };
}

export function Workbench() {
  const [selectedScenarioId, setSelectedScenarioId] = useState<SelectedScenarioId>('maintenance-trap');
  const [project, setProject] = useState<NetworkProject>(() => loadScenario('maintenance-trap'));
  const resetSeedRef = useRef<NetworkProject>(loadScenario('maintenance-trap'));
  const [activePatch, setActivePatch] = useState<ScenarioPatch | null>(null);
  const [candidate, setCandidate] = useState<CandidatePlan | null>(null);
  const [comparison, setComparison] = useState<CandidateComparison | null>(null);
  const [growth, setGrowth] = useState<GrowthAnalysis | null>(null);
  const [contingencies, setContingencies] = useState<ContingencyAnalysis | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceRef | null>(null);
  const [activity, setActivity] = useState<ToolActivityEvent[]>([]);
  const [webmcpStatus, setWebmcpStatus] = useState<'checking' | 'registered' | 'unsupported' | 'error'>('checking');
  const [registeredTools, setRegisteredTools] = useState<string[]>([]);
  const [importMessage, setImportMessage] = useState<string>('');
  const [lastToolAnalysis, setLastToolAnalysis] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectRef = useRef(project);
  const patchRef = useRef(activePatch);
  const candidateRef = useRef(candidate);
  projectRef.current = project;
  patchRef.current = activePatch;
  candidateRef.current = candidate;

  const definition = useMemo<ScenarioDefinition>(() => {
    if (selectedScenarioId === 'imported') {
      return {
        id: 'blank', title: project.name, kind: 'blank', description: 'Imported canonical project.',
        suggestedPrompt: 'Ask the agent to inspect the imported network, then make a manual edit and ask what changed.', project,
      };
    }
    return getScenarioDefinition(selectedScenarioId);
  }, [selectedScenarioId, project]);

  const analysis = useMemo(() => runScenarioCapacityAnalysis(project, activePatch), [project, activePatch]);
  const snapshot = analysis.snapshot;
  const nodeById = useMemo(() => new Map(snapshot.nodes.map((node) => [node.id, node])), [snapshot.nodes]);
  const routeByDemand = useMemo(() => new Map(analysis.routing.routes.map((route) => [route.demandId, route])), [analysis.routing.routes]);
  const classById = useMemo(() => new Map(snapshot.serviceClasses.map((serviceClass) => [serviceClass.id, serviceClass])), [snapshot.serviceClasses]);
  const candidateLinkIds = useMemo(() => new Set(candidate?.commands.map((command) => String(command.args.linkId ?? '')).filter(Boolean) ?? []), [candidate]);
  const selectedLinkIds = useMemo(() => {
    if (!selectedEvidence) return new Set<string>();
    if (selectedEvidence.type === 'link') return new Set([selectedEvidence.id]);
    if (selectedEvidence.type === 'route') return new Set(selectedEvidence.linkIds ?? []);
    if (selectedEvidence.type === 'demand') return new Set(routeByDemand.get(selectedEvidence.demandId ?? selectedEvidence.id)?.linkIds ?? []);
    return new Set<string>();
  }, [selectedEvidence, routeByDemand]);

  const toolServices = useMemo<InfraTwinToolServices>(() => ({
    getProject: () => projectRef.current,
    setProject: (next) => setProject(next),
    getActiveScenario: () => patchRef.current,
    setActiveScenario: (next) => setActivePatch(next),
    publishCapacityAnalysis: (next: CapacityAnalysis) => setLastToolAnalysis(`${next.result.verdict} · peak ${pct(next.routing.peakUtilizationPct)}`),
    publishContingencyAnalysis: (next) => {
      setContingencies(next);
      setGrowth(null);
      setLastToolAnalysis(`${next.result.metrics.scenariosTested} N-1 scenarios · worst ${next.result.metrics.worstLinkId}`);
    },
    getCandidate: () => candidateRef.current,
    setCandidate: (next) => setCandidate(next),
    publishCandidateComparison: (next) => setComparison(next),
    onActivity: (event) => setActivity((current) => [event, ...current].slice(0, 18)),
  }), []);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context?.registerTool) {
      setWebmcpStatus('unsupported');
      setRegisteredTools([]);
      return;
    }
    let cleanup: (() => void) | undefined;
    let active = true;
    registerBaseTools(context, toolServices)
      .then((dispose) => {
        if (!active) dispose();
        else {
          cleanup = dispose;
          setWebmcpStatus('registered');
          setRegisteredTools([...BASE_TOOL_NAMES]);
        }
      })
      .catch(() => setWebmcpStatus('error'));
    return () => { active = false; cleanup?.(); };
  }, [toolServices]);

  useEffect(() => {
    if (!candidate) {
      setRegisteredTools((current) => current.filter((name) => !CANDIDATE_TOOL_NAMES.includes(name as typeof CANDIDATE_TOOL_NAMES[number])));
      return;
    }
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context?.registerTool) return;
    let cleanup: (() => void) | undefined;
    let active = true;
    registerCandidateTools(context, toolServices)
      .then((dispose) => {
        if (!active) dispose();
        else {
          cleanup = dispose;
          setRegisteredTools((current) => [...new Set([...current, ...CANDIDATE_TOOL_NAMES])]);
        }
      })
      .catch(() => setWebmcpStatus('error'));
    return () => {
      active = false;
      cleanup?.();
      setRegisteredTools((current) => current.filter((name) => !CANDIDATE_TOOL_NAMES.includes(name as typeof CANDIDATE_TOOL_NAMES[number])));
    };
  }, [Boolean(candidate), toolServices]);

  const clearDerived = (keepPatch = false) => {
    if (!keepPatch) setActivePatch(null);
    setCandidate(null);
    setComparison(null);
    setGrowth(null);
    setContingencies(null);
    setSelectedEvidence(null);
    setLastToolAnalysis('');
  };

  const loadDemo = (id: BundledScenarioId) => {
    const next = loadScenario(id);
    resetSeedRef.current = cloneProject(next);
    setSelectedScenarioId(id);
    setProject(next);
    setImportMessage('');
    clearDerived();
  };

  const resetDemo = () => {
    setProject(cloneProject(resetSeedRef.current));
    clearDerived();
  };

  const runMaintenance = () => {
    const patch = definition.recommendedPatch ?? null;
    setActivePatch(patch);
    setGrowth(null);
    setContingencies(null);
    setCandidate(null);
    setComparison(null);
    const result = runScenarioCapacityAnalysis(project, patch);
    const witness = result.result.witnesses.find((item) => item.type === 'route' || item.type === 'link');
    setSelectedEvidence(witness ?? null);
  };

  const runGrowth = () => {
    const multiplier = definition.defaultGrowthMultiplier ?? 1.4;
    const nextGrowth = runGrowthAnalysis(project, definition.growthDemandIds ?? project.demands.map((demand) => demand.id), multiplier, 0.05);
    setGrowth(nextGrowth);
    setContingencies(null);
    setCandidate(null);
    setComparison(null);
    setActivePatch(targetGrowthPatch(definition, multiplier));
    setSelectedEvidence(nextGrowth.firstFailureLinkId ? { type: 'link', id: nextGrowth.firstFailureLinkId } : null);
  };

  const runResilience = () => {
    const next = runLinkContingencies(project);
    setContingencies(next);
    setGrowth(null);
    setCandidate(null);
    setComparison(null);
    if (next.worst) {
      setActivePatch(next.worst.patch);
      setSelectedEvidence({ type: 'link', id: next.worst.linkId });
    }
  };

  const replayContingency = (linkId: string) => {
    const item = contingencies?.cases.find((entry) => entry.linkId === linkId);
    if (!item) return;
    setActivePatch(item.patch);
    setSelectedEvidence({ type: 'link', id: item.linkId });
  };

  const proposeMitigation = () => {
    const next = proposeCapacityMitigation(project, activePatch, 20);
    setCandidate(next);
    setComparison(null);
  };

  const compareCurrentCandidate = () => {
    if (!candidate) return;
    setComparison(compareCandidate(project, candidate, activePatch));
  };

  const applyCurrentCandidate = () => {
    if (!candidate) return;
    try {
      const next = applyCandidatePlan(project, candidate);
      setProject(next);
      setCandidate(null);
      setComparison(null);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : 'Candidate could not be applied.');
    }
  };

  const humanToggleLink = (linkId: string) => {
    setProject((current) => ({
      ...current,
      links: current.links.map((link) => link.id === linkId ? { ...link, available: link.available === false } : link),
    }));
    clearDerived();
  };

  const humanUpdateDemand = (demandId: string, bandwidthGbps: number) => {
    setProject((current) => ({
      ...current,
      demands: current.demands.map((demand) => demand.id === demandId ? { ...demand, bandwidthGbps: Math.max(0, bandwidthGbps) } : demand),
    }));
    clearDerived();
  };

  const exportProject = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importProject = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const validation = validateNetworkProject(parsed);
      if (!validation.valid) throw new Error(validation.errors.join('; '));
      const next = parsed as NetworkProject;
      resetSeedRef.current = cloneProject(next);
      setProject(cloneProject(next));
      setSelectedScenarioId('imported');
      setImportMessage(`Imported ${next.name}. External text is treated as project data, not instructions.`);
      clearDerived();
    } catch (error) {
      setImportMessage(`Import failed: ${error instanceof Error ? error.message : 'invalid JSON'}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const selectViolation = (violation: CapacityAnalysis['result']['violations'][number]) => {
    if (violation.demandId) {
      const route = routeByDemand.get(violation.demandId);
      setSelectedEvidence({ type: 'route', id: `route:${violation.demandId}`, demandId: violation.demandId, linkIds: route?.linkIds ?? [] });
    } else if (violation.linkId) setSelectedEvidence({ type: 'link', id: violation.linkId });
  };

  const activeScenarioLabel = activePatch?.name ?? 'Baseline';
  const peak = analysis.routing.peakUtilizationPct;
  const candidateBeforeAfter = comparison ? `${comparison.before.result.verdict} → ${comparison.after.result.verdict}` : null;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">InfraTwin · Level 1 complete contender</p>
          <h1>{project.name}</h1>
          <p className="subtitle">A local-first infrastructure workbench where human edits, deterministic simulation, candidate plans, and WebMCP agents operate on one canonical model.</p>
        </div>
        <div className="header-actions">
          <span className={`status-chip ${analysis.result.verdict === 'PASS' ? 'pass' : 'fail'}`}>{analysis.result.verdict}</span>
          <button onClick={resetDemo}>Reset demo</button>
          <button onClick={exportProject}>Export JSON</button>
          <button onClick={() => fileInputRef.current?.click()}>Import JSON</button>
          <input ref={fileInputRef} className="hidden-input" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importProject(file); }} />
        </div>
      </header>

      {importMessage && <div className="notice" role="status">{importMessage}</div>}
      {webmcpStatus === 'unsupported' && (
        <div className="notice warning" role="status">WebMCP is not available in this browser. The engineering workbench still works; use ChatGPT’s in-app browser or a supported Chrome WebMCP configuration for agent tools.</div>
      )}

      <section className="summary-grid" aria-label="Network summary">
        <article><span>Model hash</span><strong className="mono">{shortHash(modelHash(project))}</strong></article>
        <article><span>Active scenario</span><strong>{activeScenarioLabel}</strong></article>
        <article><span>Peak utilization</span><strong>{pct(peak)}</strong></article>
        <article><span>WebMCP</span><strong>{webmcpStatus === 'registered' ? `${registeredTools.length} tools` : webmcpStatus}</strong></article>
      </section>

      <section className="workbench-grid">
        <aside className="panel scenario-panel">
          <div className="panel-heading compact"><div><p className="eyebrow">Scenario workspace</p><h2>Open a judge-ready demo</h2></div></div>
          <div className="scenario-list">
            {demoScenarios.map((item) => (
              <button key={item.id} className={`scenario-card ${selectedScenarioId === item.id ? 'active' : ''}`} onClick={() => loadDemo(item.id)}>
                <strong>{item.title}</strong><small>{item.kind === 'blank' ? 'Secondary' : item.kind}</small>
              </button>
            ))}
          </div>
          <div className="scenario-story">
            <strong>{definition.title}</strong>
            <p>{definition.description}</p>
          </div>
          <div className="workflow-actions">
            <button onClick={() => { setActivePatch(null); setSelectedEvidence(null); setGrowth(null); setContingencies(null); }}>Run baseline</button>
            {definition.kind === 'maintenance' && <button className="primary" onClick={runMaintenance}>Simulate maintenance</button>}
            {definition.kind === 'growth' && <button className="primary" onClick={runGrowth}>Run +40% growth</button>}
            {definition.kind === 'resilience' && <button className="primary" onClick={runResilience}>Run all link N-1</button>}
          </div>
          <div className="prompt-card">
            <span>Suggested agent prompt</span>
            <p>{definition.suggestedPrompt}</p>
          </div>
          <div className="assumptions-card">
            <span>Model assumptions</span>
            <p>Deterministic single shortest path. Planning capacity and utilization targets are modeled proxies, not packet-level protocol or QoS guarantees.</p>
          </div>
        </aside>

        <article className="panel graph-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Topology + active diff</p><h2>Human edits and evidence share this graph</h2></div>
            <span className="hint">Click a link for a canonical human edit</span>
          </div>
          {snapshot.nodes.length === 0 ? (
            <div className="empty-canvas"><strong>Blank project</strong><p>Import a valid InfraTwin JSON model to populate the workspace.</p></div>
          ) : (
            <svg className="topology" viewBox="0 0 700 455" role="img" aria-label={`${project.name} network topology`}>
              {snapshot.links.map((link) => {
                const source = nodeById.get(link.source);
                const target = nodeById.get(link.target);
                if (!source || !target) return null;
                const utilization = analysis.routing.linkUtilizationPct[link.id] ?? 0;
                const disabled = link.available === false;
                const overloaded = utilization > 100;
                const high = utilization > 80;
                const selected = selectedLinkIds.has(link.id);
                const candidateLink = candidateLinkIds.has(link.id);
                const canonical = project.links.find((item) => item.id === link.id);
                return (
                  <g key={link.id} className="link-group" onClick={() => humanToggleLink(link.id)} tabIndex={0} role="button" aria-label={`${link.id} ${disabled ? 'disabled' : `${pct(utilization)} utilized`}`}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); humanToggleLink(link.id); } }}>
                    <line x1={source.x} y1={source.y} x2={target.x} y2={target.y}
                      style={{ strokeWidth: Math.min(12, 4 + utilization / 18) }}
                      className={`link-line ${disabled ? 'disabled' : overloaded ? 'overloaded' : high ? 'high' : ''} ${selected ? 'selected' : ''} ${candidateLink ? 'candidate-link' : ''}`} />
                    <text x={((source.x ?? 0) + (target.x ?? 0)) / 2} y={((source.y ?? 0) + (target.y ?? 0)) / 2 - 10} className="link-label">
                      {link.id} · {disabled ? 'OFF' : `${pct(utilization)} · ${link.capacityGbps}G`}
                    </text>
                    <title>{`${link.id}: ${gbps(analysis.routing.linkLoadsGbps[link.id] ?? 0)} / ${gbps(link.capacityGbps)}${canonical && canonical.capacityGbps !== link.capacityGbps ? ' scenario override' : ''}`}</title>
                  </g>
                );
              })}
              {snapshot.nodes.map((node) => (
                <g key={node.id} transform={`translate(${node.x ?? 0} ${node.y ?? 0})`}>
                  <circle r="31" className={`node-circle ${node.available === false ? 'disabled-node' : ''}`} />
                  <text y="4" textAnchor="middle" className="node-id">{node.id}</text>
                  <text y="49" textAnchor="middle" className="node-name">{node.name}</text>
                </g>
              ))}
            </svg>
          )}
          <div className="legend" aria-label="Graph legend"><span><i className="legend-line normal" />normal</span><span><i className="legend-line thick" />loaded</span><span><i className="legend-line dashed" />failed / candidate</span><span><i className="legend-line selected" />selected evidence</span></div>
        </article>

        <aside className="panel evidence-panel">
          <div className="panel-heading compact"><div><p className="eyebrow">Evidence</p><h2>{analysis.result.verdict === 'PASS' ? 'No modeled violations' : `${analysis.result.violations.length} violation(s)`}</h2></div></div>
          <dl className="metrics evidence-metrics">
            <div><dt>Verdict</dt><dd>{analysis.result.verdict}</dd></div>
            <div><dt>Peak</dt><dd>{pct(peak)}</dd></div>
            <div><dt>Unrouted</dt><dd>{analysis.routing.unroutedDemandIds.length}</dd></div>
            <div><dt>Runtime</dt><dd>{analysis.result.runtimeMs} ms</dd></div>
          </dl>

          {growth && (
            <div className="evidence-block">
              <span className="block-label">Growth evidence</span>
              <strong>First failure: {growth.firstFailureMultiplier ? `${growth.firstFailureMultiplier}×` : 'none'}</strong>
              <p>{growth.firstFailureLinkId ? `${growth.firstFailureLinkId} is the first constraint; target peak ${pct(growth.target.routing.peakUtilizationPct)}.` : 'No failure in tested range.'}</p>
            </div>
          )}

          {contingencies && (
            <div className="evidence-block">
              <span className="block-label">Resilience evidence</span>
              <strong>{contingencies.result.metrics.scenariosTested} single-link failures tested</strong>
              <p>Worst: {String(contingencies.result.metrics.worstLinkId)} · score {String(contingencies.result.metrics.worstScore)} · peak {pct(Number(contingencies.result.metrics.worstPeakUtilizationPct))}</p>
            </div>
          )}

          <div className="violation-list">
            {analysis.result.violations.length === 0 ? <p className="empty">PASS under the displayed routing/capacity assumptions.</p> : analysis.result.violations.map((violation) => (
              <button className="violation" key={violation.id} onClick={() => selectViolation(violation)}>
                <strong>{violation.type.replaceAll('_', ' ')}</strong>
                <p>{violation.message}</p>
              </button>
            ))}
          </div>

          {candidate && (
            <div className="candidate-card">
              <div className="candidate-title"><span>Candidate plan</span><strong>{candidate.name}</strong></div>
              {candidate.commands.map((command) => <p key={command.id}><span className="mono">{String(command.args.linkId)}</span> → {String(command.args.capacityGbps)} Gbps</p>)}
              <small>{candidate.objective.name}: {candidate.objective.value} {candidate.objective.unit}</small>
              <div className="candidate-actions"><button onClick={compareCurrentCandidate}>Compare</button><button className="primary" onClick={applyCurrentCandidate}>Apply</button><button onClick={() => { setCandidate(null); setComparison(null); }}>Discard</button></div>
            </div>
          )}
          {!candidate && analysis.result.verdict === 'FAIL' && <button className="wide primary" onClick={proposeMitigation}>Propose deterministic mitigation</button>}

          {comparison && (
            <div className={`comparison ${comparison.after.result.verdict === 'PASS' ? 'comparison-pass' : ''}`}>
              <span>Before → proposed</span><strong>{candidateBeforeAfter}</strong>
              <p>Peak {pct(comparison.before.routing.peakUtilizationPct)} → {pct(comparison.after.routing.peakUtilizationPct)} · violations {comparison.before.result.violations.length} → {comparison.after.result.violations.length}</p>
            </div>
          )}
        </aside>
      </section>

      <section className="lower-grid">
        <article className="panel demand-panel">
          <div className="panel-heading"><div><p className="eyebrow">Demands</p><h2>Manual edit → agent reinspection</h2></div><span className="hint">Edits clear ephemeral previews</span></div>
          <div className="demand-list">
            {project.demands.length === 0 ? <p className="empty">No demands in this project.</p> : project.demands.map((demand) => {
              const effectiveDemand = snapshot.demands.find((item) => item.id === demand.id) ?? demand;
              const route = routeByDemand.get(demand.id);
              const serviceClass = classById.get(demand.serviceClassId);
              return (
                <div className="demand-row" key={demand.id}>
                  <button className="demand-route" onClick={() => setSelectedEvidence({ type: 'route', id: `route:${demand.id}`, demandId: demand.id, linkIds: route?.linkIds ?? [] })}>
                    <strong>{demand.id} · {demand.name ?? demand.id}</strong>
                    <small>{route?.reachable ? route.nodeIds.join(' → ') : 'unreachable'} · {serviceClass?.name ?? demand.serviceClassId} ≤ {serviceClass?.maxUtilizationPct ?? 100}%</small>
                    {effectiveDemand.bandwidthGbps !== demand.bandwidthGbps && <em>scenario: {gbps(effectiveDemand.bandwidthGbps)}</em>}
                  </button>
                  <span className="number-control"><input aria-label={`${demand.id} bandwidth Gbps`} type="number" min="0" step="1" value={demand.bandwidthGbps} onChange={(event) => humanUpdateDemand(demand.id, Number(event.target.value))} /><em>Gbps</em></span>
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel contingency-panel">
          <div className="panel-heading"><div><p className="eyebrow">Counterexample replay</p><h2>{contingencies ? 'Ranked N-1 cases' : 'Run resilience to rank failures'}</h2></div></div>
          {contingencies ? (
            <div className="contingency-list">
              {contingencies.cases.slice(0, 6).map((item, index) => (
                <button key={item.linkId} className={activePatch?.id === item.patch.id ? 'active' : ''} onClick={() => replayContingency(item.linkId)}>
                  <span>#{index + 1} · {item.linkId}</span><strong>{item.verdict}</strong><small>score {item.score} · peak {pct(item.peakUtilizationPct)}</small>
                </button>
              ))}
            </div>
          ) : <p className="muted">Resilience analysis is deterministic and sequential at Level 1. Worker-parallel enumeration is reserved for Level 2.</p>}
        </article>

        <article className="panel agent-panel">
          <div className="panel-heading"><div><p className="eyebrow">Agent activity / WebMCP inspector</p><h2>{registeredTools.length} registered capabilities</h2></div><span className={`status-dot ${webmcpStatus}`} /> </div>
          <div className="tool-badges">
            {registeredTools.map((name) => <span key={name} className={['propose_change', 'apply_candidate', 'discard_candidate'].includes(name) ? 'mutating' : ''}>{name}</span>)}
          </div>
          {lastToolAnalysis && <p className="tool-result">Latest tool-published analysis: {lastToolAnalysis}</p>}
          <div className="activity-list">
            {activity.length === 0 ? <p className="muted">Tool calls appear here with classification, duration, and compact result summaries. No chain-of-thought is exposed.</p> : activity.map((event) => (
              <div key={event.id} className="activity-row">
                <time>{event.startedAt.slice(11, 19)}</time>
                <span className="activity-tool">{event.tool}</span>
                <span className={`activity-kind ${event.readOnly ? 'readonly' : 'mutating'}`}>{event.readOnly ? 'read-only' : 'mutating'}</span>
                <strong className={event.status}>{event.status === 'success' ? '✓' : event.status === 'cancelled' ? '■' : '✕'}</strong>
                <small>{event.summary} · {event.durationMs} ms</small>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
