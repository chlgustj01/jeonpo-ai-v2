# IMP-18D-2 — 식품 지식 DB 기반 음식 분석 기능 연동

> 브랜치: `v2-dev` / 기준 커밋: `9230407`(IMP-02 완료)
> `main`(`a91f46c`)·원격 저장소 무변경. `api/analyze-menu.js`, `dev-server.js`,
> `shared/allergens.js`, `shared/dish-schema.js`, `data/`, `scripts/`는 **읽기만** 했다
> (`git diff 9230407 -- api dev-server.js shared/allergens.js shared/dish-schema.js data scripts` 빈 출력).
> ETL은 재실행하지 않았다 — `generatedAt`만 바뀌는 커밋을 만들지 않기 위함.

---

## 1. 기존 문제 및 개발 필요성

Gemini가 돌려주는 `dishes[].ingredients`에는 "Sesame oil"처럼 알레르기와 직결되는
식재료가 적혀 있는데, 같은 응답의 `allergens` 배열에는 그 성분(sesame)이 빠질 수 있다.
수정 전 서비스는 `allergens` 배열만으로 위험도를 판정했고, **이미 프로젝트에 있는
식품 지식 DB(`ingredient-knowledge.json`, sesame_oil → sesame 관계 `ia_0036`,
식품공전 근거 `EV-KR-FOODCODE-SESAMEOIL`)를 전혀 대조하지 않았다.** 그 결과 참깨
알레르기 사용자에게 참기름이 들어간 비빔밥이 아무 안내 없이 GREEN으로 표시됐다
(§9의 재현 D1~D4).

이번 단계의 목표는 위험도 판정을 바꾸는 것이 아니다. AI 추정 식재료를 지식 DB와
대조해 **"추가 확인이 필요한 성분과 그 근거"**를 따로 보여주는 것이다. 이때
AI 추정 · 문헌 기반 관계 · 실제 음식점 확인 정보를 절대 섞지 않는다.

## 2. 작업 준비 보고의 불일치 검토 (실제 코드로 재확인)

| 항목 | 준비 보고(이번 세션) | IMP-12 완료 보고 | 실제 코드 확인 결과 |
|---|---|---|---|
| `data/generated/*.json` 서비스 사용 여부 | "서비스 어디에서도 읽지 않음" | "index.html이 fetch로 3개 JSON을 직접 읽음" | **IMP-12 보고가 맞다.** `index.html` `loadAllergenKnowledgeBase()`(현재 `index.html:923`)가 `ALLERGEN_KB_PATHS`의 `allergen-aliases.json`·`allergen-candidates.json`·`knowledge-manifest.json` 3개를 `Promise.all(fetch…)`로 읽는다. 페이지 스크립트 평가 즉시 `const allergenKnowledgeBaseReady = loadAllergenKnowledgeBase()`(`index.html:991`)로 실행된다 |
| 색인 구조 | — | 동의어 14 · 후보 18종 · 색인 241건 | `allergenKB.index: Map(normalizedText → {canonicalId, lang, source})`. 등록 순서는 표준 라벨(21×6) → legacyId → `alias_db`(literatureBacked 14) → `candidate_db`(18종 라벨)이다. 실제 로드 로그는 "색인 241건, 후보 18종"이고, 이번 TC-18D2-02가 `index.size === 241`을 assert한다 |
| IMP-12 테스트의 로딩 검증 방식 | — | — | `tests/imp-12-after.js`의 `makeFetchMock()`이 실제 3개 JSON 텍스트를 그대로 서빙한다. `await allergenKnowledgeBaseReady` 후 `allergenKB.loaded`·`index.has(...)`를 확인한다 |
| 실제 지식 DB 활용 범위(수정 전) | — | — | **커스텀 알레르기 입력 매칭에만 사용**(`resolveCustomAllergyInput`). 음식 분석(`analyzeMenuPhotoWithAI` → `checkDishSafety`)에는 쓰이지 않았다. `ingredient-knowledge.json`·`evidence-sources.json`은 어디서도 요청되지 않았다(재현 D3) |
| `data/generated` 파일 개수 | "JSON 9개" | — | **오류.** 실제로는 JSON 8개 + `build-report.md` 1개다(`ls data/generated`). manifest `recordCounts`에는 manifest 자신을 뺀 JSON 7개가 기록되어 있다 |

