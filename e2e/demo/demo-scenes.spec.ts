import { test, expect, type Page, type TestInfo } from '@playwright/test';
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
  waitForNativeTools,
} from './demo-helpers.ts';

const paymentDemandIds = Array.from({ length: 10 }, (_, index) => `PAY-NECE-${String(index + 1).padStart(2, '0')}`);
type SceneBody = (args: { page: Page }, testInfo: TestInfo) => Promise<void>;

function sceneTest(scene: number, title: string, fn: SceneBody) {
  test(`${String(scene).padStart(2, '0')} — ${title}`, fn);
}

async function clickTopologyLink(page: Page, linkId: string) {
  await moveAndClick(page, page.getByTestId(`topology-link-${linkId}`));
  await expect(page.getByTestId(`link-inspector-${linkId}`)).toBeVisible();
}

async function addHumanOutage(page: Page, linkId = 'BB-NE-CE-01') {
  await clickTopologyLink(page, linkId);
  await moveAndClick(page, page.getByTestId(`plan-link-outage-${linkId}`));
  await expect(page.getByTestId('plan-change-list')).toContainText('Human');
}

async function prepareFailingPlan(page: Page) {
  await seedFlagshipFailure(page);
  const analysis = await executeNative<Record<string, any>>(page, 'analyze_plan');
  expect(analysis.verdict).toBe('FAIL');
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
}

sceneTest(1, 'clean hero workspace', async ({ page }, testInfo) => {
  const capture = createClipCapture(page, testInfo, {
    filename: '01-clean-hero-workspace.mp4',
    purpose: 'Clean establishing shot of the finished InfraTwin network-change workspace.',
    fixture: 'Continental Service Network',
    actions: ['Open finished 1080p workspace', 'Hold topology, ChangePlan, status, and inspector context without selection'],
    webmcpTools: [],
    engineering: ['128-node flagship topology', 'Browser-local ChangePlan workspace'],
    minDurationSec: 5,
    maxDurationSec: 9,
  });
  await openProductionWorkspace(page);
  await expect(page.getByTestId('network-scale')).toContainText('128');
  await expect(page.getByTestId('collaboration-indicator')).toContainText(/Shared ChangePlan/i);
  capture.markStart();
  await page.mouse.move(1510, 970, { steps: 16 });
  await pauseForViewer(6_200);
  await capture.finish();
});

sceneTest(2, 'human selects the maintenance link', async ({ page }, testInfo) => {
  const capture = createClipCapture(page, testInfo, {
    filename: '02-human-select-maintenance-link.mp4',
    purpose: 'Show the engineer selecting the Northeast–Central backbone resource that will enter maintenance.',
    fixture: 'Continental Service Network',
    actions: ['Start from clean workspace', 'Human selects BB-NE-CE-01 directly on the topology', 'Hold selected-link inspector'],
    webmcpTools: [],
    engineering: ['Human topology selection', 'Live object inspector'],
    minDurationSec: 5,
    maxDurationSec: 10,
  });
  await openProductionWorkspace(page);
  capture.markStart();
  await pauseForViewer(1_400);
  await clickTopologyLink(page, 'BB-NE-CE-01');
  await pauseForViewer(4_300);
  await capture.finish();
});

sceneTest(3, 'human schedules the maintenance outage', async ({ page }, testInfo) => {
  const capture = createClipCapture(page, testInfo, {
    filename: '03-human-schedule-outage.mp4',
    purpose: 'Show a human-authored outage entering the single live ChangePlan.',
    fixture: 'Continental Service Network',
    actions: ['Preselect BB-NE-CE-01', 'Human clicks Add outage', 'Show Human provenance in Planned changes'],
    webmcpTools: [],
    engineering: ['Human-authored ChangePlan mutation', 'Planned outage visualization'],
    minDurationSec: 5,
    maxDurationSec: 10,
  });
  await openProductionWorkspace(page);
  await clickTopologyLink(page, 'BB-NE-CE-01');
  capture.markStart();
  await pauseForViewer(1_200);
  await moveAndClick(page, page.getByTestId('plan-link-outage-BB-NE-CE-01'));
  await expect(page.getByTestId('plan-change-list')).toContainText('Human');
  await expect(page.getByTestId('plan-change-list')).toContainText(/offline/i);
  await pauseForViewer(4_500);
  await capture.finish();
});

