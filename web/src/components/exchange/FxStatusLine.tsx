import { useT } from '../../hooks/useT';
import { useCurrency } from '../../hooks/useCurrency';
import { formatTemplate } from '../../i18n';

const LOCALE: Record<string, string> = { en: 'en-US', ja: 'ja-JP', zh: 'zh-CN', vi: 'vi-VN', es: 'es-ES', ko: 'ko-KR' };

// [PRICE] One compact line describing the exchange data, used by both the
// Exchange tab and the menu price toolbar: live (source date, the source
// publishes once a day) / reference rates (live unavailable) / loading.
// Never labels the built-in reference values as live.
export function FxStatusLine({ compact = false }: { compact?: boolean }) {
  const { t, lang } = useT();
  const { status, sourceUpdatedAt } = useCurrency();
  const text =
    status === 'live'
      ? formatTemplate(t('fxLiveDaily'), {
          time: sourceUpdatedAt
            ? new Intl.DateTimeFormat(LOCALE[lang] || 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(sourceUpdatedAt)
            : '—',
        })
      : status === 'fallback'
        ? t('rateFallback')
        : t('rateLoading');
  const cls =
    status === 'live' ? 'text-emerald-900 bg-emerald-50 border-emerald-200' : status === 'fallback' ? 'text-amber-900 bg-amber-50 border-amber-300' : 'text-slate-800 bg-slate-100 border-slate-300';
  return (
    <p className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded border ${cls}`} role="status">
      {text}
      {!compact && <span className="font-normal"> · {t('exchSource')} {t('rateSourceName')}</span>}
    </p>
  );
}
