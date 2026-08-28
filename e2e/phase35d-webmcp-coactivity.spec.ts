import { test, expect, type Page } from '@playwright/test';
import { executeTool, expectActive, expectInactive, loadTemplate, openHarnessedWorkbench, selectNetwork } from './webmcp-harness';

async function selectLink(page: Page, linkId: string) {
  await page.getByTestId('topology-search').fill(linkId);
  await page.getByTestId(`search-result-link-${linkId}`).click();
  await expect(page.getByTestId(`link-inspector-${linkId}`)).toBeVisible();
}

const paymentDemandIds = Array.from({ length: 10 }, (_, index) => `PAY-NECE-${String(index + 1).padStart(2, '0')}`);

test('M3.5D 1 — human selection is live WebMCP context without copying an opaque ID', async ({ page }) => {
  await openHarnessedWorkbench(page);
  await selectLink(page, 'BB-NE-CE-01');
  const inspected = await executeTool(page, 'inspect_selection');
  expect(inspected.ok).toBe(true);
  expect(inspected.result).toMatchObject({ state: 'selected', kind: 'link', id: 'BB-NE-CE-01' });
  expect(inspected.result.planChanges).toEqual([]);
});

test('M3.5D 2 — agent edit mutates the visible ChangePlan, topology context, provenance, and evidence freshness', async ({ page }) => {
  await openHarnessedWorkbench(page);
  await selectNetwork(page, 'maintenance-trap');
  const baseline = await executeTool(page, 'analyze_plan');
  expect(baseline.ok).toBe(true);
  expect(baseline.result.verdict).toBe('PASS');

  await selectLink(page, 'L1');
  const edit = await executeTool(page, 'add_plan_change', { type: 'disable_link', target: 'selection' });
  expect(edit.ok).toBe(true);
  await expect(page.getByTestId('plan-change-list')).toContainText('Take L1 offline');
  await expect(page.getByTestId('plan-change-list')).toContainText('Agent-authored');
  await expect(page.getByTestId('link-inspector-L1')).toContainText('Planned outage');
  await expect(page.getByTestId('collaboration-indicator')).toContainText(/Agent/i);

  const analysis = await executeTool(page, 'inspect_analysis');
  expect(analysis.result.state).toBe('stale');
  await page.getByTestId('nav-analysis').click();
  await page.getByTestId('analysis-tab-evidence').click();
  await expect(page.getByTestId('analysis-evidence')).toContainText('STALE');
});

test('M3.5D 3/4 — human lock invalidates the old agent proposal and replanning cannot reuse the locked resource', async ({ page }) => {
  await openHarnessedWorkbench(page);
  await selectNetwork(page, 'resilience-gap');
  await loadTemplate(page);
  const analysis = await executeTool(page, 'analyze_plan');
  expect(analysis.ok).toBe(true);
  expect(analysis.result.verdict).toBe('FAIL');
  await expectActive(page, ['propose_mitigation']);

  await expect(page.getByTestId('advanced-toggle')).toBeVisible();
  const first = await executeTool(page, 'propose_mitigation');
  expect(first.ok).toBe(true);
  await expect(page.getByTestId('candidate-proposals')).toBeVisible({ timeout: 30_000 });
  const before = await executeTool(page, 'inspect_plan');
  const currentProposals = before.result.proposals.filter((proposal: { stale: boolean; state: string }) => !proposal.stale && proposal.state === 'pending');
  expect(currentProposals.length).toBeGreaterThan(0);
  const linkProposal = currentProposals.find((proposal: { target?: { kind?: string; id?: string } }) => proposal.target?.kind === 'link');
  expect(linkProposal?.target?.id).toBeTruthy();
  const lockedLinkId = String(linkProposal.target.id);

  await page.getByTestId('nav-network').click();
  await selectLink(page, lockedLinkId);
  await page.getByTestId(`lock-link-${lockedLinkId}`).check();
  await expect(page.getByTestId('candidate-proposals')).toContainText('stale after plan revision');
  const overridden = await executeTool(page, 'inspect_plan');
  expect(overridden.result.restrictions.lockedLinkIds).toContain(lockedLinkId);
  expect(overridden.result.proposals.some((proposal: { stale: boolean }) => proposal.stale)).toBe(true);
  await expectInactive(page, ['accept_proposal_change', 'reject_proposal_change', 'discard_proposal']);

  const active = await page.evaluate(() => (window as any).__webmcpHarness.snapshot().active as string[]);
  if (active.includes('propose_mitigation')) {
    const replanned = await executeTool(page, 'propose_mitigation');
    expect(replanned.ok).toBe(true);
    const after = await executeTool(page, 'inspect_plan');
    const current = after.result.proposals.filter((proposal: { stale: boolean; state: string }) => !proposal.stale && proposal.state === 'pending');
    expect(current.some((proposal: { target?: { kind?: string; id?: string } }) => proposal.target?.kind === 'link' && proposal.target.id === lockedLinkId)).toBe(false);
  } else {
    expect(active).not.toContain('propose_mitigation');
  }
});

