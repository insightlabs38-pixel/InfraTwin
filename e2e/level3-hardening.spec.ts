import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

async function openWorkbench(page: Page) {
  const hydrationErrors: string[] = [];
  const onPageError = (error: Error) => { if (/hydration failed/i.test(error.message)) hydrationErrors.push(error.message); };
  const onConsole = (message: ConsoleMessage) => { if (message.type() === 'error' && /hydration failed/i.test(message.text())) hydrationErrors.push(message.text()); };
  page.on('pageerror', onPageError); page.on('console', onConsole); await page.goto('/');
  await expect(page.getByTestId('topology-canvas')).toBeVisible(); await expect(page.getByTestId('application-shell')).toBeVisible(); await page.waitForTimeout(150); expect(hydrationErrors).toEqual([]);
  page.off('pageerror', onPageError); page.off('console', onConsole);
}
async function selectNetwork(page: Page, id: string) { await page.getByTestId('network-selector').selectOption(id); await expect(page.getByTestId('network-selector')).toHaveValue(id); }
async function loadTemplate(page: Page) { await page.getByTestId('nav-plans').click(); await page.getByTestId('load-plan-template').click(); await page.getByTestId('nav-network').click(); }
async function waitForOptimizer(page: Page) { await expect(page.getByTestId('optimizer-status')).toContainText(/ready|HiGHS WASM/i, { timeout: 30_000 }); }

async function importJsonThroughReview(page: Page, path: string): Promise<void> {
  await page.getByTestId('import-json').click();
  await page.getByRole('button', { name: 'Canonical JSON' }).click();
  await page.getByTestId('json-import-file').setInputFiles(path);
  await expect(page.getByTestId('import-review')).toBeVisible();
  await page.getByTestId('open-imported-network').click();
}
function largeCancellationProject() {
  const nodeCount = 480;
  return { schemaVersion: '0.1' as const, id: 'e2e-cancellation-network', name: 'E2E Cancellation Network', nodes: Array.from({ length: nodeCount }, (_, index) => ({ id: `N${index}`, name: `Node ${index}`, x: 40 + (index % 20) * 30, y: 40 + Math.floor(index / 20) * 18 })), links: Array.from({ length: nodeCount - 1 }, (_, index) => ({ id: `E${index}`, source: `N${index}`, target: `N${index + 1}`, bidirectional: true, capacityGbps: 10, weight: 1, available: true })), demands: [{ id: 'D1', name: 'Long-haul demand', source: 'N0', target: `N${nodeCount - 1}`, bandwidthGbps: 5, serviceClassId: 'gold' }], serviceClasses: [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 100, allowShedding: false }], routingProfile: { mode: 'single-shortest-path' as const }, metadata: { description: 'Synthetic browser-only cancellation fixture.' } };
}

test('Maintenance Trap template uses the same Change Plan path and can return to baseline', async ({ page }) => {
  await openWorkbench(page); await selectNetwork(page, 'maintenance-trap'); await loadTemplate(page);
  await expect(page.getByTestId('plan-change-list')).toContainText('Take L1 offline'); await page.getByTestId('analyze-plan').click(); await expect(page.getByTestId('verdict')).toHaveText('FAIL'); await expect(page.getByTestId('evidence-panel')).toContainText('L3');
  await page.getByTestId('topology-link-L1').click(); await page.getByTestId('plan-link-outage-L1').click(); await page.getByTestId('analyze-plan').click(); await expect(page.getByTestId('verdict')).toHaveText('PASS');
});

test('Growth Wall template produces minimum-cost G2 proposal without applying base changes', async ({ page }) => {
  await openWorkbench(page); await selectNetwork(page, 'growth-wall'); const baseHash = await page.getByTestId('base-model-hash').textContent(); await loadTemplate(page); await page.getByTestId('analyze-plan').click(); await expect(page.getByTestId('verdict')).toHaveText('FAIL'); await expect(page.getByTestId('evidence-panel')).toContainText('G2');
  await waitForOptimizer(page); await page.getByTestId('run-optimizer').click(); await expect(page.getByTestId('proposal-G2')).toContainText('22 Gbps', { timeout: 30_000 }); await page.getByTestId('verify-candidate').click(); await expect(page.getByTestId('candidate-verification')).toContainText('VERIFIED', { timeout: 20_000 }); await expect(page.getByTestId('base-model-hash')).toHaveText(baseHash ?? '');
});

