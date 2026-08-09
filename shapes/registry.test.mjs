import assert from 'node:assert';
import {
  ALL_SHAPES,
  getShapeById,
  isValidShapeId,
  getShapeGeometry,
  generatePartId,
  partScale,
  clampScale,
  SCALE_MIN,
  SCALE_MAX,
} from './registry.js';

assert.strictEqual(getShapeById('triangle').name, '삼각형');
assert.strictEqual(getShapeById('nope'), null);
assert.strictEqual(isValidShapeId('sierpinski'), true);
assert.strictEqual(isValidShapeId('nope'), false);

// 등록된 도형은 전부 실제로 그릴 수 있는 geometry를 가져야 한다 — 팔레트(ALL_SHAPES)와
// getShapeGeometry의 switch가 어긋나면 팔레트에는 버튼이 보이는데 누르면 렌더링에서
// 터지거나(프론트) 조용히 무시된다(백엔드 AI 툴콜).
for (const shape of ALL_SHAPES) {
  const geometry = getShapeGeometry(shape.id);
  assert.ok(geometry, `${shape.id}의 geometry가 없음 — registry.getShapeGeometry에 case 추가 필요`);
  const points = geometry.type === 'polygon' ? geometry.points : geometry.triangles.flat();
  assert.ok(points.length >= 3, `${shape.id}의 점이 너무 적음`);
  assert.ok(
    points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    `${shape.id}의 좌표에 NaN이 있음`,
  );
  assert.ok(typeof shape.name === 'string' && shape.name.length > 0, `${shape.id}에 표시 이름이 없음`);
}
console.log(`every registered shape (${ALL_SHAPES.length}) has drawable geometry: OK`);

const tri = getShapeGeometry('triangle');
assert.strictEqual(tri.type, 'polygon');
assert.strictEqual(tri.points.length, 3);

const sier = getShapeGeometry('sierpinski');
assert.strictEqual(sier.type, 'triangles');
assert.ok(sier.triangles.length > 0);

// 원은 별도 타입이 아니라 촘촘한 폴리곤으로 근사한다 — bounding box 계산이나 아이콘
// 렌더링이 폴리곤 경로 하나만 알면 되도록.
const circle = getShapeGeometry('circle');
assert.strictEqual(circle.type, 'polygon');
assert.ok(circle.points.length >= 24, '원 근사는 충분히 촘촘해야 함');

// 막대는 세로로 길어야 한다(자루/손잡이 용도).
const bar = getShapeGeometry('bar');
const barW = Math.max(...bar.points.map((p) => p.x)) - Math.min(...bar.points.map((p) => p.x));
const barH = Math.max(...bar.points.map((p) => p.y)) - Math.min(...bar.points.map((p) => p.y));
assert.ok(barH > barW * 3, '막대는 세로로 길쭉해야 함');

// partScale — 새 형식(scaleX/scaleY), 예전 형식(등비 scale), 값이 없는 경우를 모두 흡수한다.
// 예전 형식 흡수가 깨지면 Supabase에 이미 저장된 결과와 few-shot 샘플이 전부 크기 1로
// 렌더링된다.
assert.deepStrictEqual(partScale({ scaleX: 2, scaleY: 0.5 }), { sx: 2, sy: 0.5 });
assert.deepStrictEqual(partScale({ scale: 1.5 }), { sx: 1.5, sy: 1.5 }, '예전 등비 scale을 양축에 적용');
assert.deepStrictEqual(partScale({}), { sx: 1, sy: 1 });
assert.deepStrictEqual(partScale(null), { sx: 1, sy: 1 });
assert.deepStrictEqual(partScale({ scale: 2, scaleX: 3 }), { sx: 3, sy: 2 }, '새 필드가 있으면 그쪽이 우선');
assert.deepStrictEqual(partScale({ scaleX: 'big', scaleY: 1.2 }), { sx: 1, sy: 1.2 });

assert.strictEqual(clampScale(99), SCALE_MAX);
assert.strictEqual(clampScale(0), SCALE_MIN);
assert.strictEqual(clampScale(1.7), 1.7);
assert.strictEqual(clampScale('nope'), 1, '숫자가 아니면 기본 크기로');
assert.strictEqual(clampScale(undefined, 2.5), 2.5, '대체값을 지정할 수 있어야 함');
console.log('partScale/clampScale absorb both the new and legacy size formats: OK');

const id1 = generatePartId();
const id2 = generatePartId();
assert.notStrictEqual(id1, id2, 'ids should be unique');
assert.match(id1, /^p[a-z0-9]+$/);

console.log('registry.test.mjs: OK');
