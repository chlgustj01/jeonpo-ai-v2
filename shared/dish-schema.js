// shared/dish-schema.js
//
// [IMP-02] AI 응답(dishes[]) 스키마 검증 및 데이터 정규화 — 서버/프론트 공용 모듈.
//
// 배경: IMP-01은 "spicy" 필드 하나만 결측/비정상 값을 안전하게 처리하도록
// 고쳤다(normalizeSpicy). 그런데 같은 문제가 ingredients/allergens/
// crossContactAllergens/eatingMethod/description/culturalNote 등 나머지
// 필드에도 똑같이 있었다 — index.html의 analyzeMenuPhotoWithAI()가 여전히
// `Array.isArray(d.allergens) ? d.allergens : []`, `d.ingredients || ''`
// 식으로 "결측/비정상 값"을 전부 "빈 배열/빈 문자열"로 조용히 뭉개고
// 있었다(검증 전 실제 코드를 읽어 확인한 내용 — docs/devlog/IMP-02.md §2
// 참고). 이 중 `allergens`가 특히 위험한 이유: 빈 배열은 곧 "체크할 알레르겐이
// 없다 = 이 요리는 안전하다"는 뜻으로 checkDishSafety()에 그대로 쓰이기
// 때문에, "AI가 allergens 필드 자체를 빼먹음(결측)"과 "AI가 이 요리에는
// 알레르겐이 없다고 확인함(진짜 빈 배열)"이 똑같은 값으로 섞여버린다 —
// IMP-11에서 확립한 fail-closed 원칙(판단 불가 ≠ 안전) 위반.
//
// 이 모듈이 하는 일: 서버(api/analyze-menu.js)가 Gemini 원본 응답을 받은
// 직후, 그리고 프론트(index.html)가 서버 응답 "봉투(envelope)"를 받은
// 직후, 양쪽 모두 같은 규칙으로 구조를 확인/정규화할 수 있게 공통 함수를
// 제공한다. 규칙을 두 곳에 따로 베껴 적으면 나중에 한쪽만 고치는 실수가
// 생기므로(이번 조사에서 실제로 shared/allergens.js를 만들게 된 이유와
// 같은 종류의 문제), shared/allergens.js와 똑같은 UMD 패턴을 재사용한다.
//
// 용어 설명(초급 개발자를 위해)은 docs/devlog/IMP-02.md에 코드와 함께
// 정리되어 있다 — 이 파일 안에는 "왜 이렇게 했는지"에 대한 핵심 근거만
// 남긴다.

// ------------------------------------------------------------------
// [IMP-01 재사용] spicy 검증 — IMP-01이 만든 로직을 글자 그대로 가져온다
// (재구현 아님). 기존엔 index.html 안에만 있었는데, 서버도 이제 같은
// 검증을 해야 하므로 공용 모듈로 옮겼다 — index.html은 이 파일을
// shared/allergens.js와 같은 방식(<script> 태그)으로 불러와 그대로 쓴다.
// ------------------------------------------------------------------
var SPICY_VALIDATION_STATUS = {
  VALID: 'valid',
  MISSING: 'missing',
  INVALID_TYPE: 'invalid_type',
  NON_INTEGER: 'non_integer',
  OUT_OF_RANGE: 'out_of_range',
};

function normalizeSpicy(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return { value: null, status: SPICY_VALIDATION_STATUS.MISSING, raw: rawValue };
  }
  if (typeof rawValue !== 'number') {
    return { value: null, status: SPICY_VALIDATION_STATUS.INVALID_TYPE, raw: rawValue };
  }
  if (!Number.isInteger(rawValue)) {
    return { value: null, status: SPICY_VALIDATION_STATUS.NON_INTEGER, raw: rawValue };
  }
  if (rawValue < 0 || rawValue > 3) {
    return { value: null, status: SPICY_VALIDATION_STATUS.OUT_OF_RANGE, raw: rawValue };
  }
  return { value: rawValue, status: SPICY_VALIDATION_STATUS.VALID, raw: rawValue };
}

