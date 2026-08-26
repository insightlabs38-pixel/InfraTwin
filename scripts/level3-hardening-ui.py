from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing expected block: {label}')
    return text.replace(old, new, 1)


path = Path('apps/web/components/workbench.tsx')
text = path.read_text()

text = replace_once(
    text,
    "import type { CandidatePlan, NetworkProject, ScenarioPatch } from '@infratwin/model';",
    "import type { CandidatePlan, ModelCommand, NetworkProject, ScenarioPatch } from '@infratwin/model';",
    'model type import',
)
text = replace_once(
    text,
    "import { applyCandidatePlan, applyScenario, cloneProject, invertCandidatePlan, modelHash, scenarioHash, validateNetworkProject } from '@infratwin/model';",
    "import { applyCandidatePlan, applyModelCommand, applyScenario, cloneProject, invertCandidatePlan, modelHash, scenarioHash, validateNetworkProject } from '@infratwin/model';",
    'model value import',
)
text = replace_once(
    text,
    "import { optimizeCapacityInBrowser, optimizeRoutingInBrowser, probeBrowserOptimizer, verifyCandidateInBrowser } from '../lib/optimizer-client';",
    "import { optimizeCapacityInBrowser, optimizeRoutingInBrowser, probeBrowserOptimizer, verifyCandidateInBrowser } from '../lib/optimizer-client';\nimport { AnalysisJourney } from './analysis-journey';\nimport { ScenarioSelector } from './scenario-selector';\nimport { TopologyCanvas } from './topology-canvas';",
    'presentational component imports',
)
text = replace_once(text, "  CANDIDATE_TOOL_NAMES,\n", "  CANDIDATE_TOOL_NAMES,\n  COUNTEREXAMPLE_TOOL_NAMES,\n", 'counterexample constant import')
text = replace_once(text, "  registerCandidateTools,\n", "  registerCandidateTools,\n  registerCounterexampleTools,\n", 'counterexample registration import')

text = replace_once(
    text,
    "  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceRef | null>(null);",
    "  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceRef | null>(null);\n  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);",
    'selected link state',
)
text = replace_once(
    text,
    "  const optimizerControllerRef = useRef<AbortController | null>(null);",
    "  const optimizerControllerRef = useRef<AbortController | null>(null);\n  const humanCommandCounterRef = useRef(0);",
    'human command sequence ref',
)
text = replace_once(
    text,
    "  const nodeById = useMemo(() => new Map(snapshot.nodes.map((node) => [node.id, node])), [snapshot.nodes]);\n",
    "",
    'remove topology-local node map',
)
text = replace_once(
    text,
    "  const classById = useMemo(() => new Map(snapshot.serviceClasses.map((serviceClass) => [serviceClass.id, serviceClass])), [snapshot.serviceClasses]);",
    "  const classById = useMemo(() => new Map(snapshot.serviceClasses.map((serviceClass) => [serviceClass.id, serviceClass])), [snapshot.serviceClasses]);\n  const selectedCanonicalLink = useMemo(() => selectedLinkId ? project.links.find((link) => link.id === selectedLinkId) : undefined, [project.links, selectedLinkId]);",
    'selected link memo',
)

counter_effect_marker = "  const optimizerReady = optimizerStatus === 'ready' || optimizerStatus === 'running';"
counter_effect = """  const hasCounterexample = contingencies?.status === 'complete' && Boolean(contingencies.worst);\n  useEffect(() => {\n    const names = COUNTEREXAMPLE_TOOL_NAMES as readonly string[];\n    if (!hasCounterexample) { setRegisteredTools((current) => current.filter((name) => !names.includes(name))); return; }\n    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;\n    if (!context?.registerTool) return;\n    let cleanup: (() => void) | undefined; let active = true;\n    registerCounterexampleTools(context, toolServices).then((dispose) => {\n      if (!active) dispose(); else { cleanup = dispose; setRegisteredTools((current) => [...new Set([...current, ...COUNTEREXAMPLE_TOOL_NAMES])]); }\n    }).catch(() => setWebmcpStatus('error'));\n    return () => { active = false; cleanup?.(); setRegisteredTools((current) => current.filter((name) => !names.includes(name))); };\n  }, [hasCounterexample, toolServices]);\n\n"""
if counter_effect_marker not in text:
    raise SystemExit('missing optimizerReady marker')
