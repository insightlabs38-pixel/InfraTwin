from pathlib import Path

path = Path('packages/webmcp/src/m35d.ts')
text = path.read_text()

anchor = "function asSelectionTarget(v:unknown){if(v===undefined)return undefined;if(v!=='selection')throw new Error('target must be \"selection\" when provided.');return 'selection' as const;}\n"
insert = anchor + "function assertDirectToolInput(name:string,input:unknown,inputSchema?:Record<string,unknown>):asserts input is Record<string,unknown>{if(input===null||typeof input!=='object'||Array.isArray(input))throw new Error(`${name} input must be an object.`);const proto=Object.getPrototypeOf(input);if(proto!==Object.prototype&&proto!==null)throw new Error(`${name} input must be a plain object.`);const properties=inputSchema?.properties;const allowed=new Set(properties&&typeof properties==='object'&&!Array.isArray(properties)?Object.keys(properties as Record<string,unknown>):[]);for(const key of Object.keys(input))if(!allowed.has(key))throw new Error(`${name} input field ${key} is undeclared.`);}\n"
if text.count(anchor) != 1:
    raise SystemExit(f'assert-input helper anchor count={text.count(anchor)}')
text = text.replace(anchor, insert, 1)

old_add = "  const add=(tool:Omit<WebMCPTool,'execute'>&{execute:(input:Record<string,unknown>,options?:ToolExecuteOptions)=>unknown|Promise<unknown>})=>tools.set(tool.name,tool);"
new_add = "  const add=(tool:Omit<WebMCPTool,'execute'>&{execute:(input:Record<string,unknown>,options?:ToolExecuteOptions)=>unknown|Promise<unknown>})=>{const execute=tool.execute;tools.set(tool.name,{...tool,execute:(input,exec)=>{assertDirectToolInput(tool.name,input,tool.inputSchema);return execute(input,exec);}});};"
if text.count(old_add) != 1:
    raise SystemExit(f'add wrapper anchor count={text.count(old_add)}')
text = text.replace(old_add, new_add, 1)

old_inspect = "service.inspectViolation(typeof i.violationId==='string'?i.violationId:undefined)"
new_inspect = "service.inspectViolation(asOptionalString(i.violationId,'violationId'))"
old_focus = "service.focusViolation(typeof i.violationId==='string'?i.violationId:undefined)"
new_focus = "service.focusViolation(asOptionalString(i.violationId,'violationId'))"
if text.count(old_inspect) != 1 or text.count(old_focus) != 1:
    raise SystemExit(f'violation anchors inspect={text.count(old_inspect)} focus={text.count(old_focus)}')
text = text.replace(old_inspect, new_inspect, 1).replace(old_focus, new_focus, 1)
path.write_text(text)
