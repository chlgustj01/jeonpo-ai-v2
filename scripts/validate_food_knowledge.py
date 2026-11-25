#!/usr/bin/env python
"""scripts/validate_food_knowledge.py

[IMP-18C] data/master/Food_Allergen_Master.xlsx를 "검증만" 한다 — 아무
JSON도 쓰지 않는다(쓰기는 build_food_knowledge.py의 몫). 코드 리뷰/CI에서
"지금 Excel이 깨끗한 상태인가?"만 빠르게 확인하고 싶을 때 쓰는 용도다.

build_food_knowledge.py와 검증 로직(food_knowledge.validate)을 그대로
공유한다 — "변환과 검증을 한 프로그램으로 통합하지 않은 이유"는
docs/devlog/IMP-18C.md §2에 설명되어 있다(요약: 쓰기 없는 린트 용도와
실제 빌드 용도를 분리하되, 로직 자체는 food_knowledge/ 패키지 하나에만
존재해 중복되지 않는다).

실행 방법(Windows에서 python/python3는 Microsoft Store 스텁으로 막혀
있을 수 있어 `py` 런처를 쓴다 — docs/devlog/IMP-18C.md §7 참고):
    py scripts/validate_food_knowledge.py
    py scripts/validate_food_knowledge.py --workbook path/to/other.xlsx --report-path out.md
"""

from __future__ import annotations

import argparse
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")  # 한글/일본어 출력 시 Windows 콘솔 인코딩 문제 방지
sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.dirname(__file__))

from food_knowledge.extract import extract_workbook  # noqa: E402
from food_knowledge.validate import validate_extracted  # noqa: E402
from food_knowledge.report import build_report_markdown, print_summary  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_WORKBOOK = os.path.join(ROOT, "data", "master", "Food_Allergen_Master.xlsx")
DEFAULT_SHARED_JS = os.path.join(ROOT, "shared", "allergens.js")


def main() -> int:
    parser = argparse.ArgumentParser(description="Food_Allergen_Master.xlsx 검증(쓰기 없음)")
    parser.add_argument("--workbook", default=DEFAULT_WORKBOOK)
    parser.add_argument("--shared-js", default=DEFAULT_SHARED_JS)
    parser.add_argument("--report-path", default=None, help="검증 보고서(Markdown)를 저장할 경로(선택)")
    args = parser.parse_args()

    extracted = extract_workbook(args.workbook)
    if not extracted.ok:
        print("[치명적 오류] Excel 추출 단계에서 실패했습니다:")
        for e in extracted.fatal_errors:
            print(f"  - {e}")
        return 1

    validation = validate_extracted(extracted, shared_allergens_js_path=args.shared_js)
    print_summary(validation)

    if args.report_path:
        report_md = build_report_markdown(
            extracted=extracted, validation=validation, transformed=None, manifest=None, mode="validate-only"
        )
        with open(args.report_path, "w", encoding="utf-8") as f:
            f.write(report_md)
        print(f"보고서 저장: {args.report_path}")

    return 0 if validation.ok else 1


if __name__ == "__main__":
    sys.exit(main())
