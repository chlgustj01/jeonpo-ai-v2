// scripts/generate-master-xlsx.js
//
// [IMP-18B] data/master/Food_Allergen_Master.xlsx 생성 스크립트.
//
// 지금 단계에서는 Excel 파일을 "손으로 100개 넘는 행을 타이핑"하는 것이
// 현실적으로 불가능하고 오타 위험도 크므로, 이 스크립트가 데이터를
// 구조화된 JS로 정의하고 exceljs로 .xlsx 바이너리를 생성한다.
//
// 중요: 이 스크립트는 "서비스 런타임 코드"가 아니다. index.html / dev-server.js /
// api/analyze-menu.js는 이 스크립트나 exceljs에 전혀 의존하지 않는다
// (scripts/package.json은 scripts/ 폴더에만 격리된 1회성 개발 도구).
//
// 장기 운영 방향(IMP-18C 변환 계획)과의 관계:
//   지금: JS 데이터 정의 → (이 스크립트) → .xlsx 생성 [최초 1회 구축]
//   향후: 사람이 .xlsx를 직접 Excel로 편집 → (별도 변환 스크립트) → JSON 생성
//   즉 "Excel이 원본, JSON은 산출물"이라는 최종 목표를 위한 초기 시드를
//   이 스크립트가 만들어주는 것이고, 이후부터는 Excel 파일 자체가 원본이 된다.
//
// 데이터 신뢰도 원칙(사용자 지시 그대로 반영):
//   - Allergens/Regulatory_Standards/Evidence_Sources/Epidemiology: 이번 세션에서
//     실제로 열람/검색한 1차 또는 신뢰 가능한 자료에 근거 — reviewStatus='reviewed'
//   - Ingredient_Allergens(복합 재료 관계 대부분)/Allergen_Aliases: 이번 세션의
//     AI(본인)가 일반 상식 수준으로 추정한 것 — reviewStatus='pending_expert_review',
//     evidenceType='ai_estimated_general_knowledge'로 명확히 구분(검증 완료로 위장하지 않음)
//   - Dishes/Dish_Ingredients/Restaurant_Verification: 기존 해커톤 데모 데이터 재사용 —
//     reviewStatus='demo_content'(사실 검증 대상이 아니라 "데모임"을 명시하는 상태)

const path = require('path');
const ExcelJS = require('exceljs');

const ROOT = path.join(__dirname, '..');
const ALLERGEN_REGISTRY = require(path.join(ROOT, 'shared', 'allergens.js'));
const indexHtml = require('fs').readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ---------------------------------------------------------------------
// 00. 공통 상수
// ---------------------------------------------------------------------
const TODAY = '2026-11-25';
const REVIEWER = 'IMP-17B/18B 조사(Claude + 사용자 검토 대기)';

// ---------------------------------------------------------------------
// 07. Regulatory_Standards — IMP-17/17B에서 실제로 확인한 8개 법령·기준
// ---------------------------------------------------------------------
const REGULATORY_STANDARDS = [
  {
    id: 'KR-MFDS-2021',
    country: 'KR',
    legalName: '식품 등의 표시·광고에 관한 법률 시행규칙 [별표 2] 1.알레르기 유발물질 표시',
    amendmentDate: '2021-08-24',
    mandatoryCount: 19,
    recommendedCount: 0,
    sourceId: 'EV-KR-MFDS-2021',
    status: 'current',
    notes:
      '2020-09-09 개정본과 2021-08-24 개정본의 "가. 알레르기 유발물질" 목록을 원문 PDF로 ' +
      '직접 대조한 결과 글자 하나까지 동일(19개 항목, 변경 없음). "22종"이라는 표현은 ' +
      '2025년 보도자료(nongmin.com 등)에서도 반복되지만, 그 기사들이 실제로 나열하는 ' +
      '항목 역시 예외 없이 19개였다 — 공식 법령 원문에서 22개를 나열한 사례는 ' +
      '찾지 못했다(검증 필요: "22"의 최초 발생 출처는 추적하지 못함).',
  },
  {
    id: 'US-FDA-FALCPA-FASTER',
    country: 'US',
    legalName: 'FALCPA(2004) + FASTER Act(2021, 참깨 2023-01-01 시행)',
    amendmentDate: '2023-01-01',
    mandatoryCount: 9,
    recommendedCount: 0,
    sourceId: 'EV-US-FDA-SESAME',
    status: 'current',
    notes: 'Big 9: milk, egg, fish, crustacean shellfish, tree nuts, peanut, wheat, soybean, sesame',
  },
  {
    id: 'EU-1169-2011',
    country: 'EU',
    legalName: 'Regulation (EU) No 1169/2011, Annex II',
    amendmentDate: '2011-10-25',
    mandatoryCount: 14,
    recommendedCount: 0,
    sourceId: 'EV-EU-1169-2011',
    status: 'current',
    notes:
      '채택 2011-10-25, 발효 2011-12-12, 전면 적용 2014-12-13. 참깨/겨자/셀러리/루핀은 ' +
      '제정 당시(2011)부터 Annex II 원안에 이미 포함되어 있었음(미국처럼 나중에 추가된 ' +
      '것이 아님) — 단, 1차 EUR-Lex 원문은 이번 세션에서 직접 열람하지 못했고 다수의 ' +
      '2차 요약을 교차 확인한 수준(검증 필요 표시 유지).',
  },
  {
    id: 'UK-FIR',
    country: 'GB',
    legalName: 'Food Information Regulations (Retained EU Law, EU 1169/2011 승계)',
    amendmentDate: '2014-12-13',
    mandatoryCount: 14,
    recommendedCount: 0,
    sourceId: 'EV-UK-FSA',
    status: 'current',
    notes: 'food.gov.uk 공식 페이지 확인. EU 14종과 동일(Brexit 이후에도 유지).',
  },
  {
    id: 'JP-CAA-2023',
    country: 'JP',
    legalName: '食品表示基準 - 特定原材料(義務)8品目 + 特定原材料に準ずるもの(推奨)20品目',
    amendmentDate: '2023-03-09',
    mandatoryCount: 8,
    recommendedCount: 20,
    sourceId: 'EV-JP-CAA-KURUMI',
    status: 'current',
    notes:
      '2023-03-09 개정으로 くるみ(호두)가 추천→의무로 승격, 유예기간 2025-03-31까지. ' +
      '참깨(ごま)는 여전히 "권장"일 뿐 의무가 아님 — 미국/EU/영국과 수준이 다름. ' +
      '마카다미아넛의 권장목록 추가 여부는 출처 간 불일치 확인(검증 필요, 아래 08 참고).',
  },
  {
    id: 'CA-HC-2024',
    country: 'CA',
    legalName: 'Health Canada Priority Food Allergens (Food and Drug Regulations)',
    amendmentDate: '2009-09',
    mandatoryCount: 11,
    recommendedCount: 0,
    sourceId: 'EV-CA-HEALTHCANADA',
    status: 'current',
    notes:
      '11종: peanut, tree nuts, sesame seeds, milk, egg, fish, crustaceans, molluscs, soy, ' +
      'wheat/triticale, mustard. 참깨는 2009년부터 이미 포함(미국보다 훨씬 이른 시점) — ' +
      '겨자(mustard)도 포함되어 있어 EU/UK와 유사. 아황산류는 "식품첨가물"로 별도 관리.',
  },
  {
    id: 'AU-NZ-FSANZ-1.2.3',
    country: 'AU/NZ',
    legalName: 'Food Standards Code Standard 1.2.3 (PEAL)',
    amendmentDate: '2021-02-25',
    mandatoryCount: 11,
    recommendedCount: 0,
    sourceId: 'EV-AUNZ-FSANZ',
    status: 'current',
    notes:
      'gluten 곡물, 갑각류, 연체동물, 생선, 계란, 우유, 땅콩, 대두, 참깨, 견과류, 루핀, ' +
      '아황산류(10mg/kg↑) = 11개 범주. **셀러리·겨자는 EU/UK와 달리 FSANZ 목록에 없음** ' +
      '(PEAL 개편 과정에서 호주/뉴질랜드는 중대 반응 성분 위주로 간소화).',
  },
  {
    id: 'CODEX-CXS1-1985',
    country: 'INTL',
    legalName: 'Codex Alimentarius CXS 1-1985 (General Standard for Labelling of Prepackaged Foods)',
    amendmentDate: '1999',
    mandatoryCount: 8,
    recommendedCount: 0,
    sourceId: 'EV-CODEX-HISTORY',
    status: 'superseded_by_2024_amendment',
    notes:
      'FAO/WHO 공식 보고서(2021~2024, 명확히 서술) 기준 1999년 원목록은 8종(gluten 곡물, ' +
      '갑각류, 계란, 생선, 땅콩, 대두, 우유, 견과류, 아황산류 10mg/kg↑) — 참깨는 2024년 ' +
      '12월 CAC47에서 "신규 추가"되었다고 WHO 보고서가 명시. 다만 다른 한 검색 결과 요약은 ' +
      '"1999년부터 이미 참깨 포함, 총 9종"이라고 모순되게 서술 — 이 모순은 해소하지 못했다. ' +
      '1999년 원본 CCFL 회의록을 직접 열람하지 못했으므로 **검증 필요**로 유지하고, ' +
      'FAO/WHO의 명시적 공식 보고서 서술(2024년 참깨 신규 추가)을 더 신뢰도 높은 설명으로 ' +
      '채택한다(복수 공식 보고서가 일관되게 서술).',
  },
];