// ------------------------------------------------------------------
// [IMP-02] 나머지 필드용 공통 검증 상태 — normalizeSpicy와 같은 철학을
// 문자열/배열 필드로 확장한 것. VALID/MISSING/INVALID_TYPE은 spicy와
// 의미가 같다. 추가로 둔 세 가지:
//   - EMPTY: 타입은 맞고 존재하지만 내용이 비어있음(빈 문자열/빈 배열).
//     "AI가 확인했는데 해당 사항 없음"이라는 뜻이라 MISSING과는 다르다
//     (예: culturalNote: "" 는 "특별한 문화적 설명 없음"이라는 유효한
//     응답이지, "필드를 빼먹음"이 아니다).
//   - TRUNCATED: 값은 유효하지만 허용 길이/개수를 넘어서 잘라냄.
//   - PARTIAL: 배열 원소 중 일부만 유효(예: 알레르겐 id 몇 개는 등록된
//     표준 id가 아니거나, 문자열이 아닌 원소가 섞여 있음).
// ------------------------------------------------------------------
var FIELD_STATUS = {
  VALID: 'valid',
  MISSING: 'missing',
  INVALID_TYPE: 'invalid_type',
  EMPTY: 'empty',
  TRUNCATED: 'truncated',
  PARTIAL: 'partial',
};

// [IMP-02] 길이/개수 상한값. "검열"이 아니라 "AI가 계약을 벗어나 과도하게
// 긴 응답을 줬을 때 UI가 깨지거나 메모리를 과도하게 쓰지 않도록" 하는
// 방어적 상한이다 — 넘긴다고 요리 전체를 버리지 않고, 잘라내고 TRUNCATED로
// 표시한다(부분 응답 생존 원칙, 아래 validateAndNormalizeDish 참고).
var LIMITS = {
  MAX_NAME_LENGTH: 200,
  MAX_INGREDIENTS_LENGTH: 500,
  MAX_DESCRIPTION_LENGTH: 500,
  MAX_CULTURAL_NOTE_LENGTH: 300,
  MAX_EATING_METHOD_ITEMS: 6,
  MAX_EATING_METHOD_ITEM_LENGTH: 200,
  MAX_ALLERGEN_ITEMS: 12, // 등록된 표준 알레르겐은 21종뿐이라 12개면 넉넉함
  MAX_DISHES: 10, // 프롬프트 규칙("1~10개 반환")과 동일한 상한
};

// [PRICE] 1.1.0 = 1.0.0 + optional per-dish `price`. Purely additive, so
// clients accept both (an older cached/stored 1.0.0 response has no price
// and must keep working — it is shown as "price unknown", never as 0).
var SCHEMA_VERSION = '1.1.0';
var COMPATIBLE_SCHEMA_VERSIONS = ['1.0.0', '1.1.0'];

// [PRICE] Menu price as printed next to a dish. Only what the photo shows:
//   exact      — one amount (amount)
//   range      — e.g. "9,000~11,000" or several sizes (min, max)
//   ambiguous  — a price-like text that cannot be read as a number or
//                cannot be tied to this dish with confidence ("시가", blurred)
//   not_shown  — no price printed for this dish (e.g. a plain dish photo)
//   unknown    — the model did not report a price at all (older prompt)
// The amount is never estimated; anything that fails validation degrades
// to `ambiguous` (if printed text exists) or `not_shown`, never to 0.
var PRICE_CURRENCIES = ['KRW', 'USD', 'JPY', 'CNY', 'EUR'];
var MAX_PRICE_AMOUNT = 10000000;
var MAX_PRICE_TEXT_LENGTH = 40;

function isValidPriceAmount(v) {
  return typeof v === 'number' && isFinite(v) && v > 0 && v <= MAX_PRICE_AMOUNT;
}

function emptyPrice(status) {
  return { status: status, amount: null, min: null, max: null, currency: null, text: '', source: null };
}

