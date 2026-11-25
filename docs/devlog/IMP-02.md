# IMP-02 — AI 응답 스키마 검증 및 데이터 정규화

## 1. 기존 문제 및 개발 필요성

IMP-01은 Gemini가 돌려주는 `dishes[]` 응답 중 `spicy`(맵기) 필드 하나만
결측/비정상 값을 안전하게 구분하도록 고쳤다. 그런데 실제 코드
(`analyzeMenuPhotoWithAI()`, 수정 전 `index.html:3447` 부근, IMP-01 완료
시점 커밋 `f3a5d51`)를 다시 읽어보면, 나머지 필드는 전부 아래처럼
"결측/오타입을 전부 안전한 기본값으로 뭉개는" 옛날 패턴이 그대로 남아있었다:

```js
ingredients: d.ingredients || '',
allergens: Array.isArray(d.allergens) ? d.allergens : [],
crossContactAllergens: Array.isArray(d.crossContactAllergens) ? d.crossContactAllergens : [],
eatingMethod: Array.isArray(d.eatingMethod) ? d.eatingMethod : [],
description: d.description || '',
culturalNote: d.culturalNote || ''
```

이 중 `allergens`가 특히 위험하다. `checkDishSafety()`는 `dish.allergens`가
빈 배열이면 "체크할 알레르겐이 없다 = 안전"으로 그대로 사용한다. 그런데
위 코드는 **"필드 자체가 없음"**, **"`null`"**, **"배열이 아니라 문자열
하나(`"egg"`)"**, **"AI가 정말로 확인했더니 알레르겐이 없음(진짜 `[]`)"**
이 네 가지를 전부 똑같은 `[]`로 만들어버린다. 즉 "확인이 안 됐다"와
"확인했더니 안전하다"가 구분되지 않는다 — IMP-11에서 확립한 fail-closed
원칙("판단 불가 ≠ 안전")을 정면으로 위반하는 지점이 `spicy` 말고도
여러 군데 남아 있었던 것이다.

서버(`api/analyze-menu.js`)는 더 심각했다 — Gemini가 반환한 JSON을
`JSON.parse()`만 하고 구조 검증 없이 그대로 돌려주고 있었다
(`res.status(200).json(parsed)`, IMP-11/IMP-01 조사 때도 이미 확인된
사실이지만 실제로 고친 적은 없었음). 검증/정규화 책임이 전부 클라이언트
한 곳에만, 그것도 불완전하게 쏠려 있었다.

## 2. 기존 코드 분석 (실제 코드 기준, 추정 아님)

아래는 이번 작업 전 실제로 읽어서 확인한 내용이다. 이전 단계 문서들의
예시 필드를 그대로 가정하지 않고, `git show f3a5d51:...`와 현재
워킹트리를 직접 열어 확인했다.

**`api/analyze-menu.js`의 Gemini 프롬프트가 요구하는 `dishes[]` 원소 스키마**
(실제 프롬프트 문자열 그대로):

| 필드 | 타입(계약상) | 필수 | 허용 범위 |
|---|---|---|---|
| `name_ko` | string | 사실상 필수(예시에만 등장, 강제 아님) | — |
| `name_en` | string | 〃 | — |
| `translated_name` | string | 〃 | — |
| `ingredients` | string(콤마 구분) | 〃 | — |
| `allergens` | string[] | "0개 이상" | `ALLOWED_ALLERGEN_IDS` 21종 중에서만 |
| `crossContactAllergens` | string[] | optional | 위와 동일 |
| `spicy` | integer | 〃 | 0~3 |
| `eatingMethod` | string[] | "2~3단계" | — |
| `description` | string | 〃 | — |
| `culturalNote` | string("" 허용) | 〃 | — |
| `dishes` (최상위) | 배열, 1~10개 | "식품을 못 찾으면 `{"dishes":[]}`" | — |

프롬프트 텍스트 자체는 이 계약을 분명히 명시한다(`"spicy" must be an
integer from 0 to 3`, `Only use allergen ids from the exact list given`
등). 그러나 **서버도 클라이언트도 이 계약을 실제로 강제하지 않았다** —
계약은 "약속"일 뿐 "검증"이 아니었다.

**수정 전 실제 처리 위치와 결측/오류 처리 방식(기존 프론트엔드 사용
위치 포함)**:

