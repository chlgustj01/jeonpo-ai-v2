import { useT } from '../../hooks/useT';
import { useCurrency } from '../../hooks/useCurrency';
import { describePrice } from '../../lib/money';
import { formatTemplate } from '../../i18n';
import { DISPLAY_CURRENCIES } from '../../store/exchangeStore';
import { FxStatusLine } from '../exchange/FxStatusLine';
import type { DishPrice, DisplayCurrency } from '../../types';

// [PRICE] Menu prices next to the risk information, kept visually separate
// (neutral colors, right-aligned, tabular numbers — the risk badge keeps the
// colors). Printed price first, converted amount second and marked "≈".
// Everything here is derived at render time from the stored price + the
// shared exchange state, so changing currency/dish never calls any API.

// One shared control for the whole result list (no per-dish converters).
export function PriceToolbar() {
  const { t } = useT();
  const { currency, isSuggested, setCurrency } = useCurrency();
  return (
    <div className="p-2.5 rounded-xl bg-white/70 border border-vintage-dark/10 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <label htmlFor="price-currency" className="text-xs font-bold text-vintage-olive">
          {t('currencyLabel')}
        </label>
        <select
          id="price-currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value as DisplayCurrency)}
          className="min-h-[44px] px-2 rounded-lg bg-white vintage-border text-sm font-semibold"
        >
          {DISPLAY_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {isSuggested && <span className="text-[11px] text-vintage-olive">{t('currencySuggested')}</span>}
      </div>
      <FxStatusLine compact />
      <p className="text-[11px] text-vintage-olive">{t('convertedNote')}</p>
    </div>
  );
}

export function PriceInline({ price }: { price: DishPrice | undefined }) {
  const { lang } = useT();
  const { currency, krwPerUnit } = useCurrency({ load: false });
  const v = describePrice(price, lang, currency, krwPerUnit);
  if (v.kind === 'none') return null;
  if (v.kind === 'ambiguous') {
    return (
      <span className="shrink-0 max-w-[5.5rem] text-right text-xs text-vintage-olive break-words" title={v.primary}>
        “{v.primary}” ?
      </span>
    );
  }
  return (
    <span className="shrink-0 text-right leading-tight" data-testid="dish-price">
      <span className="block text-sm font-bold text-vintage-dark tabular-nums">{v.primary}</span>
      {v.converted && <span className="block text-xs text-vintage-olive tabular-nums">{v.converted}</span>}
    </span>
  );
}

export function PriceDetail({ price }: { price: DishPrice | undefined }) {
  const { t, lang } = useT();
  const { currency, krwPerUnit } = useCurrency({ load: false });
  // An analysis from before prices existed (status unknown / no field) shows nothing.
  if (!price || price.status === 'unknown') return null;
  if (price.status === 'not_shown') return <p className="text-xs text-vintage-olive">💳 {t('priceNotShown')}</p>;
  const v = describePrice(price, lang, currency, krwPerUnit);
  if (v.kind === 'ambiguous') return <p className="text-sm text-vintage-dark">💳 {formatTemplate(t('priceAmbiguous'), { text: v.primary })}</p>;
  return (
    <div className="flex items-baseline gap-2 flex-wrap" data-testid="dish-price-detail">
      <span className="text-[11px] font-bold text-vintage-olive uppercase">💳 {t('priceFromMenu')}</span>
      <span className="text-base font-bold text-vintage-dark tabular-nums">{v.primary}</span>
      {v.converted && <span className="text-sm text-vintage-olive tabular-nums">{v.converted}</span>}
    </div>
  );
}
