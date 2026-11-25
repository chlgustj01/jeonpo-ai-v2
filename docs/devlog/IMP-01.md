# IMP-01 — 맵기(spicy) 결측값 및 비정상값 처리 개선

> 브랜치: `v2-dev` / 기준 커밋: `fb3f92f`(IMP-12 완료)
> `main`/원격 저장소 무변경. `shared/allergens.js`, `api/analyze-menu.js`,
> `dev-server.js`, `data/master/`, `data/generated/`, `scripts/food_knowledge/`는
> **읽기만** 했다 — 이번 작업은 클라이언트(`index.html`)의 맵기 필드
> 검증 로직 하나에만 집중했다.

---

## 1. 기존 문제 및 개발 필요성

`analyzeMenuPhotoWithAI()`(index.html, 당시 줄 3378)에 다음 코드가 실제로
있음을 확인했다(사용자가 제시한 예시와 글자 하나까지 동일):

```js
spicy: Number.isFinite(d.spicy) ? Math.max(0, Math.min(3, Math.round(d.spicy))) : 0,
```

이 한 줄이 두 가지 서로 다른 문제를 동시에 일으킨다:
1. **결측값이 확정값으로 둔갑**: `null`/`undefined`/문자열/객체/배열 등
   "유효한 숫자가 아닌 모든 것"이 전부 `0`("안 맵지 않음, 확정")으로
   바뀐다. 사용자가 맵기 허용수준을 0으로 설정했다면, "AI가 맵기를
   판단 못 한 음식"이 "AI가 안 맵다고 확인한 음식"과 똑같이 green으로
   표시된다.
2. **범위를 벗어난 값이 조용히 지어내진다**: `5`는 `3`으로, `1.7`은
   `2`로 바뀐다 — AI가 실제로 답한 적 없는 숫자가 "AI의 답"인 것처럼
   기록된다.

`checkDishSafety()`의 `dish.spicy > state.selectedSpicy` 비교도 문제다 —
`spicy`가 `null`이 되면 JS의 Type Coercion으로 `null`이 `0`으로 바뀌어
비교되므로(`null > 1` → `false`), "미확인"이 "0단계"인 것처럼 조용히
통과해버린다.

## 2. 실제 조사 대상 및 재현

확인한 실제 코드 위치(수정 전 기준):
- `analyzeMenuPhotoWithAI()` — `index.html:3378` 부근(위 코드)
- `checkDishSafety()` — `index.html:3512` 부근(`dish.spicy > state.selectedSpicy`)
- `renderMultiDishScanResult()` — `index.html:3595` 부근(`spicyTextMap['Mild','Normal','Hot 🔥','Extreme 🌶️']`, 영어 전용, 인덱스 벗어나면 `undefined`)
- `renderScanResultUI()` — `index.html:3696` 부근(`spicyTextMap[matchObj.spicy] || spicyTextMap[0]` — 실패 시 "Mild (Lvl 1)"로 **되돌아감**, 즉 두 번째 형태의 "결측→확정값" 둔갑)
- `api/analyze-menu.js` — 프롬프트는 "spicy는 0~3 정수"라고 명시하지만
  (§3 "기존 API 응답 계약" 확인 결과), 서버는 Gemini 응답을 검증 없이
  그대로 전달한다(`res.status(200).json(parsed)`, IMP-11 조사 때 이미
  확인된 사실) — **계약은 있지만 아무도 강제하지 않는다.**
- 지도 데모 데이터(`locations[].matchedFoodObj.spicy`)는 전부 사람이
  직접 입력한 깨끗한 0~3 정수였다(결측 위험 없음, 확인만 하고 변경 안 함).

**실제 재현**(`tests/imp-01-repro-before.js`, 기존 공식을 그대로 복사해 15개
입력 전수 실행):

| 입력 | 기존 출력 | 문제 |
|---|---:|---|
| 0, 1, 2, 3 | 0, 1, 2, 3 | 정상 |
| null / undefined / 필드 없음 | 0 | **결측이 "안 맵음"으로 둔갑** |
| NaN / Infinity | 0 | 〃 |
| 음수(-1) | 0 | 〃 |
| 숫자형 문자열("2") | 0 | 〃(`Number.isFinite('2')`는 `false`라서 0으로 빠짐) |
| 빈 문자열 / 객체 / 배열 | 0 | 〃 |
| 범위 초과(5) | **3** | AI가 답한 적 없는 값이 지어내짐 |
| 소수(1.7) | **2** | 〃 |