**불일치 원인**: 준비 보고를 쓸 때 IMP-18C devlog §11 "현재 한계"의 문구
("`data/generated/*.json`은 아직 서비스 코드 어디에도 연결되지 않았다")를 그대로 옮겼다.
이 문구는 IMP-18C 시점에는 사실이었지만 IMP-12(`fb3f92f`) 이후로는 낡은 정보였다.
**코드를 다시 읽지 않고 이전 문서의 한계 항목을 현재 상태로 보고한 것이 원인이다.**
파일 개수도 `ls` 결과의 항목 수(9)를 JSON 개수로 잘못 적었다. 이번 작업은 이 확인
결과를 바탕으로 IMP-12 로더를 **재사용**한다. manifest를 다시 받지 않는다(§6).

## 3. 실제 데이터 분석 (문서 예시보다 실제 JSON을 우선)

### 3-1. `ingredient-knowledge.json` 84건의 정체

manifest의 `recordCounts["ingredient-knowledge.json"] = 84`는 관계 84건이 아니라
**세 배열의 합**이다.

| 배열 | 건수 | 내용 |
|---|---:|---|
| `ingredients` | 39 | 식재료 사전. `{id, nameKo, nameEn, kind}`. 복합(composite) 18, 단일(single) 21. **다국어 명칭은 ko/en 2개뿐** |
| `confirmedRelations` | 22 | Excel `reviewStatus == 'reviewed'`(ETL `transform.py:157`). 21건은 `raw_*` 단일 식재료의 IS_ALLERGEN(법정 표시 대상 정의, `EV-KR-MFDS-2021`), 1건은 `ia_0035` mustard_sauce → **mustard**(evidenceId 빈 값) |
| `literatureBackedCandidates` | 23 | Excel `reviewStatus == 'literature_reviewed'`(`transform.py:159`). 전부 `autoApplyToRiskJudgment:false`, `usableFor:[confirmation_candidate, staff_question_generation]` |

relationType 분포(서비스 JSON 45건)는 다음과 같다.
- IS_ALLERGEN 25
- CONTAINS_AS_RAW_MATERIAL 10
- PRODUCT_VARIANT_DEPENDENT 7
- TYPICAL_RECIPE_INCLUSION 2
- UNCONFIRMED 1(`ia_0019` 게맛살→게)

evidenceScope는 candidates에만 있다.
- legal_food_type_definition 16
- investigative_journalism 3
- academic_study_single_case 3
- international_standard 1

**`confirmedRelations`에는 evidenceScope 필드가 없다**. 이번 구현은 이 값을 지어내지 않고
`null`로 둔다. 생성 JSON 레코드에는 `reviewStatus` 필드도 없다. ETL 규칙상 "어느 배열에
있는가"가 곧 검토 상태이므로 `reviewed` / `literature_reviewed`로 파생한다. 근거는
`transform.py:156-176`이다.

### 3-2. A~G 정보 분류 — 실제 데이터 존재 여부

| 분류 | 출처 | 현재 실제 건수 |
|---|---|---:|
| A. AI 직접 포함 추정 | Gemini `allergens` | 응답마다 |
| B. AI 교차 접촉 추정 | Gemini `crossContactAllergens` | 응답마다 |
| C. DB 식재료 정의 관계 | IS_ALLERGEN / CONTAINS_AS_RAW_MATERIAL | 35(서비스 사용 34, `ia_0035` 제외) |
| D. DB 일반 레시피·포함 가능성 | TYPICAL_RECIPE_INCLUSION / PRODUCT_VARIANT_DEPENDENT | 9 |
| E. 특정 제품 확인 관계 | evidenceScope `manufacturer_product_specific` | **0** |
| F. 실제 음식점 확인 관계 | `dishes-demo.json.restaurantVerification` | **0** (14건 전부 `isDemo:true`, `doNotUseAsRealVerification:true`) |
| G. 검토 대기·확인 불가 | ETL에서 제외된 pending 17건(build-report §6) + UNCONFIRMED 1 | 서비스 JSON에는 UNCONFIRMED 1건만 존재 |

**실제 전문가 검토(`expert_reviewed`) 0건, 특정 제품 0건, 음식점 확인 0건이다.**
없는 검증 데이터를 만들지 않았다.

### 3-3. 다단계 관계(요청 §9) 지원 여부

| 관계 | Master DB 지원 | 근거 |
|---|---|---|
| 음식 → 식재료 → 알레르기 | **미지원** | `06_Dish_Ingredients` 시트 **0행**(build-report §1). `dishes-demo.json`에도 식재료 목록이 없다 |
| 음식 → 복합 식재료 → 세부 원재료 → 알레르기 | **미지원** | `compositeOf` 같은 자기참조 컬럼이 없다(IMP-18C §11 `SELF_REFERENTIAL_FIELDS` 비어 있음) |
| **식재료 → 알레르기**(1단계) | **지원** | 위 3-1 |

따라서 **1단계 조회만 구현**했다. 다단계 탐색·순환 참조 관리는 데이터가 생길 때
구현할 몫으로 남긴다. 음식명으로 레시피를 추정하는 기능도 만들지 않았다.

