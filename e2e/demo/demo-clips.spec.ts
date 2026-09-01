import { test, expect } from '@playwright/test';
import { generateScaleProject, SCALE_TIERS } from '../../packages/scenarios/src/scale-generator.ts';
import {
  createClipCapture,
  enableAdaptiveRouting,
  executeNative,
  lockAndAdaptiveReplan,
  moveAndClick,
  nativeToolNames,
  openProductionWorkspace,
  pauseForViewer,
  seedFlagshipFailure,
  seedFlagshipProposal,
  selectLink,
  shouldCapture,
  waitForNativeTools,
} from './demo-helpers.ts';

const paymentDemandIds = Array.from({ length: 10 }, (_, index) => `PAY-NECE-${String(index + 1).padStart(2, '0')}`);

function clipTest(clip: number, title: string, fn: Parameters<typeof test>[1]) {
  test(title, async (args, testInfo) => {
    test.skip(!shouldCapture(clip), `Clip ${clip} excluded by CAPTURE_SET=${process.env.CAPTURE_SET ?? 'all'}.`);
    await fn(args, testInfo);
  });
}

clipTest(1, '01 — opening workspace', async ({ page }, testInfo) => {
  const capture = createClipCapture(page, testInfo, {
    filename: '01-opening-workspace.mp4',
    purpose: 'Establish InfraTwin as a real network engineering workspace.',
    fixture: 'Continental Service Network',
    actions: ['Open production-style workspace', 'Show topology and ChangePlan', 'Zoom topology', 'Select backbone link'],
    webmcpTools: [],
    engineering: ['128-node flagship topology', 'ChangePlan workspace'],
    minDurationSec: 5,
    maxDurationSec: 9,
  });
  await openProductionWorkspace(page);
  await expect(page.getByTestId('network-scale')).toContainText('128');
  capture.markStart();
  await pauseForViewer(1_500);
  await moveAndClick(page, page.getByTestId('zoom-in'));
  await pauseForViewer(1_200);
  await selectLink(page, 'BB-NE-CE-01');
  await pauseForViewer(2_300);
  await capture.finish();
});

clipTest(2, '02 — human and agent share one plan through native WebMCP', async ({ page }, testInfo) => {
  const capture = createClipCapture(page, testInfo, {
    filename: '02-human-agent-plan.mp4',
    purpose: 'Prove human and agent modify the same unsaved ChangePlan.',
    fixture: 'Continental Service Network',
    actions: ['Human selects BB-NE-CE-01', 'Human adds outage', 'Agent inspects selection', 'Agent adds Payments growth', 'Show agent attribution'],
    webmcpTools: ['inspect_selection', 'add_plan_change'],
    engineering: ['Shared browser-local ChangePlan', 'Native document.modelContext execution'],
    minDurationSec: 15,
    maxDurationSec: 23,
  });
  await openProductionWorkspace(page);
  await waitForNativeTools(page, ['inspect_selection', 'add_plan_change']);
  capture.markStart();
  await pauseForViewer(1_300);
  await selectLink(page, 'BB-NE-CE-01');
  await pauseForViewer(2_400);
  await moveAndClick(page, page.getByTestId('plan-link-outage-BB-NE-CE-01'));
  await expect(page.getByTestId('plan-change-list')).toContainText('Human-authored');
  await pauseForViewer(3_000);
  const selected = await executeNative<Record<string, any>>(page, 'inspect_selection');
  expect(selected).toMatchObject({ state: 'selected', kind: 'link', id: 'BB-NE-CE-01' });
  await pauseForViewer(1_400);
  await executeNative(page, 'add_plan_change', { type: 'demand_growth', demandIds: paymentDemandIds, multiplier: 1.2 });
  await expect(page.getByTestId('plan-change-list')).toContainText(/Payments|10 demands/i);
  await expect(page.getByTestId('plan-change-list')).toContainText('Agent-authored');
  await expect(page.getByTestId('collaboration-indicator')).toContainText(/Agent/i);
  await pauseForViewer(5_000);
  await capture.finish();
});

