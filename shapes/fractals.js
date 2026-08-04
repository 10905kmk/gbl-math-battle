// 프랙탈 도형 정의 (시에르핀스키, 코흐눈꽃 등)
export const FRACTALS = [
  { id: 'sierpinski', name: '시에르핀스키 삼각형', baseStats: { attack: 14, defense: 6 } },
  { id: 'koch', name: '코흐눈꽃', baseStats: { attack: 6, defense: 16 } },
];

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function sierpinskiRecurse(a, b, c, depth, out) {
  if (depth === 0) {
    out.push([a, b, c]);
    return;
  }
  const ab = midpoint(a, b);
  const bc = midpoint(b, c);
  const ca = midpoint(c, a);
  sierpinskiRecurse(a, ab, ca, depth - 1, out);
  sierpinskiRecurse(ab, b, bc, depth - 1, out);
  sierpinskiRecurse(ca, bc, c, depth - 1, out);
}

// 시에르핀스키 삼각형 — 채워야 할 작은 삼각형들의 목록을 반환
export function sierpinskiTriangles(size = 60, depth = 4) {
  const h = (size * Math.sqrt(3)) / 2;
  const a = { x: 0, y: -(h * 2) / 3 };
  const b = { x: -size / 2, y: h / 3 };
  const c = { x: size / 2, y: h / 3 };
  const out = [];
  sierpinskiRecurse(a, b, c, depth, out);
  return out;
}

function kochSegment(a, b, depth) {
  if (depth === 0) return [a];
  const dx = (b.x - a.x) / 3;
  const dy = (b.y - a.y) / 3;
  const p1 = { x: a.x + dx, y: a.y + dy };
  const p3 = { x: a.x + dx * 2, y: a.y + dy * 2 };
  const angle = Math.atan2(dy, dx) - Math.PI / 3;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const p2 = { x: p1.x + Math.cos(angle) * dist, y: p1.y + Math.sin(angle) * dist };
  return [
    ...kochSegment(a, p1, depth - 1),
    ...kochSegment(p1, p2, depth - 1),
    ...kochSegment(p2, p3, depth - 1),
    ...kochSegment(p3, b, depth - 1),
  ];
}

// 코흐눈꽃 — 닫힌 폴리곤을 이루는 점 목록을 반환 (마지막 점→첫 점은 호출부에서 닫는다고 가정)
export function kochSnowflakePoints(size = 60, depth = 3) {
  const h = (size * Math.sqrt(3)) / 2;
  const a = { x: 0, y: -(h * 2) / 3 };
  const b = { x: -size / 2, y: h / 3 };
  const c = { x: size / 2, y: h / 3 };
  return [...kochSegment(a, b, depth), ...kochSegment(b, c, depth), ...kochSegment(c, a, depth)];
}