| 필드 | 기존 결측/오류 처리 | 오류 발생 시 영향 |
|---|---|---|
| `name_ko`/`name_en`/`translated_name` | `d.x \|\| 'Unknown dish'` (셋 다 없으면만 대체) | 이름이 아예 없는 요리도 "Unknown dish" 카드로 N개 생성됨(의미 없는 중복) |
| `ingredients` | `d.ingredients \|\| ''` | 숫자/객체/배열이 와도 빈 문자열로 — `spec-val-ingredients`(단일 음식 뷰)와 카드 UI에 표시 |
| `allergens` | `Array.isArray(d.allergens) ? d.allergens : []` | **`checkDishSafety()`가 "안전(green)"으로 오판할 수 있음** — IMP-11의 `unknownAllergenIds`(등록 안 된 id는 콘솔에만 남김)로도 "배열 자체가 아예 아님"은 못 잡음 |
| `crossContactAllergens` | 위와 동일 | `checkDishSafety()`의 교차오염(ORANGE) 판정에 쓰임 — 역시 같은 문제 |
| `spicy` | IMP-01이 이미 수정(`normalizeSpicy`) | (해결됨) |
| `eatingMethod` | `Array.isArray(d.eatingMethod) ? d.eatingMethod : []` | `renderMultiDishScanResult()`의 "How to Eat" 단계 — 결측 시 조용히 빈 섹션 |
| `description`/`culturalNote` | `d.x \|\| ''` | 카드/단일뷰에 `innerHTML`로 삽입(§11 XSS 감사 대상) |
| `dishes`(배열 원소) | 검증 없음 | **원소가 `null`이면 `.map()` 콜백의 `d.spicy` 접근에서 `TypeError`가 던져져 배치 전체(정상 요리 포함)가 통째로 사라짐** |

관련 함수(그대로 재사용/연동 대상으로 확인):
- `checkDishSafety()`(`index.html`, IMP-11/12/01이 이미 다룸) — `dish.allergens`/`dish.crossContactAllergens`/`dish.spicy`를 그대로 소비. 이번 단계에서 로직 자체는 **변경하지 않았다**(서버가 이미 정제된 값을 주므로).
- `resolveCustomAllergyInput()`/`allergenKB`(IMP-12) — 이번 단계는 "사용자가 입력한 자유 텍스트"가 아니라 "AI가 반환한 알레르겐 id"를 다루므로 직접 재사용 대상은 아니지만, **"완전 일치만 인정하고 유사 매칭을 하지 않는다"는 원칙은 그대로 가져왔다**(§6).
- `normalizeSpicy()`/`SPICY_VALIDATION_STATUS`(IMP-01) — 글자 그대로
  가져와 `shared/dish-schema.js`로 옮겼다(§9).
- `shared/allergens.js`의 `ALLERGEN_REGISTRY`(21종, IMP-11) — 알레르겐
  id 화이트리스트 검증의 기준 목록으로 그대로 재사용.
- `data/generated/*.json` — 이번 단계와는 직접 관련 없음(이 데이터는
  "사용자 커스텀 입력 매칭"용이지 "AI 반환 id 검증"용이 아님 — IMP-12가
  이미 구분해둔 경계를 그대로 유지).
- `tests/harness.js` — `vm` 기반 하네스를 그대로 재사용하고,
  `shared/dish-schema.js`를 `shared/allergens.js`와 같은 순서로 로드하도록
  한 줄만 추가했다(§12).

## 3. 결함 재현 (Mock, 실제 Gemini 호출 없음)

`tests/imp-02-repro-before.js`가 수정 전 `analyzeMenuPhotoWithAI()`의
`.map()` 콜백 본문을 글자 그대로 복사해 아래 4가지 결함을 실제로
재현한다(실행 결과는 §13 참고):

1. **allergens 결측/오타입이 "빈 배열(=안전 확정)"과 구분 안 됨** — 필드
   없음/`null`/`"egg"`(문자열)/`{}` 네 가지 입력이 전부 `[]`로 수렴.
2. **등록 안 된 id·대소문자 변형·중복이 전혀 걸러지지 않고 통과** —
   `["egg","EGG","Egg","not_a_real_allergen_id"]`가 그대로 4개짜리
   배열로 저장됨.
3. **`dishes[]` 원소 중 하나라도 `null`이면 배치 전체가 날아감** —
   `[정상, null, 정상]` 3개 중 `null` 하나 때문에 `.map()`이
   `TypeError`를 던지고, try/catch가 이를 삼켜 "AI 분석 실패" 토스트만
   띄운 채 정상 요리 2개까지 전부 화면에 안 보이게 됨.
4. **서버가 원본을 검증 없이 그대로 통과** — `git show HEAD:api/analyze-menu.js`로
   확인한 결과, `JSON.parse()` 다음 줄이 곧바로 `res.status(200).json(parsed)`임.

