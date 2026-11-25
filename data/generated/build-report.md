# 식품 지식 데이터 파이프라인 — 빌드 보고서

## 1. 원본 시트별 전체 데이터 수

| 시트 | 행 수 |
|---|---:|
| 01_Allergens | 39 |
| 02_Allergen_Aliases | 15 |
| 03_Ingredients | 39 |
| 04_Ingredient_Allergens | 62 |
| 05_Dishes | 14 |
| 06_Dish_Ingredients | 0 |
| 07_Regulatory_Standards | 8 |
| 08_Evidence_Sources | 19 |
| 09_Restaurant_Verification | 14 |
| 10_Epidemiology | 3 |
| 11_Changelog | 2 |

## 2. 전체 검증 결과

- 결과: **통과(PASS)**
- Error(치명적 오류): 0건
- Warning(경고): 0건

## 3. 요청 항목별 요약

- 중복 ID(DUPLICATE_ID): 0건
- 참조 무결성 오류(BROKEN_REFERENCE): 0건
- 출처 누락(MISSING_EVIDENCE_FOR_REVIEWED): 0건
- AI 추정이 검증완료로 잘못 표시된 경우(AI_ESTIMATE_MARKED_AS_REVIEWED): 0건
- 기존 21종 ID 호환성 오류(ACTIVE_ID_SET_MISMATCH/LEGACY_ID_MISMATCH/LABEL_MISMATCH): 0건
- 동의어 충돌(CONFLICTING_ALIAS/DUPLICATE_ALIAS): 0건

## 4. 데이터 이용 조건 관련 제한

다음 1개 출처는 신뢰도가 `unverified`로 표시되어 있어, 이들 출처에서 가져온 원문/제한 데이터는 공개 배포용 산출물에 포함하지 않았습니다(각주만 인용, citationOnly=true로 표시):

- EV-DEMO-HACKATHON: 해커톤 원본 index.html locations[] 데모 데이터 ((내부 파일, 외부 URL 없음))

## 5. 서비스용으로 생성된 데이터 수

- allergen-registry.json (active): 21건
- allergen-candidates.json (candidate): 18건
- allergen-aliases.json (reviewed만): 0건
- ingredient-knowledge.json: ingredients 39건, confirmedRelations(reviewed만) 25건
- dishes-demo.json: dishes 14건, restaurantVerification 14건(전부 데모)
- regulatory-standards.json: 8건
- evidence-sources.json: 19건

## 6. 검토 대기 데이터(서비스 JSON에서 제외됨) — 관리용 목록

- 알레르겐 별칭 대기: 15건 (AI가 추정한 영문 표기 변형 — 전문가 검토 전)
- 식재료-알레르겐 관계 대기: 37건 (복합 식재료 실제 성분 추정 — 전문가 검토 전)
- 역학 연구 대기: 2건 (원문 미열람 또는 부분검증)

### 6-1. 식재료-알레르겐 관계 대기 목록(상위 일부)

| ingredientId | allergenId | relationType | reviewStatus |
|---|---|---|---|
| ganjang | soybean | CONTAINS_AS_RAW_MATERIAL | pending_expert_review |
| ganjang | wheat | PRODUCT_VARIANT_DEPENDENT | pending_expert_review |
| doenjang | soybean | CONTAINS_AS_RAW_MATERIAL | pending_expert_review |
| gochujang | soybean | CONTAINS_AS_RAW_MATERIAL | pending_expert_review |
| gochujang | wheat | PRODUCT_VARIANT_DEPENDENT | pending_expert_review |
| ssamjang | soybean | CONTAINS_AS_RAW_MATERIAL | pending_expert_review |
| ssamjang | wheat | PRODUCT_VARIANT_DEPENDENT | pending_expert_review |
| ssamjang | sesame | TYPICAL_RECIPE_INCLUSION | pending_expert_review |
| aekjeot | fish | CONTAINS_AS_RAW_MATERIAL | pending_expert_review |
| aekjeot | shrimp | PRODUCT_VARIANT_DEPENDENT | pending_expert_review |
| kimchi | fish | TYPICAL_RECIPE_INCLUSION | pending_expert_review |
| kimchi | shrimp | TYPICAL_RECIPE_INCLUSION | pending_expert_review |
| kimchi | wheat | TYPICAL_RECIPE_INCLUSION | pending_expert_review |
| eomuk | fish | CONTAINS_AS_RAW_MATERIAL | pending_expert_review |
| eomuk | wheat | TYPICAL_RECIPE_INCLUSION | pending_expert_review |
| eomuk | egg | PRODUCT_VARIANT_DEPENDENT | pending_expert_review |
| crab_stick | fish | CONTAINS_AS_RAW_MATERIAL | pending_expert_review |
| crab_stick | crab | UNCONFIRMED | pending_expert_review |
| crab_stick | egg | PRODUCT_VARIANT_DEPENDENT | pending_expert_review |
| yuksu | soybean | TYPICAL_RECIPE_INCLUSION | pending_expert_review |

## 7. 빌드 메타데이터(knowledge-manifest.json)

- schemaVersion: 1.0.0
- dataVersion: aa4d25550e99a06f
- sourceWorkbook: Food_Allergen_Master.xlsx
- sourceHash: 8efa12dcc89d7a793ace4833500b04d6e18de52e52f2e24c1549d3f4ed4496a0
- validationStatus: {'errors': 0, 'warnings': 0, 'status': 'passed'}
- generatedAt: 2026-11-25T12:36:32+00:00

## 8. 기존 shared/allergens.js 호환성

`shared/allergens.js`의 21종(id/legacyIds/6개 언어 명칭)과 Excel의 active 21종이 완전히 일치합니다. (어느 쪽이 원본인지는 docs/devlog/IMP-18C.md §5-4 참고 — 지금은 shared/allergens.js가 여전히 서비스의 원본입니다.)
