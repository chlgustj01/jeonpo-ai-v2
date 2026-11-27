import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

// [QUOTA] Quota errors on screen, retry timing, and the rest of the app
// staying usable while AI analysis is unavailable. Mock APIs only.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MENU = path.join(__dirname, 'fixtures/menu-sample.jpg');
const RATES = { USD: 0.00075, JPY: 0.1, CNY: 0.005, EUR: 0.0007, VND: 19 };

async function mockFx(page: Page) {
  await page.route('https://open.er-api.com/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'success', time_last_update_utc: 'Thu, 26 Nov 2026 00:02:31 +0000', time_next_update_utc: 'Fri, 27 Nov 2099 00:00:00 +0000', rates: RATES }) })
  );
}
function quota429(code: string, retryAfterSeconds: number, retryable: boolean) {
  return { status: 429, contentType: 'application/json', headers: { 'Retry-After': String(retryAfterSeconds) }, body: JSON.stringify({ error: 'quota', code, retryable, retryAfterSeconds }) };
}
const DISH = {
  foodId: 'kimchi-stew', name: 'Kimchi Stew (김치찌개)', nameKo: '김치찌개', nameEn: 'Kimchi Stew', ingredients: 'tofu', allergens: ['soybean'], crossContactAllergens: [],
  spicy: 1, eatingMethod: ['x'], description: 'd', culturalNote: '', ingredientSource: 'inferred',
  price: { status: 'exact', amount: 9000, min: null, max: null, currency: 'KRW', text: '9,000원', source: 'menu_text' },
};

test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await mockFx(page);
});

async function scan(page: Page) {
  await page.getByRole('button', { name: /Get Started/i }).click();
  await page.locator('input[type=file]').setInputFiles(MENU);
  await page.getByRole('button', { name: /Scan Menu Here/i }).click();
}

test('daily quota: clear message with the retry time, no retry button, and the rest of the app keeps working', async ({ page }) => {
  let analyzeCalls = 0;
  await page.route('**/api/analyze-menu', (r) => { analyzeCalls++; return r.fulfill(quota429('AI_QUOTA_DAILY', 20640, false)); });
  await scan(page);
  await expect(page.getByText("Today's free AI analysis limit has been reached", { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('in 6 hours', { exact: false })).toBeVisible(); // 20,640 s -> rounded up to 6 h
  await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(0);
  await page.screenshot({ path: 'screenshots/quota/after-01-daily-quota.png', fullPage: false });
  expect(analyzeCalls).toBe(1); // the client does not retry by itself

  // Map + restaurant card + review
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.locator('.leaflet-marker-icon').first().click();
  await expect(page.getByRole('button', { name: "Scan This Restaurant's Menu" })).toBeVisible();
  const text = `quota-review-${Date.now()}`;
  await page.getByPlaceholder('Share your experience...').fill(text);
  await page.getByRole('button', { name: /Submit Review/i }).click();
  await expect(page.getByText(text)).toBeVisible();
  // Exchange
  await page.getByRole('button', { name: 'Exchange', exact: true }).click();
  await page.locator('#foreign-input').fill('10');
  await expect(page.locator('#krw-input')).toHaveValue('13333');
  // Profile
  await page.locator('header button').click();
  await page.locator('[role=dialog] label', { hasText: 'Peanut' }).first().click();
  await expect(page.locator('[role=dialog] label:has-text("Peanut") input[type=checkbox]')).toBeChecked();
  await page.locator('[aria-label="Close"]').click();
  expect(analyzeCalls).toBe(1);
});

test('per-minute quota: retry button waits for the retry time, then works', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/analyze-menu', (r) => {
    calls++;
    if (calls === 1) return r.fulfill(quota429('AI_QUOTA_MINUTE', 3, true));
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: '1.1.0', dishes: [DISH], analysisId: 'q-min', validationStatus: 'valid' }) });
  });
  await page.route('**/api/translate-dish', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ translationSchemaVersion: '1.0.0', targetLanguage: 'en', translationsByFoodId: {}, validationIssues: [] }) }));
  await scan(page);
  await expect(page.getByText('Too many analysis requests in a short time', { exact: false })).toBeVisible({ timeout: 10000 });
  const btn = page.getByRole('button', { name: /Try again in|Try Again/ });
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveText(/Try again in \d+ seconds?/);
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeEnabled({ timeout: 6000 });
  await page.getByRole('button', { name: 'Try Again' }).click();
  await expect(page.getByRole('heading', { name: 'Kimchi Stew (김치찌개)' })).toBeVisible({ timeout: 10000 });
  expect(calls).toBe(2);
});

