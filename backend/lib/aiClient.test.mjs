import assert from 'node:assert';

process.env.MOCK_AI = 'true';
const { evaluateWeapon, DAMAGE_MIN, DAMAGE_MAX } = await import('./aiClient.js');

const weapon = { parts: [{ id: 'p1', shapeId: 'triangle', x: 50, y: 50, rotation: 0, scale: 1 }] };

const first = await evaluateWeapon(weapon);
assert.strictEqual(first.cached, false, '첫 호출은 캐시 미스');
assert.ok(first.damage >= DAMAGE_MIN && first.damage <= DAMAGE_MAX);

const second = await evaluateWeapon(weapon);
assert.strictEqual(second.cached, true, '두번째 호출은 캐시 히트');
assert.strictEqual(second.damage, first.damage, '캐시된 값은 동일해야 함');

console.log('aiClient.test.mjs (evaluateWeapon): OK');
