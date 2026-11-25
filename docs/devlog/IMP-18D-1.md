# IMP-18D-1 — 식품 지식 DB 근거 검증 및 데이터 활성화

> 브랜치: `v2-dev` / 기준 커밋: `d6a50b2`(IMP-18C 완료)
> 서비스 코드(`index.html`/`api/analyze-menu.js`/`dev-server.js`/`shared/allergens.js`)와
> IMP-11의 알레르기 ID 체계는 이번 작업에서 **한 줄도 바꾸지 않았다.**
> `tests/imp-11-after.js` 22개는 직접 재실행해 전부 PASS를 재확인했다.

---

## 1. 기존 데이터의 한계

IMP-18C 완료 시점 기준:
- `allergen-aliases.json`이 **완전히 빈 배열**이었다(과거 legacyIds 중복 미러링을
  제거한 결과, 남은 15개 별칭이 전부 AI 추정이라 서비스 노출 기준을 못 넘었음).
- `ingredient-knowledge.json`의 `confirmedRelations`가 21~25건의 **자명한(정의상)
  관계뿐**이었고, 실제로 유용한 복합 식재료 지식(간장→대두, 액젓→생선 등) 37건은
  전부 `pending_expert_review`로 묶여 서비스에서 전혀 쓸 수 없었다.
- "AI가 공식 문헌을 실제로 찾아 대조한 것"과 "AI가 그냥 일반 상식으로 추정한 것"이
  구조적으로 구분되지 않았다 — 둘 다 `pending_expert_review`/`ai_estimated_general_knowledge`
  한 묶음이었다.

## 2. 실제 조사 대상

먼저 실제 파일을 직접 읽어 수치를 재확인했다(추측하지 않음):
- `data/master/Food_Allergen_Master.xlsx`를 Python으로 직접 열어 `pending_expert_review`
  상태인 **04_Ingredient_Allergens 37건**, **02_Allergen_Aliases 15건**을 전부
  추출해 목록화했다(이전 보고서의 숫자와 정확히 일치 확인).
- `tree_nut_general` 삭제 행의 원본 내용을 `git show 14f0544:scripts/generate-master-xlsx.js`로
  직접 확인했다 — 삭제된 것은 "제과류 공장의 견과류 일반 교차오염 가능성"이라는
  **실제로 유효한 우려**였고, 삭제된 이유는 그 개념 자체가 아니라 "존재하지
  않는 id를 참조했다"는 **구현 결함**이었다(의미 손실과 참조 무결성 문제를 분리).
- "definitional"(자명) 예외를 적용받은 4건(새우젓→새우, 머스터드→겨자, 참기름→참깨,
  땅콩소스→땅콩)을 재검토 대상으로 지정했다.

## 3. 조사 자료 및 출처

국내외 공식 규정을 우선순위대로 조사했다(§6 우선순위 그대로):

