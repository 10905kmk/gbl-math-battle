import assert from 'node:assert';
import { fallbackDamage } from './weaponEvaluate.js';

const weapon = { parts: [{ id: 'p1', shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 1 }] };
const damage = fallbackDamage(weapon);
assert.ok(damage >= 1 && damage <= 10000, 'fallback damage must stay in [1, 10000]');
assert.strictEqual(typeof damage, 'number');

console.log('weaponEvaluate.test.mjs: OK');
