import assert from 'node:assert';
import { computeWeaponBounds, drawWeaponGroup } from './weaponRenderer.js';

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

// 서로 멀리 떨어진 부품 2개 -> 둘을 모두 감싸는 bounding box (정확한 값으로 검증 — 느슨한
// ">230" 정도로는 minX 계산이 25px쯤 틀려도 통과해버림)
{
  const bounds = computeWeaponBounds([
    { shapeId: 'square', x: 0, y: 0, rotation: 0, scale: 1 },
    { shapeId: 'square', x: 200, y: 0, rotation: 0, scale: 1 },
  ]);
  assert.strictEqual(bounds.minX, -30);
  assert.strictEqual(bounds.maxX, 230);
  assert.strictEqual(bounds.width, 260, `두 부품을 다 감싸는 bounding box, 실제 width ${bounds.width}`);
}
console.log('computeWeaponBounds spans multiple parts: OK');

// 존재하지 않는 shapeId는 조용히 건너뛴다 (크래시 없음)
{
  const bounds = computeWeaponBounds([{ shapeId: 'not-a-shape', x: 0, y: 0, rotation: 0, scale: 1 }]);
  assert.deepStrictEqual(bounds, { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 });
}
console.log('computeWeaponBounds ignores unknown shapeId: OK');

// 알 수 없는 shapeId와 정상 부품이 섞여 있으면, 알 수 없는 쪽만 무시하고 정상 부품 기준으로
// 계산되어야 한다 (건너뛴 부품이 누적값을 오염시키면 안 됨 — 이게 실제로 벌어질 수 있는
// 열화 경로다: 알 수 없는 부품 하나 때문에 bounding box 전체가 깨지면 안 됨).
{
  const bounds = computeWeaponBounds([
    { shapeId: 'square', x: 0, y: 0, rotation: 0, scale: 1 },
    { shapeId: 'not-a-shape', x: 999, y: 999, rotation: 0, scale: 1 },
  ]);
  assert.strictEqual(bounds.width, 60, `알 수 없는 shapeId는 무시되고 정상 부품만 반영돼야 함, 실제 width ${bounds.width}`);
}
console.log('computeWeaponBounds ignores unknown shapeId mixed with valid ones: OK');

// 배열 원소 자체가 null이어도 던지면 안 된다 — session.js의 create:done은 클라이언트가 보낸
// weapon.parts를 검증 없이 그대로 받으므로, 이런 입력이 실제로 서버를 거쳐 다른 모든
// 참가자의 대전 화면까지 브로드캐스트될 수 있다.
{
  assert.doesNotThrow(() =>
    computeWeaponBounds([null, { shapeId: 'square', x: 0, y: 0, rotation: 0, scale: 1 }]),
  );
  const bounds = computeWeaponBounds([null, { shapeId: 'square', x: 0, y: 0, rotation: 0, scale: 1 }]);
  assert.strictEqual(bounds.width, 60);
}
console.log('computeWeaponBounds tolerates a null entry in parts: OK');

// 삼각형(수직 비대칭 — 로컬 bbox 중심이 (0,-8.66))과 정사각형(대칭 — 중심 (0,0))을 같은
// 위치에 두면, 각 도형 "자신의" bbox 중심을 기준으로 합쳐져야 한다. 도형 자신의 중심을 안
// 빼고 원점 기준으로 그대로 합치면 삼각형 쪽이 위로 8.66px 더 튀어나와 height가 60이 아니라
// 64.64가 나온다 — 이게 CanvasEditor.js와 다른 좌표계를 쓰던 실제 버그였다(Opus 리뷰).
{
  const bounds = computeWeaponBounds([
    { shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 1 },
    { shapeId: 'square', x: 0, y: 0, rotation: 0, scale: 1 },
  ]);
  assert.ok(Math.abs(bounds.width - 60) < 0.01, `width, 실제 ${bounds.width}`);
  assert.ok(
    Math.abs(bounds.height - 60) < 0.01,
    `height는 두 도형 다 자기 bbox 중심 기준으로 합쳐져 60이어야 함(버그 있으면 64.64), 실제 ${bounds.height}`,
  );
}
console.log('computeWeaponBounds aligns parts by each shape\'s own bbox center: OK');

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

// drawWeaponGroup — Konva를 파라미터로 주입받는 구조 덕분에, 실제 Konva/브라우저 canvas 없이도
// 스텁으로 "어떤 속성으로 노드/그룹을 만들었는지"를 검증할 수 있다.
class StubShape {
  constructor(attrs) { this.attrs = attrs; }
}
class StubGroup {
  constructor() { this.children = []; this._offsetX = 0; this._offsetY = 0; }
  add(node) { this.children.push(node); }
  offsetX(v) { this._offsetX = v; }
  offsetY(v) { this._offsetY = v; }
}
const StubKonva = { Group: StubGroup, Shape: StubShape };

// 부품 1개(정사각형), targetSize=20 -> scale = 20/60 = 1/3. 정사각형은 자기 중심이 (0,0)이라
// bounds 전체 중심과도 일치하므로, 노드 위치가 곧 그룹의 offset과 같아야 한다(=부품이 그룹의
// 등록점, 즉 무기 아이콘의 정중앙에 와야 한다).
{
  const group = drawWeaponGroup(StubKonva, [{ shapeId: 'square', x: 0, y: 0, rotation: 0, scale: 1 }], { targetSize: 20 });
  assert.strictEqual(group.children.length, 1);
  assert.ok(Math.abs(group.children[0].attrs.x - group._offsetX) < 1e-9, '단일 부품은 그룹 등록점(중심)에 정확히 와야 함');
  assert.ok(Math.abs(group.children[0].attrs.y - group._offsetY) < 1e-9);
  assert.ok(Math.abs(group.children[0].attrs.scaleX - 1 / 3) < 1e-9, `scaleX는 part.scale(1) * (targetSize/maxDim)(1/3) = 1/3이어야 함, 실제 ${group.children[0].attrs.scaleX}`);
  assert.strictEqual(group.children[0].attrs.strokeScaleEnabled, false, '축소돼도 테두리 두께가 같이 줄어들면 안 됨');
}
console.log('drawWeaponGroup centers the group on the weapon bounds: OK');

// 부품 없음 -> 빈 그룹(크래시 없음)
{
  const group = drawWeaponGroup(StubKonva, [], { targetSize: 20 });
  assert.strictEqual(group.children.length, 0);
}
console.log('drawWeaponGroup with no parts returns an empty group: OK');

// Konva 네임스페이스를 안 넘기면 "undefined.Group()"처럼 알 수 없는 에러로 죽는 대신, 명확한
// 에러 메시지로 실패해야 한다 — 시그니처가 (Konva, parts, options)로 이례적이라 실수로
// 빠뜨리기 쉽다.
{
  assert.throws(() => drawWeaponGroup(undefined, []), /Konva/, 'Konva 없이 호출하면 명확한 에러가 나야 함');
}
console.log('drawWeaponGroup throws a clear error without a Konva namespace: OK');

console.log('weaponRenderer.test.mjs: OK');
