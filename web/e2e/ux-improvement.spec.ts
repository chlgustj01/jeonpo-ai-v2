import { test, expect, type Page, type Route } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

// [UX-IMPROVEMENT] Per-dish risk, dish selection driving staff question /
// review, onboarding allergy step, map -> real scan with restaurant context,
// session restore + Back button, translation status, i18n fixes and the
// exchange-rate fallback label. Mock APIs only (no real Gemini call).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MENU = path.join(__dirname, 'fixtures/menu-sample.jpg');

function dish(nameEn: string, nameKo: string, allergens: string[], extra: Record<string, unknown> = {}) {
  return {
    foodId: nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: `${nameEn} (${nameKo})`,
    nameKo,
    nameEn,
    ingredients: 'tofu, sesame oil, green onions',
    allergens,
    crossContactAllergens: [],
    spicy: 1,
    eatingMethod: ['Eat with rice.'],
    description: 'A dish.',
    culturalNote: '',
    ingredientSource: 'inferred',
    ...extra,
  };
}

const THREE = [
  dish('Rice', '공기밥', [], { spicy: 0 }),
  dish('Peanut Noodles', '땅콩국수', ['peanut']),
  dish('Kimchi Stew', '김치찌개', ['soybean'], { spicy: 3 }),
];

async function mockAnalyze(page: Page, dishes: unknown[], analysisId = 'ux-1') {
  await page.route('**/api/analyze-menu', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dishes, analysisId, validationStatus: 'valid' }) })
  );
}

async function onboard(page: Page, allergyLabels: string[] = []) {
  for (const label of allergyLabels) await page.locator('[role=group] label', { hasText: label }).first().click();
  await page.getByRole('button', { name: /Get Started/i }).click();
}

async function scanMenu(page: Page) {
  await page.locator('input[type=file]').setInputFiles(MENU);
  await page.getByRole('button', { name: /Scan Menu Here/i }).click();
}

const staffText = (page: Page) => page.locator('#staff-question-panel .bg-white.rounded-lg.text-sm').first();

test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.route('**/api/translate-dish', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ translationSchemaVersion: '1.0.0', targetLanguage: 'en', translationsByFoodId: {}, validationIssues: [] }) })
  );
});

test('onboarding registers allergies and lands on the menu scanner', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Foods you must avoid' })).toBeVisible();
  await onboard(page, ['Peanut']);
  await expect(page.getByRole('heading', { name: 'Menu Translation' })).toBeVisible();
  await expect(page).toHaveURL(/#\/menu$/);
  await page.locator('header button').click();
  await expect(page.locator('label:has-text("Peanut") input[type=checkbox]')).toBeChecked();
});

test('"no allergies" is distinct from "not answered": unset profile shows a prompt in results', async ({ page }) => {
  await mockAnalyze(page, THREE);
  await onboard(page); // nothing chosen = unset
  await scanMenu(page);
  await expect(page.getByText("You haven't registered any allergies yet", { exact: false })).toBeVisible({ timeout: 10000 });

  await page.locator('header button').click();
  await page.getByRole('button', { name: 'I have no food allergies' }).click();
  await page.locator('[aria-label="Close"]').click();
  await expect(page.getByText("You haven't registered any allergies yet", { exact: false })).toHaveCount(0);
});

test('every dish shows its own risk badge, riskiest first, and the overall banner names them', async ({ page }) => {
  await mockAnalyze(page, THREE);
  await onboard(page, ['Peanut']);
  await scanMenu(page);
  const rows = page.locator('#dish-list-title ~ ul > li button');
  await expect(rows).toHaveCount(3, { timeout: 10000 });
  // Peanut -> Avoid (red) first; Kimchi Stew (spicy 3 > Normal) -> Check; Rice -> No match.
  await expect(rows.nth(0)).toContainText('Peanut Noodles');
  await expect(rows.nth(0)).toContainText('Avoid');
  await expect(rows.nth(1)).toContainText('Check');
  await expect(rows.nth(2)).toContainText('No match');
  await expect(page.getByText(/2 of 3 dishes need attention/)).toBeVisible();
  await page.screenshot({ path: 'screenshots/ux-improvement/after-01-dish-risk-list.png', fullPage: false });
});

