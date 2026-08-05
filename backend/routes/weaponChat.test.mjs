import assert from 'node:assert';
import { applyToolCalls, MAX_PARTS, CANVAS_SIZE } from './weaponChat.js';

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

const scaled = applyToolCalls(withOne, [{ op: 'scalePart', partId: 'p1', scale: 99 }]);
assert.strictEqual(scaled.parts[0].scale, 3, 'scale은 3.0으로 clamp');

const scaledLow = applyToolCalls(withOne, [{ op: 'scalePart', partId: 'p1', scale: 0.01 }]);
assert.strictEqual(scaledLow.parts[0].scale, 0.2, 'scale은 0.2로 하한 clamp');

const removed = applyToolCalls(withOne, [{ op: 'removePart', partId: 'p1' }]);
assert.strictEqual(removed.parts.length, 0);

// clamp()는 숫자가 아닌/누락된 값이 들어와도 NaN을 절대 반환하면 안 된다 (min으로 안전하게 대체)
const afterMissingXY = applyToolCalls(empty, [{ op: 'addPart', shapeId: 'triangle' }]);
assert.strictEqual(afterMissingXY.parts[0].x, 0);
assert.strictEqual(afterMissingXY.parts[0].y, 0);

const afterBadScale = applyToolCalls(empty, [{ op: 'addPart', shapeId: 'triangle', x: 10, y: 10, scale: 'large' }]);
assert.strictEqual(afterBadScale.parts[0].scale, 0.2);

// 회귀 테스트: Opus 리뷰 Important #7 — rotation은 x/y/scale과 달리 clamp(min,max) 대상이
// 아니라서 검증 없이 그대로 저장되고 있었다. 문자열/undefined rotation이 들어와도 NaN이
// 캐시 키나 Konva rotation 속성에 들어가면 안 된다.
const afterBadRotationAdd = applyToolCalls(empty, [{ op: 'addPart', shapeId: 'triangle', x: 0, y: 0, rotation: 'sideways' }]);
assert.strictEqual(afterBadRotationAdd.parts[0].rotation, 0, 'addPart에서 rotation이 숫자가 아니면 0으로 대체');

const afterBadRotationRotate = applyToolCalls(withOne, [{ op: 'rotatePart', partId: 'p1', rotation: undefined }]);
assert.strictEqual(afterBadRotationRotate.parts[0].rotation, 0, 'rotatePart에서 rotation이 숫자가 아니면 기존 값 유지(withOne의 초기 rotation=0)');
console.log('applyToolCalls guards non-numeric rotation: OK');

console.log('weaponChat.test.mjs: OK');
