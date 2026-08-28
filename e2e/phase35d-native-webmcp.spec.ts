import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// This is a dedicated headed lane. The normal E2E suite keeps it skipped so the rest of
// the product can still be tested in ordinary headless Chromium.
test.skip(process.env.WEBMCP_NATIVE !== '1', 'Run with npm run test:webmcp:native under xvfb/headed Chromium.');

test.use({
  launchOptions: {
    args: [
      '--enable-experimental-web-platform-features',
      '--enable-blink-features=WebMCP',
      '--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport',
    ],
  },
});

type NativeToolResult = unknown;

async function nativeToolNames(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(async () => {
    const context = (document as Document & { modelContext?: { getTools(): Promise<Array<{ name: string }>> } }).modelContext;
    if (!context?.getTools) throw new Error('Native document.modelContext.getTools() is unavailable. Enable WebMCP testing in Chromium 146+.');
    return (await context.getTools()).map((tool) => tool.name).sort();
  });
}

async function executeNative(page: import('@playwright/test').Page, name: string, input: Record<string, unknown> = {}): Promise<NativeToolResult> {
  return page.evaluate(async ({ name, input }) => {
    type Tool = { name: string };
    type Ctx = { getTools(): Promise<Tool[]>; executeTool(tool: Tool, input: string, options?: { signal?: AbortSignal }): Promise<unknown> };
    const context = (document as Document & { modelContext?: Ctx }).modelContext;
    if (!context?.getTools || !context.executeTool) throw new Error('Native WebMCP discovery/execution API is unavailable.');
    const tool = (await context.getTools()).find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Native WebMCP tool ${name} is not registered.`);
    const result = await context.executeTool(tool, JSON.stringify(input));
    if (typeof result === 'string') {
      try { return JSON.parse(result); } catch { return result; }
    }
    return result;
  }, { name, input });
}

test('M3.5D native WebMCP host — real document.modelContext discovery/execution shares human selection and plan state', async ({ page, browser }, testInfo) => {
  await page.goto('/');
  await expect(page.getByTestId('topology-canvas')).toBeVisible();
  const browserVersion = browser.version();

  const available = await page.evaluate(() => {
    const context = (document as Document & { modelContext?: { getTools?: unknown; executeTool?: unknown } }).modelContext;
    return { hasContext: Boolean(context), getTools: typeof context?.getTools, executeTool: typeof context?.executeTool };
  });
  expect(available, `Native WebMCP unavailable in Chromium ${browserVersion}; CI must run headed with WebMCP flags.`).toEqual({ hasContext: true, getTools: 'function', executeTool: 'function' });

  await expect.poll(() => nativeToolNames(page), { timeout: 20_000 }).toEqual(expect.arrayContaining(['inspect_workspace', 'inspect_selection', 'add_plan_change', 'analyze_plan']));
  const initialTools = await nativeToolNames(page);
  expect(initialTools).not.toContain('apply_candidate');
  expect(initialTools).not.toContain('inspect_violation');

  await page.evaluate(() => {
    const context = (document as Document & { modelContext?: EventTarget }).modelContext;
    (window as Window & { __nativeToolchangeCount?: number }).__nativeToolchangeCount = 0;
    context?.addEventListener('toolchange', () => { (window as Window & { __nativeToolchangeCount?: number }).__nativeToolchangeCount = ((window as Window & { __nativeToolchangeCount?: number }).__nativeToolchangeCount ?? 0) + 1; });
  });

  await page.getByTestId('network-selector').selectOption('maintenance-trap');
  await page.getByTestId('topology-search').fill('L1');
  await page.getByTestId('search-result-link-L1').click();
  await expect(page.getByTestId('link-inspector-L1')).toBeVisible();

  const selected = await executeNative(page, 'inspect_selection') as Record<string, unknown>;
  expect(selected).toMatchObject({ state: 'selected', kind: 'link', id: 'L1' });

  const mutation = await executeNative(page, 'add_plan_change', { type: 'disable_link', target: 'selection' }) as Record<string, unknown>;
  expect(mutation).toBeTruthy();
  await expect(page.getByTestId('plan-change-list')).toContainText('Take L1 offline');
  await expect(page.getByTestId('plan-change-list')).toContainText('Agent-authored');
  await expect(page.getByTestId('link-inspector-L1')).toContainText('Planned outage');

  const analysis = await executeNative(page, 'analyze_plan') as Record<string, unknown>;
  expect(analysis).toMatchObject({ state: 'current', verdict: 'FAIL' });
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await expect.poll(() => nativeToolNames(page), { timeout: 20_000 }).toEqual(expect.arrayContaining(['inspect_violation', 'focus_violation', 'propose_mitigation']));

  const violation = await executeNative(page, 'inspect_violation') as Record<string, unknown>;
  expect(violation).toMatchObject({ linkId: 'L3' });
  await page.getByTestId('nav-analysis').click();
  await executeNative(page, 'focus_violation', { violationId: violation.id });
  await expect(page.getByTestId('network-view')).toBeVisible();
  await expect(page.getByTestId('link-inspector-L3')).toBeVisible();

  const toolchangeCount = await page.evaluate(() => (window as Window & { __nativeToolchangeCount?: number }).__nativeToolchangeCount ?? 0);
  expect(toolchangeCount).toBeGreaterThan(0);

  const finalWorkspace = await executeNative(page, 'inspect_workspace') as Record<string, any>;
  expect(finalWorkspace.plan.changes.some((change: { actor: string; summary: string }) => change.actor === 'agent' && change.summary.includes('L1'))).toBe(true);
  expect(finalWorkspace.analysis).toMatchObject({ state: 'current', verdict: 'FAIL' });

  const evaluation = {
    browserVersion,
    api: 'document.modelContext',
    native: true,
    cases: [
      { prompt: 'I selected a backbone link. What am I looking at?', tool: 'inspect_selection', input: {}, result: selected, visibleConsequence: 'Human-selected L1 was read without copying its ID.', userCorrectionNeeded: false },
      { prompt: 'Add this link to the maintenance plan.', tool: 'add_plan_change', input: { type: 'disable_link', target: 'selection' }, result: mutation, visibleConsequence: 'Agent-authored L1 outage appeared in the visible ChangePlan and topology inspector.', userCorrectionNeeded: false },
      { prompt: 'Check whether the plan is safe.', tool: 'analyze_plan', input: {}, result: analysis, visibleConsequence: 'The same deterministic FAIL evidence was published into the UI.', userCorrectionNeeded: false },
      { prompt: 'Show me the main reason it fails.', tool: 'inspect_violation → focus_violation', input: { violationId: violation.id }, result: violation, visibleConsequence: 'The Network workspace selected L3, the violating link.', userCorrectionNeeded: false },
    ],
    initialTools,
    finalTools: await nativeToolNames(page),
    toolchangeCount,
  };
  const path = testInfo.outputPath('m35d-native-webmcp-eval.json');
  await writeFile(path, JSON.stringify(evaluation, null, 2));
  await testInfo.attach('m35d-native-webmcp-eval', { path, contentType: 'application/json' });
});
