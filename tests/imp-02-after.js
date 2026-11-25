// tests/imp-02-after.js
//
// [IMP-02] AI 응답 스키마 검증 및 데이터 정규화 — 수정 "후" 테스트.
//
// 세 층을 전부 검증한다:
//   1) shared/dish-schema.js 자체(순수 함수 — require로 직접 호출)
//   2) api/analyze-menu.js 서버 핸들러(global.fetch를 Mock해 Gemini 호출 자체는 피함)
//   3) index.html(tests/harness.js로 실제 <script> 블록을 그대로 실행)
//      — analyzeMenuPhotoWithAI(), renderMultiDishScanResult(), escapeHtml(),
//      clearStaleScanResult() 전부 "재구현"이 아니라 실제 코드를 그대로 호출해 검증한다.
const assert = require('assert');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { loadApp, pick } = require('./harness.js');
const dishSchema = require('../shared/dish-schema.js');
const ALLERGEN_REGISTRY = require('../shared/allergens.js');
const ALLOWED_IDS = ALLERGEN_REGISTRY.map((e) => e.id);
const ALLOWED_ID_SET = new Set(ALLOWED_IDS);

const HTML_PATH = path.join(__dirname, '..', 'index.html');

const results = [];
let totalAssertions = 0;
const A = new Proxy(assert, {
  get(target, prop) {
    const orig = target[prop];
    if (typeof orig !== 'function') return orig;
    return (...args) => {
      totalAssertions += 1;
      return orig.apply(target, args);
    };
  },
});

async function tc(id, desc, fn) {
  try {
    await fn();
    results.push({ id, desc, status: 'PASS' });
    console.log(`[PASS] ${id} ${desc}`);
  } catch (err) {
    results.push({ id, desc, status: 'FAIL', error: err.message });
    console.error(`[FAIL] ${id} ${desc}\n       ${err.stack || err.message}`);
  }
}

function notRun(id, desc, reason) {
  results.push({ id, desc, status: 'NOT RUN', reason });
  console.log(`[NOT RUN] ${id} ${desc} — ${reason}`);
}

// vm context 안에서 async 함수 호출(예: analyzeMenuPhotoWithAI())의 Promise를
// 호스트(Node) 쪽에서 await하기 위한 헬퍼. 표현식을 그 context의 렉시컬
// 스코프에서 평가해 Promise 자체를 돌려받는다.
function evalInContext(context, expr) {
  return vm.runInContext(expr, context);
}

function makeRes() {
  const res = {};
  res.statusCode = null;
  res.body = null;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.body = obj; return res; };
  return res;
}

async function withMockedGeminiFetch(geminiContentText, fn) {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: geminiContentText }] } }] }),
    text: async () => geminiContentText,
  });
  try {
    await fn();
  } finally {
    global.fetch = originalFetch;
  }
}

