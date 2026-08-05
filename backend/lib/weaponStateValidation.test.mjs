import assert from 'node:assert';
import { validateWeaponState, MAX_PARTS } from './weaponStateValidation.js';

// 회귀 테스트: Opus 리뷰 Critical #1이 실제로 서버를 죽인 입력들 — 전부 400으로 막혀야 한다.
assert.strictEqual(validateWeaponState(undefined).ok, false, 'weaponState 자체가 없음');
assert.strictEqual(validateWeaponState(null).ok, false, 'null');
assert.strictEqual(validateWeaponState({}).ok, false, 'parts 필드 자체가 없음');
assert.strictEqual(validateWeaponState({ parts: null }).ok, false, 'parts가 null');
assert.strictEqual(validateWeaponState({ parts: 'abc' }).ok, false, 'parts가 문자열');
console.log('validateWeaponState rejects malformed input that used to crash the server: OK');

// 정상 케이스
assert.strictEqual(validateWeaponState({ parts: [] }).ok, true, '빈 parts는 유효(아직 아무것도 안 그린 상태)');
assert.strictEqual(
  validateWeaponState({ parts: [{ id: 'p1', shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 1 }] }).ok,
  true,
);
console.log('validateWeaponState accepts well-formed weaponState: OK');

// 부품 개수 상한(Important #6) — 이전엔 500개도 그대로 캐시에 들어갔다.
const tooMany = {
  parts: Array.from({ length: MAX_PARTS + 1 }, () => ({ id: 'x', shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 1 })),
};
assert.strictEqual(validateWeaponState(tooMany).ok, false, `MAX_PARTS(${MAX_PARTS}) 초과는 거부`);
console.log('validateWeaponState rejects part count over MAX_PARTS: OK');

// 잘못된 shapeId, 비수치 필드
assert.strictEqual(
  validateWeaponState({ parts: [{ shapeId: 'not-a-real-shape', x: 0, y: 0, rotation: 0, scale: 1 }] }).ok,
  false,
  '존재하지 않는 shapeId',
);
assert.strictEqual(
  validateWeaponState({ parts: [{ shapeId: 'triangle', x: 'left', y: 0, rotation: 0, scale: 1 }] }).ok,
  false,
  'x가 숫자가 아님',
);
assert.strictEqual(
  validateWeaponState({ parts: [{ shapeId: 'triangle', x: 0, y: 0, rotation: NaN, scale: 1 }] }).ok,
  false,
  'rotation이 NaN',
);
console.log('validateWeaponState rejects invalid shapeId / non-numeric fields: OK');

console.log('weaponStateValidation.test.mjs: OK');