### 3-4. Gemini `ingredients`의 실제 형태

요청서는 "ingredients 배열"이라고 했지만 실제 계약은 **사용자 언어로 쓴 쉼표 구분
문자열**이다. `api/analyze-menu.js` 프롬프트는 `"ingredients": "Comma-separated key
ingredients, written in ${targetLangName}"`이고, `shared/dish-schema.js`도
`normalizeStringField`로 처리한다. 그래서 괄호 깊이를 고려해 쉼표 기준으로 나누는
`splitIngredientList()`를 두었다("soybean paste (contains soybean, wheat)"는 한 토큰).
지식 DB의 식재료명은 ko/en뿐이므로 **ja/zh/vi/es 사용자의 AI 응답은 대부분 매핑되지
않는다.** 이는 정직하게 한계로 남긴다(§11). 프롬프트 변경이나 Structured Output 도입은
범위 밖이다.

## 4. 적용 기술 및 설계 원칙

- **Knowledge-Augmented AI / Hybrid AI Architecture**: AI(Gemini)는 사진에서 식재료를
  "추정"하고, 결정론적 규칙 엔진이 그 추정을 검증된 지식 DB와 "대조"한다. 두 결과는
  서로 다른 객체(`dish` vs `report`)에 담긴다. **RAG가 아니다.** 검색 결과를 생성 모델에
  다시 넣지 않고, 벡터 검색도 없다. 정규화한 뒤 완전 일치하는 키를 조회할 뿐이다.
- **Deterministic Rule Engine**: 같은 입력이면 항상 같은 보고서가 나온다. TC-18D2-28이
  LF/CRLF 변형으로 보고서 전체가 `deepStrictEqual`임을 확인한다.
- **Graceful Degradation**: 지식 DB를 못 쓰면 AI 결과는 그대로 보여준다. 추가 확인
  영역에는 "확인 불가 — 안전하다는 뜻 아님"만 표시한다.
- **Fail-safe 해석**: "관계 없음" ≠ "성분 없음", "로딩 실패" ≠ "안전"이다.

## 5. 데이터 사용 정책 (실제 구현으로 강제한 것)

1. `dish.allergens` / `crossContactAllergens`를 수정하거나 추가하지 않는다. 보고서의
   `aiAnalysis`는 복사본이다(TC-11).
2. 모든 finding은 `usedForRiskJudgment:false`이다. `checkDishSafety()`는 한 줄도 바뀌지
   않았다. 지식 DB 로딩 성공/실패 두 앱에서 판정 결과가 `deepStrictEqual`이다(TC-16).
   - candidates 23건은 `autoApplyToRiskJudgment:false`를 그대로 보존한다. 만약 true가
     들어와도 `false`로 강제하고 issue로 기록한다(TC-27).
   - **`confirmedRelations`도 이번 단계에서는 위험도에 반영하지 않았다.** 관계 자체는
     확정이어도 "그 식재료가 이 음식에 들어 있다"는 사실은 여전히 AI 추정이기 때문이다.
     자동 반영 여부는 위험도 정책 변경이라 PRD 합의가 필요하다(CLAUDE.md 협업 원칙).
3. 활성 21종 밖의 알레르겐은 결과에서 제외한다. 실제 `ia_0035`(mustard)가 이 규칙으로
   빠진다. 후보 성분 이름(예: "Celery")은 `candidateAllergenTerms`에 기록만 한다(TC-18).
4. 배열 규칙과 다른 `reviewStatus`를 가진 레코드(예: pending)는 제외한다(TC-09).
5. 모호어(IMP-12 `KNOWN_AMBIGUOUS_CUSTOM_TERMS`, 현재 "shellfish")는 식재료 색인과
   알레르겐 색인 **둘 다 건너뛰고** `ambiguousIngredients`로 보존한다. 데이터의
   `raw_shellfish.nameEn`이 "Shellfish"라서 그냥 두면 연체동물로 확정되기 때문이다(TC-06).
6. 사용자 국적은 판정 입력에 없다(TC-15에서 국적을 바꿔도 결과 동일).
7. `dishes-demo.json`은 로딩하지 않는다. 지도 데모 음식은 `analysisSource:'demo_location'`,
   표시 라벨은 "데모 데이터 식재료"로 구분한다(TC-24).

## 6. 최종 구현 — 모듈 책임 분리

