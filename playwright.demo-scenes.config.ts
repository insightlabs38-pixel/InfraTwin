import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/demo',
  testMatch: ['demo-scenes.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [['list']],
  outputDir: 'demo-scene-test-results',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: false,
    viewport: { width: 1920, height: 1080 },
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: { mode: 'on', size: { width: 1920, height: 1080 } },
    launchOptions: {
      args: [
        '--enable-experimental-web-platform-features',
        '--enable-blink-features=WebMCP',
        '--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport',
      ],
    },
  },
  webServer: {
    command: 'npm run start',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { PORT: '3000' },
  },
  projects: [{ name: 'chromium-demo-scenes', use: { browserName: 'chromium' } }],
});
