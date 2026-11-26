// shared/server-cache.js
//
// [IMP-05] 서버 프로세스 메모리 안에서만 사는 간단한 TTL + 최대 크기 캐시.
// Redis나 별도 DB 서버는 이번 범위에서 의도적으로 들이지 않았다(요청사항
// 그대로) — "현재 서비스 구조에 적합한 메모리 캐시"로 충분하다고 판단한
// 근거: 이 캐시가 막으려는 비용은 "같은 서버 프로세스가 살아있는 짧은
// 시간 동안 같은 사진/같은 번역 요청이 반복되는 것"이고, 그 범위에서는
// Map 하나로 충분하다.
//
// **한계(정직하게 문서화)**: 실제 Vercel 서버리스 환경에서는 각 함수
// 인스턴스가 콜드 스타트될 때마다 이 Map이 비워진다 — 즉 이 캐시는 "같은
// 웜(warm) 인스턴스가 연속으로 요청을 처리하는 동안만" 유효한 최선 노력
// (best-effort) 캐시다. 로컬 dev-server.js(장기 실행 Node 프로세스)에서는
// 항상 유효하게 동작한다.
function createTtlCache(options) {
  const opts = options || {};
  const maxEntries = opts.maxEntries || 200;
  const ttlMs = opts.ttlMs || 30 * 60 * 1000; // 기본 30분
  const store = new Map(); // key -> { value, expiresAt }

  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return undefined;
    }
    // 다시 읽은 항목을 맵의 맨 뒤로 옮겨 "최근 사용"으로 표시 — Map은
    // 삽입 순서를 보존하므로, 이 재삽입만으로 간단한 LRU 근사가 된다.
    store.delete(key);
    store.set(key, entry);
    return entry.value;
  }

  function set(key, value) {
    store.delete(key);
    store.set(key, { value: value, expiresAt: Date.now() + ttlMs });
    while (store.size > maxEntries) {
      const oldestKey = store.keys().next().value;
      store.delete(oldestKey);
    }
  }

  function size() {
    return store.size;
  }

  function clear() {
    store.clear();
  }

  return { get: get, set: set, size: size, clear: clear };
}

module.exports = { createTtlCache: createTtlCache };
