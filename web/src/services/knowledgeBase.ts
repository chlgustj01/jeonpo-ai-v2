// Ports the vanilla app's two knowledge-DB loaders (§IMP-12 allergen
// aliases/candidates, §IMP-18D-2 food-ingredient relations) 1:1 — same
// files, same fetch order, same fail-closed behavior (a load failure
// disables matching, it never gets silently treated as "no allergens").
// @ts-expect-error - plain UMD CommonJS module, no .d.ts
import foodKnowledgeModule from '@shared/food-knowledge.js';
import { standardAllergens, LEGACY_ALLERGEN_ID_MAP } from '../lib/allergens';
import { KNOWN_AMBIGUOUS_CUSTOM_TERMS } from '../lib/constants.generated';
import type { CustomAllergyEntry } from '../types';

const {
  FOOD_KB_LOAD_STATUS,
  buildFoodKnowledgeBase,
  buildDishKnowledgeReport,
} = foodKnowledgeModule as {
  FOOD_KB_LOAD_STATUS: { LOADING: string; READY: string; LOAD_FAILED: string };
  buildFoodKnowledgeBase: (input: unknown) => any;
  buildDishKnowledgeReport: (kb: unknown, dish: unknown, ctx: unknown) => any;
};

export { KNOWN_AMBIGUOUS_CUSTOM_TERMS };

const ALLERGEN_KB_SCHEMA_VERSION = '1.0.0';
const ALLERGEN_KB_PATHS = {
  aliases: '/data/generated/allergen-aliases.json',
  candidates: '/data/generated/allergen-candidates.json',
  manifest: '/data/generated/knowledge-manifest.json',
};
const FOOD_KB_PATHS = {
  ingredientKnowledge: '/data/generated/ingredient-knowledge.json',
  evidenceSources: '/data/generated/evidence-sources.json',
};

interface AllergenKBIndexEntry {
  canonicalId: string;
  lang: string;
  source: string;
  evidenceId?: string;
  evidenceScope?: string;
}

export const allergenKB = {
  loaded: false,
  loadError: null as unknown,
  manifest: null as { dataVersion?: string; schemaVersion?: string } | null,
  fetchedManifest: null as unknown,
  index: new Map<string, AllergenKBIndexEntry>(),
  candidateLabelSet: new Set<string>(),
};

export function normalizeAllergyText(text: string | null | undefined): string {
  return (text || '').normalize('NFC').trim().toLowerCase();
}

function registerAllergenKBEntry(
  rawText: string,
  canonicalId: string,
  lang: string,
  source: string,
  evidenceMeta?: { evidenceId?: string; evidenceScope?: string }
) {
  const key = normalizeAllergyText(rawText);
  if (!key) return;
  if (!allergenKB.index.has(key)) {
    allergenKB.index.set(key, {
      canonicalId,
      lang,
      source,
      evidenceId: evidenceMeta?.evidenceId || '',
      evidenceScope: evidenceMeta?.evidenceScope || '',
    });
  }
}

