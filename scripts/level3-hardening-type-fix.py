from pathlib import Path

# Workbench: capacity analysis is a PASS/FAIL presentation even though the shared Verdict type is broader.
path = Path('apps/web/components/workbench.tsx')
text = path.read_text()
old = """        verdict={analysis.result.verdict}\n"""
new = """        verdict={analysis.result.verdict === 'PASS' ? 'PASS' : 'FAIL'}\n"""
if old not in text:
    raise SystemExit('expected AnalysisJourney verdict prop not found')
path.write_text(text.replace(old, new, 1))

# Level 1: avoid callback-assignment narrowing on the closed-over candidate variable.
path = Path('tests/level1.test.ts')
text = path.read_text()
old = """  assert.equal(candidate?.commands[0]?.args.linkId, 'L3');\n"""
new = """  assert.equal(services.getCandidate()?.commands[0]?.args.linkId, 'L3');\n"""
if old not in text:
    raise SystemExit('expected Level 1 candidate assertion not found')
path.write_text(text.replace(old, new, 1))

# Hardening test: generic WebMCP execute returns unknown in the interface, so make the rejection block explicitly async.
path = Path('tests/level3-hardening.test.ts')
text = path.read_text()
old = """  await assert.rejects(() => harness.tools.get('optimize_capacity_plan')!.execute({ targetUtilizationPct: 80 }), /stale/i);\n"""
new = """  await assert.rejects(async () => { await harness.tools.get('optimize_capacity_plan')!.execute({ targetUtilizationPct: 80 }); }, /stale/i);\n"""
if old not in text:
    raise SystemExit('expected hardening assert.rejects call not found')
path.write_text(text.replace(old, new, 1))
