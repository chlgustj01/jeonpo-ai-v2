# IMP-18C — Excel → JSON 변환 계획

> 상태: **계획안, 변환 스크립트 미구현.** `data/master/Food_Allergen_Master.xlsx`는
> 지금 존재하지만, 아직 어떤 JSON도 서비스 코드에 연동되지 않았다.

## 1. 운영 원칙 — "Excel이 원본, JSON은 산출물"

```
data/master/Food_Allergen_Master.xlsx   ← 사람이 Excel로 직접 편집(관리 원본)
            │
            │  scripts/convert-master-to-json.js (신규, 미구현)
            ▼
data/generated/*.json                   ← 자동 생성(커밋은 하되 "손으로 고치지 않음" 명시)
            │
            │  (향후) index.html <script src>, api/*.js require
            ▼
         서비스 런타임
```

같은 데이터를 Excel·JSON·JavaScript 세 군데서 각각 손으로 고치는 방식은
IMP-11에서 이미 한 번 겪은 실패 패턴(표준 목록이 파일마다 따로 존재해
drift가 생김)을 반복하는 것이므로 명시적으로 피한다. **JSON 파일 맨 위에
"이 파일은 자동 생성됩니다. Food_Allergen_Master.xlsx를 수정한 뒤
`node scripts/convert-master-to-json.js`를 다시 실행하세요" 주석을 넣어
실수로 손 편집하는 것을 예방한다.**

`shared/allergens.js`와의 관계: 당장은 `shared/allergens.js`가 여전히
서비스의 1차 소스(IMP-11에서 구축, 21종)이고, Master DB의 01_Allergens는
그 상위 확장(39종, 21 active + 18 candidate)이다. 변환기가 생성할
`data/generated/allergens.json`은 **`registryStatus==='active'`인 21종만
추출**해 `shared/allergens.js`가 기대하는 것과 동일한 shape
(`{id, legacyIds, labels, icon}`)으로 내보내야 한다 — 이렇게 하면 향후
`shared/allergens.js`를 "변환기가 생성한 정적 파일"로 교체할 수 있는
길을 열어두면서도, **지금 당장은 `shared/allergens.js`를 건드리지 않는다**
(IMP-11 테스트 22개가 그 파일의 정확한 shape에 의존하므로).

## 2. 변환 스크립트가 수행할 검증 (요청 §9 전체 반영)

| # | 검증 항목 | 구현 방식 |
|---|---|---|
| 1 | 고유 ID 중복 | 각 시트의 `id` 컬럼을 Set에 넣으며 중복 발견 시 빌드 실패(시트명+행번호 출력) |
| 2 | 존재하지 않는 관계 ID | `Ingredient_Allergens.ingredientId`가 `Ingredients.id`에, `.allergenId`가 `Allergens.id`에 실제로 존재하는지 대조(FK 무결성) — `Regulatory_Standards`/`Evidence_Sources` 참조도 동일 |
| 3 | 필수 필드 누락 | 시트별 필수 컬럼 목록을 스크립트 상단에 선언(예: 01_Allergens는 `id`,`ko`,`en`,`registryStatus`,`reviewStatus` 필수) — 공란이면 실패 |
| 4 | 다국어 명칭 누락 | `registryStatus==='active'`인 Allergens는 반드시 ko/en/ja/zh/vi/es 6개 전부 채워져야 함(기존 서비스 6개 언어 요구사항) — candidate는 당장은 권고만, 향후 active로 승격 시 강제 |
| 5 | 허용되지 않은 관계 유형 | `relationType`이 정해진 enum(6종) 밖이면 실패 — 오탈자로 새 값이 생기는 것을 방지 |
| 6 | 근거 출처 누락 | `reviewStatus==='reviewed'`인데 `evidenceId`/`evidenceRefs`가 공란이면 실패(§3 데이터 검증 정책과 동일 규칙을 코드로 강제) |
| 7 | 미확인 데이터의 잘못된 서비스 반영 | `evidenceType==='ai_estimated_general_knowledge'`인 행이 `reviewStatus==='reviewed'`로 돼 있으면 실패(모순 조합 차단) — **이것이 "AI 추정을 검증된 사실로 둔갑시키지 않는다"는 원칙의 코드적 강제** |
| 8 | 기존 21종 ID 호환성 | 생성된 `allergens.json`의 id 목록이 현재 `shared/allergens.js`의 id 목록과 **정확히 일치**하는지 diff — 하나라도 다르면 빌드 실패(의도적 변경이면 사람이 확인 후 `shared/allergens.js`도 함께 업데이트해야 함을 알리는 장치) |

## 3. 실패 시 동작

검증 실패는 **빌드를 중단**시키고(exit code 1), 어떤 시트의 몇 번째 행이
왜 실패했는지 사람이 읽을 수 있는 한국어 메시지로 출력한다. **부분적으로
유효한 JSON을 조용히 내보내지 않는다** — IMP-11의 fail-closed 철학을
데이터 빌드 단계에도 그대로 적용한다(잘못된 데이터가 섞인 산출물이
서비스에 배포되는 것보다, 빌드가 아예 실패하는 쪽이 안전하다).

## 4. 지금 하지 않는 것

- 실제 `scripts/convert-master-to-json.js` 코드 작성 — 이번 단계는 계획만.
- `index.html`/`api/analyze-menu.js`가 이 JSON을 읽도록 연결 — 사용자가
  명시적으로 금지한 범위("이번 단계에서는 실제 서비스 코드에 신규 DB를
  연동하지 않는다").
