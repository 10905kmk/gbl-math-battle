// 기본 도형 정의 (프론트/백엔드 공통)
export const SHAPES = [
  { id: 'triangle', name: '삼각형', baseStats: { attack: 10, defense: 10 } },
  { id: 'square', name: '사각형', baseStats: { attack: 8, defense: 14 } },
];

// 정삼각형, 원점 중심 로컬 좌표
export function trianglePoints(size = 60) {
  const h = (size * Math.sqrt(3)) / 2;
  return [
    { x: 0, y: -(h * 2) / 3 },
    { x: -size / 2, y: h / 3 },
    { x: size / 2, y: h / 3 },
  ];
}

// 정사각형, 원점 중심 로컬 좌표
export function squarePoints(size = 60) {
  const half = size / 2;
  return [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ];
}