sceneTest(4, 'native WebMCP inspects the exact human selection', async ({ page }, testInfo) => {
  const capture = createClipCapture(page, testInfo, {
    filename: '04-webmcp-inspect-selection.mp4',
    purpose: 'Prove the WebMCP agent reads the exact live human selection in the same browser workspace.',
    fixture: 'Continental Service Network',
    actions: ['Human selection already active', 'Execute native inspect_selection', 'Hold connected Shared ChangePlan state'],
    webmcpTools: ['inspect_selection'],
    engineering: ['Native document.modelContext execution', 'Shared live browser selection'],
    minDurationSec: 5,
    maxDurationSec: 10,
  });
  await openProductionWorkspace(page);
  await waitForNativeTools(page, ['inspect_selection']);
  await clickTopologyLink(page, 'BB-NE-CE-01');
  capture.markStart();
  await pauseForViewer(1_200);
  const selected = await executeNative<Record<string, any>>(page, 'inspect_selection');
  expect(selected).toMatchObject({ state: 'selected', kind: 'link', id: 'BB-NE-CE-01' });
  await expect(page.getByTestId('collaboration-indicator')).toContainText(/WebMCP connected/i);
  await pauseForViewer(4_400);
  await capture.finish({ selectedByWebMCP: selected.id });
});

sceneTest(5, 'agent adds Payments growth to the same ChangePlan', async ({ page }, testInfo) => {
  const capture = createClipCapture(page, testInfo, {
    filename: '05-agent-add-payments-growth.mp4',
    purpose: 'Show the agent adding expected Payments growth into the exact same unsaved ChangePlan.',
    fixture: 'Continental Service Network',
    actions: ['Human outage already present', 'Agent executes add_plan_change', 'Show Agent provenance beside the new growth change'],
    webmcpTools: ['add_plan_change'],
    engineering: ['Shared browser-local ChangePlan mutation', 'Agent provenance'],
    minDurationSec: 6,
    maxDurationSec: 12,
  });
  await openProductionWorkspace(page);
  await waitForNativeTools(page, ['add_plan_change']);
  await addHumanOutage(page);
  capture.markStart();
  await pauseForViewer(1_200);
  await executeNative(page, 'add_plan_change', { type: 'demand_growth', demandIds: paymentDemandIds, multiplier: 1.2 });
  await expect(page.getByTestId('plan-change-list')).toContainText(/Grow 10 demands by 20%/i);
  await expect(page.getByTestId('plan-change-list')).toContainText('Agent');
  await expect(page.getByTestId('collaboration-indicator')).toContainText(/Agent/i);
  await pauseForViewer(5_000);
  await capture.finish({ demandCount: paymentDemandIds.length, multiplier: 1.2 });
});

sceneTest(6, 'deterministic analysis discovers the remote failure', async ({ page }, testInfo) => {
  const capture = createClipCapture(page, testInfo, {
    filename: '06-analyze-remote-failure.mp4',
    purpose: 'Show deterministic routing/capacity computation falsifying the combined ChangePlan.',
    fixture: 'Continental Service Network',
    actions: ['Seed human outage plus agent growth', 'Run native analyze_plan', 'Show Current plan · FAIL and remote violation evidence'],
    webmcpTools: ['analyze_plan'],
    engineering: ['Deterministic routing', 'Capacity analysis', 'Evidence publication'],
    minDurationSec: 6,
    maxDurationSec: 14,
  });
  await seedFlagshipFailure(page);
  capture.markStart();
  await pauseForViewer(1_000);
  const analysis = await executeNative<Record<string, any>>(page, 'analyze_plan');
  expect(analysis.verdict).toBe('FAIL');
  await expect(page.getByTestId('verdict')).toHaveText('FAIL');
  await expect(page.getByTestId('evidence-panel')).toContainText(/BB-SE-CE-01|Southeast|Central/i);
  await pauseForViewer(5_000);
  await capture.finish({ verdict: analysis.verdict });
});