test('token quota shows its own guidance', async ({ page }) => {
  await page.route('**/api/analyze-menu', (r) => r.fulfill(quota429('AI_QUOTA_TOKENS', 120, true)));
  await scan(page);
  await expect(page.getByText('needs more AI capacity', { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('in 2 minutes', { exact: false }).first()).toBeVisible();
});

test('translation daily quota keeps the analyzed result (English) with a specific notice; prices still convert', async ({ page }) => {
  await page.route('**/api/analyze-menu', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: '1.1.0', dishes: [DISH], analysisId: 'q-tr', validationStatus: 'valid' }) }));
  await page.route('**/api/translate-dish', (r) => r.fulfill(quota429('AI_QUOTA_DAILY', 3600, false)));
  await page.getByRole('radio', { name: /日本語/ }).click();
  await page.locator('main > button').last().click();
  await page.locator('input[type=file]').setInputFiles(MENU);
  await page.locator('main section button.bg-vintage-terracotta').last().click();
  await expect(page.getByText('本日の翻訳の上限に達しました', { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('heading', { name: 'Kimchi Stew (김치찌개)' })).toBeVisible();
  await expect(page.getByTestId('dish-price-detail')).toContainText('9,000'); // single dish: price in the detail
});

test('a result restored from the session is still shown while the quota is exhausted (no new analysis)', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/analyze-menu', (r) => {
    calls++;
    if (calls === 1) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: '1.1.0', dishes: [DISH], analysisId: 'q-keep', validationStatus: 'valid' }) });
    return r.fulfill(quota429('AI_QUOTA_DAILY', 3600, false));
  });
  await page.route('**/api/translate-dish', (r) => r.fulfill(quota429('AI_QUOTA_DAILY', 3600, false)));
  await scan(page);
  await expect(page.getByRole('heading', { name: 'Kimchi Stew (김치찌개)' })).toBeVisible({ timeout: 10000 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Kimchi Stew (김치찌개)' })).toBeVisible();
  await page.locator('#price-currency').selectOption('JPY'); // currency change: no AI call
  await expect(page.getByTestId('dish-price-detail')).toContainText('¥900');
  expect(calls).toBe(1);
});

for (const [lang, label] of [['ja', '日本語'], ['zh', '简体中文'], ['vi', 'Tiếng Việt'], ['es', 'Español'], ['ko', '한국어']] as const) {
  test(`daily quota message in ${lang} with a localized retry time`, async ({ page }) => {
    await page.route('**/api/analyze-menu', (r) => r.fulfill(quota429('AI_QUOTA_DAILY', 20640, false)));
    await page.getByRole('radio', { name: new RegExp(label) }).click();
    await page.locator('main > button').last().click();
    await page.locator('input[type=file]').setInputFiles(MENU);
    await page.locator('main section button.bg-vintage-terracotta').last().click();
    const expected = await page.evaluate((l) => {
      const loc = { ja: 'ja-JP', zh: 'zh-CN', vi: 'vi-VN', es: 'es-ES', ko: 'ko-KR' }[l as 'ja'];
      return new Intl.RelativeTimeFormat(loc, { numeric: 'always' }).format(6, 'hour');
    }, lang);
    await expect(page.locator('[role=alert]')).toContainText(expected, { timeout: 10000 });
    await expect(page.locator('[role=alert]')).not.toContainText('Today'); // no English fallback
  });
}