test('selecting a dish updates detail, staff question, TTS text and copy text to that dish only', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    (window as unknown as { __tts: string[] }).__tts = [];
    const orig = window.speechSynthesis?.speak?.bind(window.speechSynthesis);
    if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { (window as unknown as { __tts: string[] }).__tts.push(u.text); try { orig?.(u); } catch { /* headless */ } };
  });
  await page.reload(); // init scripts apply from the next navigation
  await mockAnalyze(page, THREE);
  await onboard(page, ['Peanut']);
  await scanMenu(page);
  await page.getByRole('button', { name: /Kimchi Stew/ }).click();
  await expect(page.getByRole('heading', { name: 'Kimchi Stew (김치찌개)' })).toBeVisible();
  await expect(staffText(page)).toContainText('김치찌개');
  await expect(staffText(page)).not.toContainText('땅콩국수');
  // Reason shown in the selected dish's detail (the list row repeats its first reason).
  await expect(page.locator('ul[aria-label] li', { hasText: 'Spicier than your level' })).toBeVisible();

  const shown = await staffText(page).innerText();
  await page.getByRole('button', { name: 'Speak in Korean' }).click();
  await page.getByRole('button', { name: 'Copy' }).click();
  const tts = await page.evaluate(() => (window as unknown as { __tts: string[] }).__tts);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(tts[tts.length - 1]).toBe(shown);
  expect(clip).toBe(shown);

  // Secondary: whole-menu question.
  await page.getByRole('button', { name: /All flagged dishes/ }).click();
  await expect(staffText(page)).toContainText('땅콩국수');
  await expect(staffText(page)).toContainText('김치찌개');
});

test('two menu lines with the same name are selected independently (uid, not name)', async ({ page }) => {
  await mockAnalyze(page, [dish('Bibimbap', '비빔밥', []), dish('Bibimbap', '비빔밥', ['egg'])]);
  await onboard(page, ['Egg']);
  await scanMenu(page);
  const rows = page.locator('#dish-list-title ~ ul > li button');
  await expect(rows).toHaveCount(2, { timeout: 10000 });
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(rows.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#staff-question-panel').locator('..').getByText('No match', { exact: true }).first()).toBeVisible();
});

test('sticky "Ask staff" reaches the staff question in one tap', async ({ page }) => {
  await mockAnalyze(page, THREE);
  await onboard(page, ['Peanut']);
  await scanMenu(page);
  await page.getByRole('button', { name: 'Ask staff about this dish' }).click();
  await expect(page.locator('#staff-question-panel')).toBeInViewport();
});

test('map -> "Scan This Restaurant\'s Menu" opens the real upload with the restaurant kept through result and review', async ({ page }) => {
  await mockAnalyze(page, THREE, 'ux-loc');
  await onboard(page, ['Peanut']);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.locator('.leaflet-marker-icon').first().click();
  await page.getByRole('button', { name: "Scan This Restaurant's Menu" }).click();
  await expect(page.getByText('Menu photo for Jeonpo Solgup Samgyeopsal')).toBeVisible();
  await expect(page.getByText(/DEMO/)).toHaveCount(0);
  await page.screenshot({ path: 'screenshots/ux-improvement/after-02-location-scan.png', fullPage: false });
  await scanMenu(page);
  await expect(page.getByText('📍 Jeonpo Solgup Samgyeopsal')).toBeVisible({ timeout: 10000 });

  // Review the selected (analyzed) dish, linked to the restaurant.
  await page.getByText(/Your meal record/).click();
  const text = `ux-review-${Date.now()}`;
  await page.getByPlaceholder('Share your experience...').fill(text);
  await page.getByRole('button', { name: /Submit Review/i }).click();
  await expect(page.getByText(text)).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fitbridge_user_reviews_v1') || '{}'));
  const all = Object.values(saved.reviews as Record<string, { text: string; locationName?: string; source?: string; dishNameKo?: string }[]>).flat();
  const mine = all.find((r) => r.text === text);
  expect(mine?.locationName).toBe('Jeonpo Solgup Samgyeopsal');
  expect(mine?.source).toBe('ai_scan');
  expect(mine?.dishNameKo).toBe('땅콩국수');
});

test('the map demo is a separate, labeled action', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.locator('.leaflet-marker-icon').first().click();
  await page.getByRole('button', { name: 'See a demo result' }).click();
  await expect(page.getByText(/DEMO — sample data/)).toBeVisible();
});

