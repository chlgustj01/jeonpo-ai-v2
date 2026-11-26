import { useProfileStore } from '../../store/profileStore';
import { useT } from '../../hooks/useT';
import { LANGS } from '../../i18n';

export function LanguageSelector() {
  const { t } = useT();
  const lang = useProfileStore((s) => s.lang);
  const setLang = useProfileStore((s) => s.setLang);

  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-vintage-olive font-bold mb-2">
        🌐 {t('langLabel')}
      </label>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('tagline')}>
        {LANGS.map((l) => (
          <button
            key={l.code}
            type="button"
            role="radio"
            aria-checked={lang === l.code}
            onClick={() => setLang(l.code)}
            className={`min-h-[44px] py-2 px-2 text-xs rounded-lg font-medium border transition flex flex-col items-center gap-0.5 ${
              lang === l.code
                ? 'bg-vintage-terracotta text-white border-vintage-terracotta'
                : 'bg-white text-vintage-dark border-vintage-dark/10 hover:bg-vintage-beige'
            }`}
          >
            <span>{l.flag} {l.label}</span>
            <span className={`text-[10px] ${lang === l.code ? 'text-white/80' : 'text-vintage-olive'}`}>{l.code.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
