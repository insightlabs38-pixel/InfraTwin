import { test, expect } from '@playwright/test';

async function openFlagship(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByTestId('network-selector')).toHaveValue('continental-service-network');
  await expect(page.getByTestId('topology-workspace')).toBeVisible();
  await expect(page.getByTestId('network-scale')).toContainText('128');
  await expect(page.getByTestId('network-scale')).toContainText('304');
  await expect(page.getByTestId('network-scale')).toContainText('96');
  await expect(page.getByTestId('network-scale')).toContainText('6');
}

async function searchAndChoose(page: import('@playwright/test').Page, query: string, resultTestId: string) {
  await page.getByTestId('topology-search').fill(query);
  await page.getByTestId(resultTestId).click();
}

test('Phase 3.5B 1: flagship navigation supports fit, zoom, pan, search/focus, and return to full network', async ({ page }) => {
  await openFlagship(page);
  await page.getByTestId('fit-network').click();
  const before = await page.getByTestId('viewport-readout').textContent();
  const canvas = page.getByTestId('topology-canvas');
  await page.getByTestId('zoom-in').click();
  await expect(page.getByTestId('viewport-readout')).not.toHaveText(before ?? '');
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * .45, box.y + box.height * .45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .55, box.y + box.height * .52, { steps: 3 });
    await page.mouse.up();
  }
  await searchAndChoose(page, 'Chicago', 'search-result-node-CHI-CORE-1');
  await expect(page.getByTestId('object-inspector')).toContainText('Chicago Core');
  await page.getByTestId('fit-selection').click();
  await page.getByTestId('fit-network').click();
  await expect(page.getByTestId('network-scale')).toContainText('128');
});

test('Phase 3.5B 2: flagship link selection authors generic ChangePlan action and deterministic evidence without changing base hash', async ({ page }) => {
  await openFlagship(page);
  const baseHash = await page.getByTestId('base-model-hash').textContent();
  await searchAndChoose(page, 'BB-NE-CE-01', 'search-result-link-BB-NE-CE-01');
  await page.getByTestId('plan-link-outage-BB-NE-CE-01').click();
  await expect(page.getByTestId('plan-change-list')).toContainText('Take BB-NE-CE-01 offline');
  await expect(page.getByTestId('base-model-hash')).toHaveText(baseHash ?? '');
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('plan-analysis-status')).toContainText(/PASS|FAIL/);
  await page.getByTestId('plan-link-outage-BB-NE-CE-01').click();
  await expect(page.getByTestId('plan-change-list')).not.toContainText('Take BB-NE-CE-01 offline');
  await expect(page.getByTestId('base-model-hash')).toHaveText(baseHash ?? '');
});

test('Phase 3.5B 3: large-graph LOD keeps priority semantics while reducing normal labels', async ({ page }) => {
  await openFlagship(page);
  await page.getByTestId('nav-plans').click();
  await page.getByTestId('load-plan-template').click();
  await page.getByTestId('nav-network').click();
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('plan-analysis-status')).toContainText('FAIL');
  const canvas = page.getByTestId('topology-canvas');
  await page.getByTestId('fit-network').click();
  const normalLabels = canvas.locator('.link-label.normal-context');
  expect(await normalLabels.count()).toBeLessThan(100);
  await expect(canvas.locator('.link-line.planned-outage')).toHaveCount(1);
  await expect(canvas.locator('.link-line.violation-link')).toHaveCount(1);
  await expect(canvas.locator('.link-line.locked-link')).toHaveCount(1);
  await searchAndChoose(page, 'BB-SE-CE-01', 'search-result-link-BB-SE-CE-01');
  await expect(canvas.locator('.link-line.selected')).toHaveCount(1);
  await page.getByTestId('display-mode-change-plan').check();
  await expect(canvas.locator('.link-line.dimmed')).not.toHaveCount(0);
});