function normalizeMenuPrice(raw) {
  if (raw === undefined) return emptyPrice('unknown');
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return emptyPrice('not_shown');
  var text = typeof raw.text === 'string' ? raw.text.trim().slice(0, MAX_PRICE_TEXT_LENGTH) : '';
  var currency = typeof raw.currency === 'string' ? raw.currency.trim().toUpperCase() : '';
  if (PRICE_CURRENCIES.indexOf(currency) === -1) currency = '';
  var status = typeof raw.status === 'string' ? raw.status : '';
  var asAmbiguous = function () {
    if (!text) return emptyPrice('not_shown');
    var p = emptyPrice('ambiguous');
    p.text = text;
    p.currency = currency || null;
    p.source = 'menu_text';
    return p;
  };

  if (status === 'exact') {
    if (!isValidPriceAmount(raw.amount) || !currency) return asAmbiguous();
    return { status: 'exact', amount: Math.round(raw.amount * 100) / 100, min: null, max: null, currency: currency, text: text, source: 'menu_text' };
  }
  if (status === 'range') {
    if (!isValidPriceAmount(raw.min) || !isValidPriceAmount(raw.max) || !(raw.min < raw.max) || !currency) return asAmbiguous();
    return { status: 'range', amount: null, min: raw.min, max: raw.max, currency: currency, text: text, source: 'menu_text' };
  }
  if (status === 'ambiguous') return asAmbiguous();
  return emptyPrice('not_shown');
}

function normalizeStringField(rawValue, opts) {
  var maxLength = opts && opts.maxLength;
  if (rawValue === null || rawValue === undefined) {
    return { value: '', status: FIELD_STATUS.MISSING, raw: rawValue };
  }
  if (typeof rawValue !== 'string') {
    return { value: '', status: FIELD_STATUS.INVALID_TYPE, raw: rawValue };
  }
  if (rawValue.length === 0) {
    return { value: '', status: FIELD_STATUS.EMPTY, raw: rawValue };
  }
  if (maxLength && rawValue.length > maxLength) {
    return { value: rawValue.slice(0, maxLength), status: FIELD_STATUS.TRUNCATED, raw: rawValue };
  }
  return { value: rawValue, status: FIELD_STATUS.VALID, raw: rawValue };
}

function normalizeStringArrayField(rawValue, opts) {
  var maxItems = (opts && opts.maxItems) || Infinity;
  var maxItemLength = opts && opts.maxItemLength;
  if (rawValue === null || rawValue === undefined) {
    return { value: [], status: FIELD_STATUS.MISSING, raw: rawValue, droppedNonStringCount: 0 };
  }
  if (!Array.isArray(rawValue)) {
    return { value: [], status: FIELD_STATUS.INVALID_TYPE, raw: rawValue, droppedNonStringCount: 0 };
  }
  if (rawValue.length === 0) {
    return { value: [], status: FIELD_STATUS.EMPTY, raw: rawValue, droppedNonStringCount: 0 };
  }

  var droppedNonStringCount = 0;
  var truncatedItemCount = 0;
  var stringItems = [];
  rawValue.forEach(function (item) {
    if (typeof item !== 'string') {
      droppedNonStringCount += 1;
      return;
    }
    if (maxItemLength && item.length > maxItemLength) {
      truncatedItemCount += 1;
      stringItems.push(item.slice(0, maxItemLength));
    } else {
      stringItems.push(item);
    }
  });

  var arrayWasTruncated = stringItems.length > maxItems;
  var value = stringItems.slice(0, maxItems);

  var status;
  if (droppedNonStringCount > 0) {
    status = FIELD_STATUS.PARTIAL;
  } else if (arrayWasTruncated || truncatedItemCount > 0) {
    status = FIELD_STATUS.TRUNCATED;
  } else {
    status = FIELD_STATUS.VALID;
  }

  return { value: value, status: status, raw: rawValue, droppedNonStringCount: droppedNonStringCount };
}

