import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

// [PRICE] Menu prices + shared exchange rates/currency. Mock analysis and a
// mocked exchange-rate source (deterministic rates, request counting).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MENU = path.join(__dirname, 'fixtures/menu-sample.jpg');

// KRW base: 1 KRW = 0.00075 USD -> 1,333.33 KRW per USD; 1 KRW = 0.1 JPY -> 10 KRW per JPY.
const RATES = { USD: 0.00075, JPY: 0.1, CNY: 0.005, EUR: 0.0007, VND: 19 };

function dish(nameEn: string, nameKo: string, price?: unknown, allergens: string[] = []) {
  return {
    foodId: nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: `${nameEn} (${nameKo})`,
    nameKo,
    nameEn,
    ingredients: 'tofu, pork',
    allergens,
    crossContactAllergens: [],
    spicy: 1,
    eatingMethod: ['Eat with rice.'],
    description: 'A dish.',
    culturalNote: '',
    ingredientSource: 'inferred',
    ...(price === undefined ? {} : { price }),
  };
}
const P = (status: string, extra: Record<string, unknown> = {}) => ({ status, amount: null, min: null, max: null, currency: null, text: '', source: null, ...extra });
const PRICED = [
  dish('Kimchi Stew', '김치찌개', P('exact', { amount: 9000, currency: 'KRW', text: '9,000원', source: 'menu_text' }), ['soybean']),
  dish('Army Stew', '부대찌개', P('range', { min: 22000, max: 33000, currency: 'KRW', text: '2인 22,000 / 3인 33,000', source: 'menu_text' })),
  dish('Stir-fried Octopus', '낙지볶음', P('ambiguous', { currency: 'KRW', text: '시가', source: 'menu_text' })),
  dish('Steamed Rice', '공기밥', P('not_shown')),
];

interface Counters { analyze: number; translate: number; fx: number }

async function setup(page: Page, dishes: unknown[], opts: { fxFail?: boolean; rates?: Record<string, number> } = {}): Promise<Counters> {
  const c: Counters = { analyze: 0, translate: 0, fx: 0 };
  await page.route('**/api/analyze-menu', (r) => {
    c.analyze++;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: '1.1.0', dishes, analysisId: 'price-1', validationStatus: 'valid' }) });
  });
  await page.route('**/api/translate-dish', (r) => {
    c.translate++;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ translationSchemaVersion: '1.0.0', targetLanguage: 'en', translationsByFoodId: {}, validationIssues: [] }) });
  });
  await page.route('https://open.er-api.com/**', (r) => {
    c.fx++;
    if (opts.fxFail) return r.abort('failed');
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: 'success', time_last_update_utc: 'Thu, 26 Nov 2026 00:02:31 +0000', time_next_update_utc: 'Fri, 27 Nov 2099 00:31:41 +0000', rates: opts.rates || RATES }),
    });
  });
  return c;
}

async function startAndScan(page: Page, allergy?: string) {
  if (allergy) await page.locator('[role=group] label', { hasText: allergy }).first().click();
  await page.getByRole('button', { name: /Get Started/i }).click();
  await page.locator('input[type=file]').setInputFiles(MENU);
  await page.getByRole('button', { name: /Scan Menu Here/i }).click();
  await expect(page.locator('#dish-list-title, h3.font-serif').first()).toBeVisible({ timeout: 10000 });
}

const row = (page: Page, name: RegExp) => page.locator('#dish-list-title ~ ul > li button').filter({ hasText: name });

test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
});

test('printed prices appear per dish with a reference conversion; unclear and missing prices are never shown as amounts', async ({ page }) => {
  await setup(page, PRICED);
  await startAndScan(page, 'Soybean');
  await expect(row(page, /Kimchi Stew/)).toContainText('₩9,000');
  await expect(row(page, /Kimchi Stew/)).toContainText('≈ $6.75');
  await expect(row(page, /Army Stew/)).toContainText('₩22,000–₩33,000');
  await expect(row(page, /Army Stew/)).toContainText('≈ $16.50–$24.75');
  await expect(row(page, /Octopus/)).toContainText('“시가” ?');
  await expect(row(page, /Steamed Rice/).getByTestId('dish-price')).toHaveCount(0);
  await expect(row(page, /Steamed Rice/)).not.toContainText('₩0');
  // Risk badge stays separate from the price.
  await expect(row(page, /Kimchi Stew/)).toContainText('Avoid');
  await expect(page.getByText('Converted amounts are approximate', { exact: false })).toBeVisible();
  await expect(page.getByText(/Rate updated daily/)).toBeVisible();
  await page.screenshot({ path: 'screenshots/price/after-01-price-list.png', fullPage: false });

  await row(page, /Steamed Rice/).click();
  await expect(page.getByText('No price shown on the menu for this dish.')).toBeVisible();
  await row(page, /Octopus/).click();
  await expect(page.getByText('Price unclear on the menu: “시가”')).toBeVisible();
});

