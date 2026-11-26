// AUTO-EXTRACTED small constant tables from index.html.
/* eslint-disable */
export const DIETARY_VIOLATION_ALLERGENS = {
      // [IMP-11] 'fish'를 신규 표준 id로 등록하면서, vegan/vegetarian 위반 목록에도
      // 함께 추가했다. 'fish'와 같은 동물성 재료인 mackerel/shellfish 등은 이미
      // 이 목록에 있었는데 'fish'만 빠져 있으면, 예를 들어 액젓(fish sauce)이 들어간
      // 음식을 비건 사용자가 스캔해도 식이 위반으로 잡히지 않는 새로운 불일치가
      // 생기기 때문이다. halal에는 생선이 허용되므로 추가하지 않는다.
      vegan: ['pork', 'beef', 'chicken', 'egg', 'milk', 'shrimp', 'crab', 'squid', 'mackerel', 'shellfish', 'fish'],
      vegetarian: ['pork', 'beef', 'chicken', 'shrimp', 'crab', 'squid', 'mackerel', 'shellfish', 'fish'],
      halal: ['pork']
    } as Record<string, string[]>;
export const LANG_TO_COUNTRY = { en: 'USA', ja: 'Japan', zh: 'China', vi: 'Vietnam', es: 'Spain', ko: 'Korea' } as Record<string, string>;
export const DIET_PHRASES_KO = {
      vegan: '저는 비건이라 고기, 생선, 유제품, 계란, 꿀 등 모든 동물성 재료가 들어간 음식을 먹을 수 없습니다.',
      halal: '저는 할랄 음식만 먹을 수 있습니다. 돼지고기나 술이 들어간 음식은 피해야 합니다.',
      vegetarian: '저는 채식주의자라 고기와 생선이 들어간 음식을 먹지 않습니다.'
    } as Record<string, string>;
export const KNOWN_AMBIGUOUS_CUSTOM_TERMS = {
      shellfish: {
        candidateIds: ['shrimp', 'crab', 'shellfish'],
        // 라벨은 다국어 중 영어만 우선 지원(커스텀 입력 자체가 영어 위주라는
        // 기존 설계를 그대로 따름) — 다국어 확장은 IMP-12 범위 밖(§13).
        explanation:
          'English "shellfish" can mean crustaceans (shrimp/crab) and/or molluscs ' +
          '(clams/oysters/mussels). Our "shellfish" category only covers molluscs ' +
          '(per Korean food labeling law) — please tell us which one you mean.',
      },
    } as Record<string, { candidateIds: string[] }>;
