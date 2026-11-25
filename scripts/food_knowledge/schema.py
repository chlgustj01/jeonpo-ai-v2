"""scripts/food_knowledge/schema.py

[IMP-18C] data/master/Food_Allergen_Master.xlsx의 "실제" 구조를 그대로
코드로 옮긴 모듈이다. 설계 문서(IMP-18)가 아니라 실제 생성된 .xlsx 파일을
openpyxl로 직접 열어 시트명/컬럼/열거형 값을 확인한 뒤(2026-11-25) 그
결과를 여기 상수로 못박았다 — "이전 설계안만 참고해서 임의의 필드명을
만들지 않는다"는 지시를 지키기 위한 장치다.

용어 설명(초급 개발자를 위해):
  - Primary Key(기본 키): 한 테이블(시트) 안에서 각 행을 유일하게 식별하는
    값. 여기서는 각 시트의 `id` 컬럼이 그 역할을 한다.
  - Foreign Key(외래 키): 다른 테이블의 Primary Key를 "가리키는" 값.
    예) 04_Ingredient_Allergens.allergenId는 01_Allergens.id를 가리킨다.
    FK가 가리키는 대상이 실제로 존재하는지 확인하는 것이 Referential
    Integrity(참조 무결성) 검증이다(validate.py에서 구현).
"""

from __future__ import annotations

SHEET_NAMES = [
    "01_Allergens",
    "02_Allergen_Aliases",
    "03_Ingredients",
    "04_Ingredient_Allergens",
    "05_Dishes",
    "06_Dish_Ingredients",
    "07_Regulatory_Standards",
    "08_Evidence_Sources",
    "09_Restaurant_Verification",
    "10_Epidemiology",
    "11_Changelog",
]

# 시트별 실제 컬럼 순서(헤더) — openpyxl로 직접 확인한 그대로.
SHEET_COLUMNS = {
    "01_Allergens": [
        "id", "legacyIds", "ko", "en", "ja", "zh", "vi", "es", "icon",
        "registryStatus", "biologicalCategory", "regulatoryRefs", "evidenceRefs",
        "reviewStatus", "reviewedAt", "reviewedBy", "notes",
    ],
    "02_Allergen_Aliases": ["allergenId", "alias", "lang", "reviewStatus", "evidenceType", "notes"],
    "03_Ingredients": ["id", "nameKo", "nameEn", "kind", "reviewStatus", "sourceId", "notes"],
    "04_Ingredient_Allergens": [
        "id", "ingredientId", "allergenId", "relationType", "confidence",
        "evidenceId", "reviewStatus", "evidenceType", "reviewedAt", "notes",
    ],
    "05_Dishes": ["id", "nameKo", "nameEn", "category", "sourceId", "reviewStatus", "notes"],
    "06_Dish_Ingredients": ["id", "dishId", "ingredientId", "necessity", "sourceId", "notes"],
    "07_Regulatory_Standards": [
        "id", "country", "legalName", "amendmentDate", "mandatoryCount",
        "recommendedCount", "sourceId", "status", "notes",
    ],
    "08_Evidence_Sources": ["id", "type", "title", "url", "publishedDate", "reviewedDate", "reliability", "notes"],
    "09_Restaurant_Verification": [
        "id", "locationFoodId", "dishId", "verifiedAllergenFlags", "verificationMethod",
        "verifiedAt", "verifiedBy", "confidence", "notes",
    ],
    "10_Epidemiology": [
        "id", "title", "authors", "year", "doi", "url", "country", "ageRange",
        "sampleSize", "method", "definition", "prevalence", "topAllergens",
        "limitations", "reviewStatus", "reviewedAt",
    ],
    "11_Changelog": ["version", "date", "author", "summary"],
}

# 각 시트에서 "반드시 값이 있어야 하는" 컬럼(공란이면 Transform 단계에서 Error).
REQUIRED_COLUMNS = {
    "01_Allergens": ["id", "ko", "en", "ja", "zh", "vi", "es", "registryStatus", "reviewStatus"],
    "02_Allergen_Aliases": ["allergenId", "alias", "lang", "reviewStatus", "evidenceType"],
    "03_Ingredients": ["id", "nameKo", "nameEn", "kind", "reviewStatus"],
    "04_Ingredient_Allergens": ["id", "ingredientId", "allergenId", "relationType", "reviewStatus"],
    "05_Dishes": ["id", "nameKo", "reviewStatus"],
    "06_Dish_Ingredients": ["id", "dishId", "ingredientId"],
    "07_Regulatory_Standards": ["id", "country", "legalName", "status"],
    "08_Evidence_Sources": ["id", "type", "title", "url", "reliability"],
    "09_Restaurant_Verification": ["id", "locationFoodId", "verificationMethod", "confidence"],
    "10_Epidemiology": ["id", "title", "reviewStatus"],
    "11_Changelog": ["version", "date", "summary"],
}

