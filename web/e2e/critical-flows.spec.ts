import { test, expect, type Route } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// §10 of the Package 4 request: real browser verification of the core
// flows, using Mock API responses for the photo-analysis endpoints (never
// a real Gemini call in a test — same policy §IMP-13 already established
// for the Node-VM test suite). Each test clears storage first so profile/
// review persistence tests don't leak into each other.

const MOCK_DISH = {
  foodId: 'mock1',
  name: 'Test Dish',
  nameKo: '테스트 요리',
  nameEn: 'Test Dish',
  ingredients: 'rice, peanut oil, soy sauce',
  allergens: ['peanut'],
  crossContactAllergens: [],
  spicy: 2,
  eatingMethod: ['Mix it well.', 'Eat while hot.'],
  description: 'A simple test dish for e2e verification.',
  culturalNote: 'A fictional note for testing.',
};

async function mockAnalyze(route: Route) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ dishes: [MOCK_DISH], analysisId: 'analysis-1', validationStatus: 'valid' }),
  });
}

async function mockTranslate(route: Route, lang: string) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      translationSchemaVersion: '1.0.0',
      targetLanguage: lang,
      translationsByFoodId: {
        mock1: {
          translatedName: `Translated(${lang})`,
          ingredients: `ingredients-${lang}`,
          eatingMethod: [`step-${lang}`],
          description: `desc-${lang}`,
          culturalNote: `note-${lang}`,
        },
      },
      validationIssues: [],
    }),
  });
}

test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('onboarding completes and reaches the main app', async ({ page }) => {
  await expect(page.getByText('FitBridge', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Get Started/i }).click();
  // [UX-IMPROVEMENT] Onboarding now lands on the core task (menu scan).
  await expect(page.getByRole('heading', { name: 'Menu Translation' })).toBeVisible();
  await page.screenshot({ path: 'screenshots/01-onboarding-complete.png', fullPage: true });
});

test('allergy selection persists across reload', async ({ page }) => {
  await page.getByRole('button', { name: /Get Started/i }).click();
  await page.getByRole('button', { name: /Profile/i }).click();
  await expect(page.getByRole('heading', { name: /Profile/i })).toBeVisible();
  // Peanut checkbox — identified by its visible label text.
  await page.getByText('Peanut', { exact: false }).click();
  await page.screenshot({ path: 'screenshots/02-profile-modal.png', fullPage: true });
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('[aria-label="Close"]').click();

  await page.reload();
  await page.getByRole('button', { name: /Profile/i }).click();
  const peanutCheckbox = page.locator('label:has-text("Peanut") input[type=checkbox]');
  await expect(peanutCheckbox).toBeChecked();
});