text = text.replace(counter_effect_marker, counter_effect + counter_effect_marker, 1)

text = replace_once(
    text,
    """  const clearDerived = (keepPatch = false) => {\n    cancelDirectRun();\n    if (!keepPatch) setActivePatch(null);\n    setCandidate(null); setComparison(null); setGrowth(null); setContingencies(null); setBottleneck(null); setSelectedEvidence(null); setLastToolAnalysis('');\n    setProgress(null); setResilienceStatus('idle'); setResilienceMessage(''); setOptimizerResult(null); setRoutingOptimization(null); setCandidateVerification(null); setOptimizerRequirements(null); setUndoCandidate(null);\n  };\n""",
    """  const clearDerived = (keepPatch = false) => {\n    cancelDirectRun();\n    optimizerControllerRef.current?.abort(); optimizerControllerRef.current = null;\n    if (!keepPatch) setActivePatch(null);\n    setCandidate(null); setComparison(null); setGrowth(null); setContingencies(null); setBottleneck(null); setSelectedEvidence(null); setSelectedLinkId(null); setLastToolAnalysis('');\n    setProgress(null); setResilienceStatus('idle'); setResilienceMessage(''); setOptimizerResult(null); setRoutingOptimization(null); setCandidateVerification(null); setOptimizerRequirements(null); setUndoCandidate(null);\n    if (optimizerStatus === 'running') { setOptimizerStatus('ready'); setOptimizerMessage('Run cancelled because the shared model or scenario changed.'); }\n  };\n""",
    'derived-state cancellation',
)

text = replace_once(
    text,
    """      setContingencies(next);\n      if (next.worst) { setActivePatch(next.worst.patch); setSelectedEvidence({ type: 'link', id: next.worst.linkId }); }\n""",
    """      setContingencies(next);\n      if (next.worst) { setSelectedEvidence({ type: 'link', id: next.worst.linkId }); setSelectedLinkId(next.worst.linkId); }\n""",
    'explicit counterexample replay',
)

text = replace_once(
    text,
    """    try {\n      const result = await optimizeCapacityInBrowser(project, requirements, 8_000, controller.signal);\n      setOptimizerResult(result); if (result.candidate) { setCandidate(result.candidate); setComparison(null); }\n      setOptimizerStatus('ready'); setOptimizerMessage(`${result.diagnostics.status} · ${result.diagnostics.proof} · ${result.diagnostics.runtimeMs} ms`);\n""",
    """    const expectedModelHash = modelHash(projectRef.current); const expectedScenarioHash = scenarioHash(patchRef.current);\n    try {\n      const result = await optimizeCapacityInBrowser(cloneProject(projectRef.current), requirements, 8_000, controller.signal);\n      if (modelHash(projectRef.current) !== expectedModelHash || scenarioHash(patchRef.current) !== expectedScenarioHash) {\n        setOptimizerStatus('ready'); setOptimizerMessage('Stale optimizer result discarded because the model or scenario changed.'); return;\n      }\n      setOptimizerResult(result); if (result.candidate) { setCandidate(result.candidate); setComparison(null); }\n      setOptimizerStatus('ready'); setOptimizerMessage(`${result.diagnostics.status} · ${result.diagnostics.proof} · ${result.diagnostics.runtimeMs} ms`);\n""",
    'optimizer UI stale guard',
)
text = replace_once(
    text,
    """  const runRoutingOptimizer = async () => {\n    const controller = new AbortController();\n    try { const result = await optimizeRoutingInBrowser(applyScenario(project, activePatch), 5_000, controller.signal); setRoutingOptimization(result); setOptimizerMessage(`Routing LP: ${result.diagnostics.status} · max ${result.maxUtilizationPct ?? 'n/a'}%`); }\n    catch (error) { setOptimizerMessage(error instanceof Error ? error.message : 'Routing LP failed.'); }\n  };\n""",
    """  const runRoutingOptimizer = async () => {\n    const controller = new AbortController(); const expectedModelHash = modelHash(projectRef.current); const expectedScenarioHash = scenarioHash(patchRef.current);\n    try {\n      const result = await optimizeRoutingInBrowser(applyScenario(cloneProject(projectRef.current), patchRef.current), 5_000, controller.signal);\n      if (modelHash(projectRef.current) !== expectedModelHash || scenarioHash(patchRef.current) !== expectedScenarioHash) { setOptimizerMessage('Stale routing result discarded because the model or scenario changed.'); return; }\n      setRoutingOptimization(result); setOptimizerMessage(`Routing LP: ${result.diagnostics.status} · max ${result.maxUtilizationPct ?? 'n/a'}%`);\n    } catch (error) { setOptimizerMessage(error instanceof Error ? error.message : 'Routing LP failed.'); }\n  };\n""",
    'routing UI stale guard',
)
text = replace_once(
    text,
    """  const verifyCurrentCandidate = async () => {\n    if (!candidate) return;\n    const requirements = optimizerRequirements ?? { targetUtilizationPct: 80, budgetCostUnits: optimizerBudget, includeBaseline: true, scenarioPatches: selectedOptimizerScenarios() };\n    try { const result = await verifyCandidateInBrowser(project, candidate, requirements); setCandidateVerification(result); }\n    catch (error) { setOptimizerMessage(error instanceof Error ? error.message : 'Candidate verification failed.'); }\n  };\n""",
    """  const verifyCurrentCandidate = async () => {\n    if (!candidate) return;\n    const requirements = optimizerRequirements ?? { targetUtilizationPct: 80, budgetCostUnits: optimizerBudget, includeBaseline: true, scenarioPatches: selectedOptimizerScenarios() };\n    const expectedModelHash = modelHash(projectRef.current);\n    try {\n      const result = await verifyCandidateInBrowser(cloneProject(projectRef.current), candidate, requirements);\n      if (modelHash(projectRef.current) !== expectedModelHash) { setOptimizerMessage('Stale verification result discarded because the model changed.'); return; }\n      setCandidateVerification(result);\n    } catch (error) { setOptimizerMessage(error instanceof Error ? error.message : 'Candidate verification failed.'); }\n  };\n""",
    'verification UI stale guard',
)