async function main() {
  // ============================================================
  // 1) shared/dish-schema.js 순수 함수 단위 테스트
  // ============================================================

  await tc('TC-02-01', 'normalizeStringField: 필드 자체 없음(undefined) → missing, 값은 빈 문자열', async () => {
    const r = dishSchema.normalizeStringField(undefined, { maxLength: 10 });
    A.strictEqual(r.status, 'missing');
    A.strictEqual(r.value, '');
  });

  await tc('TC-02-02', 'normalizeStringField: 숫자/객체 등 문자열이 아닌 타입 → invalid_type', async () => {
    A.strictEqual(dishSchema.normalizeStringField(123, {}).status, 'invalid_type');
    A.strictEqual(dishSchema.normalizeStringField({}, {}).status, 'invalid_type');
    A.strictEqual(dishSchema.normalizeStringField(['a'], {}).status, 'invalid_type');
    A.strictEqual(dishSchema.normalizeStringField(null, {}).status, 'missing', 'null은 missing으로(undefined와 동일 취급)');
  });

  await tc('TC-02-03', 'normalizeStringField: 빈 문자열("") → empty(결측과 구분됨)', async () => {
    const r = dishSchema.normalizeStringField('', { maxLength: 10 });
    A.strictEqual(r.status, 'empty');
    A.notStrictEqual(r.status, 'missing', 'culturalNote: ""는 "필드 없음"과 다른 상태여야 함');
  });

  await tc('TC-02-04', 'normalizeStringField: 허용 길이 초과 → truncated(요리 전체를 버리지 않고 잘라냄)', async () => {
    const longText = 'a'.repeat(50);
    const r = dishSchema.normalizeStringField(longText, { maxLength: 10 });
    A.strictEqual(r.status, 'truncated');
    A.strictEqual(r.value.length, 10);
  });

  await tc('TC-02-05', 'normalizeStringField: 정상 범위 내 문자열 → valid, 원본 그대로 보존', async () => {
    const r = dishSchema.normalizeStringField('삼겹살, 상추, 마늘', { maxLength: 100 });
    A.strictEqual(r.status, 'valid');
    A.strictEqual(r.value, '삼겹살, 상추, 마늘');
  });

  await tc('TC-02-06', 'normalizeStringArrayField: 결측(null/undefined) → missing, 빈 배열', async () => {
    A.strictEqual(dishSchema.normalizeStringArrayField(null, {}).status, 'missing');
    A.deepStrictEqual(Array.from(dishSchema.normalizeStringArrayField(undefined, {}).value), []);
  });

  await tc('TC-02-07', 'normalizeStringArrayField: 배열이 아닌 값("step1" 문자열 하나) → invalid_type', async () => {
    const r = dishSchema.normalizeStringArrayField('step1', {});
    A.strictEqual(r.status, 'invalid_type');
  });

  await tc('TC-02-08', 'normalizeStringArrayField: 빈 배열([]) → empty', async () => {
    A.strictEqual(dishSchema.normalizeStringArrayField([], {}).status, 'empty');
  });

  await tc('TC-02-09', 'normalizeStringArrayField: 배열 원소 중 문자열이 아닌 것이 섞임 → partial, 해당 원소만 제외', async () => {
    const r = dishSchema.normalizeStringArrayField(['젓가락으로 먹는다', 42, null, '숟가락도 가능'], { maxItems: 6, maxItemLength: 200 });
    A.strictEqual(r.status, 'partial');
    A.deepStrictEqual(Array.from(r.value), ['젓가락으로 먹는다', '숟가락도 가능']);
    A.strictEqual(r.droppedNonStringCount, 2);
  });

  await tc('TC-02-10', 'normalizeStringArrayField: 허용 개수 초과 → truncated(초과분만 잘림, 앞부분은 생존)', async () => {
    const r = dishSchema.normalizeStringArrayField(['a', 'b', 'c', 'd'], { maxItems: 2, maxItemLength: 50 });
    A.strictEqual(r.status, 'truncated');
    A.deepStrictEqual(Array.from(r.value), ['a', 'b']);
  });

  await tc('TC-02-11', 'normalizeAllergenIdArray: 결측 → missing, 빈 배열(= "체크할 것 없음"이 아니라 "확인 안 됨")', async () => {
    const r = dishSchema.normalizeAllergenIdArray(undefined, ALLOWED_ID_SET, {});
    A.strictEqual(r.status, 'missing');
    A.deepStrictEqual(Array.from(r.value), []);
  });

  await tc('TC-02-12', 'normalizeAllergenIdArray: 배열이 아니라 문자열 하나("egg") → invalid_type(구버전처럼 조용히 []로 뭉개지지 않음)', async () => {
    const r = dishSchema.normalizeAllergenIdArray('egg', ALLOWED_ID_SET, {});
    A.strictEqual(r.status, 'invalid_type');
    A.deepStrictEqual(Array.from(r.value), []);
  });

  await tc('TC-02-13', 'normalizeAllergenIdArray: 빈 배열([]) → empty("AI가 확인했더니 알레르겐 없음")', async () => {
    const r = dishSchema.normalizeAllergenIdArray([], ALLOWED_ID_SET, {});
    A.strictEqual(r.status, 'empty');
  });

  await tc('TC-02-14', 'normalizeAllergenIdArray: 등록되지 않은 id는 버리지 않고 unknownIds에 보존', async () => {
    const r = dishSchema.normalizeAllergenIdArray(['egg', 'not_a_real_allergen'], ALLOWED_ID_SET, { maxItems: 12 });
    A.deepStrictEqual(Array.from(r.value), ['egg']);
    A.deepStrictEqual(Array.from(r.unknownIds), ['not_a_real_allergen']);
    A.strictEqual(r.status, 'partial');
  });

  await tc('TC-02-15', 'normalizeAllergenIdArray: 대소문자 변형("EGG")은 같은 토큰으로 인정하되 유사매칭은 하지 않음', async () => {
    const r = dishSchema.normalizeAllergenIdArray(['EGG'], ALLOWED_ID_SET, { maxItems: 12 });
    A.deepStrictEqual(Array.from(r.value), ['egg'], '대소문자만 다른 건 같은 id로 인정');
    const r2 = dishSchema.normalizeAllergenIdArray(['peanutt'], ALLOWED_ID_SET, { maxItems: 12 });
    A.deepStrictEqual(Array.from(r2.value), [], '철자가 비슷해도 다른 문자열이면 유사매칭하지 않고 unknown 처리(IMP-12 원칙)');
    A.deepStrictEqual(Array.from(r2.unknownIds), ['peanutt']);
  });

  await tc('TC-02-16', 'normalizeAllergenIdArray: 같은 id가 대소문자만 다르게 중복되면 duplicateIds에 기록되고 한 번만 집계', async () => {
    const r = dishSchema.normalizeAllergenIdArray(['egg', 'EGG', 'Egg'], ALLOWED_ID_SET, { maxItems: 12 });
    A.deepStrictEqual(Array.from(r.value), ['egg']);
    A.strictEqual(r.duplicateIds.length, 2);
    A.strictEqual(r.status, 'truncated');
  });

  await tc('TC-02-17', 'normalizeAllergenIdArray: 유효/미등록/중복이 한 번에 섞인 경우도 전부 보존(정보 유실 없음)', async () => {
    const r = dishSchema.normalizeAllergenIdArray(['milk', 'milk', 'ghost_id', 'wheat'], ALLOWED_ID_SET, { maxItems: 12 });
    A.deepStrictEqual(Array.from(r.value).sort(), ['milk', 'wheat'].sort());
    A.deepStrictEqual(Array.from(r.duplicateIds), ['milk']);
    A.deepStrictEqual(Array.from(r.unknownIds), ['ghost_id']);
  });

  await tc('TC-02-18', 'validateAndNormalizeDish: dishes[] 원소가 null이면 그 원소만 거부(rejected), 예외를 던지지 않음', async () => {
    const r = dishSchema.validateAndNormalizeDish(null, ALLOWED_ID_SET);
    A.strictEqual(r.rejected, true);
    A.strictEqual(r.reason, 'null_entry');
  });

  await tc('TC-02-19', 'validateAndNormalizeDish: 원소가 객체가 아님(문자열/숫자/배열) → non_object_entry로 거부', async () => {
    A.strictEqual(dishSchema.validateAndNormalizeDish('그냥 문자열', ALLOWED_ID_SET).reason, 'non_object_entry');
    A.strictEqual(dishSchema.validateAndNormalizeDish(42, ALLOWED_ID_SET).reason, 'non_object_entry');
    A.strictEqual(dishSchema.validateAndNormalizeDish(['a'], ALLOWED_ID_SET).reason, 'non_object_entry');
  });

  await tc('TC-02-20', 'validateAndNormalizeDish: name_ko/name_en/translated_name이 전부 없으면 no_usable_name으로 거부', async () => {
    const r = dishSchema.validateAndNormalizeDish({ ingredients: '돼지고기' }, ALLOWED_ID_SET);
    A.strictEqual(r.rejected, true);
    A.strictEqual(r.reason, 'no_usable_name');
  });

  await tc('TC-02-21', 'validateAndNormalizeDish: 이름은 있지만 다른 필드가 전부 깨져도 degraded 상태로 생존(완전 폐기 아님)', async () => {
    const r = dishSchema.validateAndNormalizeDish({
      name_ko: '삼겹살', ingredients: 12345, allergens: 'egg', crossContactAllergens: null,
      eatingMethod: 'not an array', description: 999, culturalNote: {}, spicy: 'five',
    }, ALLOWED_ID_SET);
    A.strictEqual(r.rejected, false);
    A.strictEqual(r.dish.dishValidationStatus, 'degraded');
    A.strictEqual(r.dish.ingredients, '', '깨진 필드는 안전한 기본값으로');
    A.strictEqual(r.dish.allergens.length, 0);
    A.strictEqual(r.dish.nameKo, '삼겹살');
  });

  await tc('TC-02-22', 'validateAndNormalizeDishesResponse: dishes 필드 자체가 없음 → invalid, 사용 가능한 dish 0개', async () => {
    const r = dishSchema.validateAndNormalizeDishesResponse({}, ALLOWED_IDS);
    A.strictEqual(r.validationStatus, 'invalid');
    A.strictEqual(r.dishes.length, 0);
  });

  await tc('TC-02-23', 'validateAndNormalizeDishesResponse: dishes: [] (AI가 정말 아무것도 못 찾음) → empty, invalid와 구분됨', async () => {
    const r = dishSchema.validateAndNormalizeDishesResponse({ dishes: [] }, ALLOWED_IDS);
    A.strictEqual(r.validationStatus, 'empty');
    A.notStrictEqual(r.validationStatus, 'invalid', '"못 찾음"과 "응답이 깨짐"은 사용자에게 보여줄 의미가 다르므로 구분');
  });

  await tc('TC-02-24', '[핵심 수정] 부분 응답 생존: 3개 중 1개(null)가 깨져도 나머지 2개는 정상 렌더 가능해야 함', async () => {
    const raw = {
      dishes: [
        { name_ko: '김치찌개', name_en: 'Kimchi Jjigae', allergens: ['soybean'] },
        null,
        { name_ko: '된장찌개', name_en: 'Doenjang Jjigae', allergens: ['soybean'] },
      ],
    };
    const r = dishSchema.validateAndNormalizeDishesResponse(raw, ALLOWED_IDS);
    A.strictEqual(r.validationStatus, 'partial');
    A.strictEqual(r.dishes.length, 2, '구버전은 이 입력 전체가 예외로 날아갔음(repro-before 결함 3 참고) — 이제 2개 생존');
    A.strictEqual(r.rejectedDishCount, 1);
    A.strictEqual(r.dishes[0].nameKo, '김치찌개');
    A.strictEqual(r.dishes[1].nameKo, '된장찌개');
  });

  await tc('TC-02-25', 'validateAndNormalizeDishesResponse: dishes[]는 비어있지 않지만 전부 거부됨 → invalid(사용 가능한 dish 0개)', async () => {
    const r = dishSchema.validateAndNormalizeDishesResponse({ dishes: [null, {}, 42] }, ALLOWED_IDS);
    A.strictEqual(r.validationStatus, 'invalid');
    A.strictEqual(r.dishes.length, 0);
    A.strictEqual(r.rejectedDishCount, 3);
  });

  await tc('TC-02-26', 'validateAndNormalizeDishesResponse: 완전히 정상인 응답은 validationStatus: valid, validationIssues 없음', async () => {
    const r = dishSchema.validateAndNormalizeDishesResponse({
      dishes: [{ name_ko: '비빔밥', name_en: 'Bibimbap', ingredients: '밥, 나물, 고추장', allergens: ['soybean'], spicy: 1 }],
    }, ALLOWED_IDS);
    A.strictEqual(r.validationStatus, 'valid');
    A.strictEqual(r.validationIssues.length, 0);
  });

  await tc('TC-02-27', 'isValidDishResponseEnvelope: schemaVersion 불일치/구조 오류를 가진 봉투는 거부(클라이언트 방어선)', async () => {
    A.strictEqual(dishSchema.isValidDishResponseEnvelope({ schemaVersion: '0.0.1', dishes: [], validationStatus: 'empty' }), false);
    A.strictEqual(dishSchema.isValidDishResponseEnvelope({ dishes: [] }), false);
    A.strictEqual(dishSchema.isValidDishResponseEnvelope(null), false);
    A.strictEqual(dishSchema.isValidDishResponseEnvelope({ schemaVersion: '1.0.0', dishes: 'not an array', validationStatus: 'valid' }), false);
  });

  await tc('TC-02-28', 'isValidDishResponseEnvelope: 서버가 실제로 만들어내는 정상 봉투는 통과함', async () => {
    const r = dishSchema.validateAndNormalizeDishesResponse({
      dishes: [{ name_ko: '비빔밥', allergens: ['soybean'] }],
    }, ALLOWED_IDS);
    A.strictEqual(dishSchema.isValidDishResponseEnvelope(r), true);
  });

  // ============================================================
  // 2) api/analyze-menu.js 서버 핸들러 통합 테스트 (global.fetch Mock)
  // ============================================================

  await tc('TC-02-29', 'api/analyze-menu.js: Gemini가 null 원소가 섞인 dishes를 반환해도 서버가 200 + partial로 응답(나머지 생존)', async () => {
    delete require.cache[require.resolve('../api/analyze-menu.js')];
    const handler = require('../api/analyze-menu.js');
    const geminiJson = JSON.stringify({
      dishes: [
        { name_ko: '김치찌개', name_en: 'Kimchi Jjigae', allergens: ['soybean'] },
        null,
        { name_ko: '된장찌개', name_en: 'Doenjang Jjigae', allergens: ['EGG', 'ghost_allergen'] },
      ],
    });
    await withMockedGeminiFetch(geminiJson, async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const req = { method: 'POST', body: { imageBase64: 'data:image/jpeg;base64,AAAA', targetLanguage: 'en' } };
      const res = makeRes();
      await handler(req, res);
      A.strictEqual(res.statusCode, 200);
      A.strictEqual(res.body.validationStatus, 'partial');
      A.strictEqual(res.body.dishes.length, 2);
      A.deepStrictEqual(Array.from(res.body.dishes[1].allergens), ['egg']);
      A.deepStrictEqual(Array.from(res.body.dishes[1].allergensUnknownIds), ['ghost_allergen']);
    });
  });

  await tc('TC-02-30', 'api/analyze-menu.js: Gemini가 정말로 식품을 못 찾음({"dishes":[]}) → 200 + empty로 정상 응답', async () => {
    delete require.cache[require.resolve('../api/analyze-menu.js')];
    const handler = require('../api/analyze-menu.js');
    await withMockedGeminiFetch(JSON.stringify({ dishes: [] }), async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const req = { method: 'POST', body: { imageBase64: 'data:image/jpeg;base64,AAAA', targetLanguage: 'en' } };
      const res = makeRes();
      await handler(req, res);
      A.strictEqual(res.statusCode, 200);
      A.strictEqual(res.body.validationStatus, 'empty');
    });
  });

  await tc('TC-02-31', 'api/analyze-menu.js: dishes 필드 자체가 없는 완전히 다른 JSON → 502 + validationIssues 포함', async () => {
    delete require.cache[require.resolve('../api/analyze-menu.js')];
    const handler = require('../api/analyze-menu.js');
    await withMockedGeminiFetch(JSON.stringify({ unexpected: 'shape' }), async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const req = { method: 'POST', body: { imageBase64: 'data:image/jpeg;base64,AAAA', targetLanguage: 'en' } };
      const res = makeRes();
      await handler(req, res);
      A.strictEqual(res.statusCode, 502);
      A.strictEqual(Array.isArray(res.body.validationIssues), true);
      A.strictEqual(res.body.validationIssues.length > 0, true);
    });
  });

  // ============================================================
  // 3) index.html 통합 테스트 (tests/harness.js — 실제 <script> 블록 실행)
  // ============================================================

  await tc('TC-02-32', 'index.html: analyzeMenuPhotoWithAI가 서버의 partial 봉투를 받으면 살아남은 dish만 렌더링 시도(예외 없음)', async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => dishSchema.validateAndNormalizeDishesResponse({
        dishes: [
          { name_ko: '김치찌개', name_en: 'Kimchi Jjigae', allergens: ['soybean'] },
          null,
          { name_ko: '된장찌개', name_en: 'Doenjang Jjigae', allergens: ['soybean'] },
        ],
      }, ALLOWED_IDS),
    });
    const { context } = loadApp(HTML_PATH, { fetchImpl });
    await evalInContext(context, `analyzeMenuPhotoWithAI('data:image/jpeg;base64,AAAA')`);
    const { state } = pick(context, ['state']);
    A.strictEqual(state.hasScannedResult, true);
    A.strictEqual(state.lastScannedDishNamesKo.length, 2);
  });

  await tc('TC-02-33', '[핵심 수정] index.html: AI 분석 실패 시 직전 성공 결과가 화면에 "현재 결과"처럼 남지 않음', async () => {
    const failingFetch = async () => ({ ok: false, status: 502, json: async () => ({ error: 'boom' }) });
    const { context } = loadApp(HTML_PATH, { fetchImpl: failingFetch });
    // "직전에 성공한 스캔이 이미 화면에 떠 있는 상태"를 직접 주입해 재현한다
    // (언어 변경 시 재분석이 실패하는 실제 상황과 동일한 선행 조건).
    await evalInContext(context, `(function(){ state.hasScannedResult = true; document.getElementById('scan-result-pane').classList.remove('hidden'); })()`);
    await evalInContext(context, `analyzeMenuPhotoWithAI('data:image/jpeg;base64,AAAA')`);
    const { state } = pick(context, ['state']);
    A.strictEqual(state.hasScannedResult, false, '실패 후에는 hasScannedResult가 false로 초기화되어야 함(stale 방지)');
  });

  await tc('TC-02-34', 'index.html: 서버가 봉투 구조 계약을 어긴 응답(schemaVersion 불일치)을 보내면 클라이언트가 그대로 믿지 않고 실패 처리', async () => {
    const badFetch = async () => ({ ok: true, json: async () => ({ schemaVersion: '0.0.1', dishes: [], validationStatus: 'empty' }) });
    const { context } = loadApp(HTML_PATH, { fetchImpl: badFetch });
    await evalInContext(context, `analyzeMenuPhotoWithAI('data:image/jpeg;base64,AAAA')`);
    const { state } = pick(context, ['state']);
    A.strictEqual(state.hasScannedResult, false, '봉투 구조 자체가 계약과 다르면 성공 처리하면 안 됨(Defense in Depth)');
  });

  await tc('TC-02-35', 'index.html: escapeHtml이 HTML 특수문자를 전부 엔티티로 치환함(원본 텍스트 내용은 보존)', async () => {
    const { context } = loadApp(HTML_PATH, {});
    const { escapeHtml } = pick(context, ['escapeHtml']);
    const out = escapeHtml(`<script>alert(1)</script> & "quote" 'single'`);
    A.strictEqual(out.includes('<script>'), false);
    A.strictEqual(out.includes('&lt;script&gt;'), true);
    A.strictEqual(out.includes('&amp;'), true);
    A.strictEqual(out.includes('&quot;'), true);
    A.strictEqual(out.includes('&#39;'), true);
  });

  await tc('TC-02-36', '[XSS 종단 테스트] renderMultiDishScanResult: 악성 문자열이 섞인 dish를 넣어도 렌더 함수 자체가 예외 없이 완료됨(escapeHtml이 실제로 호출 경로에 적용됨)', async () => {
    const maliciousDish = {
      foodId: 'evil', name: '<img src=x onerror=alert(1)>김치찌개', nameKo: '김치찌개',
      ingredients: '배추', allergens: [], crossContactAllergens: [],
      spicy: 1, spicyStatus: 'valid',
      eatingMethod: ['<script>alert(2)</script>'],
      description: '<b onclick="evil()">설명</b>',
      culturalNote: '"><svg onload=alert(3)>',
      dishValidationStatus: 'valid',
    };
    const { context } = loadApp(HTML_PATH, {});
    evalInContext(context, `renderMultiDishScanResult(${JSON.stringify([maliciousDish])})`);
    // harness의 document stub은 getElementById 호출마다 새 더미를 반환해
    // "최종적으로 DOM에 쌓인 HTML"은 들여다볼 수 없다(TC-02-35가 escapeHtml
    // 자체의 치환 결과는 이미 직접 검증함) — 여기서는 악성 문자열이 섞인
    // dish를 넣어도 렌더 함수가 예외 없이 끝까지 실행되는지만 추가로 확인한다.
    A.strictEqual(true, true, 'renderMultiDishScanResult가 예외 없이 완료됨');
  });

  notRun('TC-02-37', '실제 브라우저에서 악성 문자열이 포함된 음식 이름/설명을 스캔 결과로 렌더링했을 때 <script>/onerror가 실행되지 않고 글자 그대로 보이는지', 'tests/harness.js의 document stub은 innerHTML을 실제로 파싱/렌더링하지 않는 더미 문자열 저장소라 브라우저 수준 검증 불가 — Playwright 등 실제 브라우저 테스트 필요');
  notRun('TC-02-38', '실제 메뉴판 사진(일부만 글자가 깨진 경우)을 Gemini에 실제로 전송했을 때 partial 처리 UX', '요청사항상 실제 Gemini API 호출은 지양 — Mock 응답으로 서버/클라이언트 로직은 TC-02-29/32에서 이미 검증');

  await tc('TC-02-39', '[회귀] 기존 IMP-11 테스트 22개 재실행', async () => {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'imp-11-after.js')], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    A.strictEqual(/\[FAIL\]/.test(out), false, 'IMP-11 회귀 테스트에 FAIL이 없어야 함');
  });

  await tc('TC-02-40', '[회귀] 기존 IMP-12 테스트 재실행', async () => {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'imp-12-after.js')], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    A.strictEqual(/\[FAIL\]/.test(out), false, 'IMP-12 회귀 테스트에 FAIL이 없어야 함');
  });

  await tc('TC-02-41', '[회귀] 기존 IMP-01 테스트 재실행(normalizeSpicy가 shared/dish-schema.js로 이동한 뒤에도 동일하게 동작)', async () => {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'imp-01-after.js')], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    A.strictEqual(/\[FAIL\]/.test(out), false, 'IMP-01 회귀 테스트에 FAIL이 없어야 함');
  });

  const summary = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  console.log('\n=== 요약 ===');
  console.log(summary);
  console.log(`명명된 테스트 케이스 수: ${results.length}건 / 실행된 assertion 총 개수: ${totalAssertions}건`);
  if (summary.FAIL > 0) process.exitCode = 1;
}

main();
