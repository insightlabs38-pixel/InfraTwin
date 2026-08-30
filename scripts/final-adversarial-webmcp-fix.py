from pathlib import Path

# F-002: serialize dynamic WebMCP registration refreshes inside the registration owner.
p = Path('packages/webmcp/src/m35d.ts')
s = p.read_text()
old = """export async function registerCollaborativeTools(context:ModelContextLike,service:CollaborativeWorkspaceService,options:WebMCPRegistrationOptions={}):Promise<WebMCPRegistration>{
  const registrations=new Map<string,AbortController>();let disposed=false;let tools:Map<string,WebMCPTool>;
  const desired=()=>{const state=service.capabilityState();const names=new Set<string>(CORE_TOOL_NAMES);if(state.hasViolation)for(const n of VIOLATION_TOOL_NAMES)names.add(n);if(state.canProposeMitigation)for(const n of MITIGATION_TOOL_NAMES)names.add(n);if(state.canCompareMitigationVariants)for(const n of DESIGN_TOOL_NAMES)names.add(n);if(state.canDecideProposal)for(const n of PROPOSAL_TOOL_NAMES)names.add(n);return names;};
  const refresh=async()=>{if(disposed)return;const want=desired();for(const [name,c] of [...registrations])if(!want.has(name)){c.abort();registrations.delete(name);}for(const name of want)if(!registrations.has(name)){const tool=tools.get(name);if(!tool)continue;const c=new AbortController();await context.registerTool(tool,{signal:c.signal});if(disposed)c.abort();else registrations.set(name,c);}options.onToolSetChanged?.([...registrations.keys()].sort());};
  tools=buildTools(service,options,refresh);
  await refresh();
  return {refresh:async()=>{await refresh();return [...registrations.keys()].sort();},dispose:()=>{disposed=true;for(const c of registrations.values())c.abort();registrations.clear();options.onToolSetChanged?.([]);},getRegisteredNames:()=>[...registrations.keys()].sort()};
}
"""
new = """export async function registerCollaborativeTools(context:ModelContextLike,service:CollaborativeWorkspaceService,options:WebMCPRegistrationOptions={}):Promise<WebMCPRegistration>{
  const registrations=new Map<string,AbortController>();let disposed=false;let tools:Map<string,WebMCPTool>;let refreshTail:Promise<void>=Promise.resolve();
  const desired=()=>{const state=service.capabilityState();const names=new Set<string>(CORE_TOOL_NAMES);if(state.hasViolation)for(const n of VIOLATION_TOOL_NAMES)names.add(n);if(state.canProposeMitigation)for(const n of MITIGATION_TOOL_NAMES)names.add(n);if(state.canCompareMitigationVariants)for(const n of DESIGN_TOOL_NAMES)names.add(n);if(state.canDecideProposal)for(const n of PROPOSAL_TOOL_NAMES)names.add(n);return names;};
  const applyRefresh=async()=>{if(disposed)return;const want=desired();for(const [name,c] of [...registrations])if(!want.has(name)){c.abort();registrations.delete(name);}for(const name of want)if(!registrations.has(name)){const tool=tools.get(name);if(!tool)continue;const c=new AbortController();try{await context.registerTool(tool,{signal:c.signal});if(disposed)c.abort();else registrations.set(name,c);}catch(error){c.abort();throw error;}}options.onToolSetChanged?.([...registrations.keys()].sort());};
  const refresh=()=>{const run=refreshTail.then(applyRefresh,applyRefresh);refreshTail=run.catch(()=>{});return run;};
  tools=buildTools(service,options,refresh);
  await refresh();
  return {refresh:async()=>{await refresh();return [...registrations.keys()].sort();},dispose:()=>{disposed=true;for(const c of registrations.values())c.abort();registrations.clear();options.onToolSetChanged?.([]);},getRegisteredNames:()=>[...registrations.keys()].sort()};
}
"""
if old not in s:
    raise SystemExit('registerCollaborativeTools target not found')
p.write_text(s.replace(old, new))

# Ensure React-triggered refresh failures are caught and exposed to the native test/UI instead of becoming unhandled rejections.
p = Path('apps/web/components/workbench-m35d-stage3.tsx')
s = p.read_text()
old = "  useEffect(() => { void webmcpRegistrationRef.current?.refresh(); }, [currentPlanHash, plan.proposals, analysisFresh, publishedPlanAnalysis?.verdict, optimizerStatus, workspaceService]);"
new = """  useEffect(() => { const registration = webmcpRegistrationRef.current; if (!registration) return; void registration.refresh().catch((error: unknown) => { const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error); (window as Window & { __infratwinWebMCPRegistrationError?: string }).__infratwinWebMCPRegistrationError = message; console.error('[InfraTwin WebMCP] refresh failed', error); setWebmcpStatus('error'); }); }, [currentPlanHash, plan.proposals, analysisFresh, publishedPlanAnalysis?.verdict, optimizerStatus, workspaceService]);"""
if old not in s:
    raise SystemExit('stage3 refresh effect target not found')
