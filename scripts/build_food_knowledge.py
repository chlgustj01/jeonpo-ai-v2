#!/usr/bin/env python
"""scripts/build_food_knowledge.py

[IMP-18C] Food_Allergen_Master.xlsx -> data/generated/*.json

Extract(scripts/food_knowledge/extract.py) → Transform/Validate
(scripts/food_knowledge/validate.py, transform.py) → Load(load.py) 순서의
ETL 파이프라인 전체를 실행한다.

**Fail-closed**: 검증(validate)에서 Error가 하나라도 있으면, Transform도
Load도 실행하지 않고 즉시 중단한다(exit code 1). 이미 data/generated/에
있던 "이전의 정상" JSON 파일은 전혀 건드리지 않는다 — IMP-11의
checkDishSafety가 "판단 불가하면 안전 쪽(red)으로 실패한다"고 한 것과
같은 철학을, 여기서는 "검증 불가하면 아예 아무것도 바꾸지 않는다"로
적용한 것이다.

실행 방법: py scripts/build_food_knowledge.py
"""

from __future__ import annotations

import argparse
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.dirname(__file__))

from food_knowledge.extract import extract_workbook  # noqa: E402
from food_knowledge.validate import validate_extracted  # noqa: E402
from food_knowledge.transform import transform  # noqa: E402
from food_knowledge.load import write_outputs  # noqa: E402
from food_knowledge.report import build_report_markdown, print_summary  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_WORKBOOK = os.path.join(ROOT, "data", "master", "Food_Allergen_Master.xlsx")
DEFAULT_SHARED_JS = os.path.join(ROOT, "shared", "allergens.js")
DEFAULT_OUTPUT_DIR = os.path.join(ROOT, "data", "generated")


def run_build(workbook_path: str, shared_js_path: str, output_dir: str, report_path: str | None):
    """테스트에서 경로를 자유롭게 바꿔치기할 수 있도록 로직을 함수로 분리했다
    (실제 Master DB를 훼손하지 않고 임시 fixture로 테스트하기 위한 전제조건)."""
    extracted = extract_workbook(workbook_path)
    if not extracted.ok:
        return {"success": False, "stage": "extract", "fatal_errors": extracted.fatal_errors}

    validation = validate_extracted(extracted, shared_allergens_js_path=shared_js_path)

    if not validation.ok:
        if report_path:
            report_md = build_report_markdown(
                extracted=extracted, validation=validation, transformed=None, manifest=None, mode="build"
            )
            with open(report_path, "w", encoding="utf-8") as f:
                f.write(report_md)
        return {"success": False, "stage": "validate", "validation": validation}

    transformed = transform(extracted)
    validation_summary = {"errors": len(validation.errors), "warnings": len(validation.warnings), "status": "passed"}
    manifest = write_outputs(
        transformed, output_dir=output_dir, source_workbook_path=workbook_path, validation_summary=validation_summary
    )

    if report_path:
        report_md = build_report_markdown(
            extracted=extracted, validation=validation, transformed=transformed, manifest=manifest, mode="build"
        )
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(report_md)

    return {"success": True, "validation": validation, "transformed": transformed, "manifest": manifest}


def main() -> int:
    parser = argparse.ArgumentParser(description="Food_Allergen_Master.xlsx -> data/generated/*.json")
    parser.add_argument("--workbook", default=DEFAULT_WORKBOOK)
    parser.add_argument("--shared-js", default=DEFAULT_SHARED_JS)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--report-path", default=os.path.join(DEFAULT_OUTPUT_DIR, "build-report.md"))
    args = parser.parse_args()

    result = run_build(args.workbook, args.shared_js, args.output_dir, args.report_path)

    if not result["success"]:
        print(f"[빌드 실패] 단계: {result['stage']}")
        if result["stage"] == "extract":
            for e in result["fatal_errors"]:
                print(f"  - {e}")
        else:
            print_summary(result["validation"])
        print("기존 data/generated/*.json 파일은 변경되지 않았습니다(fail-closed).")
        return 1

    print_summary(result["validation"])
    print(f"빌드 성공 — dataVersion={result['manifest']['dataVersion']}, "
          f"sourceHash={result['manifest']['sourceHash'][:12]}...")
    print(f"출력 디렉터리: {args.output_dir}")
    if args.report_path:
        print(f"빌드 보고서: {args.report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