**합계 15개 입력 중 10개가 "0"으로, 2개가 "지어낸 값"으로 귀결 — 정상
처리는 3개(0,1,2,3 그대로)뿐.** 실제 Gemini API는 호출하지 않았다(재현은
순수 함수 수준에서 충분히 가능).

## 3. 맵기 데이터 검증 정책

| 입력 유형 | 판정 | 비고 |
|---|---|---|
| 정수 0~3 | **valid** | 기존 정의(0:안 매움~3:아주 매움) 그대로 |
| `null`/`undefined`/필드 없음 | **missing** | Null과 Undefined를 구분하지 않고 둘 다 "미확인"으로 통일 처리(안전 기능 입장에서 차이가 중요하지 않음) |
| 숫자가 아닌 타입(문자열/객체/배열/불리언) | **invalid_type** | 숫자형 문자열(`"2"`)도 여기 포함 — **명시적 변환 정책을 의도적으로 두지 않았다**(아래 §4 설계 원칙) |
| `NaN`/`Infinity`/`-Infinity`/소수 | **non_integer** | `Number.isInteger()` 하나로 넷 다 걸러짐 |
| 정수이지만 0~3 밖 | **out_of_range** | 클램핑하지 않음 |

**"기존 API 응답 계약에서 다른 형식을 허용하는가?"에 대한 답**:
`api/analyze-menu.js`의 프롬프트는 "정수 0~3"만 요구하고 다른 형식을
허용한다는 근거는 어디에도 없다(IMP-11에서 전체 프롬프트를 이미 확인함).
다만 **그 계약을 강제하는 코드가 없다**는 것이 실제 문제이므로, 클라이언트
쪽에서 엄격하게 검증하는 것이 정당하다.

## 4. 공통 정규화 함수 — Clamping vs 엄격한 검증

```js
function normalizeSpicy(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return { value: null, status: 'missing', raw: rawValue };
  }
  if (typeof rawValue !== 'number') {
    return { value: null, status: 'invalid_type', raw: rawValue };
  }
  if (!Number.isInteger(rawValue)) {
    return { value: null, status: 'non_integer', raw: rawValue };
  }
  if (rawValue < 0 || rawValue > 3) {
    return { value: null, status: 'out_of_range', raw: rawValue };
  }
  return { value: rawValue, status: 'valid', raw: rawValue };
}
```

사용자가 제시한 개념 예시(`if (!Number.isInteger(value)) return null;`)를
그대로 쓰지 않고 **상태(status)를 함께 반환하도록 확장**했다 — 이유:
- 개념 예시는 "유효/무효"만 구분하지만, 실제로는 "왜 무효인지"(결측인지,
  타입이 틀렸는지, 범위를 벗어났는지)를 구분해야 진단과 로깅이 가능하다.
- IMP-02가 다른 필드(알레르겐 배열, 재료 문자열 등)에도 같은 패턴을
  재사용하려면, "값"과 "근거(status)"를 분리해두는 쪽이 확장하기 쉽다.

**Clamping(`Math.max(0, Math.min(3, Math.round(v))))`) vs 엄격한 검증 —
무엇이 다른가**:

| | Clamping(기존) | 엄격한 검증(이번 선택) |
|---|---|---|
| 철학 | "어떻게든 0~3 사이 숫자로 만든다" | "0~3 정수가 아니면 모른다고 인정한다" |
| `5` 입력 시 | `3`(AI가 답한 적 없는 값) | `null` + `out_of_range`(사실 그대로 기록) |
| `null` 입력 시 | `0`(안 맵음, 확정) | `null` + `missing`(미확인, 구분됨) |
| 장점 | 코드가 절대 죽지 않고, 숫자 타입이 항상 보장됨 | "모른다"와 "확실히 안전하다"를 혼동하지 않음 |
| 단점(알레르기/안전 기능 맥락에서) | **결측을 안전값처럼 보여줘 사용자를 오도할 수 있음** | 호출부가 `null` 가능성을 직접 처리해야 함(아래 §5가 그 처리) |

