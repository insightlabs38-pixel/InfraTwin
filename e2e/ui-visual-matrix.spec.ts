import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createLevel4ReplanReference } from '../packages/scenarios/src/index.ts';

async function attach(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

async function open(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await expect(page.getByTestId('network-view')).toBeVisible();
  await expect(page.getByTestId('topology-canvas')).toBeVisible();
}

async function expectTopologyChromeInsideViewport(page: Page, viewport: { width: number; height: number }) {
  const stage = page.locator('.topology-stage');
  const legend = page.locator('.topology-legend');
  await expect(stage).toBeVisible();
  await expect(legend).toBeVisible();
  const [stageBox, legendBox] = await Promise.all([stage.boundingBox(), legend.boundingBox()]);
  expect(stageBox).not.toBeNull();
  expect(legendBox).not.toBeNull();
  expect(stageBox!.height).toBeGreaterThan(120);
  expect(legendBox!.x).toBeGreaterThanOrEqual(-1);
  expect(legendBox!.x + legendBox!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(legendBox!.y + legendBox!.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function importLevel4Reference(page: Page) {
  await page.getByTestId('import-json').click();
  await page.getByRole('button', { name: 'Canonical JSON' }).click();
  await page.getByTestId('json-import-file').setInputFiles({
    name: 'level4a-replan-reference.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(createLevel4ReplanReference())),
  });
  await page.getByTestId('open-imported-network').click();
  await expect(page.getByTestId('topology-link-X')).toBeVisible();
  await page.getByTestId('plan-constraints').locator('summary').click();
  await page.getByTestId('allow-routing-changes').check();
  await page.getByTestId('plan-constraints').locator('summary').click();
}

test('visual matrix: clean product shell is coherent at every required viewport', async ({ page }, testInfo) => {
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 760, height: 900 },
  ];
  for (const viewport of viewports) {
    await open(page, viewport);
    await expectTopologyChromeInsideViewport(page, viewport);
    if (viewport.width <= 760) {
      await expect(page.locator('.plan-pane')).toHaveAttribute('aria-hidden', 'true');
      await expect(page.locator('.inspector-slot')).toHaveAttribute('aria-hidden', 'true');
    } else if (viewport.width <= 1024) {
      await expect(page.locator('.inspector-slot')).toHaveAttribute('aria-hidden', 'true');
    }
    await attach(page, testInfo, `ui-clean-${viewport.width}x${viewport.height}`);
    const dimensions = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      iw: window.innerWidth,
      ih: window.innerHeight,
    }));
    expect(dimensions.sw).toBeLessThanOrEqual(dimensions.iw + 2);
    expect(dimensions.sh).toBeLessThanOrEqual(dimensions.ih + 2);
  }
});

test('visual matrix: core decision states remain legible without defensive cropping', async ({ page }, testInfo) => {
  await open(page, { width: 1440, height: 900 });
  await page.getByTestId('network-selector').selectOption('maintenance-trap');
  await page.getByTestId('topology-link-L1').click();
  await attach(page, testInfo, 'ui-selected-link-not-analyzed');
  await page.getByTestId('plan-link-outage-L1').click();
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await attach(page, testInfo, 'ui-deterministic-failure');

  await page.getByTestId('nav-analysis').click();
  await attach(page, testInfo, 'ui-analysis-summary');
  await page.getByTestId('analysis-tab-violations').click();
  await attach(page, testInfo, 'ui-analysis-violations');
  await page.getByTestId('analysis-tab-evidence').click();
  await attach(page, testInfo, 'ui-analysis-evidence');

  await page.getByTestId('nav-plans').click();
  await attach(page, testInfo, 'ui-plans');
  await page.getByTestId('nav-settings').click();
  await attach(page, testInfo, 'ui-settings');
  await page.getByTestId('advanced-toggle').click();
  await attach(page, testInfo, 'ui-advanced');
  await page.keyboard.press('Escape');

  await page.getByTestId('import-json').click();
  await attach(page, testInfo, 'ui-import-dialog');
  await page.getByRole('button', { name: 'Close import dialog' }).click();
});

test('visual matrix: scale and narrow responsive surfaces stay product-grade', async ({ page }, testInfo) => {
  await open(page, { width: 1920, height: 1080 });
  await page.getByTestId('network-selector').selectOption('national-backbone-scale-test');
  await expect(page.getByTestId('network-scale')).toContainText('500');
  await attach(page, testInfo, 'ui-scale-500-node');

  await page.setViewportSize({ width: 760, height: 900 });
  await page.getByTestId('toggle-right-panel').click();
  await attach(page, testInfo, 'ui-narrow-inspector-drawer');
  await page.getByTestId('toggle-left-panel').click();
  await attach(page, testInfo, 'ui-narrow-plan-drawer');
});

test('visual matrix: proposal lifecycle makes stale, verified, and human-review states explicit', async ({ page }, testInfo) => {
  await open(page, { width: 1440, height: 900 });
  await importLevel4Reference(page);
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await page.getByTestId('run-optimizer').click();
  await expect(page.getByTestId('candidate-proposals')).toContainText('X', { timeout: 30_000 });
  await attach(page, testInfo, 'ui-proposal-awaiting-human-review');

  await page.getByTestId('topology-link-X').click();
  await page.getByTestId('lock-link-X').check();
  await expect(page.getByTestId('candidate-proposals')).toContainText(/stale/i);
  await attach(page, testInfo, 'ui-stale-proposal-after-human-lock');

  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await page.getByTestId('run-optimizer').click();
  await expect(page.getByTestId('network-design-summary')).toContainText(/verified/i, { timeout: 30_000 });
  await expect(page.getByTestId('network-design-summary')).toContainText(/Awaiting human review/i);
  await attach(page, testInfo, 'ui-verified-adaptive-proposal');

  await page.getByTestId('nav-analysis').click();
  await page.getByTestId('analysis-tab-evidence').click();
  await attach(page, testInfo, 'ui-reconstructed-verification');

  await page.getByTestId('nav-plans').click();
  await page.getByTestId('compare-design-variants').click();
  await expect(page.getByTestId('design-variant-table')).toBeVisible({ timeout: 30_000 });
  await attach(page, testInfo, 'ui-verified-alternatives');
});