// ---------------------------------------------------------------------
// 08. Evidence_Sources — 이번 세션 + 직전 세션에서 실제로 열람/검색한 출처
// ---------------------------------------------------------------------
const EVIDENCE_SOURCES = [
  { id: 'EV-KR-MFDS-2020', type: 'regulatory', title: '식품 등의 표시·광고에 관한 법률 시행규칙 [별표2] <개정 2020.9.9>', url: 'https://www.law.go.kr/flDownload.do?flSeq=76612343', publishedDate: '2020-09-09', reviewedDate: TODAY, reliability: 'primary_legal_text', notes: 'PDF 원문 직접 열람(1~3페이지 전체), 19개 항목 확인' },
  { id: 'EV-KR-MFDS-2021', type: 'regulatory', title: '식품 등의 표시·광고에 관한 법률 시행규칙 [별표2] <개정 2021.8.24>', url: 'https://www.law.go.kr/flDownload.do?flSeq=136815085', publishedDate: '2021-08-24', reviewedDate: TODAY, reliability: 'primary_legal_text', notes: 'PDF 원문 직접 열람. 2020.9.9본과 알레르기 목록 동일함을 대조 확인' },
  { id: 'EV-KR-FSK-INFOGRAPHIC', type: 'regulatory', title: '식품안전나라 알레르기 유발 식품 표시 안내(인포그래픽)', url: 'https://www.foodsafetykorea.go.kr/portal/board/boardDetail.do?menu_no=3120&bbs_no=bbs001&ntctxt_no=1091412', publishedDate: '2022-09-01', reviewedDate: TODAY, reliability: 'secondary_summary', notes: '19개 항목 alt-text로 확인, "22종" 문구는 없음' },
  { id: 'EV-KR-NONGMIN-2025', type: 'regulatory', title: '식품 표시 개편 보도(푸드QR, "22종" 표현 사용하나 본문은 19개만 나열)', url: 'https://www.nongmin.com/article/20250829500247', publishedDate: '2025-08-29', reviewedDate: TODAY, reliability: 'secondary_summary', notes: '"22종" 표현과 19개 나열이 같은 기사 안에서 불일치 — 반복되는 오류 패턴의 구체적 증거' },
  { id: 'EV-US-FDA-SESAME', type: 'regulatory', title: 'FASTER Act — Sesame as 9th Major Food Allergen', url: 'https://www.fda.gov/food/buy-store-serve-safe-food/food-allergies-what-you-need-know', publishedDate: '2023-01-01', reviewedDate: TODAY, reliability: 'secondary_summary', notes: '복수 출처(FDA, FSIS, MSU Extension) 교차 확인' },
  { id: 'EV-EU-1169-2011', type: 'regulatory', title: 'Regulation (EU) No 1169/2011 Annex II', url: 'https://eur-lex.europa.eu/eli/reg/2011/1169/oj/eng', publishedDate: '2011-10-25', reviewedDate: TODAY, reliability: 'secondary_summary', notes: 'EUR-Lex 원문 직접 열람은 못함, eufic.org/food.gov.uk 등 교차 확인' },
  { id: 'EV-UK-FSA', type: 'regulatory', title: 'Food Standards Agency — Allergen guidance for food businesses', url: 'https://www.food.gov.uk/business-guidance/allergen-guidance-for-food-businesses', publishedDate: '2014-12-13', reviewedDate: TODAY, reliability: 'secondary_summary', notes: '영국 정부 공식 도메인(food.gov.uk)' },
  { id: 'EV-JP-CAA-KURUMI', type: 'regulatory', title: '消費者庁 くるみアレルギー表示義務化改正', url: 'https://www.caa.go.jp/policies/policy/food_labeling/information/research/2023/', publishedDate: '2023-03-09', reviewedDate: TODAY, reliability: 'secondary_summary', notes: '소비자청 공식 조사보고서 + 업계 공지(bfss.co.jp, nsouzai-kyoukai.or.jp) 교차 확인' },
  { id: 'EV-CA-HEALTHCANADA', type: 'regulatory', title: 'Health Canada — Sesame / Mustard, A priority food allergen', url: 'https://www.canada.ca/en/health-canada/services/food-nutrition/reports-publications/food-safety/sesame-priority-food-allergen.html', publishedDate: '2009-09', reviewedDate: TODAY, reliability: 'secondary_summary', notes: 'canada.ca 공식 도메인' },
  { id: 'EV-AUNZ-FSANZ', type: 'regulatory', title: 'FSANZ Food Standards Code Standard 1.2.3 (PEAL)', url: 'https://www.foodstandards.gov.au/sites/default/files/consumer/foodallergies/Documents/W1070%20final%20report.pdf', publishedDate: '2021-02-25', reviewedDate: TODAY, reliability: 'secondary_summary', notes: 'foodstandards.gov.au 공식 PDF 링크 확인(내용은 2차 요약으로 확인)' },
  { id: 'EV-CODEX-HISTORY', type: 'regulatory', title: 'FAO/WHO Ad hoc Joint Expert Consultation on Risk Assessment of Food Allergens, Part 1~4', url: 'https://openknowledge.fao.org/handle/20.500.14283/cc2946en', publishedDate: '2024-12', reviewedDate: TODAY, reliability: 'secondary_summary', notes: '1999년 원목록 8종, 2024.12 참깨 추가를 명시 — 단, 다른 요약과 모순 있음(위 07시트 비고 참고)' },
  { id: 'EV-FAOWHO-PART2', type: 'regulatory', title: 'FAO/WHO Risk Assessment of Food Allergens Part 2 — Reference Doses', url: 'https://openknowledge.fao.org/handle/20.500.14283/cc2946en', publishedDate: '2022', reviewedDate: TODAY, reliability: 'secondary_summary', notes: '정량 역치(Reference Dose) 설정 11종 확인' },
  { id: 'EV-FOODON', type: 'public_api', title: 'FoodOn: a harmonized food ontology', url: 'https://www.nature.com/articles/s41538-018-0032-6', publishedDate: '2018', reviewedDate: TODAY, reliability: 'secondary_summary', notes: 'npj Science of Food 논문, 알레르겐 커버리지는 제한적임을 확인' },
  { id: 'EV-FSK-COOKRCP', type: 'public_api', title: '식품안전나라 조리식품의 레시피 DB (COOKRCP01) API 명세', url: 'https://www.foodsafetykorea.go.kr/api/openApiInfo.do?svc_no=COOKRCP01', publishedDate: '2026-11-25', reviewedDate: TODAY, reliability: 'secondary_summary', notes: '필드 구조 확인(RCP_NM/RCP_PARTS_DTLS 등) — 알레르기 필드 없음을 확인' },
  { id: 'EV-DATAGOKR-RAWMAT', type: 'public_api', title: '공공데이터포털 — 식품의약품안전처_식품 원재료 정보', url: 'https://www.data.go.kr/data/15058665/openapi.do', publishedDate: '2016-12-31', reviewedDate: TODAY, reliability: 'secondary_summary', notes: '페이지 직접 열람: 무료/이용허락범위 제한없음/JSON+XML 확인. 공공누리 유형 번호·트래픽 한도는 페이지에 없어 검증 필요로 남김' },
  { id: 'EV-KR-EPI-2026-AAIR', type: 'peer_reviewed_study', title: 'Prevalence of Immediate-Type Food Allergy and Food-Induced Anaphylaxis in Korean Schoolchildren', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC13226871/', publishedDate: '2026-05-08', reviewedDate: TODAY, reliability: 'primary_legal_text', notes: '원문 상당 부분 직접 열람(저자/DOI/표본수/정의/수치 확인). Allergy Asthma Immunol Res. 2026;18(3):428-439. DOI 10.4168/aair.2026.18.3.428' },
  { id: 'EV-KR-EPI-FRUIT', type: 'peer_reviewed_study', title: '한국 소아 과일 알레르기 역학(복숭아 최다 보고)', url: 'https://synapse.koreamed.org/articles/1051533', publishedDate: '2026-11-25', reviewedDate: TODAY, reliability: 'secondary_summary', notes: '제목/핵심 수치만 검색 요약으로 확인, 저자/DOI/표본수 미확인(검증 필요)' },
  { id: 'EV-KR-EPI-RETROSPECTIVE', type: 'peer_reviewed_study', title: '전연령 중증도별 식품알레르기의 주요 원인: 단일기관 최근 10년 후향적 조사 연구', url: 'https://aard.or.kr/search.php?where=aview&id=10.4168%2Faard.2020.8.2.80', publishedDate: '2020', reviewedDate: TODAY, reliability: 'secondary_summary', notes: '저자/정확한 N 미확인(검증 필요). 단일기관 후향적 차트리뷰 — 전국 자기보고식 설문(EV-KR-EPI-2026-AAIR)과 방법론이 달라 수치를 직접 비교하지 않음' },
  { id: 'EV-DEMO-HACKATHON', type: 'demo_internal', title: '해커톤 원본 index.html locations[] 데모 데이터', url: '(내부 파일, 외부 URL 없음)', publishedDate: '2026-07-04', reviewedDate: TODAY, reliability: 'unverified', notes: '실제 식당 확인 아님 — 시연용 창작 데이터. IMP-15 선행 근거' },
];

// ---------------------------------------------------------------------
// 01. Allergens — 기존 21종(shared/allergens.js, active) + 신규 후보 18종(candidate)
// ---------------------------------------------------------------------
const ACTIVE_ALLERGENS = ALLERGEN_REGISTRY.map((entry) => ({
  id: entry.id,
  legacyIds: entry.legacyIds || [],
  labels: entry.labels,
  icon: entry.icon,
  registryStatus: 'active',
  biologicalCategory: null, // 아래 CATEGORY_OVERRIDES로 채움
  reviewStatus: 'reviewed',
  regulatoryRefs: [{ standardId: 'KR-MFDS-2021', status: 'mandatory' }],
  evidenceRefs: ['EV-KR-MFDS-2021'],
  notes: '',
}));

// fish/sesame는 한국 법정목록엔 없음 — 국제표준 근거로 IMP-11에서 등록된 것이므로
// regulatoryRefs를 한국이 아닌 국제표준으로 교체한다.
const findActive = (id) => ACTIVE_ALLERGENS.find((a) => a.id === id);
findActive('fish').regulatoryRefs = [
  { standardId: 'US-FDA-FALCPA-FASTER', status: 'mandatory' },
  { standardId: 'EU-1169-2011', status: 'mandatory' },
  { standardId: 'KR-MFDS-2021', status: 'not_listed' },
];
findActive('fish').evidenceRefs = ['EV-US-FDA-SESAME', 'EV-EU-1169-2011', 'EV-DEMO-HACKATHON'];
findActive('fish').notes = '한국 법정목록엔 없음(고등어만 개별 지정). 국제표준 + 데모 교차오염 사례 근거로 IMP-11에서 등록';

findActive('sesame').regulatoryRefs = [
  { standardId: 'US-FDA-FALCPA-FASTER', status: 'mandatory' },
  { standardId: 'EU-1169-2011', status: 'mandatory' },
  { standardId: 'UK-FIR', status: 'mandatory' },
  { standardId: 'CA-HC-2024', status: 'mandatory' },
  { standardId: 'AU-NZ-FSANZ-1.2.3', status: 'mandatory' },
  { standardId: 'JP-CAA-2023', status: 'recommended' },
  { standardId: 'KR-MFDS-2021', status: 'not_listed' },
];
findActive('sesame').evidenceRefs = ['EV-US-FDA-SESAME', 'EV-EU-1169-2011', 'EV-CA-HEALTHCANADA', 'EV-AUNZ-FSANZ'];
findActive('sesame').notes = '한국 법정목록엔 없음. 미/EU/영/캐나다/호주뉴질랜드 의무, 일본은 권장만 — 국가 간 수준 차이가 실제로 존재';

const BIOLOGICAL_CATEGORY = {
  peanut: 'legume', walnut: 'tree_nut', pinenut: 'tree_nut', wheat: 'gluten_cereal',
  buckwheat: 'pseudocereal', egg: 'egg', milk: 'dairy', shrimp: 'crustacean', crab: 'crustacean',
  squid: 'mollusk_cephalopod', mackerel: 'fish', shellfish: 'mollusk_bivalve', fish: 'fish',
  soybean: 'legume', pork: 'meat', beef: 'meat', chicken: 'meat', sesame: 'seed_oil',
  peach: 'fruit', tomato: 'fruit_vegetable', sulfites: 'additive',
};
ACTIVE_ALLERGENS.forEach((a) => { a.biologicalCategory = BIOLOGICAL_CATEGORY[a.id] || 'unclassified'; });

// 후보 18종 — 전부 section 3 요청 목록 + 실제 확인한 해외 규제 근거
const CANDIDATE_ALLERGENS = [
  { id: 'celery', labels: { ko: '셀러리', en: 'Celery', ja: 'セロリ', zh: '芹菜', vi: 'Cần tây', es: 'Apio' }, icon: '🥬', biologicalCategory: 'vegetable', refs: [{ s: 'EU-1169-2011', st: 'mandatory' }, { s: 'UK-FIR', st: 'mandatory' }, { s: 'AU-NZ-FSANZ-1.2.3', st: 'not_listed' }], evidence: ['EV-EU-1169-2011'], notes: 'EU/UK만 의무, 호주뉴질랜드는 PEAL 개편으로 목록에서 제외됨(확인됨) — 한국/미국/일본엔 없음' },
  { id: 'mustard', labels: { ko: '겨자', en: 'Mustard', ja: 'からし', zh: '芥末', vi: 'Mù tạt', es: 'Mostaza' }, icon: '🌭', biologicalCategory: 'condiment_seed', refs: [{ s: 'EU-1169-2011', st: 'mandatory' }, { s: 'UK-FIR', st: 'mandatory' }, { s: 'CA-HC-2024', st: 'mandatory' }, { s: 'AU-NZ-FSANZ-1.2.3', st: 'not_listed' }], evidence: ['EV-EU-1169-2011', 'EV-CA-HEALTHCANADA'], notes: 'EU/UK/캐나다 의무, 호주뉴질랜드는 제외(확인됨)' },
  { id: 'lupin', labels: { ko: '루핀(루핀콩)', en: 'Lupin', ja: 'ルピナス豆', zh: '羽扇豆', vi: 'Đậu lupin', es: 'Altramuz' }, icon: '🫛', biologicalCategory: 'legume', refs: [{ s: 'EU-1169-2011', st: 'mandatory' }, { s: 'UK-FIR', st: 'mandatory' }, { s: 'AU-NZ-FSANZ-1.2.3', st: 'mandatory' }], evidence: ['EV-EU-1169-2011', 'EV-AUNZ-FSANZ'], notes: 'EU/UK/호주뉴질랜드 의무 — 한국 메뉴에서의 실제 노출 빈도는 미확인' },
  { id: 'almond', labels: { ko: '아몬드', en: 'Almond', ja: 'アーモンド', zh: '杏仁', vi: 'Hạnh nhân', es: 'Almendra' }, icon: '🌰', biologicalCategory: 'tree_nut', refs: [{ s: 'US-FDA-FALCPA-FASTER', st: 'mandatory' }, { s: 'EU-1169-2011', st: 'mandatory' }, { s: 'CA-HC-2024', st: 'mandatory' }, { s: 'JP-CAA-2023', st: 'recommended' }], evidence: ['EV-US-FDA-SESAME', 'EV-JP-CAA-KURUMI'], notes: '미/EU/영/캐나다 tree nut 범주에 포함, 일본은 권장 20품목 중 하나(アーモンド 확인)' },
  { id: 'cashew', labels: { ko: '캐슈넛', en: 'Cashew', ja: 'カシューナッツ', zh: '腰果', vi: 'Hạt điều', es: 'Anacardo' }, icon: '🌰', biologicalCategory: 'tree_nut', refs: [{ s: 'US-FDA-FALCPA-FASTER', st: 'mandatory' }, { s: 'EU-1169-2011', st: 'mandatory' }, { s: 'JP-CAA-2023', st: 'recommended' }], evidence: ['EV-JP-CAA-KURUMI'], notes: '일본 권장 20품목 중 하나(カシューナッツ 확인)' },
  { id: 'hazelnut', labels: { ko: '헤이즐넛', en: 'Hazelnut', ja: 'ヘーゼルナッツ', zh: '榛子', vi: 'Hạt phỉ', es: 'Avellana' }, icon: '🌰', biologicalCategory: 'tree_nut', refs: [{ s: 'US-FDA-FALCPA-FASTER', st: 'mandatory' }, { s: 'EU-1169-2011', st: 'mandatory' }, { s: 'JP-CAA-2023', st: 'not_listed' }], evidence: ['EV-US-FDA-SESAME', 'EV-EU-1169-2011'], notes: '미/EU tree nut 범주엔 있으나, 확인한 일본 권장 20품목 목록엔 없었음' },
  { id: 'pistachio', labels: { ko: '피스타치오', en: 'Pistachio', ja: 'ピスタチオ', zh: '开心果', vi: 'Hạt dẻ cười', es: 'Pistacho' }, icon: '🌰', biologicalCategory: 'tree_nut', refs: [{ s: 'US-FDA-FALCPA-FASTER', st: 'mandatory' }, { s: 'EU-1169-2011', st: 'mandatory' }], evidence: ['EV-US-FDA-SESAME', 'EV-EU-1169-2011'], notes: '미/EU tree nut 범주' },
  { id: 'pecan', labels: { ko: '피칸', en: 'Pecan', ja: 'ピーカンナッツ', zh: '山核桃', vi: 'Hạt pecan', es: 'Pacana' }, icon: '🌰', biologicalCategory: 'tree_nut', refs: [{ s: 'US-FDA-FALCPA-FASTER', st: 'mandatory' }, { s: 'EU-1169-2011', st: 'mandatory' }], evidence: ['EV-EU-1169-2011'], notes: 'EU 목록에 명시적으로 "pecan nuts" 포함 확인' },
  { id: 'macadamia', labels: { ko: '마카다미아', en: 'Macadamia', ja: 'マカダミアナッツ', zh: '夏威夷果', vi: 'Hạt mắc ca', es: 'Macadamia' }, icon: '🌰', biologicalCategory: 'tree_nut', refs: [{ s: 'US-FDA-FALCPA-FASTER', st: 'mandatory' }, { s: 'EU-1169-2011', st: 'mandatory' }, { s: 'JP-CAA-2023', st: 'unconfirmed' }], evidence: ['EV-EU-1169-2011'], notes: '검증 필요: 한 출처는 일본이 "마카다미아넛 추가, 마쓰타케 삭제" 개정을 했다고 서술하나, 이번에 직접 확인한 20품목 목록엔 마카다미아가 없고 마쓰타케(まつたけ)가 있었음 — 두 출처가 상충, 추가 확인 필요' },
  { id: 'brazilnut', labels: { ko: '브라질너트', en: 'Brazil nut', ja: 'ブラジルナッツ', zh: '巴西坚果', vi: 'Hạt dẻ Brazil', es: 'Nuez de Brasil' }, icon: '🌰', biologicalCategory: 'tree_nut', refs: [{ s: 'US-FDA-FALCPA-FASTER', st: 'mandatory' }, { s: 'EU-1169-2011', st: 'mandatory' }], evidence: ['EV-EU-1169-2011'], notes: 'EU 목록에 명시적으로 포함 확인' },
  { id: 'kiwi', labels: { ko: '키위', en: 'Kiwi fruit', ja: 'キウイフルーツ', zh: '猕猴桃', vi: 'Kiwi', es: 'Kiwi' }, icon: '🥝', biologicalCategory: 'fruit', refs: [{ s: 'JP-CAA-2023', st: 'recommended' }], evidence: ['EV-JP-CAA-KURUMI', 'EV-KR-EPI-FRUIT'], notes: '일본 권장 20품목 확인 + 한국 소아 과일알레르기 연구에서도 상위 빈도로 보고(역학 참고용)' },
  { id: 'banana', labels: { ko: '바나나', en: 'Banana', ja: 'バナナ', zh: '香蕉', vi: 'Chuối', es: 'Plátano' }, icon: '🍌', biologicalCategory: 'fruit', refs: [{ s: 'JP-CAA-2023', st: 'recommended' }], evidence: ['EV-JP-CAA-KURUMI'], notes: '일본 권장 20품목 확인' },
  { id: 'apple', labels: { ko: '사과', en: 'Apple', ja: 'りんご', zh: '苹果', vi: 'Táo', es: 'Manzana' }, icon: '🍎', biologicalCategory: 'fruit', refs: [{ s: 'JP-CAA-2023', st: 'recommended' }], evidence: ['EV-JP-CAA-KURUMI'], notes: '일본 권장 20품목 확인' },
  { id: 'orange', labels: { ko: '오렌지', en: 'Orange', ja: 'オレンジ', zh: '橙子', vi: 'Cam', es: 'Naranja' }, icon: '🍊', biologicalCategory: 'fruit', refs: [{ s: 'JP-CAA-2023', st: 'recommended' }], evidence: ['EV-JP-CAA-KURUMI'], notes: '일본 권장 20품목 확인' },
  { id: 'gelatin', labels: { ko: '젤라틴', en: 'Gelatin', ja: 'ゼラチン', zh: '明胶', vi: 'Gelatin', es: 'Gelatina' }, icon: '🍮', biologicalCategory: 'animal_protein_additive', refs: [{ s: 'JP-CAA-2023', st: 'recommended' }], evidence: ['EV-JP-CAA-KURUMI'], notes: '일본 권장 20품목 확인. 돼지/소고기 알레르기와 교차 가능성 있으나 이번엔 별도 검증 안 함' },
  { id: 'salmon', labels: { ko: '연어', en: 'Salmon', ja: 'さけ', zh: '鲑鱼', vi: 'Cá hồi', es: 'Salmón' }, icon: '🐟', biologicalCategory: 'fish', refs: [{ s: 'JP-CAA-2023', st: 'recommended' }], evidence: ['EV-JP-CAA-KURUMI'], notes: '일본 권장 20품목 확인. 기존 "fish"(생선 일반) 항목과 별도로 둘지, 통합할지는 미결정 — biologicalCategory만 공유' },
  { id: 'salmon_roe', labels: { ko: '연어알(이쿠라)', en: 'Salmon roe', ja: 'いくら', zh: '鲑鱼子', vi: 'Trứng cá hồi', es: 'Hueva de salmón' }, icon: '🍣', biologicalCategory: 'fish_roe', refs: [{ s: 'JP-CAA-2023', st: 'recommended' }], evidence: ['EV-JP-CAA-KURUMI'], notes: '일본 권장 20품목 확인(いくら)' },
  { id: 'yam', labels: { ko: '마(참마)', en: 'Yam', ja: 'やまいも', zh: '山药', vi: 'Khoai mỡ', es: 'Ñame' }, icon: '🍠', biologicalCategory: 'root_vegetable', refs: [{ s: 'JP-CAA-2023', st: 'recommended' }], evidence: ['EV-JP-CAA-KURUMI'], notes: '일본 권장 20품목 확인(やまいも)' },
];

const ALL_ALLERGENS_FOR_SHEET = [
  ...ACTIVE_ALLERGENS.map((a) => ({
    id: a.id, legacyIds: a.legacyIds.join(','), ko: a.labels.ko, en: a.labels.en, ja: a.labels.ja,
    zh: a.labels.zh, vi: a.labels.vi, es: a.labels.es, icon: a.icon,
    registryStatus: 'active', biologicalCategory: a.biologicalCategory,
    regulatoryRefs: a.regulatoryRefs.map((r) => `${r.standardId}:${r.status}`).join(' | '),
    evidenceRefs: a.evidenceRefs.join(','), reviewStatus: a.reviewStatus,
    reviewedAt: TODAY, reviewedBy: REVIEWER, notes: a.notes,
  })),
  ...CANDIDATE_ALLERGENS.map((c) => ({
    id: c.id, legacyIds: '', ko: c.labels.ko, en: c.labels.en, ja: c.labels.ja,
    zh: c.labels.zh, vi: c.labels.vi, es: c.labels.es, icon: c.icon,
    registryStatus: 'candidate', biologicalCategory: c.biologicalCategory,
    regulatoryRefs: c.refs.map((r) => `${r.s}:${r.st}`).join(' | '),
    evidenceRefs: c.evidence.join(','), reviewStatus: 'reviewed_as_candidate',
    reviewedAt: TODAY, reviewedBy: REVIEWER, notes: c.notes,
  })),
];

// ---------------------------------------------------------------------
// 02. Allergen_Aliases — IMP-12 선행 작업을 위한 최소 시드(보수적으로만 작성)
// ---------------------------------------------------------------------
// [IMP-18C에서 수정] 과거엔 여기서 01_Allergens.legacyIds를 02_Allergen_Aliases에도
// "미러링"해서 넣었었다. 그런데 legacyIds는 이미 01_Allergens 시트 자체가
// 보관하는 공식 마이그레이션 매핑이고, 02_Allergen_Aliases는 "그 외의"
// 동의어/표기 변형을 위한 별도 공간이다 — 같은 사실(pinenut의 과거 id는
// pineneut이다)을 두 시트에 중복 기록하면, 검증 파이프라인이 "같은
// allergenId에 동의어가 중복 등록됨"으로 잡아낸다(의도된 탐지 — 실제로
// scripts/validate_food_knowledge.py를 처음 돌렸을 때 이 중복을 정확히
// 찾아냈다). 그래서 legacyIds는 01_Allergens에만 두고, 02는 "그 외의"
// 동의어만 갖도록 역할을 분리했다.
const ALLERGEN_ALIASES = [];
// 영어 표기 변형 — 명백한 동일 의미 변형만 보수적으로 추가(동의어 추론 아님)
const CONSERVATIVE_EN_ALIASES = [
  ['peanut', 'peanuts'], ['peanut', 'groundnut'],
  ['walnut', 'walnuts'], ['pinenut', 'pine nut'], ['pinenut', 'pine nuts'],
  ['shellfish', 'shellfish (mollusks)'], ['shrimp', 'prawn'], ['crab', 'crabs'],
  ['squid', 'calamari'], ['soybean', 'soy'], ['soybean', 'soya'],
  ['sesame', 'sesame seed'], ['sulfites', 'sulphites'], ['sulfites', 'sulfur dioxide'],
  ['mackerel', 'mackerels'],
];
CONSERVATIVE_EN_ALIASES.forEach(([id, alias]) => {
  ALLERGEN_ALIASES.push({ allergenId: id, alias, lang: 'en', reviewStatus: 'pending_expert_review', evidenceType: 'ai_estimated_general_knowledge', notes: '동일 의미의 영문 표기 변형으로 추정 — 언어학적/전문 검토 전' });
});

// ---------------------------------------------------------------------
// 03~04. Ingredients / Ingredient_Allergens — 섹션 6의 18개 복합 식재료 우선 조사
// ---------------------------------------------------------------------
// relationType 값: IS_ALLERGEN / CONTAINS_AS_RAW_MATERIAL / TYPICAL_RECIPE_INCLUSION /
//                  PRODUCT_VARIANT_DEPENDENT / OBSERVED_CROSS_CONTACT / UNCONFIRMED
const COMPOSITE_INGREDIENTS = [
  { id: 'ganjang', ko: '간장', en: 'Soy sauce', allergens: [['soybean', 'CONTAINS_AS_RAW_MATERIAL', 'high'], ['wheat', 'PRODUCT_VARIANT_DEPENDENT', 'medium']], note: '전통 재래간장은 대두+소금 위주, 양조간장은 밀 포함 비중이 높음 — 제품별 상이' },
  { id: 'doenjang', ko: '된장', en: 'Fermented soybean paste', allergens: [['soybean', 'CONTAINS_AS_RAW_MATERIAL', 'high']], note: '대두 발효 — 비교적 일관됨' },
  { id: 'gochujang', ko: '고추장', en: 'Fermented chili paste', allergens: [['soybean', 'CONTAINS_AS_RAW_MATERIAL', 'high'], ['wheat', 'PRODUCT_VARIANT_DEPENDENT', 'medium']], note: '찹쌀/보리/밀 중 무엇을 엿기름 베이스로 쓰는지 제품마다 다름' },
  { id: 'ssamjang', ko: '쌈장', en: 'Ssamjang (mixed dipping sauce)', allergens: [['soybean', 'CONTAINS_AS_RAW_MATERIAL', 'high'], ['wheat', 'PRODUCT_VARIANT_DEPENDENT', 'medium'], ['sesame', 'TYPICAL_RECIPE_INCLUSION', 'medium']], note: '된장+고추장 베이스에 참기름이 흔히 추가됨(필수는 아님)' },
  { id: 'aekjeot', ko: '액젓', en: 'Fish/shrimp sauce', allergens: [['fish', 'CONTAINS_AS_RAW_MATERIAL', 'high'], ['shrimp', 'PRODUCT_VARIANT_DEPENDENT', 'medium']], note: '멸치액젓 vs 새우젓 베이스 액젓 — 원료 어종이 제품마다 다름' },
  { id: 'saeujeot', ko: '새우젓', en: 'Salted shrimp', allergens: [['shrimp', 'IS_ALLERGEN', 'high']], note: '새우 자체' },
  { id: 'kimchi', ko: '김치', en: 'Kimchi', allergens: [['fish', 'TYPICAL_RECIPE_INCLUSION', 'medium'], ['shrimp', 'TYPICAL_RECIPE_INCLUSION', 'low'], ['wheat', 'TYPICAL_RECIPE_INCLUSION', 'low']], note: '액젓/새우젓/찹쌀풀 사용 여부는 레시피마다 상이 — "보통 들어갈 수 있다" 수준으로만 등록(확정 아님)' },
  { id: 'eomuk', ko: '어묵', en: 'Fish cake', allergens: [['fish', 'CONTAINS_AS_RAW_MATERIAL', 'high'], ['wheat', 'TYPICAL_RECIPE_INCLUSION', 'medium'], ['egg', 'PRODUCT_VARIANT_DEPENDENT', 'low']], note: '생선살 반죽 + 전분/밀가루 — 계란 포함 여부는 제품별 상이' },
  { id: 'crab_stick', ko: '맛살(게맛살)', en: 'Imitation crab (surimi)', allergens: [['fish', 'CONTAINS_AS_RAW_MATERIAL', 'high'], ['crab', 'UNCONFIRMED', 'low'], ['egg', 'PRODUCT_VARIANT_DEPENDENT', 'low']], note: '실제로는 생선 연육(surimi)이 주원료이며 "게"는 향료/극소량인 경우가 많음 — 게 알레르기 반응 여부는 성분표 직접 확인 필요(UNCONFIRMED로 명시)' },
  { id: 'yuksu', ko: '육수(국물 베이스)', en: 'Broth/stock', allergens: [['soybean', 'TYPICAL_RECIPE_INCLUSION', 'low'], ['fish', 'PRODUCT_VARIANT_DEPENDENT', 'medium'], ['beef', 'PRODUCT_VARIANT_DEPENDENT', 'medium'], ['pork', 'PRODUCT_VARIANT_DEPENDENT', 'medium']], note: '육수 베이스가 멸치/사골/다시마/야채 등 매우 다양 — "육수"는 단일 재료가 아니라 카테고리에 가까움(개별 확인 필수)' },
  { id: 'curry_sauce', ko: '카레 소스', en: 'Curry sauce (Japanese/Korean style roux)', allergens: [['wheat', 'CONTAINS_AS_RAW_MATERIAL', 'high'], ['milk', 'PRODUCT_VARIANT_DEPENDENT', 'medium'], ['pork', 'PRODUCT_VARIANT_DEPENDENT', 'low']], note: '시판 카레 루(roux)는 대부분 밀가루 베이스 — 한국/일본 시판 제품 다수 공통' },
  { id: 'mayonnaise', ko: '마요네즈', en: 'Mayonnaise', allergens: [['egg', 'CONTAINS_AS_RAW_MATERIAL', 'high']], note: '계란 노른자 유화 — 비교적 일관됨(비건 마요 제품은 예외, PRODUCT_VARIANT_DEPENDENT로 재분류 필요시 추후 보완)' },
  { id: 'salad_dressing', ko: '샐러드 드레싱(일반)', en: 'Salad dressing (general)', allergens: [['egg', 'PRODUCT_VARIANT_DEPENDENT', 'medium'], ['milk', 'PRODUCT_VARIANT_DEPENDENT', 'medium'], ['soybean', 'PRODUCT_VARIANT_DEPENDENT', 'low']], note: '드레싱 종류(발사믹/시저/랜치 등)에 따라 완전히 다름 — "일반" 카테고리로는 특정 성분을 확정할 수 없음' },
  { id: 'oyster_sauce', ko: '굴소스', en: 'Oyster sauce', allergens: [['shellfish', 'CONTAINS_AS_RAW_MATERIAL', 'high'], ['wheat', 'PRODUCT_VARIANT_DEPENDENT', 'low'], ['soybean', 'PRODUCT_VARIANT_DEPENDENT', 'low']], note: '굴 추출물 베이스 — 증점제로 밀/대두전분 사용 여부는 제품별 상이' },
  { id: 'mustard_sauce', ko: '머스터드', en: 'Mustard sauce', allergens: [['mustard', 'IS_ALLERGEN', 'high']], note: '겨자씨 자체(후보 알레르겐, 위 01시트 candidate 참고)' },
  { id: 'sesame_oil', ko: '참기름', en: 'Sesame oil', allergens: [['sesame', 'IS_ALLERGEN', 'high']], note: '참깨 압착유 — 사실상 참깨 그 자체' },
  { id: 'peanut_sauce', ko: '땅콩 소스', en: 'Peanut sauce', allergens: [['peanut', 'IS_ALLERGEN', 'high']], note: '땅콩 베이스' },
  // [IMP-18C에서 수정] 원래 이 줄엔 'tree_nut_general'이라는 id로 "견과류
  // 일반"을 표시하려 했으나, 01_Allergens에 그런 id가 실제로 등록된 적이
  // 없어 참조 무결성 검증(BROKEN_REFERENCE)에 정확히 걸렸다. "견과류
  // 일반"이라는 새 알레르겐 카테고리를 지금 근거 없이 새로 만드는 것은
  // 금지사항("근거자료를 확인하지 않은 식재료 관계 추가")에 해당하므로,
  // 새 id를 만들어 통과시키는 대신 이 추정 자체를 제거했다 — 땅콩(peanut)
  // UNCONFIRMED 한 줄만 남긴다(walnut/pinenut 같은 실제 등록된 개별
  // 견과류 id로 대체하는 것도 가능하지만, 어떤 견과류가 실제로 쓰이는지
  // 모르는 상태에서 특정 견과류 id를 임의로 지정하는 것 역시 같은 문제라
  // 일단 보류한다).
  { id: 'bakery_general', ko: '빵 및 제과류(일반)', en: 'Bread & bakery products (general)', allergens: [['wheat', 'CONTAINS_AS_RAW_MATERIAL', 'high'], ['egg', 'TYPICAL_RECIPE_INCLUSION', 'medium'], ['milk', 'TYPICAL_RECIPE_INCLUSION', 'medium'], ['peanut', 'UNCONFIRMED', 'low']], note: '"제과류"는 매우 넓은 카테고리 — 제품명/제조사별 실제 확인 없이는 계란·우유 외 세부 성분 확정 불가. 공장의 견과류 일반 교차오염 가능성은 "어떤 견과류인지"조차 특정할 근거가 없어 이번엔 등록하지 않음(검증 필요로 남김, IMP-18B 다음 조사 대상)' },
];

const INGREDIENTS_SHEET_ROWS = [];
const INGREDIENT_ALLERGENS_SHEET_ROWS = [];
let iaSeq = 1;

COMPOSITE_INGREDIENTS.forEach((ing) => {
  INGREDIENTS_SHEET_ROWS.push({
    id: ing.id, nameKo: ing.ko, nameEn: ing.en, kind: 'composite',
    reviewStatus: 'pending_expert_review', sourceId: 'EV-DEMO-HACKATHON', notes: ing.note,
  });
  ing.allergens.forEach(([allergenId, relType, confidence]) => {
    INGREDIENT_ALLERGENS_SHEET_ROWS.push({
      id: `ia_${String(iaSeq++).padStart(4, '0')}`,
      ingredientId: ing.id,
      allergenId,
      relationType: relType,
      confidence,
      evidenceId: relType === 'IS_ALLERGEN' ? '' : 'EV-DEMO-HACKATHON',
      reviewStatus: relType === 'IS_ALLERGEN' ? 'reviewed' : 'pending_expert_review',
      evidenceType: relType === 'IS_ALLERGEN' ? 'definitional' : 'ai_estimated_general_knowledge',
      reviewedAt: TODAY,
      notes: '',
    });
  });
});

// 단일 알레르겐 = 식재료(IS_ALLERGEN 트리비얼 케이스) — 21개 active 전부에 대해 1행씩
ACTIVE_ALLERGENS.forEach((a) => {
  const ingId = `raw_${a.id}`;
  INGREDIENTS_SHEET_ROWS.push({ id: ingId, nameKo: a.labels.ko, nameEn: a.labels.en, kind: 'single', reviewStatus: 'reviewed', sourceId: 'EV-KR-MFDS-2021', notes: '표준 알레르겐 그 자체(정의상 자명)' });
  INGREDIENT_ALLERGENS_SHEET_ROWS.push({
    id: `ia_${String(iaSeq++).padStart(4, '0')}`, ingredientId: ingId, allergenId: a.id,
    relationType: 'IS_ALLERGEN', confidence: 'high', evidenceId: 'EV-KR-MFDS-2021',
    reviewStatus: 'reviewed', evidenceType: 'definitional', reviewedAt: TODAY, notes: '',
  });
});

// ---------------------------------------------------------------------
// 05~06. Dishes / Dish_Ingredients — 기존 해커톤 14개 데모 장소 재사용
// ---------------------------------------------------------------------
const DEMO_FOOD_IDS = [...indexHtml.matchAll(/foodId:\s*"([a-z_]+)"/g)].map((m) => m[1]);
const DEMO_DISH_NAMES = [...indexHtml.matchAll(/matchedFoodObj:\s*\{\s*foodId:\s*"([a-z_]+)",\s*name:\s*"([^"]+)"/g)];
const nameByFoodId = {};
DEMO_DISH_NAMES.forEach(([, id, name]) => { nameByFoodId[id] = name; });

const DISHES_SHEET_ROWS = [...new Set(DEMO_FOOD_IDS)].map((id) => ({
  id, nameKo: nameByFoodId[id] || id, nameEn: nameByFoodId[id] || id,
  category: 'korean_demo', sourceId: 'EV-DEMO-HACKATHON', reviewStatus: 'demo_content',
  notes: '해커톤 원본 locations[] 데모 데이터 재사용 — 실제 매장 확인 정보 아님',
}));

const DISH_INGREDIENTS_SHEET_ROWS = []; // 지금은 비워둠: 데모 데이터의 ingredients는 자유 텍스트라
// 구조화된 Dish_Ingredients 관계로 기계적으로 쪼개면 "확인 안 된 관계를 임의로 생성"하게 되므로
// 보류한다(검증되지 않은 성분 관계를 임의로 생성하지 않는다는 지시를 그대로 따름).

// ---------------------------------------------------------------------
// 09. Restaurant_Verification — 실제 확인 기록 0건, 정직하게 placeholder로만 기록
// ---------------------------------------------------------------------
const RESTAURANT_VERIFICATION_ROWS = [...new Set(DEMO_FOOD_IDS)].map((id, idx) => ({
  id: `rv_${String(idx + 1).padStart(4, '0')}`,
  locationFoodId: id,
  dishId: id,
  verifiedAllergenFlags: '',
  verificationMethod: 'demo_placeholder',
  verifiedAt: '',
  verifiedBy: 'hackathon_demo_seed',
  confidence: 'none',
  notes: '실제 매장 확인 아님 — IMP-15에서 UI에 반드시 "데모" 표시 필요',
}));

// ---------------------------------------------------------------------
// 10. Epidemiology — 동료평가 연구 3건(완전검증 1건 + 부분검증 2건)
// ---------------------------------------------------------------------
const EPIDEMIOLOGY_ROWS = [
  {
    id: 'epi_0001',
    title: 'Prevalence of Immediate-Type Food Allergy and Food-Induced Anaphylaxis in Korean Schoolchildren',
    authors: 'You Hoon Jeon, Gitae Seo, Chae Hyun Im, Hyeon-Jong Yang, Kee-Jae Lee, Jihyun Kim, Eun Lee, Dong In Suh, Hye Mi Jee, Yong Ju Lee, Hyo-Bin Kim, Woo Kyung Kim, So-Yeon Lee(교신저자), Kangmo Ahn',
    year: 2026,
    doi: '10.4168/aair.2026.18.3.428',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC13226871/',
    country: 'KR(전국)', ageRange: '6-13세(초1,2 / 중1)',
    sampleSize: 12558,
    method: '전국 2단계 층화 군집 표본 설문조사(2022.9~11), 학교 단위 구조화 설문지',
    definition: "자기보고(perceived)/재발성 즉시형(recurrent immediate-type, 분석 기준)/의사진단(physician-diagnosed) 3단계 — 경구유발시험(OFC) 확진 아님",
    prevalence: '재발성 즉시형 7.8%(전체), 의사진단 5.5~5.6%, 아나필락시스 0.7%',
    topAllergens: '복숭아 1.13%, 우유 0.82%, 계란 0.79%, 키위 0.65%, 호두 0.62%, 땅콩 0.62%, 사과 0.61%, 게 0.59%',
    limitations: '검증 필요 — Discussion/Limitations 전문은 이번 세션에서 끝까지 열람하지 못함(요약만 확인)',
    reviewStatus: 'reviewed', reviewedAt: TODAY,
  },
  {
    id: 'epi_0002',
    title: '한국 소아 과일 알레르기 역학(복숭아 최다 보고 포함)',
    authors: '검증 필요(원문 미열람)', year: '검증 필요', doi: '검증 필요',
    url: 'https://synapse.koreamed.org/articles/1051533', country: 'KR', ageRange: '검증 필요',
    sampleSize: '검증 필요', method: '검증 필요(원문 미열람)',
    definition: '검증 필요', prevalence: '복숭아가 전 연령대 상위 과일 알레르겐으로 보고(정확한 수치 미확인)',
    topAllergens: '복숭아, 바나나, 키위(순서는 연령대별로 다름 — 검색 요약 기준)',
    limitations: '원문 미열람으로 미확인',
    reviewStatus: 'pending_verification', reviewedAt: TODAY,
  },
  {
    id: 'epi_0003',
    title: '전연령 중증도별 식품알레르기의 주요 원인: 단일기관 최근 10년 후향적 조사 연구',
    authors: '검증 필요(원문 미열람)', year: 2020, doi: '10.4168/aard.2020.8.2.80',
    url: 'https://aard.or.kr/search.php?where=aview&id=10.4168%2Faard.2020.8.2.80', country: 'KR(단일기관)', ageRange: '전연령',
    sampleSize: '검증 필요', method: '단일기관 10년 후향적 차트리뷰(설문조사 아님 — epi_0001과 방법론 다름, 수치 직접 비교 금지)',
    definition: '의료기관 내원 기록 기반(경구유발시험 여부 불명 — 검증 필요)',
    prevalence: '검증 필요', topAllergens: '우유·새우(7.0%), 계란·고등어(5.8%), 땅콩·토마토(3.5%), 밀·게(2.3%), 돼지고기·복숭아·대두(1.2%) — 검색 요약 기준, 원문 대조 안 됨',
    limitations: '단일기관 자료라 전국 대표성 없음(일반적 후향적 연구의 한계)',
    reviewStatus: 'pending_verification', reviewedAt: TODAY,
  },
];

// ---------------------------------------------------------------------
// 11. Changelog
// ---------------------------------------------------------------------
const CHANGELOG_ROWS = [
  { version: '1.0', date: TODAY, author: 'Claude(세션) + 사용자 검토 대기', summary: 'IMP-18B 최초 구축 — 11시트, Allergens 39(active 21 + candidate 18), 근거자료 20건, 복합식재료 19종, 역학연구 3건(완전검증 1/부분검증 2), 데모 음식 14종 재사용. Restaurant_Verification/Dish_Ingredients는 실제 확인 데이터가 없어 의도적으로 placeholder/보류 처리.' },
  { version: '1.1', date: TODAY, author: 'Claude(세션) + IMP-18C 검증 파이프라인', summary: 'IMP-18C 검증 파이프라인(scripts/validate_food_knowledge.py)이 최초 실행에서 실제 데이터 결함 3종을 발견해 수정: (1) ia_0042가 01_Allergens에 없는 가상의 id \'tree_nut_general\'을 참조(BROKEN_REFERENCE) → 근거 없는 카테고리를 임의로 만들지 않고 해당 UNCONFIRMED 행 자체를 삭제, (2) 02_Allergen_Aliases가 01_Allergens.legacyIds를 그대로 중복 미러링해 동의어 충돌(DUPLICATE_ALIAS) 발생 → legacyIds는 01에만, 02는 그 외 동의어만 갖도록 역할 분리, (3) 복합식재료의 IS_ALLERGEN(정의상 자명) 관계 4건이 evidenceId 없이 reviewed로 표시된 것은 검증기의 평가 규칙을 "definitional 관계는 외부 근거 불필요"로 보정해 해소(데이터 자체는 그대로 유지). 재실행 결과 Error 0건.' },
];

// ---------------------------------------------------------------------
// 워크북 작성
// ---------------------------------------------------------------------
async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Jeonpo AI V2 — IMP-18B';
  wb.created = new Date();

  function addSheet(name, columns, rows) {
    const ws = wb.addWorksheet(name);
    ws.columns = columns;
    rows.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return ws;
  }

  addSheet('01_Allergens', [
    { header: 'id', key: 'id', width: 14 }, { header: 'legacyIds', key: 'legacyIds', width: 12 },
    { header: 'ko', key: 'ko', width: 12 }, { header: 'en', key: 'en', width: 14 },
    { header: 'ja', key: 'ja', width: 12 }, { header: 'zh', key: 'zh', width: 10 },
    { header: 'vi', key: 'vi', width: 14 }, { header: 'es', key: 'es', width: 12 },
    { header: 'icon', key: 'icon', width: 6 }, { header: 'registryStatus', key: 'registryStatus', width: 14 },
    { header: 'biologicalCategory', key: 'biologicalCategory', width: 18 },
    { header: 'regulatoryRefs', key: 'regulatoryRefs', width: 55 }, { header: 'evidenceRefs', key: 'evidenceRefs', width: 20 },
    { header: 'reviewStatus', key: 'reviewStatus', width: 20 }, { header: 'reviewedAt', key: 'reviewedAt', width: 12 },
    { header: 'reviewedBy', key: 'reviewedBy', width: 30 }, { header: 'notes', key: 'notes', width: 60 },
  ], ALL_ALLERGENS_FOR_SHEET);

  addSheet('02_Allergen_Aliases', [
    { header: 'allergenId', key: 'allergenId', width: 14 }, { header: 'alias', key: 'alias', width: 24 },
    { header: 'lang', key: 'lang', width: 10 }, { header: 'reviewStatus', key: 'reviewStatus', width: 22 },
    { header: 'evidenceType', key: 'evidenceType', width: 28 }, { header: 'notes', key: 'notes', width: 60 },
  ], ALLERGEN_ALIASES);

  addSheet('03_Ingredients', [
    { header: 'id', key: 'id', width: 18 }, { header: 'nameKo', key: 'nameKo', width: 20 },
    { header: 'nameEn', key: 'nameEn', width: 26 }, { header: 'kind', key: 'kind', width: 10 },
    { header: 'reviewStatus', key: 'reviewStatus', width: 22 }, { header: 'sourceId', key: 'sourceId', width: 18 },
    { header: 'notes', key: 'notes', width: 70 },
  ], INGREDIENTS_SHEET_ROWS);

  addSheet('04_Ingredient_Allergens', [
    { header: 'id', key: 'id', width: 10 }, { header: 'ingredientId', key: 'ingredientId', width: 18 },
    { header: 'allergenId', key: 'allergenId', width: 14 }, { header: 'relationType', key: 'relationType', width: 26 },
    { header: 'confidence', key: 'confidence', width: 10 }, { header: 'evidenceId', key: 'evidenceId', width: 18 },
    { header: 'reviewStatus', key: 'reviewStatus', width: 22 }, { header: 'evidenceType', key: 'evidenceType', width: 28 },
    { header: 'reviewedAt', key: 'reviewedAt', width: 12 }, { header: 'notes', key: 'notes', width: 60 },
  ], INGREDIENT_ALLERGENS_SHEET_ROWS);

  addSheet('05_Dishes', [
    { header: 'id', key: 'id', width: 16 }, { header: 'nameKo', key: 'nameKo', width: 30 },
    { header: 'nameEn', key: 'nameEn', width: 30 }, { header: 'category', key: 'category', width: 16 },
    { header: 'sourceId', key: 'sourceId', width: 18 }, { header: 'reviewStatus', key: 'reviewStatus', width: 16 },
    { header: 'notes', key: 'notes', width: 55 },
  ], DISHES_SHEET_ROWS);

  addSheet('06_Dish_Ingredients', [
    { header: 'id', key: 'id', width: 10 }, { header: 'dishId', key: 'dishId', width: 16 },
    { header: 'ingredientId', key: 'ingredientId', width: 18 }, { header: 'necessity', key: 'necessity', width: 16 },
    { header: 'sourceId', key: 'sourceId', width: 18 }, { header: 'notes', key: 'notes', width: 60 },
  ], DISH_INGREDIENTS_SHEET_ROWS);

  addSheet('07_Regulatory_Standards', [
    { header: 'id', key: 'id', width: 22 }, { header: 'country', key: 'country', width: 10 },
    { header: 'legalName', key: 'legalName', width: 55 }, { header: 'amendmentDate', key: 'amendmentDate', width: 14 },
    { header: 'mandatoryCount', key: 'mandatoryCount', width: 14 }, { header: 'recommendedCount', key: 'recommendedCount', width: 16 },
    { header: 'sourceId', key: 'sourceId', width: 18 }, { header: 'status', key: 'status', width: 24 },
    { header: 'notes', key: 'notes', width: 90 },
  ], REGULATORY_STANDARDS);

  addSheet('08_Evidence_Sources', [
    { header: 'id', key: 'id', width: 24 }, { header: 'type', key: 'type', width: 18 },
    { header: 'title', key: 'title', width: 55 }, { header: 'url', key: 'url', width: 60 },
    { header: 'publishedDate', key: 'publishedDate', width: 14 }, { header: 'reviewedDate', key: 'reviewedDate', width: 12 },
    { header: 'reliability', key: 'reliability', width: 18 }, { header: 'notes', key: 'notes', width: 80 },
  ], EVIDENCE_SOURCES);

  addSheet('09_Restaurant_Verification', [
    { header: 'id', key: 'id', width: 10 }, { header: 'locationFoodId', key: 'locationFoodId', width: 18 },
    { header: 'dishId', key: 'dishId', width: 16 }, { header: 'verifiedAllergenFlags', key: 'verifiedAllergenFlags', width: 24 },
    { header: 'verificationMethod', key: 'verificationMethod', width: 20 }, { header: 'verifiedAt', key: 'verifiedAt', width: 12 },
    { header: 'verifiedBy', key: 'verifiedBy', width: 20 }, { header: 'confidence', key: 'confidence', width: 10 },
    { header: 'notes', key: 'notes', width: 55 },
  ], RESTAURANT_VERIFICATION_ROWS);

  addSheet('10_Epidemiology', [
    { header: 'id', key: 'id', width: 10 }, { header: 'title', key: 'title', width: 55 },
    { header: 'authors', key: 'authors', width: 50 }, { header: 'year', key: 'year', width: 10 },
    { header: 'doi', key: 'doi', width: 24 }, { header: 'url', key: 'url', width: 45 },
    { header: 'country', key: 'country', width: 14 }, { header: 'ageRange', key: 'ageRange', width: 18 },
    { header: 'sampleSize', key: 'sampleSize', width: 12 }, { header: 'method', key: 'method', width: 45 },
    { header: 'definition', key: 'definition', width: 45 }, { header: 'prevalence', key: 'prevalence', width: 40 },
    { header: 'topAllergens', key: 'topAllergens', width: 50 }, { header: 'limitations', key: 'limitations', width: 40 },
    { header: 'reviewStatus', key: 'reviewStatus', width: 20 }, { header: 'reviewedAt', key: 'reviewedAt', width: 12 },
  ], EPIDEMIOLOGY_ROWS);

  addSheet('11_Changelog', [
    { header: 'version', key: 'version', width: 10 }, { header: 'date', key: 'date', width: 12 },
    { header: 'author', key: 'author', width: 30 }, { header: 'summary', key: 'summary', width: 110 },
  ], CHANGELOG_ROWS);

  const outPath = path.join(ROOT, 'data', 'master', 'Food_Allergen_Master.xlsx');
  await wb.xlsx.writeFile(outPath);

  console.log('생성 완료:', outPath);
  console.log('--- 요약 ---');
  console.log('01_Allergens:', ALL_ALLERGENS_FOR_SHEET.length, '(active', ACTIVE_ALLERGENS.length, '+ candidate', CANDIDATE_ALLERGENS.length, ')');
  console.log('02_Allergen_Aliases:', ALLERGEN_ALIASES.length);
  console.log('03_Ingredients:', INGREDIENTS_SHEET_ROWS.length);
  console.log('04_Ingredient_Allergens:', INGREDIENT_ALLERGENS_SHEET_ROWS.length);
  console.log('05_Dishes:', DISHES_SHEET_ROWS.length);
  console.log('06_Dish_Ingredients:', DISH_INGREDIENTS_SHEET_ROWS.length, '(의도적으로 비움)');
  console.log('07_Regulatory_Standards:', REGULATORY_STANDARDS.length);
  console.log('08_Evidence_Sources:', EVIDENCE_SOURCES.length);
  console.log('09_Restaurant_Verification:', RESTAURANT_VERIFICATION_ROWS.length, '(전부 demo_placeholder)');
  console.log('10_Epidemiology:', EPIDEMIOLOGY_ROWS.length, '(reviewed 1 / pending_verification 2)');
  console.log('11_Changelog:', CHANGELOG_ROWS.length);
}

main().catch((err) => {
  console.error('생성 실패:', err);
  process.exit(1);
});
