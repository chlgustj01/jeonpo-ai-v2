"""scripts/food_knowledge/extract.py

[IMP-18C] ETL의 "E"(Extract) 단계.

ETL이란: Extract(원본에서 데이터를 "있는 그대로" 꺼내기) → Transform(꺼낸
데이터를 검증하고 서비스가 쓸 수 있는 형태로 가공하기) → Load(가공된
결과를 최종 산출물로 저장하기), 세 단계를 가리키는 데이터 엔지니어링의
표준 용어다. 이 파일은 그중 첫 단계만 담당하며, **검증이나 가공은 하지
않는다** — Excel 셀 값을 Python 값으로 옮기는 것, 그리고 "옮기는 과정"
자체에서 생길 수 있는 사고(자료형이 이상하게 바뀌는 등)를 감지해 경고로
남기는 것까지만 한다. 어떤 값이 "허용되는 값인지"는 validate.py의 책임이다
(관심사 분리 — Extract는 옮기기만, Transform은 판단하기만).

원본 .xlsx 파일은 읽기 전용으로만 연다(openpyxl.load_workbook(..., data_only=True)
에 쓰기 모드를 주지 않음) — 어떤 경우에도 원본을 자동 수정하지 않는다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import openpyxl

from . import schema


@dataclass
class ExtractWarning:
    sheet: str
    row: int  # 1-based, 헤더 포함(엑셀에서 보이는 행 번호와 동일)
    column: str
    message: str


@dataclass
class ExtractResult:
    sheets: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    warnings: list[ExtractWarning] = field(default_factory=list)
    fatal_errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.fatal_errors


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def _normalize_cell(value: Any) -> Any:
    """셀 값 하나를 정규화한다. 숫자/날짜/문자열 전부 다루되, 판단(검증)은 하지 않는다."""
    if value is None:
        return None
    if isinstance(value, str):
        # 앞뒤 공백 — Excel에서 셀을 복사-붙여넣기하다 보면 자주 섞여 들어온다.
        # 공백 하나 차이로 "soybean" != "soybean "처럼 FK 매칭이 깨지는 사고를 막는다.
        return value.strip()
    return value


def _coerce_id_like(value: Any, sheet: str, row_num: int, col: str, warnings: list[ExtractWarning]) -> Any:
    """[Excel 숫자형 ID 변환 문제] 대응.

    Excel/openpyxl은 셀에 "007"처럼 보이는 값을 입력하면 자동으로 숫자 7로
    해석해버리는 경우가 흔하다(선행 0 소실). id류 컬럼에서 셀의 실제 타입이
    int/float이면 — 지금 우리 데이터엔 전부 문자열 id라 정상적으로는 일어나지
    않아야 할 일이므로 — 경고로 남기고, 눈에 보이는 값 그대로 문자열로
    강제 변환한다(실수로 정수로 바뀌어 있어도 서비스가 죽지 않게 방어).
    """
    if isinstance(value, bool):
        # bool은 Python에서 int의 하위 타입이라 isinstance(value, int)에 걸리므로 먼저 분리.
        warnings.append(ExtractWarning(sheet, row_num, col, f"id 컬럼에 불리언 값({value})이 들어있음 — 문자열로 강제 변환"))
        return str(value)
    if isinstance(value, (int, float)):
        warnings.append(
            ExtractWarning(
                sheet, row_num, col,
                f"id 컬럼이 숫자형으로 저장되어 있음(원본 셀 값={value!r}) — "
                "Excel이 자동으로 숫자로 인식했을 가능성(선행 0 소실 등). 문자열로 강제 변환함",
            )
        )
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value)
    return value


def extract_workbook(path: str) -> ExtractResult:
    result = ExtractResult()

    try:
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    except FileNotFoundError:
        result.fatal_errors.append(f"파일을 찾을 수 없습니다: {path}")
        return result
    except Exception as exc:  # noqa: BLE001 - 사용자에게 원인을 그대로 보여주기 위해 광범위하게 포착
        result.fatal_errors.append(f"Excel 파일을 여는 중 오류: {exc}")
        return result

    actual_sheet_names = set(wb.sheetnames)
    expected = set(schema.SHEET_NAMES)
    missing = expected - actual_sheet_names
    unexpected = actual_sheet_names - expected
    if missing:
        result.fatal_errors.append(f"[예상하지 못한 시트 구조 변경] 다음 시트가 없습니다: {sorted(missing)}")
    if unexpected:
        result.warnings.append(
            ExtractWarning("(workbook)", 0, "(sheet)", f"스키마에 정의되지 않은 시트 발견(무시함): {sorted(unexpected)}")
        )
    if not result.ok:
        return result

    for sheet_name in schema.SHEET_NAMES:
        ws = wb[sheet_name]
        rows_iter = ws.iter_rows(values_only=True)

        try:
            header_row = next(rows_iter)
        except StopIteration:
            result.fatal_errors.append(f"[예상하지 못한 시트 구조 변경] '{sheet_name}' 시트에 헤더 행조차 없습니다.")
            continue

        headers = [str(h).strip() if h is not None else "" for h in header_row]

        # [중복 헤더] 검출 — 같은 이름의 컬럼이 두 번 있으면 어느 쪽 값을
        # 꺼내야 할지 알 수 없어 이후 모든 컬럼 매핑이 신뢰할 수 없어진다.
        seen_headers: dict[str, int] = {}
        duplicate_headers = []
        for h in headers:
            if not h:
                continue
            seen_headers[h] = seen_headers.get(h, 0) + 1
            if seen_headers[h] == 2:
                duplicate_headers.append(h)
        if duplicate_headers:
            result.fatal_errors.append(
                f"[중복 헤더] '{sheet_name}' 시트에 중복된 컬럼명이 있습니다: {duplicate_headers}"
            )
            continue

        expected_cols = schema.SHEET_COLUMNS.get(sheet_name, [])
        missing_cols = [c for c in expected_cols if c not in headers]
        if missing_cols:
            result.fatal_errors.append(
                f"[예상하지 못한 시트 구조 변경] '{sheet_name}' 시트에 예상된 컬럼이 없습니다: {missing_cols} "
                f"(실제 헤더: {headers})"
            )
            continue

        col_index = {h: i for i, h in enumerate(headers) if h}
        id_like_cols = {c for c in expected_cols if c == "id" or c.endswith("Id")}

        extracted_rows: list[dict[str, Any]] = []
        for row_num, raw_row in enumerate(rows_iter, start=2):  # 2행부터(1행=헤더)
            # [빈 행] 처리 — 모든 셀이 비어 있으면 그냥 건너뛴다(에러도 경고도 아님,
            # Excel에서 흔히 생기는 자연스러운 상황).
            if raw_row is None or all(_is_blank(v) for v in raw_row):
                continue

            row_dict: dict[str, Any] = {}
            has_error_cell = False
            for col_name in expected_cols:
                idx = col_index[col_name]
                raw_value = raw_row[idx] if idx < len(raw_row) else None

                # [오류 셀] — openpyxl은 수식 오류(#REF!, #DIV/0! 등)를 문자열로
                # 돌려주는 경우가 있다. 이런 값을 그대로 쓰면 눈에 보이지 않는
                # 오염이 데이터에 섞인다.
                if isinstance(raw_value, str) and re.match(r"^#(REF|DIV/0|VALUE|NAME|NULL|N/A)!?$", raw_value.strip()):
                    result.warnings.append(
                        ExtractWarning(sheet_name, row_num, col_name, f"[오류 셀] Excel 오류값 발견: {raw_value!r}")
                    )
                    has_error_cell = True
                    row_dict[col_name] = None
                    continue

                value = _normalize_cell(raw_value)

                if col_name in id_like_cols:
                    value = _coerce_id_like(value, sheet_name, row_num, col_name, result.warnings)

                row_dict[col_name] = value

            row_dict["_row_num"] = row_num
            row_dict["_sheet"] = sheet_name
            row_dict["_had_error_cell"] = has_error_cell
            extracted_rows.append(row_dict)

        result.sheets[sheet_name] = extracted_rows

    wb.close()
    return result
