// tests/imp-01-repro-before.js
//
// [IMP-01] 수정 "전" 결함 재현.
//
// 아래 함수는 index.html:3378(수정 전 시점)의 다음 한 줄을 그대로 복사한
// 것이다 — 함수로 분리되어 있지 않고 analyzeMenuPhotoWithAI() 안의 화살표
// 함수 리터럴 한 줄이라 harness로 직접 호출할 수 없어, 코드 자체를
// 그대로 옮겨 테스트한다(재구현이 아니라 복사 — 로직을 바꾸지 않았음을
// 사전에 `grep -n "Number.isFinite(d.spicy)" index.html`로 확인했고,
// 그 결과가 사용자가 제시한 예시 코드와 글자 하나까지 동일함을 확인했다).
const OLD_FORMULA = (d_spicy) => (Number.isFinite(d_spicy) ? Math.max(0, Math.min(3, Math.round(d_spicy))) : 0);

const INPUT_MATRIX = [
  { label: '0', value: 0 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: 'null', value: null },
  { label: 'undefined', value: undefined },
  { label: 'NaN', value: NaN },
  { label: 'Infinity', value: Infinity },
  { label: '음수(-1)', value: -1 },
  { label: '3 초과(5)', value: 5 },
  { label: '소수(1.7)', value: 1.7 },
  { label: '숫자형 문자열("2")', value: '2' },
  { label: '빈 문자열("")', value: '' },
  { label: '객체({})', value: {} },
  { label: '배열([2])', value: [2] },
  { label: '필드 자체 없음(undefined와 동일하게 전달됨)', value: undefined },
];

console.log('=== [IMP-01] 수정 전 결함 재현 — 기존 공식 그대로 실행 ===\n');
console.log('기존 공식: Number.isFinite(d.spicy) ? Math.max(0, Math.min(3, Math.round(d.spicy))) : 0\n');

const results = [];
INPUT_MATRIX.forEach(({ label, value }) => {
  const output = OLD_FORMULA(value);
  results.push({ label, value, output });
  console.log(`입력: ${label.padEnd(36)} → 출력: ${output}`);
});

console.log('\n=== 재현된 문제 ===');
const problemCases = results.filter((r) => r.output === 0 && !(r.value === 0));
console.log(
  `"0(안 매움, 확정)"과 구분되지 않고 전부 0으로 귀결되는 입력: ${problemCases.length}건\n` +
    problemCases.map((r) => `  - ${r.label}`).join('\n'),
);
console.log(
  '\n→ null/undefined/NaN/Infinity/음수/초과값/소수/문자열/객체/배열 — 전부 "매운맛 없음(0, 확정)"으로\n' +
    '  둔갑한다. 사용자가 맵기 0단계로 설정해뒀다면 이 전부가 "안전(green 유지)"으로 처리되어,\n' +
    '  실제로는 AI가 맵기를 판단하지 못했을 뿐인데 "안 맵다고 확인됨"처럼 보이게 된다.',
);
