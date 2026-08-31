from pathlib import Path

# Temporary patcher for the AV-07 browser cancellation race. Remove before final freeze.
p = Path('e2e/level3-adversarial.spec.ts')
s = p.read_text()
old = "          if (cancelAfterMs !== undefined) timer = setTimeout(() => controller.abort(), Math.max(0, cancelAfterMs));\n          try {\n            const result = await tool.execute(input, { signal: controller.signal });\n"
new = "          try {\n            const pending = tool.execute(input, { signal: controller.signal });\n            if (cancelAfterMs === 0) controller.abort();\n            else if (cancelAfterMs !== undefined) timer = setTimeout(() => controller.abort(), Math.max(0, cancelAfterMs));\n            const result = await pending;\n"
if old not in s:
    raise SystemExit('cancellation execution anchor not found')
s = s.replace(old, new, 1)
old = "  const cancelled = await executeTool(page, 'run_contingencies', { maxScenarios: 359, workerCount: 2, timeLimitMs: 30_000 }, 1);\n"
new = "  const cancelled = await executeTool(page, 'run_contingencies', { maxScenarios: 359, workerCount: 2, timeLimitMs: 30_000 }, 0);\n"
if old not in s:
    raise SystemExit('cancellation invocation anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)
