// [PRICE] Pure price helpers: formatting with Intl (6 UI languages) and
// conversion between a printed menu price and the user's display currency.
// Converted amounts are a DERIVED value — recomputed from the stored price
// + the current exchange-rate state at render time, never stored, never
// fetched per dish.
import type { DishPrice, DisplayCurrency, Lang, PriceCurrency } from '../types';

const LOCALE: Record<Lang, string> = { en: 'en-US', ja: 'ja-JP', zh: 'zh-CN', vi: 'vi-VN', es: 'es-ES', ko: 'ko-KR' };

export function formatMoney(value: number, currency: string, lang: Lang): string {
  const digits = currency === 'KRW' || currency === 'JPY' || currency === 'VND' ? 0 : 2;
  try {
    return new Intl.NumberFormat(LOCALE[lang] || 'en-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  } catch {
    return `${value.toLocaleString()} ${currency}`;
  }
}

// KRW value of one unit of a printed currency (KRW itself = 1). Printed
// currencies outside the exchange feature's set return null (no conversion).
function krwPerPrinted(currency: PriceCurrency, krwPerUnit: Record<DisplayCurrency, number>): number | null {
  if (currency === 'KRW') return 1;
  const r = (krwPerUnit as Record<string, number>)[currency];
  return typeof r === 'number' && r > 0 ? r : null;
}

export function convert(amount: number, from: PriceCurrency, to: DisplayCurrency, krwPerUnit: Record<DisplayCurrency, number>): number | null {
  const k = krwPerPrinted(from, krwPerUnit);
  const target = krwPerUnit[to];
  if (k === null || !(target > 0)) return null;
  return (amount * k) / target;
}

export interface PriceView {
  kind: 'exact' | 'range' | 'ambiguous' | 'none';
  primary: string; // as printed, formatted ("₩9,000", "₩9,000–₩12,000") or the printed text for ambiguous
  converted: string | null; // "≈ $6.67" — reference only
}

export function describePrice(
  price: DishPrice | undefined,
  lang: Lang,
  display: DisplayCurrency,
  krwPerUnit: Record<DisplayCurrency, number>
): PriceView {
  if (!price || price.status === 'not_shown' || price.status === 'unknown') return { kind: 'none', primary: '', converted: null };
  if (price.status === 'ambiguous') return { kind: 'ambiguous', primary: price.text, converted: null };
  const cur = price.currency as PriceCurrency;
  const sameAsDisplay = (cur as string) === display;
  if (price.status === 'exact' && price.amount !== null) {
    const c = sameAsDisplay ? null : convert(price.amount, cur, display, krwPerUnit);
    return { kind: 'exact', primary: formatMoney(price.amount, cur, lang), converted: c === null ? null : `≈ ${formatMoney(c, display, lang)}` };
  }
  if (price.status === 'range' && price.min !== null && price.max !== null) {
    const a = sameAsDisplay ? null : convert(price.min, cur, display, krwPerUnit);
    const b = sameAsDisplay ? null : convert(price.max, cur, display, krwPerUnit);
    return {
      kind: 'range',
      primary: `${formatMoney(price.min, cur, lang)}–${formatMoney(price.max, cur, lang)}`,
      converted: a === null || b === null ? null : `≈ ${formatMoney(a, display, lang)}–${formatMoney(b, display, lang)}`,
    };
  }
  return { kind: 'none', primary: '', converted: null };
}

export function hasAnyPrintedPrice(prices: (DishPrice | undefined)[]): boolean {
  return prices.some((p) => !!p && (p.status === 'exact' || p.status === 'range' || p.status === 'ambiguous'));
}