실제로 재현해야 했던 입력 유형(요청사항에서 나열한 16개 범주)은 전부
위 4가지 결함 중 하나로 수렴한다: JSON 파싱 실패/빈 응답/`dishes` 누락
또는 비배열/`dish` 원소 `null`·배열 아님/이름 없음/`ingredients`
비문자열·`null`/`allergens` 비문자열·`null`/`crossContactAllergens`
누락/미등록 id/대소문자 변형 id/중복 id/유효·미지 혼합/`spicy` 비정상
(IMP-01에서 이미 해결)/문자열·배열 크기 초과 — 이 전부를 §4~§9에서
설계한 단일 검증기로 한 번에 처리한다.

**IMP-01 devlog 교차 검증**: 요청사항에 따라 IMP-01의 "입력 15개 중 정상
처리는 3개(0,1,2,3 그대로)뿐" 서술을 `tests/imp-01-repro-before.js`의
실제 `INPUT_MATRIX`와 다시 대조했다. 실제로는 입력이 16개이고(`undefined`가
서로 다른 라벨로 두 번 등장), "0,1,2,3 그대로"는 서로 다른 값 4개이므로
"3개"가 아니라 "4개"가 맞다(10+2+4=16으로 합이 정확히 맞음). **계산
오류를 찾아 `docs/devlog/IMP-01.md`를 직접 수정하고, 수정 사실과 근거를
그 문서 안에 명시적으로 남겼다**(결론 자체는 바뀌지 않음 — 숫자만 바로잡음).

## 4. 데이터 계약 설계 (AS-IS vs TO-BE)

**AS-IS**: 서버는 Gemini 원본 JSON을 그대로 전달, 클라이언트가 필드별로
각자 다른 방식(`||`, `Array.isArray ? : []`)으로 결측을 처리 — 두 층
사이에 공유되는 규칙이 없고, 한쪽만 고치면 다른 쪽과 어긋난다.

**TO-BE**: `shared/dish-schema.js`(신규, UMD) 한 곳에 검증/정규화 규칙을
전부 모으고, 서버와 클라이언트가 **같은 모듈을 각자 불러와 쓴다**
(`shared/allergens.js`가 이미 증명한 구조를 그대로 재사용 — IMP-11에서
"같은 데이터를 두 파일에 복붙하면 불일치가 생긴다"는 교훈을 그대로
적용). 서버는 이 모듈로 **원본 Gemini 응답을 정규화**하고, 클라이언트는
같은 모듈의 더 가벼운 함수로 **서버가 이미 정규화했다고 주장하는 봉투
구조**를 한 번 더 확인한다(Defense in Depth, §10).

서버가 클라이언트에 돌려주는 최종 "봉투(envelope)" 구조:

```ts
{
  schemaVersion: '1.0.0',
  validationStatus: 'valid' | 'partial' | 'invalid' | 'empty',
  dishes: NormalizedDish[],        // 살아남은 요리만(완전 폐기된 건 빠짐)
  validationIssues: Array<{ dishIndex, field, issue, raw }>,
  rejectedDishCount: number,
}
```

`validationStatus` 네 값의 의미(전부 서로 다른 사용자 경험을 가리키므로
하나로 합치지 않는다):
- `valid` — 전부 정상.
- `partial` — 일부 dish가 완전히 버려졌거나(원소가 `null`/비객체/이름
  없음), 살아남은 dish 중 일부 필드가 `degraded`(계약을 벗어남). **그래도
  살아남은 요리는 전부 정상 렌더링한다 — "부분 응답 생존 정책".**
- `invalid` — 쓸 수 있는 dish가 단 하나도 없음(배열 자체가 없거나,
  있어도 전부 거부됨). 서버는 이 경우 502로 응답한다.
- `empty` — `dishes: []`(AI가 정말로 아무 식품도 못 찾은 **정상**
  케이스) — `invalid`와 절대 같은 값으로 두지 않는다(의미가 다름:
  "응답이 깨짐" vs "AI가 성실히 확인했는데 없음").

**부분 응답 생존 정책(dish 하나를 통째로 버리는 기준은 최소화)**: dish
원소가 (a) `null`/`undefined`이거나, (b) 객체가 아니거나(문자열/숫자/배열),
(c) `name_ko`/`name_en`/`translated_name`이 전부 없어 표시할 이름 자체를
만들 수 없을 때만 그 dish 하나를 통째로 버린다. 그 외에는(이름은 있지만
`allergens`가 문자열 하나로 왔다거나, `description`이 숫자로 왔다거나)
**필드별로 안전한 기본값으로 정규화해 생존**시키고, 무엇이 왜 깨졌는지는
`fieldStatus`/`validationIssues`에 보존한다(화면에서 숨기지만 정보 자체는
버리지 않음 — IMP-11의 `unknownAllergenIds` 패턴과 같은 철학).