PRIMARY_KEY_COLUMN = "id"  # 11_Changelog만 예외(버전 번호가 사실상 키) — validate.py에서 별도 처리

# ID 형식 검증용 정규식 — 실제 생성 스크립트(scripts/generate-master-xlsx.js)가
# 만든 패턴을 그대로 반영했다(임의로 더 엄격하게 만들지 않음).
ID_PATTERNS = {
    "01_Allergens": r"^[a-z][a-z0-9_]*$",
    "03_Ingredients": r"^[a-z][a-z0-9_]*$",
    "04_Ingredient_Allergens": r"^ia_\d{4}$",
    "05_Dishes": r"^[a-z][a-z0-9_]*$",
    "06_Dish_Ingredients": r"^di_\d{4}$",
    "07_Regulatory_Standards": r"^[A-Z0-9][A-Z0-9.\-]*$",
    "08_Evidence_Sources": r"^EV-[A-Z0-9\-]+$",
    "09_Restaurant_Verification": r"^rv_\d{4}$",
    "10_Epidemiology": r"^epi_\d{4}$",
}

# --- 열거형(허용 값) ---
# 실제 .xlsx에서 "지금 쓰이고 있는" 값과, IMP-18 설계 문서가 "앞으로 쓰겠다"고
# 명시한 값을 합쳤다. 둘을 구분해 주석에 남긴다 — 지금 안 쓰인다고 검증기가
# 거부해버리면, 이후 Excel에 그 값을 채워 넣는 순간 전부 에러가 나서
# "왜 설계 문서에 있는 값을 거부하냐"는 혼란이 생기기 때문이다.

REGISTRY_STATUS_VALUES = {"active", "candidate"}  # 전부 실사용 중

# 여러 시트에 공통으로 등장하는 reviewStatus 컬럼의 전체 허용값(합집합).
# 어느 시트에 어떤 값이 실제로 쓰이는지는 ACTUAL_REVIEW_STATUS_BY_SHEET(검증
# 리포트 참고용)에 따로 기록한다 — 열거형 검증 자체는 "알려진 값인가"만 본다.
REVIEW_STATUS_VALUES = {
    "reviewed",                 # 1차 자료로 직접 검증됨
    "reviewed_as_candidate",    # 해외 규제 근거는 검증했으나 활성 등록은 아직 아님
    "pending_expert_review",    # AI 추정 — 전문가 검토 전(04, 02 시트에 실사용)
    "pending_verification",     # 근거자료 자체가 미확인(10 시트에 실사용)
    "demo_content",             # 해커톤 데모 콘텐츠(05 시트에 실사용) — 품질검증 대상이 아님을 명시하는 상태
    "demo_placeholder",         # 매장 미확인(09 시트에 실사용)
}

RELATION_TYPE_VALUES = {
    "IS_ALLERGEN",
    "CONTAINS_AS_RAW_MATERIAL",
    "TYPICAL_RECIPE_INCLUSION",
    "PRODUCT_VARIANT_DEPENDENT",
    "OBSERVED_CROSS_CONTACT",   # 설계상 존재, 현재 실데이터엔 0건(매장 확인 자체가 없어서)
    "UNCONFIRMED",
}

EVIDENCE_TYPE_VALUES = {
    "definitional",                    # 알레르겐=식재료 자체(자명)
    "regulatory",                      # 02 시트의 legacyIds 승계분
    "ai_estimated_general_knowledge",  # 이번 세션 AI 추정(실사용 중)
    # 아래는 설계 문서(§7) 및 이번 요청 §7에서 명시된, 아직 실데이터엔 없는 예약값.
    "manufacturer_label",
    "restaurant_direct_confirmation",
    "public_recipe_data",
    "peer_reviewed_study",
}

EVIDENCE_SOURCE_TYPE_VALUES = {
    "regulatory", "public_api", "peer_reviewed_study", "demo_internal",
    # 이번 요청 §7에서 유지하라고 명시한 범주 중 아직 08 시트에 실례가 없는 것들(예약값)
    "manufacturer_label", "restaurant_direct_confirmation",
}

