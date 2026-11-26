import { standardAllergens } from './allergens';
import { translate } from '../i18n';
import type { Lang } from '../types';

export function getSpicyDisplayLabel(lang: Lang, spicyValue: number | null | undefined): string {
  if (spicyValue === null || spicyValue === undefined) return translate(lang, 'spicyUnknown');
  const keysByLevel = ['spicyMild', 'spicyNormal', 'spicyHot', 'spicyExtreme'];
  const key = keysByLevel[spicyValue];
  return key ? translate(lang, key) : translate(lang, 'spicyUnknown');
}

export function getAllergenDisplayLabel(lang: Lang, allergenId: string): string {
  const entry = standardAllergens.find((a) => a.id === allergenId);
  if (!entry) return allergenId;
  return `${entry.icon || ''} ${entry.labels[lang] || entry.labels.en}`.trim();
}

const RELATION_CATEGORY_KEY: Record<string, string> = {
  ingredient_definition: 'kbRelDefinition',
  raw_material: 'kbRelRawMaterial',
  typical_recipe: 'kbRelTypicalRecipe',
  product_variant: 'kbRelProductVariant',
  unconfirmed: 'kbRelUnconfirmed',
  allergen_name: 'kbRelAllergenTerm',
};

export function getRelationCategoryLabel(lang: Lang, category: string): string {
  return translate(lang, RELATION_CATEGORY_KEY[category] || 'kbRelUnconfirmed');
}

export function getKnowledgeTierLabel(lang: Lang, tier: string): string {
  if (tier === 'confirmed_relation') return translate(lang, 'kbTierConfirmed');
  if (tier === 'literature_candidate') return translate(lang, 'kbTierLiterature');
  return translate(lang, 'kbTierTerm');
}

// [IMP-03/15] Appends a short note to the green banner when the knowledge
// DB found something worth a second look, WITHOUT changing the safety
// state itself (autoApplyToRiskJudgment:false stays a UI-only nudge).
export function composeGreenBannerDesc(lang: Lang, reports: any[], baseDesc: string): string {
  const hasAdvisory = reports.some(
    (r) => r && (r.userAdvisories.length > 0 || r.ambiguousIngredients.some((a: any) => a.matchesUserProfile))
  );
  if (hasAdvisory) return `${baseDesc} ${translate(lang, 'kbBannerAdvisoryNote')}`;
  const notCompleted = reports.some((r) => !r || r.lookupStatus !== 'ready');
  if (notCompleted) return `${baseDesc} ${translate(lang, 'kbBannerUnavailableNote')}`;
  return baseDesc;
}
