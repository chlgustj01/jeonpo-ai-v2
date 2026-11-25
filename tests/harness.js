// tests/harness.js
//
// IMP-11 테스트용 재사용 하네스.
// index.html 안의 <script>...</script> 블록(순수 로직, Tailwind CDN 블록 제외)을
// Node.js vm 모듈로 "있는 그대로" 실행시켜, 실제 배포되는 코드와 동일한 함수/데이터를
// 테스트에서 호출할 수 있게 한다. 로직을 손으로 다시 구현(재작성)하지 않는다 —
// 그러면 "재구현한 코드"를 테스트하는 것이 되어 실제 결함 재현/수정 증명이 되지 않는다.
//
// 브라우저 전용 전역(document, localStorage, fetch, Leaflet 등)은 최소 Stub으로 대체한다.
// Gemini API 등 외부 네트워크 호출은 테스트에서 명시적으로 막아, 실제 API 호출 없이
// 데모 데이터 + Mock으로만 동작을 검증한다 (요청사항: 실제 Gemini 호출 지양).

const fs = require('fs');
const vm = require('vm');

function extractAppScript(html) {
  const scriptRegex = /<script>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    if (match[1].includes('const state = {')) {
      return match[1];
    }
  }
  throw new Error('index.html 안에서 메인 로직 <script> 블록을 찾지 못했습니다.');
}

function makeElementStub() {
  const classes = new Set();
  const stub = {
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
    },
    style: {},
    innerHTML: '',
    innerText: '',
    value: '',
    disabled: false,
    appendChild: () => {},
    removeChild: () => {},
    addEventListener: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
    children: [],
    src: '',
  };
  return stub;
}

function makeLocalStorageStub(initialData) {
  const storage = new Map(Object.entries(initialData || {}));
  return {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
    _dump: () => Object.fromEntries(storage),
  };
}

// htmlPath: index.html 경로
// options.localStorageData: 테스트 시작 시 localStorage에 미리 넣어둘 데이터 (레거시 프로필 재현용)
// options.fetchImpl: fetch를 호출하는 코드 경로를 테스트할 때 주입할 Mock (기본은 호출 시 에러)
function loadApp(htmlPath, options = {}) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const code = extractAppScript(html);

  const localStorageStub = makeLocalStorageStub(options.localStorageData);

  const windowStub = {};
  const documentStub = {
    getElementById: () => makeElementStub(),
    querySelectorAll: () => [],
    createElement: () => makeElementStub(),
    // [IMP-12] renderCustomAllergyBadges()가 document.createTextNode를 쓴다 —
    // 실제 내용을 검사하진 않으므로 최소한의 더미 노드만 돌려주면 충분하다.
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    addEventListener: () => {},
  };

  const sandbox = {
    console,
    localStorage: localStorageStub,
    document: documentStub,
    window: windowStub,
    navigator: { language: 'en-US' },
    fetch:
      options.fetchImpl ||
      (async () => {
        throw new Error('[테스트 격리] 이 테스트는 실제 네트워크 호출을 허용하지 않습니다.');
      }),
    Image: function Image() {
      this.onload = null;
      this.onerror = null;
    },
    setTimeout,
    clearInterval,
    setInterval,
    Intl,
    L: {
      map: () => ({ setView: () => {}, addLayer: () => {}, panTo: () => {}, invalidateSize: () => {} }),
      tileLayer: () => ({ addTo: () => {} }),
      marker: () => ({ addTo: () => {}, bindPopup: () => {}, on: () => {}, remove: () => {} }),
      icon: () => ({}),
      divIcon: () => ({}),
    },
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(t) {
      this.text = t;
    },
  };
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);

  // [IMP-11] 실제 index.html의 <head>와 동일한 순서로, 공유 알레르기
  // 사전(shared/allergens.js)을 메인 로직보다 먼저 이 context에 로드한다.
  // options.skipAllergenRegistry: true로 TC-11-13(레지스트리 로드 실패) 재현 가능.
  if (!options.skipAllergenRegistry) {
    const path = require('path');
    const registryPath = path.join(path.dirname(htmlPath), 'shared', 'allergens.js');
    const registryCode = fs.readFileSync(registryPath, 'utf8');
    vm.runInContext(registryCode, context, { filename: registryPath });
  }

  // [IMP-02] 실제 index.html의 <head>와 동일한 순서로, shared/dish-schema.js도
  // 메인 로직보다 먼저 이 context에 로드한다 — normalizeSpicy/
  // validateAndNormalizeDishesResponse 등이 메인 스크립트 실행 시점에 이미
  // 전역으로 존재해야 하기 때문이다(실제 <script> 로드 순서와 동일).
  if (!options.skipDishSchema) {
    const path = require('path');
    const schemaPath = path.join(path.dirname(htmlPath), 'shared', 'dish-schema.js');
    const schemaCode = fs.readFileSync(schemaPath, 'utf8');
    vm.runInContext(schemaCode, context, { filename: schemaPath });
  }

  vm.runInContext(code, context, { filename: htmlPath });

  return { context, localStorageStub };
}

module.exports = { loadApp, extractAppScript };

// context에서 const/let로 선언된 최상위 바인딩을 꺼내는 헬퍼.
// vm Context는 "전역 렉시컬 스코프"를 Context 생성 시점부터 계속 유지하므로,
// loadApp()에서 실행한 스크립트의 const/let 바인딩을 같은 context에 대한
// 두 번째 vm.runInContext() 호출로 다시 읽어올 수 있다 (globalThis에는 안 올라가지만
// 같은 context의 렉시컬 스코프에는 남아있기 때문).
function pick(context, names) {
  const vm = require('vm');
  return vm.runInContext('({' + names.join(',') + '})', context);
}

module.exports.pick = pick;
