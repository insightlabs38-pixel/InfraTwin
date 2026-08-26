import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

async function openWorkbench(page: Page) {
  const hydrationErrors: string[] = [];
  const onPageError = (error: Error) => {
    if (/hydration failed/i.test(error.message)) hydrationErrors.push(error.message);
  };
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === 'error' && /hydration failed/i.test(message.text())) hydrationErrors.push(message.text());
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  await page.goto('/');
  await expect(page.getByTestId('topology-canvas')).toBeVisible();
  await expect(page.getByTestId('analysis-journey')).toBeVisible();
  await page.waitForTimeout(150);
  expect(hydrationErrors).toEqual([]);
  page.off('pageerror', onPageError);
  page.off('console', onConsole);
}

async function waitForOptimizer(page: Page) {
  await expect(page.getByTestId('optimizer-status')).toContainText(/ready|HiGHS WASM/i, { timeout: 30_000 });
}

function modelIdentity(value: string | null): string {
  return (value ?? '').split(' / ')[0].trim();
}

function largeCancellationProject() {
  const nodeCount = 480;
  return {
    schemaVersion: '0.1' as const,
    id: 'e2e-cancellation-network',
    name: 'E2E Cancellation Network',
    nodes: Array.from({ length: nodeCount }, (_, index) => ({
      id: `N${index}`,
      name: `Node ${index}`,
      x: 40 + (index % 20) * 30,
      y: 40 + Math.floor(index / 20) * 18,
    })),
    links: Array.from({ length: nodeCount - 1 }, (_, index) => ({
      id: `E${index}`,
      source: `N${index}`,
      target: `N${index + 1}`,
      bidirectional: true,
      capacityGbps: 10,
      weight: 1,
      available: true,
    })),
    demands: [{ id: 'D1', name: 'Long-haul demand', source: 'N0', target: `N${nodeCount - 1}`, bandwidthGbps: 5, serviceClassId: 'gold' }],
    serviceClasses: [{ id: 'gold', name: 'Gold', priority: 100, maxUtilizationPct: 100, allowShedding: false }],
    routingProfile: { mode: 'single-shortest-path' as const },
    metadata: { description: 'Synthetic browser-only cancellation fixture.', ui: { fixture: true } },
  };
}

test('Maintenance Trap: baseline → maintenance FAIL → reset baseline', async ({ page }) => {
  await openWorkbench(page);
  await page.getByTestId('scenario-maintenance-trap').click();
  await page.getByTestId('run-baseline').click();
  await expect(page.getByTestId('verdict')).toHaveText('PASS');

  await page.getByTestId('run-maintenance').click();
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await expect(page.getByTestId('evidence-panel')).toContainText('L3');
  await expect(page.getByTestId('evidence-panel')).toContainText(/120%/);

  await page.getByTestId('reset-demo').click();
  await expect(page.getByTestId('verdict')).toHaveText('PASS');
  await expect(page.getByTestId('analysis-journey')).toContainText('Baseline');
});

test('Growth Wall: +40% → minimum-cost G2 candidate → verify → apply → exact semantic undo', async ({ page }) => {
  await openWorkbench(page);
  await page.getByTestId('scenario-growth-wall').click();
  await expect(page.getByTestId('verdict')).toHaveText('PASS');
  const originalSemanticIdentity = await page.getByTestId('semantic-model-hash').textContent();
  const originalModelIdentity = modelIdentity(originalSemanticIdentity);

  await page.getByTestId('run-growth').click();
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await expect(page.getByTestId('growth-evidence')).toContainText(/G2/);
  await expect(page.getByTestId('growth-evidence')).toContainText(/1.35/);
  const growthScenarioIdentity = await page.getByTestId('semantic-model-hash').textContent();
  expect(modelIdentity(growthScenarioIdentity)).toBe(originalModelIdentity);

  await waitForOptimizer(page);
  await page.getByTestId('run-optimizer').click();
  await expect(page.getByTestId('candidate-card')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('candidate-card')).toContainText('G2');
  await expect(page.getByTestId('candidate-card')).toContainText('22 Gbps');
  await expect(page.getByTestId('candidate-card')).toContainText(/6 cost-units/);

  await page.getByTestId('verify-candidate').click();
  await expect(page.getByTestId('candidate-verification')).toContainText('VERIFIED', { timeout: 20_000 });
  await expect(page.getByTestId('semantic-model-hash')).toHaveText(growthScenarioIdentity ?? '');

  await page.getByTestId('apply-candidate').click();
  await expect(page.getByTestId('undo-candidate')).toBeVisible();
  const appliedIdentity = await page.getByTestId('semantic-model-hash').textContent();
  expect(modelIdentity(appliedIdentity)).not.toBe(originalModelIdentity);

  await page.getByTestId('undo-candidate').click();
  await expect(page.getByTestId('semantic-model-hash')).toHaveText(growthScenarioIdentity ?? '');
  expect(modelIdentity(await page.getByTestId('semantic-model-hash').textContent())).toBe(originalModelIdentity);
});