| 주제 | 출처 | 확인 내용 |
|---|---|---|
| 간장/된장/고추장/혼합장(쌈장) | 식품공전 장류 정의(검색엔진 요약) | 간장="대두·쌀·보리·밀 중 주원료", 고추장="두류 또는 곡류 주원료+고춧가루6%↑", 혼합장="장류 50%↑" |
| 액젓/새우젓/김치 | 식품공전 젓갈류 정의 + 세계김치연구소 배추김치 정의 | 젓갈류 원재료에 새우 명시적 포함, 배추김치 공식 원재료 목록에 "젓갈" 포함 |
| 참기름 | 식품공전 식용유지류 정의 | "다른 식용유지를 일절 혼합하여서는 아니 된다" — 100% 참깨 유래를 법정 수준에서 확인(이번 조사 최고 근거) |
| 어묵 | 식품공전 어육가공품류 정의 | "어육의 염용성 단백질 추출"이 정의의 핵심 |
| 카레소스 | 식품공전 카레/카레루 정의 | "카레루"는 밀가루를 식용유로 볶아 카레분과 혼합 — 밀 포함을 정의 수준에서 확인 |
| 땅콩소스 | 식품공전 땅콩버터 정의 | "땅콩을 볶아 분쇄" — 명칭 차이(소스 vs 버터)는 투명하게 기록 |
| 마요네즈 | **CODEX STAN 168-1989**(국제표준) | 난황 최소 6% 요구 |
| 굴소스 | 동료평가 논문(단일 연구 배합) | 굴 농축액 40%, 소맥분 3.5%, 간장 4% — 한 연구 사례임을 명시, 일반화 안 함 |
| 게맛살 | 복수 언론 탐사보도(소비자가만드는신문 등) | 연육 60~80%, 계란흰자 포함 흔함, **게살 1~5% 또는 0%** — "UNCONFIRMED가 옳았다"를 재확인 |
| 머스터드 | (조사했으나 기각) | "CXS 192-1995가 머스터드 표준"이라는 검색 결과를 찾았으나, 그 표준은 실제로는 "식품첨가물 일반 규격"이라 머스터드 소스 정의와 무관 — **출처 귀속이 의심스러워 인용하지 않음** |
| shrimp=prawn | FDA 갑각류 표시 가이드라인 | shrimp/prawn을 같은 표시 동의어로 나열 |
| peanut=groundnut | FAO Agrovoc / USDA Taxon DB | 동일 품종(Arachis hypogaea) 확인 |
| 육수 | (조사했으나 못 찾음) | "육수"를 정의하는 공식 식품유형 자체를 발견하지 못함 — 4건 전부 승격 보류 |

**정직한 한계**: 식품공전 원문 페이지(`various.foodsafetykorea.go.kr`)는
동적(JS) 렌더링이라 WebFetch로 직접 열람하는 데 실패했다(빈 껍데기 HTML만
받아짐). 그래서 위 식품공전 인용은 전부 **검색엔진 요약(secondary_summary)**
수준이며, "법령 원문을 직접 읽었다(primary_legal_text)"고 과장하지 않았다
(IMP-17B에서 MFDS PDF를 직접 읽었던 것과는 신뢰도 등급이 다름을 명시).

## 4. 검증 방법

1. 신뢰 수준을 구분하는 **신규 스키마 필드 3개**를 도입했다(`04_Ingredient_Allergens`,
   `02_Allergen_Aliases`에 추가): `reviewerType`(`unreviewed`/`ai_literature_check`/
   `human_expert`), `evidenceScope`(법정 정의/국제표준/단일연구/탐사보도/일반상식 등),
   `verifiedAt`(사람 전문가가 실제로 서명한 날짜 — 지금은 전부 공란).
2. 새 `reviewStatus` 값 `literature_reviewed`를 도입했다 — "AI가 문헌을 대조한
   결과"를 "순수 추정"과도, "사람 전문가 검토"와도 구분하는 중간 등급.
3. `expert_reviewed`(예약, 아직 미사용)도 함께 스키마에 선언해, 실제 전문가가
   투입되는 시점에 바로 쓸 수 있게 했다.
4. **이 구분을 코드로 강제**했다(`scripts/food_knowledge/validate.py`의
   `_validate_reviewer_consistency` 신규 함수): `literature_reviewed`는
   `reviewerType='ai_literature_check'` + `evidenceScope≠'none'` +
   `evidenceType='literature_cross_checked'`가 전부 있어야 하고, `expert_reviewed`는
   `reviewerType='human_expert'` + `verifiedAt` 실제 날짜가 있어야 한다 —
   어느 한쪽이라도 거짓이면 빌드 자체가 실패한다(fail-closed, IMP-18C와 동일 철학).
5. 각 복합 식재료 관계를 위 출처와 하나씩 대조해 승격 여부를 결정했다(§9 참고).

## 5. 검증 완료 및 보류 근거