```
[로딩, index.html]
  loadAllergenKnowledgeBase()  (IMP-12, 기존)  aliases·candidates·manifest
     └ allergenKB.fetchedManifest 에 manifest 원본 보관(신규 1줄)
  loadFoodKnowledgeBase()      (신규)          ingredient-knowledge·evidence-sources
     └ manifest는 IMP-12가 받은 것 재사용 → 총 5개 파일, 페이지당 1회
     └ foodKB.status: loading → ready | load_failed | schema_version_mismatch | data_version_mismatch

[순수 로직, shared/food-knowledge.js (UMD, fetch/DOM 없음)]
  buildFoodKnowledgeBase()   버전/구조 검증 → 출처 색인 → 식재료 색인(Search Index)
                             → 관계 색인(Lookup Table) + 제외 사유 집계
  resolveIngredientTerm()    Entity Resolution (모호어 → 색인 충돌 → 완전 일치)
  getRelationsForIngredient()
  buildDishKnowledgeReport() 토큰 분리 → 식재료 매핑 → 관계 조회(1단계)
                             → IMP-12 알레르겐 색인 조회 → 출처 연결 → 근거 경로
                             → 사용자 프로필 비교 → 알레르겐별 그룹/중복 병합

[표시, index.html]
  buildKnowledgeReportForDish()  IMP-12의 userHasAllergyTo / allergenKB.index /
                                 KNOWN_AMBIGUOUS_CUSTOM_TERMS 를 주입(재구현 없음)
  applyKnowledgeReports()        렌더 토큰 확인 → 카드별 영역 갱신 → 로딩 중이면 완료 후 1회 재시도
  renderKnowledgeSectionHtml()   escapeHtml + http/https만 링크
  composeGreenBannerDesc()       GREEN 배너에 "단, 추가 확인 필요" 문구만 덧붙임(단계 변경 없음)
```

**IMP-12 색인과 신규 식재료 색인의 책임 분리**:

| 색인 | 키 | 값 | 답하는 질문 |
|---|---|---|---|
| `allergenKB.index`(IMP-12) | 정규화 텍스트 | 알레르겐 id | "이 단어가 알레르기 이름인가?" |
| `foodKB.kb.nameIndex`(신규) | 정규화 텍스트 | 식재료 id 목록 | "이 단어가 어떤 식재료인가?" |

알레르겐 id와 식재료 id는 서로 다른 네임스페이스로 유지한다(`sesame` ≠ `raw_sesame`
≠ `sesame_oil`). 식재료 문자열이 알레르기 이름과 정확히 같으면(예: "groundnut")
IMP-12 색인 결과를 `knowledgeTier:'allergen_term'`으로 별도 표기한다. IMP-12 색인
항목에는 동의어의 `evidenceId/evidenceScope`를 추가 필드로 붙였다(기존 매칭 동작은
그대로).

**근거 경로(Evidence Path) 예시**(TC-12, 실제 데이터):

```
ai_ingredient         "Sesame oil" (source: ai_scan)
→ ingredient_resolution  sesame_oil (matchedBy: name_en)
→ relation            ia_0036 IS_ALLERGEN, literature_candidate, literature_reviewed,
                      legal_food_type_definition, confidence high
→ evidence            EV-KR-FOODCODE-SESAMEOIL (linked)
→ profile_match       sesame (confirmed)
```

**요청 식별(최소 범위)**:
- `state.scanRequestSeq`: 늦게 도착한 이전 AI 응답은 성공이든 실패든 화면을 건드리지
  않는다(TC-23).
- `state.knowledgeRenderToken`: 화면이 새로 그려지거나 지워지면, 대기 중이던 지식 DB
  지연 갱신을 버린다(TC-30).

## 7. 변경된 파일 및 함수

| 파일 | 변경 |
|---|---|
| `shared/food-knowledge.js` | **신규.** 상수 `FOOD_KB_LOAD_STATUS`·`RELATION_CATEGORY_BY_TYPE`·`KNOWLEDGE_TIER`·`INFORMATION_CLASS`·`EXPECTED_REVIEW_STATUS`, 함수 `normalizeKnowledgeText`·`splitIngredientList`·`isSafeHttpUrl`·`buildFoodKnowledgeBase`·`resolveIngredientTerm`·`getRelationsForIngredient`·`buildDishKnowledgeReport` |
| `index.html` | `<script src="shared/food-knowledge.js">`. `registerAllergenKBEntry`에 선택 인자 `evidenceMeta` 추가. `loadAllergenKnowledgeBase`에 `fetchedManifest` 보관 1줄. 신규 `loadFoodKnowledgeBase`·`foodKB`·`foodKnowledgeBaseReady`·`lookupAllergenTermForIngredient`·`getUncertainCustomAllergenIds`·`buildKnowledgeReportForDish`·`kbText`·`getAllergenDisplayLabel`·`getRelationCategoryLabel`·`getKnowledgeTierLabel`·`renderKnowledgeFindingLine`·`renderKnowledgeSectionHtml`·`composeGreenBannerDesc`·`applyKnowledgeReports`. `analyzeMenuPhotoWithAI`에 요청 식별 추가. `clearStaleScanResult`·`resetScanner`에서 토큰 무효화. `renderMultiDishScanResult`·`renderScanResultUI`에 카드별 지식 DB 영역 추가. `#single-dish-knowledge` 마크업 1개. 6개 언어 × 27개 번역 키 |
| `tests/harness.js` | `shared/food-knowledge.js`를 실제 `<head>` 순서대로 로드(`skipFoodKnowledge` 옵션) |
| `tests/imp-18d2-repro-before.js` | **신규.** 9230407 원본을 `git show`로 꺼내 결함 재현 |
| `tests/imp-18d2-after.js` | **신규.** TC-18D2-01~30 + NOT RUN 2 |
| `docs/devlog/IMP-18D-2.md` | 본 문서 |