old_human = """  const humanToggleLink = (linkId: string) => {\n    setProject((current) => ({ ...current, links: current.links.map((link) => link.id === linkId ? { ...link, available: link.available === false } : link) })); clearDerived();\n  };\n  const humanUpdateDemand = (demandId: string, bandwidthGbps: number) => {\n    setProject((current) => ({ ...current, demands: current.demands.map((demand) => demand.id === demandId ? { ...demand, bandwidthGbps: Math.max(0, bandwidthGbps) } : demand) })); clearDerived();\n  };\n"""
new_human = """  const applyHumanCommand = (type: ModelCommand['type'], args: Record<string, unknown>) => {\n    const command: ModelCommand = {\n      id: `human-${type}-${++humanCommandCounterRef.current}`, type, actor: 'human', args, createdAt: new Date().toISOString(),\n    };\n    try { setProject((current) => applyModelCommand(current, command)); clearDerived(); }\n    catch (error) { setImportMessage(error instanceof Error ? error.message : 'Human edit was rejected by the canonical command layer.'); }\n  };\n  const humanToggleLink = (linkId: string) => {\n    const link = projectRef.current.links.find((item) => item.id === linkId); if (!link) return;\n    applyHumanCommand('set_link_availability', { linkId, available: link.available === false });\n  };\n  const humanUpdateLinkCapacity = (linkId: string, capacityGbps: number) => {\n    applyHumanCommand('set_link_capacity', { linkId, capacityGbps });\n  };\n  const humanUpdateDemand = (demandId: string, bandwidthGbps: number) => {\n    applyHumanCommand('set_demand_bandwidth', { demandId, bandwidthGbps: Math.max(0, bandwidthGbps) });\n  };\n"""
text = replace_once(text, old_human, new_human, 'canonical human command path')

