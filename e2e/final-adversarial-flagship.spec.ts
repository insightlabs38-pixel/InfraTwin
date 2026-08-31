import { test, expect, type Page } from '@playwright/test';
import { executeTool, openHarnessedWorkbench, selectNetwork } from './webmcp-harness';

const paymentDemandIds = Array.from({ length: 10 }, (_, index) => `PAY-NECE-${String(index + 1).padStart(2, '0')}`);

async function selectLink(page: Page, linkId: string) {
  await page.getByTestId('topology-search').fill(linkId);
  await page.getByTestId(`search-result-link-${linkId}`).click();
  await expect(page.getByTestId(`link-inspector-${linkId}`)).toBeVisible();
}

test('AV-42: flagship human-agent red-team workflow survives outage, growth, N-1, override, adaptive frontier, stale verification, and re-verification', async ({ page }) => {
  test.setTimeout(120_000);
  await openHarnessedWorkbench(page);
  await selectNetwork(page, 'continental-service-network');

  // 1–3. Human authors maintenance; agent concurrently adds Payments growth.
  await selectLink(page, 'BB-NE-CE-01');
  await page.getByTestId('plan-link-outage-BB-NE-CE-01').click();
  await expect(page.getByTestId('plan-change-list')).toContainText('Human-authored');
  const growth = await executeTool(page, 'add_plan_change', { type: 'demand_growth', demandIds: paymentDemandIds, multiplier: 1.2 });
  expect(growth.ok).toBe(true);
  await expect(page.getByTestId('plan-change-list')).toContainText('Agent-authored');

  // 4–6. Analyze and run an explicitly bounded N-1 sample. Coverage must remain truthful.
  const analysis = await executeTool(page, 'analyze_plan');
  expect(analysis.ok).toBe(true);
  expect(analysis.result.verdict).toBe('FAIL');
  const n1 = await executeTool(page, 'run_contingencies', { maxScenarios: 8 });
  expect(n1.ok).toBe(true);
  expect(n1.result.tested).toBe(8);
  expect(n1.result.eligible).toBeGreaterThan(8);
  expect(n1.result.status).toBe('partial');

  // 7–8. Generate the preferred capacity mitigation, then the human protects every link in that preferred proposal.
  const firstProposal = await executeTool(page, 'propose_mitigation');
  expect(firstProposal.ok).toBe(true);
  expect(firstProposal.result.status).toBe('candidate');
  const firstPlan = await executeTool(page, 'inspect_plan');
  const preferredLinks: string[] = [...new Set<string>((firstPlan.result.proposals as any[])
    .filter((proposal: any) => proposal.state === 'pending' && !proposal.stale && proposal.target?.kind === 'link')
    .map((proposal: any) => String(proposal.target.id)))];
  expect(preferredLinks.length).toBeGreaterThan(0);
  for (const linkId of preferredLinks) {
    await selectLink(page, linkId);
    await page.getByTestId(`lock-link-${linkId}`).check();
  }
  const overridden = await executeTool(page, 'inspect_plan');
  for (const linkId of preferredLinks) expect(overridden.result.restrictions.lockedLinkIds).toContain(linkId);
  expect(overridden.result.proposals.some((proposal: any) => proposal.stale)).toBe(true);

  // 9–11. Enable adaptive routing, re-analyze the exact revised plan, and generate a verified nondominated frontier.
  await page.getByText('Constraints', { exact: true }).click();
  await page.getByTestId('allow-routing-changes').check();
  const revisedAnalysis = await executeTool(page, 'analyze_plan');
  expect(revisedAnalysis.result.verdict).toBe('FAIL');
  const frontier = await executeTool(page, 'compare_mitigation_variants');
  expect(frontier.ok).toBe(true);
  expect(frontier.result.count).toBeGreaterThan(0);
  expect(frontier.result.variants.every((variant: any) => variant.verification === 'verified')).toBe(true);

  // 12–13. Human chooses a displayed adaptive variant and verifies the independently reconstructed proposal.
  await page.getByTestId('nav-plans').click();
  const rows = page.locator('[data-testid^="design-variant-design:"]');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await rows.first().click();
  const verification = await executeTool(page, 'verify_plan');
  expect(verification.ok).toBe(true);
  expect(verification.result.status).toBe('verified');
  expect(verification.result.adaptiveDesignVerification?.status).toBe('verified');

  // 14–16. A semantic constraint edit stales verification immediately; rerun frontier + verification restores current truth.
  await page.getByTestId('nav-network').click();
  await page.getByText('Constraints', { exact: true }).click();
  await page.getByTestId('constraint-max-candidate-paths').selectOption('6');
  const stale = await executeTool(page, 'inspect_workspace');
  expect(stale.result.verification.status).toBe('stale');
  expect(stale.result.verification.current).toBe(false);

  const finalAnalysis = await executeTool(page, 'analyze_plan');
  expect(finalAnalysis.result.verdict).toBe('FAIL');
  const rerunFrontier = await executeTool(page, 'compare_mitigation_variants');
  expect(rerunFrontier.result.count).toBeGreaterThan(0);
  await page.getByTestId('nav-plans').click();
  const rerunRows = page.locator('[data-testid^="design-variant-design:"]');
  await expect(rerunRows.first()).toBeVisible({ timeout: 30_000 });
  await rerunRows.first().click();
  const finalVerification = await executeTool(page, 'verify_plan');
  expect(finalVerification.result.status).toBe('verified');
  const finalWorkspace = await executeTool(page, 'inspect_workspace');
  expect(finalWorkspace.result.verification.status).toBe('verified');
  expect(finalWorkspace.result.verification.current).toBe(true);
});
