import assert from 'node:assert';
import { trianglePoints, squarePoints } from './shapes.js';

const tri = trianglePoints(60);
assert.strictEqual(tri.length, 3, 'triangle should have 3 points');

const sq = squarePoints(60);
assert.strictEqual(sq.length, 4, 'square should have 4 points');
assert.strictEqual(sq[0].x, -30, 'square left edge at -size/2');
assert.strictEqual(sq[0].y, -30, 'square top edge at -size/2');

console.log('shapes.test.mjs: OK');