sceneTest(7, 'engineer inspects the remote failure evidence', async ({ page }, testInfo) => {
  const capture = createClipCapture(page, testInfo, {
    filename: '07-inspect-remote-evidence.mp4',
    purpose: 'Make the non-obvious remote Southeast–Central failure inspectable and concrete.',
    fixture: 'Continental Service Network',
    actions: ['Start from authoritative failing analysis', 'Open Analysis', 'Inspect violation', 'Focus BB-SE-CE-01', 'Hold load/utilization evidence'],
    webmcpTools: ['inspect_violation', 'focus_violation'],
    engineering: ['Evidence-linked violation inspection', 'Remote corridor focus'],
    minDurationSec: 7,
    maxDurationSec: 14,
  });
  await prepareFailingPlan(page);
  capture.markStart();
  await pauseForViewer(900);
  await moveAndClick(page, page.getByTestId('nav-analysis'));
  await moveAndClick(page, page.getByTestId('analysis-tab-violations'));
  await expect(page.getByTestId('analysis-violations')).toContainText(/BB-SE-CE-01|capacity|utilization/i);
  await pauseForViewer(1_500);
  const violation = await executeNative<Record<string, any>>(page, 'inspect_violation');
  expect(violation.linkId).toBe('BB-SE-CE-01');
  await executeNative(page, 'focus_violation', { violationId: violation.id });
  await expect(page.getByTestId('link-inspector-BB-SE-CE-01')).toBeVisible();
  await expect(page.getByTestId('link-inspector-BB-SE-CE-01')).toContainText(/Utilization/i);
  await pauseForViewer(4_500);
  await capture.finish({ focusedViolationLinkId: violation.linkId });
});

sceneTest(8, 'agent requests the initial mitigation', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const capture = createClipCapture(page, testInfo, {
    filename: '08-agent-initial-mitigation.mp4',
    purpose: 'Show the first modeled mitigation arriving as a proposal awaiting human review.',
    fixture: 'Continental Service Network',
    actions: ['Prepare failing plan with adaptive actions enabled', 'Agent executes propose_mitigation', 'Show capacity-only proposal and not-applied boundary'],
    webmcpTools: ['propose_mitigation'],
    engineering: ['Deterministic mitigation optimization', 'Proposal lifecycle boundary'],
    minDurationSec: 7,
    maxDurationSec: 16,
  });
  await seedFlagshipFailure(page);
  await enableAdaptiveRouting(page);
  const analysis = await executeNative<Record<string, any>>(page, 'analyze_plan');
  expect(analysis.verdict).toBe('FAIL');
  await waitForNativeTools(page, ['propose_mitigation']);
  capture.markStart();
  await pauseForViewer(1_000);
  const proposal = await executeNative<Record<string, any>>(page, 'propose_mitigation');
  expect(proposal.mode).toBe('capacity-only');
  await expect(page.getByTestId('candidate-proposals')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('candidate-proposals')).toContainText(/Proposed · awaiting human review/i);
  await pauseForViewer(5_700);
  await capture.finish({ initialMitigationMode: proposal.mode });
});

sceneTest(9, 'human locks the proposed modification target', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const capture = createClipCapture(page, testInfo, {
    filename: '09-human-lock-proposed-link.mp4',
    purpose: 'Show operational knowledge entering the design space as a human modification lock.',
    fixture: 'Continental Service Network',
    actions: ['Start with initial proposal', 'Select proposal target', 'Human checks Lock link', 'Show Human restrictions count'],
    webmcpTools: [],
    engineering: ['Human modification lock', 'Constraint mutation'],
    minDurationSec: 6,
    maxDurationSec: 12,
  });
  const { proposalLinkId } = await seedFlagshipProposal(page, true);
  await selectLink(page, proposalLinkId);
  capture.markStart();
  await pauseForViewer(1_200);
  await page.getByTestId(`lock-link-${proposalLinkId}`).check();
  await expect(page.getByTestId('plan-restrictions')).toContainText(/1 modification lock/i);
  await pauseForViewer(4_800);
  await capture.finish({ lockedLinkId: proposalLinkId });
});

sceneTest(10, 'the previous proposal becomes stale immediately', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const capture = createClipCapture(page, testInfo, {
    filename: '10-proposal-stale-transition.mp4',
    purpose: 'Show that a human plan edit invalidates an optimizer proposal generated against older state.',
    fixture: 'Continental Service Network',
    actions: ['Hold valid initial proposal', 'Human locks its target', 'Show proposal lifecycle change to Stale · needs replanning'],
    webmcpTools: [],
    engineering: ['Proposal source-plan hash invalidation', 'Stale evidence safety'],
    minDurationSec: 7,
    maxDurationSec: 13,
  });
  const { proposalLinkId } = await seedFlagshipProposal(page, true);
  await selectLink(page, proposalLinkId);
  await expect(page.getByTestId('candidate-proposals')).toContainText(/Proposed · awaiting human review/i);
  capture.markStart();
  await pauseForViewer(1_700);
  await page.getByTestId(`lock-link-${proposalLinkId}`).check();
  await expect(page.getByTestId('candidate-proposals')).toContainText(/Stale · needs replanning/i);
  await expect(page.getByTestId('workflow-guidance')).toContainText(/analyze again/i);
  await pauseForViewer(5_000);
  await capture.finish({ staleProposalTarget: proposalLinkId });
});

