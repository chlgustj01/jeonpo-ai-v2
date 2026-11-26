import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

// [Package 5] REAL Gemini end-to-end check — NOT part of the default suite.
// Runs only with REAL_GEMINI=1 and a backend that has GEMINI_API_KEY set.
// Costs 1 analysis call + 1 translation call per fresh backend process
// (the server caches both by image hash, so the second project reuses them).
//
//   REAL_GEMINI=1 E2E_BASE_URL=http://localhost:4173 npx playwright test e2e/real-gemini.spec.ts
//
// Fixture: e2e/fixtures/menu-sample.jpg is a synthetic 9-item Korean menu
// board rendered for this project (not a real restaurant's menu).
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.skip(!process.env.REAL_GEMINI, 'real Gemini check runs only with REAL_GEMINI=1');
test.setTimeout(120_000);

test('real Gemini: 9-item Korean menu board is analyzed and translated', async ({ page }, testInfo) => {
  const analyzeStatuses: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/analyze-menu')) analyzeStatuses.push(r.status());
  });

  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: /Get Started/i }).click();

  // Peanut + soybean in the profile, so the result shows a real RED match.
  await page.locator('header button').click();
  await page.getByText('Soybean', { exact: false }).first().click();
  await page.locator('[aria-label="Close"]').click();

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(path.join(__dirname, 'fixtures/menu-sample.jpg'));
  await page.getByRole('button', { name: /Scan Menu Here/i }).click();

  await expect(page.getByText(/김치찌개/).first()).toBeVisible({ timeout: 90_000 });
  expect(analyzeStatuses).toEqual([200]);
  for (const name of ['된장찌개', '부대찌개', '순두부찌개', '청국장', '낙지볶음', '오징어볶음', '제육볶음', '돌솥비빔밥']) {
    await expect(page.getByText(new RegExp(name)).first()).toBeVisible();
  }
  await expect(page.getByText('RED', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: `screenshots/final-real-menu-${testInfo.project.name}.png`, fullPage: true });

  // Language switch -> real translate-dish call (or server cache).
  await page.locator('header button').click();
  await page.getByRole('radio', { name: /日本語/ }).click();
  await page.locator('[aria-label="Close"]').click();
  await expect(page.getByText(/キムチ/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/翻訳に失敗/)).toHaveCount(0);
  await page.screenshot({ path: `screenshots/final-real-menu-ja-${testInfo.project.name}.png`, fullPage: false });
});
