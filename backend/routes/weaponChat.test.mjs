import assert from 'node:assert';
import { applyToolCalls, MAX_PARTS, CANVAS_SIZE } from './weaponChat.js';
import { SCALE_MIN, SCALE_MAX } from '../../shapes/registry.js';

const empty = { parts: [] };

// addPart: 정상 추가
const afterAdd = applyToolCalls(empty, [{ op: 'addPart', shapeId: 'triangle', x: 100, y: 100 }]);
assert.strictEqual(afterAdd.parts.length, 1);
assert.strictEqual(afterAdd.parts[0].shapeId, 'triangle');

// addPart: 잘못된 shapeId는 무시
const afterBadAdd = applyToolCalls(empty, [{ op: 'addPart', shapeId: 'not-a-shape', x: 0, y: 0 }]);
assert.strictEqual(afterBadAdd.parts.length, 0);

// addPart: 캔버스 범위를 벗어난 좌표는 clamp
const afterClamp = applyToolCalls(empty, [{ op: 'addPart', shapeId: 'square', x: 99999, y: -999 }]);
assert.strictEqual(afterClamp.parts[0].x, CANVAS_SIZE.width);
assert.strictEqual(afterClamp.parts[0].y, 0);

// addPart: 상한(MAX_PARTS) 초과분은 무시
const many = Array.from({ length: MAX_PARTS + 5 }, () => ({ op: 'addPart', shapeId: 'triangle', x: 1, y: 1 }));
const afterMany = applyToolCalls(empty, many);
assert.strictEqual(afterMany.parts.length, MAX_PARTS);

// movePart / rotatePart / scalePart / removePart
const withOne = { parts: [{ id: 'p1', shapeId: 'triangle', x: 10, y: 10, rotation: 0, scale: 1 }] };
const moved = applyToolCalls(withOne, [{ op: 'movePart', partId: 'p1', x: 50, y: 60 }]);
assert.strictEqual(moved.parts[0].x, 50);
assert.strictEqual(moved.parts[0].y, 60);

const rotated = applyToolCalls(withOne, [{ op: 'rotatePart', partId: 'p1', rotation: 45 }]);
assert.strictEqual(rotated.parts[0].rotation, 45);

// scalePart — 크기는 이제 가로/세로가 독립이다(그림판식 자유 변형). 모델이 등비 scale
// 하나만 보내는 경우도 계속 받아들여서 양축에 똑같이 적용한다.
const scaled = applyToolCalls(withOne, [{ op: 'scalePart', partId: 'p1', scale: 99 }]);
assert.strictEqual(scaled.parts[0].scaleX, SCALE_MAX, `등비 scale은 ${SCALE_MAX}로 상한 clamp`);
assert.strictEqual(scaled.parts[0].scaleY, SCALE_MAX);
assert.strictEqual(scaled.parts[0].scale, undefined, '예전 등비 필드는 남기지 않는다');

const scaledLow = applyToolCalls(withOne, [{ op: 'scalePart', partId: 'p1', scale: 0.01 }]);
assert.strictEqual(scaledLow.parts[0].scaleX, SCALE_MIN, `등비 scale은 ${SCALE_MIN}로 하한 clamp`);
assert.strictEqual(scaledLow.parts[0].scaleY, SCALE_MIN);

// 가로만 늘리기 — 안 준 축은 기존 값을 유지해야 한다("가로로만 늘려줘"가 세로를 1로
// 되돌려버리면 이미 키워둔 부품이 갑자기 쪼그라든다).
const stretchedBase = { parts: [{ id: 'p1', shapeId: 'circle', x: 10, y: 10, rotation: 0, scaleX: 1, scaleY: 2 }] };
const stretched = applyToolCalls(stretchedBase, [{ op: 'scalePart', partId: 'p1', scaleX: 3 }]);
assert.strictEqual(stretched.parts[0].scaleX, 3);
assert.strictEqual(stretched.parts[0].scaleY, 2, '지정하지 않은 축은 기존 값 유지');

// addPart도 축별 배율을 받는다.
const ellipse = applyToolCalls(empty, [
  { op: 'addPart', shapeId: 'circle', x: 100, y: 100, scaleX: 0.4, scaleY: 2.5 },
]);
assert.strictEqual(ellipse.parts[0].scaleX, 0.4);
assert.strictEqual(ellipse.parts[0].scaleY, 2.5);

// 새로 추가된 도형들이 실제로 통과하는지 — registry와 검증 경로가 어긋나면 AI가 부르는
// 족족 조용히 무시돼서 "말해도 안 만들어지는" 증상이 된다.
for (const shapeId of ['circle', 'bar', 'rhombus', 'pentagon', 'hexagon', 'star']) {
  const added = applyToolCalls(empty, [{ op: 'addPart', shapeId, x: 100, y: 100 }]);
  assert.strictEqual(added.parts.length, 1, `${shapeId}은 추가될 수 있어야 함`);
  assert.strictEqual(added.parts[0].shapeId, shapeId);
}
console.log('applyToolCalls supports per-axis scaling and the expanded shape set: OK');

const removed = applyToolCalls(withOne, [{ op: 'removePart', partId: 'p1' }]);
assert.strictEqual(removed.parts.length, 0);

// clamp()는 숫자가 아닌/누락된 값이 들어와도 NaN을 절대 반환하면 안 된다 (min으로 안전하게 대체)
const afterMissingXY = applyToolCalls(empty, [{ op: 'addPart', shapeId: 'triangle' }]);
assert.strictEqual(afterMissingXY.parts[0].x, 0);
assert.strictEqual(afterMissingXY.parts[0].y, 0);

// 숫자가 아닌 배율은 하한이 아니라 "기본 크기(1)"로 대체한다 — 예전엔 min(0.2)으로
// 떨어뜨렸는데, 모델이 scale에 엉뚱한 값을 넣었을 때 도형이 보이지도 않을 만큼 작게
// 생성돼서 참가자 눈에는 그냥 "안 만들어졌다"로 보였다.
const afterBadScale = applyToolCalls(empty, [{ op: 'addPart', shapeId: 'triangle', x: 10, y: 10, scale: 'large' }]);
assert.strictEqual(afterBadScale.parts[0].scaleX, 1);
assert.strictEqual(afterBadScale.parts[0].scaleY, 1);

// 회귀 테스트: Opus 리뷰 Important #7 — rotation은 x/y/scale과 달리 clamp(min,max) 대상이
// 아니라서 검증 없이 그대로 저장되고 있었다. 문자열/undefined rotation이 들어와도 NaN이
// 캐시 키나 Konva rotation 속성에 들어가면 안 된다.
const afterBadRotationAdd = applyToolCalls(empty, [{ op: 'addPart', shapeId: 'triangle', x: 0, y: 0, rotation: 'sideways' }]);
assert.strictEqual(afterBadRotationAdd.parts[0].rotation, 0, 'addPart에서 rotation이 숫자가 아니면 0으로 대체');

const afterBadRotationRotate = applyToolCalls(withOne, [{ op: 'rotatePart', partId: 'p1', rotation: undefined }]);
assert.strictEqual(afterBadRotationRotate.parts[0].rotation, 0, 'rotatePart에서 rotation이 숫자가 아니면 기존 값 유지(withOne의 초기 rotation=0)');
console.log('applyToolCalls guards non-numeric rotation: OK');

console.log('weaponChat.test.mjs: OK');
