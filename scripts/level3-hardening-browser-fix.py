from pathlib import Path

path = Path('apps/web/components/workbench.tsx')
text = path.read_text()

old_refs = "  const directRunControllerRef = useRef<AbortController | null>(null);\n  const optimizerControllerRef = useRef<AbortController | null>(null);"
new_refs = "  const directRunControllerRef = useRef<AbortController | null>(null);\n  const optimizerControllerRef = useRef<AbortController | null>(null);\n  const analysisEpochRef = useRef(0);"
if old_refs not in text:
    raise SystemExit('missing direct analysis refs')
text = text.replace(old_refs, new_refs, 1)

old_execute = "  const executeContingencies = async (options: ContingencyRunOptions = {}): Promise<ContingencyAnalysis> => {\n    const baseProject = cloneProject(projectRef.current);"
new_execute = "  const executeContingencies = async (options: ContingencyRunOptions = {}): Promise<ContingencyAnalysis> => {\n    const runEpoch = ++analysisEpochRef.current;\n    const baseProject = cloneProject(projectRef.current);"
if old_execute not in text:
    raise SystemExit('missing contingency execution start')
text = text.replace(old_execute, new_execute, 1)

old_progress = "      onProgress: (value) => { setProgress(value); externalProgress?.(value); },"
new_progress = "      onProgress: (value) => { if (analysisEpochRef.current !== runEpoch) return; setProgress(value); externalProgress?.(value); },"
if old_progress not in text:
    raise SystemExit('missing contingency progress publication')
text = text.replace(old_progress, new_progress, 1)

old_after_run = "    });\n    if (next.status === 'cancelled') {"
new_after_run = "    });\n    if (analysisEpochRef.current !== runEpoch) return { ...next, status: 'cancelled' };\n    if (next.status === 'cancelled') {"
if old_after_run not in text:
    raise SystemExit('missing contingency result publication boundary')
text = text.replace(old_after_run, new_after_run, 1)

old_clear = "  const clearDerived = (keepPatch = false) => {\n    cancelDirectRun();"
new_clear = "  const clearDerived = (keepPatch = false) => {\n    analysisEpochRef.current += 1;\n    cancelDirectRun();"
if old_clear not in text:
    raise SystemExit('missing clearDerived invalidation boundary')
text = text.replace(old_clear, new_clear, 1)

old_run_resilience = "  const runResilience = async () => {\n    cancelDirectRun();\n    const controller = new AbortController(); directRunControllerRef.current = controller;"
new_run_resilience = "  const runResilience = async () => {\n    cancelDirectRun();\n    const expectedRunEpoch = analysisEpochRef.current + 1;\n    const controller = new AbortController(); directRunControllerRef.current = controller;"
if old_run_resilience not in text:
    raise SystemExit('missing direct resilience run start')
text = text.replace(old_run_resilience, new_run_resilience, 1)

old_direct_result = "      const next = await executeContingencies({ signal: controller.signal, maxScenarios: 500, timeLimitMs: 30_000 });\n      if (next.status !== 'complete') return;"
new_direct_result = "      const next = await executeContingencies({ signal: controller.signal, maxScenarios: 500, timeLimitMs: 30_000 });\n      if (analysisEpochRef.current !== expectedRunEpoch || next.status !== 'complete') return;"
if old_direct_result not in text:
    raise SystemExit('missing direct resilience result guard')
text = text.replace(old_direct_result, new_direct_result, 1)

old_direct_catch = "    } catch (error) {\n      setResilienceStatus(error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'error');"
new_direct_catch = "    } catch (error) {\n      if (analysisEpochRef.current !== expectedRunEpoch) return;\n      setResilienceStatus(error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'error');"
if old_direct_catch not in text:
    raise SystemExit('missing direct resilience error publication')
text = text.replace(old_direct_catch, new_direct_catch, 1)

old_resilience = "{definition.kind === 'resilience' && resilienceStatus !== 'running' && <button data-testid=\"run-resilience\" className=\"primary\" onClick={() => void runResilience()}>Run worker N-1</button>}"
new_resilience = "{(definition.kind === 'resilience' || selectedScenarioId === 'imported') && canRunResilience && resilienceStatus !== 'running' && <button data-testid=\"run-resilience\" className=\"primary\" onClick={() => void runResilience()}>Run worker N-1</button>}"
if old_resilience not in text:
    raise SystemExit('missing generated resilience action')
text = text.replace(old_resilience, new_resilience, 1)

old_runtime = '<div><dt>Runtime</dt><dd>{analysis.result.runtimeMs} ms</dd></div>'
new_runtime = "<div><dt>Routing mode</dt><dd>{analysis.routing.mode === 'ecmp' ? 'ECMP' : 'Shortest path'}</dd></div>"
if old_runtime not in text:
    raise SystemExit('missing nondeterministic runtime metric')
text = text.replace(old_runtime, new_runtime, 1)

path.write_text(text)

css_path = Path('apps/web/app/globals.css')
css = css_path.read_text()
old_grid = '.workbench-grid { display: grid; grid-template-columns: minmax(210px, .62fr) minmax(560px, 2fr) minmax(300px, .88fr); gap: 10px; align-items: stretch; }'
new_grid = '.workbench-grid { display: grid; grid-template-columns: minmax(210px, .62fr) minmax(560px, 2fr) minmax(300px, .88fr); gap: 10px; align-items: start; }'
if old_grid not in css:
    raise SystemExit('missing desktop workbench grid alignment')
css_path.write_text(css.replace(old_grid, new_grid, 1))

print('Level 3 browser hardening fixes applied.')