sceneTest(11, 'agent re-inspects the lock and adaptively replans', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const capture = createClipCapture(page, testInfo, {
    filename: '11-webmcp-adaptive-replan.mp4',
    purpose: 'Show the agent observing the changed design space and requesting a different verified design.',
    fixture: 'Continental Service Network',
    actions: ['Begin from stale locked proposal', 'Agent inspect_plan sees the lock', 'Re-analyze current plan', 'Run propose_mitigation again', 'Show adaptive verified design'],
    webmcpTools: ['inspect_plan', 'analyze_plan', 'propose_mitigation'],
    engineering: ['Level 4 adaptive design', 'Human-lock enforcement', 'Independent verification'],
    minDurationSec: 9,
    maxDurationSec: 24,
  });
  const { proposalLinkId } = await seedFlagshipProposal(page, true);
  await selectLink(page, proposalLinkId);
  await page.getByTestId(`lock-link-${proposalLinkId}`).check();
  await expect(page.getByTestId('candidate-proposals')).toContainText(/Stale · needs replanning/i);
  capture.markStart();
  await pauseForViewer(900);
  const locked = await executeNative<Record<string, any>>(page, 'inspect_plan');
  expect(locked.restrictions.lockedLinkIds).toContain(proposalLinkId);
  await pauseForViewer(700);
  const analysis = await executeNative<Record<string, any>>(page, 'analyze_plan');
  expect(analysis.verdict).toBe('FAIL');
  await pauseForViewer(700);
  const second = await executeNative<Record<string, any>>(page, 'propose_mitigation');
  expect(second.mode).toBe('adaptive-design');
  expect(second.verification).toBe('verified');
  await expect(page.getByTestId('network-design-summary')).toContainText(/VERIFIED/i, { timeout: 60_000 });
  await pauseForViewer(5_000);
  await capture.finish({ lockedModificationTarget: proposalLinkId, replanMode: second.mode, replanVerification: second.verification });
});

sceneTest(12, 'current FAIL and proposed VERIFIED are visibly separate', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const capture = createClipCapture(page, testInfo, {
    filename: '12-verified-proposed-design.mp4',
    purpose: 'Hold the key decision state: failing current plan alongside a separate verified proposal awaiting human review.',
    fixture: 'Continental Service Network',
    actions: ['Prepare human lock and adaptive replan', 'Show Current plan · FAIL', 'Show Proposed design · VERIFIED', 'Hold not-applied boundary'],
    webmcpTools: ['propose_mitigation'],
    engineering: ['Current/proposed state separation', 'Verified proposal lifecycle'],
    minDurationSec: 6,
    maxDurationSec: 11,
  });
  const { proposalLinkId } = await seedFlagshipProposal(page, true);
  await lockAndAdaptiveReplan(page, proposalLinkId);
  await expect(page.getByTestId('current-plan-state')).toContainText(/Current plan/i);
  await expect(page.getByTestId('current-plan-state')).toContainText('FAIL');
  await expect(page.getByTestId('network-design-summary')).toContainText(/Proposed design/i);
  await expect(page.getByTestId('network-design-summary')).toContainText(/VERIFIED/i);
  await expect(page.getByTestId('network-design-summary')).toContainText(/not applied/i);
  capture.markStart();
  await page.mouse.move(1510, 970, { steps: 14 });
  await pauseForViewer(6_800);
  await capture.finish({ lockedModificationTarget: proposalLinkId });
});

