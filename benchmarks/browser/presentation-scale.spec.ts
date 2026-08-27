import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { generateScaleProject, SCALE_TIERS } from '../../packages/scenarios/src/scale-generator.ts';

type PresentationOperation = 'initial-topology-render' | 'relayout' | 'fit-network' | 'search-focus' | 'pan-zoom' | 'lod-transition' | 'plan-state-highlighting';

interface PresentationMeasurement {
  fixture: string;
  tier: string;
  counts: { nodes: number; links: number; demands: number; regions: number };
  operation: PresentationOperation;
  runtimeMs: number;
  success: boolean;
  execution: 'main-thread';
  longestObservedMainThreadTaskMs: number;
  message?: string;
}

async function nextPaint(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function prepareImport(page: Page, project: ReturnType<typeof generateScaleProject>) {
  await page.goto('/');
  await page.getByTestId('import-json').click();
  await page.getByRole('button', { name: 'Canonical JSON' }).click();
  await page.getByTestId('json-import-file').setInputFiles({
    name: `${project.id}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByTestId('import-review')).toContainText(String(project.nodes.length));
}

test('Phase 3.5C SVG presentation scale benchmark', async ({ page, browserName, browser }) => {
  test.setTimeout(180_000);
  const measurements: PresentationMeasurement[] = [];
  await page.addInitScript(() => {
    const target = window as typeof window & { __phase35cPresentationLongTasks?: number[] };
    target.__phase35cPresentationLongTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) target.__phase35cPresentationLongTasks?.push(entry.duration);
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch { /* Long Tasks API is best-effort instrumentation. */ }
  });

  const measure = async (fixture: string, tier: string, counts: PresentationMeasurement['counts'], operation: PresentationOperation, fn: () => Promise<void>) => {
    const start = performance.now();
    await fn();
    const longestObservedMainThreadTaskMs = await page.evaluate(() => Math.max(0, ...(((window as typeof window & { __phase35cPresentationLongTasks?: number[] }).__phase35cPresentationLongTasks) ?? [])));
    measurements.push({ fixture, tier, counts, operation, runtimeMs: performance.now() - start, success: true, execution: 'main-thread', longestObservedMainThreadTaskMs });
  };

  for (const tier of SCALE_TIERS.filter((item) => ['A', 'B', 'C'].includes(item.id))) {
    const project = generateScaleProject({ ...tier, seed: 3721 + tier.id.charCodeAt(0), routingMode: 'single-shortest-path', workload: 'concentrated-sources', sourceConcentration: Math.max(8, Math.ceil(tier.nodes * 0.06)), upgradeOptionDensity: 0.3 });
    const counts = { nodes: tier.nodes, links: tier.links, demands: tier.demands, regions: tier.regions };
    const fixture = `Tier ${tier.id} SVG workspace`;
    await prepareImport(page, project);
    await measure(fixture, tier.id, counts, 'initial-topology-render', async () => {
      await page.getByTestId('open-imported-network').click();
      await expect(page.getByTestId('topology-workspace')).toBeVisible();
      await expect(page.getByTestId('network-scale')).toContainText(String(tier.nodes));
      await nextPaint(page);
    });
    await measure(fixture, tier.id, counts, 'relayout', async () => { await page.getByTestId('relayout').click(); await nextPaint(page); });
    await measure(fixture, tier.id, counts, 'fit-network', async () => { await page.getByTestId('fit-network').click(); await nextPaint(page); });
    const searchNode = `n-${String(Math.floor(tier.nodes * 0.64)).padStart(4, '0')}`;
    await measure(fixture, tier.id, counts, 'search-focus', async () => {
      await page.getByTestId('topology-search').fill(searchNode);
      await page.getByTestId(`search-result-node-${searchNode}`).click();
      await expect(page.getByTestId('object-inspector')).toContainText(searchNode);
      await nextPaint(page);
    });
    await measure(fixture, tier.id, counts, 'pan-zoom', async () => { await page.getByTestId('zoom-out').click(); await page.getByTestId('zoom-in').click(); await nextPaint(page); });
    await measure(fixture, tier.id, counts, 'lod-transition', async () => {
      await page.getByTestId('reset-view').click();
      for (let index = 0; index < 4; index += 1) await page.getByTestId('zoom-in').click();
      await expect(page.getByTestId('topology-canvas')).toHaveAttribute('data-lod', 'in');
      await nextPaint(page);
    });
    await measure(fixture, tier.id, counts, 'plan-state-highlighting', async () => {
      await page.getByTestId('topology-search').fill('l-00000');
      await page.getByTestId('search-result-link-l-00000').click();
      await page.getByTestId('plan-link-outage-l-00000').click();
      await expect(page.getByTestId('plan-change-list')).toContainText('l-00000');
      await page.getByTestId('display-mode-change-plan').check();
      await nextPaint(page);
    });
  }

  const tierD = SCALE_TIERS.find((tier) => tier.id === 'D')!;
  measurements.push({
    fixture: 'Tier D SVG workspace', tier: 'D', counts: { nodes: tierD.nodes, links: tierD.links, demands: tierD.demands, regions: tierD.regions },
    operation: 'initial-topology-render', runtimeMs: 0, success: false, execution: 'main-thread', longestObservedMainThreadTaskMs: 0,
    message: 'Not feasible through the canonical browser import boundary: Tier D has 750 nodes while the current canonical model limit remains 500 nodes. This is a model-limit boundary, not a measured renderer crash.',
  });

  const context = {
    generatedAt: new Date().toISOString(), browserName, browserVersion: browser.version(),
    userAgent: await page.evaluate(() => navigator.userAgent), viewport: page.viewportSize(),
    platform: process.platform, arch: process.arch, cpuCount: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? 'unknown',
    totalMemoryBytes: os.totalmem(), commit: process.env.GITHUB_SHA ?? 'local', benchmarkKind: 'phase35c-svg-presentation-scale',
  };
  mkdirSync('benchmark-results', { recursive: true });
  writeFileSync('benchmark-results/presentation-scale.json', `${JSON.stringify({ context, measurements }, null, 2)}\n`, 'utf8');
  console.log(`SVG presentation benchmark: ${measurements.map((row) => `${row.tier}/${row.operation}=${row.success ? `${row.runtimeMs.toFixed(1)}ms` : 'not-feasible'}`).join(' · ')}`);
});