- **승격(37건 중 20건, 4건 중 3건)**: 위 §3 출처표와 1:1 대응 — 모든 승격 행에
  `evidenceId`(또는 trivial한 경우 `evidenceScope='general_culinary_knowledge'`)가
  달려 있다.
- **보류 유지(17건)**: 공식 문헌을 찾지 못했거나(육수 4건, 샐러드드레싱 3건,
  빵/제과류 세부 3건 등), 법정 정의가 "제품마다 다를 수 있다"는 변이 자체를
  확정하지 않는 항목(어묵의 밀/계란 등).
- **승격 보류 + 명시적 거부(머스터드 출처)**: 의심스러운 출처 귀속을 발견했을 때
  "그래도 공식 문헌 같아 보이니 쓴다"가 아니라 **인용하지 않는 쪽을 선택**했다.
- **동의어 1건 승격 보류 + 안전 문제 발견**: `shellfish (mollusks)` — 미국에서
  "shellfish"는 통상 **갑각류**(FDA 9대 알레르겐의 "crustacean shellfish")를
  가리키는데, 우리 registry의 `shellfish` id는 한국 식품공전에 따라
  **연체동물**(조개류: 굴·전복·홍합)만 가리킨다. 이 둘을 그대로 매핑하면 영어
  사용자가 "shellfish"를 입력했을 때 실제로는 갑각류(새우/게) 알레르기가 있는
  사람의 입력이 엉뚱한 성분(조개류)으로 연결될 수 있다 — **다른 알레르기
  성분과의 혼동 가능성**을 실제로 찾아낸 사례이며, 승격하지 않고 pending
  유지했다(IMP-12에서 "어떤 종류의 shellfish인지" 되묻는 UI를 제안).

## 6. 변경된 Excel 데이터

- `scripts/generate-master-xlsx.js`: `04_Ingredient_Allergens`/`02_Allergen_Aliases`에
  신규 컬럼 추가(기존 컬럼 순서 불변), 37건 중 20건 + definitional 4건 중 3건을
  `literature_reviewed`로 승격, 신규 `Evidence_Sources` 12건 추가(08시트
  19→31건), `11_Changelog`에 v1.2 기록.
- **기존 21종 ID, legacyIds, 6개 언어 명칭은 단 하나도 바꾸지 않았다**
  (`shared/allergens.js` 호환성 테스트 `TC-18C-12`로 재확인, PASS).

## 7. ETL 생성 결과 (재실행 전후 비교)

| 산출물 | IMP-18C(이전) | IMP-18D-1(이후) |
|---|---|---|
| `allergen-aliases.json` | `reviewed:0, literatureBacked:(없음)` | `reviewed:0, literatureBacked:14` |
| `ingredient-knowledge.json` | `confirmedRelations:25`(전부 자명) | `confirmedRelations:22, literatureBackedCandidates:23`(신규 계층) |
| `08_Evidence_Sources` | 19건 | 31건(+12) |
| `11_Changelog` | v1.1 | v1.2 |

`ingredient-knowledge.json`에 **신규 3번째 계층 `literatureBackedCandidates`**를
추가했다(§9 정책 그대로) — `confirmedRelations`(법정 정의급, 위험도 판정에
그대로 사용 가능)와 물리적으로 분리하고, 모든 레코드에
`autoApplyToRiskJudgment:false`를 고정해 "확인 후보·직원 질문 참고자료로만
쓰고 확정 판정에는 쓰지 않는다"는 정책을 구조적으로 강제했다.

## 8. 테스트 결과

```
Ran 31 tests in ~4s
OK  (6회 연속 재실행으로 안정성 확인)
```

기존 20개(TC-18C-01~16 + 보조 변형) 전부 그대로 PASS + 신규 11개 테스트:

| 신규 테스트 | 확인 내용 | 결과 |
|---|---|---|
| `test_literature_reviewed_requires_ai_literature_check_reviewer_type` | reviewerType 누락 차단 | PASS |
| `test_literature_reviewed_requires_evidence_scope` | evidenceScope 누락 차단 | PASS |
| `test_literature_reviewed_requires_matching_evidence_type` | evidenceType 불일치 차단(+ 기존 AI추정 규칙과 동시 발동 확인) | PASS |
| `test_04_sheet_always_requires_evidence_id_even_for_general_knowledge_scope` | 04시트는 일반상식만으로 승격 불가(더 엄격) | PASS |
| `test_02_sheet_allows_blank_evidence_id_for_general_culinary_knowledge` | 02시트는 트리비얼 표기변형에 한해 허용(차등 적용 확인) | PASS |
| `test_evidence_scope_requiring_specific_doc_needs_evidence_id` | "국제표준인데 인용문서 없음" 모순 차단 | PASS |
| `test_expert_reviewed_requires_human_expert_and_verified_at` | expert_reviewed 오남용 차단 | PASS |
| `test_expert_reviewed_passes_with_real_human_expert_and_date` | 정상 케이스 통과 확인 | PASS |
| `test_human_expert_reviewer_type_requires_expert_reviewed_status` | 대칭 모순(사람이 봤다면서 상태 안 올림) 차단 | PASS |
| `test_transform_separates_literature_backed_from_confirmed` | 신규 3계층 분리 동작 확인 | PASS |
| `test_real_data_has_zero_actual_human_expert_reviews` | **정직성 확인**: 실제 데이터에 `human_expert`/`expert_reviewed`가 0건임을 재확인 | PASS |

**⚠️ 테스트 작성 중 발견한 버그(정직하게 기록)**: `TC-18C-13`(결정론적 빌드
일관성) 테스트가 간헐적으로 실패했다. 원인은 파이프라인이 아니라 **테스트
자체의 설계 오류** — `knowledge-manifest.json`의 `generatedAt` 필드는
설계상 "매번 달라지는 게 정상"인데, 그 파일까지 완전 바이트 일치를 요구하고
있었다(두 빌드 사이에 초 단위가 넘어가면 실패). `knowledge-manifest.json`을
바이트 비교 대상에서 제외하고(핵심 내용은 이미 별도로 `dataVersion`/
`sourceHash`/`recordCounts` 비교로 검증 중이었음) 6회 연속 재실행으로
안정성을 재확인했다.

## 9. 데이터 활용 정책 — 실제 반영

사용자가 제시한 A~F 분류를 실제 출력 파일에 그대로 매핑했다:

| 분류 | 산출물 위치 |
|---|---|
| A. 표준 명칭 매핑 | `allergen-aliases.json.literatureBacked`(14건) |
| B. 식재료 분류 관계 | `ingredient-knowledge.json.confirmedRelations`(22건, 자명/법정 수준) |
| C. 일반적 포함 가능성 안내 | `ingredient-knowledge.json.literatureBackedCandidates`(23건, `autoApplyToRiskJudgment:false`) |
| D. 특정 제품 원재료 정보 | 이번엔 0건(`manufacturer_product_specific` scope를 실제로 쓴 행 없음 — 정직하게 보고) |
| E. 음식점 확인 정보 | 여전히 0건(`dishes-demo.json` 전부 `isDemo:true`) |
| F. 검토 대기 데이터 | 빌드 보고서(`data/generated/build-report.md`)에만 기록, 서비스 JSON에는 없음 |

## 10. 정량적 결과 보고 (§11 요구 형식 그대로)

