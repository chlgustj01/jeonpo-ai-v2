"""scripts/food_knowledge/validate.py

[IMP-18C] ETL의 "T"(Transform) 단계 중 "검증(Schema Validation)" 부분.

Schema Validation이란: 데이터가 "우리가 정한 규칙(스키마)"을 지키고
있는지 기계적으로 확인하는 것이다. 여기서는 그 규칙이 schema.py에 정의된
컬럼 목록/필수값/열거형/외래키다. 이 모듈은 규칙을 "확인"만 하고, 데이터를
고치거나 지우지 않는다(지시사항: "존재하지 않는 ID를 자동 생성하거나
조용히 삭제하지 않는다").

Finding(발견 사항)은 두 종류로 나눈다:
  - ERROR(오류): 치명적. 하나라도 있으면 빌드는 성공으로 처리되지 않는다
    (Fail-closed 원칙 — "확실하지 않으면 안전한 쪽(=배포하지 않는 쪽)으로
    실패한다". IMP-11의 checkDishSafety에서 이미 쓴 것과 같은 철학을
    데이터 빌드 단계에도 그대로 적용한 것이다).
  - WARNING(경고): 빌드는 계속 진행되지만, 사람이 나중에 확인해야 할
    사항으로 보고서에 남긴다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from . import schema
from .extract import ExtractResult
from .graph_utils import find_cycles
from .js_registry_reader import read_shared_allergens_js


@dataclass
class Finding:
    severity: str  # "ERROR" | "WARNING"
    code: str
    sheet: str
    row: int | str
    message: str


@dataclass
class ValidationReport:
    findings: list[Finding] = field(default_factory=list)

    def add(self, severity: str, code: str, sheet: str, row: Any, message: str) -> None:
        self.findings.append(Finding(severity, code, sheet, row, message))

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "ERROR"]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "WARNING"]

    @property
    def ok(self) -> bool:
        return len(self.errors) == 0


def _row_id(row: dict) -> Any:
    return row.get("id", row.get("_row_num"))


def _split_comma_list(value: Any) -> list[str]:
    if value is None or (isinstance(value, str) and not value.strip()):
        return []
    return [p.strip() for p in str(value).split(",") if p.strip()]


def _split_ref_status_list(value: Any) -> list[tuple[str, str]]:
    """'KR-MFDS-2021:mandatory | US-FDA-FALCPA-FASTER:mandatory' 형식 파싱."""
    out: list[tuple[str, str]] = []
    for part in _split_comma_or_pipe(value):
        if ":" in part:
            ref_id, status = part.split(":", 1)
            out.append((ref_id.strip(), status.strip()))
        else:
            out.append((part.strip(), ""))
    return out


def _split_comma_or_pipe(value: Any) -> list[str]:
    if value is None or (isinstance(value, str) and not value.strip()):
        return []
    text = str(value).replace("|", ",")
    return [p.strip() for p in text.split(",") if p.strip()]


def validate_extracted(
    extracted: ExtractResult,
    *,
    shared_allergens_js_path: str | None = None,
) -> ValidationReport:
    report = ValidationReport()

    for w in extracted.warnings:
        report.add("WARNING", "EXTRACT_WARNING", w.sheet, w.row, f"{w.column}: {w.message}")

    sheets = extracted.sheets
    # 빠른 조회용 인덱스: 시트별 id -> row
    by_id: dict[str, dict[str, dict]] = {}
    for sheet_name, rows in sheets.items():
        idx: dict[str, dict] = {}
        for row in rows:
            rid = row.get("id")
            if rid:
                idx.setdefault(rid, row)
        by_id[sheet_name] = idx

    _validate_required_columns(sheets, report)
    _validate_unique_ids(sheets, report)
    _validate_id_formats(sheets, report)
    _validate_enums(sheets, report)
    _validate_numeric_columns(sheets, report)
    _validate_foreign_keys(sheets, by_id, report)
    _validate_evidence_requirements(sheets, report)
    _validate_reviewer_consistency(sheets, report)
    _validate_alias_conflicts(sheets, report)
    _validate_self_reference_cycles(sheets, report)
    if shared_allergens_js_path:
        _validate_shared_allergens_compatibility(sheets, shared_allergens_js_path, report)

    return report


def _validate_required_columns(sheets: dict, report: ValidationReport) -> None:
    for sheet_name, rows in sheets.items():
        required = schema.REQUIRED_COLUMNS.get(sheet_name, [])
        for row in rows:
            for col in required:
                value = row.get(col)
                if value is None or (isinstance(value, str) and value.strip() == ""):
                    report.add(
                        "ERROR", "MISSING_REQUIRED_FIELD", sheet_name, _row_id(row),
                        f"필수 컬럼 '{col}'이(가) 비어 있습니다.",
                    )


def _validate_unique_ids(sheets: dict, report: ValidationReport) -> None:
    for sheet_name, rows in sheets.items():
        if sheet_name == "11_Changelog":
            continue  # 이 시트는 id 컬럼이 없음(PK가 version)
        seen: dict[str, int] = {}
        for row in rows:
            rid = row.get("id")
            if not rid:
                continue  # 공란은 MISSING_REQUIRED_FIELD에서 이미 잡음
            if rid in seen:
                report.add(
                    "ERROR", "DUPLICATE_ID", sheet_name, rid,
                    f"id '{rid}'가 {seen[rid]}행과 {row['_row_num']}행에 중복됩니다.",
                )
            else:
                seen[rid] = row["_row_num"]


def _validate_id_formats(sheets: dict, report: ValidationReport) -> None:
    for sheet_name, pattern in schema.ID_PATTERNS.items():
        rows = sheets.get(sheet_name, [])
        regex = re.compile(pattern)
        for row in rows:
            rid = row.get("id")
            if rid and not regex.match(rid):
                report.add(
                    "ERROR", "INVALID_ID_FORMAT", sheet_name, rid,
                    f"id '{rid}'가 표준 형식({pattern})을 따르지 않습니다.",
                )


def _validate_enums(sheets: dict, report: ValidationReport) -> None:
    enum_checks = [
        ("01_Allergens", "registryStatus", schema.REGISTRY_STATUS_VALUES),
        ("04_Ingredient_Allergens", "relationType", schema.RELATION_TYPE_VALUES),
        ("04_Ingredient_Allergens", "confidence", schema.CONFIDENCE_VALUES | {None, ""}),
        ("02_Allergen_Aliases", "evidenceType", schema.EVIDENCE_TYPE_VALUES),
        ("04_Ingredient_Allergens", "evidenceType", schema.EVIDENCE_TYPE_VALUES),
        ("08_Evidence_Sources", "type", schema.EVIDENCE_SOURCE_TYPE_VALUES),
        ("08_Evidence_Sources", "reliability", schema.RELIABILITY_VALUES),
        ("09_Restaurant_Verification", "verificationMethod", schema.VERIFICATION_METHOD_VALUES),
        ("09_Restaurant_Verification", "confidence", schema.CONFIDENCE_VALUES),
        ("07_Regulatory_Standards", "status", schema.REGULATORY_STATUS_VALUES),
        ("03_Ingredients", "kind", schema.INGREDIENT_KIND_VALUES),
        ("04_Ingredient_Allergens", "reviewerType", schema.REVIEWER_TYPE_VALUES | {None, ""}),
        ("04_Ingredient_Allergens", "evidenceScope", schema.EVIDENCE_SCOPE_VALUES | {None, ""}),
        ("02_Allergen_Aliases", "reviewerType", schema.REVIEWER_TYPE_VALUES | {None, ""}),
        ("02_Allergen_Aliases", "evidenceScope", schema.EVIDENCE_SCOPE_VALUES | {None, ""}),
    ]
    for sheet_name, col, allowed in enum_checks:
        for row in sheets.get(sheet_name, []):
            value = row.get(col)
            if value in (None, ""):
                continue
            if value not in allowed:
                report.add(
                    "ERROR", "INVALID_ENUM_VALUE", sheet_name, _row_id(row),
                    f"컬럼 '{col}'의 값 '{value}'은(는) 허용되지 않습니다. 허용값: {sorted(allowed)}",
                )

    # reviewStatus는 여러 시트에 공통으로 있으므로 한 번에 처리
    for sheet_name, rows in sheets.items():
        if "reviewStatus" not in schema.SHEET_COLUMNS.get(sheet_name, []):
            continue
        for row in rows:
            value = row.get("reviewStatus")
            if value and value not in schema.REVIEW_STATUS_VALUES:
                report.add(
                    "ERROR", "INVALID_ENUM_VALUE", sheet_name, _row_id(row),
                    f"컬럼 'reviewStatus'의 값 '{value}'은(는) 허용되지 않습니다. "
                    f"허용값: {sorted(schema.REVIEW_STATUS_VALUES)}",
                )


def _validate_numeric_columns(sheets: dict, report: ValidationReport) -> None:
    for sheet_name, cols in schema.NUMERIC_COLUMNS.items():
        for row in sheets.get(sheet_name, []):
            for col in cols:
                value = row.get(col)
                if value is None or value == "":
                    continue
                if isinstance(value, str) and value.strip() == schema.UNVERIFIED_NUMBER_SENTINEL:
                    continue  # 명시적으로 허용된 "아직 모름" 상태
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    report.add(
                        "ERROR", "INVALID_DATA_TYPE", sheet_name, _row_id(row),
                        f"컬럼 '{col}'은(는) 숫자이거나 '{schema.UNVERIFIED_NUMBER_SENTINEL}'이어야 "
                        f"하는데 {value!r}({type(value).__name__})입니다.",
                    )


def _validate_foreign_keys(sheets: dict, by_id: dict, report: ValidationReport) -> None:
    for fk in schema.FOREIGN_KEYS:
        from_sheet, from_col, to_sheet, kind = fk["from_sheet"], fk["from_col"], fk["to_sheet"], fk["kind"]
        target_ids = set(by_id.get(to_sheet, {}).keys())
        for row in sheets.get(from_sheet, []):
            raw_value = row.get(from_col)

            if kind == "scalar":
                if raw_value and raw_value not in target_ids:
                    report.add(
                        "ERROR", "BROKEN_REFERENCE", from_sheet, _row_id(row),
                        f"{from_col}='{raw_value}'이(가) {to_sheet}에 존재하지 않습니다.",
                    )
            elif kind == "scalar_optional":
                if raw_value and raw_value not in target_ids:
                    report.add(
                        "ERROR", "BROKEN_REFERENCE", from_sheet, _row_id(row),
                        f"{from_col}='{raw_value}'이(가) {to_sheet}에 존재하지 않습니다.",
                    )
            elif kind == "comma_list_optional":
                for ref in _split_comma_list(raw_value):
                    if ref not in target_ids:
                        report.add(
                            "ERROR", "BROKEN_REFERENCE", from_sheet, _row_id(row),
                            f"{from_col}의 참조값 '{ref}'이(가) {to_sheet}에 존재하지 않습니다.",
                        )
            elif kind == "ref_status_list_optional":
                for ref, _status in _split_ref_status_list(raw_value):
                    if ref not in target_ids:
                        report.add(
                            "ERROR", "BROKEN_REFERENCE", from_sheet, _row_id(row),
                            f"{from_col}의 참조값 '{ref}'이(가) {to_sheet}에 존재하지 않습니다.",
                        )


# [AI 추정 ≠ 검증 완료] 이 조합이 보이면 "AI가 추정한 값을 검증된 사실처럼
# 둔갑시키는" 가장 위험한 데이터 오염 패턴이므로 ERROR로 차단한다.
_AI_ESTIMATED_EVIDENCE_TYPES = {"ai_estimated_general_knowledge"}
# [IMP-18D-1] literature_reviewed/expert_reviewed도 "근거가 있다고 주장하는"
# 상태이므로, 근거 누락/AI추정-둔갑 검사 대상에 포함시킨다.
_REVIEWED_STATUSES = {"reviewed", "reviewed_as_candidate", "literature_reviewed", "expert_reviewed"}

_EVIDENCE_PRESENCE_RULES = [
    # (sheet, reviewStatus 컬럼, 근거 컬럼, 근거컬럼이 list인지)
    ("01_Allergens", "evidenceRefs", True),
    ("03_Ingredients", "sourceId", False),
    ("04_Ingredient_Allergens", "evidenceId", False),
    ("05_Dishes", "sourceId", False),
    ("07_Regulatory_Standards", "sourceId", False),
]


def _validate_evidence_requirements(sheets: dict, report: ValidationReport) -> None:
    for sheet_name, evidence_col, is_list in _EVIDENCE_PRESENCE_RULES:
        for row in sheets.get(sheet_name, []):
            review_status = row.get("reviewStatus")
            evidence_type = row.get("evidenceType")

            # 규칙 A: AI 추정인데 reviewed라고 적혀 있으면 모순 — ERROR.
            if evidence_type in _AI_ESTIMATED_EVIDENCE_TYPES and review_status in _REVIEWED_STATUSES:
                report.add(
                    "ERROR", "AI_ESTIMATE_MARKED_AS_REVIEWED", sheet_name, _row_id(row),
                    "evidenceType이 'ai_estimated_general_knowledge'인데 reviewStatus가 "
                    f"'{review_status}'입니다 — AI 추정을 검증 완료로 표시할 수 없습니다.",
                )

            # 규칙 B: reviewed류 상태인데 근거 컬럼이 비어 있으면 ERROR.
            # 단, evidenceType='definitional'(정의상 자명한 관계 — 예: "새우젓"의
            # "새우" 성분은 그 자체가 곧 새우이므로 외부 근거 문헌이 필요 없음)인
            # 경우는 예외로 둔다. "AI 추정을 검증완료로 둔갑시키지 않는다"는 규칙A는
            # 이 예외와 무관하게 그대로 적용된다(definitional은애초에 AI 추정이 아님).
            if review_status in _REVIEWED_STATUSES and evidence_type != "definitional":
                value = row.get(evidence_col)
                has_value = bool(_split_comma_list(value)) if is_list else bool(value)
                if not has_value:
                    report.add(
                        "ERROR", "MISSING_EVIDENCE_FOR_REVIEWED", sheet_name, _row_id(row),
                        f"reviewStatus='{review_status}'인데 근거 컬럼 '{evidence_col}'이(가) 비어 있습니다.",
                    )


# [IMP-18D-1] "AI가 문헌을 대조했다"와 "사람 전문가가 실제로 검토했다"를
# 데이터 자체가 거짓말하지 못하게 강제하는 규칙. §7 요구사항("실제 전문가가
# 확인하지 않은 자료를 expert_reviewed로 표시하지 않는다")을 코드로 구현한 것.
_REVIEWER_CONSISTENCY_SHEETS = ["04_Ingredient_Allergens", "02_Allergen_Aliases"]


def _validate_reviewer_consistency(sheets: dict, report: ValidationReport) -> None:
    for sheet_name in _REVIEWER_CONSISTENCY_SHEETS:
        for row in sheets.get(sheet_name, []):
            review_status = row.get("reviewStatus")
            reviewer_type = row.get("reviewerType") or ""
            evidence_scope = row.get("evidenceScope") or ""
            verified_at = row.get("verifiedAt")
            evidence_type = row.get("evidenceType")

            if review_status == "literature_reviewed":
                if reviewer_type != "ai_literature_check":
                    report.add(
                        "ERROR", "LITERATURE_REVIEWED_REQUIRES_AI_LITERATURE_CHECK", sheet_name, _row_id(row),
                        f"reviewStatus='literature_reviewed'인데 reviewerType='{reviewer_type}'입니다 "
                        "('ai_literature_check'여야 함).",
                    )
                if evidence_scope in ("", "none"):
                    report.add(
                        "ERROR", "LITERATURE_REVIEWED_REQUIRES_EVIDENCE_SCOPE", sheet_name, _row_id(row),
                        "reviewStatus='literature_reviewed'인데 evidenceScope가 비어있거나 'none'입니다 — "
                        "이 근거가 무엇의 범위를 증명하는지(법정 정의/국제표준/단일 연구/제조사별/탐사보도/일반상식) "
                        "명시해야 합니다.",
                    )
                if evidence_type != "literature_cross_checked":
                    report.add(
                        "ERROR", "LITERATURE_REVIEWED_REQUIRES_MATCHING_EVIDENCE_TYPE", sheet_name, _row_id(row),
                        f"reviewStatus='literature_reviewed'인데 evidenceType='{evidence_type}'입니다 "
                        "('literature_cross_checked'여야 함).",
                    )
                # evidenceScope가 "특정 문서를 인용한다"는 뜻의 범위(법정 정의/
                # 국제표준/단일연구/제조사별/탐사보도)라면 그 문서를 가리키는
                # evidenceId가 실제로 있어야 한다. 'general_culinary_knowledge'만
                # "특정 문서 없이도 자명한 일반 상식" 취급으로 예외를 둔다.
                _SPECIFIC_DOC_SCOPES = {
                    "legal_food_type_definition", "international_standard",
                    "academic_study_single_case", "manufacturer_product_specific",
                    "investigative_journalism",
                }
                if evidence_scope in _SPECIFIC_DOC_SCOPES and not row.get("evidenceId"):
                    report.add(
                        "ERROR", "EVIDENCE_SCOPE_REQUIRES_EVIDENCE_ID", sheet_name, _row_id(row),
                        f"evidenceScope='{evidence_scope}'는 특정 문서를 인용한다는 뜻인데 "
                        "evidenceId가 비어 있습니다.",
                    )

            if review_status == "expert_reviewed":
                if reviewer_type != "human_expert":
                    report.add(
                        "ERROR", "EXPERT_REVIEWED_REQUIRES_HUMAN_EXPERT", sheet_name, _row_id(row),
                        f"reviewStatus='expert_reviewed'인데 reviewerType='{reviewer_type}'입니다 — "
                        "실제 사람 전문가가 검토하지 않았다면 이 상태를 쓸 수 없습니다.",
                    )
                if not verified_at:
                    report.add(
                        "ERROR", "EXPERT_REVIEWED_REQUIRES_VERIFIED_DATE", sheet_name, _row_id(row),
                        "reviewStatus='expert_reviewed'인데 verifiedAt(전문가 검토 일자)이 비어 있습니다.",
                    )

            # 대칭 규칙: reviewerType='human_expert'라고 적어놓고 reviewStatus는
            # 'expert_reviewed'가 아닌 경우도 모순이다(예: pending인데 human_expert라고 우기는 것).
            if reviewer_type == "human_expert" and review_status != "expert_reviewed":
                report.add(
                    "ERROR", "HUMAN_EXPERT_REQUIRES_EXPERT_REVIEWED_STATUS", sheet_name, _row_id(row),
                    f"reviewerType='human_expert'인데 reviewStatus='{review_status}'입니다 "
                    "('expert_reviewed'여야 함) — 전문가가 봤다면서 상태를 안 올릴 수 없습니다.",
                )


def _normalize_alias_text(text: str) -> str:
    return text.strip().lower()


def _validate_alias_conflicts(sheets: dict, report: ValidationReport) -> None:
    # alias(정규화된 문자열) -> {allergenId -> 최초 발견 행}
    seen: dict[str, dict[str, Any]] = {}

    def register(alias_text: str, allergen_id: str, source: str, row_ref: Any) -> None:
        key = _normalize_alias_text(alias_text)
        if not key:
            return
        bucket = seen.setdefault(key, {})
        if allergen_id in bucket:
            report.add(
                "ERROR", "DUPLICATE_ALIAS", source, row_ref,
                f"동의어 '{alias_text}'가 같은 allergenId '{allergen_id}'에 중복 등록되어 있습니다.",
            )
        elif bucket:
            other_allergen, other_ref = next(iter(bucket.items()))
            report.add(
                "ERROR", "CONFLICTING_ALIAS", source, row_ref,
                f"동의어 '{alias_text}'가 서로 다른 성분('{other_allergen}' 행={other_ref} vs "
                f"'{allergen_id}' 행={row_ref})에 동시에 등록되어 있어 모호합니다.",
            )
        bucket[allergen_id] = row_ref

    # 1) 01_Allergens.legacyIds도 사실상 "별칭"이므로 같은 네임스페이스에서 함께 검사한다
    #    (지시사항: "기존 legacy ID와 canonical ID의 관계 확인").
    for row in sheets.get("01_Allergens", []):
        for legacy in _split_comma_list(row.get("legacyIds")):
            register(legacy, row.get("id"), "01_Allergens.legacyIds", row.get("id"))

    # 2) 02_Allergen_Aliases
    for row in sheets.get("02_Allergen_Aliases", []):
        alias = row.get("alias")
        allergen_id = row.get("allergenId")
        if alias and allergen_id:
            register(alias, allergen_id, "02_Allergen_Aliases", _row_id(row))


def _validate_self_reference_cycles(sheets: dict, report: ValidationReport) -> None:
    for spec in schema.SELF_REFERENTIAL_FIELDS:
        sheet_name, column = spec["sheet"], spec["column"]
        rows = sheets.get(sheet_name, [])
        if not rows or column not in rows[0]:
            # 지금 스키마엔 이 컬럼이 아예 없음 — 정상(위 schema.py 주석 참고).
            continue
        edges = {row["id"]: _split_comma_list(row.get(column)) for row in rows if row.get("id")}
        cycles = find_cycles(edges)
        for cycle in cycles:
            report.add(
                "ERROR", "CIRCULAR_REFERENCE", sheet_name, " -> ".join(cycle),
                f"'{column}' 자기참조에서 순환이 발견되었습니다: {' -> '.join(cycle)}",
            )


def _validate_shared_allergens_compatibility(sheets: dict, js_path: str, report: ValidationReport) -> None:
    """[5-4] 기존 shared/allergens.js(런타임 서비스의 실제 소스 오브 트루스)와
    01_Allergens의 'active' 행이 정확히 일치하는지 확인한다.

    주의: 두 파일에 같은 성격의 데이터가 존재할 때 "어느 쪽이 원본인가"는
    다음과 같이 명시한다 — **활성(active) 21종의 id/legacyIds/labels/icon은
    지금도 shared/allergens.js가 원본이고, Excel의 01_Allergens 행은 그
    원본을 미러링한 문서용 사본이다.** (IMP-11에서 실제 서비스 코드가
    shared/allergens.js를 require/로드하도록 이미 연결되어 있기 때문.)
    반대로 candidate 18종, Ingredients 이하 모든 시트는 Excel이 유일한
    원본이다 — 그런 JS 파일 자체가 아직 없다.
    """
    try:
        js_entries = {e.id: e for e in read_shared_allergens_js(js_path)}
    except OSError as exc:
        report.add("ERROR", "SHARED_JS_UNREADABLE", "(compat)", "-", f"{js_path}를 읽을 수 없습니다: {exc}")
        return

    active_rows = {r["id"]: r for r in sheets.get("01_Allergens", []) if r.get("registryStatus") == "active"}

    js_ids = set(js_entries.keys())
    active_ids = set(active_rows.keys())

    if js_ids != active_ids:
        only_js = js_ids - active_ids
        only_excel = active_ids - js_ids
        report.add(
            "ERROR", "ACTIVE_ID_SET_MISMATCH", "01_Allergens", "-",
            f"shared/allergens.js의 id 집합과 Excel의 active id 집합이 다릅니다. "
            f"JS에만 있음: {sorted(only_js)} / Excel active에만 있음: {sorted(only_excel)}",
        )

    for allergen_id in sorted(js_ids & active_ids):
        js_entry = js_entries[allergen_id]
        excel_row = active_rows[allergen_id]

        excel_legacy = set(_split_comma_list(excel_row.get("legacyIds")))
        if set(js_entry.legacy_ids) != excel_legacy:
            report.add(
                "ERROR", "LEGACY_ID_MISMATCH", "01_Allergens", allergen_id,
                f"legacyIds 불일치 — JS: {js_entry.legacy_ids}, Excel: {sorted(excel_legacy)}",
            )

        for lang in ("ko", "en", "ja", "zh", "vi", "es"):
            js_label = js_entry.labels.get(lang, "")
            excel_label = excel_row.get(lang, "")
            if js_label != excel_label:
                report.add(
                    "ERROR", "LABEL_MISMATCH", "01_Allergens", allergen_id,
                    f"언어 '{lang}' 명칭 불일치 — JS: '{js_label}', Excel: '{excel_label}'",
                )