RELIABILITY_VALUES = {"primary_legal_text", "secondary_summary", "unverified"}

VERIFICATION_METHOD_VALUES = {
    "demo_placeholder",  # 실사용 중
    # IMP-18 설계 문서에 명시된 예약값(아직 실데이터 없음)
    "staff_interview", "menu_label", "ingredient_list_photo",
}

CONFIDENCE_VALUES = {"high", "medium", "low", "none"}

REGULATORY_STATUS_VALUES = {"current", "superseded_by_2024_amendment"}

INGREDIENT_KIND_VALUES = {"single", "composite"}

# 숫자 컬럼: 정상적으로는 int여야 하지만, "아직 조사 못했다"는 뜻의 문장형
# 센티널 값 하나만 예외로 허용한다(10_Epidemiology.year/sampleSize에서 실제로
# 이 패턴이 쓰이고 있음 — "검증 필요"). 그 밖의 비숫자 문자열은 자료형 오류로 처리.
UNVERIFIED_NUMBER_SENTINEL = "검증 필요"

NUMERIC_COLUMNS = {
    "07_Regulatory_Standards": ["mandatoryCount", "recommendedCount"],
    "10_Epidemiology": ["year", "sampleSize"],
}

# FK(외래 키) 선언: (출발 시트, 출발 컬럼) -> (도착 시트, 도착 컬럼).
# "콤마로 구분된 여러 id" 또는 "id:상태" 형식처럼 단순 1:1이 아닌 컬럼은
# kind='list' / 'ref_list'로 표시해 validate.py가 다르게 파싱하게 한다.
FOREIGN_KEYS = [
    {"from_sheet": "02_Allergen_Aliases", "from_col": "allergenId", "to_sheet": "01_Allergens", "kind": "scalar"},
    {"from_sheet": "04_Ingredient_Allergens", "from_col": "ingredientId", "to_sheet": "03_Ingredients", "kind": "scalar"},
    {"from_sheet": "04_Ingredient_Allergens", "from_col": "allergenId", "to_sheet": "01_Allergens", "kind": "scalar"},
    {"from_sheet": "04_Ingredient_Allergens", "from_col": "evidenceId", "to_sheet": "08_Evidence_Sources", "kind": "scalar_optional"},
    {"from_sheet": "06_Dish_Ingredients", "from_col": "dishId", "to_sheet": "05_Dishes", "kind": "scalar"},
    {"from_sheet": "06_Dish_Ingredients", "from_col": "ingredientId", "to_sheet": "03_Ingredients", "kind": "scalar"},
    {"from_sheet": "06_Dish_Ingredients", "from_col": "sourceId", "to_sheet": "08_Evidence_Sources", "kind": "scalar_optional"},
    {"from_sheet": "03_Ingredients", "from_col": "sourceId", "to_sheet": "08_Evidence_Sources", "kind": "scalar_optional"},
    {"from_sheet": "05_Dishes", "from_col": "sourceId", "to_sheet": "08_Evidence_Sources", "kind": "scalar_optional"},
    {"from_sheet": "07_Regulatory_Standards", "from_col": "sourceId", "to_sheet": "08_Evidence_Sources", "kind": "scalar_optional"},
    {"from_sheet": "09_Restaurant_Verification", "from_col": "locationFoodId", "to_sheet": "05_Dishes", "kind": "scalar_optional"},
    {"from_sheet": "09_Restaurant_Verification", "from_col": "dishId", "to_sheet": "05_Dishes", "kind": "scalar_optional"},
    {"from_sheet": "01_Allergens", "from_col": "evidenceRefs", "to_sheet": "08_Evidence_Sources", "kind": "comma_list_optional"},
    {"from_sheet": "01_Allergens", "from_col": "regulatoryRefs", "to_sheet": "07_Regulatory_Standards", "kind": "ref_status_list_optional"},
]

# 자기참조(순환 가능) 필드 — 지금 실제 스키마엔 존재하지 않지만(Ingredients에
# compositeOf 컬럼이 없음), IMP-18 설계 문서는 이를 명시했었다. 향후 그
# 컬럼이 추가될 경우를 대비해 이름만 미리 선언해둔다(지금은 빈 리스트처럼 동작).
SELF_REFERENTIAL_FIELDS = [
    {"sheet": "03_Ingredients", "column": "compositeOf", "kind": "comma_list_optional_self_ref"},
]
