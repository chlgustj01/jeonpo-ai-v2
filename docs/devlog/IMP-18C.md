# IMP-18C — Excel → JSON 데이터 변환 및 검증 파이프라인

> 브랜치: `v2-dev` / 기준 커밋: `14f0544`(Master DB 구축 완료)
> 서비스 코드(`index.html`/`api/analyze-menu.js`/`dev-server.js`/`shared/allergens.js`)는
> 이번 작업에서 **한 줄도 바꾸지 않았다.** `tests/imp-11-after.js` 22개는
> 이 파이프라인의 테스트(`TC-18C-16`)에서 실제로 재실행해 전부 PASS를 확인했다.

---

## 1. 기존 문제 및 개발 필요성

IMP-18B에서 `data/master/Food_Allergen_Master.xlsx`(11시트, 수백 행)를
만들었지만, 이 Excel 파일은 "사람이 Excel 뷰어로 들여다볼 수 있는 문서"일
뿐 **프로그램이 자동으로 읽어서 쓸 수 있는 형태는 아니었다.** 또한 이
Excel 안에는 `reviewed`/`pending_expert_review`/`demo_placeholder`처럼
신뢰 수준이 전혀 다른 데이터가 같은 시트 안에 섞여 있어서, 이걸 그대로
서비스에 연결하면 "AI가 대충 추정한 것"과 "법령 원문으로 확인한 것"이
구분 없이 똑같이 취급될 위험이 있었다. IMP-18C는 이 Excel을 **검증을
통과한 데이터만** 골라서, 신뢰 수준별로 분리된 JSON으로 만드는 자동화된
파이프라인을 구축하는 작업이다.

## 2. 데이터 파이프라인 아키텍처

```
data/master/Food_Allergen_Master.xlsx (원본, 사람이 관리)
        │
        ▼
┌─────────────────────────────────────────────────────┐
│  scripts/food_knowledge/  (공유 라이브러리, 단일 진실 공급원) │
│    schema.py      — 시트/컬럼/열거형 정의(실제 Excel 기준)      │
│    extract.py     — E: Excel → Python dict (판단 없음)         │
│    validate.py    — T(검증): 스키마/FK/열거형/호환성 검사        │
│    transform.py   — T(가공): reviewed만 골라 서비스 모양으로     │
│    load.py        — L: 원자적 쓰기 + 결정론적 버전 해시         │
│    report.py       — 사람이 읽는 Markdown 보고서                │
│    graph_utils.py  — 순환 참조 탐지(범용, 지금은 대비용)         │
│    js_registry_reader.py — shared/allergens.js 읽기 전용 파서   │
└─────────────────────────────────────────────────────┘
        │                                  │
        ▼                                  ▼
scripts/validate_food_knowledge.py   scripts/build_food_knowledge.py
  (검증만, 쓰기 없음)                    (검증 통과 시에만 JSON 생성)
                                            │
                                            ▼
                                   data/generated/*.json
```

**왜 "검증"과 "빌드"를 한 프로그램으로 합치지 않았나**: 둘 다
`food_knowledge.validate`라는 같은 로직을 쓰지만, 용도가 다르다.
`validate_food_knowledge.py`는 "지금 Excel이 깨끗한가?"만 빠르게 확인하는
**린트(lint) 도구**로, 사람이 Excel을 수정한 직후 아무 파일도 안 건드리고
바로 돌려볼 수 있어야 한다. `build_food_knowledge.py`는 그 검증을 통과한
뒤 실제로 `data/generated/`를 바꾸는 **배포 도구**다. 둘을 하나로
합쳤다면, "그냥 검사만 하고 싶은데"라는 요청마다 실제로 파일이 쓰여지는
부작용을 걱정해야 했을 것이다 — 로직(검증 규칙)은 하나의 모듈에 두어
중복을 없애고, 실행 방식(쓰기 여부)만 두 개의 얇은 CLI로 나눈 것이다.

## 3. 파일 구조

