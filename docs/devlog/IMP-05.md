# IMP-05 — 캐싱 및 중복 API 호출 방지

> Package 2 중 2/4. [[IMP-04]] 분리 구조를 전제로 한다.

## 핵심 문제

분석과 번역이 분리돼도, 같은 이미지를 다시 올리거나 같은 언어를 다시
선택하면 매번 Gemini를 또 호출하는 문제는 그대로 남는다.

## 해결 방법

- **서버**: `shared/server-cache.js`(신규) — TTL(기본 30분) + 최대 크기(200건,
  초과 시 가장 오래 안 읽힌 항목 제거)를 가진 프로세스 메모리 Map. Redis 등
  외부 저장소는 요청사항대로 들이지 않았다.
  - `api/analyze-menu.js`: 캐시 키 = `이미지 SHA-256 해시 + 모델 + 프롬프트
    버전(2.0.0) + 스키마 버전`. 실패(`validationStatus: 'invalid'`, 예외)
    응답은 절대 캐시하지 않는다(TC-05-07).
  - `api/translate-dish.js`: 캐시 키 = `analysisId + 목표 언어 + 프롬프트/
    스키마 버전`. `en`은 캐시 확인보다 먼저 즉시 반환(Gemini 호출 자체 없음).
- **클라이언트**: `state.lastAnalysis`(이미지 해시별 언어 중립 분석 결과)와
  `state.translationCache`(`이미지해시:언어` → 번역된 표시용 dish 배열,
  최대 20건)를 둬서, 서버에 묻기 전에 먼저 클라이언트에서 적중을 확인한다.
- **명시적으로 캐시하지 않는 것**(요청사항 그대로): `checkDishSafety()`의
  위험도 판정 결과(항상 현재 `state.selectedAllergies`로 그때그때 계산),
  사용자 사진 원본(해시만 키로 쓰고 이미지 바이트 자체는 캐시에 저장하지
  않음), 사용자 알레르기 프로필(번역 요청에 아예 포함되지 않음).

## 변경된 파일

| 파일 | 변경 |
|---|---|
| `shared/server-cache.js` | **신규.** `createTtlCache({maxEntries, ttlMs})` |
| `api/analyze-menu.js` | 캐시 조회/저장, 캐시 디버그용 `_analysisCache` 노출 |
| `api/translate-dish.js` | 캐시 조회/저장, `_translationCache` 노출, `en` 단축 경로 |
| `index.html` | `state.lastAnalysis`/`state.translationCache`/`hashStringForCache()`(FNV-1a, 비암호) |

## 성과(실측)

- 같은 이미지 재분석: Gemini 호출 0회(TC-05-05, TC-05-12).
- 다른 이미지: 각자 호출(TC-05-06) — 캐시가 과도하게 막지 않음을 확인.
- 실패 응답 미캐싱: 같은 실패를 두 번 캐시로 재사용하지 않고 재시도 가능(TC-05-07).
- 언어 전환: 분석 0회 재호출 + 번역 1회만 호출(TC-05-13).
- 같은 (이미지, 언어) 재요청: 번역도 0회 재호출(TC-05-14).
- `en` 목표 언어: 번역 Gemini 호출 0회(TC-05-11).

## 테스트

`tests/imp-05-after.js`: 명명 15건(TC 14 + NOT RUN 1), **PASS 14 / FAIL 0 /
NOT RUN 1**(실제 Vercel 콜드 스타트 환경 — 로컬 검증 불가), assertion 20건.

## 한계

- **서버 캐시는 "최선 노력"이다.** 실제 Vercel 서버리스 배포에서는 함수
  인스턴스가 콜드 스타트될 때마다 메모리가 초기화되어 캐시가 비워진다 —
  이 캐시는 "같은 웜 인스턴스가 연속 요청을 처리하는 동안만" 유효하다.
  로컬 `dev-server.js`(장기 실행 프로세스)에서는 항상 유효하다.
- 클라이언트 캐시(`state.translationCache`)는 페이지를 새로고침하면 사라진다
  (의도된 설계 — localStorage에 사진/번역 결과를 영구 저장하지 않음).