test('M3.5D 5 — agent can guide the human to deterministic failure evidence', async ({ page }) => {
  await openHarnessedWorkbench(page);
  await selectNetwork(page, 'maintenance-trap');
  await executeTool(page, 'add_plan_change', { type: 'disable_link', linkId: 'L1' });
  const result = await executeTool(page, 'analyze_plan');
  expect(result.result.verdict).toBe('FAIL');
  await expectActive(page, ['inspect_violation', 'focus_violation']);

  await page.getByTestId('nav-analysis').click();
  const violation = await executeTool(page, 'inspect_violation');
  expect(violation.ok).toBe(true);
  expect(violation.result.linkId).toBe('L3');
  const focused = await executeTool(page, 'focus_violation', { violationId: violation.result.id });
  expect(focused.ok).toBe(true);
  await expect(page.getByTestId('network-view')).toBeVisible();
  await expect(page.getByTestId('link-inspector-L3')).toBeVisible();
  await expect(page.getByTestId('link-inspector-L3')).toContainText('L3');
});

test('M3.5D 6 — capability set follows current evidence instead of stale analysis', async ({ page }) => {
  await openHarnessedWorkbench(page);
  await selectNetwork(page, 'maintenance-trap');
  await expectInactive(page, ['inspect_violation', 'focus_violation', 'find_bottlenecks', 'propose_mitigation']);
  await executeTool(page, 'add_plan_change', { type: 'disable_link', linkId: 'L1' });
  await executeTool(page, 'analyze_plan');
  await expectActive(page, ['inspect_violation', 'focus_violation', 'find_bottlenecks', 'propose_mitigation']);
  await executeTool(page, 'set_plan_constraints', { targetUtilizationPct: 75 });
  await expectInactive(page, ['inspect_violation', 'focus_violation', 'find_bottlenecks', 'propose_mitigation']);
  const stale = await executeTool(page, 'inspect_analysis');
  expect(stale.result.state).toBe('stale');
});

test('M3.5D flagship — human outage + agent Payments growth share one plan, failure, proposal, override, and verification state', async ({ page }) => {
  await openHarnessedWorkbench(page);
  await selectLink(page, 'BB-NE-CE-01');
  await page.getByTestId('plan-link-outage-BB-NE-CE-01').click();
  await expect(page.getByTestId('plan-change-list')).toContainText('Human-authored');

  const workspace = await executeTool(page, 'inspect_workspace');
  const selection = await executeTool(page, 'inspect_selection');
  expect(workspace.result.project.name).toBe('Continental Service Network');
  expect(selection.result.id).toBe('BB-NE-CE-01');
  expect(workspace.result.plan.changes.some((change: { actor: string; summary: string }) => change.actor === 'human' && change.summary.includes('BB-NE-CE-01'))).toBe(true);

  const growth = await executeTool(page, 'add_plan_change', { type: 'demand_growth', demandIds: paymentDemandIds, multiplier: 1.2 });
  expect(growth.ok).toBe(true);
  await expect(page.getByTestId('plan-change-list')).toContainText(/Payments|10 demands/i);
  await expect(page.getByTestId('plan-change-list')).toContainText('Agent-authored');

  const analysis = await executeTool(page, 'analyze_plan');
  expect(analysis.ok).toBe(true);
  expect(analysis.result.verdict).toBe('FAIL');
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await expectActive(page, ['inspect_violation', 'focus_violation', 'propose_mitigation']);

  const violation = await executeTool(page, 'inspect_violation');
  expect(violation.result.linkId).toBe('BB-SE-CE-01');
  await page.getByTestId('nav-analysis').click();
  await executeTool(page, 'focus_violation', { violationId: violation.result.id });
  await expect(page.getByTestId('link-inspector-BB-SE-CE-01')).toBeVisible();

  const proposed = await executeTool(page, 'propose_mitigation');
  expect(proposed.ok).toBe(true);
  await expect(page.getByTestId('candidate-proposals')).toBeVisible({ timeout: 30_000 });
  const proposalState = await executeTool(page, 'inspect_plan');
  const current = proposalState.result.proposals.filter((proposal: { stale: boolean; state: string }) => !proposal.stale && proposal.state === 'pending');
  expect(current.length).toBeGreaterThan(0);
  const firstLink = current.find((proposal: { target?: { kind?: string; id?: string } }) => proposal.target?.kind === 'link');
  expect(firstLink).toBeTruthy();

  const proposalLinkId = String(firstLink.target.id);
  await selectLink(page, proposalLinkId);
  await page.getByTestId(`lock-link-${proposalLinkId}`).check();
  await expect(page.getByTestId('candidate-proposals')).toContainText('stale after plan revision');
  const afterOverride = await executeTool(page, 'inspect_plan');
  expect(afterOverride.result.restrictions.lockedLinkIds).toContain(proposalLinkId);
  expect(afterOverride.result.proposals.some((proposal: { stale: boolean }) => proposal.stale)).toBe(true);

  const verification = await executeTool(page, 'verify_plan');
  expect(verification.ok).toBe(true);
  expect(['failed', 'partial', 'verified']).toContain(verification.result.status);
  const finalWorkspace = await executeTool(page, 'inspect_workspace');
  expect(finalWorkspace.result.verification.status).toBe(verification.result.status);
  expect(finalWorkspace.result.plan.hash).toBe(verification.result.planHash);
});
