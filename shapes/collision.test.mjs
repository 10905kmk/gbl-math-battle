import assert from 'node:assert';
import {
  circleOverlapsAnyWall,
  resolveCircleFromWalls,
} from './collision.js';

const arena = { width: 800, height: 600 };
const walls = [{ x: 300, y: 200, width: 100, height: 100 }];

assert.strictEqual(circleOverlapsAnyWall(350, 250, 20, walls), true);
const resolved = resolveCircleFromWalls(350, 250, 20, walls, arena);
assert.strictEqual(circleOverlapsAnyWall(resolved.x, resolved.y, 20, walls), false, '벽 내부 좌표를 안전한 바깥으로 복구');
assert.ok(Math.hypot(resolved.x - 350, resolved.y - 250) <= 71, '가장 가까운 경계 방향으로만 이동');

const safe = resolveCircleFromWalls(100, 100, 20, walls, arena);
assert.deepStrictEqual(safe, { x: 100, y: 100 }, '정상 좌표는 움직이지 않음');

const boundary = resolveCircleFromWalls(-50, 700, 20, [], arena);
assert.deepStrictEqual(boundary, { x: 20, y: 580 }, '아레나 경계 밖 좌표도 복구');

console.log('collision recovery safely ejects circles from walls and arena bounds: OK');
