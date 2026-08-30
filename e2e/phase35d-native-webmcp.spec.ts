import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createLevel4ReplanReference } from '../packages/scenarios/src/index.ts';

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
  const registrationErrors = collectRegistrationErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('topology-canvas')).toBeVisible();
  const browserVersion = browser.version();

  const available = await page.evaluate(() => {
    const context = (document as Document & { modelContext?: { getTools?: unknown; executeTool?: unknown; registerTool?: unknown } }).modelContext;
    return {
      hasContext: Boolean(context),
      registerTool: typeof context?.registerTool,
      getTools: typeof context?.getTools,
      executeTool: typeof context?.executeTool,
      originAgentCluster: (window as Window & { originAgentCluster?: boolean }).originAgentCluster ?? false,
      secureContext: window.isSecureContext,
    };
  });
  expect(available, `Native WebMCP unavailable in Chromium ${browserVersion}; CI must run headed with WebMCP flags and an origin-keyed agent cluster.`).toEqual({
    hasContext: true,
    registerTool: 'function',
    getTools: 'function',
    executeTool: 'function',
    originAgentCluster: true,
    secureContext: true,
  });

  const registrationProbe = await page.evaluate(async () => {
    type Tool = { name: string };
    type Ctx = {
      registerTool(tool: { name: string; description: string; inputSchema: Record<string, unknown>; execute(): unknown }, options?: { signal?: AbortSignal }): Promise<void>;
      getTools(): Promise<Tool[]>;
    };
    const context = (document as Document & { modelContext?: Ctx }).modelContext;
    if (!context?.registerTool || !context.getTools) return { registered: false, error: 'registration API unavailable' };
    const controller = new AbortController();
    try {
      await context.registerTool({
        name: '__infratwin_native_registration_probe',
        description: 'InfraTwin native WebMCP registration contract probe.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => ({ ok: true }),
      }, { signal: controller.signal });
      const registered = (await context.getTools()).some((tool) => tool.name === '__infratwin_native_registration_probe');
      return { registered, error: null };
    } catch (error) {
      return { registered: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    } finally {
      controller.abort();
    }
  });
  expect(registrationProbe, `Native registerTool probe failed: ${registrationProbe.error ?? 'probe was not discoverable'}`).toEqual({ registered: true, error: null });

  await expect.poll(async () => {
    const state = await page.evaluate(async () => {
      const context = (document as Document & { modelContext?: { getTools(): Promise<Array<{ name: string }>> } }).modelContext;
      const registrationError = (window as Window & { __infratwinWebMCPRegistrationError?: string }).__infratwinWebMCPRegistrationError ?? null;
      return { tools: context?.getTools ? (await context.getTools()).map((tool) => tool.name).sort() : [], registrationError };
    });
    if (state.registrationError) throw new Error(`InfraTwin native WebMCP registration failed: ${state.registrationError}`);
    return state.tools;
  }, { timeout: 20_000 }).toEqual(expect.arrayContaining(['inspect_workspace', 'inspect_selection', 'add_plan_change', 'analyze_plan']));
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
  expect(registrationErrors, `Native registration emitted errors: ${registrationErrors.join(' | ')}`).toEqual([]);
});


async function importLevel4Reference(page: import('@playwright/test').Page) {
  await page.getByTestId('import-json').click();
  await page.getByRole('button', { name: 'Canonical JSON' }).click();
  await page.getByTestId('json-import-file').setInputFiles({
    name: 'level4a-replan-reference.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(createLevel4ReplanReference())),
  });
  await expect(page.getByTestId('import-review')).toBeVisible();
  await page.getByTestId('open-imported-network').click();
  await expect(page.getByTestId('topology-link-X')).toBeVisible();
  await page.getByText('Constraints', { exact: true }).click();
  await page.getByTestId('allow-routing-changes').check();
}

test('Level 4A native WebMCP replan — human protects X and native propose_mitigation returns verified Y alternative', async ({ page, browser }, testInfo) => {
  const registrationErrors = collectRegistrationErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('topology-canvas')).toBeVisible();
  await expect.poll(() => nativeToolNames(page), { timeout: 20_000 }).toEqual(expect.arrayContaining(['inspect_workspace', 'analyze_plan']));
  await importLevel4Reference(page);

  const baseline = await executeNative(page, 'analyze_plan') as Record<string, any>;
  expect(baseline.verdict).toBe('FAIL');
  await expect.poll(() => nativeToolNames(page), { timeout: 20_000 }).toEqual(expect.arrayContaining(['propose_mitigation']));
  const first = await executeNative(page, 'propose_mitigation') as Record<string, any>;
  expect(first.mode).toBe('capacity-only');
  expect(first.objective).toBe(5);
  await expect(page.getByTestId('candidate-proposals')).toContainText('X', { timeout: 30_000 });

  await page.getByTestId('topology-link-X').click();
  await page.getByTestId('lock-link-X').check();
  const locked = await executeNative(page, 'inspect_plan') as Record<string, any>;
  expect(locked.restrictions.lockedLinkIds).toContain('X');
  await executeNative(page, 'analyze_plan');
  await expect.poll(() => nativeToolNames(page), { timeout: 20_000 }).toEqual(expect.arrayContaining(['propose_mitigation']));
  const second = await executeNative(page, 'propose_mitigation') as Record<string, any>;
  expect(second.mode).toBe('adaptive-design');
  expect(second.objective).toBe(8);
  expect(second.verification).toBe('verified');
  await expect(page.getByTestId('candidate-proposals')).toContainText('Y', { timeout: 30_000 });
  await expect(page.getByTestId('candidate-proposals')).not.toContainText('Set X capacity');
  await expect(page.getByTestId('network-design-summary')).toContainText(/cost 8/i);

  const verification = await executeNative(page, 'verify_plan') as Record<string, any>;
  expect(verification.status).toBe('verified');
  expect(verification.adaptiveDesignVerification?.status).toBe('verified');

  const evaluation = {
    browserVersion: browser.version(), api: 'document.modelContext', native: true,
    sequence: [
      { phase: 'before-lock', proposal: first },
      { phase: 'human-lock', lockedLinkIds: locked.restrictions.lockedLinkIds },
      { phase: 'after-lock', proposal: second, verification },
    ],
  };
  const path = testInfo.outputPath('level4a-native-webmcp-replan.json');
  await writeFile(path, JSON.stringify(evaluation, null, 2));
  await testInfo.attach('level4a-native-webmcp-replan', { path, contentType: 'application/json' });
  expect(registrationErrors, `Native registration emitted errors: ${registrationErrors.join(' | ')}`).toEqual([]);
});