## 5. 서버 측 스키마 검증 — `api/analyze-menu.js`

`JSON.parse()` 성공 직후, `validateAndNormalizeDishesResponse(parsed,
ALLOWED_ALLERGEN_IDS)`를 호출해 구조/필수 필드/타입/배열 원소 타입/허용값/
문자열·배열 크기 상한/중복/비허용 id를 전부 확인한다(`api/analyze-menu.js`
실제 변경분 참고). `validationStatus === 'invalid'`(쓸 수 있는 dish가
0개)일 때만 502로 응답하고, 그 외(`valid`/`partial`/`empty`)는 200으로
응답하되 `validationStatus`로 클라이언트가 구분하게 한다 — **HTTP 상태
코드는 "요청 처리 자체의 성공 여부"만 나타내고, "그 안 데이터의 완전성"은
응답 바디가 별도로 알려준다**는 설계를 택했다(상태 코드 하나에 두 가지
서로 다른 의미를 억지로 욱여넣지 않기 위함).

**Gemini "Structured Output"(`responseSchema`) 조사 결과**: 공식 문서
(`https://ai.google.dev/api/generate-content`의 `Schema` 리소스 설명)에
따르면 `generationConfig.responseSchema`는 "OpenAPI 3.0 schema object의
제한된 부분집합"이며, `type`/`enum`/`items`/`properties`/`required`/
`minItems`/`maxItems`/`minLength`/`maxLength`/`pattern`/`propertyOrdering`
등을 지원한다고 명시되어 있다. **다만 그 페이지에서 "이 제약이 항상
엄격하게 지켜짐을 보장한다"는 명시적 문구는 찾지 못했다** — 조사 중
참고한 보조 가이드 페이지 하나는 (레거시 `generateContent` API가 아닌
별도의 최신 "Interactions" API 문서였는데) "스키마를 지키는 것과
의미적으로 올바른 것은 별개이니 애플리케이션에서 항상 검증하라"는
취지의 안내를 하고 있었다 — 다만 이 안내가 우리가 쓰는 레거시
`generateContent`/`responseSchema` 조합에도 그대로 적용되는지는 페이지가
달라 확실히 확인하지 못했다. 이 불확실성을 숨기지 않고 그대로 남긴다.

**결정: 이번 단계에서는 `responseSchema`를 실제 프롬프트 설정에 추가하지
않았다.** 이유는 세 가지다. (1) 이 프로젝트는 실제 Gemini API 호출을
지양하고 Mock으로 검증하는 방침을 지켜왔는데, `responseSchema` 추가는
"실제 Gemini 호출 동작 자체"를 바꾸는 변경이라 이 방침 안에서는
충분히 검증할 수 없다. (2) 공식 문서에서 엄격한 보장을 확인하지 못한
이상, `responseSchema`를 추가해도 서버 측 자체 검증(`validateAndNormalizeDishesResponse`)을
생략할 근거가 되지 않는다 — 즉 추가하더라도 이번에 구현한 검증기는
그대로 필요하다. (3) 비용/지연 변화가 있는지도 문서에서 확인하지
못했다. 따라서 "지금 당장 위험을 줄여주는 게 확실하지 않은 변경을,
충분히 검증할 수 없는 상태로 실제 서비스 호출에 넣지 않는다"는 원칙에
따라 **연구만 하고 적용은 보류**했다 — 향후 phase에서 실제 Gemini
호출로 효과를 측정한 뒤 도입 여부를 다시 판단할 수 있도록 이 조사
결과를 남겨둔다.

## 6. 알레르겐 데이터 정규화 (IMP-11/12 재사용)

`normalizeAllergenIdArray()`(`shared/dish-schema.js`)는 `shared/allergens.js`의
`ALLERGEN_REGISTRY`에서 파생된 21종 id 집합을 기준으로 "정규화 후 완전
일치"만 인정한다. IMP-12가 확립한 "유사 매칭 금지" 원칙(peanut과
pinenut을 철자 유사성으로 혼동하지 않음)을 그대로 따르되, **대소문자
차이만은 예외**로 뒀다(`"EGG"` → `egg`) — 이유는 명확히 구분해 문서화한다:
IMP-12가 금지한 "유사 매칭"은 **서로 다른 개념을 추측으로 묶는 것**
(shellfish의 의미적 모호성처럼)이고, 대소문자 차이는 **완전히 같은
토큰의 표기 차이**일 뿐이라 같은 위험이 없다. 등록되지 않은 id는
버리지 않고 `allergensUnknownIds`/`crossContactAllergensUnknownIds`에
그대로 보존한다(IMP-11의 `unknownAllergenIds` 로그 패턴과 동일 철학 —
정보를 잃지 않되 화면에는 아직 안 보여줌, IMP-03 몫).

