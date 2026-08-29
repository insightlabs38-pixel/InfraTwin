import { expect, type Page } from '@playwright/test';

export interface HarnessSnapshot {
  active: string[];
  definitions: Record<string, { readOnlyHint: boolean | null; untrustedContentHint: boolean | null; description: string }>;
  events: Array<{ type: 'register' | 'revoke' | 'toolchange'; name?: string }>;
  calls: Array<{ name: string; status: 'started' | 'success' | 'error' | 'cancelled'; error?: string }>;
}

export async function installModelContextHarness(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Tool = { name: string; title?: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }; execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => unknown | Promise<unknown> };
    const state = {
      tools: new Map<string, Tool>(),
      events: [] as Array<{ type: 'register' | 'revoke' | 'toolchange'; name?: string }>,
      calls: [] as Array<{ name: string; status: 'started' | 'success' | 'error' | 'cancelled'; error?: string }>,
    };
    const target = new EventTarget();
    const emitToolchange = () => { state.events.push({ type: 'toolchange' }); target.dispatchEvent(new Event('toolchange')); };
    const modelContext = {
      registerTool(tool: Tool, options?: { signal?: AbortSignal }) {
        state.tools.set(tool.name, tool); state.events.push({ type: 'register', name: tool.name }); emitToolchange();
        const revoke = () => { if (state.tools.get(tool.name) === tool) state.tools.delete(tool.name); state.events.push({ type: 'revoke', name: tool.name }); emitToolchange(); };
        if (options?.signal?.aborted) revoke(); else options?.signal?.addEventListener('abort', revoke, { once: true });
      },
      async getTools() {
        return [...state.tools.values()].map((tool) => ({ name: tool.name, title: tool.title, description: tool.description ?? '', inputSchema: tool.inputSchema ?? {}, annotations: tool.annotations ?? {} }));
      },
      async executeTool(tool: { name: string } | string, input: string, options?: { signal?: AbortSignal }) {
        const name = typeof tool === 'string' ? tool : tool.name;
        const registered = state.tools.get(name); if (!registered) throw new Error(`Harness tool ${name} is not registered`);
        return registered.execute(JSON.parse(input || '{}') as Record<string, unknown>, options);
      },
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) { target.addEventListener(type, listener); },
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject) { target.removeEventListener(type, listener); },
    };
    Object.defineProperty(document, 'modelContext', { configurable: true, value: modelContext });
    Object.defineProperty(window, '__webmcpHarness', { configurable: true, value: {
      snapshot() {
        const definitions: Record<string, { readOnlyHint: boolean | null; untrustedContentHint: boolean | null; description: string }> = {};
        for (const [name, tool] of state.tools) definitions[name] = { readOnlyHint: tool.annotations?.readOnlyHint ?? null, untrustedContentHint: tool.annotations?.untrustedContentHint ?? null, description: tool.description ?? '' };
        return { active: [...state.tools.keys()].sort(), definitions, events: [...state.events], calls: [...state.calls] };
      },
      async execute(name: string, input: Record<string, unknown> = {}, cancelAfterMs?: number) {
        const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
        state.calls.push({ name, status: 'started' }); if (cancelAfterMs !== undefined) timer = setTimeout(() => controller.abort(), Math.max(0, cancelAfterMs));
        try { const tool = (await modelContext.getTools()).find((item) => item.name === name); if (!tool) throw new Error(`Harness tool ${name} is not registered`); const result = await modelContext.executeTool(tool, JSON.stringify(input), { signal: controller.signal }); state.calls.push({ name, status: controller.signal.aborted ? 'cancelled' : 'success' }); return { ok: true, cancelled: controller.signal.aborted, result }; }
        catch (error) { const message = error instanceof Error ? error.message : String(error); const cancelled = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError'); state.calls.push({ name, status: cancelled ? 'cancelled' : 'error', error: message }); return { ok: false, cancelled, error: message }; }
        finally { if (timer !== undefined) clearTimeout(timer); }
      },
    } });
  });
}

export async function openHarnessedWorkbench(page: Page): Promise<void> { await installModelContextHarness(page); await page.goto('/'); await expect(page.getByTestId('topology-canvas')).toBeVisible(); await expect(page.getByTestId('application-shell')).toBeVisible(); }
export async function selectNetwork(page: Page, id: string): Promise<void> { await page.getByTestId('network-selector').selectOption(id); await expect(page.getByTestId('network-selector')).toHaveValue(id); }
export async function loadTemplate(page: Page): Promise<void> { await page.getByTestId('nav-plans').click(); await page.getByTestId('load-plan-template').click(); await page.getByTestId('nav-network').click(); }
export async function snapshot(page: Page): Promise<HarnessSnapshot> { return page.evaluate(() => (window as any).__webmcpHarness.snapshot()); }
export async function executeTool(page: Page, name: string, input: Record<string, unknown> = {}, cancelAfterMs?: number): Promise<{ ok: boolean; cancelled: boolean; result?: any; error?: string }> { return page.evaluate(({ name, input, cancelAfterMs }) => (window as any).__webmcpHarness.execute(name, input, cancelAfterMs), { name, input, cancelAfterMs }); }
export async function expectActive(page: Page, names: string[]): Promise<void> { await expect.poll(async () => (await snapshot(page)).active, { timeout: 30_000 }).toEqual(expect.arrayContaining(names)); }
export async function expectInactive(page: Page, names: string[]): Promise<void> { await expect.poll(async () => { const active=(await snapshot(page)).active; return names.filter((name)=>active.includes(name)); }, { timeout: 20_000 }).toEqual([]); }
