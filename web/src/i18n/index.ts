import { translations } from './translations.generated';
import { reviewStatsExtra } from './reviewStatsExtra';
import { package5Extra, package5Overrides } from './package5Extra';
import { uxExtra, uxOverrides } from './uxExtra';
import { priceExtra } from './priceExtra';
import type { Lang } from '../types';

export type { Lang } from '../types';
export type TranslationKey = keyof typeof translations.en;

// Same fallback behavior as the vanilla version's kbText(): missing key in
// the active language falls back to English, never to `undefined`/an
// internal id leaking onto the screen (§6 of Package 3's request, kept).
export function translate(lang: Lang, key: string): string {
  const table = (translations as Record<string, Record<string, string>>)[lang] || translations.en;
  const extra = reviewStatsExtra[lang] || reviewStatsExtra.en;
  const uxo = uxOverrides[lang] || uxOverrides.en;
  const ux = uxExtra[lang] || uxExtra.en;
  const px = priceExtra[lang] || priceExtra.en;
  const p5o = package5Overrides[lang] || package5Overrides.en;
  const p5 = package5Extra[lang] || package5Extra.en;
  return (
    uxo[key] ??
    p5o[key] ??
    table[key] ??
    extra[key] ??
    p5[key] ??
    ux[key] ??
    px[key] ??
    uxExtra.en[key] ??
    priceExtra.en[key] ??
    package5Overrides.en[key] ??
    (translations.en as Record<string, string>)[key] ??
    reviewStatsExtra.en[key] ??
    package5Extra.en[key] ??
    key
  );
}

// "{shown} of {total}" style placeholders.
export function formatTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in values ? String(values[name]) : m));
}

export { translations };

export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'zh', label: '简体中文', flag: '🇨🇳' },
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
];
