import { test, expect, type Page } from '@playwright/test';

async function openNetwork(page: Page, viewport = { width: 1440, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await expect(page.getByTestId('network-view')).toBeVisible();
  await expect(page.getByTestId('topology-canvas')).toBeVisible();
  await expect(page.getByTestId('change-plan-panel')).toBeVisible();
  await expect(page.getByTestId('object-inspector')).toBeVisible();
}

async function selectNetwork(page: Page, id: string) {
  await page.getByTestId('network-selector').selectOption(id);
  await expect(page.getByTestId('network-selector')).toHaveValue(id);
}


async function chooseSearchable(page: Page, testId: string, value: string) {
  const trigger = page.getByTestId(testId);
  await trigger.click();
  const control = trigger.locator('..');
  await control.getByRole('combobox').fill(value);
  await control.getByRole('option').filter({ hasText: value }).first().click();
}

async function semanticHashes(page: Page) {
  return {
    model: await page.getByTestId('base-model-hash').textContent(),
    plan: await page.getByTestId('plan-hash').textContent(),
  };
}

async function assertNoDocumentScroll(page: Page) {
  const dimensions = await page.evaluate(() => ({
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.innerHeight + 2);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth + 2);
}

test('Phase 3.5C.5 1: topology is above the fold and dominates standard desktop workspaces', async ({ page }, testInfo) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await openNetwork(page, viewport);
    const topology = await page.getByTestId('topology-pane').boundingBox();
    const plan = await page.getByTestId('change-plan-panel').boundingBox();
    const inspector = await page.getByTestId('object-inspector').boundingBox();
    expect(topology).not.toBeNull(); expect(plan).not.toBeNull(); expect(inspector).not.toBeNull();
    expect(topology!.y).toBeLessThan(viewport.height);
    expect(topology!.y + topology!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(topology!.width).toBeGreaterThan(plan!.width);
    expect(topology!.width).toBeGreaterThan(inspector!.width);
    expect(topology!.height).toBeGreaterThan(600);
    await assertNoDocumentScroll(page);
    const visibleNetworkText = await page.getByTestId('network-view').innerText();
    expect(visibleNetworkText).not.toMatch(/How it works|judge-ready|Level 3|hackathon/i);
    await testInfo.attach(`phase35c5-${viewport.width}x${viewport.height}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  }
});

test('Phase 3.5C.5 2: normal plan workflow stays in the application shell and survives Analysis navigation', async ({ page }) => {
  await openNetwork(page);
  await selectNetwork(page, 'maintenance-trap');
  const before = await semanticHashes(page);
  await page.getByTestId('topology-link-L1').click();
  await page.getByTestId('plan-link-outage-L1').click();
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await expect(page.getByTestId('evidence-panel')).toContainText('L3');
  const afterAnalysis = await semanticHashes(page);
  expect(afterAnalysis.model).toBe(before.model);
  await page.getByTestId('nav-analysis').click();
  await expect(page.getByTestId('analysis-view')).toBeVisible();
  await expect(page.getByTestId('analysis-summary')).toContainText('FAIL');
  await page.getByTestId('nav-network').click();
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  expect(await semanticHashes(page)).toEqual(afterAnalysis);
  await assertNoDocumentScroll(page);
});

test('Phase 3.5C.5 3: Network summary is concise while detailed violations and evidence live in Analysis', async ({ page }) => {
  await openNetwork(page);
  await selectNetwork(page, 'maintenance-trap');
  await page.getByTestId('nav-plans').click();
  await page.getByTestId('load-plan-template').click();
  await page.getByTestId('nav-network').click();
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('plan-analysis-status')).toContainText('FAIL');
  expect(await page.getByTestId('plan-analysis-status').locator('.violation').count()).toBe(0);
  await page.getByTestId('nav-analysis').click();
  await page.getByTestId('analysis-tab-violations').click();
  await expect(page.getByTestId('analysis-violations')).toContainText('L3');
  await page.getByTestId('analysis-tab-evidence').click();
  await expect(page.getByTestId('analysis-evidence')).toContainText(/Current|Evidence/i);
  expect(await page.getByTestId('analysis-view').locator('[data-testid="plan-analysis-status"]').count()).toBe(0);
});

test('Phase 3.5C.5 4: Settings/Model is separate from the ChangePlan and navigation preserves plan state', async ({ page }) => {
  await openNetwork(page);
  await selectNetwork(page, 'resilience-gap');
  await page.getByTestId('topology-link-R2').click();
  await page.getByTestId('plan-link-outage-R2').click();
  const before = await semanticHashes(page);
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-view')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Network model and assumptions' })).toBeVisible();
  await chooseSearchable(page, 'settings-upgrade-link', 'R4');
  await expect(page.getByTestId('upgrade-profile-editor')).toBeVisible();
  await page.getByTestId('nav-network').click();
  await expect(page.getByTestId('plan-change-list')).toContainText('Take R2 offline');
  expect(await semanticHashes(page)).toEqual(before);
});

test('Phase 3.5C.5 5: advanced diagnostics are hidden by default and disclosure is semantically inert', async ({ page }) => {
  await openNetwork(page);
  const before = await semanticHashes(page);
  await expect(page.getByTestId('advanced-drawer')).toBeHidden();
  await expect(page.getByTestId('base-model-hash')).toBeHidden();
  await expect(page.getByTestId('optimizer-status')).toBeHidden();
  await page.getByTestId('advanced-toggle').click();
  await expect(page.getByTestId('advanced-drawer')).toBeVisible();
  await expect(page.getByTestId('base-model-hash')).toBeVisible();
  await expect(page.getByTestId('advanced-inspector')).toContainText(/WebMCP diagnostics/i);
  await page.getByTestId('advanced-toggle').click();
  await expect(page.getByTestId('advanced-drawer')).toBeHidden();
  expect(await semanticHashes(page)).toEqual(before);

  await page.getByTestId('toggle-left-panel').click();
  await page.getByTestId('toggle-right-panel').click();
  expect(await semanticHashes(page)).toEqual(before);
  await page.getByTestId('toggle-left-panel').click();
  await page.getByTestId('toggle-right-panel').click();
});

test('Phase 3.5C.5 6: topology viewport and contextual selection survive destination switches', async ({ page }, testInfo) => {
  await openNetwork(page);
  await page.getByTestId('topology-search').fill('BB-SE-CE-01');
  await page.getByTestId('search-result-link-BB-SE-CE-01').click();
  await expect(page.getByTestId('object-inspector')).toContainText('BB-SE-CE-01');
  await page.getByTestId('zoom-in').click();
  const viewportBefore = await page.getByTestId('viewport-readout').textContent();
  const hashesBefore = await semanticHashes(page);
  await page.getByTestId('nav-analysis').click();
  await page.getByTestId('analysis-tab-routes').click();
  await page.getByTestId('nav-network').click();
  await expect(page.getByTestId('viewport-readout')).toHaveText(viewportBefore ?? '');
  await expect(page.getByTestId('object-inspector')).toContainText('BB-SE-CE-01');
  expect(await semanticHashes(page)).toEqual(hashesBefore);

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByTestId('topology-canvas')).toBeVisible();
  await assertNoDocumentScroll(page);
  await testInfo.attach('phase35c5-1024x768', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});
