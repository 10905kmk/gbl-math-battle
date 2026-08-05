import assert from 'node:assert';
import { computeWeaponBounds } from './weaponRenderer.js';

// 부품 없음 -> 전부 0
assert.deepStrictEqual(
  computeWeaponBounds([]),
  { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
);
console.log('computeWeaponBounds with no parts: OK');

// 삼각형 1개, 원점/무회전/scale=1 -> shapes.js의 trianglePoints(60) 그대로
{
  const bounds = computeWeaponBounds([{ shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 1 }]);
  assert.ok(Math.abs(bounds.width - 60) < 0.01, `width는 60이어야 함, 실제 ${bounds.width}`);
  assert.ok(Math.abs(bounds.height - 51.96) < 0.1, `height는 약 51.96이어야 함, 실제 ${bounds.height}`);
}
console.log('computeWeaponBounds single triangle at origin: OK');

// 정사각형을 45도 회전하면 대각선만큼 bounding box가 커져야 함 (60 -> 60*sqrt(2))
{
  const bounds = computeWeaponBounds([{ shapeId: 'square', x: 0, y: 0, rotation: 45, scale: 1 }]);
  const expected = 60 * Math.SQRT2;
  assert.ok(Math.abs(bounds.width - expected) < 0.5, `45도 회전한 정사각형의 width는 약 ${expected}이어야 함, 실제 ${bounds.width}`);
}
console.log('computeWeaponBounds accounts for rotation: OK');

// 서로 멀리 떨어진 부품 2개 -> 둘을 모두 감싸는 bounding box
{
  const bounds = computeWeaponBounds([
    { shapeId: 'square', x: 0, y: 0, rotation: 0, scale: 1 },
    { shapeId: 'square', x: 200, y: 0, rotation: 0, scale: 1 },
  ]);
  assert.ok(bounds.width > 230, `두 부품을 다 감싸는 넓은 bounding box여야 함, 실제 width ${bounds.width}`);
}
console.log('computeWeaponBounds spans multiple parts: OK');

// 존재하지 않는 shapeId는 조용히 건너뛴다 (크래시 없음)
{
  const bounds = computeWeaponBounds([{ shapeId: 'not-a-shape', x: 0, y: 0, rotation: 0, scale: 1 }]);
  assert.deepStrictEqual(bounds, { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 });
}
console.log('computeWeaponBounds ignores unknown shapeId: OK');

// 프랙탈(점이 많은 도형)도 정상 동작해야 함 — CanvasEditor.js 버그 수정 때 실측한 값과 동일
{
  const sierpinski = computeWeaponBounds([{ shapeId: 'sierpinski', x: 0, y: 0, rotation: 0, scale: 1 }]);
  assert.ok(Math.abs(sierpinski.width - 60) < 0.5, `sierpinski width, 실제 ${sierpinski.width}`);
  assert.ok(Math.abs(sierpinski.height - 52.0) < 0.5, `sierpinski height, 실제 ${sierpinski.height}`);

  const koch = computeWeaponBounds([{ shapeId: 'koch', x: 0, y: 0, rotation: 0, scale: 1 }]);
  assert.ok(Math.abs(koch.width - 60) < 0.5, `koch width, 실제 ${koch.width}`);
  assert.ok(Math.abs(koch.height - 69.3) < 0.5, `koch height, 실제 ${koch.height}`);
}
console.log('computeWeaponBounds handles fractals (many points): OK');

console.log('weaponRenderer.test.mjs: OK');