// [IMP-02] 알레르겐 id 배열 전용 검증. "완전 일치만 인정"(IMP-12의
// no-fuzzy-matching 원칙)을 그대로 따르되, 대소문자 차이만은 예외로 둔다 —
// 이유: IMP-12가 금지한 "유사 매칭"은 peanut과 pinenut처럼 "철자가 비슷한
// 서로 다른 개념"을 같다고 추측하는 것이고, 대소문자 차이("Egg"/"egg")는
// 서로 다른 개념이 아니라 "완전히 같은 토큰의 표기 차이"이기 때문이다.
// 등록되지 않은 id는 버리지 않고 unknownIds에 그대로 보존한다(IMP-11의
// unknownAllergenIds 패턴과 동일 — checkDishSafety가 이미 이 값을 콘솔에
// 남기는 방식과 호환).
function normalizeAllergenIdArray(rawValue, allowedIdSet, opts) {
  var maxItems = (opts && opts.maxItems) || Infinity;
  if (rawValue === null || rawValue === undefined) {
    return { value: [], status: FIELD_STATUS.MISSING, raw: rawValue, unknownIds: [], duplicateIds: [], droppedNonStringCount: 0 };
  }
  if (!Array.isArray(rawValue)) {
    return { value: [], status: FIELD_STATUS.INVALID_TYPE, raw: rawValue, unknownIds: [], duplicateIds: [], droppedNonStringCount: 0 };
  }
  if (rawValue.length === 0) {
    return { value: [], status: FIELD_STATUS.EMPTY, raw: rawValue, unknownIds: [], duplicateIds: [], droppedNonStringCount: 0 };
  }

  var value = [];
  var unknownIds = [];
  var duplicateIds = [];
  var droppedNonStringCount = 0;
  var seenCanonical = new Set();

  rawValue.forEach(function (item) {
    if (typeof item !== 'string') {
      droppedNonStringCount += 1;
      return;
    }
    var normalized = item.trim().toLowerCase();
    if (!allowedIdSet.has(normalized)) {
      unknownIds.push(item);
      return;
    }
    if (seenCanonical.has(normalized)) {
      duplicateIds.push(item);
      return;
    }
    seenCanonical.add(normalized);
    value.push(normalized);
  });

  var arrayWasTruncated = value.length > maxItems;
  value = value.slice(0, maxItems);

  var status;
  if (droppedNonStringCount > 0 || unknownIds.length > 0) {
    status = FIELD_STATUS.PARTIAL;
  } else if (duplicateIds.length > 0 || arrayWasTruncated) {
    status = FIELD_STATUS.TRUNCATED;
  } else {
    status = FIELD_STATUS.VALID;
  }

  return { value: value, status: status, raw: rawValue, unknownIds: unknownIds, duplicateIds: duplicateIds, droppedNonStringCount: droppedNonStringCount };
}

// [IMP-02] "이 dish 항목을 화면에 보여줄 이름이 하나라도 있는가?"만 먼저
// 판단한다 — 이름이 셋 다 없으면 foodId/표시 이름 자체를 만들 수 없어
// "Unknown dish"만 N개 늘어놓는 의미 없는 카드가 되므로, 이 경우만 해당
// dish 전체를 버린다(§3 "부분 응답 생존 정책" — 버리는 기준은 최소화).
function resolveDishName(rawDish, maxLength) {
  var nameKoRaw = typeof rawDish.name_ko === 'string' ? rawDish.name_ko.trim() : '';
  var nameEnRaw = typeof rawDish.name_en === 'string' ? rawDish.name_en.trim() : '';
  var translatedRaw = typeof rawDish.translated_name === 'string' ? rawDish.translated_name.trim() : '';
  var hasUsableName = Boolean(nameKoRaw || nameEnRaw || translatedRaw);
  return {
    nameKo: nameKoRaw.slice(0, maxLength),
    nameEn: nameEnRaw.slice(0, maxLength),
    translatedName: translatedRaw.slice(0, maxLength),
    hasUsableName: hasUsableName,
  };
}