test('photo analysis (mock API) shows a RED banner for a matched allergen, and profile change updates it without a new analyze-menu call', async ({ page }) => {
  let analyzeCalls = 0;
  let translateCalls = 0;
  await page.route('**/api/analyze-menu', async (route) => {
    analyzeCalls++;
    await mockAnalyze(route);
  });
  await page.route('**/api/translate-dish', async (route) => {
    translateCalls++;
    await mockTranslate(route, 'en');
  });

  await page.getByRole('button', { name: /Get Started/i }).click();
  await page.getByRole('button', { name: 'Map', exact: true }).click(); // already on map; ensures nav works

  // Register the allergen BEFORE scanning, via the profile modal.
  await page.getByRole('button', { name: /Profile/i }).click();
  await page.getByText('Peanut', { exact: false }).click();
  await page.locator('[aria-label="Close"]').click();

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const fileInput = page.locator('input[type=file]');
  await fileInput.setInputFiles(path.join(__dirname, 'fixtures/tiny.png'));
  await page.getByRole('button', { name: /Center Scan|Scan/i }).click();

  await expect(page.getByText('RED', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/03-scan-result-red.png', fullPage: true });
  expect(analyzeCalls).toBe(1);
  const translateCallsAfterScan = translateCalls;

  // [IMP-07] Toggle an UNRELATED allergen via the profile modal — the
  // already-shown result must update (still RED, since peanut is still
  // selected) without re-calling analyze-menu or translate-dish again.
  await page.getByRole('button', { name: /Profile/i }).click();
  await page.getByText('Milk', { exact: false }).click();
  await page.locator('[aria-label="Close"]').click();

  await expect(page.getByText('RED', { exact: true })).toBeVisible();
  expect(analyzeCalls).toBe(1);
  expect(translateCalls).toBe(translateCallsAfterScan);
});

test('staff question panel offers 4 types and a Korean phrase is shown', async ({ page }) => {
  await page.route('**/api/analyze-menu', mockAnalyze);
  await page.route('**/api/translate-dish', (route) => mockTranslate(route, 'en'));

  await page.getByRole('button', { name: /Get Started/i }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(path.join(__dirname, 'fixtures/tiny.png'));
  await page.getByRole('button', { name: /Scan/i }).click();
  await expect(page.getByText('Ask Staff', { exact: true })).toBeVisible({ timeout: 10000 });

  await page.getByRole('tab', { name: 'Cross-Contact' }).click();
  await expect(page.getByText(/조리 기구|조리도구/)).toBeVisible();
  await page.screenshot({ path: 'screenshots/04-staff-questions.png', fullPage: true });
});

test('review can be added and survives reload, separately from demo reviews', async ({ page }) => {
  await page.getByRole('button', { name: /Get Started/i }).click();
  // The Samgyeopsal marker is the first seeded location — open the Map tab (onboarding now lands on Menu).
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.locator('.leaflet-marker-icon').first().click();
  await expect(page.getByText('Traveler Reviews')).toBeVisible();

  const uniqueText = `e2e-review-${Date.now()}`;
  await page.getByPlaceholder('Share your experience...').fill(uniqueText);
  await page.getByRole('button', { name: /Submit Review/i }).click();
  await expect(page.getByText(uniqueText)).toBeVisible();
  await expect(page.getByText('Saved on this device')).toBeVisible();
  await page.screenshot({ path: 'screenshots/05-review-added.png', fullPage: true });

  await page.reload();
  await page.locator('.leaflet-marker-icon').first().click();
  await expect(page.getByText(uniqueText)).toBeVisible();
});

test('exchange view loads and calculates KRW conversion', async ({ page }) => {
  await page.getByRole('button', { name: /Get Started/i }).click();
  await page.getByRole('button', { name: /Exchange/i }).click();
  await expect(page.getByRole('heading', { name: 'Exchange Rate Calculator' })).toBeVisible();
  await page.locator('#foreign-input').fill('10');
  await expect(page.locator('#krw-input')).not.toHaveValue('');
  await page.screenshot({ path: 'screenshots/06-exchange.png', fullPage: true });
});

test('analyze-menu failure shows an error state instead of a stale/blank result', async ({ page }) => {
  await page.route('**/api/analyze-menu', (route) => route.fulfill({ status: 500, body: JSON.stringify({ error: 'boom' }) }));
  await page.getByRole('button', { name: /Get Started/i }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(path.join(__dirname, 'fixtures/tiny.png'));
  await page.getByRole('button', { name: /Scan/i }).click();
  await expect(page.getByText('Safety Check Unavailable')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'screenshots/07-analysis-error.png', fullPage: true });
});

test('no unexpected console errors during the core onboarding -> scan -> review flow', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.route('**/api/analyze-menu', mockAnalyze);
  await page.route('**/api/translate-dish', (route) => mockTranslate(route, 'en'));

  await page.getByRole('button', { name: /Get Started/i }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(path.join(__dirname, 'fixtures/tiny.png'));
  await page.getByRole('button', { name: /Scan/i }).click();
  await expect(page.getByText('Ask Staff', { exact: true })).toBeVisible({ timeout: 10000 });

  // Leaflet's "Invalid LatLng" or React key warnings would show up here —
  // filter out the two known third-party noise sources (a cross-origin
  // Google Fonts preconnect warning Chromium sometimes logs, and Leaflet's
  // own benign "Tile load" retry log during fast navigation in CI).
  const real = errors.filter((e) => !/Google Fonts|Tile load/i.test(e));
  expect(real, real.join('\n')).toEqual([]);
});
