import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { generateScaleProject } from '../../packages/scenarios/src/scale-generator.ts';

interface BrowserMeasurement {
  fixture: string;
  counts: { nodes: number; links: number; demands: number; regions: number };
  routingMode: string;
  operation: string;
  runtimeMs: number;
  execution: string;
  success: boolean;
  longestObservedMainThreadTaskMs?: number;
  optimizationSize?: number;
}

test('Phase 3.5C reproducible Chromium scale benchmark', async ({ page, browserName, browser }) => {
  const measurements: BrowserMeasurement[] = [];
  await page.addInitScript(() => {
    const target = window as typeof window & { __phase35cLongTasks?: number[] };
    target.__phase35cLongTasks = [];
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) target.__phase35cLongTasks?.push(entry.duration);
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch { /* Long Tasks API is best-effort instrumentation. */ }
    }
  });
  const timed = async (fixture: string, counts: BrowserMeasurement['counts'], routingMode: string, operation: string, execution: string, fn: () => Promise<void>, optimizationSize?: number) => {
    const start = performance.now();
    try {
      await fn();
      measurements.push({ fixture, counts, routingMode, operation, runtimeMs: performance.now() - start, execution, success: true, ...(optimizationSize === undefined ? {} : { optimizationSize }) });
    } catch (error) {
      measurements.push({ fixture, counts, routingMode, operation, runtimeMs: performance.now() - start, execution, success: false, ...(optimizationSize === undefined ? {} : { optimizationSize }) });
      throw error;
    }
  };

  const nationalCounts = { nodes: 500, links: 1200, demands: 400, regions: 12 };
  await timed('National Backbone Scale Test', nationalCounts, 'single-shortest-path', 'initial-topology-render', 'main-thread', async () => {
    await page.goto('/');
    await page.getByTestId('scenario-national-backbone-scale-test').click();
    await expect(page.getByTestId('topology-workspace')).toBeVisible();
    await expect(page.getByTestId('network-scale')).toContainText('500');
  });
  await timed('National Backbone Scale Test', nationalCounts, 'single-shortest-path', 'fit-network', 'main-thread', async () => {
    await page.getByTestId('fit-network').click();
  });
  await timed('National Backbone Scale Test', nationalCounts, 'single-shortest-path', 'search-focus', 'main-thread', async () => {
    await page.getByTestId('topology-search').fill('n-0321');
    await page.getByTestId('search-result-node-n-0321').click();
    await expect(page.getByTestId('object-inspector')).toContainText('n-0321');
  });
  await timed('National Backbone Scale Test', nationalCounts, 'single-shortest-path', 'zoom-interaction', 'main-thread', async () => {
    const before = await page.getByTestId('viewport-readout').textContent();
    await page.getByTestId('zoom-in').click();
    await expect(page.getByTestId('viewport-readout')).not.toHaveText(before ?? '');
  });
  await timed('National Backbone Scale Test', nationalCounts, 'single-shortest-path', 'changeplan-analysis', 'main-thread', async () => {
    await page.getByTestId('analyze-plan').click();
    await expect(page.getByTestId('capacity-analysis-status')).toContainText(/COMPLETE/i);
  });

  const workerProject = generateScaleProject({ id: 'C', name: 'chromium-worker-probe', ...nationalCounts, seed: 3599, routingMode: 'ecmp', workload: 'unique-sources', sourceConcentration: 500, upgradeOptionDensity: 0.25 });
  await page.getByTestId('import-json').click();
  await page.getByTestId('json-import-file').setInputFiles({ name: 'chromium-worker-probe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(workerProject)) });
  await page.getByTestId('open-imported-network').click();
  await expect(page.getByTestId('compute-profile')).toContainText('Worker preferred');
  const workerStart = performance.now();
  await page.getByTestId('analyze-plan').click();
  await expect(page.getByTestId('capacity-analysis-status')).toContainText(/RUNNING.*worker/i, { timeout: 5_000 });
  const interactionStart = performance.now();
  await page.getByTestId('zoom-in').click();
  measurements.push({ fixture: 'Tier C unique-source Worker probe', counts: nationalCounts, routingMode: 'ecmp', operation: 'interaction-during-analysis', runtimeMs: performance.now() - interactionStart, execution: 'worker', success: true });
  await expect(page.getByTestId('capacity-analysis-status')).toContainText(/COMPLETE.*worker/i, { timeout: 30_000 });
  measurements.push({ fixture: 'Tier C unique-source Worker probe', counts: nationalCounts, routingMode: 'ecmp', operation: 'worker-changeplan-analysis', runtimeMs: performance.now() - workerStart, execution: 'worker', success: true });

  const longest = await page.evaluate(() => Math.max(0, ...(((window as typeof window & { __phase35cLongTasks?: number[] }).__phase35cLongTasks) ?? [])));
  for (const row of measurements) row.longestObservedMainThreadTaskMs = longest;
  const context = {
    generatedAt: new Date().toISOString(),
    browserName,
    browserVersion: browser.version(),
    userAgent: await page.evaluate(() => navigator.userAgent),
    viewport: page.viewportSize(),
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    totalMemoryBytes: os.totalmem(),
    commit: process.env.GITHUB_SHA ?? 'local',
  };
  mkdirSync('benchmark-results', { recursive: true });
  writeFileSync('benchmark-results/browser-scale.json', `${JSON.stringify({ context, measurements }, null, 2)}\n`, 'utf8');
  console.log(`Chromium scale benchmark: ${measurements.map((row) => `${row.operation}=${row.runtimeMs.toFixed(1)}ms`).join(' · ')}`);
});
