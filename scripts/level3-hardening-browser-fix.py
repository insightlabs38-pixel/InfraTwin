from pathlib import Path

path = Path('apps/web/components/workbench.tsx')
text = path.read_text()

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
print('Level 3 browser hardening fixes applied.')
