import { test, expect, type Page, type Route } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

// [Package 5] Error handling, coverage notice, ingredient-source labels,
// GREEN wording, stale-result clearing, translation caching and layout
// checks. Mock APIs only (no real Gemini call).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TINY = path.join(__dirname, 'fixtures/tiny.png');
const MENU = path.join(__dirname, 'fixtures/menu-sample.jpg');

function dish(foodId: string, nameEn: string, nameKo: string, allergens: string[], extra: Record<string, unknown> = {}) {
  return {
    foodId,
    name: `${nameEn} (${nameKo})`,
    nameKo,
    nameEn,
    ingredients: 'tofu, pork, chili paste',
    allergens,
    crossContactAllergens: [],
    spicy: 2,
    eatingMethod: ['Eat with rice.'],
    description: 'A stew.',
    culturalNote: '',
    ingredientSource: 'inferred',
    ...extra,
  };
}

function analyzeBody(dishes: unknown[], coverage?: unknown) {
  return JSON.stringify({ dishes, analysisId: `a-${Math.random()}`, validationStatus: 'valid', ...(coverage ? { coverage } : {}) });
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({ status, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) });
}

async function gotoScanner(page: Page) {
  await page.getByRole('button', { name: /Get Started/i }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
}

async function scan(page: Page, file = TINY) {
  await page.locator('input[type=file]').setInputFiles(file);
  await page.getByRole('button', { name: /Scan Menu Here/i }).click();
}

test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.route('**/api/translate-dish', (route) => fulfillJson(route, 200, { translationSchemaVersion: '1.0.0', targetLanguage: 'en', translationsByFoodId: {}, validationIssues: [] }));
});

test('quota error (429) shows a plain message and a Try Again button that recovers', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/analyze-menu', (route) => {
    calls++;
    if (calls === 1) return fulfillJson(route, 429, { error: 'quota', code: 'AI_QUOTA', retryable: true });
    return fulfillJson(route, 200, analyzeBody([dish('kimchi-jjigae', 'Kimchi Jjigae', '김치찌개', ['pork'])]));
  });
  await gotoScanner(page);
  await scan(page);

  await expect(page.getByText('Too many analysis requests right now', { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('analyze-menu failed')).toHaveCount(0); // no raw developer string
  await page.screenshot({ path: 'screenshots/p5-01-error-quota-retry.png', fullPage: true });

  await page.getByRole('button', { name: 'Try Again' }).click();
  await expect(page.getByText('Kimchi Jjigae (김치찌개)')).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(calls).toBe(2);
});

