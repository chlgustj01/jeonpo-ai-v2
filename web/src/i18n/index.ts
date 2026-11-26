import { translations } from './translations.generated';
import { reviewStatsExtra } from './reviewStatsExtra';
import type { Lang } from '../types';

export type { Lang } from '../types';
export type TranslationKey = keyof typeof translations.en;

// Same fallback behavior as the vanilla version's kbText(): missing key in
// the active language falls back to English, never to `undefined`/an
// internal id leaking onto the screen (§6 of Package 3's request, kept).
export function translate(lang: Lang, key: string): string {
  const table = (translations as Record<string, Record<string, string>>)[lang] || translations.en;
  const extra = reviewStatsExtra[lang] || reviewStatsExtra.en;
  return table[key] ?? extra[key] ?? (translations.en as Record<string, string>)[key] ?? reviewStatsExtra.en[key] ?? key;
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
