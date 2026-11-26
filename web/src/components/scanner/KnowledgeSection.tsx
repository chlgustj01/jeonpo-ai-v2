import { useT } from '../../hooks/useT';
import { getAllergenDisplayLabel, getKnowledgeTierLabel, getRelationCategoryLabel } from '../../lib/display';
// @ts-expect-error - plain UMD CommonJS module, no .d.ts
import foodKnowledgeModule from '@shared/food-knowledge.js';

const { isSafeHttpUrl } = foodKnowledgeModule as { isSafeHttpUrl: (url: string) => boolean };

// Ports renderKnowledgeSectionHtml()/renderKnowledgeFindingLine() (§IMP-18D-2)
// as JSX — React escapes all interpolated text by default, so the manual
// escapeHtml() calls the vanilla version needed everywhere here simply
// disappear; this is one of the real wins of the rewrite, not a shortcut.
// §7 of this package's request: "참기름과 참깨의 원재료 관계를 실제 교차
// 접촉 확인 정보로 표현하지 않는다" — this section is explicitly framed as
// "additional confirmation candidates to ask about", never as a confirmed
// cross-contact finding (that distinction already lives in checkDishSafety
// — this component only ever reads from the knowledge DB, never writes
// into the risk banner above it).
export function KnowledgeSection({ report }: { report: any | null }) {
  const { t, lang } = useT();
  const isDemo = report?.aiAnalysis?.source === 'demo_location';
  const ingredientLabelKey = isDemo ? 'kbDemoIngredientLabel' : 'kbAiIngredientLabel';

  return (
    <div className="space-y-1 pt-2 border-t border-vintage-dark/10">
      <span className="text-[9px] font-bold text-vintage-olive uppercase">{t('kbSectionTitle')}</span>

      {!report && <p className="text-[10px] text-amber-800">{t('kbUnavailable')}</p>}
      {report && report.lookupStatus !== 'ready' && (
        <p className="text-[10px] text-amber-800">{t(report.lookupStatus === 'loading' ? 'kbLoading' : 'kbUnavailable')}</p>
      )}
      {report && report.lookupStatus === 'ready' && !report.ingredientsAvailable && (
        <p className="text-[10px] text-amber-800">{t('kbNoIngredients')}</p>
      )}

      {report && report.lookupStatus === 'ready' && report.ingredientsAvailable && (
        <>
          {report.userAdvisories.map((group: any, gi: number) => (
            <div key={gi} className="p-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-[10px] space-y-0.5">
              <p className="font-bold text-[11px]">
                ⚠️ {t('kbCheckNeeded')} · {getAllergenDisplayLabel(lang, group.allergenId)}
              </p>
              {group.findings.map((f: any, fi: number) => (
                <FindingLine key={fi} finding={f} ingredientLabelKey={ingredientLabelKey} />
              ))}
              <p className="font-semibold">{t('kbAskStaff')}</p>
            </div>
          ))}

          {report.ambiguousIngredients.map((a: any, ai: number) => (
            <p key={ai} className={`text-[10px] ${a.matchesUserProfile ? 'text-amber-800 font-semibold' : 'text-vintage-olive'}`}>
              {t('kbAmbiguousLabel')}: {a.original}
              {a.candidateAllergenIds.length > 0 && ` (${a.candidateAllergenIds.map((id: string) => getAllergenDisplayLabel(lang, id)).join(' / ')})`}
            </p>
          ))}

          {report.groups.filter((g: any) => !report.userAdvisories.includes(g)).length > 0 && (
            <p className="text-[10px] text-vintage-olive">
              <span className="font-bold">{t('kbOtherRelationsLabel')}:</span>{' '}
              {report.groups
                .filter((g: any) => !report.userAdvisories.includes(g))
                .map((g: any) => `${getAllergenDisplayLabel(lang, g.allergenId)} (${Array.from(new Set<string>(g.findings.map((f: any) => f.originalIngredient))).join(', ')})`)
                .join(', ')}
            </p>
          )}

          {(report.knowledgeFindings.length === 0 || report.noRelationIngredients.length > 0) && (
            <p className="text-[10px] text-vintage-olive">
              {t('kbNoRelations')}
              {report.noRelationIngredients.length > 0 && ` (${report.noRelationIngredients.map((n: any) => n.original).join(', ')})`}
            </p>
          )}

          {report.unresolvedIngredients.length > 0 && (
            <p className="text-[10px] text-vintage-olive">
              <span className="font-bold">{t('kbUnresolvedLabel')}:</span> {report.unresolvedIngredients.map((u: any) => u.original).join(', ')}
            </p>
          )}

          {(report.userAdvisories.some((g: any) => g.findings.some((f: any) => f.knowledgeTier === 'literature_candidate')) ||
            report.groups.some((g: any) => g.findings.some((f: any) => f.knowledgeTier === 'literature_candidate'))) && (
            <p className="text-[9px] text-vintage-olive italic">{t('kbLiteratureNote')}</p>
          )}
        </>
      )}
    </div>
  );
}

function FindingLine({ finding, ingredientLabelKey }: { finding: any; ingredientLabelKey: string }) {
  const { t, lang } = useT();
  const dbName = finding.ingredientId
    ? (lang === 'ko' ? finding.ingredientNameKo : finding.ingredientNameEn) || finding.ingredientId
    : getAllergenDisplayLabel(lang, finding.allergenId);
  return (
    <p>
      {t(ingredientLabelKey)}: <span className="font-semibold">{finding.originalIngredient}</span> → {dbName} ·{' '}
      {getRelationCategoryLabel(lang, finding.relationCategory)}{' '}
      <span className="opacity-80">({getKnowledgeTierLabel(lang, finding.knowledgeTier)})</span>
      {finding.source && (
        <span className="block text-[9px] opacity-80">
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
