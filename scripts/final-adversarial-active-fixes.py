from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one anchor, found {count}')
    return text.replace(old, new, 1)


def replace_or_verify(text: str, old: str, new: str, label: str) -> str:
    if old in text:
        return replace_once(text, old, new, label)
    if new in text:
        return text
    raise SystemExit(f'{label}: neither original nor corrected anchor found')

# F-011: enforce the declared top-level WebMCP schema at the direct execute boundary.
webmcp = Path('packages/webmcp/src/m35d.ts')
text = webmcp.read_text()
anchor = "function asSelectionTarget(v:unknown){if(v===undefined)return undefined;if(v!=='selection')throw new Error('target must be \"selection\" when provided.');return 'selection' as const;}\n"
helper = anchor + "function assertDirectToolInput(name:string,input:unknown,inputSchema?:Record<string,unknown>):asserts input is Record<string,unknown>{if(input===null||typeof input!=='object'||Array.isArray(input))throw new Error(`${name} input must be an object.`);const proto=Object.getPrototypeOf(input);if(proto!==Object.prototype&&proto!==null)throw new Error(`${name} input must be a plain object.`);const properties=inputSchema?.properties;const allowed=new Set(properties&&typeof properties==='object'&&!Array.isArray(properties)?Object.keys(properties as Record<string,unknown>):[]);for(const key of Object.keys(input))if(!allowed.has(key))throw new Error(`${name} input field ${key} is undeclared.`);}\n"
if 'function assertDirectToolInput(' not in text:
    text = replace_once(text, anchor, helper, 'webmcp helper')
old_add = "  const add=(tool:Omit<WebMCPTool,'execute'>&{execute:(input:Record<string,unknown>,options?:ToolExecuteOptions)=>unknown|Promise<unknown>})=>tools.set(tool.name,tool);"
new_add = "  const add=(tool:Omit<WebMCPTool,'execute'>&{execute:(input:Record<string,unknown>,options?:ToolExecuteOptions)=>unknown|Promise<unknown>})=>{const execute=tool.execute;tools.set(tool.name,{...tool,execute:(input,exec)=>{assertDirectToolInput(tool.name,input,tool.inputSchema);return execute(input,exec);}});};"
text = replace_or_verify(text, old_add, new_add, 'webmcp add wrapper')
text = text.replace("service.inspectViolation(typeof i.violationId==='string'?i.violationId:undefined)", "service.inspectViolation(asOptionalString(i.violationId,'violationId'))")
text = text.replace("service.focusViolation(typeof i.violationId==='string'?i.violationId:undefined)", "service.focusViolation(asOptionalString(i.violationId,'violationId'))")
webmcp.write_text(text)

# AV-38: reject redundant link/node availability states while preserving ordered inverse transitions.
model = Path('packages/model/src/index.ts')
text = model.read_text()
old = """export function addPlanChange(plan: ChangePlan, change: PlanChange, now = change.createdAt): ChangePlan {
  const next = cloneChangePlan(plan);
  if (next.changes.some((item) => item.id === change.id)) throw new Error(`Duplicate plan change id ${change.id}`);
  next.changes.push(JSON.parse(JSON.stringify(change)) as PlanChange);
"""
new = """export function addPlanChange(plan: ChangePlan, change: PlanChange, now = change.createdAt): ChangePlan {
  const next = cloneChangePlan(plan);
  if (next.changes.some((item) => item.id === change.id)) throw new Error(`Duplicate plan change id ${change.id}`);
  if (change.type === 'disable_link' || change.type === 'enable_link') {
    const previous = [...next.changes].reverse().find((item) => (item.type === 'disable_link' || item.type === 'enable_link') && item.linkId === change.linkId);
    if (previous?.type === change.type) throw new Error(`Link ${change.linkId} is already ${change.type === 'disable_link' ? 'disabled' : 'enabled'} by the current ordered Change Plan.`);
  }
  if (change.type === 'disable_node' || change.type === 'enable_node') {
    const previous = [...next.changes].reverse().find((item) => (item.type === 'disable_node' || item.type === 'enable_node') && item.nodeId === change.nodeId);
    if (previous?.type === change.type) throw new Error(`Node ${change.nodeId} is already ${change.type === 'disable_node' ? 'disabled' : 'enabled'} by the current ordered Change Plan.`);
  }
  next.changes.push(JSON.parse(JSON.stringify(change)) as PlanChange);
"""
text = replace_or_verify(text, old, new, 'model availability guard')
model.write_text(text)