async function loadAllergenKnowledgeBase() {
  try {
    const [aliasRes, candidateRes, manifestRes] = await Promise.all([
      fetch(ALLERGEN_KB_PATHS.aliases),
      fetch(ALLERGEN_KB_PATHS.candidates),
      fetch(ALLERGEN_KB_PATHS.manifest),
    ]);
    if (!aliasRes.ok || !candidateRes.ok || !manifestRes.ok) {
      throw new Error(
        `지식 DB 파일 응답 실패(alias=${aliasRes.status}, candidate=${candidateRes.status}, manifest=${manifestRes.status})`
      );
    }
    const [aliasData, candidateData, manifestData] = await Promise.all([
      aliasRes.json(),
      candidateRes.json(),
      manifestRes.json(),
    ]);
    allergenKB.fetchedManifest = manifestData;

    if (manifestData.schemaVersion !== ALLERGEN_KB_SCHEMA_VERSION) {
      throw new Error(`스키마 버전 불일치: 예상 ${ALLERGEN_KB_SCHEMA_VERSION}, 실제 ${manifestData.schemaVersion}`);
    }
    allergenKB.manifest = manifestData;

    standardAllergens.forEach((entry) => {
      (['ko', 'en', 'ja', 'zh', 'vi', 'es'] as const).forEach((lang) => {
        if (entry.labels[lang]) registerAllergenKBEntry(entry.labels[lang], entry.id, lang, 'standard_label');
      });
    });
    Object.keys(LEGACY_ALLERGEN_ID_MAP).forEach((legacyId) => {
      registerAllergenKBEntry(legacyId, LEGACY_ALLERGEN_ID_MAP[legacyId], 'id_legacy', 'legacy_id');
    });
    const aliasRows = [...(aliasData.reviewed || []), ...(aliasData.literatureBacked || [])];
    aliasRows.forEach((row: any) => {
      registerAllergenKBEntry(row.alias, row.allergenId, row.lang, 'alias_db', {
        evidenceId: row.evidenceId,
        evidenceScope: row.evidenceScope,
      });
    });
    candidateData.forEach((entry: any) => {
      allergenKB.candidateLabelSet.add(entry.id);
      Object.keys(entry.labels || {}).forEach((lang) => {
        registerAllergenKBEntry(entry.labels[lang], entry.id, lang, 'candidate_db');
      });
    });

    allergenKB.loaded = true;
    console.info(
      `[IMP-12] 알레르기 지식 DB 로드 완료 — 색인 ${allergenKB.index.size}건, 후보 ${allergenKB.candidateLabelSet.size}종`
    );
  } catch (err) {
    allergenKB.loaded = false;
    allergenKB.loadError = err;
    console.error('[IMP-12] 알레르기 지식 DB 로드 실패 — 표준/동의어 자동 매칭 없이 번역 API 경로로만 동작:', err);
  }
  return allergenKB;
}

export const allergenKnowledgeBaseReady = loadAllergenKnowledgeBase();

export const foodKB = {
  status: FOOD_KB_LOAD_STATUS.LOADING,
  reason: null as string | null,
  kb: null as any,
};

async function loadFoodKnowledgeBase() {
  try {
    const [ikRes, evRes] = await Promise.all([
      fetch(FOOD_KB_PATHS.ingredientKnowledge),
      fetch(FOOD_KB_PATHS.evidenceSources),
    ]);
    await allergenKnowledgeBaseReady;
    if (!ikRes.ok || !evRes.ok) {
      throw new Error(`식품 지식 DB 파일 응답 실패(ingredient=${ikRes.status}, evidence=${evRes.status})`);
    }
    const [ikData, evData] = await Promise.all([ikRes.json(), evRes.json()]);
    const built = buildFoodKnowledgeBase({
      manifest: allergenKB.fetchedManifest || null,
      ingredientKnowledge: ikData,
      evidenceSources: evData,
      activeAllergenIds: standardAllergens.map((a) => a.id),
    });
    foodKB.status = built.status;
    foodKB.reason = built.reason;
    foodKB.kb = built.status === FOOD_KB_LOAD_STATUS.READY ? built : null;
    if (built.status === FOOD_KB_LOAD_STATUS.READY) {
      console.info(`[IMP-18D-2] 식품 지식 DB 로드 완료 — 식재료 ${built.stats.ingredientCount}`);
    } else {
      console.error(`[IMP-18D-2] 식품 지식 DB 사용 불가 — ${built.status}: ${built.reason}`);
    }
  } catch (err) {
    foodKB.status = FOOD_KB_LOAD_STATUS.LOAD_FAILED;
    foodKB.reason = String((err as Error)?.message || err);
    foodKB.kb = null;
    console.error('[IMP-18D-2] 식품 지식 DB 로드 실패 — 추가 확인 정보만 생략:', err);
  }
  return foodKB;
}

export const foodKnowledgeBaseReady = loadFoodKnowledgeBase();
export const FOOD_KB_STATUS = FOOD_KB_LOAD_STATUS;

