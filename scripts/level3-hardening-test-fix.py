from pathlib import Path

path = Path('tests/level1.test.ts')
text = path.read_text()
old = """  await tools.get('propose_change')!.execute({ strategy: 'auto_mitigate', targetHeadroomPct: 20 });\n  assert.ok(candidate);\n"""
new = """  await tools.get('propose_change')!.execute({ strategy: 'set_link_capacity', linkId: 'L3', capacityGbps: 15 });\n  assert.ok(candidate);\n  assert.equal(candidate?.commands[0]?.args.linkId, 'L3');\n"""
if old not in text:
    raise SystemExit('expected propose_change test block not found')
path.write_text(text.replace(old, new, 1))