**재사용(재구현 없음)**:
- `userHasAllergyTo`·`KNOWN_AMBIGUOUS_CUSTOM_TERMS`·`allergenKB.index`·`normalizeAllergyText`(IMP-12)
- `escapeHtml`(IMP-02)
- `standardAllergens`(IMP-11)
- `validateAndNormalizeDishesResponse`(테스트에서 실제 서버 정규화 경로 재현)

**변경 없음**:
- `checkDishSafety`·`getSpeechScript`(TTS)·`api/analyze-menu.js`
- `dev-server.js`. 이미 모든 `.js/.json`을 정적으로 서빙하므로 수정이 필요 없다

## 8. 개선 전후 데이터 흐름 비교

```
[수정 전]
Gemini → dish{ingredients:"…, Sesame oil", allergens:[soybean, wheat]}
       → checkDishSafety(allergens만) → GREEN → 화면: "안전"
       (ingredient-knowledge.json: 요청조차 안 됨)

[수정 후]
Gemini → dish(그대로, 불변) ─┬→ checkDishSafety(동일) → GREEN
                             └→ buildDishKnowledgeReport(dish)
                                  "Sesame oil" → sesame_oil → ia_0036 → sesame
                                  → 사용자 참깨 알레르기 일치 + AI allergens에 없음
                                  → userAdvisories[sesame]
       → 화면: 배너 "안전… 단, 추가 확인이 필요한 성분이 있습니다(아래 참고)"
               카드 ⚠️ 추가 확인 필요 · 참깨
                    AI 추정 식재료: Sesame oil → 참기름 · 이 알레르기 성분으로 분류됨 (문헌 근거 · 전문가 미검토)
                    출처: 식품공전 — 식용유지류 참기름 정의(…)  [https 링크]
                    실제 사용 여부는 음식점 직원에게 확인해 주세요.
```

핵심 코드 차이(`renderMultiDishScanResult`):

```js
// 전: 카드 innerHTML만 조립
listContainer.appendChild(card);
// 후: 카드마다 독립 영역 + 이번 화면 토큰으로만 갱신
const knowledgeEl = document.createElement('div');
card.appendChild(knowledgeEl);
knowledgeEntries.push({ dish, el: knowledgeEl, dishKey: `${knowledgeRenderToken}:${dishIndex}` });
listContainer.appendChild(card);
…
applyKnowledgeReports(knowledgeRenderToken, knowledgeEntries, 'ai_scan', overall.safetyState === 'green' ? bannerDesc : null);
```

## 9. 테스트 결과

**재현(`tests/imp-18d2-repro-before.js`, 9230407 원본 실행) — 4/4 재현**

| ID | 내용 |
|---|---|
| D1 | 참깨 알레르기 + "Sesame oil" 포함 + allergens 누락 → GREEN |
| D2 | 실제 DB에 `ia_0036`(sesame_oil→sesame, `EV-KR-FOODCODE-SESAMEOIL`) 존재 — 데이터는 있었지만 쓰이지 않음 |
| D3 | 요청된 `data/generated` 파일은 3개뿐. `ingredient-knowledge.json`/`evidence-sources.json`은 미요청 |
| D4 | 원본 코드에 식재료 대조 함수/상태 없음 |

**개선 후(`tests/imp-18d2-after.js`)** — 명명 32건(TC 30 + NOT RUN 2),
**PASS 30 / FAIL 0 / NOT RUN 2**, 실행 assertion **346건**.

