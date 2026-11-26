import { useShallow } from 'zustand/react/shallow';
import { useProfileStore } from '../../store/profileStore';
import { useScanStore } from '../../store/scanStore';
import { useT } from '../../hooks/useT';
import { useDishKnowledgeReport } from '../../hooks/useDishKnowledgeReport';
import { describeRisk, BADGE_KEY, type RankedDish, type ReasonKind } from '../../lib/riskReasons';
import { getSpicyDisplayLabel } from '../../lib/display';
import { formatTemplate } from '../../i18n';
import { Card } from '../common/ui';
import { RiskBadge } from './RiskBadge';
import { PriceDetail } from './PriceDisplay';
import { StaffQuestionPanel } from './StaffQuestionPanel';
import { KnowledgeAdvisories, KnowledgeDetails } from './KnowledgeSection';
import { reportHasLiteratureTier } from '../../services/knowledgeBase';
import { ReviewSection } from '../reviews/ReviewSection';
import type { Dish } from '../../types';

const REASON_ICON: Record<ReasonKind, string> = {
  allergy: '⛔',
  dietary: '🥗',
  crossContact: '⚠️',
  spicy: '🌶️',
  uncertain: '❔',
  none: '○',
  error: '✖',
};

// [UX-IMPROVEMENT P0] Everything about ONE selected dish, in this order:
// name + risk reasons (always visible) → ask staff (this dish) →
// ingredients + knowledge-DB advisories (always visible) → knowledge-DB
// evidence (folded) → culture & how to eat (folded) → review (folded).
// Every part reads the same `ranked.dish`, so risk, staff question, TTS,
// copy and review can never disagree about which dish they refer to.
export function DishDetail({ ranked, source, allDishes }: { ranked: RankedDish; source: 'ai_scan' | 'demo_location'; allDishes: Dish[] }) {
  const { t, lang } = useT();
  const profile = useProfileStore(
    useShallow((s) => ({ selectedAllergies: s.selectedAllergies, customAllergies: s.customAllergies, dietary: s.dietary, selectedSpicy: s.selectedSpicy }))
  );
  const noAllergiesConfirmed = useProfileStore((s) => s.noAllergiesConfirmed);
  const resultLocation = useScanStore((s) => s.resultLocation);
  const { dish, result } = ranked;
  const report = useDishKnowledgeReport(dish, source, ranked.uid);
  const reasons = describeRisk(dish, result, profile, lang);
  const hasCulture = (dish.eatingMethod?.length ?? 0) > 0 || !!dish.culturalNote || !!dish.description;

  return (
    <Card className="space-y-3">
      <div>
        <span className="text-[11px] font-bold text-vintage-olive uppercase">{t('selectedDishTitle')}</span>
        <div className="flex items-start justify-between gap-2 mt-0.5">
          <h3 className="font-serif text-lg font-bold text-vintage-dark break-words min-w-0">{dish.name}</h3>
          <RiskBadge state={result.safetyState} />
        </div>
        <span className="text-xs font-mono text-vintage-clay">{getSpicyDisplayLabel(lang, dish.spicy)}</span>
        {/* [PRICE] Same price as in the list, same shared currency. */}
        <div className="mt-1">
          <PriceDetail price={dish.price} />
        </div>
      </div>

      <ul className="space-y-1" aria-label={t(BADGE_KEY[result.safetyState])}>
        {reasons.map((r, i) => (
          <li key={i} className="flex gap-1.5 text-sm text-vintage-dark leading-snug">
            <span aria-hidden="true" className="shrink-0">{REASON_ICON[r.kind]}</span>
            <span>{r.text}</span>
          </li>
        ))}
        {result.safetyState === 'green' && noAllergiesConfirmed && (
          <li className="text-xs text-vintage-olive">{t('noAllergiesNote')}</li>
        )}
      </ul>

      <KnowledgeAdvisories report={report} />

      <StaffQuestionPanel dishes={[dish]} allDishes={allDishes.length > 1 ? allDishes : undefined} />

      {dish.ingredients && (
        <section className="space-y-1">
          <h4 className="text-xs font-bold text-vintage-olive uppercase">{t('ingredientsHeading')}</h4>
          <p className="text-sm text-vintage-dark leading-relaxed">
            {source === 'ai_scan' && (
              <span className="inline-block mr-1.5 px-1.5 rounded bg-vintage-dark/10 text-vintage-dark text-[11px] font-bold">
                {t(dish.ingredientSource === 'printed' ? 'chipIngredientPrinted' : 'chipIngredientInferred')}
              </span>
            )}
            {dish.ingredients}
          </p>
        </section>
      )}

      <Fold title={t('kbEvidenceToggle')}>
        <KnowledgeDetails report={report} />
        {reportHasLiteratureTier(report) && <p className="text-[11px] text-vintage-olive italic">{t('kbLiteratureNote')}</p>}
      </Fold>

      {hasCulture && (
        <Fold title={t('cultureToggle')}>
          {dish.description && <p className="text-sm text-vintage-olive leading-relaxed">{dish.description}</p>}
          {dish.eatingMethod?.length > 0 && (
            <ol className="space-y-1">
              {dish.eatingMethod.map((step, idx) => (
                <li key={idx} className="flex gap-1.5 items-start text-sm text-vintage-dark leading-relaxed">
                  <span className="w-5 h-5 shrink-0 rounded-full bg-vintage-clay/20 text-vintage-terracotta text-[11px] font-bold flex items-center justify-center mt-0.5">
                    {idx + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          )}
          {dish.culturalNote && (
            <p className="p-2 bg-vintage-sage/10 text-vintage-olive rounded-lg text-xs flex gap-1.5 border border-vintage-sage/20">
              <span className="shrink-0" aria-hidden="true">💡</span>
              <span>{dish.culturalNote}</span>
            </p>
          )}
        </Fold>
      )}

      <Fold title={`📝 ${t('reviewForDishTitle')}${resultLocation ? ` · ${formatTemplate(t('reviewAtLocation'), { name: lang === 'ko' ? resultLocation.nameKo : resultLocation.name })}` : ''}`}>
        <ReviewSection
          foodId={dish.foodId}
          context={{
            source,
            locationId: resultLocation?.id,
            locationName: resultLocation ? resultLocation.name : undefined,
            dishNameKo: dish.nameKo,
          }}
        />
      </Fold>
    </Card>
  );
}

function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group border-t border-vintage-dark/10 pt-1">
      <summary className="cursor-pointer min-h-[44px] flex items-center gap-1.5 text-sm font-bold text-vintage-terracotta select-none">
        <span aria-hidden="true" className="transition group-open:rotate-90">▶</span>
        {title}
      </summary>
      <div className="space-y-2 pb-1">{children}</div>
    </details>
  );
}