이번 프로젝트는 "직관성과 안전(Safety)이 최우선"이라는 `CLAUDE.md`의
원칙과, IMP-11에서 이미 채택한 "확인 안 됨 ≠ 안전함" fail-closed 철학이
있으므로 **엄격한 검증 쪽을 선택**했다 — Clamping 자체가 틀린 선택은
아니지만(일반적인 UI 입력값 보정에는 흔히 쓰임), **알레르기/맵기처럼
"틀리면 실제로 위험할 수 있는" 데이터에는 적합하지 않다**고 판단했다.

## 5. 위험도 판정 함수 개선

```js
const spicyIsUnknown = (dish.spicy === null || dish.spicy === undefined);
if (!spicyIsUnknown && safetyState === 'green' && dish.spicy > state.selectedSpicy) {
  safetyState = 'orange';
}
if (spicyIsUnknown && safetyState === 'green') {
  safetyState = 'orange';
}
```

`null`을 **먼저 직접 검사**해 Type Coercion(`null > 숫자`가 `0 > 숫자`로
평가되는 것)에 전혀 기대지 않는다. 결과 객체에 `hasUnknownSpicy`를
추가해 IMP-12의 `hasUncertainMatch`(모호한 커스텀 알레르기)와 **같은
자리에, 같은 패턴**으로 둔다 — 둘 다 "green을 orange로 올리되 기존
RED/다른 ORANGE 사유는 덮어쓰지 않는다"는 동일한 규칙을 공유한다.

## 6. 결과 표시 UI 개선

`renderMultiDishScanResult()`와 `renderScanResultUI()`가 각자 다른
하드코딩된 영어 전용 `spicyTextMap` 배열을 쓰고 있었다 — 그러다 보니
(1) 화면 언어가 한국어 등이어도 맵기 표시만 영어로 남는 기존 버그가
있었고(`spicyMild`/`spicyNormal`/`spicyHot`/`spicyExtreme` 번역은 온보딩의
"내 맵기 설정" 버튼에만 쓰이고 있었음), (2) `null`이 들어오면 배열
인덱스가 범위를 벗어나 `undefined` 문자열이 그대로 찍히거나(멀티 요리
화면), 틀린 fallback("Mild (Lvl 1)")으로 되돌아갔다(단일 요리 화면).

`getSpicyDisplayLabel(spicyValue)` 하나로 통일하고, 기존 6개 언어
번역 블록에 `spicyUnknown` 키를 추가했다(en/ja/zh/vi/es/ko 전부). 다른
IMP-12 신규 UI 문구의 6개 언어 번역까지는 범위를 넓히지 않았다(§8 지시 그대로).

> **디자인상 의도된 부수 효과**: 단일 요리 화면(`renderScanResultUI`)의
> 맵기 문구가 기존 "Mild (Lvl 1)" 식에서 멀티 요리 화면과 같은
> "Mild"/"보통" 등으로 통일됐다 — 두 화면의 맵기 표시가 이제 일치한다
> (TC-01-16).

## 7. 테스트 결과

**Node VM**(`tests/imp-01-after.js`):

| TC | 결과 |
|---|---|
| TC-01-01~10(결측값/타입/범위/소수/문자열/객체/배열 전수) | 전부 **PASS** |
| TC-01-11(정상 맵기 초과 → ORANGE, 기존 동작 유지) | **PASS** |
| TC-01-12(미확인 → green 아님) | **PASS** |
| TC-01-13(RED + 맵기미확인 → RED 유지) | **PASS** |
| TC-01-14(교차접촉ORANGE + 맵기미확인 동시 보존) | **PASS** |
| TC-01-15(여러 음식 중 일부만 미확인 — 개별 보존) | **PASS** |
| TC-01-16(데모/AI 표시 일관성) | **PASS** |
| TC-01-17(6개 언어 전부 undefined 미노출) | **PASS** |
| TC-01-18(IMP-11 22개 재실행) | **PASS** |
| TC-01-19(IMP-12 25개 재실행) | **PASS** |
| TC-01-20(Python ETL/지식DB 31개 재실행) | **PASS** |