| TC | 내용 | 결과 |
|---|---|---|
| 01 | 실제 JSON 로딩(식재료 39, 사용 관계 44, 출처 31, dataVersion 일치) | PASS |
| 02 | IMP-12 로딩·색인 재사용(manifest 1회, 총 5개 파일, 색인 241, alias 경로) | PASS |
| 03 | `sesame_oil`/`참기름`/`Sesame oil` → sesame_oil(matchedBy 구분) | PASS |
| 04 | 공백·대소문자·NFD 정규화 매핑. `ごま油`/`芝麻油`는 DB에 없어 미매핑 | PASS |
| 05 | 들기름·perilla oil 미매핑. 땅콩/잣·sesame/sesame_oil 구분. 부분 문자열 금지 | PASS |
| 06 | "Shellfish" 모호 처리(후보 3종, 자동 확정 없음). 색인 충돌 fixture → ambiguous | PASS |
| 07 | 미등록 식재료 원본값 보존 | PASS |
| 08 | 간장 → ia_0001(대두, 원재료)·ia_0002(밀, 제품별 상이) | PASS |
| 09 | build-report 대기 관계 미포함 + pending fixture 제외 | PASS |
| 10 | relationType/evidenceScope/tier/reviewStatus 보존, confirmed의 evidenceScope는 null | PASS |
| 11 | 원본 dish 불변, aiAnalysis 복사본, IMP-02 필드 유지 | PASS |
| 12 | AI allergens에 없는 참깨 추가 확인 + 화면 문구 | PASS |
| 13 | 동일 성분 그룹 1개, 정규화 중복 토큰 1건 병합 | PASS |
| 14 | 대두 근거 경로 3개(간장/된장/soy 동의어) 모두 보존 | PASS |
| 15 | 표준·커스텀 확정·모호 커스텀 비교. 국적 무관 | PASS |
| 16 | RED/ORANGE 유지, DB 유무와 판정 동일, GREEN 배너 안내 | PASS |
| 17 | 김치→생선(일반 레시피) 미승격, 판정 GREEN 유지 | PASS |
| 18 | mustard(ia_0035)·celery 후보 비활성 유지 | PASS |
| 19 | 육수(관계 없음)·식재료 목록 없음 ≠ 성분 없음 | PASS |
| 20 | 404·JSON 손상·구조 오류·모듈 미로드 → load_failed, AI RED 유지, 렌더 정상 | PASS |
| 21 | schemaVersion 불일치, recordCounts 불일치(관계/출처), dataVersion 누락, 깨진 식재료 참조 | PASS |
| 22 | 음식 2개 결과 분리(dishKey/findingId 분리) | PASS |
| 23 | 늦게 도착한 이전 AI 응답 무시, 화면 초기화 시 결과 제거 | PASS |
| 24 | 데모/AI 출처 구분, dishes-demo.json 미로딩, F 분류 미생성 | PASS |
| 25 | XSS 이스케이프, https 링크 + noopener, `javascript:`/`data:` 차단 | PASS |
| 26 | 신규 27키 × 6개 언어 존재, 언어별 렌더 | PASS |
| 27 | candidates 23건 autoApply false, 모든 finding 판정 미사용, true 강제 보정 | PASS |
| 28 | LF/CRLF 파싱 객체·색인·보고서 동일(작업 트리 실제 파일은 CRLF) | PASS |
| 29 | 출처 ID 실존 검증, URL 일치, 경로 단계 순서, groundnut→EV-FAO | PASS |
| 30 | 로딩 중 분석 → "확인 중" → 로딩 후 현재 화면만 갱신, 이전 음식 결과 폐기, JSON 1회 | PASS |
| UI-1 | 실제 브라우저 시각 배치/링크 클릭 | **NOT RUN**(document stub은 innerHTML을 파싱하지 않음) |
| UI-2 | 실제 Gemini 응답의 언어별 식재료 매핑률 | **NOT RUN**(실제 API 호출 지양) |

**전체 회귀(재실행)**:

| 테스트 | 기준 | 결과 |
|---|---|---|
| `imp-11-after.js` | PASS 21 | **PASS 21 / FAIL 0** |
| `imp-12-after.js` | PASS 25 / NOT RUN 3 | **PASS 25 / FAIL 0 / NOT RUN 3** |
| `imp-01-after.js` | PASS 20 / NOT RUN 2 | **PASS 20 / FAIL 0 / NOT RUN 2**(assertion 127) |
| `imp-02-after.js` | PASS 39 / NOT RUN 2 | **PASS 39 / NOT RUN 2**(assertion 92) |
| `py -m unittest tests.test_food_knowledge` | 31/31 | **31/31 OK** |
| `py scripts/validate_food_knowledge.py` | Error 0 / Warning 0 | **PASS(Error 0, Warning 0)** |
| `imp-01/02-repro-before.js` | — | exit 0 |
| `git status -- data scripts` | 변경 없음 | **변경 없음** |

