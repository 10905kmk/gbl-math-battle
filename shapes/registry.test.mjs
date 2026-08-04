import assert from 'node:assert';
import { ALL_SHAPES, getShapeById, isValidShapeId, getShapeGeometry, generatePartId } from './registry.js';

assert.strictEqual(ALL_SHAPES.length, 4);
assert.strictEqual(getShapeById('triangle').name, '삼각형');
assert.strictEqual(getShapeById('nope'), null);
assert.strictEqual(isValidShapeId('sierpinski'), true);
assert.strictEqual(isValidShapeId('nope'), false);

const tri = getShapeGeometry('triangle');
assert.strictEqual(tri.type, 'polygon');
assert.strictEqual(tri.points.length, 3);

const sier = getShapeGeometry('sierpinski');
assert.strictEqual(sier.type, 'triangles');
assert.ok(sier.triangles.length > 0);

const id1 = generatePartId();
const id2 = generatePartId();
assert.notStrictEqual(id1, id2, 'ids should be unique');
assert.match(id1, /^p[a-z0-9]+$/);

console.log('registry.test.mjs: OK');
