"""tests/test_food_knowledge.py

[IMP-18C] TC-18C-01 ~ TC-18C-16.

표준 라이브러리 unittest만 쓴다(pytest는 이 환경에 설치되어 있지 않고,
"불필요한 라이브러리 도입을 최소화"하라는 지시에 따라 새로 설치하지도
않았다 — openpyxl만 이미 설치되어 있었고 그것만 쓴다).

모든 오류 케이스 fixture는 openpyxl로 그때그때 임시 .xlsx를 만들어
쓰고 테스트가 끝나면 지운다 — **실제 data/master/Food_Allergen_Master.xlsx는
절대 읽기 외의 방식으로 건드리지 않는다.**

실행 방법: py -m unittest tests.test_food_knowledge -v
(또는 프로젝트 루트에서: py -m unittest discover tests)
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from food_knowledge import schema  # noqa: E402
from food_knowledge.extract import extract_workbook  # noqa: E402
from food_knowledge.validate import validate_extracted  # noqa: E402
from food_knowledge.transform import transform  # noqa: E402
from food_knowledge.graph_utils import find_cycles  # noqa: E402
import build_food_knowledge  # noqa: E402

REAL_WORKBOOK = os.path.join(ROOT, "data", "master", "Food_Allergen_Master.xlsx")
REAL_SHARED_JS = os.path.join(ROOT, "shared", "allergens.js")


# ---------------------------------------------------------------------
# 최소 유효 workbook 생성 헬퍼 — 시트 11개 전부, 서로 FK가 맞는 최소 행.
# ---------------------------------------------------------------------
def _write_sheet(wb, name, rows):
    ws = wb.create_sheet(name)
    ws.append(schema.SHEET_COLUMNS[name])
    for row in rows:
        ws.append([row.get(c) for c in schema.SHEET_COLUMNS[name]])


def make_minimal_workbook(path: str, *, sheet_overrides: dict | None = None) -> None:
    """모든 시트를 schema.SHEET_COLUMNS 그대로, FK가 맞물리는 최소 행으로 채운다.
    sheet_overrides={"04_Ingredient_Allergens": [...]}처럼 특정 시트의 행만
    통째로 바꿔치기해 각 테스트가 원하는 "깨진 상태"를 만들 수 있게 한다.
    """
    overrides = sheet_overrides or {}

    base_rows = {
        "01_Allergens": [
            {
                "id": "peanut", "legacyIds": "", "ko": "땅콩", "en": "Peanut", "ja": "ピーナッツ",
                "zh": "花生", "vi": "Đậu phộng", "es": "Maní", "icon": "🥜", "registryStatus": "active",
                "biologicalCategory": "legume", "regulatoryRefs": "TEST-STD:mandatory",
                "evidenceRefs": "EV-TEST-1", "reviewStatus": "reviewed", "reviewedAt": "2026-11-25",
                "reviewedBy": "tester", "notes": "",
            },
            {
                "id": "celery", "legacyIds": "", "ko": "셀러리", "en": "Celery", "ja": "セロリ",
                "zh": "芹菜", "vi": "Cần tây", "es": "Apio", "icon": "🥬", "registryStatus": "candidate",
                "biologicalCategory": "vegetable", "regulatoryRefs": "TEST-STD:mandatory",
                "evidenceRefs": "EV-TEST-1", "reviewStatus": "reviewed_as_candidate", "reviewedAt": "2026-11-25",
                "reviewedBy": "tester", "notes": "",
            },
        ],
        "02_Allergen_Aliases": [
            {"allergenId": "peanut", "alias": "peanuts", "lang": "en",
             "reviewStatus": "pending_expert_review", "evidenceType": "ai_estimated_general_knowledge", "notes": ""},
        ],
        "03_Ingredients": [
            {"id": "raw_peanut", "nameKo": "땅콩", "nameEn": "Peanut", "kind": "single",
             "reviewStatus": "reviewed", "sourceId": "EV-TEST-1", "notes": ""},
        ],
        "04_Ingredient_Allergens": [
            {"id": "ia_0001", "ingredientId": "raw_peanut", "allergenId": "peanut", "relationType": "IS_ALLERGEN",
             "confidence": "high", "evidenceId": "EV-TEST-1", "reviewStatus": "reviewed",
             "evidenceType": "definitional", "reviewedAt": "2026-11-25", "notes": ""},
        ],
        "05_Dishes": [
            {"id": "test_dish", "nameKo": "테스트음식", "nameEn": "Test Dish", "category": "test",
             "sourceId": "EV-TEST-1", "reviewStatus": "demo_content", "notes": ""},
        ],
        "06_Dish_Ingredients": [],
        "07_Regulatory_Standards": [
            {"id": "TEST-STD", "country": "KR", "legalName": "테스트 기준", "amendmentDate": "2026-01-01",
             "mandatoryCount": 1, "recommendedCount": 0, "sourceId": "EV-TEST-1", "status": "current", "notes": ""},
        ],
        "08_Evidence_Sources": [
            {"id": "EV-TEST-1", "type": "regulatory", "title": "테스트 출처", "url": "https://example.test",
             "publishedDate": "2026-01-01", "reviewedDate": "2026-11-25", "reliability": "primary_legal_text",
             "notes": ""},
        ],
        "09_Restaurant_Verification": [
            {"id": "rv_0001", "locationFoodId": "test_dish", "dishId": "test_dish",
             "verifiedAllergenFlags": "", "verificationMethod": "demo_placeholder", "verifiedAt": "",
             "verifiedBy": "tester", "confidence": "none", "notes": ""},
        ],
        "10_Epidemiology": [
            {"id": "epi_0001", "title": "테스트 연구", "authors": "tester", "year": 2026, "doi": "",
             "url": "https://example.test", "country": "KR", "ageRange": "", "sampleSize": 1,
             "method": "", "definition": "", "prevalence": "", "topAllergens": "", "limitations": "",
             "reviewStatus": "reviewed", "reviewedAt": "2026-11-25"},
        ],
        "11_Changelog": [
            {"version": "0.1", "date": "2026-11-25", "author": "tester", "summary": "테스트용"},
        ],
    }
    base_rows.update(overrides)

    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for sheet_name in schema.SHEET_NAMES:
        _write_sheet(wb, sheet_name, base_rows[sheet_name])
    wb.save(path)
    wb.close()


class TempWorkbookTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.mkdtemp(prefix="imp18c-test-")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def workbook_path(self, name: str = "fixture.xlsx") -> str:
        return os.path.join(self.tmp_dir, name)


class TestExtractAndBasicValidation(TempWorkbookTestCase):
    def test_tc_18c_01_normal_extraction(self):
        path = self.workbook_path()
        make_minimal_workbook(path)
        extracted = extract_workbook(path)
        self.assertTrue(extracted.ok, extracted.fatal_errors)
        self.assertEqual(len(extracted.sheets["01_Allergens"]), 2)

        validation = validate_extracted(extracted)  # shared_js 비교는 안 함(이 fixture는 실제 21종이 아님)
        self.assertTrue(validation.ok, [f.message for f in validation.errors])

    def test_tc_18c_02_duplicate_id(self):
        path = self.workbook_path()
        make_minimal_workbook(
            path,
            sheet_overrides={
                "01_Allergens": [
                    {"id": "peanut", "legacyIds": "", "ko": "땅콩", "en": "Peanut", "ja": "a", "zh": "a",
                     "vi": "a", "es": "a", "icon": "", "registryStatus": "active", "biologicalCategory": "",
                     "regulatoryRefs": "TEST-STD:mandatory", "evidenceRefs": "EV-TEST-1", "reviewStatus": "reviewed",
                     "reviewedAt": "", "reviewedBy": "", "notes": ""},
                    {"id": "peanut", "legacyIds": "", "ko": "땅콩2", "en": "Peanut2", "ja": "a", "zh": "a",
                     "vi": "a", "es": "a", "icon": "", "registryStatus": "active", "biologicalCategory": "",
                     "regulatoryRefs": "TEST-STD:mandatory", "evidenceRefs": "EV-TEST-1", "reviewStatus": "reviewed",
                     "reviewedAt": "", "reviewedBy": "", "notes": ""},
                ]
            },
        )
        extracted = extract_workbook(path)
        validation = validate_extracted(extracted)
        self.assertFalse(validation.ok)
        self.assertTrue(any(f.code == "DUPLICATE_ID" for f in validation.errors))

    def test_tc_18c_03_broken_reference(self):
        path = self.workbook_path()
        make_minimal_workbook(
            path,
            sheet_overrides={
                "04_Ingredient_Allergens": [
                    {"id": "ia_0001", "ingredientId": "raw_peanut", "allergenId": "does_not_exist",
                     "relationType": "IS_ALLERGEN", "confidence": "high", "evidenceId": "EV-TEST-1",
                     "reviewStatus": "reviewed", "evidenceType": "definitional", "reviewedAt": "", "notes": ""},
                ]
            },
        )
        extracted = extract_workbook(path)
        validation = validate_extracted(extracted)
        self.assertFalse(validation.ok)
        self.assertTrue(any(f.code == "BROKEN_REFERENCE" and "does_not_exist" in f.message for f in validation.errors))

    def test_tc_18c_04_missing_required_field(self):
        path = self.workbook_path()
        make_minimal_workbook(
            path,
            sheet_overrides={
                "01_Allergens": [
                    {"id": "peanut", "legacyIds": "", "ko": "땅콩", "en": "", "ja": "a", "zh": "a",  # en 누락
                     "vi": "a", "es": "a", "icon": "", "registryStatus": "active", "biologicalCategory": "",
                     "regulatoryRefs": "TEST-STD:mandatory", "evidenceRefs": "EV-TEST-1", "reviewStatus": "reviewed",
                     "reviewedAt": "", "reviewedBy": "", "notes": ""},
                ]
            },
        )
        extracted = extract_workbook(path)
        validation = validate_extracted(extracted)
        self.assertFalse(validation.ok)
        self.assertTrue(any(f.code == "MISSING_REQUIRED_FIELD" for f in validation.errors))

    def test_tc_18c_05_invalid_data_type(self):
        path = self.workbook_path()
        make_minimal_workbook(
            path,
            sheet_overrides={
                "07_Regulatory_Standards": [
                    {"id": "TEST-STD", "country": "KR", "legalName": "t", "amendmentDate": "",
                     "mandatoryCount": "스물두개", "recommendedCount": 0, "sourceId": "EV-TEST-1",
                     "status": "current", "notes": ""},
                ]
            },
        )
        extracted = extract_workbook(path)
        validation = validate_extracted(extracted)
        self.assertFalse(validation.ok)
        self.assertTrue(any(f.code == "INVALID_DATA_TYPE" for f in validation.errors))

    def test_tc_18c_05b_unverified_sentinel_is_allowed(self):
        """'검증 필요' 센티널은 자료형 오류가 아니어야 한다(실제 10_Epidemiology에서 쓰는 값)."""
        path = self.workbook_path()
        make_minimal_workbook(
            path,
            sheet_overrides={
                "10_Epidemiology": [
                    {"id": "epi_0001", "title": "t", "authors": "", "year": "검증 필요", "doi": "", "url": "",
                     "country": "", "ageRange": "", "sampleSize": "검증 필요", "method": "", "definition": "",
                     "prevalence": "", "topAllergens": "", "limitations": "", "reviewStatus": "pending_verification",
                     "reviewedAt": ""},
                ]
            },
        )
        extracted = extract_workbook(path)
        validation = validate_extracted(extracted)
        self.assertFalse(any(f.code == "INVALID_DATA_TYPE" for f in validation.errors), validation.errors)

    def test_tc_18c_06_invalid_relation_type(self):
        path = self.workbook_path()
        make_minimal_workbook(
            path,
            sheet_overrides={
                "04_Ingredient_Allergens": [
                    {"id": "ia_0001", "ingredientId": "raw_peanut", "allergenId": "peanut",
                     "relationType": "TOTALLY_MADE_UP", "confidence": "high", "evidenceId": "EV-TEST-1",
                     "reviewStatus": "reviewed", "evidenceType": "definitional", "reviewedAt": "", "notes": ""},
                ]
            },
        )
        extracted = extract_workbook(path)
        validation = validate_extracted(extracted)
        self.assertFalse(validation.ok)
        self.assertTrue(any(f.code == "INVALID_ENUM_VALUE" and "TOTALLY_MADE_UP" in f.message for f in validation.errors))

    def test_tc_18c_07_missing_evidence(self):
        path = self.workbook_path()
        make_minimal_workbook(
            path,
            sheet_overrides={
                "04_Ingredient_Allergens": [
                    {"id": "ia_0001", "ingredientId": "raw_peanut", "allergenId": "peanut",
                     "relationType": "CONTAINS_AS_RAW_MATERIAL", "confidence": "high", "evidenceId": "",  # 비어있음
                     "reviewStatus": "reviewed", "evidenceType": "regulatory", "reviewedAt": "", "notes": ""},
                ]
            },
        )
        extracted = extract_workbook(path)
        validation = validate_extracted(extracted)
        self.assertFalse(validation.ok)
        self.assertTrue(any(f.code == "MISSING_EVIDENCE_FOR_REVIEWED" for f in validation.errors))

    def test_tc_18c_07b_ai_estimate_cannot_be_reviewed(self):
        path = self.workbook_path()
        make_minimal_workbook(
            path,
            sheet_overrides={
                "04_Ingredient_Allergens": [
                    {"id": "ia_0001", "ingredientId": "raw_peanut", "allergenId": "peanut",
                     "relationType": "TYPICAL_RECIPE_INCLUSION", "confidence": "low", "evidenceId": "EV-TEST-1",
                     "reviewStatus": "reviewed",  # AI 추정인데 reviewed라고 우김 — 모순
                     "evidenceType": "ai_estimated_general_knowledge", "reviewedAt": "", "notes": ""},
                ]
            },
        )
        extracted = extract_workbook(path)
        validation = validate_extracted(extracted)
        self.assertFalse(validation.ok)
        self.assertTrue(any(f.code == "AI_ESTIMATE_MARKED_AS_REVIEWED" for f in validation.errors))

    def test_tc_18c_08_alias_conflict(self):
        path = self.workbook_path()
        make_minimal_workbook(
            path,
            sheet_overrides={
                "02_Allergen_Aliases": [
                    {"allergenId": "peanut", "alias": "nuttest", "lang": "en",
                     "reviewStatus": "pending_expert_review", "evidenceType": "ai_estimated_general_knowledge", "notes": ""},
                    {"allergenId": "celery", "alias": "NutTest", "lang": "en",  # 대소문자만 다름, 다른 allergenId
                     "reviewStatus": "pending_expert_review", "evidenceType": "ai_estimated_general_knowledge", "notes": ""},
                ]
            },
        )
        extracted = extract_workbook(path)
        validation = validate_extracted(extracted)
        self.assertFalse(validation.ok)
        self.assertTrue(any(f.code == "CONFLICTING_ALIAS" for f in validation.errors))


class TestTransformPolicy(TempWorkbookTestCase):
    def test_tc_18c_09_pending_excluded_from_service_output(self):
        path = self.workbook_path()
        make_minimal_workbook(
            path,
            sheet_overrides={
                "04_Ingredient_Allergens": [
                    {"id": "ia_0001", "ingredientId": "raw_peanut", "allergenId": "peanut",
                     "relationType": "IS_ALLERGEN", "confidence": "high", "evidenceId": "EV-TEST-1",
                     "reviewStatus": "reviewed", "evidenceType": "definitional", "reviewedAt": "", "notes": ""},
                    {"id": "ia_0002", "ingredientId": "raw_peanut", "allergenId": "celery",
                     "relationType": "TYPICAL_RECIPE_INCLUSION", "confidence": "low", "evidenceId": "",
                     "reviewStatus": "pending_expert_review", "evidenceType": "ai_estimated_general_knowledge",
                     "reviewedAt": "", "notes": ""},
                ]
            },
        )
        extracted = extract_workbook(path)
        validation = validate_extracted(extracted)
        self.assertTrue(validation.ok, [f.message for f in validation.errors])
        out = transform(extracted)
        confirmed_ids = {r["id"] for r in out.ingredient_knowledge["confirmedRelations"]}
        pending_ids = {r["id"] for r in out.pending_ingredient_relations}
        self.assertIn("ia_0001", confirmed_ids)
        self.assertNotIn("ia_0002", confirmed_ids)
        self.assertIn("ia_0002", pending_ids)

    def test_tc_18c_10_demo_placeholder_separated(self):
        path = self.workbook_path()
        make_minimal_workbook(path)
        extracted = extract_workbook(path)
        out = transform(extracted)
        for v in out.dishes_demo["restaurantVerification"]:
            self.assertTrue(v["isDemo"])
            self.assertTrue(v["doNotUseAsRealVerification"])
        for d in out.dishes_demo["dishes"]:
            self.assertTrue(d["isDemo"])

    def test_tc_18c_11_candidate_vs_active_separation(self):
        path = self.workbook_path()
        make_minimal_workbook(path)
        extracted = extract_workbook(path)
        out = transform(extracted)
        registry_ids = {a["id"] for a in out.allergen_registry}
        candidate_ids = {a["id"] for a in out.allergen_candidates}
        self.assertEqual(registry_ids, {"peanut"})
        self.assertEqual(candidate_ids, {"celery"})
        for c in out.allergen_candidates:
            self.assertFalse(c["autoApplyToRiskJudgment"])


class TestSharedJsCompatibility(unittest.TestCase):
    def test_tc_18c_12_real_data_is_compatible(self):
        """실제 Master DB의 active 21종이 실제 shared/allergens.js와 완전히 일치하는지."""
        extracted = extract_workbook(REAL_WORKBOOK)
        self.assertTrue(extracted.ok, extracted.fatal_errors)
        validation = validate_extracted(extracted, shared_allergens_js_path=REAL_SHARED_JS)
        compat_codes = {"ACTIVE_ID_SET_MISMATCH", "LEGACY_ID_MISMATCH", "LABEL_MISMATCH", "SHARED_JS_UNREADABLE"}
        compat_errors = [f for f in validation.errors if f.code in compat_codes]
        self.assertEqual(compat_errors, [], [f.message for f in compat_errors])

    def test_tc_18c_12b_mismatch_is_actually_detected(self):
        """탐지 로직 자체가 실제로 작동하는지: 일부러 다른 shared.js 흉내 파일로 어긋나게 만든다."""
        tmp_dir = tempfile.mkdtemp(prefix="imp18c-test-")
        try:
            fake_js_path = os.path.join(tmp_dir, "fake_allergens.js")
            with open(fake_js_path, "w", encoding="utf-8") as f:
                f.write(
                    "var ALLERGEN_REGISTRY = [\n"
                    "  { id: 'peanut', legacyIds: [], labels: { ko: '완전히다른이름', en: 'Peanut', ja: 'x', "
                    "zh: 'x', vi: 'x', es: 'x' }, icon: 'x' }\n"
                    "];\n"
                )
            workbook_path = os.path.join(tmp_dir, "fixture.xlsx")
            make_minimal_workbook(workbook_path)
            extracted = extract_workbook(workbook_path)
            validation = validate_extracted(extracted, shared_allergens_js_path=fake_js_path)
            self.assertTrue(
                any(f.code in {"ACTIVE_ID_SET_MISMATCH", "LABEL_MISMATCH"} for f in validation.errors)
            )
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)


class TestGraphUtils(unittest.TestCase):
    def test_cycle_detector_on_synthetic_fixture(self):
        """실제 스키마엔 순환 가능한 자기참조 필드가 없어(Ingredients에 compositeOf
        컬럼 자체가 없음) 진짜 데이터로는 테스트가 안 된다 — 합성 데이터로 함수 자체를 검증."""
        no_cycle = {"a": ["b"], "b": ["c"], "c": []}
        self.assertEqual(find_cycles(no_cycle), [])

        has_cycle = {"a": ["b"], "b": ["c"], "c": ["a"]}
        cycles = find_cycles(has_cycle)
        self.assertEqual(len(cycles), 1)
        self.assertIn("a", cycles[0])


class TestBuildPipeline(unittest.TestCase):
    def test_tc_18c_13_deterministic_repeat_build(self):
        out_dir_1 = tempfile.mkdtemp(prefix="imp18c-build1-")
        out_dir_2 = tempfile.mkdtemp(prefix="imp18c-build2-")
        try:
            r1 = build_food_knowledge.run_build(REAL_WORKBOOK, REAL_SHARED_JS, out_dir_1, None)
            r2 = build_food_knowledge.run_build(REAL_WORKBOOK, REAL_SHARED_JS, out_dir_2, None)
            self.assertTrue(r1["success"] and r2["success"])
            self.assertEqual(r1["manifest"]["dataVersion"], r2["manifest"]["dataVersion"])
            self.assertEqual(r1["manifest"]["sourceHash"], r2["manifest"]["sourceHash"])
            self.assertEqual(r1["manifest"]["recordCounts"], r2["manifest"]["recordCounts"])

            for fname, _ in build_food_knowledge_output_files():
                with open(os.path.join(out_dir_1, fname), encoding="utf-8") as f:
                    content1 = f.read()
                with open(os.path.join(out_dir_2, fname), encoding="utf-8") as f:
                    content2 = f.read()
                self.assertEqual(content1, content2, f"{fname}이 두 번의 빌드에서 바이트 단위로 다릅니다")
        finally:
            shutil.rmtree(out_dir_1, ignore_errors=True)
            shutil.rmtree(out_dir_2, ignore_errors=True)

    def test_tc_18c_14_failed_build_does_not_touch_existing_output(self):
        out_dir = tempfile.mkdtemp(prefix="imp18c-protect-")
        broken_dir = tempfile.mkdtemp(prefix="imp18c-broken-src-")
        try:
            # 1) 정상 빌드로 "기존의 좋은 산출물"을 만든다.
            good = build_food_knowledge.run_build(REAL_WORKBOOK, REAL_SHARED_JS, out_dir, None)
            self.assertTrue(good["success"])
            snapshot = {}
            for fname in os.listdir(out_dir):
                with open(os.path.join(out_dir, fname), encoding="utf-8") as f:
                    snapshot[fname] = f.read()

            # 2) 깨진 Excel로 "같은 출력 디렉터리"에 다시 빌드를 시도한다.
            broken_workbook = os.path.join(broken_dir, "broken.xlsx")
            make_minimal_workbook(
                broken_workbook,
                sheet_overrides={
                    "04_Ingredient_Allergens": [
                        {"id": "ia_0001", "ingredientId": "raw_peanut", "allergenId": "does_not_exist",
                         "relationType": "IS_ALLERGEN", "confidence": "high", "evidenceId": "EV-TEST-1",
                         "reviewStatus": "reviewed", "evidenceType": "definitional", "reviewedAt": "", "notes": ""},
                    ]
                },
            )
            bad = build_food_knowledge.run_build(broken_workbook, REAL_SHARED_JS, out_dir, None)
            self.assertFalse(bad["success"])

            # 3) 기존 파일이 한 글자도 바뀌지 않았어야 한다.
            for fname, content in snapshot.items():
                with open(os.path.join(out_dir, fname), encoding="utf-8") as f:
                    self.assertEqual(f.read(), content, f"{fname}이 실패한 빌드로 인해 변경되었습니다!")
        finally:
            shutil.rmtree(out_dir, ignore_errors=True)
            shutil.rmtree(broken_dir, ignore_errors=True)

    def test_tc_18c_15_real_master_db_build(self):
        out_dir = tempfile.mkdtemp(prefix="imp18c-real-")
        try:
            result = build_food_knowledge.run_build(REAL_WORKBOOK, REAL_SHARED_JS, out_dir, None)
            self.assertTrue(result["success"], result.get("validation") and [f.message for f in result["validation"].errors])
            self.assertEqual(len(result["transformed"].allergen_registry), 21)
            self.assertTrue(os.path.exists(os.path.join(out_dir, "knowledge-manifest.json")))
        finally:
            shutil.rmtree(out_dir, ignore_errors=True)


def build_food_knowledge_output_files():
    from food_knowledge.load import OUTPUT_FILES

    return OUTPUT_FILES + [("knowledge-manifest.json", None)]


class TestImp11Regression(unittest.TestCase):
    def test_tc_18c_16_imp11_tests_still_pass(self):
        """[회귀] IMP-11의 22개 테스트가 이번 IMP-18C 작업(코드 변경 없음)
        이후에도 그대로 통과하는지 Node.js 프로세스를 직접 실행해 확인한다."""
        # encoding을 명시하지 않으면 Windows에서 subprocess가 콘솔 기본
        # 코드페이지(cp949 등)로 자식 프로세스의 출력을 디코딩하려다가,
        # Node가 실제로 출력하는 UTF-8 한글 바이트를 cp949로 해석하지
        # 못해 백그라운드 reader 스레드에서 UnicodeDecodeError가 나는
        # 문제가 있었다(실제로 한 번 이렇게 실패하는 걸 발견함 — 간헐적으로
        # 재현되는 환경 의존 버그). encoding="utf-8"을 명시해 해결했다.
        result = subprocess.run(
            ["node", os.path.join(ROOT, "tests", "imp-11-after.js")],
            cwd=ROOT, capture_output=True, encoding="utf-8", errors="replace", timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS: 21", result.stdout)  # imp-11-after.js의 "=== 요약 ===" 출력 형식 그대로


if __name__ == "__main__":
    unittest.main()
