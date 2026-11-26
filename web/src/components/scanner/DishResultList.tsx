import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProfileStore } from '../../store/profileStore';
import { useT } from '../../hooks/useT';
import { useDishKnowledgeReport } from '../../hooks/useDishKnowledgeReport';
import { checkDishSafety, worstSafety } from '../../lib/safety';
import { getSpicyDisplayLabel } from '../../lib/display';
import { SafetyBanner } from './SafetyBanner';
import { KnowledgeSection } from './KnowledgeSection';
import { StaffQuestionPanel } from './StaffQuestionPanel';
import { Card } from '../common/ui';
import type { Dish } from '../../types';

// Unifies the vanilla version's two separate render paths
// (renderMultiDishScanResult for real AI scans, renderScanResultUI for the
// map's demo "Scan Menu Here" dish) into one component — both just render
// a Dish[] of length 1 or more. §7's information hierarchy per dish:
// name+source -> personal risk banner (one, worst-case across all dishes)
// -> per-dish knowledge-DB advisories -> AI-estimated ingredients ->
// staff-question button -> collapsible details.
export function DishResultList({
  dishes,
  source,
  partialResults,
}: {
  dishes: Dish[];
  source: 'ai_scan' | 'demo_location';
  partialResults?: boolean;
}) {
  const { t } = useT();
  const profile = useProfileStore(
    useShallow((s) => ({
      selectedAllergies: s.selectedAllergies,
      customAllergies: s.customAllergies,
      dietary: s.dietary,
      selectedSpicy: s.selectedSpicy,
    }))
  );

  const perDish = dishes.map((dish) => ({ dish, result: checkDishSafety(dish, profile) }));
  const overall = worstSafety(perDish.map((p) => p.result));

  return (
    <div className="space-y-3">
      {partialResults && (
        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
          {t('toastPartialResults')}
        </p>
      )}
      <SafetyBanner result={overall} sourceNoteKey={source === 'ai_scan' ? 'sourceAiScanNote' : 'sourceDemoNote'} />

      {dishes.map((dish, i) => (
        <DishCard key={dish.foodId + i} dish={dish} source={source} dishKey={`${i}`} />
      ))}

      <StaffQuestionPanel dishes={dishes} />
    </div>
  );
}

function DishCard({ dish, source, dishKey }: { dish: Dish; source: 'ai_scan' | 'demo_location'; dishKey: string }) {
  const { t, lang } = useT();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const report = useDishKnowledgeReport(dish, source, dishKey);

  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-sm text-vintage-dark">{dish.name}</span>
        <span className="text-[10px] font-mono text-vintage-clay shrink-0">{getSpicyDisplayLabel(lang, dish.spicy)}</span>
      </div>

      {dish.ingredients && <p className="text-[11px] text-vintage-olive leading-relaxed">{dish.ingredients}</p>}

      <KnowledgeSection report={report} />

      {(dish.eatingMethod?.length > 0 || dish.culturalNote) && (
        <div>
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
            className="min-h-[36px] text-[10px] font-bold text-vintage-terracotta hover:underline"
          >
            {detailsOpen ? `▲ ${t('specName')}` : `▼ ${t('howToEatLabel')}`}
          </button>
          {detailsOpen && (
            <div className="space-y-2 pt-1">
              {dish.description && <p className="text-[11px] text-vintage-olive leading-relaxed">{dish.description}</p>}
              {dish.eatingMethod?.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-vintage-dark/10">
                  <span className="text-[9px] font-bold text-vintage-olive uppercase">{t('howToEatLabel')}</span>
                  {dish.eatingMethod.map((step, idx) => (
                    <div key={idx} className="flex gap-1.5 items-start">
                      <span className="w-4 h-4 shrink-0 rounded-full bg-vintage-clay/20 text-vintage-terracotta text-[9px] font-bold flex items-center justify-center mt-0.5">
                        {idx + 1}
                      </span>
                      <p className="text-[11px] text-vintage-dark leading-relaxed">{step}</p>
                    </div>
                  ))}
                </div>
              )}
              {dish.culturalNote && (
                <div className="p-2 bg-vintage-sage/10 text-vintage-olive rounded-lg text-[10px] flex gap-1.5 border border-vintage-sage/20">
                  <span className="shrink-0" aria-hidden="true">💡</span>
                  <span>{dish.culturalNote}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
