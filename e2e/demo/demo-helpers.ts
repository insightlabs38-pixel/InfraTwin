import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ClipMetadata {
  filename: string;
  purpose: string;
  fixture: string;
  actions: string[];
  webmcpTools: string[];
  engineering: string[];
  benchmarkNumbers?: string[];
  minDurationSec: number;
  maxDurationSec: number;
}

const RAW_DIR = 'raw';

export function shouldCapture(clip: number): boolean {
  const set = process.env.CAPTURE_SET ?? 'all';
  if (set === 'all') return true;
  if (set === 'core') return clip >= 1 && clip <= 5;
  if (set === 'webmcp') return [2, 3, 4, 7].includes(clip);
  if (set === 'scale') return clip === 6;
  return false;
}

export async function pauseForViewer(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForStableUI(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 80ms !important;
        animation-delay: 0ms !important;
        transition-duration: 80ms !important;
        transition-delay: 0ms !important;
        caret-color: transparent !important;
      }
      html { scroll-behavior: auto !important; }
    `,
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

export async function moveAndClick(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
    await pauseForViewer(180);
  }
  await locator.click();
}

export async function selectLink(page: Page, linkId: string): Promise<void> {
  const search = page.getByTestId('topology-search');
  await search.fill(linkId);
  await pauseForViewer(350);
  await moveAndClick(page, page.getByTestId(`search-result-link-${linkId}`));
  await expect(page.getByTestId(`link-inspector-${linkId}`)).toBeVisible();
}

export async function openProductionWorkspace(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('topology-canvas')).toBeVisible();
  await expect(page.getByTestId('network-selector')).toHaveValue('continental-service-network');
  await waitForStableUI(page);
}

export async function enableAdaptiveRouting(page: Page): Promise<void> {
  const constraints = page.getByTestId('plan-constraints').locator('summary').first();
  await moveAndClick(page, constraints);
  const checkbox = page.getByTestId('allow-routing-changes');
  await expect(checkbox).toBeVisible();
  if (!(await checkbox.isChecked())) await checkbox.check();
  await pauseForViewer(250);
  await moveAndClick(page, constraints);
}

type NativeTool = { name: string };
type NativeContext = {
  getTools(): Promise<NativeTool[]>;
  executeTool(tool: NativeTool, input: string, options?: { signal?: AbortSignal }): Promise<unknown>;
};

export async function nativeToolNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const context = (document as Document & { modelContext?: { getTools(): Promise<Array<{ name: string }>> } }).modelContext;
    if (!context?.getTools) throw new Error('Native document.modelContext.getTools() is unavailable.');
    return (await context.getTools()).map((tool) => tool.name).sort();
  });
}

export async function waitForNativeTools(page: Page, names: string[]): Promise<void> {
  await expect.poll(() => nativeToolNames(page), { timeout: 30_000 }).toEqual(expect.arrayContaining(names));
}

export async function executeNative<T = Record<string, unknown>>(page: Page, name: string, input: Record<string, unknown> = {}): Promise<T> {
  return page.evaluate(async ({ name, input }) => {
    const context = (document as Document & { modelContext?: NativeContext }).modelContext;
    if (!context?.getTools || !context.executeTool) throw new Error('Native WebMCP discovery/execution API is unavailable.');
    const tool = (await context.getTools()).find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Native WebMCP tool ${name} is not registered.`);
    const result = await context.executeTool(tool, JSON.stringify(input));
    if (typeof result === 'string') {
      try { return JSON.parse(result); } catch { return result; }
    }
    return result;
  }, { name, input }) as Promise<T>;
}

