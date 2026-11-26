import { defineConfig, devices } from '@playwright/test';

// §10 of the Package 4 request: real browser verification, not just Node
// VM tests. Points at the Vite dev server (already proxying /api and
// /data to dev-server.js, started separately — see docs/devlog/PACKAGE-04.md
// for the exact two-process run command) rather than webServer: {...},
// because this environment's two backing processes (Vite + dev-server.js)
// are managed outside Playwright's own lifecycle.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    // [Package 5] E2E_BASE_URL=http://localhost:4173 runs the same suite against `vite preview` (production bundle).
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
});