text = replace_once(
    text,
    "  const progressLabel = progress ? `${progress.completed}/${progress.total} · ${pct(progress.percentage)}` : 'idle';",
    """  const progressLabel = progress ? `${progress.completed}/${progress.total} · ${pct(progress.percentage)}` : 'idle';\n  const primaryFailure = analysis.result.violations[0]?.linkId ?? analysis.result.violations[0]?.demandId ?? null;\n  const candidateLabel = candidate ? `${candidate.commands.length} change candidate` : undoCandidate ? 'Candidate applied' : analysis.result.verdict === 'FAIL' ? 'Mitigation needed' : 'No change required';\n  const nextStep = candidateVerification?.status === 'verified' ? 'Review the verified before/after diff, then apply explicitly.' : candidate ? 'Compare and verify before applying.' : analysis.result.verdict === 'FAIL' ? 'Inspect the failure, then propose or optimize a candidate.' : 'Choose a scenario to test a consequential change.';\n""",
    'journey derived labels',
)

# Header controls and semantic identity test hooks.
text = text.replace('<span className={`status-chip ${analysis.result.verdict === \'PASS\' ? \'pass\' : \'fail\'}`}>{analysis.result.verdict}</span>', '<span data-testid="header-verdict" className={`status-chip ${analysis.result.verdict === \'PASS\' ? \'pass\' : \'fail\'}`}>{analysis.result.verdict}</span>')
text = text.replace('<button onClick={resetDemo}>Reset demo</button><button onClick={exportProject}>Export JSON</button><button onClick={() => fileInputRef.current?.click()}>Import JSON</button>', '<button data-testid="reset-demo" onClick={resetDemo}>Reset demo</button><button data-testid="export-json" onClick={exportProject}>Export JSON</button><button data-testid="import-json" onClick={() => fileInputRef.current?.click()}>Import JSON</button>')
text = text.replace('className="hidden-input" type="file"', 'data-testid="import-file" className="hidden-input" type="file"')

journey_marker = '      <section className="summary-grid" aria-label="Network summary">'
journey = """      <AnalysisJourney\n        scenarioLabel={activeScenarioLabel}\n        verdict={analysis.result.verdict}\n        peakUtilizationPct={peak}\n        violationCount={analysis.result.violations.length}\n        primaryFailure={primaryFailure}\n        candidateLabel={candidateLabel}\n        verificationStatus={candidateVerification?.status ?? null}\n        nextStep={nextStep}\n      />\n\n"""
if journey_marker not in text:
    raise SystemExit('missing summary grid marker')
text = text.replace(journey_marker, journey + journey_marker, 1)
text = text.replace('<article><span>Model / scenario</span><strong className="mono">{shortHash(modelHash(project))} / {shortHash(scenarioHash(activePatch))}</strong></article>', '<article><span>Semantic model / scenario</span><strong data-testid="semantic-model-hash" className="mono">{shortHash(modelHash(project))} / {shortHash(scenarioHash(activePatch))}</strong></article>')

