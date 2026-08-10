import assert from 'node:assert';
import { predictSelfMove } from './selfPrediction.js';

const ARENA = { width: 1000, height: 1000 };
const RADIUS = 20;

// 평지 이동 — 벽 없음, moveSpeed(틱당 픽셀)를 dtMs 기준으로 정확히 환산해야 한다.
{
  const result = predictSelfMove({ x: 500, y: 500 }, { moveX: 1, moveY: 0 }, 8, [], ARENA, RADIUS, 50);
  assert.strictEqual(result.x, 508, '50ms 경과 시 moveSpeed(8px/틱)만큼 정확히 이동해야 함');
  assert.strictEqual(result.y, 500);
}
console.log('predictSelfMove: 평지 이동 OK');

// 프레임 간격이 절반이면 이동량도 절반이어야 한다(연속 프레임 기준 환산 확인).
{
  const result = predictSelfMove({ x: 500, y: 500 }, { moveX: 1, moveY: 0 }, 8, [], ARENA, RADIUS, 25);
  assert.strictEqual(result.x, 504);
}
console.log('predictSelfMove: dtMs 비례 이동 OK');

// 대각선 입력은 정규화되어 축 이동과 같은 속도로 움직여야 한다(서버 normalizeIfLong과 동일 규칙).
{
  const result = predictSelfMove({ x: 500, y: 500 }, { moveX: 1, moveY: 1 }, 8, [], ARENA, RADIUS, 50);
  const dist = Math.hypot(result.x - 500, result.y - 500);
  assert.ok(Math.abs(dist - 8) < 1e-9, `대각선 이동 거리는 축 이동과 같아야 함(실제: ${dist})`);
}
console.log('predictSelfMove: 대각선 정규화 OK');

// 아레나 경계 — radius만큼만 안쪽으로 clamp되어야 한다.
{
  const result = predictSelfMove({ x: 975, y: 500 }, { moveX: 1, moveY: 0 }, 8, [], ARENA, RADIUS, 50);
  assert.strictEqual(result.x, ARENA.width - RADIUS, '오른쪽 경계를 넘지 못하고 반지름만큼 안쪽에서 멈춰야 함');
}
console.log('predictSelfMove: 아레나 경계 clamp OK');

// 벽 — 진행 방향에 벽이 있으면 그 축 이동이 취소되어야 한다.
{
  const wall = { x: 520, y: 480, width: 40, height: 40 };
  const result = predictSelfMove({ x: 500, y: 500 }, { moveX: 1, moveY: 0 }, 8, [wall], ARENA, RADIUS, 50);
  assert.strictEqual(result.x, 500, '벽에 막혀 x 이동이 취소되어야 함');
}
console.log('predictSelfMove: 벽 충돌 차단 OK');

console.log('selfPrediction.test.mjs (predictSelfMove): all tests passed');