function slugifyFoodNameForSchema(name) {
  return (name || 'dish')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40) || 'dish';
}

// 한 dish 원소 하나를 검증+정규화한다.
// 반환값은 { rejected: true, reason, raw } (완전히 버려진 경우) 또는
// { rejected: false, dish, fieldStatus, dishValidationStatus } 둘 중 하나.
function validateAndNormalizeDish(rawDish, allowedIdSet) {
  if (rawDish === null || rawDish === undefined) {
    return { rejected: true, reason: 'null_entry', raw: rawDish };
  }
  if (typeof rawDish !== 'object' || Array.isArray(rawDish)) {
    return { rejected: true, reason: 'non_object_entry', raw: rawDish };
  }

  var nameInfo = resolveDishName(rawDish, LIMITS.MAX_NAME_LENGTH);
  if (!nameInfo.hasUsableName) {
    return { rejected: true, reason: 'no_usable_name', raw: rawDish };
  }

  var nameKo = nameInfo.nameKo || nameInfo.nameEn || 'Unknown dish';
  var displayName = nameInfo.nameKo && (nameInfo.translatedName || nameInfo.nameEn)
    ? (nameInfo.translatedName || nameInfo.nameEn) + ' (' + nameInfo.nameKo + ')'
    : (nameInfo.translatedName || nameInfo.nameEn || nameInfo.nameKo || 'Unknown dish');

  var ingredientsResult = normalizeStringField(rawDish.ingredients, { maxLength: LIMITS.MAX_INGREDIENTS_LENGTH });
  var allergensResult = normalizeAllergenIdArray(rawDish.allergens, allowedIdSet, { maxItems: LIMITS.MAX_ALLERGEN_ITEMS });
  var crossContactResult = normalizeAllergenIdArray(rawDish.crossContactAllergens, allowedIdSet, { maxItems: LIMITS.MAX_ALLERGEN_ITEMS });
  var spicyResult = normalizeSpicy(rawDish.spicy);
  var eatingMethodResult = normalizeStringArrayField(rawDish.eatingMethod, {
    maxItems: LIMITS.MAX_EATING_METHOD_ITEMS,
    maxItemLength: LIMITS.MAX_EATING_METHOD_ITEM_LENGTH,
  });
  var descriptionResult = normalizeStringField(rawDish.description, { maxLength: LIMITS.MAX_DESCRIPTION_LENGTH });
  var culturalNoteResult = normalizeStringField(rawDish.culturalNote, { maxLength: LIMITS.MAX_CULTURAL_NOTE_LENGTH });

  var fieldStatus = {
    ingredients: ingredientsResult.status,
    allergens: allergensResult.status,
    crossContactAllergens: crossContactResult.status,
    spicy: spicyResult.status,
    eatingMethod: eatingMethodResult.status,
    description: descriptionResult.status,
    culturalNote: culturalNoteResult.status,
  };

  // [IMP-02] "degraded"(뭔가 계약을 벗어남) 판정 기준: 타입이 아예 틀렸거나,
  // 배열 원소 일부가 무효하거나, 길이를 넘겨 잘렸거나, 모르는 알레르겐
  // id가 섞였거나, spicy가 (결측이 아니라) 적극적으로 잘못된 값인 경우.
  // MISSING/EMPTY는 "AI가 선택적으로 비워둔 정상 상태"로 보고 degraded에
  // 포함하지 않는다 — culturalNote: "" 가 흔한 정상 응답이기 때문이다.
  var problematicFieldStatuses = [FIELD_STATUS.INVALID_TYPE, FIELD_STATUS.PARTIAL, FIELD_STATUS.TRUNCATED];
  var hasProblematicField = Object.keys(fieldStatus).some(function (key) {
    if (key === 'spicy') return false; // spicy는 아래에서 별도 판정
    return problematicFieldStatuses.indexOf(fieldStatus[key]) !== -1;
  });
  var spicyIsActivelyInvalid = (
    spicyResult.status === SPICY_VALIDATION_STATUS.INVALID_TYPE ||
    spicyResult.status === SPICY_VALIDATION_STATUS.NON_INTEGER ||
    spicyResult.status === SPICY_VALIDATION_STATUS.OUT_OF_RANGE
  );
  var dishValidationStatus = (hasProblematicField || spicyIsActivelyInvalid) ? 'degraded' : 'valid';

  var dish = {
    foodId: slugifyFoodNameForSchema(nameInfo.nameEn || nameInfo.nameKo),
    name: displayName,
    nameKo: nameKo,
    // [IMP-04] 순수 영어 이름 — `name`은 괄호 안에 한글까지 섞인 "화면 표시용"
    // 문자열(예: "Bibimbap (비빔밥)")이라 번역 요청에 그대로 보내면 어색한
    // 결과가 나온다. 번역기에 보낼 땐 이 필드를 쓴다(index.html 참고).
    nameEn: nameInfo.nameEn || '',
    ingredients: ingredientsResult.value,
    allergens: allergensResult.value,
    allergensUnknownIds: allergensResult.unknownIds,
    allergensDuplicateIds: allergensResult.duplicateIds,
    crossContactAllergens: crossContactResult.value,
    crossContactAllergensUnknownIds: crossContactResult.unknownIds,
    crossContactAllergensDuplicateIds: crossContactResult.duplicateIds,
    spicy: spicyResult.value,
    spicyStatus: spicyResult.status,
    eatingMethod: eatingMethodResult.value,
    description: descriptionResult.value,
    culturalNote: culturalNoteResult.value,
    fieldStatus: fieldStatus,
    dishValidationStatus: dishValidationStatus,
    // [PRICE] Not part of the safety judgment; never changes dishValidationStatus.
    price: normalizeMenuPrice(rawDish.price),
  };

  return { rejected: false, dish: dish };
}

