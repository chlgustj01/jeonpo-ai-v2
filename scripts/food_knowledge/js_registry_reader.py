"""scripts/food_knowledge/js_registry_reader.py

[IMP-18C] shared/allergens.js를 "읽기 전용"으로 파싱한다.

Python에는 Node.js의 require()가 없으므로 실제로 JS 코드를 실행하지 않고,
그 파일이 항상 한 항목을 한 줄에 쓰는 일관된 형식(IMP-11에서 우리가 직접
그렇게 작성함)이라는 점을 이용해 정규식으로 값을 뽑아낸다.

**이 모듈은 shared/allergens.js를 단 한 바이트도 수정하지 않는다** — 오직
읽어서 Python 딕셔너리로 바꾸는 것뿐이며, 이 값은 5-4 호환성 "검증"에만
쓰인다(§5-4: "임의로 변경하지 않는다. 호환성 검증만 진행한다").
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_ENTRY_RE = re.compile(
    r"\{\s*id:\s*'(?P<id>[^']+)'\s*,\s*legacyIds:\s*\[(?P<legacy>[^\]]*)\]\s*,"
    r"\s*labels:\s*\{(?P<labels>[^}]*)\}\s*,\s*icon:\s*'(?P<icon>[^']*)'\s*\}",
)
_LABEL_RE = re.compile(r"(?P<lang>ko|en|ja|zh|vi|es):\s*'(?P<text>[^']*)'")
_QUOTED_RE = re.compile(r"'([^']*)'")


@dataclass
class JsAllergenEntry:
    id: str
    legacy_ids: list[str] = field(default_factory=list)
    labels: dict[str, str] = field(default_factory=dict)
    icon: str = ""


def read_shared_allergens_js(path: str) -> list[JsAllergenEntry]:
    with open(path, "r", encoding="utf-8") as f:
        source = f.read()

    entries: list[JsAllergenEntry] = []
    for match in _ENTRY_RE.finditer(source):
        legacy_ids = _QUOTED_RE.findall(match.group("legacy"))
        labels = {m.group("lang"): m.group("text") for m in _LABEL_RE.finditer(match.group("labels"))}
        entries.append(
            JsAllergenEntry(
                id=match.group("id"),
                legacy_ids=legacy_ids,
                labels=labels,
                icon=match.group("icon"),
            )
        )
    return entries
