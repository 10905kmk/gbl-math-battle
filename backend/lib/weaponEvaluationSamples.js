// AI 채점 few-shot 프롬프트 + 캐시 사전 시딩 겸용 샘플. damage/attackRange는 팀이 정한 기준값 —
// 셋 다 손에 들고 쓰는 무기(검/방패/창)라 attackRange는 전부 melee.
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
    note: '시에르핀스키 촉 + 사각 손잡이 창',
  },
];