# Correct the WebMCP red-test harness: the boundary rejects synchronously before tool execution.
test_path = Path('tests/final-adversarial-webmcp-inputs.test.ts')
text = test_path.read_text()
blocks = [
("""  await assert.rejects(
    Promise.resolve(h.tools.get('inspect_workspace')!.execute({ unexpected: true })),
    /unexpected|unknown|not allowed|undeclared/i,
  );""", """  assert.throws(
    () => h.tools.get('inspect_workspace')!.execute({ unexpected: true }),
    /unexpected|unknown|not allowed|undeclared/i,
  );"""),
("""  await assert.rejects(
    Promise.resolve(h.tools.get('add_plan_change')!.execute({ type: 'disable_link', linkId: 'L1', surprise: { nested: true } })),
    /surprise|unknown|not allowed|undeclared/i,
  );""", """  assert.throws(
    () => h.tools.get('add_plan_change')!.execute({ type: 'disable_link', linkId: 'L1', surprise: { nested: true } }),
    /surprise|unknown|not allowed|undeclared/i,
  );"""),
("""  await assert.rejects(
    Promise.resolve((h.tools.get('inspect_workspace')!.execute as any)(null)),
    /object/i,
  );""", """  assert.throws(
    () => (h.tools.get('inspect_workspace')!.execute as any)(null),
    /object/i,
  );"""),
("""  await assert.rejects(
    Promise.resolve(h.tools.get('inspect_violation')!.execute({ violationId: 123 as any })),
    /violationId.*string|string.*violationId/i,
  );""", """  assert.throws(
    () => h.tools.get('inspect_violation')!.execute({ violationId: 123 as any }),
    /violationId.*string|string.*violationId/i,
  );"""),
("""  await assert.rejects(
    Promise.resolve(h.tools.get('focus_violation')!.execute({ violationId: { id: 'capacity:L3' } as any })),
    /violationId.*string|string.*violationId/i,
  );""", """  assert.throws(
    () => h.tools.get('focus_violation')!.execute({ violationId: { id: 'capacity:L3' } as any }),
    /violationId.*string|string.*violationId/i,
  );"""),
]
for index, (old_block, new_block) in enumerate(blocks):
    text = replace_or_verify(text, old_block, new_block, f'webmcp test block {index}')
test_path.write_text(text)

# Correct the scale/repeated-action harness and prove inverse availability transitions remain valid.
test_path = Path('tests/final-adversarial-scale-actions.test.ts')
text = test_path.read_text()
text = replace_or_verify(text,
    "import { createChangePlan, type ChangePlan, type NetworkProject, type ScenarioPatch } from '../packages/model/src/index.ts';",
    "import { changePlanHash, createChangePlan, type ChangePlan, type NetworkProject, type ScenarioPatch } from '../packages/model/src/index.ts';",
    'scale test import')
text = text.replace('const afterOnceHash = once.revisionHash;', 'const afterOnceHash = changePlanHash(once);')
text = text.replace('assert.equal(twice.revisionHash, afterOnceHash', 'assert.equal(changePlanHash(twice), afterOnceHash')
text = text.replace('const routedHash = routedOnce.revisionHash;', 'const routedHash = changePlanHash(routedOnce);')
text = text.replace('twice.constraints.forbiddenRoutingLinkIds', 'twice.restrictions.forbiddenRoutingLinkIds')
text = text.replace('routedTwice.constraints.forbiddenRoutingLinkIds', 'routedTwice.restrictions.forbiddenRoutingLinkIds')
text = text.replace('assert.equal(routedTwice.revisionHash, routedHash', 'assert.equal(changePlanHash(routedTwice), routedHash')
old_tail = """  assert.equal(h.plan.changes.filter((change) => change.type === 'disable_link' && change.linkId === linkId).length, 1);
});
"""
new_tail = """  assert.equal(h.plan.changes.filter((change) => change.type === 'disable_link' && change.linkId === linkId).length, 1);
  h.service.addPlanChange({ type: 'enable_link', linkId }, 'human');
  h.service.addPlanChange({ type: 'disable_link', linkId }, 'human');
  assert.equal(h.plan.changes.filter((change) => change.type === 'disable_link' && change.linkId === linkId).length, 2, 'disable→enable→disable remains a valid ordered semantic sequence');
});
"""
text = replace_or_verify(text, old_tail, new_tail, 'availability inverse proof')
test_path.write_text(text)