# Scenario selection and workflow affordances.
scenario_start = text.index('          <div className="scenario-list">')
scenario_end = text.index('          <div className="scenario-story">', scenario_start)
text = text[:scenario_start] + "          <ScenarioSelector scenarios={demoScenarios} selectedId={selectedScenarioId} onSelect={loadDemo} />\n" + text[scenario_end:]
text = text.replace('<button onClick={() => { setActivePatch(null); setSelectedEvidence(null); setGrowth(null); setContingencies(null); setBottleneck(null); }}>Run baseline</button>', '<button data-testid="run-baseline" onClick={() => { setActivePatch(null); setSelectedEvidence(null); setGrowth(null); setContingencies(null); setBottleneck(null); }}>Run baseline</button>')
text = text.replace('<button className="primary" onClick={runMaintenance}>Simulate maintenance</button>', '<button data-testid="run-maintenance" className="primary" onClick={runMaintenance}>Simulate maintenance</button>')
text = text.replace('<button className="primary" onClick={runGrowth}>Run +40% growth</button>', '<button data-testid="run-growth" className="primary" onClick={runGrowth}>Run +40% growth</button>')
text = text.replace('<button className="primary" onClick={() => void runResilience()}>Run worker N-1</button>', '<button data-testid="run-resilience" className="primary" onClick={() => void runResilience()}>Run worker N-1</button>')
text = text.replace('<button className="danger" onClick={cancelDirectRun}>Cancel N-1</button>', '<button data-testid="cancel-resilience" className="danger" onClick={cancelDirectRun}>Cancel N-1</button>')
text = text.replace("{optimizerReady && optimizerStatus !== 'running' && <button onClick={() => void runRoutingOptimizer()}>Solve routing LP</button>}", "")
text = text.replace("{optimizerReady && optimizerStatus !== 'running' && <button className=\"primary\" onClick={() => void runOptimizer()}>Find cheapest mitigation</button>}", "{optimizerReady && optimizerStatus !== 'running' && hasViolation && <button data-testid=\"run-optimizer\" className=\"primary\" onClick={() => void runOptimizer()}>Find cheapest mitigation</button>}")
text = text.replace('<button className="danger" onClick={() => optimizerControllerRef.current?.abort()}>Cancel optimizer</button>', '<button data-testid="cancel-optimizer" className="danger" onClick={() => optimizerControllerRef.current?.abort()}>Cancel optimizer</button>')
text = text.replace('<div className={`compute-card ${resilienceStatus}`}>', '<div data-testid="resilience-status" className={`compute-card ${resilienceStatus}`}>')
text = text.replace('<div className={`compute-card ${optimizerStatus === \'error\' ? \'error\' : optimizerStatus === \'running\' ? \'running\' : \'complete\'}`}>', '<div data-testid="optimizer-status" className={`compute-card ${optimizerStatus === \'error\' ? \'error\' : optimizerStatus === \'running\' ? \'running\' : \'complete\'}`}>')
text = text.replace('<div className="assumptions-card"><span>Routing + compute contract</span><p>ECMP equally splits a demand across all equal-cost shortest paths. N-1 uses up to {compute.recommendedWorkerCount} bounded worker slots; SharedArrayBuffer is {compute.sharedArrayBufferSupported && compute.crossOriginIsolated ? \'available but not required\' : \'not required / fallback active\'}.</p></div>', '<details className="scenario-advanced"><summary>Advanced compute assumptions</summary><div className="assumptions-card"><span>Routing + compute contract</span><p>ECMP equally splits a demand across all equal-cost shortest paths. N-1 uses up to {compute.recommendedWorkerCount} bounded worker slots; SharedArrayBuffer is {compute.sharedArrayBufferSupported && compute.crossOriginIsolated ? \'available but not required\' : \'not required / fallback active\'}.</p><button type="button" onClick={() => void runRoutingOptimizer()}>Solve diagnostic routing LP</button></div></details>')

# Replace the dense inline topology with the extracted visual-center component and explicit edit card.
graph_start = text.index('        <article className="panel graph-panel">')
graph_end = text.index('        <aside className="panel evidence-panel">', graph_start)
graph_block = """        <article className="panel graph-panel">\n          <div className="panel-heading"><div><p className="eyebrow">Network topology</p><h2>Visual center · live routes, failures, and candidate diff</h2></div><span className="hint">Select a link, then edit explicitly</span></div>\n          <TopologyCanvas project={project} analysis={analysis} selectedLinkIds={selectedLinkIds} candidateLinkIds={candidateLinkIds} selectedLinkId={selectedLinkId} onSelectLink={(linkId) => { setSelectedLinkId(linkId); setSelectedEvidence({ type: 'link', id: linkId }); }} />\n          {selectedCanonicalLink && <div className="link-edit-card" data-testid="link-editor">\n            <div><span>Selected link</span><strong>{selectedCanonicalLink.id} · {selectedCanonicalLink.source} ↔ {selectedCanonicalLink.target}</strong><small>{selectedCanonicalLink.available === false ? 'Administratively unavailable' : 'Available'} · canonical capacity {gbps(selectedCanonicalLink.capacityGbps)}</small></div>\n            <div className="link-edit-actions">\n              <button data-testid={`link-toggle-${selectedCanonicalLink.id}`} type="button" onClick={() => humanToggleLink(selectedCanonicalLink.id)}>{selectedCanonicalLink.available === false ? 'Restore link' : 'Disable link'}</button>\n              <label className="number-control"><input key={`${selectedCanonicalLink.id}:${selectedCanonicalLink.capacityGbps}`} data-testid={`link-capacity-${selectedCanonicalLink.id}`} aria-label={`${selectedCanonicalLink.id} capacity Gbps`} type="number" min="0.001" step="1" defaultValue={selectedCanonicalLink.capacityGbps} onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value > 0 && value !== selectedCanonicalLink.capacityGbps) humanUpdateLinkCapacity(selectedCanonicalLink.id, value); }} /><em>Gbps</em></label>\n            </div>\n          </div>}\n          <div className="legend" aria-label="Graph legend"><span><i className="legend-line normal" />normal</span><span><i className="legend-line thick" />loaded</span><span><i className="legend-line dashed" />failed / candidate</span><span><i className="legend-line selected" />selected evidence</span></div>\n        </article>\n\n"""
text = text[:graph_start] + graph_block + text[graph_end:]

