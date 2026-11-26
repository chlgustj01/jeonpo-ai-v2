// tests/imp-18d2-repro-before.js
//
// [IMP-18D-2] 수정 "전" 결함 재현 — 재구현 없이, IMP-02 완료 커밋(9230407)의
// index.html / shared/allergens.js / shared/dish-schema.js 원본을
// `git show 9230407:<path>`로 그대로 꺼내 임시 폴더에 두고, 현재와 같은
// tests/harness.js로 실행한다. (harness가 shared/food-knowledge.js를 읽지 않도록
// skipFoodKnowledge: true — 당시에는 그 파일 자체가 없었다.)
//
// 재현 시나리오(Mock, 실제 Gemini 호출 없음):
//   사용자: 참깨(sesame) 알레르기
//   AI 응답: 비빔밥 — ingredients에 "Sesame oil"이 있지만 allergens 배열에는
//            sesame가 빠져 있음(AI 누락)
//   실제 지식 DB: ingredient-knowledge.json에 sesame_oil → sesame 관계(ia_0036,
//            식품공전 근거 EV-KR-FOODCODE-SESAMEOIL)가 이미 존재
//   기대(수정 전 결함): 결과는 GREEN, 어떤 추가 확인 정보도 없음, 그리고
//            ingredient-knowledge.json은 아예 요청조차 되지 않음.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadApp, pick } = require('./harness.js');

const ROOT = path.join(__dirname, '..');
const BEFORE_COMMIT = '9230407';
const GEN = path.join(ROOT, 'data', 'generated');

function gitShow(relPath) {
  return execFileSync('git', ['show', `${BEFORE_COMMIT}:${relPath}`], { cwd: ROOT, encoding: 'utf8' });
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp18d2-before-'));
  fs.mkdirSync(path.join(dir, 'shared'));
  fs.writeFileSync(path.join(dir, 'index.html'), gitShow('index.html'));
  fs.writeFileSync(path.join(dir, 'shared', 'allergens.js'), gitShow('shared/allergens.js'));
  fs.writeFileSync(path.join(dir, 'shared', 'dish-schema.js'), gitShow('shared/dish-schema.js'));

  const DS = require(path.join(dir, 'shared', 'dish-schema.js'));
  const REG = require(path.join(dir, 'shared', 'allergens.js'));
  const envelope = DS.validateAndNormalizeDishesResponse({
    dishes: [{
      name_ko: '비빔밥', name_en: 'Bibimbap', translated_name: 'Bibimbap',
      ingredients: 'Rice, Vegetables, Gochujang, Sesame oil',
      allergens: ['soybean', 'wheat'], // sesame 누락(AI 실수 가정)
      crossContactAllergens: [],
      spicy: 1, eatingMethod: ['Mix well'], description: 'Mixed rice', culturalNote: '',
    }],
  }, REG.map((r) => r.id));

  const fetchLog = [];
  const real = (f) => fs.readFileSync(path.join(GEN, f), 'utf8');
  const fetchImpl = async (url) => {
    fetchLog.push(String(url));
    const files = ['allergen-aliases.json', 'allergen-candidates.json', 'knowledge-manifest.json', 'ingredient-knowledge.json', 'evidence-sources.json'];
    const hit = files.find((f) => String(url).includes(f));
    if (hit) return { ok: true, status: 200, json: async () => JSON.parse(real(hit)) };
    if (String(url).includes('/api/analyze-menu')) return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(envelope)) };
    throw new Error('[mock] unexpected ' + url);
  };

  const { context } = loadApp(path.join(dir, 'index.html'), { fetchImpl, skipFoodKnowledge: true });
  const app = pick(context, ['state', 'allergenKnowledgeBaseReady', 'checkDishSafety', 'analyzeMenuPhotoWithAI']);
  await app.allergenKnowledgeBaseReady;
  app.state.selectedAllergies.add('sesame');
  app.state.selectedSpicy = 3;

  await app.analyzeMenuPhotoWithAI('data:image/jpeg;base64,AAAA');
  const dish = envelope.dishes[0];
  const safety = app.checkDishSafety(dish);

  // 실제 지식 DB에는 관계가 있었다는 사실 확인(데이터는 있었지만 쓰이지 않음)
  const ik = JSON.parse(real('ingredient-knowledge.json'));
  const rel = ik.literatureBackedCandidates.find((r) => r.ingredientId === 'sesame_oil' && r.allergenId === 'sesame');

  const defects = [];
  function defect(id, desc, fn) {
    try { fn(); defects.push({ id, desc, reproduced: true }); console.log(`[REPRODUCED] ${id} ${desc}`); }
    catch (e) { defects.push({ id, desc, reproduced: false }); console.log(`[NOT REPRODUCED] ${id} ${desc} — ${e.message}`); }
  }

  defect('D1', '참깨 알레르기 사용자에게 "Sesame oil" 포함 음식이 GREEN으로 표시됨', () => {
    assert.strictEqual(safety.safetyState, 'green');
  });
  defect('D2', '실제 지식 DB에는 sesame_oil→sesame 관계(ia_0036)가 존재함 — 데이터가 있었지만 쓰이지 않음', () => {
    assert.ok(rel && rel.id === 'ia_0036' && rel.evidenceId === 'EV-KR-FOODCODE-SESAMEOIL');
  });
  defect('D3', 'ingredient-knowledge.json / evidence-sources.json은 수정 전 코드에서 한 번도 요청되지 않음(IMP-12의 3개 파일만 로딩)', () => {
    assert.ok(!fetchLog.some((u) => u.includes('ingredient-knowledge.json')));
    assert.ok(!fetchLog.some((u) => u.includes('evidence-sources.json')));
    assert.strictEqual(fetchLog.filter((u) => u.includes('data/generated/')).length, 3);
  });
  defect('D4', '수정 전 코드에는 식재료 문자열을 지식 DB와 대조하는 함수/상태가 없음(추가 확인 정보 표시 불가)', () => {
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.ok(!html.includes('ingredient-knowledge.json'));
    assert.ok(!/knowledgeFindings|lastKnowledgeReports/.test(html));
  });

  fs.rmSync(dir, { recursive: true, force: true });
  const reproduced = defects.filter((d) => d.reproduced).length;
  console.log(`\n=== 요약 === 재현 ${reproduced}/${defects.length}`);
  console.log('수정 전 data/generated 요청 목록:', fetchLog.filter((u) => u.includes('data/generated/')));
  process.exit(reproduced === defects.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
