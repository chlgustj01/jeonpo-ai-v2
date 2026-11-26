import { useCallback } from 'react';
import { useProfileStore } from '../store/profileStore';
import { translate } from '../i18n';

export function useT() {
  const lang = useProfileStore((s) => s.lang);
  const t = useCallback((key: string) => translate(lang, key), [lang]);
  return { t, lang };
}
