import assert from 'node:assert';
import { normalize, cacheKey, seededPick, getCached, setCached, seedCache, cacheSize } from './weaponCache.js';

// 살짝 다른(드래그 오차) 두 무기는 같은 키로 수렴해야 함
const a = { parts: [{ id: 'p1', shapeId: 'triangle', x: 101, y: 99, rotation: 2, scale: 1.01 }] };
const b = { parts: [{ id: 'p2', shapeId: 'triangle', x: 104, y: 96, rotation: 6, scale: 1.04 }] };

// normalize 자체도 직접 검증 — 10px/15도 단위로 반올림되는지
const normA = normalize(a);
assert.strictEqual(normA[0].x, 100);
assert.strictEqual(normA[0].y, 100);
assert.strictEqual(normA[0].rotation, 0);

// 음수 회전(반시계 드래그로 자연스럽게 발생)도 [0,360) 범위로 정규화되어야 함 (-30도 == 330도)
const negRotation = { parts: [{ id: 'p1', shapeId: 'triangle', x: 0, y: 0, rotation: -30, scale: 1 }] };
const posRotation = { parts: [{ id: 'p2', shapeId: 'triangle', x: 0, y: 0, rotation: 330, scale: 1 }] };
assert.strictEqual(normalize(negRotation)[0].rotation, 330);
assert.strictEqual(cacheKey(negRotation), cacheKey(posRotation), '-30도와 330도는 같은 캐시 키');

assert.strictEqual(cacheKey(a), cacheKey(b), '거의 같은 무기는 같은 캐시 키');

// 확실히 다른 무기는 다른 키
const c = { parts: [{ id: 'p3', shapeId: 'square', x: 101, y: 99, rotation: 2, scale: 1.01 }] };
assert.notStrictEqual(cacheKey(a), cacheKey(c));

// 시드 확정값은 같은 키에 항상 같은 값
const p1 = seededPick(cacheKey(a), 100, 200);
const p2 = seededPick(cacheKey(b), 100, 200);
assert.strictEqual(p1, p2);
assert.ok(p1 >= 100 && p1 <= 200);

// 캐시 get/set
const key = cacheKey(a);
assert.strictEqual(getCached(key), undefined);
setCached(key, 5000);
assert.strictEqual(getCached(key), 5000);

// 사전 시딩
const before = cacheSize();
seedCache([{ parts: [{ id: 'x', shapeId: 'koch', x: 0, y: 0, rotation: 0, scale: 1 }], damage: 999 }]);
assert.strictEqual(cacheSize(), before + 1);

console.log('weaponCache.test.mjs: OK');