## 7. 결측/빈 배열/잘못된 타입 구분 (`FIELD_STATUS`)

`normalizeSpicy()`가 쓰던 5가지 상태(valid/missing/invalid_type/
non_integer/out_of_range) 체계를 문자열·배열 필드용으로 확장해
`FIELD_STATUS`(valid/missing/invalid_type/empty/truncated/partial)를
새로 정의했다. 요청사항이 예로 든 다섯 가지 입력이 전부 서로 다른 값으로
구분된다:

| 입력 | `allergens` 결과값 | `status` |
|---|---|---|
| 필드 자체 없음 | `[]` | `missing` |
| `null` | `[]` | `missing` |
| `"egg"`(배열 아님) | `[]` | `invalid_type` |
| `["egg","unknown_id"]` | `["egg"]` (+ `unknownIds:["unknown_id"]`) | `partial` |
| `[]`(AI가 실제로 확인) | `[]` | `empty` |

다섯 경우 모두 `checkDishSafety()`에 넘어가는 **값**은 안전한 배열이지만,
**왜 그런 값이 됐는지**는 `status`/`unknownIds`에 전부 보존되어 있다 —
"빈 배열"이라는 겉모습 하나로 다섯 가지 서로 다른 상황을 뭉개버리던
수정 전 문제가 이렇게 해소된다.

## 8. `allergens`와 `crossContactAllergens`의 분리 유지

두 필드는 같은 함수(`normalizeAllergenIdArray`)로 각각 독립적으로
정규화된다 — 같은 id가 두 필드 모두에 등장해도 서로 합쳐지거나
뭉개지지 않는다. `checkDishSafety()`는 기존처럼 직접 위험(allergens →
RED)을 교차오염(crossContactAllergens → ORANGE)보다 먼저, 그리고
우선순위 높게 확인하는 구조를 그대로 유지한다(이번 단계에서 그 판정
순서 자체는 바꾸지 않았다 — 이미 올바르게 분리되어 있었음). "AI 추정
교차오염"과 "매장이 직접 확인한 정보"를 구분하는 것은 이번 범위 밖이다
(그런 출처 구분 필드 자체가 아직 AI 응답 계약에 없음 — §14 한계 참고).

## 9. `spicy` — IMP-01 로직 재사용(이동, 재구현 아님)

`SPICY_VALIDATION_STATUS`/`normalizeSpicy()`를 `index.html`에서
`shared/dish-schema.js`로 **그대로 옮겼다**(로직 한 글자도 바꾸지
않음 — `git diff`로 두 버전을 비교하면 공백 들여쓰기 차이 외엔 동일함을
확인할 수 있다). 서버도 이제 같은 함수로 `spicy`를 검증해야 했기
때문에(이전까지 서버는 `spicy`조차 검증하지 않았다) 공용 모듈로 승격한
것이다. `index.html`은 `<script src="shared/dish-schema.js">`를
`shared/allergens.js` 바로 다음에 추가해 전역 식별자를 그대로 쓴다.

## 10. 프론트엔드 — 서버 응답 검증 + Stale 결과 방지

`analyzeMenuPhotoWithAI()`(`index.html`)를 다음 순서로 다시 작성했다:

1. `response.ok`가 아니면 실패 처리.
2. **`isValidDishResponseEnvelope(aiData)`로 서버 응답 봉투 구조를 한 번
   더 가볍게 확인**(Defense in Depth) — `schemaVersion` 일치, `dishes`가
   배열인지, `validationStatus`가 알려진 값인지, 각 dish의 핵심 필드
   타입이 맞는지. 이 함수는 `validateAndNormalizeDishesResponse()`를
   다시 통째로 돌리지 않는다 — 이미 정규화된 데이터를 그 무거운 함수에
   다시 넣으면 `spicyStatus` 같은 "원래 사유" 진단 정보가 재계산 과정에서
   덮어써질 수 있기 때문에, 구조만 얕게 재확인하는 별도의 가벼운 함수로
   분리했다.
3. `validationStatus`가 `empty`/`invalid`(또는 `dishes.length === 0`)면
   "결과 없음"으로 처리.
