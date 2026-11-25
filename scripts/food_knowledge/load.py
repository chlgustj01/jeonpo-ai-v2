"""scripts/food_knowledge/load.py

[IMP-18C] ETL의 "L"(Load) 단계 — 가공된 데이터를 실제 파일로 저장한다.

이 모듈에서 설명할 데이터 엔지니어링 개념 두 가지:

  - Serialization(직렬화): 메모리 안의 Python 딕셔너리/리스트를, 디스크에
    저장하거나 네트워크로 보낼 수 있는 "문자열/바이트" 형태로 바꾸는 것.
    여기서는 json.dumps가 그 역할을 한다. ensure_ascii=False로 줘야
    한글/일본어가 "\\uXXXX" 이스케이프 범벅이 아니라 사람이 읽을 수 있는
    글자 그대로 저장된다.

  - Deterministic Build(결정론적 빌드): "같은 입력 → 항상 같은 출력"이
    보장되는 빌드. 이게 왜 중요하냐면: 예를 들어 Git에서 두 커밋의 JSON
    산출물을 diff했을 때, 실제 데이터가 하나도 안 바뀌었는데도 "생성
    시각"이 달라 전체 파일이 다 바뀐 것처럼 보이면 diff가 무의미해진다.
    그래서 "내용 해시(dataVersion)"는 타임스탬프를 빼고 계산하고,
    "생성 시각(generatedAt)"은 따로 분리해서 manifest에만 넣는다.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from typing import Any

from .transform import TransformOutput

SCHEMA_VERSION = "1.0.0"  # schema.py의 시트/컬럼 구조 자체가 바뀔 때만 올린다.


def _json_default(obj: Any) -> Any:
    if is_dataclass(obj) and not isinstance(obj, type):
        return asdict(obj)
    raise TypeError(f"JSON으로 직렬화할 수 없는 타입: {type(obj)}")


def _dumps_deterministic(data: Any) -> str:
    # sort_keys=True가 "결정론적 빌드"의 핵심 — 딕셔너리 키 순서가 매번
    # 달라지는 것(Python 3.7+는 삽입 순서를 보존하지만, 여기선 그래도 명시적으로
    # 정렬해 "내용이 같으면 바이트까지 같다"를 보장한다)을 막는다.
    return json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True, default=_json_default) + "\n"


def _sha256_of_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _sha256_of_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


OUTPUT_FILES = [
    ("allergen-registry.json", "allergen_registry"),
    ("allergen-candidates.json", "allergen_candidates"),
    ("allergen-aliases.json", "allergen_aliases"),
    ("ingredient-knowledge.json", "ingredient_knowledge"),
    ("dishes-demo.json", "dishes_demo"),
    ("regulatory-standards.json", "regulatory_standards"),
    ("evidence-sources.json", "evidence_sources"),
]


def write_outputs(
    transformed: TransformOutput,
    *,
    output_dir: str,
    source_workbook_path: str,
    validation_summary: dict,
) -> dict:
    """임시 디렉터리에 전부 쓴 뒤, 전부 성공했을 때만 최종 위치로 옮긴다
    (원자적 교체 — Atomic write). 지시사항: "검증 실패 시 기존 정상 JSON
    파일을 불완전한 결과로 덮어쓰지 않는다. 임시 파일에서 모든 검증을
    완료한 뒤 정상 결과만 교체하는 방식을 검토한다"를 그대로 구현한 것.

    여기 도달했다는 것 자체가 이미 validate.py의 ERROR가 0건이었다는
    뜻이다(build_food_knowledge.py가 그 게이트를 먼저 통과시킨다) — 그래도
    이 함수 자체도 "쓰는 도중 디스크가 꽉 찬다" 같은 사고에 대비해
    임시 폴더 방식을 쓴다.
    """
    os.makedirs(output_dir, exist_ok=True)
    tmp_dir = tempfile.mkdtemp(prefix=".build-tmp-", dir=output_dir)

    try:
        file_contents: dict[str, str] = {}
        for filename, attr_name in OUTPUT_FILES:
            value = getattr(transformed, attr_name)
            file_contents[filename] = _dumps_deterministic(value)

        # dataVersion: generatedAt을 "뺀" 내용만으로 계산해야 재실행해도 값이
        # 같아야 한다(결정론적 빌드 검증, TC-18C-13이 바로 이걸 확인한다).
        concatenated = "".join(file_contents[name] for name, _ in OUTPUT_FILES)
        data_version = _sha256_of_text(concatenated)[:16]
        source_hash = _sha256_of_file(source_workbook_path)

        record_counts = {name: _count_records(getattr(transformed, attr)) for name, attr in OUTPUT_FILES}

        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "dataVersion": data_version,
            "sourceWorkbook": os.path.basename(source_workbook_path),
            "sourceHash": source_hash,
            "recordCounts": record_counts,
            "validationStatus": validation_summary,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        file_contents["knowledge-manifest.json"] = _dumps_deterministic(manifest)

        for filename, content in file_contents.items():
            with open(os.path.join(tmp_dir, filename), "w", encoding="utf-8") as f:
                f.write(content)

        for filename in file_contents:
            final_path = os.path.join(output_dir, filename)
            tmp_path = os.path.join(tmp_dir, filename)
            os.replace(tmp_path, final_path)  # 같은 파일시스템 내 원자적 교체(move)

        return manifest
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _count_records(value: Any) -> int:
    if isinstance(value, list):
        return len(value)
    if isinstance(value, dict):
        # ingredient_knowledge/dishes_demo처럼 {"ingredients":[...], "confirmedRelations":[...]}
        # 형태인 경우, list인 값들의 합계를 "레코드 수"로 센다.
        return sum(len(v) for v in value.values() if isinstance(v, list))
    return 0