clipTest(3, '03 — deterministic failure and remote evidence', async ({ page }, testInfo) => {
  const capture = createClipCapture(page, testInfo, {
    filename: '03-failure-evidence.mp4',
    purpose: 'Show deterministic computation producing a non-obvious remote failure and inspectable evidence.',
    fixture: 'Continental Service Network',
    actions: ['Analyze shared plan', 'Show FAIL result', 'Inspect main violation', 'Focus remote Southeast–Central corridor', 'Show link evidence'],
    webmcpTools: ['analyze_plan', 'inspect_violation', 'focus_violation'],
    engineering: ['Deterministic routing/capacity analysis', 'Evidence-linked violation focus'],
    minDurationSec: 10,
    maxDurationSec: 16,
  });
  await seedFlagshipFailure(page);
  capture.markStart();
  await executeNative(page, 'analyze_plan');
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await pauseForViewer(2_600);
  await moveAndClick(page, page.getByTestId('nav-analysis'));
  await expect(page.getByTestId('analysis-summary')).toBeVisible();
  await pauseForViewer(2_000);
  await waitForNativeTools(page, ['inspect_violation', 'focus_violation']);
  const violation = await executeNative<Record<string, any>>(page, 'inspect_violation');
  expect(violation.linkId).toBe('BB-SE-CE-01');
  await executeNative(page, 'focus_violation', { violationId: violation.id });
  await expect(page.getByTestId('link-inspector-BB-SE-CE-01')).toBeVisible();
  await pauseForViewer(4_800);
  await capture.finish({ focusedViolationLinkId: violation.linkId });
});

clipTest(4, '04 — human lock forces adaptive replan', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const capture = createClipCapture(page, testInfo, {
    filename: '04-lock-and-replan.mp4',
    purpose: 'Human judgment changes the design space and the agent replans around the protected resource.',
    fixture: 'Continental Service Network',
    actions: ['Show cheapest proposal', 'Human locks proposed modification target', 'Show proposal becomes stale', 'Agent re-inspects restriction', 'Re-analyze', 'Run mitigation again', 'Show verified adaptive alternative'],
    webmcpTools: ['propose_mitigation', 'inspect_plan', 'analyze_plan'],
    engineering: ['Level 4A adaptive design', 'Level 4B candidate-path engine', 'Human modification lock'],
    minDurationSec: 20,
    maxDurationSec: 32,
  });
  const { proposalLinkId } = await seedFlagshipProposal(page, true);
  capture.markStart();
  await pauseForViewer(3_200);
  await selectLink(page, proposalLinkId);
  await pauseForViewer(2_000);
  await page.getByTestId(`lock-link-${proposalLinkId}`).check();
  await expect(page.getByTestId('candidate-proposals')).toContainText(/stale after plan revision/i);
  await pauseForViewer(3_500);
  const locked = await executeNative<Record<string, any>>(page, 'inspect_plan');
  expect(locked.restrictions.lockedLinkIds).toContain(proposalLinkId);
  await pauseForViewer(1_300);
  await executeNative(page, 'analyze_plan');
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await pauseForViewer(2_000);
  const second = await executeNative<Record<string, any>>(page, 'propose_mitigation');
  expect(second.mode).toBe('adaptive-design');
  expect(second.verification).toBe('verified');
  await expect(page.getByTestId('network-design-summary')).toContainText(/verified/i, { timeout: 60_000 });
  const after = await executeNative<Record<string, any>>(page, 'inspect_plan');
  const active = after.proposals.filter((proposal: any) => !proposal.stale && proposal.state === 'pending');
  expect(active.some((proposal: any) => proposal.target?.kind === 'link' && proposal.target.id === proposalLinkId)).toBe(false);
  await pauseForViewer(7_000);
  await capture.finish({ lockedModificationTarget: proposalLinkId, replanMode: second.mode, replanVerification: second.verification });
});

clipTest(5, '05 — compare adaptive variants and verify', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const capture = createClipCapture(page, testInfo, {
    filename: '05-compare-and-verify.mp4',
    purpose: 'Show bounded alternative comparison, human review, and deterministic verification.',
    fixture: 'Continental Service Network',
    actions: ['Open Plans view', 'Compare adaptive alternatives', 'Review cost/headroom/verification', 'Select one variant', 'Return to network context', 'Verify plan and show verified evidence'],
    webmcpTools: ['compare_mitigation_variants', 'verify_plan'],
    engineering: ['Verified Pareto alternatives', 'Independent reconstructed primal verification'],
    minDurationSec: 12,
    maxDurationSec: 20,
  });
  const { proposalLinkId } = await seedFlagshipProposal(page, true);
  await lockAndAdaptiveReplan(page, proposalLinkId);
  await page.getByTestId('nav-plans').click();
  await expect(page.getByTestId('plans-view')).toBeVisible();
  capture.markStart();
  await pauseForViewer(1_800);
  const compared = await executeNative<Record<string, any>>(page, 'compare_mitigation_variants');
  expect(compared).toBeTruthy();
  const rows = page.locator('[data-testid^="design-variant-design:"]');
  await expect.poll(() => rows.count(), { timeout: 60_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('design-variant-table')).toContainText(/verified/i);
  await pauseForViewer(4_200);
  await moveAndClick(page, rows.first());
  await pauseForViewer(2_000);
  await moveAndClick(page, page.getByTestId('nav-network'));
  await expect(page.getByTestId('network-design-summary')).toBeVisible();
  await pauseForViewer(1_800);
  const verification = await executeNative<Record<string, any>>(page, 'verify_plan');
  expect(verification.status).toBe('verified');
  await moveAndClick(page, page.getByTestId('nav-analysis'));
  await moveAndClick(page, page.getByTestId('analysis-tab-evidence'));
  await expect(page.getByTestId('adaptive-design-evidence')).toContainText('VERIFIED');
  await pauseForViewer(3_500);
  await capture.finish({ verificationStatus: verification.status });
});

