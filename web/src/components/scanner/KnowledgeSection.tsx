import { useT } from '../../hooks/useT';
import { getAllergenDisplayLabel, getKnowledgeTierLabel, getRelationCategoryLabel } from '../../lib/display';
import { displayIngredient } from '../../services/knowledgeBase';
// @ts-expect-error - plain UMD CommonJS module, no .d.ts
import foodKnowledgeModule from '@shared/food-knowledge.js';

const { isSafeHttpUrl } = foodKnowledgeModule as { isSafeHttpUrl: (url: string) => boolean };

// Ports renderKnowledgeSectionHtml()/renderKnowledgeFindingLine() (§IMP-18D-2).
// "참기름과 참깨의 원재료 관계를 실제 교차 접촉 확인 정보로 표현하지 않는다":
// everything here is framed as "ask staff about this ingredient", never as
// a confirmed cross-contact finding, and nothing here changes the risk badge
// (autoApplyToRiskJudgment:false — this component only reads the DB report).
//
// [UX-IMPROVEMENT] Split in two so the detail panel can show what matters
// first: KnowledgeAdvisories (always visible: findings that touch the user's
// profile, plus "could not check" states) and KnowledgeDetails (folded:
// other relations, ingredients not in the DB, sources). Ingredient names are
// shown in the UI language (displayIngredient) while the lookup itself still
// uses the English canonical tokens. The shared "literature-based" note is
// rendered once by the caller, not once per dish.

export function KnowledgeAdvisories({ report }: { report: any | null }) {
  const { t, lang } = useT();
  const isDemo = report?.aiAnalysis?.source === 'demo_location';
  const ingredientLabelKey = isDemo ? 'kbDemoIngredientLabel' : 'kbAiIngredientLabel';

  if (!report) return <p className="text-xs text-amber-900">{t('kbUnavailable')}</p>;
  if (report.lookupStatus !== 'ready') {
    return <p className="text-xs text-amber-900">{t(report.lookupStatus === 'loading' ? 'kbLoading' : 'kbUnavailable')}</p>;
  }
  if (!report.ingredientsAvailable) return <p className="text-xs text-amber-900">{t('kbNoIngredients')}</p>;

  const profileAmbiguous = report.ambiguousIngredients.filter((a: any) => a.matchesUserProfile);
  if (report.userAdvisories.length === 0 && profileAmbiguous.length === 0) return null;

  return (
    <div className="space-y-2">
      {report.userAdvisories.map((group: any, gi: number) => (
        <div key={gi} className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs space-y-1">
          <p className="font-bold">
            ⚠️ {t('kbCheckNeeded')} · {getAllergenDisplayLabel(lang, group.allergenId)}
          </p>
          {group.findings.map((f: any, fi: number) => (
            <FindingLine key={fi} finding={f} report={report} ingredientLabelKey={ingredientLabelKey} />
          ))}
          <p className="font-semibold">{t('kbAskStaff')}</p>
        </div>
      ))}
      {profileAmbiguous.map((a: any, ai: number) => (
        <p key={ai} className="text-xs text-amber-900 font-semibold">
          {t('kbAmbiguousLabel')}: {displayIngredient(report, a.original)}
          {a.candidateAllergenIds.length > 0 && ` (${a.candidateAllergenIds.map((id: string) => getAllergenDisplayLabel(lang, id)).join(' / ')})`}
        </p>
      ))}
    </div>
  );
}

export function KnowledgeDetails({ report }: { report: any | null }) {
  const { t, lang } = useT();
  if (!report || report.lookupStatus !== 'ready' || !report.ingredientsAvailable) return null;
  const others = report.groups.filter((g: any) => !report.userAdvisories.includes(g));
  const otherAmbiguous = report.ambiguousIngredients.filter((a: any) => !a.matchesUserProfile);

  return (
    <div className="space-y-1.5 text-xs text-vintage-olive leading-relaxed">
      {others.length > 0 && (
        <p>
          <span className="font-bold">{t('kbOtherRelationsLabel')}:</span>{' '}
          {others
            .map(
              (g: any) =>
                `${getAllergenDisplayLabel(lang, g.allergenId)} (${Array.from(new Set<string>(g.findings.map((f: any) => displayIngredient(report, f.originalIngredient)))).join(', ')})`
            )
            .join(', ')}
        </p>
      )}
      {otherAmbiguous.map((a: any, ai: number) => (
        <p key={ai}>
          {t('kbAmbiguousLabel')}: {displayIngredient(report, a.original)}
          {a.candidateAllergenIds.length > 0 && ` (${a.candidateAllergenIds.map((id: string) => getAllergenDisplayLabel(lang, id)).join(' / ')})`}
        </p>
      ))}
      {(report.knowledgeFindings.length === 0 || report.noRelationIngredients.length > 0) && (
        <p>
          {t('kbNoRelations')}
          {report.noRelationIngredients.length > 0 && ` (${report.noRelationIngredients.map((n: any) => displayIngredient(report, n.original)).join(', ')})`}
        </p>
      )}
      {report.unresolvedIngredients.length > 0 && (
        <p>
          <span className="font-bold">{t('kbUnresolvedLabel')}:</span>{' '}
          {report.unresolvedIngredients.map((u: any) => displayIngredient(report, u.original)).join(', ')}
        </p>
      )}
      {others.length > 0 &&
        others.map((g: any, gi: number) => (
          <div key={gi} className="pl-2 border-l-2 border-vintage-dark/10">
            {g.findings.map((f: any, fi: number) => (
              <FindingLine key={fi} finding={f} report={report} ingredientLabelKey="kbAiIngredientLabel" />
            ))}
          </div>
        ))}
    </div>
  );
}

function FindingLine({ finding, report, ingredientLabelKey }: { finding: any; report: any; ingredientLabelKey: string }) {
  const { t, lang } = useT();
  // DB ingredient names exist only in English/Korean; other languages show
  // the translated menu ingredient + the (translated) allergen instead of
  // mixing in an English DB name.
  const dbName =
    lang === 'ko' || lang === 'en'
      ? finding.ingredientId
        ? (lang === 'ko' ? finding.ingredientNameKo : finding.ingredientNameEn) || finding.ingredientId
        : getAllergenDisplayLabel(lang, finding.allergenId)
      : getAllergenDisplayLabel(lang, finding.allergenId);
  return (
    <p>
      {t(ingredientLabelKey)}: <span className="font-semibold">{displayIngredient(report, finding.originalIngredient)}</span> → {dbName} ·{' '}
      {getRelationCategoryLabel(lang, finding.relationCategory)}{' '}
      <span className="opacity-80">({getKnowledgeTierLabel(lang, finding.knowledgeTier)})</span>
      {finding.source && (
        <span className="block opacity-80">
          {t('kbSourceLabel')}:{' '}
          {finding.source.url && isSafeHttpUrl(finding.source.url) ? (
            <a href={finding.source.url} target="_blank" rel="noopener noreferrer" className="underline">
              {finding.source.title || finding.source.id}
            </a>
          ) : (
            finding.source.title || finding.source.id
          )}
        </span>
      )}
    </p>
  );
}