| 항목 | IMP-18C(이전) | IMP-18D-1(이후) |
|---|---:|---:|
| 검토 대기 동의어 수 | 15 | **1** |
| 서비스 반영 가능 동의어 수 | 0 | **14** |
| 검토 대기 복합 식재료 관계 수 | 37 | **17** |
| 문헌 근거 확보 관계 수(`literature_reviewed`, 04) | 0 | **23**(20 신규 승격 + 3 definitional→문헌승격) |
| 실제 전문가 검토 완료 관계 수(`expert_reviewed`) | 0 | **0**(정직 — 아직 없음, 테스트로 재확인) |
| 특정 제품 단위 근거 확보 수(`manufacturer_product_specific`) | 0 | **0**(정직 — 이번엔 해당 scope를 쓴 행 없음) |
| 일반 레시피 기반 확인 후보 수(`literatureBackedCandidates`) | 0 | **23** |
| 실제 음식점 확인 수 | 0 | **0**(불변) |
| 신규 출처 확보 수(`08_Evidence_Sources`) | 19 | **31**(+12) |
| 오류 수 | 0 | **0** |
| 경고 수 | 0 | **0** |
| 테스트 실행/통과 수 | 20/20 | **31/31**(6회 연속 재확인) |

**목표를 채우기 위해 부풀리지 않았다는 증거**: evidenceScope 세부 분포는
`legal_food_type_definition` 16건(04) + 1건(02), `international_standard`
1건(04, 마요네즈) + 3건(02, groundnut/prawn/sulphites), `academic_study_single_case`
3건(굴소스), `investigative_journalism` 3건(게맛살), `general_culinary_knowledge`
10건(02, 트리비얼 표기) — **각 수치가 실제로 찾은 출처 개수와 정확히 일치**한다
(허수 없음).

## 11. 기존 시스템에 미치는 영향

**0 — 서비스 코드 무변경.** `index.html`/`api/analyze-menu.js`/`dev-server.js`/
`shared/allergens.js`에 대한 `git diff`가 전부 빈 출력임을 확인했다.
`tests/imp-11-after.js` 22개를 직접 실행해 전부 PASS 재확인(`PASS: 21`,
`FAIL: 0`, `NOT RUN: 0` — 22개 테스트 케이스, 6·7·9·12·14가 각각 a/b 변형
포함이라 표시는 21개 그룹).

## 12. 여전히 전문가 검토가 필요한 항목

- **`literature_reviewed` 23건 전부** — AI가 문헌을 대조했을 뿐, 식품영양학
  또는 알레르기 임상 전문가의 서명은 받지 않았다. 특히 "고추장은 두류 **또는**
  곡류"라는 식품공전의 OR 조건을 두고 soybean confidence를 `high`로 유지한
  판단은 **전문가 재검토를 권장**한다(§5 참고).
- **`pending_expert_review` 17건** — 육수(4건), 샐러드드레싱(3건) 등 공식
  문헌 자체를 찾지 못한 항목.
- **`shellfish (mollusks)` 동의어** — 승격 보류 + 안전 문제가 있는 채로 남아있다.
  IMP-12에서 UI 차원의 해소(되묻기)가 필요하다.

## IMP-12 연동에 필요한 후속 작업

1. `allergen-aliases.json.literatureBacked` 14건을 IMP-12의 "검토 완료 검색
   매칭 후보"로 바로 재사용 가능(코드 수정 없이 그대로 소비 가능).
2. `ingredient-knowledge.json.literatureBackedCandidates` 23건은 IMP-12/IMP-02에서
   "직원 질문 생성" 참고자료로 활용할 수 있으나, **위험도 자동 판정에는 여전히
   쓰면 안 된다**(스키마가 `autoApplyToRiskJudgment:false`로 강제).
3. `shellfish` 동의어 모호성 문제는 IMP-12의 UI 설계(되묻기 플로우) 요구사항으로
   명시적으로 전달한다.
4. 향후 실제 식품영양 전문가가 투입되면, 해당 행의 `reviewStatus`를
   `expert_reviewed`로, `reviewerType`을 `human_expert`로, `verifiedAt`에
   실제 날짜를 넣기만 하면 파이프라인이 자동으로 반영한다(코드 변경 불필요 —
   이미 검증 규칙이 그 조합을 요구하도록 준비되어 있음).
