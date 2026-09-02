import { test, expect, type Page } from '@playwright/test';

async function open(page: Page, viewport = { width: 1440, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await expect(page.getByTestId('network-view')).toBeVisible();
}

async function addMaintenanceOutage(page: Page) {
  await page.getByTestId('network-selector').selectOption('maintenance-trap');
  await page.getByTestId('topology-link-L1').click();
  await page.getByTestId('plan-link-outage-L1').click();
  await expect(page.getByTestId('plan-change-list')).toContainText('Take L1 offline');
}

test('UI hardening: unanalyzed engineering values are never presented as zero evidence and disabled actions explain why', async ({ page }) => {
  await open(page);
  await page.getByTestId('network-selector').selectOption('national-backbone-scale-test');
  await page.getByTestId('topology-search').fill('l-00000');
  await page.getByTestId('search-result-link-l-00000').click();
  const inspector = page.getByTestId('link-inspector-l-00000');
  await expect(inspector).toContainText('Not analyzed');
  await expect(inspector).not.toContainText(/Utilization\s*0%/i);
  await expect(page.getByTestId('run-optimizer')).toBeDisabled();
  await expect(page.getByTestId('run-optimizer')).toHaveAttribute('title', /Analyze a failing plan first|analysis/i);
  await expect(page.getByTestId('workflow-guidance')).toContainText(/planned change|analy/i);
});

test('UI hardening: meaningful work is protected from destructive network replacement', async ({ page }) => {
  await open(page);
  await addMaintenanceOutage(page);
  await page.getByTestId('network-selector').selectOption('growth-wall');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.getByRole('alertdialog')).toContainText(/planned change/i);
  await expect(page.getByTestId('network-selector')).toHaveValue('maintenance-trap');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(page.getByTestId('plan-change-list')).toContainText('Take L1 offline');
});

test('UI hardening: browser-local draft can be recovered after refresh', async ({ page }) => {
  await open(page);
  await addMaintenanceOutage(page);
  await expect.poll(async () => page.evaluate(() => Boolean(localStorage.getItem('infratwin.workspaceDraft.v1')))).toBe(true);
  await page.reload();
  await expect(page.getByTestId('draft-recovery-banner')).toBeVisible();
  await page.getByTestId('resume-local-draft').click();
  await expect(page.getByTestId('draft-recovery-banner')).toBeHidden();
  await expect(page.getByTestId('network-selector')).toHaveValue('maintenance-trap');
  await expect(page.getByTestId('plan-change-list')).toContainText('Take L1 offline');
});

test('UI hardening: object-valued constraints render human-readable Activity copy', async ({ page }) => {
  await open(page);
  await page.getByTestId('plan-constraints').locator('summary').click();
  await page.getByTestId('allow-routing-changes').check();
  await page.getByTestId('nav-plans').click();
  await expect(page.getByTestId('plan-history')).toContainText(/capacity upgrades, routing changes/i);
  await expect(page.getByTestId('plan-history')).not.toContainText('[object Object]');
});

test('UI hardening: Advanced exposes product-facing diagnostics without internal milestone language', async ({ page }) => {
  await open(page);
  await page.getByTestId('advanced-toggle').click();
  const drawer = page.getByTestId('advanced-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(/WebMCP diagnostics/i);
  await expect(drawer).not.toContainText(/Phase 3\.5|M3\.5|NOT RECOMMENDED/i);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page.getByTestId('advanced-toggle')).toBeFocused();
});

test('UI hardening: responsive navigation stays understandable and only one side drawer overlays the topology', async ({ page }) => {
  await open(page, { width: 760, height: 900 });
  await expect(page.getByTestId('nav-network')).toHaveAttribute('aria-label', 'Network');
  await expect(page.getByTestId('nav-analysis')).toHaveAttribute('aria-label', 'Analysis');
  await expect(page.getByTestId('topology-canvas')).toBeVisible();
  await page.getByTestId('toggle-right-panel').click();
  await expect(page.getByTestId('object-inspector')).toBeVisible();
  await expect(page.getByTestId('change-plan-panel')).toBeHidden();
  await page.getByTestId('toggle-left-panel').click();
  await expect(page.getByTestId('change-plan-panel')).toBeVisible();
  await expect(page.getByTestId('object-inspector')).toBeHidden();
});

test('UI hardening: main workflows do not emit controlled/uncontrolled React warnings', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/controlled input to be uncontrolled|uncontrolled input to be controlled/i.test(text)) warnings.push(text);
  });
  await open(page);
  await page.getByTestId('network-selector').selectOption('national-backbone-scale-test');
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('plan-analysis-status')).toContainText(/PASS|FAIL/, { timeout: 20_000 });
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-upgrade-link').click();
  const control = page.getByTestId('settings-upgrade-link').locator('..');
  await control.getByRole('combobox').fill('l-00000');
  const option = control.getByRole('option').first();
  if (await option.count()) await option.click();
  await page.getByTestId('nav-network').click();
  expect(warnings).toEqual([]);
});
