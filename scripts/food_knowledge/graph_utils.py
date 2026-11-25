"""scripts/food_knowledge/graph_utils.py

[IMP-18C] 자기참조(self-reference) 구조에서 순환 참조(cycle)를 찾는
범용 유틸리티. 지금 Master DB의 실제 스키마에는 순환이 생길 수 있는
자기참조 컬럼(예: 복합 식재료가 다른 복합 식재료를 구성요소로 가리키는
구조)이 없지만(scripts/food_knowledge/schema.py의 SELF_REFERENTIAL_FIELDS
주석 참고), 사용자가 "순환 관계가 발생할 수 있는 구조라면 검토한다"고
명시했으므로, 이 함수 자체는 별도로 구현하고 합성(fixture) 데이터로
독립 테스트한다(실제 데이터에는 순환이 없어 테스트가 되지 않기 때문).
"""

from __future__ import annotations


def find_cycles(edges: dict[str, list[str]]) -> list[list[str]]:
    """edges[A] = [B, C] 는 "A가 B, C를 가리킨다"는 뜻.

    DFS(깊이 우선 탐색)로 "지금 방문 중인 경로 위에 있는 노드를 다시
    만나면 순환"이라는 표준 알고리즘을 그대로 구현한 것 — 그래프 이론의
    기본 기법이며, 이 프로젝트에서 처음 등장하는 특별한 기법은 아니다.
    """
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {node: WHITE for node in edges}
    cycles: list[list[str]] = []

    def visit(node: str, path: list[str]) -> None:
        color[node] = GRAY
        path.append(node)
        for neighbor in edges.get(node, []):
            if neighbor not in color:
                # 가리키는 대상이 edges에 없는 노드(=다른 시트의 FK 오류일 수 있음) —
                # 순환 탐지의 책임이 아니므로 조용히 건너뛴다(참조 무결성 검증은 validate.py의 몫).
                continue
            if color[neighbor] == GRAY:
                cycle_start = path.index(neighbor)
                cycles.append(path[cycle_start:] + [neighbor])
            elif color[neighbor] == WHITE:
                visit(neighbor, path)
        path.pop()
        color[node] = BLACK

    for node in list(edges.keys()):
        if color[node] == WHITE:
            visit(node, [])

    return cycles
