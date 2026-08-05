import { getShapeGeometry } from './registry.js';

function shapeLocalPoints(geometry) {
  return geometry.type === 'polygon' ? geometry.points : geometry.triangles.flat();
}

// CanvasEditor.js의 drawShapeNode는 각 도형 자체의 bounding box 중심을 offsetX/offsetY로 잡아서,
// part.x/part.y가 "그 도형 bbox의 중심이 놓이는 위치"가 되도록 그린다(정사각형/코흐눈꽃처럼
// 로컬 좌표가 원점 대칭인 도형은 중심이 (0,0)이라 눈에 안 띄지만, 삼각형/시에르핀스키처럼
// 수직으로 비대칭인 도형은 중심이 (0,-8.66)이라 그냥 원점 기준으로 계산하면 8.66px*scale만큼
// 어긋난다 — Opus 리뷰에서 실측으로 확인된 문제). 여기서도 같은 기준으로 맞춰야 무기 미리보기가
// 실제 제작 화면과 일치한다.
function shapeCenter(geometry) {
  const points = shapeLocalPoints(geometry);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

// shapes.js/fractals.js의 좌표는 "원점 중심 로컬 좌표"라 부품의 x/y/rotation/scale을 적용해서
// 무기 전체 좌표계(제작 캔버스 기준) 상의 실제 위치로 변환한다. Konva가 노드를 그릴 때 쓰는
// transform(회전 -> 스케일 -> 이동)과 동일한 순서로 계산해야 실제로 그려지는 모습과 bounding
// box가 일치한다. `point`는 이미 도형 자신의 bbox 중심이 빠진(centered) 좌표여야 한다 —
// 호출부(computeWeaponBounds/drawWeaponGroup)가 shapeCenter()로 미리 빼고 넘겨준다.
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

// part 하나가 유효한 도형을 가리키는지 확인하고, 유효하면 그 도형의 geometry와 중심을 반환한다.
// part 자체가 null/undefined거나 배열의 원소가 아니거나(클라이언트가 보낸 값을 검증 없이 그대로
// 쓰는 session.js의 create:done 경로로 들어올 수 있음), shapeId가 존재하지 않으면 null —
// 호출부는 그 부품만 건너뛴다(무기 하나 때문에 대전 화면 전체가 멈추면 안 됨).
function resolvePart(part) {
  if (!part || typeof part !== 'object') return null;
  const geometry = getShapeGeometry(part.shapeId);
  if (!geometry) return null;
  return { geometry, center: shapeCenter(geometry) };
}

const EMPTY_BOUNDS = { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };

// 부품 전체를 감싸는 bounding box 계산 — 순수 함수, Konva 의존 없음.
export function computeWeaponBounds(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return { ...EMPTY_BOUNDS };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  parts.forEach((part) => {
    const resolved = resolvePart(part);
    if (!resolved) return;
    shapeLocalPoints(resolved.geometry).forEach((lp) => {
      const centered = { x: lp.x - resolved.center.x, y: lp.y - resolved.center.y };
      const p = transformPoint(centered, part);
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
  if (!Konva || typeof Konva.Group !== 'function') {
    throw new Error('drawWeaponGroup requires a Konva namespace as its first argument');
  }

  const bounds = computeWeaponBounds(parts);
  const group = new Konva.Group();
  if (!Array.isArray(parts) || parts.length === 0) return group;

  const maxDim = Math.max(bounds.width, bounds.height);
  const scale = maxDim > 0 ? targetSize / maxDim : 1;
  // 그룹의 등록점(x/y)을 무기 아이콘의 중심으로 옮긴다 — 이렇게 안 하면 좌상단이 기준점이 돼서
  // battle.js가 캐릭터 옆에 배치할 때 캐릭터가 위/왼쪽을 볼 때는 무기가 캐릭터 원 안쪽으로
  // 파고든다(Opus 리뷰에서 실측: 중심에서 17.3px, 반경 20px 원과 겹침).
  group.offsetX((bounds.width * scale) / 2);
  group.offsetY((bounds.height * scale) / 2);

  parts.forEach((part) => {
    const resolved = resolvePart(part);
    if (!resolved) return;
    const { geometry, center } = resolved;
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
      // 무기 아이콘은 원본 대비 훨씬 작게 스케일되므로(scaleX/Y가 보통 0.06~0.33) strokeWidth도
      // 같이 줄어들어 테두리가 거의 안 보이게 된다 — strokeScaleEnabled:false로 축소와
      // 무관하게 1px 테두리를 유지한다.
      strokeScaleEnabled: false,
      sceneFunc: (ctx, shape) => {
        ctx.beginPath();
        if (geometry.type === 'polygon') {
          geometry.points.forEach((p, i) => {
            const px = p.x - center.x;
            const py = p.y - center.y;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          });
          ctx.closePath();
        } else if (geometry.type === 'triangles') {
          geometry.triangles.forEach(([a, b, c]) => {
            ctx.moveTo(a.x - center.x, a.y - center.y);
            ctx.lineTo(b.x - center.x, b.y - center.y);
            ctx.lineTo(c.x - center.x, c.y - center.y);
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