4. `partial`이어도 살아남은 dish는 전부 그대로 렌더링(서버가 이미 전
   필드를 정규화해 내려주므로, 기존처럼 `Array.isArray(...) ? ... : []`를
   클라이언트에서 또 반복할 필요가 없어졌다 — 그 반복 자체가 원래 결함의
   원인이었다).

**Stale 결과 방지(§10 지시 반영)**: 기존 코드는 실패 분기에서 토스트만
띄우고 `return`했는데, 그 시점에 화면(`scan-result-pane`)에는 **직전에
성공한 스캔 결과**가 이미 떠 있을 수 있다(예: 언어를 바꿔 재분석을
트리거했는데 그 재분석만 실패한 경우, `index.html:2530` 부근의 기존
로직). 사용자가 오래된 결과를 "방금 스캔한 결과"로 착각할 수 있는
실제 버그였다. `clearStaleScanResult()`를 새로 만들어 모든 실패
분기(응답 실패/봉투 검증 실패/결과 없음/예외)에서 `scan-result-pane`을
숨기고 `state.hasScannedResult`를 `false`로 되돌리도록 통일했다.

## 11. XSS 감사 및 수정 (`escapeHtml`)

`renderMultiDishScanResult()`와 `renderScanResultUI()`를 전수 감사해,
AI(또는 데모 데이터)가 생성한 텍스트가 `innerHTML` 템플릿 리터럴에
그대로 꽂히는 지점을 모두 찾았다: 음식 이름(2곳), 설명, 먹는 법 단계,
문화 노트, 데모 전용 `vision-elements-list` 항목 이름/확률. 전부
`escapeHtml()`(신규, `&<>"'`를 문자 엔티티로 치환)로 감쌌다. 레이아웃을
감싸는 주변 HTML(class, 중첩 div 등)까지 DOM API로 재조립하는 대신
"텍스트가 꽂히는 자리만 치환"하는 최소 변경을 택한 이유: 변경 범위를
작게 유지하면서도, `<script>`/`onerror=`/`onload=` 같은 문자열이 메뉴판
사진에서 읽혀도 HTML로 해석되지 않고 화면에 글자 그대로 보이게 하는
목적은 동일하게 달성하기 때문이다. `document.getElementById(...).innerText
= ...`로 이미 안전하게 처리되던 지점(예: `spec-val-name`)은 그대로 뒀다.

## 12. 모듈 책임 분리

```
Gemini 호출(api/analyze-menu.js)
  → JSON.parse
    → validateAndNormalizeDishesResponse()  [shared/dish-schema.js]
      → validateAndNormalizeDish() (dish별)
        → normalizeStringField / normalizeStringArrayField
        → normalizeAllergenIdArray (화이트리스트 = shared/allergens.js)
        → normalizeSpicy (IMP-01 그대로)
      → 봉투 조립(schemaVersion/validationStatus/validationIssues)
  → res.status(200/502).json(봉투)

index.html: fetch
  → isValidDishResponseEnvelope()  [shared/dish-schema.js, 같은 모듈 재사용]
  → checkDishSafety() (IMP-11/12/01, 변경 없음 — 이미 정제된 값을 받음)
  → renderMultiDishScanResult() → escapeHtml()로 안전하게 DOM 삽입
```

검증 규칙은 `shared/dish-schema.js` **한 곳**에만 존재한다 — 서버와
클라이언트가 서로 다른 규칙을 따로 구현해 나중에 어긋나는 일(이번
단계의 출발점이 된 `shared/allergens.js` 신설 사례와 같은 종류의
문제)을 구조적으로 막는다. `data/generated/*.json`(IMP-18D-2 지식 DB
연동 후보)과의 연결은 이번 범위에 넣지 않았지만, `validationIssues`/
`fieldStatus`/`allergensUnknownIds`가 이미 "무엇이, 왜 불확실한지"를
구조화된 형태로 들고 있으므로 향후 그 작업이 이 데이터를 그대로
가져다 쓸 수 있다.

## 13. 테스트 결과

**`tests/imp-02-repro-before.js`**(수정 전 결함 재현, 전부 재현 성공 —
출력 전문은 터미널 로그 참고): 결함 1(allergens 결측→빈 배열 혼동),
결함 2(미등록/대소문자/중복 무검증 통과), 결함 3(`null` 원소 1개 때문에
배치 전체가 예외로 날아감), 결함 4(서버 무검증 확인).

**`tests/imp-02-after.js`**(Node `vm` 기반, `tests/harness.js` 그대로
재사용 + `api/analyze-menu.js`는 `global.fetch`만 Mock해 직접 호출):