// 응답 전체(봉투 이전의 원시 Gemini JSON, 또는 서버가 이미 만든 봉투 둘 다
// 입력으로 받을 수 있음 — 이미 정규화된 dish를 다시 넣어도 각 필드가 이미
// 유효한 타입/값이라 그대로 'valid'로 재확인되므로 안전하다)을 검증해
// 최종 봉투를 만든다.
function validateAndNormalizeDishesResponse(rawData, allowedAllergenIds) {
  var allowedIdSet = new Set((allowedAllergenIds || []).map(function (id) { return String(id).toLowerCase(); }));
  var validationIssues = [];
  var rejectedDishCount = 0;

  if (!rawData || typeof rawData !== 'object') {
    return {
      schemaVersion: SCHEMA_VERSION,
      dishes: [],
      validationStatus: 'invalid',
      validationIssues: [{ dishIndex: null, field: 'root', issue: 'response_not_object', raw: rawData }],
      rejectedDishCount: 0,
    };
  }

  if (!Array.isArray(rawData.dishes)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      dishes: [],
      validationStatus: 'invalid',
      validationIssues: [{ dishIndex: null, field: 'dishes', issue: 'missing_or_not_array', raw: rawData.dishes }],
      rejectedDishCount: 0,
    };
  }

  if (rawData.dishes.length === 0) {
    return {
      schemaVersion: SCHEMA_VERSION,
      dishes: [],
      validationStatus: 'empty',
      validationIssues: [],
      rejectedDishCount: 0,
    };
  }

  var normalizedDishes = [];
  rawData.dishes.forEach(function (rawDish, index) {
    var result = validateAndNormalizeDish(rawDish, allowedIdSet);
    if (result.rejected) {
      rejectedDishCount += 1;
      validationIssues.push({ dishIndex: index, field: 'dish', issue: result.reason, raw: result.raw });
      return;
    }
    if (result.dish.dishValidationStatus === 'degraded') {
      validationIssues.push({ dishIndex: index, field: 'fields', issue: 'degraded_fields', raw: result.dish.fieldStatus });
    }
    normalizedDishes.push(result.dish);
  });

  var validationStatus;
  if (normalizedDishes.length === 0) {
    validationStatus = 'invalid';
  } else if (rejectedDishCount > 0 || normalizedDishes.some(function (d) { return d.dishValidationStatus === 'degraded'; })) {
    validationStatus = 'partial';
  } else {
    validationStatus = 'valid';
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    dishes: normalizedDishes,
    validationStatus: validationStatus,
    validationIssues: validationIssues,
    rejectedDishCount: rejectedDishCount,
  };
}

