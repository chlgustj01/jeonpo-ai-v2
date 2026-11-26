// shared/food-knowledge.js
//
// [IMP-18D-2] 식품 지식 DB(ingredient-knowledge.json) 기반 "추가 확인 정보" 조회 모듈.
//
// 이 모듈은 Knowledge-Augmented AI의 "지식(규칙) 쪽 절반"이다:
//   Gemini(AI)가 추정한 식재료 문자열 → 표준 식재료 ID(Entity Resolution)
//   → 식재료-알레르겐 관계 조회(Lookup Table / Relationship Traversal, 1단계)
//   → 근거 출처 연결(Data Provenance / Evidence Path)
// 을 결정론적 규칙(Deterministic Rule Engine)으로만 수행한다. 벡터 검색이나
// 생성형 검색(RAG)은 쓰지 않는다 — 전부 "정규화 후 완전 일치" 조회다.
//
// 절대 원칙(docs/devlog/IMP-18D-2.md §5 정책):
//   1. AI 분석 결과(dish.allergens / crossContactAllergens)를 절대 수정하지
//      않는다. 이 모듈의 결과는 별도 객체(knowledge report)로만 돌려준다.
//   2. 여기서 찾은 관계는 이번 단계에서 위험도(RED/ORANGE) 판정에 쓰지
//      않는다(usedForRiskJudgment: false). literatureBackedCandidates는
//      데이터 자체가 autoApplyToRiskJudgment:false를 강제한다.
//   3. "관계를 못 찾음"은 "성분 없음"이 아니다 — unresolved/noRelation
//      목록으로 원본값을 보존하고 UI가 "안전 확인 아님"을 안내하게 한다.
//   4. 부분 문자열·유사도 매칭 금지(참기름↔들기름, peanut↔pinenut 보호).
//   5. 활성 21종(shared/allergens.js) 밖의 알레르겐 id(후보 18종)는 관계가
//      있어도 결과에 넣지 않는다 — 후보 알레르겐 임의 활성화 금지.
//
// 순수 함수만 둔다(fetch/DOM 없음) — 로딩(fetch)은 index.html이 담당하고,
// 이 파일은 Node(테스트)와 브라우저 양쪽에서 같은 코드로 동작한다(UMD,
// shared/allergens.js·shared/dish-schema.js와 동일 패턴).

var FOOD_KB_SUPPORTED_SCHEMA_VERSION = '1.0.0';

// Data Loading Lifecycle — 지식 DB가 지금 어떤 상태인지 구분한다.
var FOOD_KB_LOAD_STATUS = {
  LOADING: 'loading',
  READY: 'ready',
  LOAD_FAILED: 'load_failed',
  SCHEMA_VERSION_MISMATCH: 'schema_version_mismatch',
  DATA_VERSION_MISMATCH: 'data_version_mismatch',
};

// 실제 생성 JSON의 relationType 값 5종(scripts/food_knowledge/schema.py와
// data/generated/ingredient-knowledge.json에서 확인) → 화면/정책용 분류.
var RELATION_CATEGORY_BY_TYPE = {
  IS_ALLERGEN: 'ingredient_definition',
  CONTAINS_AS_RAW_MATERIAL: 'raw_material',
  TYPICAL_RECIPE_INCLUSION: 'typical_recipe',
  PRODUCT_VARIANT_DEPENDENT: 'product_variant',
  UNCONFIRMED: 'unconfirmed',
};

var KNOWLEDGE_TIER = {
  CONFIRMED_RELATION: 'confirmed_relation', // ingredient-knowledge.json.confirmedRelations
  LITERATURE_CANDIDATE: 'literature_candidate', // ingredient-knowledge.json.literatureBackedCandidates
  ALLERGEN_TERM: 'allergen_term', // IMP-12 알레르겐 색인(표준 라벨/검증 동의어)과 식재료 문자열이 정확히 일치
};

// 요청 §5의 A~G 정보 분류 중 DB 쪽(C~G)을 관계 하나하나에 붙인다.
// A(AI 직접 포함 추정)·B(AI 교차 접촉 추정)는 aiAnalysis에 그대로 남는다.
// F(실제 음식점 확인)는 현재 데이터에 0건이라 이 모듈이 만들어내지 않는다.
var INFORMATION_CLASS = {
  C_INGREDIENT_DEFINITION: 'C_ingredient_definition',
  D_GENERAL_RECIPE: 'D_general_recipe_possibility',
  E_PRODUCT_SPECIFIC: 'E_product_specific',
  G_UNCONFIRMED: 'G_unconfirmed',
};