| 구간 | 내용 | 결과 |
|---|---|---|
| TC-02-01~17 | `shared/dish-schema.js` 순수 함수(문자열/배열/알레르겐 필드 정규화) 단위 테스트 | 전부 **PASS** |
| TC-02-18~28 | `validateAndNormalizeDish`/`validateAndNormalizeDishesResponse`/`isValidDishResponseEnvelope`(거부 기준, 부분 생존, 봉투 검증) | 전부 **PASS** |
| TC-02-29~31 | `api/analyze-menu.js` 핸들러 직접 호출(Mock Gemini 응답) — null 원소 혼합/정상 빈 응답/완전 오형식 | 전부 **PASS** |
| TC-02-32~34 | `index.html` 통합 — partial 봉투 렌더링, **stale 결과 방지**, 봉투 구조 위반 시 방어 | 전부 **PASS** |
| TC-02-35~36 | `escapeHtml` 치환 확인, 악성 문자열 포함 dish로 렌더 함수 예외 없이 완료 | 전부 **PASS** |
| TC-02-37 | 실제 브라우저에서 악성 문자열이 글자 그대로 보이는지(렌더링 결과 시각 확인) | **NOT RUN** — harness의 `document` stub은 `innerHTML`을 실제로 파싱하지 않는 더미 문자열 저장소라 브라우저 없이는 확인 불가 |
| TC-02-38 | 실제 Gemini API로 부분 손상된 메뉴판 사진 스캔 | **NOT RUN** — 요청사항에 따라 실제 호출 지양, Mock으로 서버/클라이언트 로직은 이미 검증 |
| TC-02-39~41 | IMP-11(22개)/IMP-12(25개)/IMP-01(20개, 127 assertions) 회귀 재실행 | 전부 **PASS** |

**명명된 테스트 케이스 41건 — PASS 39 / NOT RUN 2 / FAIL 0.** 실행된
assertion 총 개수는 92건(테스트 케이스 수와 별개로 스크립트가 직접
계측, `node tests/imp-02-after.js` 실행 결과 그대로).

## 14. 기존 기능에 미친 영향

- 표준 알레르기/식이/커스텀 알레르기 매칭, 맵기 판정: **무변경**
  (IMP-11 22개/IMP-12 25개/IMP-01 20개 전부 재실행 PASS, §13).
- `checkDishSafety()`/`renderMultiDishScanResult()`/`renderScanResultUI()`의
  판정 로직 자체: **무변경**(입력 데이터가 더 정제되어 들어올 뿐, 판정
  규칙은 그대로).
- 정상적인 AI 스캔 결과(모든 필드가 계약대로 옴): **동작 동일** — 서버가
  반환하는 `dishes[]` 각 필드명/타입이 클라이언트가 기존에 기대하던
  모양과 같도록 설계했다(`foodId`/`name`/`nameKo`/`ingredients`/
  `allergens`/`crossContactAllergens`/`spicy`/`spicyStatus`/`eatingMethod`/
  `description`/`culturalNote`).
- **개선**: (1) 메뉴판 사진 하나에서 일부 요리 인식만 깨져도 나머지는
  이제 화면에 보인다(부분 응답 생존). (2) 재분석 실패 시 오래된 결과가
  "현재 결과"처럼 남지 않는다. (3) AI가 반환한 텍스트에 HTML 특수문자가
  섞여도 더 이상 그대로 파싱되지 않는다.

## 15. 남은 한계 (후속 과제로 관리, 이번엔 동시 구현하지 않음)

- `validationIssues`/`fieldStatus`/`allergensUnknownIds` 등 진단 정보는
  지금 데이터에 전부 저장되지만, UI에는 아직 노출되지 않는다 — IMP-03의
  전용 UNKNOWN/ERROR UI가 이 필드를 그대로 가져다 쓸 수 있도록 미리
  남겨둔 것이다(IMP-01 devlog가 `spicyStatus`에 대해 남긴 것과 같은 메모).
- `responseSchema`(Gemini Structured Output) 실적용 여부는 조사만
  하고 보류했다(§5) — 실제 Gemini 호출로 효과를 측정해야 하는 후속 과제.
- 실제 브라우저 DOM에서 XSS 방어가 시각적으로도 올바른지(TC-02-37),
  실제 Gemini API로 부분 손상된 사진을 스캔했을 때의 체감 UX(TC-02-38)는
  이번에 검증하지 못했다.
- `data/generated/*.json`(IMP-18D-2 지식 DB) 기반 위험도 추론은 이번
  범위 밖이다(§14 지시대로 설계 훅만 남김 — `validationIssues` 구조가
  그 역할을 할 수 있음).
