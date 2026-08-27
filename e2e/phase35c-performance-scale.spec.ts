import { test, expect, type Page } from '@playwright/test';
import { generateScaleProject } from '../packages/scenarios/src/scale-generator.ts';

async function openScaleProof(page: Page) {
  await page.goto('/');
  await page.getByTestId('scenario-national-backbone-scale-test').click();
  await expect(page.getByTestId('network-scale')).toContainText('500');
  await expect(page.getByTestId('network-scale')).toContainText('1200');
  await expect(page.getByTestId('network-scale')).toContainText('400');
  await expect(page.getByTestId('network-scale')).toContainText('12');
  await expect(page.getByTestId('topology-workspace')).toBeVisible();
}

async function importWorkerScale(page: Page) {
  const project = generateScaleProject({
    id: 'C', name: 'worker-e2e', nodes: 500, links: 1200, demands: 400, regions: 12,
    seed: 3587, routingMode: 'ecmp', workload: 'unique-sources', sourceConcentration: 500, upgradeOptionDensity: 0.25,
  });
  await page.getByTestId('import-json').click();
  await page.getByTestId('json-import-file').setInputFiles({
    name: 'phase35c-worker-scale.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByTestId('import-review')).toContainText('500');
  await page.getByTestId('open-imported-network').click();
  await expect(page.getByTestId('network-scale')).toContainText('500');
  await expect(page.getByTestId('compute-profile')).toContainText('Worker preferred');
  return project;
}

async function chooseLink(page: Page, linkId: string) {
  await page.getByTestId('topology-search').fill(linkId);
  await page.getByTestId(`search-result-link-${linkId}`).click();
}

test('Phase 3.5C 1: 500-node scale proof loads and topology navigation remains usable', async ({ page }) => {
  await openScaleProof(page);
  await page.getByTestId('fit-network').click();
  const before = await page.getByTestId('viewport-readout').textContent();
  await page.getByTestId('zoom-in').click();
  await expect(page.getByTestId('viewport-readout')).not.toHaveText(before ?? '');
  await page.getByTestId('topology-search').fill('n-0000');
  await page.getByTestId('search-result-node-n-0000').click();
  await expect(page.getByTestId('object-inspector')).toContainText('n-0000');
  await page.getByTestId('fit-selection').click();
  await expect(page.getByTestId('topology-workspace')).toBeVisible();
});

test('Phase 3.5C 2: Worker-scale baseline analysis stays interactive and publishes measured result', async ({ page }) => {
  await page.goto('/');
  await importWorkerScale(page);
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('capacity-analysis-status')).toContainText(/RUNNING.*worker/i, { timeout: 5_000 });
  const before = await page.getByTestId('viewport-readout').textContent();
  await page.getByTestId('zoom-in').click();
  await expect(page.getByTestId('viewport-readout')).not.toHaveText(before ?? '');
  await expect(page.getByTestId('capacity-analysis-status')).toContainText(/COMPLETE.*worker/i, { timeout: 30_000 });
  await expect(page.getByTestId('capacity-analysis-status')).toContainText(/ms measured on this browser run/i);
  await expect(page.getByTestId('plan-analysis-status')).toContainText(/PASS|FAIL/);
});

test('Phase 3.5C 3: stale Worker result cannot become authoritative after ChangePlan edit', async ({ page }) => {
  await page.goto('/');
  await importWorkerScale(page);
  await chooseLink(page, 'l-00000');
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('capacity-analysis-status')).toContainText(/RUNNING.*worker/i, { timeout: 5_000 });
  await page.getByTestId('plan-link-outage-l-00000').click();
  await expect(page.getByTestId('plan-change-list')).toContainText('l-00000');
  await expect(page.getByTestId('header-verdict')).toHaveText('DRAFT');
  await expect(page.getByTestId('plan-analysis-status')).toHaveCount(0);
  await page.waitForTimeout(750);
  await expect(page.getByTestId('header-verdict')).toHaveText('DRAFT');
});

test('Phase 3.5C 4: 500-node scale proof reports bounded N-1 as partial coverage', async ({ page }) => {
  test.setTimeout(75_000);
  await openScaleProof(page);
  await page.getByTestId('run-resilience').click();
  await expect(page.getByTestId('resilience-status')).toContainText(/running/i, { timeout: 5_000 });
  await expect(page.getByTestId('resilience-status')).toContainText(/partial/i, { timeout: 45_000 });
  await expect(page.getByTestId('resilience-evidence')).toContainText('500/1200');
  await expect(page.getByTestId('compute-profile')).toContainText('500/1200 PARTIAL');
});

test('Phase 3.5C 5: routing-LP scale guard is explicit while deterministic analysis remains available', async ({ page }) => {
  await openScaleProof(page);
  await expect(page.getByTestId('compute-profile')).toContainText('NOT RECOMMENDED');
  await page.getByTestId('advanced-inspector').locator('summary').click();
  await expect(page.getByTestId('routing-lp-guidance')).toContainText(/flow variables/i);
  await page.getByTestId('routing-lp-action').click();
  await expect(page.getByTestId('routing-lp-result')).toContainText(/Not recommended at this scale/i, { timeout: 10_000 });
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('plan-analysis-status')).toContainText(/PASS|FAIL/, { timeout: 15_000 });
});

test('Phase 3.5C 6: Compute Profile reports live execution mode/runtime rather than a hardcoded benchmark', async ({ page }) => {
  await openScaleProof(page);
  await expect(page.getByTestId('compute-profile')).toContainText('not run');
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('capacity-analysis-status')).toContainText(/COMPLETE/i, { timeout: 15_000 });
  const profile = await page.getByTestId('compute-profile').innerText();
  expect(profile).toMatch(/Last execution: (main-thread|worker) · [0-9.]+ ms live/);
  expect(profile).toContain('1200 eligible link failures');
  expect(profile).toMatch(/Routing LP\s+NOT RECOMMENDED/);
});