export function buildKnowledgeReportForDish(
  dish: unknown,
  analysisSource: string,
  dishKey: string,
  isUserAllergicTo: (id: string) => boolean,
  getUncertainCustomAllergenIds: () => Set<string>
) {
  const activeIds = new Set(standardAllergens.map((a) => a.id));
  // [Package 5] The knowledge DB is keyed by English canonical ingredient
  // names. After translation, dish.ingredients holds e.g. Japanese text
  // ("豆腐") that never matches, so the DB check silently changed with the
  // UI language. Look up the canonical English text when it is available.
  const d = dish as { ingredients?: string; canonicalIngredients?: string } | null;
  const lookupDish = d && typeof d.canonicalIngredients === 'string' ? { ...d, ingredients: d.canonicalIngredients } : dish;
  return buildDishKnowledgeReport(foodKB.kb, lookupDish, {
    kbStatus: foodKB.status,
    analysisSource,
    dishKey,
    isUserAllergicTo,
    uncertainAllergenIds: getUncertainCustomAllergenIds(),
    allergenTermLookup: lookupAllergenTermForIngredient,
    isActiveAllergen: (id: string) => activeIds.has(id),
    ambiguousTerms: KNOWN_AMBIGUOUS_CUSTOM_TERMS,
  });
}

export function lookupAllergenTermForIngredient(text: string) {
  if (!allergenKB.loaded) return null;
  const hit = allergenKB.index.get(normalizeAllergyText(text));
  if (!hit) return null;
  return { allergenId: hit.canonicalId, source: hit.source, evidenceId: hit.evidenceId || '', evidenceScope: hit.evidenceScope || '' };
}

// Google Translate's single free endpoint — same one the vanilla app used
// for custom-allergy "what does this mean in Korean" translation (not the
// menu-translation API, which is the server's /api/translate-dish).
export async function translateToKorean(text: string): Promise<{ text: string; success: boolean }> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data?.[0]?.[0]?.[0]) {
      return { text: data[0][0][0], success: true };
    }
    return { text, success: false };
  } catch (e) {
    console.error('Translation fail, falling back to original', e);
    return { text, success: false };
  }
}

// [Entity Resolution, §IMP-12] Resolve a free-text custom allergy input
// against the registry/alias DB — ported verbatim from resolveCustomAllergyInput().
export async function resolveCustomAllergyInput(rawText: string): Promise<CustomAllergyEntry & { normalized: string }> {
  const normalized = normalizeAllergyText(rawText);

  if (Object.prototype.hasOwnProperty.call(KNOWN_AMBIGUOUS_CUSTOM_TERMS, normalized)) {
    const info = KNOWN_AMBIGUOUS_CUSTOM_TERMS[normalized];
    return {
      original: rawText,
      normalized,
      translated: '',
      canonicalId: null,
      mappingStatus: 'ambiguous',
      mappingSource: 'ambiguous_term_table',
      candidateIds: info.candidateIds.slice(),
      userConfirmed: false,
    };
  }

  if (!allergenKB.loaded) {
    const translation = await translateToKorean(rawText);
    return {
      original: rawText,
      normalized,
      translated: translation.text,
      canonicalId: null,
      mappingStatus: 'kb_unavailable',
      candidateIds: [],
      userConfirmed: false,
    };
  }

  const hit = allergenKB.index.get(normalized);
  if (hit) {
    const isCandidate = allergenKB.candidateLabelSet.has(hit.canonicalId);
    const standardEntry = standardAllergens.find((a) => a.id === hit.canonicalId);
    const koLabel = standardEntry ? standardEntry.labels.ko : rawText;
    return {
      original: rawText,
      normalized,
      translated: koLabel,
      canonicalId: hit.canonicalId,
      mappingStatus: isCandidate ? 'candidate_db' : hit.source === 'alias_db' ? 'exact_alias' : 'exact_standard',
      mappingSource: hit.source,
      candidateIds: [],
      userConfirmed: true,
    };
  }

  const translation = await translateToKorean(rawText);
  return {
    original: rawText,
    normalized,
    translated: translation.text,
    canonicalId: null,
    mappingStatus: translation.success ? 'custom_unlisted' : 'translation_failed',
    candidateIds: [],
    userConfirmed: false,
  };
}
