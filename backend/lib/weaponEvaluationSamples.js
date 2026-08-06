// AI 채점 few-shot 프롬프트 + 캐시 사전 시딩 겸용 샘플. damage/attackRange는 팀이 정한 기준값.
export const SAMPLES = [
  {
    parts: [{ id: 's1', shapeId: 'triangle', x: 100, y: 100, rotation: 0, scale: 1 }],
    damage: 3000,
    attackRange: 'melee',
    note: '기본 삼각형 검',
  },
  {
    parts: [{ id: 's1', shapeId: 'square', x: 100, y: 100, rotation: 0, scale: 1 }],
    damage: 2500,
    attackRange: 'melee',
    note: '기본 사각형 방패',
  },
  {
    parts: [
      { id: 's1', shapeId: 'sierpinski', x: 100, y: 60, rotation: 0, scale: 0.6 },
      { id: 's2', shapeId: 'square', x: 100, y: 140, rotation: 0, scale: 1.4 },
    ],
    damage: 7200,
    attackRange: 'melee',
    note: '시에르핀스키 촉 + 사각 손잡이 창 — 손에 쥐고 찌르는 용도라 길어도 melee',
  },
  // 뭉툭하고 안 길쭉한(정삼각형 4개를 십자로 모은) 모양이지만 표창/수리검처럼 "던지는"
  // 무기라 ranged다 — 위 창 샘플과 짝지어서, attackRange 판단 기준이 "모양이 길쭉한가"가
  // 아니라 "손에서 놓고 날아가는가"라는 걸 few-shot으로 명확히 보여준다(사용자가 투척용으로
  // 만든 무기가 자꾸 melee로 오판되던 문제 — 창=melee 예시와 상충하는 지시문 때문이었음).
  {
    parts: [
      { id: 's1', shapeId: 'triangle', x: 100, y: 70, rotation: 0, scale: 0.5 },
      { id: 's2', shapeId: 'triangle', x: 130, y: 100, rotation: 90, scale: 0.5 },
      { id: 's3', shapeId: 'triangle', x: 100, y: 130, rotation: 180, scale: 0.5 },
      { id: 's4', shapeId: 'triangle', x: 70, y: 100, rotation: 270, scale: 0.5 },
    ],
    damage: 1800,
    attackRange: 'ranged',
    attackRangeDistance: 250,
    note: '작은 삼각형 4개로 만든 표창(수리검) — 뭉툭해도 던지는 무기라 ranged',
  },
];
