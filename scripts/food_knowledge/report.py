"""scripts/food_knowledge/report.py

[IMP-18C] 사람이 읽는 검증/빌드 보고서(Markdown)를 만든다.
Error와 Warning을 섹션으로 분리하고, §10에서 요구한 모든 항목을 담는다.
"""

from __future__ import annotations

from typing import Any

from .extract import ExtractResult
from .validate import ValidationReport
from .transform import TransformOutput


def build_report_markdown(
    *,
    extracted: ExtractResult,
    validation: ValidationReport,
    transformed: TransformOutput | None,
    manifest: dict | None,
    mode: str,  # "validate-only" | "build"
) -> str:
    lines: list[str] = []
    lines.append(f"# 식품 지식 데이터 파이프라인 — {'검증' if mode == 'validate-only' else '빌드'} 보고서")
    lines.append("")

    lines.append("## 1. 원본 시트별 전체 데이터 수")
    lines.append("")
    lines.append("| 시트 | 행 수 |")
    lines.append("|---|---:|")
    for sheet_name, rows in extracted.sheets.items():
        lines.append(f"| {sheet_name} | {len(rows)} |")
    lines.append("")

    lines.append("## 2. 전체 검증 결과")
    lines.append("")
    status = "**통과(PASS)**" if validation.ok else "**실패(FAIL)**"
    lines.append(f"- 결과: {status}")
    lines.append(f"- Error(치명적 오류): {len(validation.errors)}건")
    lines.append(f"- Warning(경고): {len(validation.warnings)}건")
    lines.append("")

    if validation.errors:
        lines.append("### 2-1. Error 목록")
        lines.append("")
        lines.append("| 코드 | 시트 | 대상 | 메시지 |")
        lines.append("|---|---|---|---|")
        for f in validation.errors:
            lines.append(f"| {f.code} | {f.sheet} | {f.row} | {f.message} |")
        lines.append("")

    if validation.warnings:
        lines.append("### 2-2. Warning 목록")
        lines.append("")
        lines.append("| 코드 | 시트 | 대상 | 메시지 |")
        lines.append("|---|---|---|---|")
        for f in validation.warnings:
            lines.append(f"| {f.code} | {f.sheet} | {f.row} | {f.message} |")
        lines.append("")

    # 코드별 하위 집계 — 사용자가 요청한 "중복 ID/참조 무결성/출처 누락/호환성" 분류.
    def count_codes(findings, codes):
        return sum(1 for f in findings if f.code in codes)

    lines.append("## 3. 요청 항목별 요약")
    lines.append("")
    lines.append(f"- 중복 ID(DUPLICATE_ID): {count_codes(validation.errors, {'DUPLICATE_ID'})}건")
    lines.append(
        f"- 참조 무결성 오류(BROKEN_REFERENCE): "
        f"{count_codes(validation.errors, {'BROKEN_REFERENCE'})}건"
    )
    lines.append(
        f"- 출처 누락(MISSING_EVIDENCE_FOR_REVIEWED): "
        f"{count_codes(validation.errors, {'MISSING_EVIDENCE_FOR_REVIEWED'})}건"
    )
    lines.append(
        f"- AI 추정이 검증완료로 잘못 표시된 경우(AI_ESTIMATE_MARKED_AS_REVIEWED): "
        f"{count_codes(validation.errors, {'AI_ESTIMATE_MARKED_AS_REVIEWED'})}건"
    )
    lines.append(
        f"- 기존 21종 ID 호환성 오류(ACTIVE_ID_SET_MISMATCH/LEGACY_ID_MISMATCH/LABEL_MISMATCH): "
        f"{count_codes(validation.errors, {'ACTIVE_ID_SET_MISMATCH', 'LEGACY_ID_MISMATCH', 'LABEL_MISMATCH'})}건"
    )
    lines.append(
        f"- 동의어 충돌(CONFLICTING_ALIAS/DUPLICATE_ALIAS): "
        f"{count_codes(validation.errors, {'CONFLICTING_ALIAS', 'DUPLICATE_ALIAS'})}건"
    )
    lines.append("")

    lines.append("## 4. 데이터 이용 조건 관련 제한")
    lines.append("")
    unverified = [r for r in extracted.sheets.get("08_Evidence_Sources", []) if r.get("reliability") == "unverified"]
    if unverified:
        lines.append(f"다음 {len(unverified)}개 출처는 신뢰도가 `unverified`로 표시되어 있어, "
                      "이들 출처에서 가져온 원문/제한 데이터는 공개 배포용 산출물에 포함하지 않았습니다"
                      "(각주만 인용, citationOnly=true로 표시):")
        lines.append("")
        for r in unverified:
            lines.append(f"- {r['id']}: {r.get('title')} ({r.get('url')})")
        lines.append("")
    else:
        lines.append("(이번 빌드에서는 `unverified` 출처가 없었습니다.)")
        lines.append("")

    if transformed is not None:
        lines.append("## 5. 서비스용으로 생성된 데이터 수")
        lines.append("")
        lines.append(f"- allergen-registry.json (active): {len(transformed.allergen_registry)}건")
        lines.append(f"- allergen-candidates.json (candidate): {len(transformed.allergen_candidates)}건")
        lines.append(f"- allergen-aliases.json (reviewed만): {len(transformed.allergen_aliases)}건")
        lines.append(
            f"- ingredient-knowledge.json: ingredients {len(transformed.ingredient_knowledge.get('ingredients', []))}건, "
            f"confirmedRelations(reviewed만) {len(transformed.ingredient_knowledge.get('confirmedRelations', []))}건"
        )
        lines.append(
            f"- dishes-demo.json: dishes {len(transformed.dishes_demo.get('dishes', []))}건, "
            f"restaurantVerification {len(transformed.dishes_demo.get('restaurantVerification', []))}건(전부 데모)"
        )
        lines.append(f"- regulatory-standards.json: {len(transformed.regulatory_standards)}건")
        lines.append(f"- evidence-sources.json: {len(transformed.evidence_sources)}건")
        lines.append("")

        lines.append("## 6. 검토 대기 데이터(서비스 JSON에서 제외됨) — 관리용 목록")
        lines.append("")
        lines.append(
            f"- 알레르겐 별칭 대기: {len(transformed.pending_aliases)}건 "
            "(AI가 추정한 영문 표기 변형 — 전문가 검토 전)"
        )
        lines.append(
            f"- 식재료-알레르겐 관계 대기: {len(transformed.pending_ingredient_relations)}건 "
            "(복합 식재료 실제 성분 추정 — 전문가 검토 전)"
        )
        lines.append(
            f"- 역학 연구 대기: {len(transformed.pending_epidemiology)}건 "
            "(원문 미열람 또는 부분검증)"
        )
        lines.append("")
        if transformed.pending_ingredient_relations:
            lines.append("### 6-1. 식재료-알레르겐 관계 대기 목록(상위 일부)")
            lines.append("")
            lines.append("| ingredientId | allergenId | relationType | reviewStatus |")
            lines.append("|---|---|---|---|")
            for r in transformed.pending_ingredient_relations[:20]:
                lines.append(f"| {r['ingredientId']} | {r['allergenId']} | {r['relationType']} | {r['reviewStatus']} |")
            lines.append("")

    if manifest is not None:
        lines.append("## 7. 빌드 메타데이터(knowledge-manifest.json)")
        lines.append("")
        for k, v in manifest.items():
            if k == "recordCounts":
                continue
            lines.append(f"- {k}: {v}")
        lines.append("")

    lines.append("## 8. 기존 shared/allergens.js 호환성")
    lines.append("")
    compat_errors = [
        f for f in validation.errors
        if f.code in {"ACTIVE_ID_SET_MISMATCH", "LEGACY_ID_MISMATCH", "LABEL_MISMATCH", "SHARED_JS_UNREADABLE"}
    ]
    if compat_errors:
        lines.append("**호환성 불일치 발견** — 아래 항목을 확인하세요.")
        for f in compat_errors:
            lines.append(f"- {f.message}")
    else:
        lines.append("`shared/allergens.js`의 21종(id/legacyIds/6개 언어 명칭)과 "
                      "Excel의 active 21종이 완전히 일치합니다. "
                      "(어느 쪽이 원본인지는 docs/devlog/IMP-18C.md §5-4 참고 — "
                      "지금은 shared/allergens.js가 여전히 서비스의 원본입니다.)")
    lines.append("")

    return "\n".join(lines)


def print_summary(validation: ValidationReport) -> None:
    print(f"검증 결과: {'PASS' if validation.ok else 'FAIL'} "
          f"(Error {len(validation.errors)}건, Warning {len(validation.warnings)}건)")
    for f in validation.errors:
        print(f"  [ERROR] {f.code} | {f.sheet} | {f.row} | {f.message}")
    for f in validation.warnings:
        print(f"  [WARN ] {f.code if hasattr(f, 'code') else ''} {f.sheet} | {f.row} | {f.message}")