**합계 20개 TC 기록(18개 명명 TC + DOM 전용 2건), PASS 18 / NOT RUN 2 / FAIL 0.**
**실제 실행한 assertion은 127건**(테스트 케이스 수와 혼동하지 않도록
스크립트가 직접 계측) — 2~3회 반복 실행으로 안정성도 확인했다.

**NOT RUN(브라우저 전용)**: 실제 DOM에 "undefined" 글자가 안 보이는지,
배너의 실제 시각적 렌더링은 Node VM으로 검증 불가 — `getSpicyDisplayLabel()`의
반환 문자열 자체(TC-01-16/17)로 같은 결함을 더 안쪽 경계에서 가로막는
식으로 대신했다.

## 8. 기존 기능에 미친 영향

- 표준 알레르기/식이/커스텀 알레르기 매칭: **무변경**(IMP-11 22개, IMP-12 25개,
  Python ETL 31개 — 전부 재실행 PASS).
- 정상 맵기 값(0~3)의 위험도 판정: **동작 동일**(TC-01-11).
- 지도 데모 음식 스캔: 맵기 표시 문구가 실제 UI 언어를 따르도록 **개선**됨
  (기존엔 영어 고정).

## 9. 남은 한계 (후속 과제로 관리, 이번엔 동시 구현하지 않음)

- Shellfish 상위 분류/세부 성분 확장(IMP-12에서 이미 기록된 한계)
- IMP-12 신규 UI의 6개 언어 번역
- 실제 브라우저 DOM/E2E 테스트
- 후보 18종 성분의 활성화 정책
- Vercel 실배포 환경 검증
- **`spicyStatus`(missing/invalid_type/out_of_range/non_integer) 자체는
  지금 데이터에 저장되지만 UI에 아직 노출되지 않는다** — IMP-03의 전용
  UNKNOWN/ERROR UI가 이 필드를 그대로 가져다 쓸 수 있도록 미리 남겨둔
  것이다.
- `api/analyze-menu.js`(서버)는 여전히 Gemini 응답을 검증 없이 그대로
  통과시킨다 — 서버 측 스키마 검증은 IMP-02의 범위.

## 기술 개념 설명 (실제 코드와 연결)

| 개념 | 코드 위치 / 적용 |
|---|---|
| **Missing Value** | `rawValue === null \|\| rawValue === undefined` → `status:'missing'` |
| **Null과 Undefined** | 둘을 같은 분기에서 함께 "missing"으로 취급 — 안전 판정에 차이가 중요하지 않다고 판단 |
| **Type Validation** | `typeof rawValue !== 'number'` — `"2"`(문자열)를 숫자로 자동 인정하지 않음 |
| **Range Validation** | `rawValue < 0 \|\| rawValue > 3` |
| **Clamping** | 기존 코드(`Math.max(0, Math.min(3, ...))`)가 쓰던 방식 — §4에서 왜 이번엔 안 썼는지 비교 |
| **Type Coercion** | `checkDishSafety`의 `null > state.selectedSpicy`가 `0 > ...`로 자동 변환되는 것을 피하기 위해 `null` 직접 검사(§5) |
| **Pure Function** | `normalizeSpicy()`는 state/DOM을 전혀 건드리지 않음 — IMP-02가 다른 필드에도 같은 틀을 복사해 쓸 수 있음 |
| **Edge Case** | 입력 행렬 15종(§2) 전부가 경계 사례 — 실제 LLM 응답에서 드물지 않게 발생 |
| **Defensive Programming** | 프롬프트가 "정수 0~3"을 약속해도 서버/클라이언트 어디서도 강제하지 않는다는 사실(§3)을 전제로, 클라이언트가 스스로 방어 |

## 변경된 파일

- `index.html`: `normalizeSpicy()`/`SPICY_VALIDATION_STATUS`/`getSpicyDisplayLabel()`
  신규, `analyzeMenuPhotoWithAI()`/`checkDishSafety()`/`renderMultiDishScanResult()`/
  `renderScanResultUI()` 수정, 6개 언어 `translations`에 `spicyUnknown` 키 추가.
- `tests/imp-01-repro-before.js`(신규): 수정 전 결함 재현.
- `tests/imp-01-after.js`(신규): TC-01-01~20.
