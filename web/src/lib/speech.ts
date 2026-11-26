// Ports getSpeechScript/generateStaffQuestions (§IMP-09) — pure functions,
// no DOM/global state. These build the Korean sentences spoken to staff;
// the four question types are rule-based (no extra Gemini call, per §IMP-09
// and this package's §9 "의미가 불명확한 커스텀 알레르기는... 유지").
import { standardAllergens } from './allergens';
import { DIET_PHRASES_KO } from './constants.generated';
import { checkDishSafety, type Profile } from './safety';
import { buildKnowledgeReportForDish, normalizeAllergyText } from '../services/knowledgeBase';
import type { CustomAllergyEntry, Dietary, Dish, StaffQuestions } from '../types';

export function getSpokenAllergyListKo(profile: Pick<Profile, 'selectedAllergies' | 'customAllergies'>): string[] {
  const allergyListKo: string[] = [];
  const spokenKeys = new Set<string>();

  standardAllergens.forEach((allg) => {
    if (profile.selectedAllergies.has(allg.id) && !spokenKeys.has(allg.id)) {
      allergyListKo.push(allg.labels.ko);
      spokenKeys.add(allg.id);
    }
  });

  profile.customAllergies.forEach((c) => {
    if (c.mappingStatus === 'ambiguous' || !c.translated) return;
    const dedupeKey = c.canonicalId || `text:${normalizeAllergyText(c.translated)}`;
    if (spokenKeys.has(dedupeKey)) return;
    spokenKeys.add(dedupeKey);
    allergyListKo.push(c.translated);
  });

  return allergyListKo;
}

export function extractKoreanName(str: string | undefined | null): string {
  const match = (str || '').match(/\(([^)]+)\)\s*$/);
  return match ? match[1] : str || '이 요리';
}

export function getSpeechScript(profile: Profile, dishNameText?: string): string {
  const targetDish = dishNameText || '이 요리';
  const allergyListKo = getSpokenAllergyListKo(profile);
  const dietPhrase = DIET_PHRASES_KO[profile.dietary] || '';

  let allergyPhrase: string;
  if (allergyListKo.length === 0) {
    allergyPhrase = `${targetDish}에 어떠한 알레르기 유발 성분이 포함되어 있는지 확인해 주실 수 있나요?`;
  } else {
    allergyPhrase = `저는 심한 [ ${allergyListKo.join(', ')} ] 알레르기가 있습니다. ${targetDish}에 혹시 해당 성분이 들어가나요?`;
  }

  if (dietPhrase) return `안녕하세요, ${dietPhrase} 그리고 ${allergyPhrase}`;
  return `안녕하세요, ${allergyPhrase}`;
}

// [IMP-09] "Which dishes to name in the question" — same rule the vanilla
// app used for its single "Ask Waiter" phrase: name the risky ones first,
// fall back to all of them if nothing is flagged.
export function getRiskyDishNamesKo(dishes: Dish[], profile: Profile): string[] {
  const risky = dishes.filter((d) => checkDishSafety(d, profile).safetyState !== 'green').map((d) => d.nameKo);
  return risky.length > 0 ? risky : dishes.map((d) => d.nameKo);
}

export function generateStaffQuestions(dishes: Dish[], profile: Profile): StaffQuestions {
  const names = dishes.length > 0 ? getRiskyDishNamesKo(dishes, profile) : [];
  const dishNameKo = names.length > 0 ? names.join(', ') : '이 요리';
  const dietPhraseKo = DIET_PHRASES_KO[profile.dietary] || '';
  const allergyListKo = getSpokenAllergyListKo(profile);

  const general = `${dishNameKo}에 어떤 재료와 양념이 들어가나요?`;

  let personal: string;
  if (allergyListKo.length === 0 && !dietPhraseKo) {
    personal = `${dishNameKo}에 알레르기를 유발할 수 있는 성분이 있나요?`;
  } else {
    const parts: string[] = [];
    if (dietPhraseKo) parts.push(dietPhraseKo);
    if (allergyListKo.length > 0) {
      parts.push(`저는 [ ${allergyListKo.join(', ')} ] 알레르기가 있습니다. ${dishNameKo}에 혹시 해당 성분이 들어가나요?`);
    }
    personal = parts.join(' ');
  }
  if (profile.dietary === 'halal') {
    personal += ' 돼지고기, 돼지고기로 만든 기름(라드), 술이 들어가는지도 확인해 주세요.';
  }

  const crossContactCandidates = new Set<string>();
  const isUserAllergicTo = (id: string) => profile.selectedAllergies.has(id) || profile.customAllergies.some((c) => c.canonicalId === id && c.userConfirmed);
  const getUncertainIds = () => {
    const ids = new Set<string>();
    profile.customAllergies.forEach((c) => {
      if (c.mappingStatus === 'ambiguous' && !c.userConfirmed) (c.candidateIds || []).forEach((id) => ids.add(id));
    });
    return ids;
  };
  dishes.forEach((dish) => {
    try {
      const report = buildKnowledgeReportForDish(dish, 'staff_question', 'staffq', isUserAllergicTo, getUncertainIds);
      (report?.userAdvisories || []).forEach((group: any) => {
        group.findings.forEach((f: any) => {
          if (f.originalIngredient) crossContactCandidates.add(f.originalIngredient);
        });
      });
    } catch {
      // Knowledge DB not ready yet — fall through to the generic question below.
    }
  });
  const candidateList = Array.from(crossContactCandidates);
  const crossContact =
    candidateList.length > 0
      ? `${dishNameKo}에 ${candidateList.join(', ')}을(를) 조리 기구나 기름, 조리 공간에서 같이 사용하는지 확인해 주실 수 있나요? 제 알레르기와 관련이 있을 수 있어서요.`
      : `${dishNameKo}을 만들 때 저에게 위험한 알레르기 성분이 들어간 조리도구, 기름, 조리 공간을 함께 쓰는지 확인해 주실 수 있나요?`;

  const comprehensiveParts: string[] = [];
  if (dietPhraseKo) comprehensiveParts.push(dietPhraseKo);
  if (allergyListKo.length > 0) comprehensiveParts.push(`저는 [ ${allergyListKo.join(', ')} ] 알레르기가 있습니다.`);
  comprehensiveParts.push(
    `${dishNameKo}에 어떤 재료가 들어가는지, 그리고 ${
      candidateList.length > 0
        ? candidateList.join(', ') + ' 등이 조리 도구나 기름을 통해 같이 섞일 가능성이 있는지'
        : '제 알레르기 성분이 조리 과정에서 같이 섞일 가능성이 있는지'
    } 확인해 주실 수 있나요?`
  );
  if (profile.dietary === 'halal') comprehensiveParts.push('돼지고기나 술이 들어가는지도 함께 확인해 주세요.');
  const comprehensive = comprehensiveParts.join(' ');

  const hasAmbiguousCustomAllergyCaveat = profile.customAllergies.some(
    (c) => c.mappingStatus === 'ambiguous' && !c.userConfirmed
  );

  return { general, personal, crossContact, comprehensive, hasAmbiguousCustomAllergyCaveat, dishNameKo };
}

export function hashStringForCache(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export type { Dietary, CustomAllergyEntry };