// [IMP-02 §10, Defense in Depth] 프론트엔드가 서버 "봉투"를 받았을 때,
// 그 봉투 자체의 최소 구조만 가볍게 재확인하는 함수. 위
// validateAndNormalizeDishesResponse()를 또 통째로 돌리지 않는 이유:
// 그 함수는 "원시 Gemini 응답"을 가정하고 처음부터 재정규화하므로, 이미
// 정규화된 봉투를 다시 넣으면 예를 들어 spicyStatus가 'missing'으로
// 재계산되어(두 번째 통과 시엔 raw가 이미 null이라) 서버가 기록해둔
// 원래 사유(예: 'out_of_range')가 덮어써지는 문제가 있다. 그래서 프론트는
// "서버가 이미 정규화했다고 주장하는 구조 자체가 말이 되는가"만 얕게
// 확인한다 — 네트워크 중간 손상, 구버전 dev-server.js, 캐시된 오래된
// 응답 등으로부터 보호하기 위한 것이지 서버의 정규화 로직을 다시 수행하는
// 것이 아니다.
function isValidDishResponseEnvelope(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (COMPATIBLE_SCHEMA_VERSIONS.indexOf(obj.schemaVersion) === -1) return false;
  if (!Array.isArray(obj.dishes)) return false;
  var knownStatuses = ['valid', 'partial', 'invalid', 'empty'];
  if (knownStatuses.indexOf(obj.validationStatus) === -1) return false;
  return obj.dishes.every(function (d) {
    if (!d || typeof d !== 'object') return false;
    if (typeof d.foodId !== 'string' || typeof d.name !== 'string') return false;
    if (!Array.isArray(d.allergens) || !Array.isArray(d.crossContactAllergens)) return false;
    if (!Array.isArray(d.eatingMethod)) return false;
    if (typeof d.ingredients !== 'string' || typeof d.description !== 'string' || typeof d.culturalNote !== 'string') return false;
    if (d.spicy !== null && typeof d.spicy !== 'number') return false;
    if (d.price !== undefined && (d.price === null || typeof d.price !== 'object')) return false;
    return true;
  });
}

// ------------------------------------------------------------------
// [IMP-04] 번역 응답 검증/정규화. api/analyze-menu.js가 이제 언어와
// 무관한 영어 "정준(canonical)" 필드만 반환하고, api/translate-dish.js가
// 그 필드들을 화면 언어로 번역한 결과만 돌려준다 — 이 둘은 완전히 분리된
// 응답 모양이라 dishes[] 전체를 다시 정규화하는 validateAndNormalizeDish를
// 그대로 쓸 수 없다. 대신 같은 1차 검증 도구(normalizeStringField 등)를
// 재사용해 중복 규칙을 만들지 않는다.
// ------------------------------------------------------------------
var TRANSLATION_SCHEMA_VERSION = '1.0.0';

