import assert from 'node:assert';
import { sierpinskiTriangles, kochSnowflakePoints } from './fractals.js';

// depth 0: 삼각형 1개
assert.strictEqual(sierpinskiTriangles(60, 0).length, 1);
// depth 1: 3개로 분할
assert.strictEqual(sierpinskiTriangles(60, 1).length, 3);
// depth 2: 9개
assert.strictEqual(sierpinskiTriangles(60, 2).length, 9);

// koch depth 0: 삼각형 꼭짓점 그대로, 변당 점 1개(시작점)씩 = 3개
const koch0 = kochSnowflakePoints(60, 0);
assert.strictEqual(koch0.length, 3);
// depth 1: 변당 4배 세분 = 12개
const koch1 = kochSnowflakePoints(60, 1);
assert.strictEqual(koch1.length, 12);

console.log('fractals.test.mjs: OK');
