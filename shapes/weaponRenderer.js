import { getShapeGeometry } from './registry.js';

// shapes.js/fractals.js의 좌표는 "원점 중심 로컬 좌표"다 — 부품의 x/y/rotation/scale을 적용해서
// 무기 전체 좌표계(제작 캔버스 기준) 상의 실제 위치로 변환한다. Konva가 노드를 그릴 때 쓰는
// transform(회전 -> 스케일 -> 이동)과 동일한 순서로 계산해야 CanvasEditor.js가 실제로 그리는
// 모습과 bounding box가 일치한다.
function transformPoint(point, part) {
  const scale = Number.isFinite(part.scale) ? part.scale : 1;
  const rotation = Number.isFinite(part.rotation) ? part.rotation : 0;
  const rad = (rotation * Math.PI) / 180;
  const sx = point.x * scale;
  const sy = point.y * scale;
  const rx = sx * Math.cos(rad) - sy * Math.sin(rad);
  const ry = sx * Math.sin(rad) + sy * Math.cos(rad);
  return { x: rx + (Number.isFinite(part.x) ? part.x : 0), y: ry + (Number.isFinite(part.y) ? part.y : 0) };
}

function partLocalPoints(part) {
  const geometry = getShapeGeometry(part.shapeId);
  if (!geometry) return null;
  return geometry.type === 'polygon' ? geometry.points : geometry.triangles.flat();
}

const EMPTY_BOUNDS = { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };

// 부품 전체를 감싸는 bounding box 계산 — 순수 함수, Konva 의존 없음. 존재하지 않는 shapeId를
// 가진 부품은 조용히 건너뛴다(대전 화면이 무기 하나 때문에 죽으면 안 됨).
export function computeWeaponBounds(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return { ...EMPTY_BOUNDS };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  parts.forEach((part) => {
    const localPoints = partLocalPoints(part);
    if (!localPoints) return;
    localPoints.forEach((lp) => {
      const p = transformPoint(lp, part);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });
  });

  if (minX === Infinity) return { ...EMPTY_BOUNDS };
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

// parts를 받아 Konva.Group으로 그려서 반환한다. 이 파일은 Konva를 직접 import하지 않는다 —
// 백엔드도 shapes/를 import하는데, 여기서 'konva'를 static import하면 (a) 이 파일을 Node에서
// import만 해도 'konva' 패키지가 없어서 즉시 에러가 나서 순수 함수(computeWeaponBounds)조차
// 테스트할 수 없게 되고, (b) 브라우저용 CDN import map으로만 존재하는 konva를 backend/가
// 끌고 오게 된다. 그래서 호출 측(battle.js 등, 이미 자기 쪽에서 Konva를 import한 상태)이
// 자신의 Konva 참조를 그대로 넘겨주는 방식으로 만든다 — 동적 import처럼 Promise가 되지도
// 않아서 호출부가 동기 코드 그대로 유지된다.
export function drawWeaponGroup(Konva, parts, { targetSize = 20 } = {}) {
  const group = new Konva.Group();
  if (!Array.isArray(parts) || parts.length === 0) return group;

  const bounds = computeWeaponBounds(parts);
  const maxDim = Math.max(bounds.width, bounds.height);
  const scale = maxDim > 0 ? targetSize / maxDim : 1;

  parts.forEach((part) => {
    const geometry = getShapeGeometry(part.shapeId);
    if (!geometry) return;
    const partScale = Number.isFinite(part.scale) ? part.scale : 1;
    const node = new Konva.Shape({
      x: ((Number.isFinite(part.x) ? part.x : 0) - bounds.minX) * scale,
      y: ((Number.isFinite(part.y) ? part.y : 0) - bounds.minY) * scale,
      rotation: Number.isFinite(part.rotation) ? part.rotation : 0,
      scaleX: partScale * scale,
      scaleY: partScale * scale,
      fill: '#8fd3ff',
      stroke: '#1a5f8a',
      strokeWidth: 1,
      sceneFunc: (ctx, shape) => {
        ctx.beginPath();
        if (geometry.type === 'polygon') {
          geometry.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.closePath();
        } else if (geometry.type === 'triangles') {
          geometry.triangles.forEach(([a, b, c]) => {
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.lineTo(c.x, c.y);
            ctx.closePath();
          });
        }
        ctx.fillStrokeShape(shape);
      },
    });
    group.add(node);
  });

  return group;
}