**테스트 인프라 vs 서비스 코드 구분**:
- `imp-11-repro-before.js`는 exit 1(PASS 1 / FAIL 5 / NOT RUN 2)이다. 임시 worktree로
  **9230407에서 실행해도 결과가 동일**함을 확인했다. 이 스크립트는 "현재" index.html에
  IMP-11 이전 결함이 있다고 가정하는 역사적 재현 스크립트라, IMP-11 이후로는 계속 이
  결과가 나온다. 이번 변경과 무관하다.
- 기존 4개 테스트의 Mock은 신규 2개 URL을 모르기 때문에 실행 중 "[IMP-18D-2] 식품 지식
  DB 로드 실패" 로그가 찍힌다. 의도한 Graceful Degradation 경로이며 결과에는 영향이 없다.
- 개발 중 TC-15·22가 처음에 FAIL했다. vm context(다른 realm)의 배열을 `deepStrictEqual`로
  직접 비교한 **테스트 코드 결함**이었고, `plain()` 변환 후 PASS했다. 서비스 코드는
  수정하지 않았다.

## 10. 기존 기능에 미친 영향

- 위험도 판정(`checkDishSafety`), 식이 제한, 맵기, IMP-12 모호성 처리, TTS 문장
  (`getSpeechScript`): **무변경**(회귀 전부 PASS).
- IMP-12 매칭: 색인 항목에 선택 필드 2개만 추가했다. 241건과 동작은 동일하다.
- 화면:
  - AI 스캔 카드 아래와 데모 상세 화면에 작은 "식품 지식 DB 확인" 영역이 생겼다.
  - GREEN 배너에는 조건부 안내 한 문장이 붙는다.
  - 색상·레이아웃·배너 단계는 기존 그대로다.
- 네트워크: 페이지 로드 시 JSON 2개(약 32KB)를 1회 추가로 받는다. 분석할 때마다 다시
  받지 않는다.
- 연속 분석 시 이전 요청의 늦은 응답이 무시된다(기존에는 마지막에 도착한 응답이 화면을
  덮어썼다).

## 11. 남은 한계 (후속 과제)

**데이터 측면**
- 식재료명이 **ko/en뿐**이라 ja/zh/vi/es 사용자의 Gemini `ingredients`(사용자 언어로
  작성)는 대부분 매핑되지 않는다. 그 경우 "지식 DB에서 찾지 못함(안전 확인 아님)"으로
  보존·표시된다. 실제 매핑률은 측정하지 않았다(UI-2 NOT RUN).
- 식재료 동의어 사전이 없다. "달걀"(DB는 "계란"), "peanuts"(식재료 색인 기준) 등은
  일부만 IMP-12 알레르겐 색인으로 잡힌다. 근거 없는 동의어는 추가하지 않았다.
- 음식→식재료(`06_Dish_Ingredients` 0행)와 복합 식재료 분해 관계가 없어 1단계 조회만
  가능하다.
- 서비스 관계 44건은 전부 전문가 미검토 상태다(`expert_reviewed` 0). 특정 제품(E)·음식점
  확인(F)은 0건이다.
- confirmedRelations에는 evidenceScope가 없다. `ia_0035`는 evidenceId가 없고 후보
  알레르겐이라 제외된다.

**설계 측면**
- 지식 DB 결과는 위험도 단계에 반영하지 않는다. GREEN과 "추가 확인 필요"가 함께
  보일 수 있다(배너 안내 문구로만 보완). confirmedRelations의 자동 반영 여부는
  PRD 합의가 필요하다.
- 전용 UNKNOWN/ERROR 화면(IMP-03), 직원 질문·TTS에 추가 확인 성분 반영, 캐싱·재시도는
  범위 밖이다.

**검증 측면**
- 실제 브라우저 렌더링(UI-1)과 실제 Gemini 응답(UI-2)은 검증하지 않았다.

## 12. 정량 결과 (실제 실행 기준 — Mock/실제 생성 데이터, 서비스 실측 아님)

