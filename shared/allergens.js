// shared/allergens.js
//
// [IMP-11] 알레르기 ID 단일 표준(Single Source of Truth).
//
// 배경: 수정 전에는 똑같은 19종 알레르기 목록이
//   - index.html의 standardAllergens
//   - api/analyze-menu.js의 ALLOWED_ALLERGEN_IDS
// 두 군데에 "복사-붙여넣기"로 따로 존재했다. 그 결과:
//   - 'fish', 'sesame'는 locations 데모 데이터(crossContactAllergens)에서는
//     쓰이는데 두 목록 어디에도 등록되지 않아 위험 판정이 조용히 무시됨.
//   - 'pineneut'(오타)가 두 목록 모두에 똑같이 복사되어 있어 "내부적으로는"
//     안 깨졌지만, app/ 실험 버전의 올바른 철자 'pinenut'과는 불일치.
// 즉 문제의 본질은 "오타 하나"가 아니라 "같은 데이터를 두 곳에서 따로
// 관리한다"는 구조 자체였다. 이 파일을 두 곳이 모두 불러와 쓰게 하면,
// 데이터가 하나로 합쳐져서 같은 종류의 불일치가 재발하지 않는다.
//
// 로딩 방식 (새 빌드 도구를 들이지 않기 위한 선택):
//   - 브라우저(index.html): <script src="shared/allergens.js"></script>를
//     메인 로직 스크립트보다 "먼저" 로드해, 전역 변수 ALLERGEN_REGISTRY로 접근.
//     (Tailwind/Leaflet도 이미 같은 방식의 전역 <script> 태그로 로드되고 있어
//      이 프로젝트의 기존 아키텍처와 일치한다.)
//   - 서버(api/analyze-menu.js, dev-server.js): require('../shared/allergens.js')로
//     그대로 불러온다. Vercel은 서버리스 함수에서 require된 로컬 파일을
//     자동으로 추적해 함께 배포하므로(File Tracing) 별도 설정이 필요 없다.
//
// 각 항목 구조:
//   id        : 코드 전역에서 사용하는 표준 식별자 (영문, 소문자)
//   legacyIds : 과거에 이 성분이 다른 id로 저장된 적이 있다면 그 id들.
//               LocalStorage 마이그레이션에 사용 (예: pinenut의 legacyIds: ['pineneut'])
//   labels    : 기존 6개 언어 명칭 — 기존 standardAllergens에 있던 번역을
//               그대로 유지했고, 이번에 새로 추가한 fish/sesame만 새로 번역했다.
//   icon      : 기존 UI에 쓰이던 이모지 그대로 유지.
var ALLERGEN_REGISTRY = [
  { id: 'peanut', legacyIds: [], labels: { ko: '땅콩', en: 'Peanut', ja: 'ピーナッツ', zh: '花生', vi: 'Đậu phộng', es: 'Maní' }, icon: '🥜' },
  { id: 'walnut', legacyIds: [], labels: { ko: '호두', en: 'Walnut', ja: 'クルミ', zh: '核桃', vi: 'Quả óc chó', es: 'Nuez' }, icon: '🪵' },
  // [IMP-11] 'pineneut' → 'pinenut' (정확한 영문 철자로 교정, app/ 실험 버전과 통일).
  // legacyIds에 과거 오타 id를 등록해, 기존 사용자의 LocalStorage에 'pineneut'으로
  // 저장되어 있던 선택값을 자동으로 'pinenut'으로 이전할 수 있게 한다.
  { id: 'pinenut', legacyIds: ['pineneut'], labels: { ko: '잣', en: 'Pine nut', ja: '松の実', zh: '松子', vi: 'Hạt thông', es: 'Piñón' }, icon: '🌲' },
  { id: 'wheat', legacyIds: [], labels: { ko: '밀', en: 'Wheat', ja: '小麦', zh: '小麦', vi: 'Lúa mì', es: 'Trigo' }, icon: '🌾' },
  { id: 'buckwheat', legacyIds: [], labels: { ko: '메밀', en: 'Buckwheat', ja: 'そば', zh: '荞麦', vi: 'Kiều mạch', es: 'Alforfón' }, icon: '🥣' },
  { id: 'egg', legacyIds: [], labels: { ko: '계란', en: 'Egg', ja: '卵', zh: '鸡蛋', vi: 'Trứng', es: 'Huevo' }, icon: '🥚' },
  { id: 'milk', legacyIds: [], labels: { ko: '우유', en: 'Milk', ja: '牛乳', zh: '牛奶', vi: 'Sữa', es: 'Leche' }, icon: '🥛' },
  { id: 'shrimp', legacyIds: [], labels: { ko: '새우', en: 'Shrimp', ja: 'エビ', zh: '虾', vi: 'Tôm', es: 'Camarón' }, icon: '🦐' },
  { id: 'crab', legacyIds: [], labels: { ko: '게', en: 'Crab', ja: 'カニ', zh: '螃蟹', vi: 'Cua', es: 'Cangrejo' }, icon: '🦀' },
  { id: 'squid', legacyIds: [], labels: { ko: '오징어', en: 'Squid', ja: 'イカ', zh: '鱿鱼', vi: 'Mực', es: 'Calamar' }, icon: '🦑' },
  { id: 'mackerel', legacyIds: [], labels: { ko: '고등어', en: 'Mackerel', ja: 'サバ', zh: '鲭鱼', vi: 'Cá thu', es: 'Caballa' }, icon: '🐟' },
  { id: 'shellfish', legacyIds: [], labels: { ko: '조개류', en: 'Shellfish', ja: '貝類', zh: '贝类', vi: 'Nghêu sò', es: 'Mariscos' }, icon: '🦪' },
  // [IMP-11] 신규 등록: 'fish' — locations 데모 데이터(삼겹살의 김치 액젓 교차오염)에서
  // 이미 쓰이고 있었지만 목록에 없어 무시되던 id. 'shellfish'(조개류)나
  // 'shrimp'/'crab'(갑각류)과는 분류가 다른 별도 성분이므로 통합하지 않고 독립 id로 추가.
  { id: 'fish', legacyIds: [], labels: { ko: '생선', en: 'Fish', ja: '魚', zh: '鱼', vi: 'Cá', es: 'Pescado' }, icon: '🐠' },
  { id: 'soybean', legacyIds: [], labels: { ko: '대두', en: 'Soybean', ja: '大豆', zh: '大豆', vi: 'Đậu nành', es: 'Soya' }, icon: '🫘' },
  { id: 'pork', legacyIds: [], labels: { ko: '돼지고기', en: 'Pork', ja: '豚肉', zh: '猪肉', vi: 'Thịt lợn', es: 'Cerdo' }, icon: '🐖' },
  { id: 'beef', legacyIds: [], labels: { ko: '소고기', en: 'Beef', ja: '牛肉', zh: '牛肉', vi: 'Thịt bò', es: 'Res' }, icon: '🐂' },
  { id: 'chicken', legacyIds: [], labels: { ko: '닭고기', en: 'Chicken', ja: '鶏肉', zh: '鸡肉', vi: 'Thịt gà', es: 'Pollo' }, icon: '🐓' },
  // [IMP-11] 신규 등록: 'sesame' — locations 데모 데이터(마라탕/밀면 교차오염)에서
  // 이미 쓰이고 있었지만 목록에 없었던 id. 참깨는 밀/대두와 다른 독립된 알레르기 유발 성분.
  { id: 'sesame', legacyIds: [], labels: { ko: '참깨', en: 'Sesame', ja: 'ごま', zh: '芝麻', vi: 'Mè', es: 'Sésamo' }, icon: '🫙' },
  { id: 'peach', legacyIds: [], labels: { ko: '복숭아', en: 'Peach', ja: '桃', zh: '桃子', vi: 'Đào', es: 'Melocotón' }, icon: '🍑' },
  { id: 'tomato', legacyIds: [], labels: { ko: '토마토', en: 'Tomato', ja: 'トマト', zh: '西红柿', vi: 'Cà chua', es: 'Tomate' }, icon: '🍅' },
  { id: 'sulfites', legacyIds: [], labels: { ko: '아황산류', en: 'Sulfites', ja: '亜硫酸塩', zh: '亚硫酸盐', vi: 'Chất sulfit', es: 'Sulfitos' }, icon: '🧪' }
];

// Node(require)와 브라우저(전역 <script>) 양쪽에서 동일한 코드로 동작하게 하는
// 최소 UMD(Universal Module Definition) 패턴. Webpack/Rollup 등 새 빌드 도구를
// 들이지 않고 "있는 그대로의" index.html / Node 서버 구조에 맞추기 위한 선택.
(function (root) {
  if (typeof module !== 'undefined' && module.exports) {
    // Node.js (dev-server.js, api/analyze-menu.js에서 require로 사용)
    module.exports = ALLERGEN_REGISTRY;
  } else if (root) {
    // 브라우저 — window.ALLERGEN_REGISTRY로 노출
    root.ALLERGEN_REGISTRY = ALLERGEN_REGISTRY;
  }
})(typeof window !== 'undefined' ? window : this);