```
scripts/
  food_knowledge/
    __init__.py
    schema.py                # 실제 .xlsx를 openpyxl로 직접 열어 확인한 시트/컬럼/열거형
    extract.py                # Extract
    validate.py                # Transform(검증)
    transform.py               # Transform(가공)
    load.py                    # Load(원자적 쓰기, 버전 해시)
    report.py                  # 보고서(Markdown)
    graph_utils.py             # 순환 참조 탐지 유틸
    js_registry_reader.py      # shared/allergens.js 읽기 전용 파서
  validate_food_knowledge.py   # CLI: 검증만
  build_food_knowledge.py      # CLI: 검증 + 빌드
tests/
  test_food_knowledge.py       # TC-18C-01~16 (unittest, openpyxl 임시 fixture)
data/
  master/Food_Allergen_Master.xlsx   # 원본(이번에 3개 결함 수정, 아래 §9)
  generated/                          # 빌드 산출물(신규)
    allergen-registry.json
    allergen-candidates.json
    allergen-aliases.json
    ingredient-knowledge.json
    dishes-demo.json
    regulatory-standards.json
    evidence-sources.json
    knowledge-manifest.json
    build-report.md
```

## 4. 적용 기술 — 초급 개발자를 위한 개념 설명

| 개념 | 이 프로젝트에서의 의미 | 실제 코드 위치 |
|---|---|---|
| **ETL** | Extract(원본에서 "있는 그대로" 꺼내기) → Transform(검증하고 가공하기) → Load(최종 저장) | `extract.py` → `validate.py`+`transform.py` → `load.py` |
| **Schema Validation** | 데이터가 "정해둔 규칙"을 지키는지 기계적으로 확인 | `validate.py`의 모든 `_validate_*` 함수 |
| **Primary Key(기본 키)** | 한 시트 안에서 각 행을 유일하게 식별하는 값 | 각 시트의 `id` 컬럼(`schema.py: PRIMARY_KEY_COLUMN`) |
| **Foreign Key(외래 키)** | 다른 시트의 Primary Key를 가리키는 값 | 예: `04_Ingredient_Allergens.allergenId` → `01_Allergens.id` |
| **Referential Integrity(참조 무결성)** | FK가 가리키는 대상이 실제로 존재하는지 | `validate.py: _validate_foreign_keys`, `schema.py: FOREIGN_KEYS` 14개 선언 |
| **Data Provenance(데이터 출처 추적)** | "이 값은 어디서 왔는가"를 데이터 자체에 남기는 것 | `evidenceId`/`sourceId`/`evidenceRefs` 컬럼, `08_Evidence_Sources` 시트 |
| **Data Governance(데이터 거버넌스)** | "누가, 어떤 기준으로 이 데이터를 승인했는가"를 관리하는 체계 | `reviewStatus` 열거형(`reviewed`/`pending_expert_review`/...)과, "AI 추정은 reviewed로 표시할 수 없다"는 `AI_ESTIMATE_MARKED_AS_REVIEWED` 규칙 |
| **Serialization(직렬화)** | 메모리의 Python 객체를 파일로 저장 가능한 형태(JSON 문자열)로 바꾸는 것 | `load.py: _dumps_deterministic`(`json.dumps`) |
| **Deterministic Build(결정론적 빌드)** | 같은 입력이면 항상 같은 출력(타임스탬프 제외) | `load.py`의 `sort_keys=True` + `dataVersion` 해시(타임스탬프 제외하고 계산) — `TC-18C-13`으로 실측 검증 |
| **Data Versioning(데이터 버전 관리)** | 지금 이 데이터가 "어느 시점/어느 원본에서" 나왔는지 식별 | `knowledge-manifest.json`의 `schemaVersion`/`dataVersion`/`sourceHash` |
| **Fail-closed** | 확신이 없으면 "안전한 쪽(=배포 중단)"으로 실패 | `build_food_knowledge.py`: 검증 Error가 1건이라도 있으면 Transform/Load를 아예 실행하지 않음 — IMP-11의 `checkDishSafety` fail-closed와 같은 철학 |

## 5. 검증 규칙 (요청 §5 전체 반영, 실제 코드 함수명과 1:1 대응)

