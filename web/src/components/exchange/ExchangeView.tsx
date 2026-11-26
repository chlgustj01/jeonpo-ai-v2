import { useState } from 'react';
import { useT } from '../../hooks/useT';
import { useCurrency } from '../../hooks/useCurrency';
import { Card } from '../common/ui';
import { FxStatusLine } from './FxStatusLine';
import type { DisplayCurrency } from '../../types';

const CURRENCIES: { code: DisplayCurrency; symbol: string }[] = [
  { code: 'USD', symbol: 'USD ($)' },
  { code: 'JPY', symbol: 'JPY (¥)' },
  { code: 'CNY', symbol: 'CNY (¥)' },
  { code: 'EUR', symbol: 'EUR (€)' },
  { code: 'VND', symbol: 'VND (₫)' },
];

// How many units each reference line shows (100 JPY, 1,000 VND, else 1).
const LINE_UNITS: Record<DisplayCurrency, number> = { USD: 1, JPY: 100, CNY: 1, EUR: 1, VND: 1000 };

const round2 = (v: number) => Math.round(v * 100) / 100;

// Ports fetchLiveExchangeRates()/setCurrency()/calculateExchange() (§Exchange
// tab). [PRICE] Now reads the shared exchange state + the shared display
// currency (useCurrency) — the currency picked here is the one menu prices
// are converted to, and vice versa. All rates are "KRW per ONE unit".
export function ExchangeView() {
  const { t } = useT();
  const { currency: target, setCurrency, krwPerUnit } = useCurrency();
  const [foreignValue, setForeignValue] = useState('');
  const [krwValue, setKrwValue] = useState('');

  const rate = krwPerUnit[target];

  const onForeignChange = (v: string) => {
    setForeignValue(v);
    setKrwValue(v === '' ? '' : String(Math.round((parseFloat(v) || 0) * rate)));
  };

  const onKrwChange = (v: string) => {
    setKrwValue(v);
    setForeignValue(v === '' ? '' : String(round2((parseFloat(v) || 0) / rate)));
  };

  const onTargetChange = (c: DisplayCurrency) => {
    setCurrency(c);
    const val = parseFloat(foreignValue) || 0;
    setKrwValue(foreignValue ? String(Math.round(val * krwPerUnit[c])) : '');
  };

  const line = (c: DisplayCurrency) => `${LINE_UNITS[c].toLocaleString()} ${c} = ${Math.round(krwPerUnit[c] * LINE_UNITS[c]).toLocaleString()} KRW`;

  return (
    <section className="p-4 space-y-4" aria-label={t('exchTitle')}>
      <div className="space-y-1">
        <h2 className="font-serif text-2xl font-bold text-vintage-dark">{t('exchTitle')}</h2>
        <FxStatusLine />
      </div>

      <Card className="space-y-3">
        <div className="flex gap-1.5 flex-wrap" role="group" aria-label={t('targetCur')}>
          {CURRENCIES.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => onTargetChange(c.code)}
              aria-pressed={target === c.code}
              className={`min-h-[44px] px-3 text-xs font-bold rounded-lg border transition ${
                target === c.code ? 'bg-vintage-terracotta text-white border-vintage-terracotta' : 'bg-white text-vintage-dark border-vintage-dark/10'
              }`}
            >
              {c.symbol}
            </button>
          ))}
        </div>

        <p className="text-center font-serif text-lg font-bold text-vintage-dark">{line(target)}</p>

        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <label htmlFor="foreign-input" className="block text-[11px] text-vintage-olive uppercase font-bold mb-1">
              {t('foreignAmt')}
            </label>
            <input
              id="foreign-input"
              type="number"
              inputMode="decimal"
              value={foreignValue}
              onChange={(e) => onForeignChange(e.target.value)}
              className="w-full min-h-[44px] p-2.5 rounded-lg bg-white vintage-border text-sm"
            />
          </div>
          <div>
            <label htmlFor="krw-input" className="block text-[11px] text-vintage-olive uppercase font-bold mb-1">
              {t('krwAmt')}
            </label>
            <input
              id="krw-input"
              type="number"
              inputMode="decimal"
              value={krwValue}
              onChange={(e) => onKrwChange(e.target.value)}
              className="w-full min-h-[44px] p-2.5 rounded-lg bg-white vintage-border text-sm"
            />
          </div>
        </div>

        <div className="pt-2 border-t border-vintage-dark/10 text-xs text-vintage-olive space-y-0.5">
          <span className="block text-[11px] font-bold uppercase">{t('baseIndexes')}</span>
          {CURRENCIES.map((c) => (
            <div key={c.code}>{line(c.code)}</div>
          ))}
        </div>
      </Card>
    </section>
  );
}