sceneTest(13, 'verification evidence detail', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const capture = createClipCapture(page, testInfo, {
    filename: '13-verification-evidence-detail.mp4',
    purpose: 'Show the judge-facing verification hierarchy and the verified-not-applied trust boundary.',
    fixture: 'Continental Service Network',
    actions: ['Prepare adaptive verified proposal', 'Open Analysis', 'Open Evidence', 'Show VERIFIED, peak utilization, passed checks, scenario coverage, and independent verification'],
    webmcpTools: ['verify_plan'],
    engineering: ['Independent reconstructed verification', 'Scenario coverage', 'Decision evidence'],
    minDurationSec: 7,
    maxDurationSec: 14,
  });
  const { proposalLinkId } = await seedFlagshipProposal(page, true);
  await lockAndAdaptiveReplan(page, proposalLinkId);
  capture.markStart();
  await pauseForViewer(900);
  await moveAndClick(page, page.getByTestId('nav-analysis'));
  await moveAndClick(page, page.getByTestId('analysis-tab-evidence'));
  await expect(page.getByTestId('adaptive-design-evidence')).toContainText('VERIFIED');
  await expect(page.getByTestId('adaptive-design-evidence')).toContainText(/Independent verification passed/i);
  await expect(page.getByTestId('adaptive-design-evidence')).toContainText(/Verified does not mean applied/i);
  await pauseForViewer(6_000);
  await capture.finish({ lockedModificationTarget: proposalLinkId });
});

sceneTest(14, '500-node browser-scale workspace', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const capture = createClipCapture(page, testInfo, {
    filename: '14-500-node-scale.mp4',
    purpose: 'Show real browser interaction and worker-backed analysis on the 500-node scale fixture.',
    fixture: 'National Backbone Scale Test / Tier C',
    actions: ['Open 500-node Canvas topology', 'Show 500/1,200/400 counts', 'Zoom', 'Select n-0320', 'Run worker-backed deterministic analysis'],
    webmcpTools: [],
    engineering: ['Canvas renderer', 'Worker-backed deterministic analysis', 'Tier C scale fixture'],
    benchmarkNumbers: ['500 nodes', '1,200 links', '400 demands'],
    minDurationSec: 9,
    maxDurationSec: 18,
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
  await expect(page.getByTestId('network-scale')).toContainText('1200');
  await expect(page.getByTestId('network-scale')).toContainText('400');
  await expect(page.getByTestId('topology-canvas')).toHaveAttribute('data-renderer', 'canvas');
  capture.markStart();
  await pauseForViewer(1_500);
  await moveAndClick(page, page.getByTestId('zoom-out'));
  await pauseForViewer(500);
  await page.getByTestId('topology-search').fill('n-0320');
  await pauseForViewer(500);
  await moveAndClick(page, page.getByTestId('search-result-node-n-0320'));
  await expect(page.getByTestId('object-inspector')).toContainText('n-0320');
  await pauseForViewer(1_000);
  await moveAndClick(page, page.getByTestId('analyze-plan'));
  await expect(page.getByTestId('capacity-analysis-status')).toContainText(/complete.*worker/i, { timeout: 60_000 });
  await pauseForViewer(5_000);
  await capture.finish();
});

sceneTest(15, 'native WebMCP diagnostics proof', async ({ page }, testInfo) => {
  const capture = createClipCapture(page, testInfo, {
    filename: '15-native-webmcp-diagnostics.mp4',
    purpose: 'Give technical judges concise visible proof of native WebMCP registration and successful browser execution.',
    fixture: 'Continental Service Network',
    actions: ['Execute inspect_workspace through document.modelContext', 'Open Advanced', 'Show Connected status, registered capabilities, and successful activity'],
    webmcpTools: ['inspect_workspace'],
    engineering: ['Native document.modelContext', 'Dynamic semantic capability registration', 'Successful tool activity'],
    minDurationSec: 6,
    maxDurationSec: 11,
  });
  await openProductionWorkspace(page);
  await waitForNativeTools(page, ['inspect_workspace']);
  const names = await nativeToolNames(page);
  expect(names).toContain('inspect_workspace');
  capture.markStart();
  await pauseForViewer(700);
  await executeNative(page, 'inspect_workspace');
  await pauseForViewer(500);
  await moveAndClick(page, page.getByTestId('advanced-toggle'));
  await expect(page.getByTestId('advanced-inspector')).toContainText(/Status:\s*registered/i);
  await expect(page.getByTestId('advanced-inspector')).toContainText(/registered capabilities/i);
  await expect(page.getByTestId('advanced-inspector')).toContainText('inspect_workspace');
  await expect(page.getByTestId('advanced-inspector')).toContainText(/Success/i);
  await pauseForViewer(5_300);
  await capture.finish({ registeredToolCount: names.length });
});
