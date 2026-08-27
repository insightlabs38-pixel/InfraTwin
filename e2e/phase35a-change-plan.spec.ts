import { test, expect } from '@playwright/test';

async function open(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByTestId('topology-canvas')).toBeVisible();
  await expect(page.getByTestId('change-plan-panel')).toBeVisible();
}

async function waitOptimizer(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('optimizer-status')).toContainText(/ready|HiGHS WASM/i, { timeout: 30_000 });
}

test('Phase 3.5A: human maintenance plan is non-destructive and reversible in the plan', async ({ page }) => {
  await open(page);
  await page.getByTestId('scenario-maintenance-trap').click();
  const baseHash = await page.getByTestId('base-model-hash').textContent();
  await page.getByTestId('topology-link-L1').click();
  await page.getByTestId('plan-link-outage-L1').click();
  await expect(page.getByTestId('plan-change-list')).toContainText('Take L1 offline');
  await expect(page.getByTestId('base-model-hash')).toHaveText(baseHash ?? '');

  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('plan-analysis-status')).toContainText('FAIL');
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await expect(page.getByTestId('evidence-panel')).toContainText('L3');
  await expect(page.getByTestId('evidence-panel')).toContainText(/120%/);

  await page.getByTestId('plan-link-outage-L1').click();
  await expect(page.getByTestId('plan-change-list')).not.toContainText('Take L1 offline');
  await expect(page.getByTestId('base-model-hash')).toHaveText(baseHash ?? '');
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('plan-analysis-status')).toContainText('PASS');
});

test('Phase 3.5A: human-created selected-demand growth reproduces Growth Wall without a special runGrowth path', async ({ page }) => {
  await open(page);
  await page.getByTestId('scenario-growth-wall').click();
  await page.getByText('Add demand growth', { exact: true }).click();
  await page.getByTestId('growth-all-demands').uncheck();
  await page.getByTestId('growth-demand-GD1').check();
  await page.getByTestId('growth-demand-GD2').check();
  await page.getByTestId('plan-growth-percent').fill('40');
  await page.getByTestId('add-growth-change').click();
  await expect(page.getByTestId('plan-change-list')).toContainText('GD1, GD2');
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await expect(page.getByTestId('evidence-panel')).toContainText('G2');
  await expect(page.getByTestId('run-growth')).toHaveCount(0);
});

test('Phase 3.5A: human restriction invalidates verified optimizer proposal and locked infeasibility is explicit', async ({ page }) => {
  await open(page);
  await page.getByTestId('scenario-resilience-gap').click();
  await page.getByTestId('topology-link-R2').click();
  await page.getByTestId('plan-link-outage-R2').click();
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await waitOptimizer(page);
  await page.getByTestId('run-optimizer').click();
  await expect(page.getByTestId('candidate-proposals')).toContainText('R4', { timeout: 30_000 });
  await expect(page.getByTestId('candidate-proposals')).toContainText('R5');
  await page.getByTestId('verify-candidate').click();
  await expect(page.getByTestId('candidate-verification')).toContainText('VERIFIED', { timeout: 20_000 });

  await page.getByTestId('topology-link-R4').click();
  await page.getByTestId('lock-link-R4').check();
  await expect(page.getByTestId('candidate-verification')).toContainText('STALE');
  await expect(page.getByTestId('proposal-R4')).toContainText(/stale/i);
  await page.getByTestId('run-optimizer').click();
  await expect(page.getByTestId('capacity-optimizer-result')).toContainText(/Infeasible/i, { timeout: 30_000 });
  await expect(page.getByTestId('optimizer-status')).toContainText(/locked/i);
});

test('Phase 3.5A: add a new service through UI and keep the base project unchanged', async ({ page }) => {
  await open(page);
  await page.getByTestId('scenario-growth-wall').click();
  const baseHash = await page.getByTestId('base-model-hash').textContent();
  await page.getByText('Add new service demand', { exact: true }).click();
  await page.getByTestId('new-demand-name').fill('Payments replication');
  await page.getByTestId('new-demand-source').selectOption('NYC');
  await page.getByTestId('new-demand-target').selectOption('SEA');
  await page.getByTestId('new-demand-bandwidth').fill('12');
  await page.getByTestId('new-demand-class').selectOption('gold');
  await page.getByTestId('add-new-demand').click();
  await expect(page.getByTestId('plan-change-list')).toContainText('Payments replication');
  await expect(page.getByTestId('base-model-hash')).toHaveText(baseHash ?? '');
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByText(/Payments replication/).last()).toBeVisible();
  await expect(page.getByTestId('base-model-hash')).toHaveText(baseHash ?? '');
});

test('Phase 3.5A: individual candidate accept/reject is visible, preserves provenance, and invalidates verification', async ({ page }) => {
  await open(page);
  await page.getByTestId('scenario-resilience-gap').click();
  await page.getByTestId('topology-link-R2').click();
  await page.getByTestId('plan-link-outage-R2').click();
  await page.getByTestId('analyze-plan').click();
  await waitOptimizer(page);
  await page.getByTestId('run-optimizer').click();
  await expect(page.getByTestId('proposal-R4')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('proposal-R5')).toBeVisible();
  await page.getByTestId('verify-candidate').click();
  await expect(page.getByTestId('candidate-verification')).toContainText('VERIFIED', { timeout: 20_000 });

  await page.getByTestId('proposal-R4').getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByTestId('candidate-verification')).toContainText('STALE');
  await page.getByTestId('proposal-R5').getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByTestId('plan-change-list')).toContainText('Set R4 capacity to 14 Gbps');
  await expect(page.getByTestId('plan-change-list')).toContainText('Agent/optimizer proposal accepted by human');
  await expect(page.getByTestId('plan-change-list')).not.toContainText('Set R5 capacity to 14 Gbps');
  await expect(page.getByTestId('plan-history')).toContainText('Optimizer proposed 2 changes');
  await expect(page.getByTestId('plan-history')).toContainText('Accepted Set R4 capacity to 14 Gbps');
  await expect(page.getByTestId('plan-history')).toContainText('Rejected Set R5 capacity to 14 Gbps');
});