- 후보 18종 알레르겐 성분의 활성화 정책, Vercel 실배포 환경 검증,
  이미지/번역 책임 분리, 캐싱/재시도, React/TypeScript 전환, 리뷰 DB
  연동은 전부 이전 단계와 동일하게 이번 범위 밖이다.

## 기술 개념 설명 (초급 개발자를 위해, 실제 코드와 연결)

| 개념 | 코드 위치 / 적용 |
|---|---|
| **Data Contract(데이터 계약)** | `shared/dish-schema.js`의 봉투 구조(`schemaVersion`/`validationStatus`/`dishes`/`validationIssues`) — "서버와 클라이언트가 서로 무엇을 주고받기로 약속했는가"를 코드로 고정한 것 |
| **Schema Validation(스키마 검증)** | `validateAndNormalizeDish()`가 각 필드의 타입/범위/허용값을 하나씩 확인하는 전체 과정 |
| **Structured Output** | Gemini의 `responseSchema` 기능(§5) — 조사는 했지만 이번엔 미적용, 이유를 문서에 명시 |
| **JSON Parsing** | `api/analyze-menu.js`의 `JSON.parse(content)` — "글자가 JSON 문법에 맞는가"만 확인하고, "그 JSON의 내용이 우리가 기대하는 모양인가"는 별개 단계(바로 다음의 스키마 검증)임을 구분 |
| **Data Normalization(데이터 정규화)** | `normalizeStringField`/`normalizeStringArrayField`/`normalizeAllergenIdArray` — 다양한 형태의 "깨진 입력"을 일관된 모양(안전한 값 + 상태)으로 변환 |
| **Type Validation(타입 검증)** | `typeof rawValue !== 'string'`, `!Array.isArray(rawValue)` 등 — 값의 "종류"부터 확인 |
| **Whitelist Validation(화이트리스트 검증)** | `normalizeAllergenIdArray`의 `allowedIdSet.has(normalized)` — "알려진 값만 허용", 모르는 값은 버리지 않고 `unknownIds`에 보존 |
| **Defense in Depth(심층 방어)** | 서버가 이미 검증했어도 클라이언트가 `isValidDishResponseEnvelope()`로 봉투 구조를 한 번 더 확인(§10) — 한 층이 뚫려도 다음 층이 막음 |
| **Input Sanitization(입력 정제) / XSS(Cross-Site Scripting)** | `escapeHtml()`(§11) — 신뢰할 수 없는 출처(AI)의 텍스트가 HTML로 잘못 해석되는 것을 막음 |
| **Separation of Concerns(관심사 분리)** | AI 호출 → JSON 파싱 → 스키마 검증 → 정규화 → id 매핑(화이트리스트) → 렌더링까지, 각 단계가 서로 다른 함수/파일로 분리(§12 다이어그램) |
| **Backward Compatibility(하위 호환성)** | `normalizeSpicy()`를 옮기면서도 반환값 구조(`{value, status, raw}`)를 그대로 유지해 IMP-01의 회귀 테스트 20개가 수정 없이 그대로 통과함(§13) |

## 변경된 파일

- `shared/dish-schema.js` — **신규**. 서버·클라이언트 공용 AI 응답 검증/정규화 모듈(UMD).
- `api/analyze-menu.js` — Gemini 원본 응답을 `validateAndNormalizeDishesResponse()`로
  검증/정규화한 뒤 봉투 형태로 응답하도록 변경.
- `index.html` — `<script src="shared/dish-schema.js">` 추가, 로컬
  `SPICY_VALIDATION_STATUS`/`normalizeSpicy()`/`slugifyFoodName()` 제거(공용
  모듈로 이동/대체), `analyzeMenuPhotoWithAI()` 재작성(봉투 검증 +
  stale 결과 방지), `escapeHtml()` 신규 + `renderMultiDishScanResult()`/
  `renderScanResultUI()`의 `innerHTML` 삽입 지점 전체에 적용.
- `tests/harness.js` — `shared/dish-schema.js`를 실제 `<head>`와 같은
  순서로 로드하는 로직 추가.
- `tests/imp-02-repro-before.js` — **신규**. 수정 전 결함 4건 재현.
- `tests/imp-02-after.js` — **신규**. TC-02-01~41(명명 41건, PASS 39/NOT RUN 2/FAIL 0, assertion 92건).
- `docs/devlog/IMP-01.md` — §2의 입력 개수/정상 처리 개수 계산 오류를
  발견해 수정하고, 수정 사실을 문서 안에 명시(§3 참고).
- `docs/devlog/IMP-02.md` — 본 문서(신규).
