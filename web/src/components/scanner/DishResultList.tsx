import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProfileStore, getAllergyProfileStatus } from '../../store/profileStore';
import { useScanStore } from '../../store/scanStore';
import { useUIStore } from '../../store/uiStore';
import { useT } from '../../hooks/useT';
import { useDishKnowledgeReport } from '../../hooks/useDishKnowledgeReport';
import { worstSafety } from '../../lib/safety';
import { rankDishes, describeRisk, BADGE_KEY, type RankedDish } from '../../lib/riskReasons';
import { formatTemplate } from '../../i18n';
import { SafetyBanner } from './SafetyBanner';
import { DishDetail } from './DishDetail';
import { RiskBadge } from './RiskBadge';
import { PriceToolbar, PriceInline } from './PriceDisplay';
import { hasAnyPrintedPrice } from '../../lib/money';
import type { Dish } from '../../types';

// [UX-IMPROVEMENT P0/P1] Result information order (docs/UX-AUDIT.md U1/U2/U6/U7):
//   1. source & coverage notices        (ScannerView + here)
//   2. overall banner + which dishes need attention
//   3. dish list with a per-dish risk badge (text + icon, never color only),
//      highest risk first, each row selectable
//   4. the selected dish: name, risk reasons, ask staff, ingredients,
//      knowledge-DB details (folded), culture & how to eat (folded), review
// The per-dish SafetyResult was already computed here before but only the
// worst-case one was shown; now every dish gets its own. The judgment itself
// (lib/safety.ts) is unchanged.
export function DishResultList({
  dishes,
  source,
  partialResults,
}: {
  dishes: Dish[];
  source: 'ai_scan' | 'demo_location';
  partialResults?: boolean;
}) {
  const { t, lang } = useT();
  const profile = useProfileStore(
    useShallow((s) => ({
      selectedAllergies: s.selectedAllergies,
      customAllergies: s.customAllergies,
      dietary: s.dietary,
      selectedSpicy: s.selectedSpicy,
    }))
  );
  const allergyStatus = useProfileStore((s) => getAllergyProfileStatus(s));
  const openProfileModal = useUIStore((s) => s.openProfileModal);
  const selectedDishUid = useScanStore((s) => s.selectedDishUid);
  const selectDish = useScanStore((s) => s.selectDish);
  const detailRef = useRef<HTMLDivElement>(null);

  const ranked = useMemo(() => rankDishes(dishes, profile), [dishes, profile]);
  const overall = worstSafety(ranked.map((r) => r.result));
  const flagged = ranked.filter((r) => r.result.safetyState !== 'green');
  // Default selection = the highest-risk dish, so its reasons and the staff
  // question are ready without a tap. An explicit choice always wins.
  const selected = ranked.find((r) => r.uid === selectedDishUid) || ranked[0];

  const onSelect = (uid: string) => {
    selectDish(uid);
    // Bring the detail into view (it sits right under the list).
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      detailRef.current?.focus({ preventScroll: true });
    });
  };

  // Keep the store in sync with the effective default, so a reload restores
  // the same dish and other screens (review) see the same selection.
  useEffect(() => {
    if (selected && selected.uid !== selectedDishUid) selectDish(selected.uid);
  }, [selected, selectedDishUid, selectDish]);

  const summary =
    ranked.length > 1
      ? flagged.length > 0
        ? formatTemplate(t('riskSummary'), { n: flagged.length, total: ranked.length, list: flagged.map((r) => r.dish.nameKo || r.dish.name).join(', ') })
        : t('riskSummaryNone')
      : undefined;

  const askStaff = () => {
    const el = document.getElementById('staff-question-panel');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.focus({ preventScroll: true });
  };

  return (
    <div className="space-y-3 pb-16">
      {source === 'demo_location' && (
        <p className="text-xs font-bold text-purple-900 bg-purple-50 border border-purple-300 rounded-lg p-2" role="note">
          🧪 {t('demoBadge')}
        </p>
      )}
      {partialResults && (
        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2">{t('toastPartialResults')}</p>
      )}
      {source === 'ai_scan' && dishes.some((d) => d.ingredientSource !== 'printed') && (
        <p className="text-xs text-vintage-dark bg-vintage-beige/60 border border-vintage-dark/10 rounded-lg p-2">{t('ingredientInferred')}</p>
      )}
      {source === 'ai_scan' && dishes.some((d) => d.ingredientSource === 'printed') && (
        <p className="text-xs text-vintage-dark bg-vintage-beige/60 border border-vintage-dark/10 rounded-lg p-2">{t('ingredientPrinted')}</p>
      )}
      {allergyStatus === 'unset' && (
        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg p-2 flex items-center gap-2">
          <span className="flex-1">{t('allergyUnsetNotice')}</span>
          <button type="button" onClick={openProfileModal} className="min-h-[44px] px-3 rounded-lg bg-white border border-amber-300 font-bold shrink-0">
            {t('allergyUnsetBtn')}
          </button>
        </div>
      )}

      <SafetyBanner result={overall} sourceNoteKey={source === 'ai_scan' ? 'sourceAiScanNote' : 'sourceDemoNote'} summary={summary} />

      {/* [PRICE] One currency control for all dishes; shown only when the menu actually shows prices. */}
      {hasAnyPrintedPrice(dishes.map((d) => d.price)) && <PriceToolbar />}

      {ranked.length > 1 && (
        <section aria-labelledby="dish-list-title" className="space-y-1.5">
          <h3 id="dish-list-title" className="text-xs font-bold text-vintage-olive uppercase">
            {formatTemplate(t('dishListTitle'), { n: ranked.length })}
          </h3>
          <p className="text-xs text-vintage-olive">{t('tapForDetails')}</p>
          <ul className="space-y-1.5">
            {ranked.map((r) => (
              <li key={r.uid}>
                <DishRow ranked={r} selected={r.uid === selected?.uid} onSelect={onSelect} source={source} lang={lang} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {selected && (
        <div ref={detailRef} tabIndex={-1} className="scroll-mt-4 focus:outline-none">
          <DishDetail key={selected.uid} ranked={selected} source={source} allDishes={dishes} />
        </div>
      )}

      {/* Always-reachable "ask staff" — sits above the bottom nav. */}
      <div className="fixed bottom-14 inset-x-0 mx-auto max-w-md px-4 pb-2 pointer-events-none z-30">
        <button
          type="button"
          onClick={askStaff}
          className="pointer-events-auto w-full min-h-[48px] rounded-xl bg-vintage-dark text-white text-sm font-bold vintage-shadow"
        >
          🗣️ {t('askStaffSticky')}
        </button>
      </div>
    </div>
  );
}

function DishRow({
  ranked,
  selected,
  onSelect,
  source,
  lang,
}: {
  ranked: RankedDish;
  selected: boolean;
  onSelect: (uid: string) => void;
  source: 'ai_scan' | 'demo_location';
  lang: Parameters<typeof describeRisk>[3];
}) {
  const { t } = useT();
  const profile = useProfileStore(
    useShallow((s) => ({ selectedAllergies: s.selectedAllergies, customAllergies: s.customAllergies, dietary: s.dietary, selectedSpicy: s.selectedSpicy }))
  );
  const report = useDishKnowledgeReport(ranked.dish, source, ranked.uid);
  const reasons = describeRisk(ranked.dish, ranked.result, profile, lang);
  const hasKbAdvisory = !!report && report.lookupStatus === 'ready' && report.userAdvisories.length > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(ranked.uid)}
      aria-pressed={selected}
      aria-label={`${ranked.dish.name} — ${t(BADGE_KEY[ranked.result.safetyState])}`}
      className={`w-full min-h-[56px] text-left p-2.5 rounded-xl border transition flex items-start gap-2.5 ${
        selected ? 'bg-white border-vintage-terracotta ring-2 ring-vintage-terracotta/40' : 'bg-white/70 border-vintage-dark/10 hover:bg-white'
      }`}
    >
      <RiskBadge state={ranked.result.safetyState} compact />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-vintage-dark break-words">{ranked.dish.name}</span>
        <span className="block text-xs text-vintage-olive break-words">{reasons[0]?.text}</span>
        {hasKbAdvisory && (
          <span className="inline-block mt-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
            ⚠️ {t('kbAdvisoryChip')}
          </span>
        )}
      </span>
      <PriceInline price={ranked.dish.price} />
    </button>
  );
}