| 항목 | 값 |
|---|---:|
| 실제 로딩 JSON 파일 수 | **5**(IMP-12 기존 3 + 신규 2). `dishes-demo.json` 등 3개는 미로딩 |
| 기존 로딩 로직 재사용 | **예**. manifest 재다운로드 0회, IMP-12 색인 241건 재사용 |
| 신규 식재료 색인 키 수 | **115**(식재료 39 × id/ko/en, 중복 제거). 충돌 **0** |
| 조회 가능한 식재료 수 | **39**(그중 서비스 관계 보유 35) |
| 실제 조회 가능한 관계 수 | **44** / 원본 45(confirmed 21 + candidates 23). 제외 1(`ia_0035` 후보 알레르겐) |
| 문헌 기반 추가 확인 후보 수 | **23**(전부 autoApply false) |
| 출처 연결 | 서비스 관계 44건 중 **44건** 실제 evidence ID에 연결(누락 0) |
| 검토 대기 관계 제외 수 | ETL 단계 **17**(build-report §6) → 클라이언트 도달 0. 클라이언트 fixture 제외 검증 1 |
| AI 응답에 없던 추가 확인 사례 | 재현 시나리오(비빔밥 "Sesame oil" → 참깨) 1. **실제 데모 데이터에서도 1건 발견**: 지도 데모 `samgyeopsal`의 식재료 "sesame oil"이 `allergens`(pork·soybean·wheat)에 없는 sesame와 연결됨 |
| 데모 음식 14개 전수 조회 | 토큰 65 중 매핑 11, 미매핑 54(원본 보존), finding 11 |
| 미확인 식재료 처리 사례 | TC-07(들기름/Garlic/고사리 나물), TC-19(육수=관계 없음) |
| 모호한 입력 차단 사례 | "Shellfish" 1(실제 데이터), 색인 충돌 fixture 1 |
| 근거 경로 추적 | TC-29 샘플 8개 토큰에서 finding 11건, 전부 5단계 경로 + 실존 출처 |
| 중복 근거 통합 사례 | TC-13: 토큰 3 → 그룹 1, finding 2, 병합 1. TC-14: 대두 경로 3개 모두 보존 |
| 신규 테스트 | PASS 30 / FAIL 0 / NOT RUN 2, assertion 346 |
| 신규 데이터 로딩 횟수 | 페이지당 각 파일 **1회**(분석 3회 후에도 1회, TC-30) |
| 신규 번역 문자열 | 27키 × 6언어 = 162 |

**주장하지 않는 것**: 음식 인식 정확도 향상, 알레르기 검출 정확도의 의학적 향상, 실제
서비스 환경에서의 매핑률. 위 수치는 전부 Mock과 실제 생성 데이터에 대한 결정론적 실행
결과다.

---

## 기술 개념 설명 (초급 개발자를 위해, 실제 코드와 연결)

| 개념 | 이번 코드에서의 위치 / 의미 |
|---|---|
| **Knowledge-Augmented AI** | AI 추정(`dish.ingredients`)을 검증된 지식(`ingredient-knowledge.json`)으로 보강하는 구조. `buildDishKnowledgeReport()`가 그 보강 결과를 별도 객체로 만든다. 생성 모델에 다시 넣지 않으므로 RAG가 아니다 |
| **Entity Resolution** | "Sesame oil", "참기름", "sesame_oil"이 같은 대상(`sesame_oil`)인지 판별. `resolveIngredientTerm()`이 모호어 → 색인 충돌 → 완전 일치 순서로 판정 |
| **Lookup Table** | `relationsByIngredient: Map(ingredientId → 관계[])`. 식재료 id 하나로 관계 목록을 즉시 꺼냄 |
| **Search Index** | `nameIndex: Map(정규화 텍스트 → 식재료 id[])`. 사람이 쓴 문자열로 id를 찾기 위한 색인. 값이 배열이라 충돌을 감지할 수 있음 |
| **Relationship Traversal** | 식재료 → 알레르기 관계를 따라가는 것. 현재 데이터가 1단계만 지원하므로 1단계만 구현(§3-3) |
| **Data Provenance** | 각 finding의 `relationId`/`reviewStatus`/`evidenceScope`/`sourceId`/`analysisSource` — "이 정보가 어디서 왔는가" |
| **Evidence Path** | `finding.evidencePath` 5단계(ai_ingredient → ingredient_resolution → relation → evidence → profile_match) |
| **Deterministic Rule Engine** | 확률·유사도 없이 정규화 + 완전 일치 + 정책 필드만으로 판단. 같은 입력이면 같은 출력(TC-28) |
| **Hybrid AI Architecture** | AI(확률적 추정) + 규칙(결정론적 대조)을 분리 배치. 둘의 결과를 합치지 않고 나란히 보여줌(§8 다이어그램) |
| **Explainable UI** | "추가 확인 필요" 카드가 식재료 → DB 명칭 → 관계 유형 → 검토 수준 → 출처를 그대로 보여줌(`renderKnowledgeFindingLine`) |
| **Data Loading Lifecycle** | `foodKB.status`: loading → ready / load_failed / schema_version_mismatch / data_version_mismatch. `applyKnowledgeReports()`가 loading이면 완료 후 같은 화면일 때만 갱신 |
| **Graceful Degradation** | DB를 못 쓰면 AI 결과는 그대로 두고 "확인 불가 — 안전 아님"만 안내(TC-20) |
