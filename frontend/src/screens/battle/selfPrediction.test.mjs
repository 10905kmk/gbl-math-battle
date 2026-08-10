import assert from 'node:assert';
import { predictSelfMove, reconcileSelfPosition, decayRenderOffset } from './selfPrediction.js';

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

// 프레임 간격이 비정상적으로 크면(탭 백그라운드 복귀 등) dtMs를 상한으로 clamp해야 한다 —
// 안 그러면 한 프레임에 맵을 가로지르는 순간이동이 생긴다(Opus 리뷰 Important #1, 2026-08-11).
{
  const normal = predictSelfMove({ x: 500, y: 500 }, { moveX: 1, moveY: 0 }, 8, [], ARENA, RADIUS, 100);
  const huge = predictSelfMove({ x: 500, y: 500 }, { moveX: 1, moveY: 0 }, 8, [], ARENA, RADIUS, 100000);
  assert.deepStrictEqual(huge, normal, 'dtMs가 아무리 커도 상한(100ms) 이상 이동해서는 안 됨');
}
console.log('predictSelfMove: dtMs 상한 clamp OK');

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

// 오차가 작으면 그대로 둔다(매 상태 패킷마다 미세하게 흔들리는 것 방지).
{
  const result = reconcileSelfPosition({ x: 500, y: 500 }, { x: 502, y: 500 });
  assert.deepStrictEqual(result, { x: 500, y: 500 }, '4px 미만 오차는 무시해야 함');
}
console.log('reconcileSelfPosition: 작은 오차 무시 OK');

// 오차가 크면(리스폰/대시/넉백 등) 즉시 서버 값으로 스냅한다.
{
  const result = reconcileSelfPosition({ x: 500, y: 500 }, { x: 800, y: 500 });
  assert.deepStrictEqual(result, { x: 800, y: 500 }, '150px 이상 오차는 즉시 스냅해야 함');
}
console.log('reconcileSelfPosition: 큰 오차 스냅 OK');

// 중간 오차는 한 번에 다 당기지 않고 일부만 보정 — 반복 호출로 서버 위치에 수렴해야 한다.
{
  let predicted = { x: 500, y: 500 };
  const server = { x: 550, y: 500 };
  predicted = reconcileSelfPosition(predicted, server);
  assert.ok(predicted.x > 500 && predicted.x < 550, '한 번에 다 당기지 않고 일부만 보정해야 함');
  // 4px 미만으로 좁혀지면 그 뒤로는 "작은 오차는 무시" 규칙이 발동해 더 이상 안 당긴다 —
  // 그래서 정확히 0이 아니라 무시 임계값(RECONCILE_IGNORE_PX) 안쪽까지만 수렴하면 된다.
  for (let i = 0; i < 30; i += 1) predicted = reconcileSelfPosition(predicted, server);
  assert.ok(Math.abs(predicted.x - 550) < 4, '반복 보정하면 무시 임계값 안쪽까지 수렴해야 함');
}
console.log('reconcileSelfPosition: 중간 오차 점진 수렴 OK');

console.log('selfPrediction.test.mjs (reconcileSelfPosition): all tests passed');

// reconcileSelfPosition의 보정은 onState(20Hz)에서 논리 위치를 즉시 갈아끼우는데, 화면은
// 그 즉시-갈아끼움을 그대로 그리면 프레임 하나짜리 순간이동으로 보인다(Opus 리뷰 Important #4,
// 2026-08-11). decayRenderOffset은 그 순간이동분을 "시각 오프셋"으로 잠깐 붙잡아 두었다가
// 몇 프레임에 걸쳐 서서히 지워서, 실제 논리 위치는 즉시 정확해지되 화면은 부드럽게 따라가게
// 한다.

// 절반 감쇠 시간(반감기)이 지나면 오프셋이 절반으로 줄어야 한다.
{
  const result = decayRenderOffset({ x: 20, y: 0 }, 50);
  assert.ok(Math.abs(result.x - 10) < 1e-9, `50ms(반감기) 뒤엔 오프셋이 절반이어야 함(실제: ${result.x})`);
}
console.log('decayRenderOffset: 반감기 OK');

// dt=0이면 전혀 안 줄어야 한다(정지 프레임에서 순간이동하듯 사라지면 안 됨).
{
  const result = decayRenderOffset({ x: 20, y: -8 }, 0);
  assert.deepStrictEqual(result, { x: 20, y: -8 }, 'dt=0이면 오프셋이 그대로여야 함');
}
console.log('decayRenderOffset: dt=0 OK');

// 여러 반감기가 지나면 거의 0으로 수렴해야 한다(완전히 0은 지수감쇠 특성상 될 수 없음).
{
  let offset = { x: 100, y: 0 };
  for (let i = 0; i < 10; i += 1) offset = decayRenderOffset(offset, 50);
  assert.ok(Math.abs(offset.x) < 1, `반감기 10번(500ms) 뒤엔 거의 0이어야 함(실제: ${offset.x})`);
}
console.log('decayRenderOffset: 장시간 수렴 OK');

console.log('selfPrediction.test.mjs (decayRenderOffset): all tests passed');