export function createClipCapture(page: Page, testInfo: TestInfo, metadata: ClipMetadata) {
  const recordingStartedAt = Date.now();
  let usefulStartedAt = 0;
  let usefulEndedAt = 0;

  return {
    markStart() {
      usefulStartedAt = Date.now();
    },
    async finish(extra: Record<string, unknown> = {}) {
      usefulEndedAt = Date.now();
      if (!usefulStartedAt) throw new Error(`Clip ${metadata.filename} never marked its useful start.`);
      const video = page.video();
      if (!video) throw new Error(`Video recording is unavailable for ${metadata.filename}.`);
      mkdirSync(RAW_DIR, { recursive: true });
      const base = metadata.filename.replace(/\.mp4$/i, '');
      const rawPath = join(RAW_DIR, `${base}.webm`);
      await page.close();
      await video.saveAs(rawPath);
      const timing = {
        ...metadata,
        rawFilename: `${base}.webm`,
        trimStartSec: Math.max(0, (usefulStartedAt - recordingStartedAt) / 1000),
        durationSec: Math.max(0.1, (usefulEndedAt - usefulStartedAt) / 1000),
        sourceCommit: process.env.GITHUB_SHA ?? 'local',
        generatedAutomatically: true,
        fakeOrSimulatedProductState: 'NONE',
        ...extra,
      };
      writeFileSync(join(RAW_DIR, `${base}.json`), `${JSON.stringify(timing, null, 2)}\n`, 'utf8');
      await testInfo.attach(`${base}-capture-metadata`, {
        body: Buffer.from(JSON.stringify(timing, null, 2)),
        contentType: 'application/json',
      });
    },
  };
}

export async function seedFlagshipFailure(page: Page): Promise<void> {
  await openProductionWorkspace(page);
  await waitForNativeTools(page, ['inspect_workspace', 'inspect_selection', 'add_plan_change', 'analyze_plan']);
  await selectLink(page, 'BB-NE-CE-01');
  await page.getByTestId('plan-link-outage-BB-NE-CE-01').click();
  const demandIds = Array.from({ length: 10 }, (_, index) => `PAY-NECE-${String(index + 1).padStart(2, '0')}`);
  await executeNative(page, 'add_plan_change', { type: 'demand_growth', demandIds, multiplier: 1.2 });
}

export async function seedFlagshipProposal(page: Page, enableAdaptive = true): Promise<{ proposalLinkId: string }> {
  await seedFlagshipFailure(page);
  if (enableAdaptive) await enableAdaptiveRouting(page);
  const analysis = await executeNative<Record<string, any>>(page, 'analyze_plan');
  if (analysis.verdict !== 'FAIL') throw new Error(`Expected flagship failure, got ${String(analysis.verdict)}.`);
  await waitForNativeTools(page, ['propose_mitigation']);
  const first = await executeNative<Record<string, any>>(page, 'propose_mitigation');
  if (first.mode !== 'capacity-only') throw new Error(`Expected initial capacity-only proposal, got ${String(first.mode)}.`);
  await expect(page.getByTestId('candidate-proposals')).toBeVisible({ timeout: 30_000 });
  const plan = await executeNative<Record<string, any>>(page, 'inspect_plan');
  const current = plan.proposals.filter((proposal: any) => !proposal.stale && proposal.state === 'pending');
  const linkProposal = current.find((proposal: any) => proposal.target?.kind === 'link');
  if (!linkProposal?.target?.id) throw new Error('No pending link proposal was produced for the flagship failure.');
  return { proposalLinkId: String(linkProposal.target.id) };
}

export async function lockAndAdaptiveReplan(page: Page, proposalLinkId: string): Promise<Record<string, any>> {
  await page.getByTestId('nav-network').click();
  await selectLink(page, proposalLinkId);
  await page.getByTestId(`lock-link-${proposalLinkId}`).check();
  await expect(page.getByTestId('candidate-proposals')).toContainText(/Stale · needs replanning/i);
  const locked = await executeNative<Record<string, any>>(page, 'inspect_plan');
  if (!locked.restrictions.lockedLinkIds.includes(proposalLinkId)) throw new Error(`Human lock on ${proposalLinkId} was not observed through WebMCP.`);
  await executeNative(page, 'analyze_plan');
  await waitForNativeTools(page, ['propose_mitigation']);
  const second = await executeNative<Record<string, any>>(page, 'propose_mitigation');
  if (second.mode !== 'adaptive-design') throw new Error(`Expected adaptive-design replan after locking ${proposalLinkId}, got ${String(second.mode)}.`);
  if (second.verification !== 'verified') throw new Error(`Adaptive replan was not verified: ${String(second.verification)}.`);
  const after = await executeNative<Record<string, any>>(page, 'inspect_plan');
  const current = after.proposals.filter((proposal: any) => !proposal.stale && proposal.state === 'pending');
  if (current.some((proposal: any) => proposal.target?.kind === 'link' && proposal.target.id === proposalLinkId)) {
    throw new Error(`Adaptive replan illegally reused locked modification target ${proposalLinkId}.`);
  }
  return second;
}