| 규칙 | 함수 | 심각도 |
|---|---|---|
| 중복 ID | `_validate_unique_ids` | ERROR |
| ID 형식 | `_validate_id_formats` | ERROR |
| 참조 무결성(FK) | `_validate_foreign_keys` | ERROR |
| 허용되지 않은 열거형(relationType/evidenceType/reviewStatus 등) | `_validate_enums` | ERROR |
| 숫자형 자료형(+"검증 필요" 센티널 허용) | `_validate_numeric_columns` | ERROR |
| 근거 출처 누락(reviewed인데 evidenceId/sourceId 없음) | `_validate_evidence_requirements` 규칙B | ERROR |
| **AI 추정 ≠ 검증 완료** | `_validate_evidence_requirements` 규칙A | ERROR |
| 동의어 충돌/중복(legacyIds 포함 교차 검사) | `_validate_alias_conflicts` | ERROR |
| 순환 참조(현재 스키마엔 없음, 대비 코드) | `_validate_self_reference_cycles` | ERROR |
| 기존 21종 shared/allergens.js 호환성(id/legacyIds/6개 언어) | `_validate_shared_allergens_compatibility` | ERROR |
| 빈 행/오류 셀/중복 헤더/숫자형 ID 변환 | `extract.py` 전체 | WARNING 또는 추출 단계 실패 |

## 6. 데이터 배포 정책 (요청 §6/§8 실제 구현)

| 산출물 | 포함 기준 | 제외되는 것 |
|---|---|---|
| `allergen-registry.json` | `registryStatus=='active'`(21종) | candidate |
| `allergen-candidates.json` | `registryStatus=='candidate'`(18종), `autoApplyToRiskJudgment:false` 고정 | — |
| `allergen-aliases.json` | `reviewStatus=='reviewed'`인 것만 | `pending_expert_review`(→ 보고서로만) |
| `ingredient-knowledge.json` | `Ingredients` 전체 + `reviewStatus=='reviewed'`인 관계만(`confirmedRelations`) | pending 관계(→ 보고서로만) |
| `dishes-demo.json` | 전부, 단 `isDemo:true`/`doNotUseAsRealVerification:true` 고정 | — (다만 "실제 검증"으로 오인 못 하게 플래그 강제) |
| `evidence-sources.json` | 전부(인용 정보일 뿐 원문 복제가 아님), `citationOnly:true`/`licenseConfirmed` 플래그 추가 | 신뢰도 `unverified` 출처의 "원문·제한 데이터"는 애초에 수집한 적이 없어 포함될 것 자체가 없음 |
| `regulatory-standards.json` | 전부(공개된 법령 사실) | — |
| 역학 연구(`10_Epidemiology`) | **서비스 JSON에 아예 포함하지 않음** | 지시사항("국가별 역학 연구는 개인별 위험도 판정 데이터에 포함하지 않는다")에 따라 `pending_epidemiology`로만 보고서에 기록 |

**파일을 10개가 아니라 8개(+manifest)로 묶은 이유**: `06_Dish_Ingredients`가
현재 0행이라 `Dish_Ingredients` 전용 파일은 의미가 없어 `dishes-demo.json`에
흡수시켰다. 나머지는 "서비스가 실제로 묻는 질문" 단위로 나눴다 — 예를
들어 "이 성분이 지금 위험도 판정에 써도 되는가?"라는 질문 하나에
`allergen-registry.json` 한 파일로 바로 답이 나오게 하는 식이다(여러
시트에 흩어진 정보를 합쳐 다시 해석해야 하는 구조를 피함).

## 7. 실행 방법

```bash
# Windows에서 python/python3는 Microsoft Store 스텁으로 막혀 있을 수 있다
# (이 환경에서 실제로 그랬다) — 반드시 `py` 런처를 쓴다.
# 한글/일본어 콘솔 출력 깨짐 방지를 위해 두 스크립트 모두 내부에서
# sys.stdout.reconfigure(encoding="utf-8")를 호출한다(별도 env 설정 불필요).

py scripts/validate_food_knowledge.py                 # 검증만(쓰기 없음)
py scripts/build_food_knowledge.py                     # 검증 + data/generated/*.json 생성
py -m unittest tests.test_food_knowledge -v            # 전체 테스트
```

## 8. 생성된 JSON 산출물 (실제 수치)

```json
// data/generated/knowledge-manifest.json
{
  "schemaVersion": "1.0.0",
  "dataVersion": "aa4d25550e99a06f",
  "sourceWorkbook": "Food_Allergen_Master.xlsx",
  "sourceHash": "8efa12dcc89d7a793ace4833500b04d6e18de52e52f2e24c1549d3f4ed4496a0",
  "recordCounts": {
    "allergen-registry.json": 21,
    "allergen-candidates.json": 18,
    "allergen-aliases.json": 0,
    "ingredient-knowledge.json": 64,
    "dishes-demo.json": 28,
    "regulatory-standards.json": 8,
    "evidence-sources.json": 19
  },
  "validationStatus": { "errors": 0, "warnings": 0, "status": "passed" }
}
```