test('Phase 3.5B 4: coordinate-free CSV import has explicit review, defaults, layout, interaction, and ChangePlan authoring', async ({ page }) => {
  await openFlagship(page);
  await page.getByTestId('import-json').click();
  await expect(page.getByTestId('import-network-dialog')).toBeVisible();
  await page.getByTestId('csv-nodes-file').setInputFiles({ name: 'nodes.csv', mimeType: 'text/csv', buffer: Buffer.from('id,name,region,type\nA,Alpha,East,core\nB,Beta,West,edge\nC,Gamma,West,edge\n') });
  await page.getByTestId('csv-links-file').setInputFiles({ name: 'links.csv', mimeType: 'text/csv', buffer: Buffer.from('id,source,target,capacityGbps,weight,bidirectional\nAB,A,B,40,,true\nBC,B,C,40,1,true\n') });
  await page.getByTestId('csv-demands-file').setInputFiles({ name: 'demands.csv', mimeType: 'text/csv', buffer: Buffer.from('id,name,source,target,bandwidthGbps,serviceClassId\nD1,Payments,A,C,5,default\n') });
  await page.getByTestId('review-csv-import').click();
  await expect(page.getByTestId('import-review')).toContainText('3');
  await expect(page.getByTestId('import-review')).toContainText(/default 1/i);
  await page.getByTestId('open-imported-network').click();
  await expect(page.getByTestId('topology-node-A')).toBeVisible();
  await page.getByTestId('topology-node-A').click();
  await page.getByTestId('plan-node-outage-A').click();
  await expect(page.getByTestId('plan-change-list')).toContainText('Take node A offline');
});

test('Phase 3.5B 5: upgrade catalog editor changes canonical design space explicitly and keeps abstract cost units', async ({ page }) => {
  await openFlagship(page);
  await searchAndChoose(page, 'BB-SE-CE-01', 'search-result-link-BB-SE-CE-01');
  const before = await page.getByTestId('base-model-hash').textContent();
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-upgrade-link').selectOption('BB-SE-CE-01');
  await expect(page.getByTestId('upgrade-profile-editor')).toContainText(/not a Change Plan action/i);
  await expect(page.getByTestId('upgrade-profile-editor')).toContainText(/cost units/i);
  await page.getByLabel('Upgrade capacity 1').fill('130');
  await page.getByLabel('Upgrade cost 1').fill('6');
  await page.getByLabel('Upgrade capacity 2').fill('180');
  await page.getByLabel('Upgrade cost 2').fill('9');
  await page.getByLabel('Upgrade capacity 3').fill('240');
  await page.getByLabel('Upgrade cost 3').fill('12');
  await page.getByTestId('apply-upgrade-profile').click();
  await expect(page.getByTestId('base-model-hash')).not.toHaveText(before ?? '');
  await expect(page.getByRole('status').first()).toContainText(/canonical network-assumption edit/i);
  await expect(page.getByTestId('plan-change-list')).toContainText(/No planned changes/i);
});

test('Phase 3.5B 6: presentation interactions do not stale analyzed evidence or change model/plan hashes', async ({ page }) => {
  await openFlagship(page);
  await page.getByTestId('nav-plans').click();
  await page.getByTestId('load-plan-template').click();
  await page.getByTestId('nav-network').click();
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('plan-analysis-status')).toContainText('FAIL');
  const baseHash = await page.getByTestId('base-model-hash').textContent();
  const planHash = await page.getByTestId('plan-hash').textContent();
  await page.getByTestId('topology-canvas').hover();
  await page.mouse.wheel(0, -350);
  await page.getByTestId('region-filter-central').uncheck();
  await page.getByTestId('display-mode-change-plan').check();
  await page.getByTestId('relayout').click();
  await expect(page.getByTestId('base-model-hash')).toHaveText(baseHash ?? '');
  await expect(page.getByTestId('plan-hash')).toHaveText(planHash ?? '');
  await expect(page.getByTestId('plan-analysis-status')).toContainText('FAIL');
  await expect(page.getByTestId('plan-analysis-status')).not.toContainText('STALE');
});