// ETL(scripts/food_knowledge/transform.py)이 배열을 나누는 기준을 그대로
// 따른다: Excel reviewStatus == 'reviewed' → confirmedRelations,
// 'literature_reviewed' → literatureBackedCandidates, 그 외(pending 등) →
// 서비스 JSON에서 제외. 생성 JSON 레코드 자체에는 reviewStatus 필드가 없으므로
// "어느 배열에 들어 있는가"가 곧 검토 상태다. 만약 레코드가 reviewStatus를
// 직접 들고 있는데 배열 규칙과 다르면(예: pending이 섞여 들어옴) 제외한다.
var EXPECTED_REVIEW_STATUS = {
  confirmedRelations: 'reviewed',
  literatureBackedCandidates: 'literature_reviewed',
};

var FILE_KEYS = {
  INGREDIENT_KNOWLEDGE: 'ingredient-knowledge.json',
  EVIDENCE_SOURCES: 'evidence-sources.json',
};

// Entity Resolution용 정규화: Unicode NFC + 앞뒤 공백 제거 + 연속 공백 1칸
// + 소문자. 밑줄/하이픈을 공백으로 바꾸는 등의 "추측성" 변환은 하지 않는다
// (sesame_oil은 표준 식재료 ID 그 자체와 완전 일치할 때만 매핑된다).
function normalizeKnowledgeText(text) {
  if (typeof text !== 'string') return '';
  return text.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Gemini의 ingredients는 배열이 아니라 "쉼표로 구분된 문자열"이다
// (api/analyze-menu.js 프롬프트: "Comma-separated key ingredients, written in
// <언어>"). 괄호 안의 쉼표("soybean paste (contains soybean, wheat)")에서
// 자르지 않도록 괄호 깊이를 센다. 원본 표기는 그대로 보존한다.
function splitIngredientList(text) {
  if (typeof text !== 'string') return [];
  var tokens = [];
  var depth = 0;
  var current = '';
  var openers = '(（[［{';
  var closers = ')）]］}';
  var separators = ',，、;；\n';
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    if (openers.indexOf(ch) !== -1) depth += 1;
    else if (closers.indexOf(ch) !== -1 && depth > 0) depth -= 1;
    if (depth === 0 && separators.indexOf(ch) !== -1) {
      tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  tokens.push(current);
  return tokens.map(function (t) { return t.trim(); }).filter(function (t) { return t.length > 0; });
}

// 외부 출처 URL은 http/https만 링크로 허용한다(javascript:, data: 등 차단).
// vm 테스트 환경에는 URL 생성자가 없을 수 있어 정규식으로 판정한다.
function isSafeHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\/[^\s<>"'`]+$/i.test(url);
}

function makeFailedKb(status, reason, issues) {
  return {
    status: status,
    reason: reason,
    issues: issues || [],
    dataVersion: null,
    schemaVersion: null,
    ingredientsById: new Map(),
    nameIndex: new Map(),
    relationsByIngredient: new Map(),
    evidenceById: new Map(),
    stats: null,
  };
}

// 지식 JSON(이미 파싱된 객체)을 검증하고 조회용 색인을 만든다.
// input: { manifest, ingredientKnowledge, evidenceSources, activeAllergenIds }
function buildFoodKnowledgeBase(input) {
  var issues = [];
  var manifest = input && input.manifest;
  var ik = input && input.ingredientKnowledge;
  var evidenceSources = input && input.evidenceSources;
  var activeIds = new Set((input && input.activeAllergenIds) || []);

  if (!manifest || typeof manifest !== 'object') {
    return makeFailedKb(FOOD_KB_LOAD_STATUS.LOAD_FAILED, 'manifest_missing');
  }
  if (manifest.schemaVersion !== FOOD_KB_SUPPORTED_SCHEMA_VERSION) {
    return makeFailedKb(FOOD_KB_LOAD_STATUS.SCHEMA_VERSION_MISMATCH,
      'expected ' + FOOD_KB_SUPPORTED_SCHEMA_VERSION + ', got ' + String(manifest.schemaVersion));
  }
  if (manifest.validationStatus && manifest.validationStatus.status !== 'passed') {
    return makeFailedKb(FOOD_KB_LOAD_STATUS.LOAD_FAILED, 'manifest_validation_not_passed');
  }
  if (typeof manifest.dataVersion !== 'string' || manifest.dataVersion.length === 0) {
    return makeFailedKb(FOOD_KB_LOAD_STATUS.DATA_VERSION_MISMATCH, 'manifest_data_version_missing');
  }
  if (!ik || typeof ik !== 'object' || Array.isArray(ik) ||
      !Array.isArray(ik.ingredients) || !Array.isArray(ik.confirmedRelations) ||
      !Array.isArray(ik.literatureBackedCandidates)) {
    return makeFailedKb(FOOD_KB_LOAD_STATUS.LOAD_FAILED, 'invalid_structure:ingredient-knowledge.json');
  }
  if (!Array.isArray(evidenceSources)) {
    return makeFailedKb(FOOD_KB_LOAD_STATUS.LOAD_FAILED, 'invalid_structure:evidence-sources.json');
  }

  // [데이터 버전 일치] 생성 JSON 파일 자체에는 dataVersion이 없다. 대신
  // manifest.recordCounts(같은 ETL 실행이 기록한 레코드 수)와 실제 레코드 수를
  // 대조해, 서로 다른 빌드에서 나온 파일이 섞여 배포/캐시된 상황을 잡는다.
  var counts = manifest.recordCounts || {};
  var actualIkCount = ik.ingredients.length + ik.confirmedRelations.length + ik.literatureBackedCandidates.length;
  if (counts[FILE_KEYS.INGREDIENT_KNOWLEDGE] !== actualIkCount) {
    return makeFailedKb(FOOD_KB_LOAD_STATUS.DATA_VERSION_MISMATCH,
      FILE_KEYS.INGREDIENT_KNOWLEDGE + ' manifest=' + String(counts[FILE_KEYS.INGREDIENT_KNOWLEDGE]) + ' actual=' + actualIkCount);
  }
  if (counts[FILE_KEYS.EVIDENCE_SOURCES] !== evidenceSources.length) {
    return makeFailedKb(FOOD_KB_LOAD_STATUS.DATA_VERSION_MISMATCH,
      FILE_KEYS.EVIDENCE_SOURCES + ' manifest=' + String(counts[FILE_KEYS.EVIDENCE_SOURCES]) + ' actual=' + evidenceSources.length);
  }

  // 출처 색인
  var evidenceById = new Map();
  evidenceSources.forEach(function (ev, idx) {
    if (!ev || typeof ev.id !== 'string' || !ev.id) {
      issues.push({ kind: 'invalid_evidence_record', index: idx });
      return;
    }
    if (evidenceById.has(ev.id)) {
      issues.push({ kind: 'duplicate_evidence_id', id: ev.id });
      return;
    }
    evidenceById.set(ev.id, ev);
  });

  // 식재료 색인 (Lookup Table + Search Index)
  var ingredientsById = new Map();
  ik.ingredients.forEach(function (ing, idx) {
    if (!ing || typeof ing.id !== 'string' || !ing.id) {
      issues.push({ kind: 'invalid_ingredient_record', index: idx });
      return;
    }
    if (ingredientsById.has(ing.id)) {
      issues.push({ kind: 'duplicate_ingredient_id', id: ing.id });
      return;
    }
    ingredientsById.set(ing.id, {
      id: ing.id,
      nameKo: typeof ing.nameKo === 'string' ? ing.nameKo : '',
      nameEn: typeof ing.nameEn === 'string' ? ing.nameEn : '',
      kind: typeof ing.kind === 'string' ? ing.kind : '',
    });
  });

  // nameIndex: 정규화 키 → { ingredientIds: [...], matchedBy: { id: 'ingredient_id'|'name_ko'|'name_en' } }
  // 같은 키가 서로 다른 식재료 둘 이상을 가리키면(색인 충돌) 자동 확정하지
  // 않고 resolveIngredientTerm()이 'ambiguous'로 돌려준다.
  var nameIndex = new Map();
  function addKey(rawKey, ingredientId, matchedBy) {
    var key = normalizeKnowledgeText(rawKey);
    if (!key) return;
    var entry = nameIndex.get(key);
    if (!entry) {
      entry = { ingredientIds: [], matchedBy: {} };
      nameIndex.set(key, entry);
    }
    if (entry.ingredientIds.indexOf(ingredientId) === -1) {
      entry.ingredientIds.push(ingredientId);
      entry.matchedBy[ingredientId] = matchedBy;
    }
  }
  ingredientsById.forEach(function (ing) {
    addKey(ing.id, ing.id, 'ingredient_id');
    addKey(ing.nameKo, ing.id, 'name_ko');
    addKey(ing.nameEn, ing.id, 'name_en');
  });
  var indexCollisionKeys = [];
  nameIndex.forEach(function (entry, key) {
    if (entry.ingredientIds.length > 1) indexCollisionKeys.push(key);
  });
  indexCollisionKeys.forEach(function (key) {
    issues.push({ kind: 'ingredient_index_collision', key: key, ingredientIds: nameIndex.get(key).ingredientIds.slice() });
  });

  // 관계 색인
  var relationsByIngredient = new Map();
  var seenRelationIds = new Set();
  var excluded = {};
  var usableCount = { confirmedRelations: 0, literatureBackedCandidates: 0 };
  function exclude(reason, rel) {
    excluded[reason] = (excluded[reason] || 0) + 1;
    issues.push({ kind: 'relation_excluded', reason: reason, relationId: rel && rel.id, ingredientId: rel && rel.ingredientId, allergenId: rel && rel.allergenId });
  }

  ['confirmedRelations', 'literatureBackedCandidates'].forEach(function (arrayName) {
    var isCandidateArray = arrayName === 'literatureBackedCandidates';
    ik[arrayName].forEach(function (rel) {
      if (!rel || typeof rel !== 'object' || typeof rel.id !== 'string' ||
          typeof rel.ingredientId !== 'string' || typeof rel.allergenId !== 'string' ||
          typeof rel.relationType !== 'string') {
        exclude('invalid_relation_record', rel);
        return;
      }
      if (seenRelationIds.has(rel.id)) { exclude('duplicate_relation_id', rel); return; }
      seenRelationIds.add(rel.id);
      if (Object.prototype.hasOwnProperty.call(rel, 'reviewStatus') && rel.reviewStatus !== EXPECTED_REVIEW_STATUS[arrayName]) {
        // 검토 대기 관계 자동 승인 금지 — 배열 규칙과 다른 상태는 쓰지 않는다.
        exclude('unexpected_review_status:' + String(rel.reviewStatus), rel);
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(RELATION_CATEGORY_BY_TYPE, rel.relationType)) {
        exclude('unknown_relation_type', rel); return;
      }
      if (!ingredientsById.has(rel.ingredientId)) { exclude('broken_ingredient_reference', rel); return; }
      if (!activeIds.has(rel.allergenId)) {
        // 예: 실제 데이터 ia_0035(mustard_sauce → mustard). mustard는 후보 18종
        // 중 하나라 활성 목록에 없다 — 결과에 넣으면 후보를 임의 활성화하는 셈.
        exclude('allergen_not_active', rel); return;
      }

      var autoApply = Object.prototype.hasOwnProperty.call(rel, 'autoApplyToRiskJudgment') ? rel.autoApplyToRiskJudgment : null;
      if (isCandidateArray && autoApply !== false) {
        issues.push({ kind: 'candidate_auto_apply_forced_false', relationId: rel.id, raw: autoApply });
        autoApply = false;
      }

      var evidenceId = typeof rel.evidenceId === 'string' ? rel.evidenceId : '';
      var evidenceStatus;
      if (!evidenceId) evidenceStatus = 'no_evidence_id';
      else if (evidenceById.has(evidenceId)) evidenceStatus = 'linked';
      else {
        evidenceStatus = 'evidence_not_found';
        issues.push({ kind: 'missing_evidence_source', relationId: rel.id, evidenceId: evidenceId });
      }

      var relation = {
        id: rel.id,
        ingredientId: rel.ingredientId,
        allergenId: rel.allergenId,
        relationType: rel.relationType,
        relationCategory: RELATION_CATEGORY_BY_TYPE[rel.relationType],
        knowledgeTier: isCandidateArray ? KNOWLEDGE_TIER.LITERATURE_CANDIDATE : KNOWLEDGE_TIER.CONFIRMED_RELATION,
        reviewStatus: EXPECTED_REVIEW_STATUS[arrayName],
        evidenceScope: typeof rel.evidenceScope === 'string' && rel.evidenceScope ? rel.evidenceScope : null,
        confidence: typeof rel.confidence === 'string' ? rel.confidence : null,
        autoApplyToRiskJudgment: autoApply,
        usableFor: Array.isArray(rel.usableFor) ? rel.usableFor.slice() : [],
        evidenceId: evidenceId || null,
        evidenceStatus: evidenceStatus,
        sourceArray: arrayName,
      };
      if (!relationsByIngredient.has(rel.ingredientId)) relationsByIngredient.set(rel.ingredientId, []);
      relationsByIngredient.get(rel.ingredientId).push(relation);
      usableCount[arrayName] += 1;
    });
  });

  return {
    status: FOOD_KB_LOAD_STATUS.READY,
    reason: null,
    issues: issues,
    dataVersion: manifest.dataVersion,
    schemaVersion: manifest.schemaVersion,
    ingredientsById: ingredientsById,
    nameIndex: nameIndex,
    relationsByIngredient: relationsByIngredient,
    evidenceById: evidenceById,
    stats: {
      ingredientCount: ingredientsById.size,
      indexKeyCount: nameIndex.size,
      indexCollisionCount: indexCollisionKeys.length,
      sourceRelationCount: {
        confirmedRelations: ik.confirmedRelations.length,
        literatureBackedCandidates: ik.literatureBackedCandidates.length,
      },
      usableRelationCount: usableCount,
      usableRelationTotal: usableCount.confirmedRelations + usableCount.literatureBackedCandidates,
      excludedRelations: excluded,
      ingredientsWithRelations: relationsByIngredient.size,
      evidenceCount: evidenceById.size,
    },
  };
}

// 식재료 문자열 1개 → 표준 식재료 ID. (Entity Resolution)
// opts.ambiguousTerms: index.html의 KNOWN_AMBIGUOUS_CUSTOM_TERMS(IMP-12)를 그대로
// 넘겨받는다 — 같은 모호어 사전을 두 군데에 따로 두지 않기 위함.
function resolveIngredientTerm(kb, rawToken, opts) {
  var normalized = normalizeKnowledgeText(rawToken);
  var base = { original: rawToken, normalized: normalized, ingredientId: null, matchedBy: null, candidateIngredientIds: [], candidateAllergenIds: [] };
  if (!normalized) { base.status = 'unresolved'; base.reason = 'empty'; return base; }

  var ambiguousTerms = (opts && opts.ambiguousTerms) || {};
  if (Object.prototype.hasOwnProperty.call(ambiguousTerms, normalized)) {
    base.status = 'ambiguous';
    base.reason = 'known_ambiguous_term';
    base.candidateAllergenIds = (ambiguousTerms[normalized].candidateIds || []).slice();
    var amb = kb && kb.nameIndex ? kb.nameIndex.get(normalized) : null;
    base.candidateIngredientIds = amb ? amb.ingredientIds.slice() : [];
    return base;
  }

  var entry = kb && kb.nameIndex ? kb.nameIndex.get(normalized) : null;
  if (!entry) { base.status = 'unresolved'; base.reason = 'not_in_knowledge_db'; return base; }
  if (entry.ingredientIds.length > 1) {
    base.status = 'ambiguous';
    base.reason = 'ingredient_index_collision';
    base.candidateIngredientIds = entry.ingredientIds.slice();
    return base;
  }
  base.status = 'resolved';
  base.reason = null;
  base.ingredientId = entry.ingredientIds[0];
  base.matchedBy = entry.matchedBy[base.ingredientId];
  return base;
}

function getRelationsForIngredient(kb, ingredientId) {
  if (!kb || !kb.relationsByIngredient) return [];
  return (kb.relationsByIngredient.get(ingredientId) || []).slice();
}

function informationClassFor(relationCategory, evidenceScope) {
  if (evidenceScope === 'manufacturer_product_specific') return INFORMATION_CLASS.E_PRODUCT_SPECIFIC;
  if (relationCategory === 'ingredient_definition' || relationCategory === 'raw_material' || relationCategory === 'allergen_name') {
    return INFORMATION_CLASS.C_INGREDIENT_DEFINITION;
  }
  if (relationCategory === 'typical_recipe' || relationCategory === 'product_variant') return INFORMATION_CLASS.D_GENERAL_RECIPE;
  return INFORMATION_CLASS.G_UNCONFIRMED;
}

function describeSource(kb, evidenceId) {
  if (!evidenceId || !kb.evidenceById.has(evidenceId)) return null;
  var ev = kb.evidenceById.get(evidenceId);
  return {
    id: ev.id,
    title: typeof ev.title === 'string' ? ev.title : '',
    url: isSafeHttpUrl(ev.url) ? ev.url : null,
    type: ev.type || null,
    reliability: ev.reliability || null,
  };
}

// 음식 1개에 대한 지식 DB 조회 보고서를 만든다. dish 객체는 읽기만 한다.
// opts:
//   kbStatus            FOOD_KB_LOAD_STATUS 값
//   analysisSource      'ai_scan' | 'demo_location'
//   dishKey             여러 음식 결과를 섞지 않기 위한 식별자(렌더 토큰+인덱스 등)
//   isUserAllergicTo    (allergenId) => boolean   — IMP-12 userHasAllergyTo 재사용
//   uncertainAllergenIds Set — 사용자가 확인 안 한 모호 커스텀 알레르기의 후보 id(IMP-12)
//   allergenTermLookup  (text) => {allergenId, source, evidenceId?, evidenceScope?} | null — IMP-12 색인 재사용
//   isActiveAllergen    (allergenId) => boolean
//   ambiguousTerms      IMP-12 KNOWN_AMBIGUOUS_CUSTOM_TERMS
function buildDishKnowledgeReport(kb, dish, opts) {
  opts = opts || {};
  var kbStatus = opts.kbStatus || (kb ? kb.status : FOOD_KB_LOAD_STATUS.LOAD_FAILED);
  var isUserAllergicTo = opts.isUserAllergicTo || function () { return false; };
  var uncertainIds = opts.uncertainAllergenIds || new Set();
  var isActive = opts.isActiveAllergen || function () { return true; };
  var safeDish = dish && typeof dish === 'object' ? dish : {};
  var aiAllergens = Array.isArray(safeDish.allergens) ? safeDish.allergens.slice() : [];
  var aiCross = Array.isArray(safeDish.crossContactAllergens) ? safeDish.crossContactAllergens.slice() : [];

  var report = {
    dishKey: opts.dishKey || null,
    foodId: typeof safeDish.foodId === 'string' ? safeDish.foodId : null,
    lookupStatus: kbStatus,
    dataVersion: kb && kbStatus === FOOD_KB_LOAD_STATUS.READY ? kb.dataVersion : null,
    // 원본 AI 결과의 "복사본" — 참고용. 원본 dish 객체는 건드리지 않는다.
    aiAnalysis: {
      source: opts.analysisSource || 'ai_scan',
      allergens: aiAllergens,
      crossContactAllergens: aiCross,
      allergensUnknownIds: Array.isArray(safeDish.allergensUnknownIds) ? safeDish.allergensUnknownIds.slice() : [],
      crossContactAllergensUnknownIds: Array.isArray(safeDish.crossContactAllergensUnknownIds) ? safeDish.crossContactAllergensUnknownIds.slice() : [],
      ingredientsText: typeof safeDish.ingredients === 'string' ? safeDish.ingredients : '',
    },
    ingredientsAvailable: false,
    ingredientTokens: [],
    knowledgeFindings: [],
    groups: [],
    userAdvisories: [],
    ambiguousIngredients: [],
    unresolvedIngredients: [],
    noRelationIngredients: [],
    candidateAllergenTerms: [],
    mergedDuplicateCount: 0,
  };

  var tokens = splitIngredientList(report.aiAnalysis.ingredientsText);
  report.ingredientsAvailable = tokens.length > 0;
  if (kbStatus !== FOOD_KB_LOAD_STATUS.READY || !kb) {
    // 지식 DB를 못 쓰는 상태 — 토큰 원본만 보존하고 판단은 하지 않는다.
    report.ingredientTokens = tokens.map(function (t) { return { original: t, status: 'not_checked' }; });
    return report;
  }

  var aiAllergenSet = new Set(aiAllergens);
  var aiCrossSet = new Set(aiCross);
  var seenFindingKeys = new Set();

  function profileMatchFor(allergenId) {
    if (isUserAllergicTo(allergenId)) return 'confirmed';
    if (uncertainIds.has(allergenId)) return 'uncertain_custom';
    return null;
  }

  function pushFinding(finding) {
    var dedupeKey = finding.normalizedIngredient + '|' + finding.relationId;
    if (seenFindingKeys.has(dedupeKey)) { report.mergedDuplicateCount += 1; return; }
    seenFindingKeys.add(dedupeKey);
    report.knowledgeFindings.push(finding);
  }

  tokens.forEach(function (token, tokenIndex) {
    var resolution = resolveIngredientTerm(kb, token, { ambiguousTerms: opts.ambiguousTerms });
    var tokenRecord = { original: token, normalized: resolution.normalized, status: resolution.status, ingredientId: resolution.ingredientId, matchedBy: resolution.matchedBy };
    report.ingredientTokens.push(tokenRecord);
    var aiStep = { step: 'ai_ingredient', value: token, source: report.aiAnalysis.source };

    if (resolution.status === 'ambiguous') {
      var candidateAllergenIds = resolution.candidateAllergenIds.filter(isActive);
      report.ambiguousIngredients.push({
        original: token,
        normalized: resolution.normalized,
        reason: resolution.reason,
        candidateAllergenIds: candidateAllergenIds,
        candidateIngredientIds: resolution.candidateIngredientIds,
        matchesUserProfile: candidateAllergenIds.some(function (id) { return profileMatchFor(id) !== null; }),
      });
      return; // 모호어는 자동 확정하지 않는다(식재료 색인/알레르겐 색인 모두 건너뜀)
    }

    var producedSomething = false;

    if (resolution.status === 'resolved') {
      var ingredient = kb.ingredientsById.get(resolution.ingredientId);
      var relations = getRelationsForIngredient(kb, resolution.ingredientId);
      if (relations.length === 0) {
        // DB에 식재료는 있지만 서비스용 관계가 없음 ≠ 알레르겐 없음
        report.noRelationIngredients.push({ original: token, ingredientId: resolution.ingredientId });
      }
      relations.forEach(function (rel) {
        var source = describeSource(kb, rel.evidenceId);
        var match = profileMatchFor(rel.allergenId);
        var path = [
          aiStep,
          { step: 'ingredient_resolution', ingredientId: rel.ingredientId, matchedBy: resolution.matchedBy, matchedKey: resolution.normalized },
          { step: 'relation', relationId: rel.id, relationType: rel.relationType, knowledgeTier: rel.knowledgeTier, reviewStatus: rel.reviewStatus, evidenceScope: rel.evidenceScope, confidence: rel.confidence },
          { step: 'evidence', sourceId: source ? source.id : null, evidenceStatus: rel.evidenceStatus },
          { step: 'profile_match', allergenId: rel.allergenId, matchType: match },
        ];
        pushFinding({
          findingId: (report.dishKey || 'dish') + ':' + tokenIndex + ':' + rel.id,
          allergenId: rel.allergenId,
          ingredientId: rel.ingredientId,
          ingredientNameKo: ingredient ? ingredient.nameKo : '',
          ingredientNameEn: ingredient ? ingredient.nameEn : '',
          originalIngredient: token,
          normalizedIngredient: resolution.normalized,
          relationId: rel.id,
          relationType: rel.relationType,
          relationCategory: rel.relationCategory,
          knowledgeTier: rel.knowledgeTier,
          informationClass: informationClassFor(rel.relationCategory, rel.evidenceScope),
          evidenceScope: rel.evidenceScope,
          reviewStatus: rel.reviewStatus,
          confidence: rel.confidence,
          autoApplyToRiskJudgment: rel.autoApplyToRiskJudgment,
          usedForRiskJudgment: false,
          sourceId: source ? source.id : null,
          source: source,
          evidenceStatus: rel.evidenceStatus,
          evidencePath: path,
          inAiAllergens: aiAllergenSet.has(rel.allergenId),
          inAiCrossContact: aiCrossSet.has(rel.allergenId),
          profileMatch: match,
        });
        producedSomething = true;
      });
    }

    // IMP-12 알레르겐 색인 재사용: 식재료 문자열 자체가 표준 알레르겐 이름/검증
    // 동의어와 정확히 같은 경우(예: AI가 "peanuts"라고 씀).
    var termHit = typeof opts.allergenTermLookup === 'function' ? opts.allergenTermLookup(token) : null;
    if (termHit && termHit.allergenId) {
      if (!isActive(termHit.allergenId)) {
        report.candidateAllergenTerms.push({ original: token, allergenId: termHit.allergenId, note: 'candidate_allergen_not_active' });
      } else {
        var termSource = describeSource(kb, termHit.evidenceId);
        var termMatch = profileMatchFor(termHit.allergenId);
        pushFinding({
          findingId: (report.dishKey || 'dish') + ':' + tokenIndex + ':term:' + termHit.allergenId,
          allergenId: termHit.allergenId,
          ingredientId: null,
          ingredientNameKo: '',
          ingredientNameEn: '',
          originalIngredient: token,
          normalizedIngredient: resolution.normalized,
          relationId: 'term:' + termHit.source + ':' + termHit.allergenId,
          relationType: 'ALLERGEN_NAME_MATCH',
          relationCategory: 'allergen_name',
          knowledgeTier: KNOWLEDGE_TIER.ALLERGEN_TERM,
          informationClass: INFORMATION_CLASS.C_INGREDIENT_DEFINITION,
          evidenceScope: termHit.evidenceScope || null,
          reviewStatus: termHit.source === 'alias_db' ? 'literature_backed_alias' : 'standard_registry',
          confidence: null,
          autoApplyToRiskJudgment: null,
          usedForRiskJudgment: false,
          sourceId: termSource ? termSource.id : null,
          source: termSource,
          evidenceStatus: termSource ? 'linked' : (termHit.evidenceId ? 'evidence_not_found' : 'no_evidence_id'),
          evidencePath: [
            aiStep,
            { step: 'allergen_term_resolution', allergenId: termHit.allergenId, indexSource: termHit.source, matchedKey: resolution.normalized },
            { step: 'evidence', sourceId: termSource ? termSource.id : null, evidenceStatus: termSource ? 'linked' : 'no_evidence_id' },
            { step: 'profile_match', allergenId: termHit.allergenId, matchType: termMatch },
          ],
          inAiAllergens: aiAllergenSet.has(termHit.allergenId),
          inAiCrossContact: aiCrossSet.has(termHit.allergenId),
          profileMatch: termMatch,
        });
        producedSomething = true;
      }
    }

    if (resolution.status === 'unresolved' && !producedSomething) {
      report.unresolvedIngredients.push({ original: token, normalized: resolution.normalized, reason: resolution.reason });
    }
  });

  // 같은 알레르겐 = 화면에서는 한 묶음, 근거 경로는 전부 유지
  var groupsById = new Map();
  report.knowledgeFindings.forEach(function (f) {
    if (!groupsById.has(f.allergenId)) {
      groupsById.set(f.allergenId, {
        allergenId: f.allergenId, findings: [], profileMatch: null,
        inAiAllergens: f.inAiAllergens, inAiCrossContact: f.inAiCrossContact,
      });
    }
    var g = groupsById.get(f.allergenId);
    g.findings.push(f);
    if (f.profileMatch === 'confirmed' || (f.profileMatch && !g.profileMatch)) g.profileMatch = f.profileMatch;
  });
  report.groups = Array.from(groupsById.values()).map(function (g) {
    g.evidencePathCount = g.findings.length;
    return g;
  });
  report.groups.sort(function (a, b) {
    var rank = function (g) { return g.profileMatch === 'confirmed' ? 0 : (g.profileMatch ? 1 : 2); };
    return rank(a) - rank(b);
  });
  // "추가 확인 필요": 사용자 알레르기와 겹치는데 AI의 직접 포함 목록에는 없는 성분.
  // (AI 직접 포함 목록에 이미 있으면 기존 RED 경고가 이미 표시된다.)
  report.userAdvisories = report.groups.filter(function (g) { return g.profileMatch && !g.inAiAllergens; });
  return report;
}

var foodKnowledgeExports = {
  FOOD_KB_SUPPORTED_SCHEMA_VERSION: FOOD_KB_SUPPORTED_SCHEMA_VERSION,
  FOOD_KB_LOAD_STATUS: FOOD_KB_LOAD_STATUS,
  RELATION_CATEGORY_BY_TYPE: RELATION_CATEGORY_BY_TYPE,
  KNOWLEDGE_TIER: KNOWLEDGE_TIER,
  INFORMATION_CLASS: INFORMATION_CLASS,
  EXPECTED_REVIEW_STATUS: EXPECTED_REVIEW_STATUS,
  normalizeKnowledgeText: normalizeKnowledgeText,
  splitIngredientList: splitIngredientList,
  isSafeHttpUrl: isSafeHttpUrl,
  buildFoodKnowledgeBase: buildFoodKnowledgeBase,
  resolveIngredientTerm: resolveIngredientTerm,
  getRelationsForIngredient: getRelationsForIngredient,
  buildDishKnowledgeReport: buildDishKnowledgeReport,
};

// [IMP-11/02와 동일한 UMD 패턴] Node(require)와 브라우저(전역 <script>) 양쪽 지원.
// 브라우저에서는 위 최상위 function/var 선언이 그대로 전역 식별자가 된다
// (shared/dish-schema.js와 같은 방식 — index.html이 bare identifier로 사용).
(function (root) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = foodKnowledgeExports;
  } else if (root) {
    Object.keys(foodKnowledgeExports).forEach(function (key) {
      root[key] = foodKnowledgeExports[key];
    });
  }
})(typeof window !== 'undefined' ? window : this);
