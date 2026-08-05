import assert from 'node:assert';
import { fallbackDamage } from './weaponEvaluate.js';

const weapon = { parts: [{ id: 'p1', shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 1 }] };
const damage = fallbackDamage(weapon);
assert.ok(damage >= 1 && damage <= 10000, 'fallback damage must stay in [1, 10000]');
assert.strictEqual(typeof damage, 'number');

// 회귀 테스트: Opus 리뷰 Critical #1 — fallbackDamage가 evaluateWeapon 실패 시 catch 블록
// 안에서 다시 호출되는데, 예전엔 weaponState.parts에 바로 접근해서 undefined/null 입력에
// 또 throw했다(=서버 죽음, 이중 실패). 이제는 절대 던지지 않고 안전한 기본값을 반환해야 한다.
assert.strictEqual(fallbackDamage(undefined), 1, 'weaponState 자체가 undefined');
assert.strictEqual(fallbackDamage(null), 1, 'weaponState가 null');
assert.strictEqual(fallbackDamage({}), 1, 'parts 필드가 없음');
assert.strictEqual(fallbackDamage({ parts: null }), 1, 'parts가 null');
assert.strictEqual(fallbackDamage({ parts: [] }), 1, 'parts가 빈 배열');
assert.strictEqual(
  fallbackDamage({ parts: [{ shapeId: 'not-a-shape', x: 0, y: 0, rotation: 0, scale: 1 }] }),
  1,
  '존재하지 않는 shapeId는 기여분 없이 스킵',
);
assert.strictEqual(
  fallbackDamage({ parts: [{ shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 'huge' }] }),
  fallbackDamage({ parts: [{ shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 1 }] }),
  'scale이 숫자가 아니면 1로 취급(NaN 전파 방지)',
);
console.log('fallbackDamage never throws on malformed input: OK');

// 회귀 테스트: Opus 리뷰 Important #4 — 예전엔 total*100이라 부품 5개부터 전부 10000으로
// 포화됐다(1개=2000, 5개 이상=전부 10000). sqrt 스케일로 바꿔서 부품 수가 늘어도
// 점수가 계속 구별돼야 한다.
function weaponWithParts(n) {
  return { parts: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 1 })) };
}
const damage1 = fallbackDamage(weaponWithParts(1));
const damage5 = fallbackDamage(weaponWithParts(5));
const damage10 = fallbackDamage(weaponWithParts(10));
assert.ok(damage1 < damage5, '부품이 많을수록 점수가 더 높아야 함(1개 < 5개)');
assert.ok(damage5 < damage10, '5개 < 10개 — 예전엔 5개부터 이미 최댓값이라 여기서 실패했음');
assert.ok(damage10 <= 10000);
console.log('fallbackDamage no longer saturates by 5 parts: OK');

console.log('weaponEvaluate.test.mjs: OK');
