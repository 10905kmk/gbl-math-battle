import { SHAPES, trianglePoints, squarePoints } from './shapes.js';
import { FRACTALS, sierpinskiTriangles, kochSnowflakePoints } from './fractals.js';

export const ALL_SHAPES = [...SHAPES, ...FRACTALS];

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
    case 'sierpinski':
      return { type: 'triangles', triangles: sierpinskiTriangles(size, 4) };
    case 'koch':
      return { type: 'polygon', points: kochSnowflakePoints(size, 3) };
    default:
      return null;
  }
}

// 프론트(수동 편집)와 백엔드(AI 채팅 addPart) 양쪽에서 part id를 생성할 때 공용으로 쓴다.
export function generatePartId() {
  return `p${Math.random().toString(36).slice(2, 8)}`;
}