test('changing the currency updates every dish and calls no Gemini/translation API; one exchange request in total', async ({ page }) => {
  const c = await setup(page, PRICED);
  await startAndScan(page);
  const analyzeAfterScan = c.analyze;
  await page.locator('#price-currency').selectOption('JPY');
  await expect(row(page, /Kimchi Stew/)).toContainText('≈ ¥900');
  await expect(row(page, /Army Stew/)).toContainText('≈ ¥2,200–¥3,300');
  await page.locator('#price-currency').selectOption('EUR');
  await expect(row(page, /Kimchi Stew/)).toContainText('≈ €6.30');
  // Select other dishes, switch tabs, come back — still no extra API calls.
  await row(page, /Army Stew/).click();
  await expect(page.locator('h3.font-serif').first()).toContainText('Army Stew');
  await expect(page.getByText('Price as printed on the menu', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Exchange', exact: true }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  expect(c.analyze).toBe(analyzeAfterScan);
  expect(c.analyze).toBe(1);
  expect(c.translate).toBe(0);
  expect(c.fx).toBe(1);
});

test('Exchange tab and menu prices share one currency setting (both directions)', async ({ page }) => {
  await setup(page, PRICED);
  await startAndScan(page);
  await page.locator('#price-currency').selectOption('JPY');
  await page.getByRole('button', { name: 'Exchange', exact: true }).click();
  await expect(page.getByRole('button', { name: 'JPY (¥)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('100 JPY = 1,000 KRW').first()).toBeVisible(); // correct unit (was 10x off for live JPY)
  await page.getByRole('button', { name: 'USD ($)' }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.locator('#price-currency')).toHaveValue('USD');
  await expect(row(page, /Kimchi Stew/)).toContainText('≈ $6.75');
});

test('currency is suggested from nationality, independent of the UI language', async ({ page }) => {
  await setup(page, PRICED);
  await page.getByPlaceholder(/USA, Japan/).fill('Japan'); // nationality, UI language stays English
  await startAndScan(page);
  await expect(page.locator('#price-currency')).toHaveValue('JPY');
  await expect(page.getByText('(suggested from your country)')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Menu Translation' })).toBeVisible(); // still English UI
});

test('exchange source failure: reference rates are labeled, conversions still marked approximate', async ({ page }) => {
  await setup(page, PRICED, { fxFail: true });
  await startAndScan(page);
  await expect(page.getByText('Reference rates — live rates unavailable').first()).toBeVisible();
  await expect(row(page, /Kimchi Stew/)).toContainText('₩9,000');
  await expect(row(page, /Kimchi Stew/)).toContainText('≈ $6.67'); // 9,000 / 1,350 (reference)
});

test('an analysis without price fields (older result / dish photo) shows no price UI and no zero', async ({ page }) => {
  await setup(page, [dish('Bibimbap', '비빔밥'), dish('Bulgogi', '불고기')]);
  await startAndScan(page);
  await expect(page.locator('#price-currency')).toHaveCount(0);
  await expect(page.getByTestId('dish-price')).toHaveCount(0);
  await expect(page.getByText('₩0')).toHaveCount(0);
});

test('reload keeps prices and recomputes the conversion from the rates available now', async ({ page, context }) => {
  const c = await setup(page, PRICED);
  await startAndScan(page);
  await expect(row(page, /Kimchi Stew/)).toContainText('≈ $6.75');
  // New day, new rate: drop the cached rates and serve a different USD rate.
  await page.evaluate(() => localStorage.removeItem('fitbridge_fx_cache_v1'));
  await page.unroute('https://open.er-api.com/**');
  await context.route('https://open.er-api.com/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'success', time_last_update_utc: 'Fri, 27 Nov 2026 00:02:31 +0000', time_next_update_utc: 'Sat, 28 Nov 2099 00:00:00 +0000', rates: { ...RATES, USD: 0.0009 } }) })
  );
  await page.reload();
  await expect(row(page, /Kimchi Stew/)).toContainText('₩9,000');
  await expect(row(page, /Kimchi Stew/)).toContainText('≈ $8.10');
  // Exchange-rate refresh: no Gemini analysis and no translation call.
  expect(c.analyze).toBe(1);
  expect(c.translate).toBe(0);
});

for (const [lang, label, currencyLabel] of [
  ['ja', '日本語', '価格の表示通貨'],
  ['zh', '简体中文', '价格显示币种'],
  ['vi', 'Tiếng Việt', 'Hiển thị giá bằng'],
  ['es', 'Español', 'Mostrar precios en'],
  ['ko', '한국어', '가격 표시 통화'],
] as const) {
  test(`prices and currency UI in ${lang}`, async ({ page }) => {
    await setup(page, PRICED);
    await page.getByRole('radio', { name: new RegExp(label) }).click();
    await page.locator('main > button').last().click(); // Get Started (translated)
    await page.locator('input[type=file]').setInputFiles(MENU);
    await page.locator('main section button.bg-vintage-terracotta').last().click();
    await expect(page.getByText(currencyLabel)).toBeVisible({ timeout: 10000 });
    const expected = await page.evaluate((l) => {
      const loc = { ja: 'ja-JP', zh: 'zh-CN', vi: 'vi-VN', es: 'es-ES', ko: 'ko-KR' }[l as 'ja'];
      return new Intl.NumberFormat(loc, { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(9000);
    }, lang);
    await expect(page.getByTestId('dish-price').first()).toContainText(expected);
  });
}

test('360px: prices and names stay readable without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await setup(page, [
    dish('Doenjang Jjigae with Seasonal Vegetables and Tofu', '계절채소 두부 된장찌개', P('range', { min: 120000, max: 150000, currency: 'KRW', text: '120,000~150,000', source: 'menu_text' })),
    ...PRICED,
  ]);
  await startAndScan(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await page.getByTestId('dish-price').first().boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(360);
  await page.screenshot({ path: 'screenshots/price/after-02-price-360.png', fullPage: false });
});
