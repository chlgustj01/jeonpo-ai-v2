import { useState } from 'react';
import { useT } from '../../hooks/useT';
import { useExchangeRates, type Currency } from '../../hooks/useExchangeRates';
import { Card } from '../common/ui';

const CURRENCIES: { code: Currency; symbol: string }[] = [
  { code: 'USD', symbol: 'USD ($)' },
  { code: 'JPY', symbol: 'JPY (¥)' },
  { code: 'CNY', symbol: 'CNY (¥)' },
  { code: 'EUR', symbol: 'EUR (€)' },
  { code: 'VND', symbol: 'VND (₫)' },
];

const LOCALE_MAP: Record<string, string> = { en: 'en-US', ja: 'ja-JP', zh: 'zh-CN', vi: 'vi-VN', es: 'es-ES', ko: 'ko-KR' };

// Ports fetchLiveExchangeRates()/setCurrency()/calculateExchange() (§Exchange
// tab, kept per §6 "지도, 스캔, 직원 질문, 환율 기능을 누락하지 않는다").
export function ExchangeView() {
  const { t, lang } = useT();
  const { index, rateAsOfDate } = useExchangeRates();
  const [target, setTarget] = useState<Currency>('USD');
  const [foreignValue, setForeignValue] = useState('');
  const [krwValue, setKrwValue] = useState('');

  const rate = index[target];

  const onForeignChange = (v: string) => {
    setForeignValue(v);
    const val = parseFloat(v) || 0;
    let result = 0;
    if (target === 'JPY') result = Math.round(val * rate);
    else if (target === 'VND') result = Math.round((val / 1000) * rate);
    else result = Math.round(val * rate);
    setKrwValue(String(result));
  };

  const onKrwChange = (v: string) => {
    setKrwValue(v);
    const val = parseFloat(v) || 0;
    let result = 0;
    if (target === 'JPY') result = Math.round((val / rate) * 100) / 100;
    else if (target === 'VND') result = Math.round(((val * 1000) / rate) * 100) / 100;
    else result = Math.round((val / rate) * 100) / 100;
    setForeignValue(String(result));
  };

  const onTargetChange = (c: Currency) => {
    setTarget(c);
    const nextRate = index[c];
    const val = parseFloat(foreignValue) || 0;
    let result = 0;
    if (c === 'JPY') result = Math.round(val * nextRate);
    else if (c === 'VND') result = Math.round((val / 1000) * nextRate);
    else result = Math.round(val * nextRate);
    setKrwValue(foreignValue ? String(result) : '');
  };

  const currentRateLine = (() => {
    if (target === 'JPY') return `100 JPY = ${Math.round(rate * 100).toLocaleString()} KRW`;
    if (target === 'VND') return `1,000 VND = ${Math.round(rate).toLocaleString()} KRW`;
    return `1 ${target} = ${Math.round(rate).toLocaleString()} KRW`;
  })();

  const rateAsOfText = rateAsOfDate
    ? `${t('liveSyncedText')}: ${new Intl.DateTimeFormat(LOCALE_MAP[lang] || 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(rateAsOfDate)}`
    : t('liveSyncedText');

  return (
    <section className="p-4 space-y-4" aria-label={t('exchTitle')}>
      <div className="flex justify-between items-center">
        <h2 className="font-serif text-2xl font-bold text-vintage-dark">{t('exchTitle')}</h2>
        <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-bold border border-emerald-200">{rateAsOfText}</span>
      </div>

      <Card className="space-y-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
          {t('naverTitle')}
        </div>
        <p className="text-[10px] text-vintage-olive">{t('exchSource')}</p>

        <div className="flex gap-1.5 flex-wrap" role="group" aria-label={t('targetCur')}>
          {CURRENCIES.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => onTargetChange(c.code)}
              aria-pressed={target === c.code}
              className={`min-h-[40px] px-3 text-xs font-bold rounded-lg border transition ${
                target === c.code ? 'bg-vintage-terracotta text-white border-vintage-terracotta' : 'bg-white text-vintage-dark border-vintage-dark/10'
              }`}
            >
              {c.symbol}
            </button>
          ))}
        </div>

        <p className="text-center font-serif text-lg font-bold text-vintage-dark">{currentRateLine}</p>

        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <label htmlFor="foreign-input" className="block text-[10px] text-vintage-olive uppercase font-bold mb-1">
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
            <label htmlFor="krw-input" className="block text-[10px] text-vintage-olive uppercase font-bold mb-1">
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
          <span className="block text-[10px] font-bold uppercase">{t('baseIndexes')}</span>
          <div>1 USD = {Math.round(index.USD).toLocaleString()} KRW</div>
          <div>100 JPY = {Math.round(index.JPY * 100).toLocaleString()} KRW</div>
          <div>1 CNY = {Math.round(index.CNY).toLocaleString()} KRW</div>
          <div>1 EUR = {Math.round(index.EUR).toLocaleString()} KRW</div>
          <div>1,000 VND = {Math.round(index.VND).toLocaleString()} KRW</div>
        </div>
      </Card>
    </section>
  );
}