clipTest(6, '06 — 500-node scale proof', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const capture = createClipCapture(page, testInfo, {
    filename: '06-scale-proof.mp4',
    purpose: 'Establish that InfraTwin is not only a tiny reference-network demo.',
    fixture: 'National Backbone Scale Test / Tier C',
    actions: ['Show 500-node Canvas topology', 'Show scale counts', 'Zoom topology', 'Search/focus a node'],
    webmcpTools: [],
    engineering: ['Canvas renderer', 'Deterministic Tier C scale fixture'],
    benchmarkNumbers: ['500 nodes', '1,200 links', '400 demands'],
    minDurationSec: 7,
    maxDurationSec: 13,
  });
  const tier = SCALE_TIERS.find((item) => item.id === 'C')!;
  const project = generateScaleProject({
    ...tier,
    seed: 3553,
    routingMode: 'single-shortest-path',
    workload: 'concentrated-sources',
    sourceConcentration: 30,
    serviceClassCount: 3,
    upgradeOptionDensity: 0.4,
  });
  project.name = 'National Backbone Scale Test';
  await page.goto('/');
  await page.getByTestId('import-json').click();
  await page.getByRole('button', { name: 'Canonical JSON' }).click();
  await page.getByTestId('json-import-file').setInputFiles({ name: 'national-backbone-scale-test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.getByTestId('open-imported-network').click();
  await expect(page.getByTestId('topology-workspace')).toBeVisible();
  await expect(page.getByTestId('network-scale')).toContainText('500');
  await expect(page.getByTestId('topology-canvas')).toHaveAttribute('data-renderer', 'canvas');
  capture.markStart();
  await pauseForViewer(2_200);
  await moveAndClick(page, page.getByTestId('zoom-out'));
  await moveAndClick(page, page.getByTestId('zoom-in'));
  await pauseForViewer(1_600);
  await page.getByTestId('topology-search').fill('n-0320');
  await pauseForViewer(500);
  await moveAndClick(page, page.getByTestId('search-result-node-n-0320'));
  await expect(page.getByTestId('object-inspector')).toContainText('n-0320');
  await pauseForViewer(3_000);
  await capture.finish();
});

clipTest(7, '07 — concise native WebMCP technical proof', async ({ page }, testInfo) => {
  const capture = createClipCapture(page, testInfo, {
    filename: '07-webmcp-proof.mp4',
    purpose: 'Give technical judges concise visible proof that native WebMCP is registered and executing.',
    fixture: 'Continental Service Network',
    actions: ['Execute real native inspect tool', 'Open Advanced diagnostics', 'Show registered capabilities and successful activity event'],
    webmcpTools: ['inspect_workspace'],
    engineering: ['Native document.modelContext', 'toolchange/activity diagnostics'],
    minDurationSec: 5,
    maxDurationSec: 11,
  });
  await openProductionWorkspace(page);
  await waitForNativeTools(page, ['inspect_workspace']);
  const names = await nativeToolNames(page);
  expect(names).toContain('inspect_workspace');
  await executeNative(page, 'inspect_workspace');
  capture.markStart();
  await pauseForViewer(900);
  await moveAndClick(page, page.getByTestId('advanced-toggle'));
  await expect(page.getByTestId('advanced-inspector')).toContainText(/registered capabilities/i);
  await expect(page.getByTestId('advanced-inspector')).toContainText('inspect_workspace');
  await expect(page.getByTestId('advanced-inspector')).toContainText(/success/i);
  await pauseForViewer(5_400);
  await capture.finish({ registeredToolCount: names.length });
});