test('Resilience Gap: rank R2 → explicit replay → R4/R5 optimizer candidate stays unapplied until approval', async ({ page }) => {
  await openWorkbench(page);
  await page.getByTestId('scenario-resilience-gap').click();
  await expect(page.getByTestId('verdict')).toHaveText('PASS');
  const baselineSemanticIdentity = await page.getByTestId('semantic-model-hash').textContent();

  await page.getByTestId('run-resilience').click();
  await expect(page.getByTestId('resilience-status')).toContainText('complete', { timeout: 30_000 });
  await expect(page.getByTestId('contingency-list')).toBeVisible();
  await expect(page.getByTestId('counterexample-R2')).toContainText('#1 · R2');
  await expect(page.getByTestId('verdict')).toHaveText('PASS', { timeout: 5_000 });

  await page.getByTestId('counterexample-R2').click();
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await expect(page.getByTestId('evidence-panel')).toContainText('R4');
  await expect(page.getByTestId('evidence-panel')).toContainText('R5');
  const replayIdentity = await page.getByTestId('semantic-model-hash').textContent();
  expect(modelIdentity(replayIdentity)).toBe(modelIdentity(baselineSemanticIdentity));

  await waitForOptimizer(page);
  await page.getByTestId('run-optimizer').click();
  await expect(page.getByTestId('candidate-card')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('candidate-card')).toContainText('R4');
  await expect(page.getByTestId('candidate-card')).toContainText('R5');
  await expect(page.getByTestId('candidate-card')).toContainText('14 Gbps');
  await expect(page.getByTestId('candidate-card')).toContainText(/8 cost-units/);
  await page.getByTestId('verify-candidate').click();
  await expect(page.getByTestId('candidate-verification')).toContainText('VERIFIED', { timeout: 20_000 });
  await expect(page.getByTestId('semantic-model-hash')).toHaveText(replayIdentity ?? '');
  await expect(page.getByTestId('undo-candidate')).toHaveCount(0);
});

test('import/export round-trip and imported reset remain browser-local', async ({ page }, testInfo) => {
  await openWorkbench(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-json').click(),
  ]);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const exported = JSON.parse(await readFile(downloadPath!, 'utf8')) as Record<string, unknown>;
  expect(exported.id).toBe('maintenance-trap-l1');

  exported.name = 'Imported E2E Network';
  exported.metadata = { ...(exported.metadata as Record<string, unknown>), ui: { selectedPane: 'ignored-by-semantic-hash' } };
  const importPath = testInfo.outputPath('imported-project.json');
  await writeFile(importPath, JSON.stringify(exported));
  await page.getByTestId('import-file').setInputFiles(importPath);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Imported E2E Network');
  await expect(page.getByTestId('verdict')).toHaveText('PASS');
  await page.getByTestId('reset-demo').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Imported E2E Network');
});

test('cancellation, reset, and scenario switching prevent stale N-1 publication', async ({ page }, testInfo) => {
  await openWorkbench(page);
  const importPath = testInfo.outputPath('large-project.json');
  await writeFile(importPath, JSON.stringify(largeCancellationProject()));
  await page.getByTestId('import-file').setInputFiles(importPath);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E Cancellation Network');

  await page.getByTestId('run-resilience').click();
  await expect(page.getByTestId('cancel-resilience')).toBeVisible();
  await page.getByTestId('cancel-resilience').click();
  await expect(page.getByTestId('resilience-status')).toContainText('cancelled', { timeout: 15_000 });
  await expect(page.getByTestId('contingency-list')).toHaveCount(0);

  await page.getByTestId('run-resilience').click();
  await expect(page.getByTestId('cancel-resilience')).toBeVisible();
  await page.getByTestId('reset-demo').click();
  await expect(page.getByTestId('resilience-status')).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(page.getByTestId('contingency-list')).toHaveCount(0);

  await page.getByTestId('run-resilience').click();
  await expect(page.getByTestId('cancel-resilience')).toBeVisible();
  await page.getByTestId('scenario-maintenance-trap').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Maintenance Trap');
  await page.waitForTimeout(500);
  await expect(page.getByTestId('contingency-list')).toHaveCount(0);
  await expect(page.getByTestId('verdict')).toHaveText('PASS');
});

test('optimizer WASM worker loads and desktop/narrow layouts keep the topology usable', async ({ page }, testInfo) => {
  await openWorkbench(page);
  await waitForOptimizer(page);
  await expect(page.getByTestId('optimizer-status')).toContainText(/HiGHS WASM/);

  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(page.getByTestId('topology-canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const desktop = await page.screenshot({ fullPage: true });
  await testInfo.attach('desktop-hardening', { body: desktop, contentType: 'image/png' });

  await page.setViewportSize({ width: 760, height: 900 });
  await expect(page.getByTestId('topology-canvas')).toBeVisible();
  await expect(page.getByTestId('scenario-maintenance-trap')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const narrow = await page.screenshot({ fullPage: true });
  await testInfo.attach('narrow-hardening', { body: narrow, contentType: 'image/png' });
});