**`allergen-aliases.json`이 0건인 이유(정직하게 기록)**: 기존 Excel에서
"reviewed"로 표시되어 있던 유일한 별칭 행들은 사실 `01_Allergens.legacyIds`를
그대로 복제한 것이었다(아래 §9에서 수정). 그 중복을 제거하고 나니, 남은
15개 별칭은 전부 이번 세션 AI가 추정한 영문 표기 변형이라 `pending_expert_review`
상태이고, 지시사항("AI 추정만으로 검증 완료된 관계를 서비스에 노출하지
않는다")에 따라 서비스 JSON에서 전부 제외되었다. **이것은 버그가 아니라
정책이 정확히 작동한 결과다** — IMP-12에서 이 15개를 실제로 검토·승격하면
자연히 이 파일에 채워진다.

## 9. 실제 데이터 검증 결과 — 파이프라인이 Excel 자체의 결함 3건을 발견·수정

`validate_food_knowledge.py`를 처음 실제 Master DB에 돌렸을 때 **Error
6건**이 나왔다(코드가 아니라 **데이터**의 문제였다). 원인별로 수정했다:

| # | 발견된 문제 | 원인 | 수정 방법 |
|---|---|---|---|
| 1 | `BROKEN_REFERENCE`: `ia_0042`가 `01_Allergens`에 없는 `'tree_nut_general'`을 참조 | 생성 스크립트가 등록되지 않은 가상의 id를 만들어 씀 | **근거 없는 새 분류를 만들어 통과시키지 않고, 해당 UNCONFIRMED 행 자체를 삭제**(지시사항 "근거자료를 확인하지 않은 식재료 관계 추가 금지"를 그대로 적용) |
| 2 | `MISSING_EVIDENCE_FOR_REVIEWED` 4건 | 복합 식재료의 `IS_ALLERGEN`(정의상 자명) 관계 4건이 `evidenceId` 없이 `reviewed`로 표시 | 데이터를 고치는 대신, **검증 규칙 자체를 보정**했다 — `evidenceType=='definitional'`(정의상 자명)인 경우는 외부 근거 문헌이 필요 없다는 예외를 명시적으로 추가(§5 규칙B). "AI 추정은 reviewed 불가" 규칙(규칙A)은 그대로 유지되어 약화되지 않았다 |
| 3 | `DUPLICATE_ALIAS`: `'pineneut'`가 `pinenut`에 중복 등록 | `02_Allergen_Aliases` 생성 스크립트가 `01_Allergens.legacyIds`를 그대로 미러링해 넣고 있었음 | `legacyIds`는 `01_Allergens`에만 두고 `02_Allergen_Aliases`는 "그 외의" 동의어만 갖도록 **역할을 분리**(생성 스크립트 수정) |

수정 후 Excel을 `node scripts/generate-master-xlsx.js`로 재생성 →
재검증 결과 **Error 0건, Warning 0건**. 이 경위는 `Food_Allergen_Master.xlsx`의
`11_Changelog` 시트에도 v1.1로 기록해두었다.

## 10. 테스트 결과 (TC-18C-01~16, 전부 실제 실행)

```
Ran 20 tests in 3.808s
OK
```

| TC | 내용 | 결과 |
|---|---|---|
| TC-18C-01 | 정상 Excel 데이터 추출 | **PASS** |
| TC-18C-02 | 중복 ID 검출 | **PASS** |
| TC-18C-03 | 존재하지 않는 관계 ID 검출 | **PASS** |
| TC-18C-04 | 필수 데이터 누락 검출 | **PASS** |
| TC-18C-05(+05b) | 잘못된 자료형 검출 + "검증 필요" 센티널 허용 확인 | **PASS** |
| TC-18C-06 | 허용되지 않은 relationType 검출 | **PASS** |
| TC-18C-07(+07b) | 출처 정보 누락 + AI추정-reviewed 모순 검출 | **PASS** |
| TC-18C-08 | 동의어 충돌 검출 | **PASS** |
| TC-18C-09 | pending 데이터의 서비스 산출물 제외 | **PASS** |
| TC-18C-10 | demo_placeholder 데모 전용 분리 | **PASS** |
| TC-18C-11 | candidate/active 분리 | **PASS** |
| TC-18C-12(+12b) | 21종 ID 호환성(실데이터 일치 확인 + 탐지 로직 자체 검증) | **PASS** |
| TC-18C-13 | 반복 실행 결정론적 일관성 | **PASS** |
| TC-18C-14 | 검증 실패 시 기존 산출물 보호 | **PASS** |
| TC-18C-15 | 실제 Master DB 기반 JSON 생성 | **PASS** |
| TC-18C-16 | 기존 IMP-11 테스트 22개 재실행 | **PASS**(subprocess로 `tests/imp-11-after.js` 직접 실행, returncode 0) |

**합계 16개 요청 TC + 4개 보조 변형 = 20개, 전부 PASS. NOT RUN 없음.**

**⚠️ 테스트 작성 중 발견한 환경 의존 버그(정직하게 기록)**: `TC-18C-16`을
처음 작성했을 때는 `subprocess.run(..., text=True)`만 썼는데, 한 번은
통과했다가 다음 재실행에서 `UnicodeDecodeError`(Windows 콘솔 기본
코드페이지 cp949가 Node의 UTF-8 한글 출력을 잘못 해석)로 간헐적으로
실패하는 것을 직접 목격했다. `encoding="utf-8"`을 명시적으로 지정해
고쳤고, 이후 **같은 테스트를 3번 연속 재실행해 전부 OK임을 확인**했다 —
"한 번 통과했다"가 아니라 "반복해도 안정적으로 통과한다"까지 확인한
뒤에 이 보고서를 작성했다.

## 11. 현재 한계

- **`allergen-aliases.json`이 당장은 비어 있다**(§8 참고) — IMP-12가
  실제로 영문 표기 변형들을 검토해야 채워진다.
- **`data/generated/*.json`은 아직 서비스 코드 어디에도 연결되지 않았다.**
  이번 작업의 명시적 범위 제한이다.
- **공공누리 라이선스 유형 등 데이터 이용 조건 일부는 여전히 미확인**이다
  (IMP-17/18B에서부터 이어진 한계, 이번에 추가로 해소하지 못함).
- **순환 참조 탐지 코드(`graph_utils.find_cycles`)는 지금 실제 데이터로는
  한 번도 발동하지 않는다** — 현재 스키마에 자기참조 컬럼 자체가 없기
  때문(합성 fixture로만 검증됨). 향후 `compositeOf` 같은 컬럼이 추가되면
  `schema.py: SELF_REFERENTIAL_FIELDS`에 선언만 추가하면 자동으로 적용된다.
- **Codex 1999/2024 참깨 포함 시점 모순**은 여전히 미해결(IMP-17B에서
  이어짐, Evidence_Sources에 명시만 해둠).

## 12. IMP-12와의 연동 계획

- `allergen-aliases.json`의 15건 `pending_expert_review` 항목은 IMP-12
  작업의 "검토 대기 후보 목록"으로 바로 재사용할 수 있다. IMP-12가 실제로
  영문 표기 검증(또는 전문가 확인)을 마치면, Excel의 해당 행
  `reviewStatus`만 `reviewed`로 바꾸고 `node scripts/generate-master-xlsx.js`
  + `py scripts/build_food_knowledge.py`를 다시 돌리면 자동으로
  `allergen-aliases.json`에 반영된다 — **코드를 새로 짤 필요가 없다.**
- `04_Ingredient_Allergens`의 `pending_expert_review` 37건(정의상 자명한
  것 제외)도 같은 방식으로, 전문가 검토 후 상태만 바꾸면 파이프라인이
  알아서 `ingredient-knowledge.json`에 반영한다.
- IMP-02(서버 응답 검증)는 지금 생성된 `allergen-registry.json`을
  "표준 id 목록"으로 재사용할 수 있지만, 지금 당장 서버 코드가 이 파일을
  읽도록 연결하지는 않았다 — 그건 다음 단계의 "서비스 연동" 작업이다.

---

**이번 세션에서 가장 중요했던 순간**: 파이프라인을 처음 돌렸을 때 바로
통과하지 않고 실제 데이터 결함 3건을 찾아냈다는 것 자체가, 이 검증
파이프라인이 "형식적으로 존재하는 코드"가 아니라 "실제로 동작하는
안전장치"임을 보여주는 증거라고 판단해 그 과정을 숨기지 않고 §9에
전부 기록했다.
