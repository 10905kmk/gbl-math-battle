// 기본 도형 정의 (프론트/백엔드 공통)
//
// 모든 좌표 생성 함수는 "원점 근처의 로컬 좌표"를 돌려준다 — 실제 배치(x/y/rotation/
// scaleX/scaleY)는 part가 갖고, 렌더러(CanvasEditor.js / weaponRenderer.js)가 도형 bbox의
// 중심을 원점에 맞춘 뒤 변환을 적용한다.
export const SHAPES = [
  { id: 'triangle', name: '삼각형', baseStats: { attack: 10, defense: 10 } },
  { id: 'square', name: '사각형', baseStats: { attack: 8, defense: 14 } },
  { id: 'circle', name: '원', baseStats: { attack: 7, defense: 13 } },
  { id: 'bar', name: '막대', baseStats: { attack: 9, defense: 7 } },
  { id: 'rhombus', name: '마름모', baseStats: { attack: 12, defense: 8 } },
  { id: 'pentagon', name: '오각형', baseStats: { attack: 9, defense: 12 } },
  { id: 'hexagon', name: '육각형', baseStats: { attack: 9, defense: 13 } },
  { id: 'star', name: '별', baseStats: { attack: 13, defense: 6 } },
];

// 정n각형, 원점 중심. startAngle 기본값 -90°는 꼭짓점이 위를 향하게 한다.
export function regularPolygonPoints(sides, radius, startAngle = -Math.PI / 2) {
  return Array.from({ length: sides }, (_, i) => {
    const angle = startAngle + (i * 2 * Math.PI) / sides;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
}

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

// 직사각형(막대) — 세로로 긴 형태. 눕히고 싶으면 회전시키거나 scaleX/scaleY로 늘리면 된다.
export function rectPoints(width, height) {
  const hw = width / 2;
  const hh = height / 2;
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
}

// 원 — 별도 geometry 타입을 만들지 않고 촘촘한 정다각형으로 근사한다. 이렇게 하면
// bounding box 계산(weaponRenderer)·팔레트 아이콘·AI 채점까지 폴리곤 경로 하나로 전부
// 재사용된다. 48각형이면 60px 크기에서 직선 구간이 4px 미만이라 눈으로는 원과 구별되지 않고,
// scaleX/scaleY를 따로 주면 그대로 타원이 된다.
export function circlePoints(size = 60) {
  return regularPolygonPoints(48, size / 2);
}

// 마름모 — 가로로 살짝 좁은 다이아몬드
export function rhombusPoints(size = 60) {
  const hw = (size * 0.62) / 2;
  const hh = size / 2;
  return [
    { x: 0, y: -hh },
    { x: hw, y: 0 },
    { x: 0, y: hh },
    { x: -hw, y: 0 },
  ];
}

// 별(5각) — 바깥 꼭짓점과 안쪽 꼭짓점을 번갈아 잇는다. 오목 다각형이지만 캔버스의
// 기본 nonzero 채우기 규칙으로 정상적으로 칠해진다.
export function starPoints(size = 60, points = 5, innerRatio = 0.42) {
  const outer = size / 2;
  const inner = outer * innerRatio;
  const result = [];
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / points;
    result.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  }
  return result;
}