function validateAndNormalizeTranslationResponse(rawData, expectedFoodIds) {
  var validationIssues = [];
  var translationsByFoodId = {};
  var expectedSet = new Set(expectedFoodIds || []);

  if (!rawData || typeof rawData !== 'object' || !Array.isArray(rawData.translations)) {
    return {
      translationSchemaVersion: TRANSLATION_SCHEMA_VERSION,
      translationsByFoodId: translationsByFoodId,
      validationIssues: [{ field: 'translations', issue: 'missing_or_not_array', raw: rawData && rawData.translations }],
    };
  }

  rawData.translations.forEach(function (entry, index) {
    if (!entry || typeof entry !== 'object' || typeof entry.foodId !== 'string') {
      validationIssues.push({ field: 'translations[' + index + ']', issue: 'invalid_entry', raw: entry });
      return;
    }
    if (!expectedSet.has(entry.foodId)) {
      validationIssues.push({ field: 'translations[' + index + ']', issue: 'unknown_food_id', raw: entry.foodId });
      return;
    }
    if (translationsByFoodId[entry.foodId]) {
      validationIssues.push({ field: 'translations[' + index + ']', issue: 'duplicate_food_id', raw: entry.foodId });
      return;
    }

    var nameResult = normalizeStringField(entry.translatedName, { maxLength: LIMITS.MAX_NAME_LENGTH });
    var ingredientsResult = normalizeStringField(entry.ingredients, { maxLength: LIMITS.MAX_INGREDIENTS_LENGTH });
    var eatingMethodResult = normalizeStringArrayField(entry.eatingMethod, {
      maxItems: LIMITS.MAX_EATING_METHOD_ITEMS,
      maxItemLength: LIMITS.MAX_EATING_METHOD_ITEM_LENGTH,
    });
    var descriptionResult = normalizeStringField(entry.description, { maxLength: LIMITS.MAX_DESCRIPTION_LENGTH });
    var culturalNoteResult = normalizeStringField(entry.culturalNote, { maxLength: LIMITS.MAX_CULTURAL_NOTE_LENGTH });

    translationsByFoodId[entry.foodId] = {
      translatedName: nameResult.value,
      ingredients: ingredientsResult.value,
      eatingMethod: eatingMethodResult.value,
      description: descriptionResult.value,
      culturalNote: culturalNoteResult.value,
      fieldStatus: {
        translatedName: nameResult.status,
        ingredients: ingredientsResult.status,
        eatingMethod: eatingMethodResult.status,
        description: descriptionResult.status,
        culturalNote: culturalNoteResult.status,
      },
    };
  });

  expectedSet.forEach(function (foodId) {
    if (!translationsByFoodId[foodId]) {
      validationIssues.push({ field: 'translations', issue: 'missing_translation_for_food_id', raw: foodId });
    }
  });

  return {
    translationSchemaVersion: TRANSLATION_SCHEMA_VERSION,
    translationsByFoodId: translationsByFoodId,
    validationIssues: validationIssues,
  };
}

var exportsObject = {
  SCHEMA_VERSION: SCHEMA_VERSION,
  COMPATIBLE_SCHEMA_VERSIONS: COMPATIBLE_SCHEMA_VERSIONS,
  PRICE_CURRENCIES: PRICE_CURRENCIES,
  normalizeMenuPrice: normalizeMenuPrice,
  TRANSLATION_SCHEMA_VERSION: TRANSLATION_SCHEMA_VERSION,
  FIELD_STATUS: FIELD_STATUS,
  SPICY_VALIDATION_STATUS: SPICY_VALIDATION_STATUS,
  LIMITS: LIMITS,
  normalizeSpicy: normalizeSpicy,
  normalizeStringField: normalizeStringField,
  normalizeStringArrayField: normalizeStringArrayField,
  normalizeAllergenIdArray: normalizeAllergenIdArray,
  validateAndNormalizeDish: validateAndNormalizeDish,
  validateAndNormalizeDishesResponse: validateAndNormalizeDishesResponse,
  isValidDishResponseEnvelope: isValidDishResponseEnvelope,
  validateAndNormalizeTranslationResponse: validateAndNormalizeTranslationResponse,
};

// [IMP-11과 동일한 UMD 패턴] Node(require)와 브라우저(전역 <script>) 양쪽 지원.
(function (root) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObject;
  } else if (root) {
    Object.keys(exportsObject).forEach(function (key) {
      root[key] = exportsObject[key];
    });
  }
})(typeof window !== 'undefined' ? window : this);
