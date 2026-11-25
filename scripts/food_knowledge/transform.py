"""scripts/food_knowledge/transform.py

[IMP-18C] ETL의 "T"(Transform) 단계 중 "가공" 부분 — validate.py가
"문제 없음(report.ok)"을 확인해준 데이터만 여기로 들어온다는 전제 하에,
Excel 원시 데이터를 서비스가 바로 쓸 수 있는 모양으로 재구성한다.

핵심 원칙(§6 데이터 배포 정책 그대로 코드화):
  - active ↔ candidate: 서로 다른 파일로 물리적으로 분리한다 — candidate
    파일을 실수로 risk-judgment 코드가 import해도 "이건 자동 적용 대상이
    아니다"라는 필드(autoApplyToRiskJudgment=False)가 바로 보이게 한다.
  - reviewed ↔ pending_*: pending 상태인 관계 데이터는 "서비스용 JSON"에
    아예 넣지 않는다(§8 지시 그대로) — 대신 build_food_knowledge.py가
    report.py를 통해 사람이 읽는 보고서에만 남긴다.
  - demo_placeholder/demo_content: 별도 파일(dishes-demo.json)로 분리하고
    모든 레코드에 isDemo=True를 박아 넣어, 이 파일을 실수로 "실제 검증된
    매장 정보"처럼 쓰는 사고를 구조적으로 막는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .extract import ExtractResult


def _split_comma_list(value: Any) -> list[str]:
    if value is None or (isinstance(value, str) and not value.strip()):
        return []
    return [p.strip() for p in str(value).split(",") if p.strip()]


def _split_ref_status_list(value: Any) -> list[dict[str, str]]:
    out = []
    if not value:
        return out
    for part in str(value).replace("|", ",").split(","):
        part = part.strip()
        if not part:
            continue
        if ":" in part:
            ref_id, status = part.split(":", 1)
            out.append({"standardId": ref_id.strip(), "status": status.strip()})
        else:
            out.append({"standardId": part, "status": ""})
    return out


@dataclass
class TransformOutput:
    allergen_registry: list[dict] = field(default_factory=list)
    allergen_candidates: list[dict] = field(default_factory=list)
    allergen_aliases: list[dict] = field(default_factory=list)
    ingredient_knowledge: dict = field(default_factory=dict)
    dishes_demo: dict = field(default_factory=dict)
    regulatory_standards: list[dict] = field(default_factory=list)
    evidence_sources: list[dict] = field(default_factory=list)

    # 서비스 JSON에는 넣지 않지만 관리용 보고서에는 넣어야 하는 것들(§8).
    pending_aliases: list[dict] = field(default_factory=list)
    pending_ingredient_relations: list[dict] = field(default_factory=list)
    pending_epidemiology: list[dict] = field(default_factory=list)


def transform(extracted: ExtractResult) -> TransformOutput:
    sheets = extracted.sheets
    out = TransformOutput()

    for row in sheets.get("01_Allergens", []):
        regulatory_refs = _split_ref_status_list(row.get("regulatoryRefs"))
        evidence_refs = _split_comma_list(row.get("evidenceRefs"))
        labels = {lang: row.get(lang, "") for lang in ("ko", "en", "ja", "zh", "vi", "es")}

        if row.get("registryStatus") == "active":
            out.allergen_registry.append(
                {
                    # 이 네 필드가 shared/allergens.js와의 "계약(contract)"이다 —
                    # 지금 당장은 이 JSON을 서비스가 읽지 않지만, 나중에 읽게 되더라도
                    # shared/allergens.js가 기대하는 모양과 동일해야 그대로 바꿔 끼울 수 있다.
                    "id": row["id"],
                    "legacyIds": _split_comma_list(row.get("legacyIds")),
                    "labels": labels,
                    "icon": row.get("icon", ""),
                    "_meta": {
                        "biologicalCategory": row.get("biologicalCategory", ""),
                        "reviewStatus": row.get("reviewStatus", ""),
                        "regulatoryRefs": regulatory_refs,
                        "evidenceRefs": evidence_refs,
                    },
                }
            )
        else:  # candidate
            out.allergen_candidates.append(
                {
                    "id": row["id"],
                    "labels": labels,
                    "icon": row.get("icon", ""),
                    "biologicalCategory": row.get("biologicalCategory", ""),
                    "regulatoryRefs": regulatory_refs,
                    "evidenceRefs": evidence_refs,
                    "reviewStatus": row.get("reviewStatus", ""),
                    "autoApplyToRiskJudgment": False,
                    "notice": (
                        "이 성분은 해외 규제 근거는 확인되었으나 아직 서비스의 활성 "
                        "알레르기 목록(shared/allergens.js)에 등록되지 않았습니다. "
                        "위험도 자동 판정에 쓰이지 않습니다."
                    ),
                }
            )

    for row in sheets.get("02_Allergen_Aliases", []):
        record = {
            "allergenId": row["allergenId"],
            "alias": row["alias"],
            "lang": row.get("lang", ""),
            "evidenceType": row.get("evidenceType", ""),
        }
        if row.get("reviewStatus") == "reviewed":
            out.allergen_aliases.append(record)
        else:
            out.pending_aliases.append({**record, "reviewStatus": row.get("reviewStatus", "")})

    ingredients_by_id = {r["id"]: r for r in sheets.get("03_Ingredients", [])}
    confirmed_relations = []
    for row in sheets.get("04_Ingredient_Allergens", []):
        record = {
            "id": row["id"],
            "ingredientId": row["ingredientId"],
            "allergenId": row["allergenId"],
            "relationType": row.get("relationType", ""),
            "confidence": row.get("confidence", ""),
            "evidenceId": row.get("evidenceId", ""),
        }
        if row.get("reviewStatus") == "reviewed":
            confirmed_relations.append(record)
        else:
            out.pending_ingredient_relations.append(
                {**record, "reviewStatus": row.get("reviewStatus", ""), "evidenceType": row.get("evidenceType", "")}
            )

    out.ingredient_knowledge = {
        "ingredients": [
            {"id": r["id"], "nameKo": r.get("nameKo", ""), "nameEn": r.get("nameEn", ""), "kind": r.get("kind", "")}
            for r in ingredients_by_id.values()
        ],
        "confirmedRelations": confirmed_relations,
        "note": (
            "confirmedRelations는 reviewStatus='reviewed'인 관계만 포함합니다. "
            "전문가 검토 대기 중인 관계는 이 파일에 없습니다 — 빌드 보고서를 참고하세요."
        ),
    }

    dishes = [
        {
            "id": r["id"],
            "nameKo": r.get("nameKo", ""),
            "nameEn": r.get("nameEn", ""),
            "category": r.get("category", ""),
            "isDemo": True,
        }
        for r in sheets.get("05_Dishes", [])
    ]
    verifications = [
        {
            "id": r["id"],
            "locationFoodId": r.get("locationFoodId", ""),
            "dishId": r.get("dishId", ""),
            "verificationMethod": r.get("verificationMethod", ""),
            "confidence": r.get("confidence", ""),
            "isDemo": True,
            "doNotUseAsRealVerification": True,
        }
        for r in sheets.get("09_Restaurant_Verification", [])
    ]
    out.dishes_demo = {
        "dishes": dishes,
        "restaurantVerification": verifications,
        "note": "이 파일의 모든 레코드는 해커톤 데모 데이터이며 실제 매장 확인 정보가 아닙니다.",
    }

    out.regulatory_standards = [
        {
            "id": r["id"],
            "country": r.get("country", ""),
            "legalName": r.get("legalName", ""),
            "amendmentDate": r.get("amendmentDate", ""),
            "mandatoryCount": r.get("mandatoryCount"),
            "recommendedCount": r.get("recommendedCount"),
            "status": r.get("status", ""),
            "sourceId": r.get("sourceId", ""),
        }
        for r in sheets.get("07_Regulatory_Standards", [])
    ]

    out.evidence_sources = [
        {
            "id": r["id"],
            "type": r.get("type", ""),
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "publishedDate": r.get("publishedDate", ""),
            "reliability": r.get("reliability", ""),
            # citationOnly: 이 레코드는 "출처를 인용"하는 것이지 그 출처의 원문/실제
            # 데이터를 복제한 것이 아님을 명시(§10 공개배포 제한 요구사항 대응).
            "citationOnly": True,
            "licenseConfirmed": r.get("reliability") != "unverified",
        }
        for r in sheets.get("08_Evidence_Sources", [])
    ]

    for row in sheets.get("10_Epidemiology", []):
        if row.get("reviewStatus") != "reviewed":
            out.pending_epidemiology.append(
                {"id": row["id"], "title": row.get("title", ""), "reviewStatus": row.get("reviewStatus", "")}
            )
        # 참고: 지시사항 §7 "국가별 역학 연구는 개인별 알레르기 위험도 판정
        # 데이터에 포함하지 않는다" — 그래서 epidemiology는 reviewed라 해도
        # 애초에 "서비스 위험도 판정용 JSON"에 넣지 않는다(연구 자체는 가치가
        # 있으므로 완전히 버리지는 않되, IMP-17 문서/보고서에만 남긴다).

    return out
