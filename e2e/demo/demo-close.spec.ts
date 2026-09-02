import { test, expect } from '@playwright/test';
import {
  createClipCapture,
  lockAndAdaptiveReplan,
  pauseForViewer,
  seedFlagshipProposal,
} from './demo-helpers.ts';

test('17 — verified decision-state close', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const capture = createClipCapture(page, testInfo, {
    filename: '17-verified-decision-close.mp4',
    purpose: 'Purpose-built final shot: failing current plan, separate verified proposal, and explicit human-approval boundary remain visible together.',
    fixture: 'Continental Service Network',
    actions: [
      'Prepare adaptive verified proposal under a human modification lock',
      'Hold Current plan · FAIL beside Proposed design · VERIFIED',
      'Keep the verified-not-applied boundary visible for the closing narration',
    ],
    webmcpTools: ['inspect_plan', 'analyze_plan', 'propose_mitigation'],
    engineering: [
      'Human constraint preserved',
      'Independent verified proposal',
      'Human approval remains required',
    ],
    minDurationSec: 9,
    maxDurationSec: 14,
  });

  const { proposalLinkId } = await seedFlagshipProposal(page, true);
  await lockAndAdaptiveReplan(page, proposalLinkId);

  await expect(page.getByTestId('current-plan-state')).toContainText(/Current plan/i);
  await expect(page.getByTestId('current-plan-state')).toContainText('FAIL');
  await expect(page.getByTestId('network-design-summary')).toContainText(/Proposed design/i);
  await expect(page.getByTestId('network-design-summary')).toContainText(/VERIFIED/i);
  await expect(page.getByTestId('network-design-summary')).toContainText(/not applied/i);

  capture.markStart();
  await pauseForViewer(1_200);
  await page.mouse.move(1450, 355, { steps: 18 });
  await pauseForViewer(3_400);
  await page.mouse.move(1505, 610, { steps: 14 });
  await pauseForViewer(5_400);
  await capture.finish({ lockedModificationTarget: proposalLinkId });
});