# Evidence/candidate clarity and robust semantic selectors for browser tests.
text = text.replace('<aside className="panel evidence-panel">', '<aside data-testid="evidence-panel" className="panel evidence-panel">')
text = text.replace('<div className="evidence-block"><span className="block-label">Growth evidence</span>', '<div data-testid="growth-evidence" className="evidence-block"><span className="block-label">Growth evidence</span>')
text = text.replace('<div className="evidence-block"><span className="block-label">Resilience evidence</span>', '<div data-testid="resilience-evidence" className="evidence-block"><span className="block-label">Resilience evidence</span>')
text = text.replace('<div className="evidence-block"><span className="block-label">Capacity MILP</span>', '<div data-testid="capacity-optimizer-result" className="evidence-block"><span className="block-label">Capacity MILP</span>')
text = text.replace('<div className={`comparison ${candidateVerification.status === \'verified\' ? \'comparison-pass\' : \'\'}`}>', '<div data-testid="candidate-verification" className={`comparison ${candidateVerification.status === \'verified\' ? \'comparison-pass\' : \'\'}`}>')
text = text.replace('<button className="wide" onClick={undoAppliedCandidate}>Undo applied candidate</button>', '<button data-testid="undo-candidate" className="wide" onClick={undoAppliedCandidate}>Undo applied candidate</button>')
text = text.replace('<div className="candidate-card">', '<div data-testid="candidate-card" className="candidate-card">')
text = text.replace('<button onClick={() => void verifyCurrentCandidate()}>Verify</button>', '<button data-testid="verify-candidate" onClick={() => void verifyCurrentCandidate()}>Verify</button>')
text = text.replace('<button className="primary" onClick={applyCurrentCandidate}>Apply</button>', '<button data-testid="apply-candidate" className="primary" onClick={applyCurrentCandidate}>Apply</button>')
text = text.replace('<button className="wide primary" onClick={proposeMitigation}>Propose deterministic mitigation</button>', '<button data-testid="propose-deterministic" className="wide" onClick={proposeMitigation}>Quick deterministic mitigation</button>')
text = text.replace('<input aria-label={`${demand.id} bandwidth Gbps`}', '<input data-testid={`demand-input-${demand.id}`} aria-label={`${demand.id} bandwidth Gbps`}')
text = text.replace('<div className="contingency-list">{contingencies.cases.slice(0, 8).map((item, index) => <button key={item.linkId}', '<div data-testid="contingency-list" className="contingency-list">{contingencies.cases.slice(0, 8).map((item, index) => <button data-testid={`counterexample-${item.linkId}`} key={item.linkId}')