test('Resilience Gap N-1 ranks R2 and replay is explicit while optimizer proposal stays inside plan', async ({ page }) => {
  await openWorkbench(page); await selectNetwork(page, 'resilience-gap'); await page.getByTestId('run-resilience').click(); await expect(page.getByTestId('resilience-status')).toContainText('complete', { timeout: 30_000 }); await page.getByTestId('nav-analysis').click(); await page.getByTestId('analysis-tab-contingencies').click(); await expect(page.getByTestId('counterexample-R2')).toContainText('#1 · R2');
  await page.getByTestId('counterexample-R2').click(); await expect(page.getByTestId('evidence-panel')).toContainText('R4'); await expect(page.getByTestId('evidence-panel')).toContainText('R5'); await page.getByTestId('return-to-plan').click();
  await page.getByTestId('topology-link-R2').click(); await page.getByTestId('plan-link-outage-R2').click(); await page.getByTestId('analyze-plan').click(); await waitForOptimizer(page); await page.getByTestId('run-optimizer').click(); await expect(page.getByTestId('candidate-proposals')).toContainText('R4', { timeout: 30_000 }); await expect(page.getByTestId('candidate-proposals')).toContainText('R5'); await page.getByTestId('advanced-toggle').click(); await expect(page.getByTestId('base-model-hash')).toBeVisible();
});

test('import/export base round-trip and imported Change Plan remain browser-local', async ({ page }, testInfo) => {
  await openWorkbench(page); await selectNetwork(page, 'maintenance-trap'); const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]); const path = await download.path(); expect(path).toBeTruthy(); const exported = JSON.parse(await readFile(path!, 'utf8')) as Record<string, unknown>; expect(exported.id).toBe('maintenance-trap-l1');
  exported.name = 'Imported E2E Network'; const importPath = testInfo.outputPath('imported-project.json'); await writeFile(importPath, JSON.stringify(exported)); await importJsonThroughReview(page, importPath); await expect(page.getByRole('heading', { level: 1 })).toContainText('Imported E2E Network'); await expect(page.getByTestId('verdict')).toHaveText('DRAFT'); await page.getByTestId('analyze-plan').click(); await expect(page.getByTestId('verdict')).toHaveText('PASS');
});

test('cancellation and plan/network switching prevent stale N-1 publication', async ({ page }, testInfo) => {
  await openWorkbench(page); const importPath = testInfo.outputPath('large-project.json'); await writeFile(importPath, JSON.stringify(largeCancellationProject())); await importJsonThroughReview(page, importPath); await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E Cancellation Network');
  await page.getByTestId('run-resilience').click(); await expect(page.getByTestId('cancel-resilience')).toBeVisible(); await page.getByTestId('cancel-resilience').click(); await expect(page.getByTestId('resilience-status')).toContainText(/cancelled|complete/i, { timeout: 15_000 }); const firstOutcome = await page.getByTestId('resilience-status').innerText(); if (/cancelled/i.test(firstOutcome)) await expect(page.getByTestId('contingency-list')).toHaveCount(0);
  await page.getByTestId('run-resilience').click(); await expect(page.getByTestId('cancel-resilience')).toBeVisible(); await page.getByTestId('nav-plans').click(); await page.getByTestId('new-plan').click(); await expect(page.getByRole('alertdialog')).toBeVisible(); await page.getByRole('button', { name: 'Start new plan' }).click(); await page.getByTestId('nav-network').click(); await page.waitForTimeout(500); await expect(page.getByTestId('contingency-list')).toHaveCount(0);
  await page.getByTestId('run-resilience').click(); await expect(page.getByTestId('cancel-resilience')).toBeVisible(); await selectNetwork(page, 'maintenance-trap'); await page.waitForTimeout(500); await expect(page.getByTestId('contingency-list')).toHaveCount(0); await expect(page.getByTestId('verdict')).toHaveText('DRAFT');
});

test('optimizer WASM loads and desktop/narrow collaborative layouts keep topology usable', async ({ page }, testInfo) => {
  await openWorkbench(page); await waitForOptimizer(page); await expect(page.getByTestId('optimizer-status')).toContainText(/HiGHS WASM/);
  await page.setViewportSize({ width: 1440, height: 960 }); await expect(page.getByTestId('topology-canvas')).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true); await testInfo.attach('desktop-phase35a', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await page.setViewportSize({ width: 760, height: 900 }); await expect(page.getByTestId('topology-canvas')).toBeVisible(); await expect(page.getByTestId('change-plan-panel')).toBeHidden(); await expect(page.getByTestId('object-inspector')).toBeHidden(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true); await testInfo.attach('narrow-phase35a', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});
