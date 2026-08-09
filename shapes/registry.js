import {
  SHAPES,
  trianglePoints,
  squarePoints,
  circlePoints,
  rectPoints,
  rhombusPoints,
  regularPolygonPoints,
  starPoints,
} from './shapes.js';
import { FRACTALS, sierpinskiTriangles, kochSnowflakePoints } from './fractals.js';

export const ALL_SHAPES = [...SHAPES, ...FRACTALS];

// 크기 조절 허용 범위 — 프론트(드래그 편집)와 백엔드(AI 툴콜 clamp)가 같은 값을 써야
// "AI로는 되는데 손으로는 안 되는" 크기가 생기지 않는다. 그림판처럼 자유롭게 만들라는
// 요구에 맞춰 예전 0.2~3.0에서 넓혔다 — 하한은 60px 도형이 9px까지, 상한은 캔버스
// (480px)를 꽉 채우고도 남는 300px까지.
export const SCALE_MIN = 0.15;
export const SCALE_MAX = 5;

export function getShapeById(shapeId) {
  return ALL_SHAPES.find((s) => s.id === shapeId) ?? null;
}

export function isValidShapeId(shapeId) {
  return getShapeById(shapeId) !== null;
}

export function getShapeGeometry(shapeId, size = 60) {
  switch (shapeId) {
    case 'triangle':
      return { type: 'polygon', points: trianglePoints(size) };
    case 'square':
      return { type: 'polygon', points: squarePoints(size) };
    case 'circle':
      return { type: 'polygon', points: circlePoints(size) };
    case 'bar':
      // 1:6 비율의 세로 막대. 자루/손잡이용이라 기본 길이를 다른 도형보다 길게 잡는다.
      return { type: 'polygon', points: rectPoints(size / 4, size * 1.6) };
    case 'rhombus':
      return { type: 'polygon', points: rhombusPoints(size) };
    case 'pentagon':
      return { type: 'polygon', points: regularPolygonPoints(5, size / 2) };
    case 'hexagon':
      return { type: 'polygon', points: regularPolygonPoints(6, size / 2) };
    case 'star':
      return { type: 'polygon', points: starPoints(size) };
    case 'sierpinski':
      return { type: 'triangles', triangles: sierpinskiTriangles(size, 4) };
    case 'koch':
      return { type: 'polygon', points: kochSnowflakePoints(size, 3) };
    default:
      return null;
  }
}

// part의 크기를 (sx, sy) 한 쌍으로 정규화한다.
//
// 데이터 모델이 등비 `scale` 하나에서 가로/세로 독립인 `scaleX`/`scaleY`로 바뀌었지만,
// 예전 형식이 여전히 여러 곳에서 들어온다 — few-shot 샘플, Supabase에 이미 저장된 결과,
// `scale`만 아는 AI 응답, 그리고 tools/few-shot-builder. 읽는 쪽에서 한 번만 흡수하면
// 그 경로들을 전부 고치지 않아도 되고, 새 필드가 없을 때 도형이 사라지는 사고도 막는다.
export function partScale(part) {
  const legacy = Number.isFinite(part?.scale) ? part.scale : 1;
  return {
    sx: Number.isFinite(part?.scaleX) ? part.scaleX : legacy,
    sy: Number.isFinite(part?.scaleY) ? part.scaleY : legacy,
  };
}

export function clampScale(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, num));
}

// 프론트(수동 편집)와 백엔드(AI 채팅 addPart) 양쪽에서 part id를 생성할 때 공용으로 쓴다.
export function generatePartId() {
  return `p${Math.random().toString(36).slice(2, 8)}`;
}