p.write_text(s.replace(old, new))

# Deterministic concurrent-refresh regression using an async host that rejects duplicate active names.
p = Path('tests/phase35d-webmcp-coactivity.test.ts')
s = p.read_text()
marker = "test('AV-21/F-002: concurrent WebMCP refreshes register every active tool exactly once'"
if marker not in s:
    s += r'''

test('AV-21/F-002: concurrent WebMCP refreshes register every active tool exactly once', async () => {
  const h = makeHarness();
  const active = new Set<string>();
  const calls = new Map<string, number>();
  const context: ModelContextLike = {
    async registerTool(tool, options) {
      if (active.has(tool.name)) {
        const error = new Error('Duplicate tool name');
        error.name = 'InvalidStateError';
        throw error;
      }
      active.add(tool.name);
      calls.set(tool.name, (calls.get(tool.name) ?? 0) + 1);
      options?.signal?.addEventListener('abort', () => active.delete(tool.name), { once: true });
      await new Promise((resolve) => setTimeout(resolve, 2));
    },
  };
  const registration = await registerCollaborativeTools(context, h.service);
  for (const name of CORE_TOOL_NAMES) assert.equal(calls.get(name), 1);

  await addFailingHumanOutage(h);
  await Promise.all(Array.from({ length: 8 }, () => registration.refresh()));
  for (const name of [...CORE_TOOL_NAMES, ...VIOLATION_TOOL_NAMES, ...MITIGATION_TOOL_NAMES]) {
    assert.ok(active.has(name), `${name} must be active after concurrent refreshes`);
    assert.equal(calls.get(name), 1, `${name} must be registered exactly once`);
  }

  h.service.setPlanConstraint('targetUtilizationPct', 70, 'human');
  await Promise.all(Array.from({ length: 8 }, () => registration.refresh()));
  for (const name of [...VIOLATION_TOOL_NAMES, ...MITIGATION_TOOL_NAMES, ...PROPOSAL_TOOL_NAMES]) assert.equal(active.has(name), false);
  for (const name of CORE_TOOL_NAMES) assert.equal(calls.get(name), 1, `${name} must not be re-registered while continuously active`);

  registration.dispose();
  assert.equal(active.size, 0, 'dispose must revoke every active registration');
});
'''
p.write_text(s)

# Native Chromium must fail if a duplicate registration escapes as a page error or error console entry.
p = Path('e2e/phase35d-native-webmcp.spec.ts')
s = p.read_text()
helper_anchor = "type NativeToolResult = unknown;\n"
helper = r'''
function collectRegistrationErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    const message = `${error.name}: ${error.message}`;
    if (/Duplicate tool name|InfraTwin WebMCP.*(?:registration|refresh) failed/i.test(message)) errors.push(message);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/Duplicate tool name|InfraTwin WebMCP.*(?:registration|refresh) failed/i.test(text)) errors.push(text);
  });
  return errors;
}
'''
if 'function collectRegistrationErrors' not in s:
    s = s.replace(helper_anchor, helper_anchor + helper)
first = "test('M3.5D native WebMCP host — real document.modelContext discovery/execution shares human selection and plan state', async ({ page, browser }, testInfo) => {\n  await page.goto('/');"
first_new = "test('M3.5D native WebMCP host — real document.modelContext discovery/execution shares human selection and plan state', async ({ page, browser }, testInfo) => {\n  const registrationErrors = collectRegistrationErrors(page);\n  await page.goto('/');"
if first not in s:
    raise SystemExit('first native test start target not found')
s = s.replace(first, first_new)
first_end = "  await testInfo.attach('m35d-native-webmcp-eval', { path, contentType: 'application/json' });\n});"
first_end_new = "  await testInfo.attach('m35d-native-webmcp-eval', { path, contentType: 'application/json' });\n  expect(registrationErrors, `Native registration emitted errors: ${registrationErrors.join(' | ')}`).toEqual([]);\n});"
if first_end not in s:
    raise SystemExit('first native test end target not found')
s = s.replace(first_end, first_end_new)
second = "test('Level 4A native WebMCP replan — human protects X and native propose_mitigation returns verified Y alternative', async ({ page, browser }, testInfo) => {\n  await page.goto('/');"
second_new = "test('Level 4A native WebMCP replan — human protects X and native propose_mitigation returns verified Y alternative', async ({ page, browser }, testInfo) => {\n  const registrationErrors = collectRegistrationErrors(page);\n  await page.goto('/');"
if second not in s:
    raise SystemExit('second native test start target not found')
s = s.replace(second, second_new)
second_end = "  await testInfo.attach('level4a-native-webmcp-replan', { path, contentType: 'application/json' });\n});"
second_end_new = "  await testInfo.attach('level4a-native-webmcp-replan', { path, contentType: 'application/json' });\n  expect(registrationErrors, `Native registration emitted errors: ${registrationErrors.join(' | ')}`).toEqual([]);\n});"
if second_end not in s:
    raise SystemExit('second native test end target not found')
s = s.replace(second_end, second_end_new)
p.write_text(s)