# Advanced WebMCP/compute inspector is collapsed by default rather than competing with topology.
agent_start = text.index('        <article className="panel agent-panel">')
agent_end = text.index('        </article>', agent_start) + len('        </article>')
agent = """        <details className="panel agent-panel advanced-disclosure" data-testid="advanced-inspector">\n          <summary><span>Advanced / Inspector</span><strong>{registeredTools.length} WebMCP capabilities · {compute.executionMode}</strong></summary>\n          <div className="advanced-body">\n            <div className="panel-heading"><div><p className="eyebrow">Agent activity / WebMCP</p><h2>State-derived semantic capabilities</h2></div><span className={`status-dot ${webmcpStatus}`} /></div>\n            <div className="tool-badges">{registeredTools.map((name) => <span key={name} className={['propose_change', 'show_counterexample', 'apply_candidate', 'discard_candidate', 'optimize_capacity_plan'].includes(name) ? 'mutating' : ''}>{name}</span>)}</div>\n            <p className="capability-note">Violation tools require current FAIL evidence. Counterexample replay appears only after a valid N-1 ranking exists. Optimizer tools appear only after the HiGHS worker probes successfully. Registration groups are revoked with AbortSignal lifetimes.</p>\n            <dl className="metrics inspector-metrics"><div><dt>Worker mode</dt><dd>{compute.executionMode}</dd></div><div><dt>Worker slots</dt><dd>{compute.recommendedWorkerCount}</dd></div><div><dt>SharedArrayBuffer</dt><dd>{compute.sharedArrayBufferSupported && compute.crossOriginIsolated ? 'available' : 'not required'}</dd></div><div><dt>Optimizer</dt><dd>{optimizerStatus}</dd></div></dl>\n            {lastToolAnalysis && <p className="tool-result">Latest tool-published analysis: {lastToolAnalysis}</p>}\n            <div className="activity-list">{activity.length === 0 ? <p className="muted">Tool calls appear here with classification, duration, cancellation/error state, and compact result summaries.</p> : activity.map((event) => <div key={event.id} className="activity-row"><time>{event.startedAt.slice(11, 19)}</time><span className="activity-tool">{event.tool}</span><span className={`activity-kind ${event.readOnly ? 'readonly' : 'mutating'}`}>{event.readOnly ? 'read-only' : 'mutating'}</span><strong className={event.status}>{event.status === 'success' ? '✓' : event.status === 'cancelled' ? '■' : '✕'}</strong><small>{event.summary} · {event.durationMs} ms</small></div>)}</div>\n          </div>\n        </details>"""
text = text[:agent_start] + agent + text[agent_end:]

path.write_text(text)