test('reload restores the analysis, selected dish and tab; Back returns to the previous tab', async ({ page }) => {
  let analyzeCalls = 0;
  await page.route('**/api/analyze-menu', (r) => {
    analyzeCalls++;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dishes: THREE, analysisId: 'ux-restore', validationStatus: 'valid' }) });
  });
  await onboard(page, ['Peanut']);
  await scanMenu(page);
  await page.getByRole('button', { name: /Kimchi Stew/ }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Kimchi Stew (김치찌개)' })).toBeVisible();
  await expect(page.getByText('Restored from this session', { exact: false })).toBeVisible();
  expect(analyzeCalls).toBe(1);

  await page.getByRole('button', { name: 'Exchange', exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(/#\/menu$/);
  await expect(page.getByRole('heading', { name: 'Kimchi Stew (김치찌개)' })).toBeVisible();
});

test('a restored result uses the current profile (risk recomputed)', async ({ page }) => {
  await mockAnalyze(page, THREE, 'ux-recalc');
  await onboard(page, ['Peanut']);
  await scanMenu(page);
  await page.reload();
  await page.locator('header button').click();
  await page.locator('[role=dialog] label', { hasText: 'Peanut' }).first().click();
  await page.locator('[aria-label="Close"]').click();
  const rows = page.locator('#dish-list-title ~ ul > li button');
  await expect(rows.filter({ hasText: 'Peanut Noodles' })).not.toContainText('Avoid');
});

test('translation shows a "Translating…" status and Japanese UI has no raw "Matched:" / English DB ingredient leftovers', async ({ page }) => {
  await mockAnalyze(page, [dish('Kimchi Stew', '김치찌개', ['soybean'], { ingredients: 'tofu, sesame oil, green onions' })], 'ux-ja');
  await page.unroute('**/api/translate-dish');
  await page.route('**/api/translate-dish', async (r) => {
    await new Promise((res) => setTimeout(res, 4000)); // long enough to observe the status on slow mobile runs
    await r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        translationSchemaVersion: '1.0.0',
        targetLanguage: 'ja',
        translationsByFoodId: { 'kimchi-stew': { translatedName: 'キムチチゲ', ingredients: '豆腐、ごま油、長ネギ', eatingMethod: ['ご飯と一緒に'], description: '鍋料理', culturalNote: '' } },
        validationIssues: [],
      }),
    });
  });
  await onboard(page, ['Soybean']);
  await scanMenu(page);
  await expect(page.getByRole('heading', { name: 'Kimchi Stew (김치찌개)' })).toBeVisible({ timeout: 10000 });
  await page.locator('header button').click();
  await page.getByRole('radio', { name: /日本語/ }).click();
  await page.locator('[aria-label="Close"]').click();
  await expect(page.getByText('あなたの言語に翻訳中…')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'キムチチゲ (김치찌개)' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/Matched:/)).toHaveCount(0);
  await page.getByText('知識DBの詳細').click();
  const details = await page.locator('details[open]').first().innerText();
  expect(details).not.toMatch(/sesame oil|green onions|tofu/);
  await page.screenshot({ path: 'screenshots/ux-improvement/after-03-ja-result.png', fullPage: false });
});

test('exchange: reference rates are labeled as such when the live source fails', async ({ page }) => {
  await page.route('https://open.er-api.com/**', (r) => r.abort('failed'));
  await onboard(page);
  await page.getByRole('button', { name: 'Exchange', exact: true }).click();
  await expect(page.getByText('Reference rates — live rates unavailable')).toBeVisible();
});

test('map reviews: demo reviews are labeled as samples and use translated tags/countries in Japanese', async ({ page }) => {
  await onboard(page);
  await page.locator('header button').click();
  await page.getByRole('radio', { name: /日本語/ }).click();
  await page.locator('[aria-label="Close"]').click();
  await page.getByRole('button', { name: 'マップ', exact: true }).click();
  await page.locator('.leaflet-marker-icon').first().click();
  await expect(page.getByRole('heading', { name: '旅行者のレビュー' })).toBeVisible();
  await expect(page.getByText('サンプル', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Traveler Reviews')).toHaveCount(0);
  await expect(page.getByText(/• Lvl/)).toHaveCount(0);
});
