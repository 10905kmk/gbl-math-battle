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

// 각 변의 돌출점(bump)은 도형 중심(0,0)이 아니라 바깥쪽으로 튀어나와야 한다.
// (점 개수만 세면 돌출 방향이 반대로 뒤집혀 중심으로 붕괴하는 버그를 못 잡는다)
// 한 변은 [시작점, 1/3점, 돌출점(bump), 2/3점] 순서로 4개 점을 낸다 — koch1[2]가 첫 변의 돌출점.
const bumpPoint = koch1[2];
const distFromCenter = Math.hypot(bumpPoint.x, bumpPoint.y);
assert.ok(distFromCenter > 20, `돌출점이 중심에서 충분히 떨어져 있어야 함 (실제: ${distFromCenter})`);

console.log('fractals.test.mjs: OK');