# Product-quality CSS overrides are appended so the existing visual language remains intact.
css_path = Path('apps/web/app/globals.css')
css = css_path.read_text()
css += r'''

/* Level 3 hardening / product-quality pass */
.journey-strip {
  display: grid;
  grid-template-columns: 1.05fr 1.15fr .72fr 1fr 1.15fr;
  gap: 8px;
  margin: 0 0 10px;
}
.journey-step {
  min-width: 0;
  border: 1px solid #273448;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(17,24,35,.96), rgba(10,15,23,.96));
  padding: 11px 12px;
  box-shadow: 0 12px 30px rgba(0,0,0,.18);
}
.journey-step span { display:block; color:#71849e; font-size:9px; font-weight:800; letter-spacing:.11em; text-transform:uppercase; }
.journey-step strong { display:block; margin-top:6px; font-size:13px; line-height:1.25; overflow-wrap:anywhere; }
.journey-step small { display:block; margin-top:5px; color:#8495ab; font-size:10px; line-height:1.35; }
.journey-step.result-step strong { font-size:20px; letter-spacing:.08em; }
.journey-step.result-step.pass { border-color:#285942; background:linear-gradient(180deg,#10251c,#0b1712); }
.journey-step.result-step.pass strong { color:#8fe1b8; }
.journey-step.result-step.fail { border-color:#743b43; background:linear-gradient(180deg,#2a1418,#180d10); box-shadow:0 0 0 1px rgba(220,102,114,.12),0 12px 32px rgba(73,15,21,.22); }
.journey-step.result-step.fail strong { color:#ff9ca6; }
.journey-step.why-step.active { border-color:#66502e; background:#1c160d; }
.journey-step.action-step.verified { border-color:#2f6a4d; background:#102219; box-shadow:inset 0 0 0 1px rgba(111,210,154,.12); }
.journey-step.action-step.verified strong { color:#8ee0b8; }

.workbench-grid { grid-template-columns: minmax(220px,.58fr) minmax(620px,2.25fr) minmax(320px,.9fr); gap:12px; }
.graph-panel { border-color:#304158; background:rgba(10,16,24,.97); box-shadow:0 20px 56px rgba(0,0,0,.3); }
.topology { min-height:520px; background:radial-gradient(circle at 50% 45%,#152238 0%,#0b121d 48%,#080d14 78%); }
.evidence-panel { position:relative; }
@media (min-width: 1181px) { .evidence-panel { position:sticky; top:12px; max-height:calc(100vh - 24px); overflow:auto; } }
.scenario-list { grid-template-columns:1fr; }
.scenario-card { min-height:0; padding:11px 12px; }
.scenario-card-kicker { display:block; color:#7187a4; font-size:9px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; }
.scenario-card strong { margin-top:4px; }
.scenario-card small { margin-top:5px; line-height:1.35; text-transform:none; }
.workflow-actions { gap:8px; }
.workflow-actions button.primary { min-height:42px; font-weight:800; }
.scenario-advanced { border:1px solid #263447; border-radius:10px; background:#0a111b; }
.scenario-advanced summary { cursor:pointer; padding:10px 11px; color:#91a3b9; font-size:11px; font-weight:750; }
.scenario-advanced .assumptions-card { border:0; border-top:1px solid #263447; border-radius:0; }
.scenario-advanced button { margin-top:10px; width:100%; }

.link-edit-card { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-top:10px; border:1px solid #315071; border-radius:11px; background:#0d1927; padding:10px 12px; }
.link-edit-card span,.link-edit-card small { display:block; color:#7f93ac; font-size:10px; }
.link-edit-card strong { display:block; margin:3px 0; font-size:12px; }
.link-edit-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
.link-edit-actions .number-control input { width:92px; }
.link-group[aria-pressed="true"] .link-line { filter:drop-shadow(0 0 7px #c9e3ff); }

.evidence-panel > .panel-heading h2 { font-size:19px; }
.violation { border-left-width:4px; }
.violation:hover { transform:none; border-color:#6f3c43; }
.candidate-card { border-style:solid; border-color:#4d7daf; background:linear-gradient(180deg,#0e1d2d,#0b1622); padding:13px; }
.candidate-title strong { font-size:14px; }
.candidate-actions button.primary { min-width:92px; }
.comparison.comparison-pass { border-width:2px; box-shadow:0 0 0 1px rgba(95,193,138,.08); }
.comparison.comparison-pass strong { color:#8ee0b8; font-size:15px; letter-spacing:.04em; }

.lower-grid { grid-template-columns:minmax(380px,1.25fr) minmax(300px,.9fr) minmax(420px,1.2fr); gap:12px; }
.advanced-disclosure { padding:0; overflow:hidden; }
.advanced-disclosure > summary { list-style:none; cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:15px 16px; color:#91a4bb; }
.advanced-disclosure > summary::-webkit-details-marker { display:none; }
.advanced-disclosure > summary span { font-size:10px; font-weight:850; letter-spacing:.12em; text-transform:uppercase; }
.advanced-disclosure > summary strong { color:#c8d5e4; font-size:11px; text-align:right; }
.advanced-disclosure[open] > summary { border-bottom:1px solid #263447; background:#0c141f; }
.advanced-body { padding:16px; }
.inspector-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); margin-top:12px; }
.capability-note { color:#8294aa; font-size:11px; line-height:1.45; }

@media (max-width: 1180px) {
  .journey-strip { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .journey-step.action-step,.journey-step.why-step { grid-column:span 1; }
  .workbench-grid { grid-template-columns:minmax(230px,.65fr) minmax(0,1.65fr); }
  .evidence-panel { grid-column:1 / -1; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
  .evidence-panel > .panel-heading,.evidence-panel > .metrics,.evidence-panel > .violation-list,.evidence-panel > button,.evidence-panel > .candidate-card,.evidence-panel > .comparison { grid-column:span 1; }
  .lower-grid { grid-template-columns:1fr 1fr; }
  .agent-panel { grid-column:1 / -1; }
}
@media (max-width: 820px) {
  .shell { width:min(100% - 18px,1560px); padding-top:14px; }
  .topbar { flex-direction:column; }
  .header-actions { justify-content:flex-start; }
  .journey-strip,.summary-grid,.workbench-grid,.lower-grid { grid-template-columns:1fr; }
  .journey-step { min-height:0; }
  .evidence-panel { display:flex; }
  .topology { min-height:390px; }
  .link-edit-card { align-items:flex-start; flex-direction:column; }
  .link-edit-actions { justify-content:flex-start; width:100%; }
  .activity-row { grid-template-columns:48px minmax(100px,1fr) 58px 18px; }
  .activity-row small { grid-column:1 / -1; }
}
@media (max-width: 520px) {
  .topology { min-height:320px; }
  .summary-grid { display:none; }
  .journey-strip { gap:6px; }
  .journey-step small { display:none; }
  .panel { padding:13px; }
}
'''
css_path.write_text(css)

print('Level 3 UI hardening transform applied.')