test('non-retryable error (output truncated) shows guidance and no Try Again button', async ({ page }) => {
  await page.route('**/api/analyze-menu', (route) => fulfillJson(route, 502, { error: 'cut', code: 'AI_OUTPUT_TRUNCATED', retryable: false }));
  await gotoScanner(page);
  await scan(page);
  await expect(page.getByText('too many items to analyze at once', { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(0);
  // Developer diagnostic is available but collapsed.
  await expect(page.getByText('Technical details')).toBeVisible();
});

test('network failure (server unreachable) shows a connection message', async ({ page }) => {
  await page.route('**/api/analyze-menu', (route) => route.abort('connectionrefused'));
  await gotoScanner(page);
  await scan(page);
  await expect(page.getByText('Could not connect', { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
});

test('a failed new analysis never shows the previous photo result', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/analyze-menu', (route) => {
    calls++;
    if (calls === 1) return fulfillJson(route, 200, analyzeBody([dish('old', 'Old Dish', '이전요리', [])]));
    return fulfillJson(route, 503, { error: 'down', code: 'AI_UNAVAILABLE', retryable: true });
  });
  await gotoScanner(page);
  await scan(page, TINY);
  await expect(page.getByText('Old Dish (이전요리)')).toBeVisible({ timeout: 10000 });

  // The reset button under the result is labelled "Add a Menu Photo".
  await page.getByRole('button', { name: 'Add a Menu Photo' }).last().click();
  await scan(page, MENU);
  await expect(page.getByText('temporarily unavailable', { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Old Dish (이전요리)')).toHaveCount(0);
});

test('menu coverage notice + ingredient-source label are shown for a partial menu', async ({ page }) => {
  const dishes = [
    dish('kimchi-jjigae', 'Kimchi Jjigae', '김치찌개', ['pork', 'soybean']),
    dish('doenjang-jjigae', 'Doenjang Jjigae', '된장찌개', ['soybean']),
  ];
  await page.route('**/api/analyze-menu', (route) =>
    fulfillJson(route, 200, analyzeBody(dishes, { returnedCount: 2, visibleItemCount: 14, maxDishes: 10, isComplete: false }))
  );
  await gotoScanner(page);
  await scan(page, MENU);
  await expect(page.getByText('Showing 2 of about 14 items', { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('AI estimates based on the dish name', { exact: false })).toBeVisible();
  await expect(page.getByText('AI estimate', { exact: true })).toHaveCount(2);
  await page.screenshot({ path: 'screenshots/p5-02-menu-coverage.png', fullPage: true });
});

test('GREEN result is worded as "no match", never as guaranteed safe', async ({ page }) => {
  await page.route('**/api/analyze-menu', (route) => fulfillJson(route, 200, analyzeBody([dish('rice', 'Rice', '공기밥', [], { spicy: 0 })])));
  await gotoScanner(page);
  await scan(page);
  await expect(page.getByText('No Match With Your Profile')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('not a safety guarantee', { exact: false })).toBeVisible();
  await expect(page.getByText(/align perfectly/i)).toHaveCount(0);
});

test('language switch translates once and reuses the cached translation', async ({ page }) => {
  let translateCalls = 0;
  await page.unroute('**/api/translate-dish');
  await page.route('**/api/translate-dish', (route) => {
    translateCalls++;
    const lang = JSON.parse(route.request().postData() || '{}').targetLanguage;
    return fulfillJson(route, 200, {
      translationSchemaVersion: '1.0.0',
      targetLanguage: lang,
      translationsByFoodId: { 'kimchi-jjigae': { translatedName: 'キムチチゲ', ingredients: '豆腐', eatingMethod: ['ご飯と'], description: '鍋', culturalNote: '' } },
      validationIssues: [],
    });
  });
  await page.route('**/api/analyze-menu', (route) => fulfillJson(route, 200, analyzeBody([dish('kimchi-jjigae', 'Kimchi Jjigae', '김치찌개', ['pork'])])));
  await gotoScanner(page);
  await scan(page);
  await expect(page.getByText('Kimchi Jjigae (김치찌개)')).toBeVisible({ timeout: 10000 });

  const switchLang = async (label: string) => {
    await page.locator('header button').click(); // profile button (label changes with language)
    await page.getByRole('radio', { name: new RegExp(label) }).click();
    await page.locator('[aria-label="Close"]').click();
  };
  await switchLang('日本語');
  await expect(page.getByText('キムチチゲ (김치찌개)')).toBeVisible({ timeout: 10000 });
  expect(translateCalls).toBe(1);
  // Knowledge-DB lookup still uses the English canonical ingredients, so the
  // translated word (豆腐) is never reported as a 'not found in DB' ingredient.
  const notFoundLine = page.locator('p', { hasText: '知識DBに見つからない' });
  if (await notFoundLine.count()) await expect(notFoundLine.first()).not.toContainText('豆腐');
  await switchLang('English');
  await expect(page.getByText('Kimchi Jjigae (김치찌개)')).toBeVisible();
  await switchLang('日本語');
  await expect(page.getByText('キムチチゲ (김치찌개)')).toBeVisible();
  expect(translateCalls).toBe(1);
});

test('no horizontal page scroll on any tab, and the menu preview is not cropped', async ({ page }) => {
  await gotoScanner(page);
  await page.locator('input[type=file]').setInputFiles(MENU);
  const preview = page.locator('img[alt="Add a Menu Photo"]');
  await expect(preview).toBeVisible();
  expect(await preview.evaluate((el) => getComputedStyle(el).objectFit)).toBe('contain');
  await page.screenshot({ path: 'screenshots/p5-03-menu-preview.png', fullPage: true });

  for (const tab of ['Map', 'Menu', 'Exchange']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${tab}`).toBeLessThanOrEqual(0);
  }
});

test('keyboard: skip link is the first Tab stop and the scan controls are reachable', async ({ page }) => {
  await page.getByRole('button', { name: /Get Started/i }).click();
  await page.reload(); // fresh focus at the top of the document
  await page.keyboard.press('Tab');
  await expect(page.getByText('Skip to content')).toBeFocused();

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  // From the bottom nav, Shift+Tab walks back into the scanner controls.
  let reached = false;
  for (let i = 0; i < 8 && !reached; i++) {
    await page.keyboard.press('Shift+Tab');
    reached = await page.evaluate(() => document.activeElement?.textContent?.includes('Add a Menu Photo') ?? false);
  }
  expect(reached).toBe(true);
});