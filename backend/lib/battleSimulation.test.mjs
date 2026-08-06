import assert from 'node:assert';
import {
  stepSimulation,
  hitScoreFromWeaponDamage,
  computeRanks,
  MOVE_SPEED,
  CHARACTER_RADIUS,
} from './battleSimulation.js';
import { ATTACK_HITBOX_SIZE, PROJECTILE_SPEED, PROJECTILE_RADIUS } from '../../shapes/attackGeometry.js';

function approxEqual(a, b, eps = 1e-6, msg = '') {
  assert.ok(Math.abs(a - b) < eps, `${msg} expected ${a} ≈ ${b}`);
}

const noInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
function makePlayer(overrides) {
  return {
    id: 'p1', characterId: 'char1', x: 400, y: 300, aimX: 0, aimY: 1,
    score: 0, hitScore: 25, connected: true, lastAttackAt: 0, attackRequested: false,
    isRanged: false, rangeDistance: null,
    input: { ...noInput }, ...overrides,
  };
}
function makeRoom(players, overrides) {
  return {
    status: 'active', endsAt: 1_000_000, players, walls: [],
    arenaSize: { width: 800, height: 600 }, projectiles: [],
    ...overrides,
  };
}

// hitScoreFromWeaponDamage — 데미지 1~10000 x 계수 0.05
assert.strictEqual(hitScoreFromWeaponDamage(1000), 50);
assert.strictEqual(hitScoreFromWeaponDamage(10000), 500);
assert.strictEqual(hitScoreFromWeaponDamage(5000), 250);
console.log('hitScoreFromWeaponDamage: OK');

assert.strictEqual(hitScoreFromWeaponDamage('abc'), 1, '숫자로 못 바꾸는 문자열');
assert.strictEqual(hitScoreFromWeaponDamage(undefined), 1, 'undefined');
assert.strictEqual(hitScoreFromWeaponDamage(null), 1, 'null');
assert.strictEqual(hitScoreFromWeaponDamage(NaN), 1, 'NaN 직접 입력');
assert.strictEqual(hitScoreFromWeaponDamage(-500), 1, '음수도 최소치(1)로 취급');
console.log('hitScoreFromWeaponDamage guards non-numeric/non-positive input: OK');

assert.strictEqual(hitScoreFromWeaponDamage(1_000_000_000), 500, '10000을 넘는 값은 10000으로 clamp된 뒤 계수를 곱함');
console.log('hitScoreFromWeaponDamage clamps abnormally large weapon damage: OK');

// 이동: moveY=-1 입력 시 y가 MOVE_SPEED만큼 감소, x는 그대로
{
  const room = makeRoom({ p1: makePlayer({ input: { ...noInput, moveY: -1 } }) });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.y, 300 - MOVE_SPEED);
  assert.strictEqual(next.players.p1.x, 400);
  console.log('movement up (moveY=-1): OK');
}

// 대각선 이동: moveX=moveY=1(정규화 안 된 입력)이어도 실제 이동 속도는 MOVE_SPEED를 넘지 않는다
{
  const room = makeRoom({ p1: makePlayer({ input: { ...noInput, moveX: 1, moveY: 1 } }) });
  const { room: next } = stepSimulation(room, 1000);
  const dx = next.players.p1.x - 400;
  const dy = next.players.p1.y - 300;
  approxEqual(Math.hypot(dx, dy), MOVE_SPEED, 1e-6, '대각선 이동 거리는 MOVE_SPEED와 같아야 함(더 빠르면 안 됨)');
  approxEqual(dx, dy, 1e-6, '두 축 모두 같은 비율로 정규화되어야 함');
  console.log('diagonal movement is normalized to MOVE_SPEED: OK');
}

// 길이가 1을 넘는 입력(예: moveX=3, moveY=4, 길이=5)도 방향만 유지한 채 길이 1로 clamp된다
{
  const room = makeRoom({ p1: makePlayer({ input: { ...noInput, moveX: 3, moveY: 4 } }) });
  const { room: next } = stepSimulation(room, 1000);
  approxEqual(next.players.p1.x - 400, MOVE_SPEED * 0.6, 1e-6, 'x축: 정규화된 0.6 * MOVE_SPEED');
  approxEqual(next.players.p1.y - 300, MOVE_SPEED * 0.8, 1e-6, 'y축: 정규화된 0.8 * MOVE_SPEED');
  console.log('overlong move vector is clamped to length 1: OK');
}

// 아레나 경계를 못 뚫음
{
  const room = makeRoom({ p1: makePlayer({ x: CHARACTER_RADIUS, y: 300, input: { ...noInput, moveX: -1 } }) });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.x, CHARACTER_RADIUS);
  console.log('arena boundary clamp: OK');
}

// 벽을 뚫지 못함
{
  const wall = { x: 420, y: 280, width: 40, height: 40 };
  const room = makeRoom({ p1: makePlayer({ x: 400, y: 300, input: { ...noInput, moveX: 1 } }) }, { walls: [wall] });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.x, 400);
  console.log('wall collision: OK');
}

// status가 'active'가 아니면 아무 것도 안 함
{
  const room = makeRoom({ p1: makePlayer({ input: { ...noInput, moveY: -1 } }) }, { status: 'ended' });
  const { room: next, winners } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.y, 300);
  assert.strictEqual(winners, null);
  console.log('inactive room is a no-op: OK');
}

// 조준 갱신: 충분히 긴 입력 벡터가 들어오면 정규화되어 aimX/aimY로 저장된다
{
  const room = makeRoom({ p1: makePlayer({ aimX: 1, aimY: 0, input: { ...noInput, aimX: 0, aimY: -1 } }) });
  const { room: next } = stepSimulation(room, 1000);
  approxEqual(next.players.p1.aimX, 0, 1e-6, '조준이 새 입력(위쪽)으로 갱신되어야 함');
  approxEqual(next.players.p1.aimY, -1, 1e-6);
  console.log('aim updates from sufficiently long input vector: OK');
}

// 조준 데드존: 입력 벡터 길이가 0.01 미만이면 이전 조준을 그대로 유지한다
{
  const room = makeRoom({ p1: makePlayer({ aimX: 1, aimY: 0, input: { ...noInput, aimX: 0.005, aimY: 0.005 } }) });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.aimX, 1, '데드존보다 짧은 입력은 무시되고 이전 조준(오른쪽) 유지');
  assert.strictEqual(next.players.p1.aimY, 0);
  console.log('aim below deadzone keeps previous aim: OK');
}

// 공격: attackRequested가 true고 조준 방향(오른쪽)에 상대가 있으면 맞는다
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hitScore: 30, attackRequested: true });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, score: 100 });
  const room = makeRoom({ p1: attacker, p2: target });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.score, 70, `70 기대, 실제 ${next.players.p2.score}`);
  assert.strictEqual(next.players.p1.score, 30, '공격자는 자기 hitScore만큼 점수 획득');
  assert.strictEqual(next.players.p1.lastAttackAt, 1000);
  assert.strictEqual(next.players.p1.attackRequested, false, 'attackRequested는 처리 후 항상 리셋됨');
  console.log('attack hits target in aim direction: OK');
}

// 공격: 연속 각도(대각선) 조준에서도 정확한 위치에 히트박스가 생긴다
{
  const offset = CHARACTER_RADIUS + ATTACK_HITBOX_SIZE / 2;
  const attacker = makePlayer({
    id: 'p1', x: 400, y: 300, aimX: Math.SQRT1_2, aimY: Math.SQRT1_2, hitScore: 30, attackRequested: true,
  });
  const target = makePlayer({
    id: 'p2', x: 400 + Math.SQRT1_2 * offset, y: 300 + Math.SQRT1_2 * offset, score: 100,
  });
  const room = makeRoom({ p1: attacker, p2: target });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.score, 70, '45도 대각선 조준도 그 방향의 상대를 맞혀야 함');
  console.log('attack hitbox follows continuous aim angle: OK');
}

// 공격: attackRequested가 false면(공격 요청 안 함) 사거리 안에 있어도 안 맞는다
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hitScore: 30, attackRequested: false });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, score: 50 });
  const room = makeRoom({ p1: attacker, p2: target });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.score, 50, 'attackRequested가 false면 공격이 발동하지 않는다');
  console.log('no attack without attackRequested: OK');
}

// 공격: 사거리 밖 상대는 안 맞고, 점수 변화도 없음
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hitScore: 30, attackRequested: true });
  const target = makePlayer({ id: 'p2', x: 600, y: 300, score: 50 });
  const room = makeRoom({ p1: attacker, p2: target });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.score, 50, '사거리 밖이면 점수 변화 없음');
  assert.strictEqual(next.players.p1.score, 0, '명중 못 하면 공격자도 점수 안 오름');
  console.log('attack misses out-of-range target: OK');
}

// 쿨다운: 쿨다운 중 재공격 요청은 버려지고(대기열 없음) attackRequested도 리셋된다
{
  const attacker = makePlayer({
    id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hitScore: 30, lastAttackAt: 900, attackRequested: true,
  });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, score: 50 });
  const room = makeRoom({ p1: attacker, p2: target });
  // now=1000, lastAttackAt=900 -> 100ms 경과, ATTACK_COOLDOWN_MS=500이라 아직 쿨다운 중
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.score, 50);
  assert.strictEqual(next.players.p1.lastAttackAt, 900);
  assert.strictEqual(next.players.p1.attackRequested, false, '쿨다운에 막힌 요청도 대기열에 안 남고 소비됨');
  console.log('attack cooldown drops the request instead of queueing: OK');
}

// 연결 끊긴 상대는 공격 대상에서 제외(탈락이 아니라 접속 상태 문제이므로 점수 자체는 안 건드림)
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hitScore: 30, attackRequested: true });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, score: 50, connected: false });
  const room = makeRoom({ p1: attacker, p2: target });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.score, 50, '연결 끊긴 상대는 공격 대상에서 제외되어 점수 변화 없음');
  assert.strictEqual(next.players.p1.score, 0, '아무도 못 맞혔으니 공격자도 점수 안 오름');
  console.log('disconnected target is not a valid attack target: OK');
}

// 점수는 0 밑으로 안 내려감
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hitScore: 30, attackRequested: true });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, score: 10 });
  const room = makeRoom({ p1: attacker, p2: target });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.score, 0, '점수는 음수로 안 내려가고 0에서 멈춤');
  console.log('score never drops below 0: OK');
}

// 탈락 없음: 제한시간이 한참 남았으면 아무리 맞아도(심지어 0점이어도) 라운드가 안 끝남
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hitScore: 100, attackRequested: true });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, score: 0 });
  const room = makeRoom({ p1: attacker, p2: target }, { endsAt: 1_000_000 });
  const { room: next, winners } = stepSimulation(room, 1000);
  assert.strictEqual(next.status, 'active', '제한시간 전엔 라운드가 끝나지 않는다(탈락 없음)');
  assert.strictEqual(winners, null);
  console.log('no elimination before time limit, regardless of hits: OK');
}

// 승리: 시간 초과 시 최고 점수
{
  const p1 = makePlayer({ id: 'p1', score: 80 });
  const p2 = makePlayer({ id: 'p2', score: 40 });
  const room = makeRoom({ p1, p2 }, { endsAt: 1000 });
  const { winners, room: next } = stepSimulation(room, 1000);
  assert.deepStrictEqual(winners, ['p1']);
  assert.strictEqual(next.status, 'ended');
  console.log('win by timeout (highest score): OK');
}

// 승리: 연결이 끊긴 참가자도 자기 점수 그대로 승자 후보에 포함됨(죽는 개념이 없으므로)
{
  const p1 = makePlayer({ id: 'p1', score: 20 });
  const p2 = makePlayer({ id: 'p2', score: 90, connected: false });
  const p3 = makePlayer({ id: 'p3', score: 15 });
  const room = makeRoom({ p1, p2, p3 }, { endsAt: 1000 });
  const { winners } = stepSimulation(room, 1000);
  assert.deepStrictEqual(winners, ['p2'], '연결이 끊겼어도 점수가 가장 높으면(90) 그대로 승자 후보에 포함됨');
  console.log('disconnected participants keep their score and stay eligible to win: OK');
}

// 승리: 시간 초과 + 동점 -> 전원 승자
{
  const p1 = makePlayer({ id: 'p1', score: 60 });
  const p2 = makePlayer({ id: 'p2', score: 60 });
  const p3 = makePlayer({ id: 'p3', score: 30 });
  const room = makeRoom({ p1, p2, p3 }, { endsAt: 1000 });
  const { winners } = stepSimulation(room, 1000);
  assert.deepStrictEqual(winners.sort(), ['p1', 'p2']);
  console.log('win by timeout tie (multiple winners): OK');
}

// 참가자가 1명뿐이면 제한시간을 다 채울 이유가 없다
{
  const room = makeRoom({ p1: makePlayer({ id: 'p1', score: 0 }) }, { endsAt: 1_000_000 });
  const { winners, room: next } = stepSimulation(room, 1000);
  assert.deepStrictEqual(winners, ['p1'], '참가자 1명뿐이면 제한시간과 무관하게 그 즉시 종료');
  assert.strictEqual(next.status, 'ended');
  console.log('battle with only 1 participant ends immediately regardless of time limit: OK');
}

// 참가자가 0명이어도(이론상 도달 가능한 경로) 크래시 없이 즉시 종료해야 한다.
{
  const room = makeRoom({}, { endsAt: 1_000_000 });
  const { winners, room: next } = stepSimulation(room, 1000);
  assert.deepStrictEqual(winners, [], '참가자가 0명이면 승자 없이 즉시 종료');
  assert.strictEqual(next.status, 'ended');
  console.log('battle with 0 participants ends immediately without crashing: OK');
}

// 회귀(Opus 리뷰 Important I3): Number.MAX_VALUE처럼 유한하지만 정규화 시 길이가 Infinity로
// 오버플로하는 조준 입력은 x/len, y/len이 둘 다 0이 되어 "조준 없음(0,0)"이 영구 저장되는
// 사고로 이어진다 — 그 상태에선 모든 방향의 상대가 맞아버리는 전방위 히트박스가 된다.
{
  const room = makeRoom({
    p1: makePlayer({ aimX: 1, aimY: 0, input: { ...noInput, aimX: Number.MAX_VALUE, aimY: Number.MAX_VALUE } }),
  });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.aimX, 1, '길이가 Infinity로 오버플로하는 입력은 무시되고 이전 조준 유지');
  assert.strictEqual(next.players.p1.aimY, 0);
  console.log('aim input that overflows to Infinity length keeps previous aim: OK');
}

// 회귀(Opus 리뷰 Minor M1): NaN/Infinity 이동 입력이 들어와도 위치가 NaN으로 영구 오염되지
// 않는다 — 이 값들은 소켓 레이어(battle.js의 num())에서 이미 걸러지지만, 순수 로직 계층도
// 같은 원칙을 한 번 더 지켜야 한다(weaponDamage clamp와 같은 방어적 이중화).
{
  const room = makeRoom({ p1: makePlayer({ input: { ...noInput, moveX: NaN, moveY: Infinity } }) });
  const { room: next } = stepSimulation(room, 1000);
  assert.ok(Number.isFinite(next.players.p1.x), 'NaN/Infinity 이동 입력이 들어와도 x는 유한한 값이어야 함');
  assert.ok(Number.isFinite(next.players.p1.y), 'NaN/Infinity 이동 입력이 들어와도 y는 유한한 값이어야 함');
  console.log('NaN/Infinity move input does not poison position: OK');
}

// 회귀: 아레나 경계가 모듈 상수가 아니라 room.arenaSize를 따른다 — 기본값(800x600)과 다른
// 작은 커스텀 아레나를 준 room에서 그 경계를 실제로 지키는지 확인한다(하드코딩이 남아있으면
// 이 테스트가 실패한다 — 800x600 기준으로는 절대 clamp가 안 걸리는 위치이므로).
{
  const room = makeRoom(
    { p1: makePlayer({ x: 79, y: 79, input: { ...noInput, moveX: 1, moveY: 1 } }) },
    { arenaSize: { width: 100, height: 100 } },
  );
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.x, 100 - CHARACTER_RADIUS, '작은 커스텀 아레나의 경계(100-20=80)를 따라야 함');
  assert.strictEqual(next.players.p1.y, 100 - CHARACTER_RADIUS);
  console.log('room.arenaSize (not a hardcoded module constant) drives the boundary clamp: OK');
}

// 원거리 무기 공격: 즉시 판정 대신 투사체를 스폰한다 — 스폰 시점엔 점수 변화가 없다.
{
  const attacker = makePlayer({
    id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hitScore: 30,
    isRanged: true, rangeDistance: 300, attackRequested: true,
  });
  const room = makeRoom({ p1: attacker });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.score, 0, '투사체 발사 시점엔 점수 변화 없음');
  assert.strictEqual(next.projectiles.length, 1, '투사체가 하나 생성되어야 함');
  assert.strictEqual(next.projectiles[0].ownerId, 'p1');
  assert.strictEqual(next.projectiles[0].maxRange, 300);
  assert.strictEqual(next.players.p1.lastAttackAt, 1000, '원거리도 쿨다운은 똑같이 적용됨');
  console.log('ranged attack spawns a projectile instead of an instant hit: OK');
}

// 투사체는 매 틱 조준 방향으로 PROJECTILE_SPEED만큼 이동한다.
{
  const room = makeRoom(
    { p1: makePlayer({ id: 'p1' }) },
    { projectiles: [{ id: 'pr1', ownerId: 'p1', x: 100, y: 100, aimX: 1, aimY: 0, traveled: 0, hitScore: 30, maxRange: 300 }] },
  );
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.projectiles.length, 1);
  assert.strictEqual(next.projectiles[0].x, 100 + PROJECTILE_SPEED);
  assert.strictEqual(next.projectiles[0].traveled, PROJECTILE_SPEED);
  console.log('projectile advances by PROJECTILE_SPEED each tick: OK');
}

// 사거리를 다 쓰면(traveled >= maxRange) 아무 효과 없이 소멸한다.
{
  const room = makeRoom(
    { p1: makePlayer({ id: 'p1' }), p2: makePlayer({ id: 'p2', x: 5000, y: 5000, score: 50 }) },
    { projectiles: [{ id: 'pr1', ownerId: 'p1', x: 100, y: 100, aimX: 1, aimY: 0, traveled: 295, hitScore: 30, maxRange: 300 }] },
  );
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.projectiles.length, 0, '사거리를 넘으면 투사체가 사라져야 함');
  assert.strictEqual(next.players.p2.score, 50, '아무도 못 맞혔으니 점수 변화 없음');
  console.log('projectile disappears without effect once it exceeds its max range: OK');
}

// 벽에 부딪히면 소멸한다. 벽 위치는 "출발 시점엔 안 닿고, 딱 한 틱 이동하면 닿는" 자리로
// 잡았다 — 투사체는 한 틱에 PROJECTILE_SPEED(12)만큼만 가므로, 벽을 더 멀리 두면 이 테스트가
// 벽 충돌이 아니라 그냥 "아직 안 닿음"을 확인하게 된다. 출발 (100,100), 1틱 후 (112,100),
// 반지름 8 -> 벽 왼쪽 면(x=115)과 겹침. 출발 시점(x=100)에는 15px 떨어져 있어 안 겹친다.
{
  const wall = { x: 115, y: 80, width: 40, height: 40 };
  const room = makeRoom(
    { p1: makePlayer({ id: 'p1' }) },
    { walls: [wall], projectiles: [{ id: 'pr1', ownerId: 'p1', x: 100, y: 100, aimX: 1, aimY: 0, traveled: 0, hitScore: 30, maxRange: 300 }] },
  );
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.projectiles.length, 0, '벽과 충돌하면 투사체가 사라져야 함');
  console.log('projectile disappears on wall collision: OK');
}

// 상대와 겹치면 점수를 반영하고 소멸한다(관통 없음).
{
  const room = makeRoom(
    {
      p1: makePlayer({ id: 'p1', x: 0, y: 0, score: 0 }),
      p2: makePlayer({ id: 'p2', x: 100 + PROJECTILE_RADIUS + CHARACTER_RADIUS - 1, y: 100, score: 50 }),
    },
    { projectiles: [{ id: 'pr1', ownerId: 'p1', x: 100, y: 100, aimX: 0, aimY: 0, traveled: 0, hitScore: 30, maxRange: 300 }] },
  );
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.projectiles.length, 0, '명중하면 투사체가 사라져야 함');
  assert.strictEqual(next.players.p2.score, 20, '피격자는 hitScore만큼 점수 감소(50-30=20)');
  assert.strictEqual(next.players.p1.score, 30, '발사자는 hitScore만큼 점수 획득');
  console.log('projectile hits an overlapping player, transfers score, and is removed (no piercing): OK');
}

// 원거리 무기도 쿨다운 중엔 새 투사체를 안 만든다(기존 근접 쿨다운 로직과 동일).
{
  const attacker = makePlayer({
    id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hitScore: 30, lastAttackAt: 900,
    isRanged: true, rangeDistance: 300, attackRequested: true,
  });
  const room = makeRoom({ p1: attacker });
  // now=1000, lastAttackAt=900 -> 100ms 경과, ATTACK_COOLDOWN_MS=500이라 아직 쿨다운 중
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.projectiles.length, 0, '쿨다운 중이면 투사체가 생기지 않아야 함');
  assert.strictEqual(next.players.p1.lastAttackAt, 900);
  console.log('ranged attack respects the same cooldown as melee: OK');
}

// computeRanks — 모두 점수가 다르면 그냥 순위대로
{
  const ranks = computeRanks({ a: 90, b: 70, c: 80 });
  assert.deepStrictEqual(ranks, { a: 1, b: 3, c: 2 });
  console.log('computeRanks: distinct scores rank in order: OK');
}

// 동점자는 같은 등수를 공유하고, 다음 등수는 동점자 수만큼 건너뛴다 (90,90,80 -> 1,1,3)
{
  const ranks = computeRanks({ a: 90, b: 90, c: 80 });
  assert.deepStrictEqual(ranks, { a: 1, b: 1, c: 3 });
  console.log('computeRanks: tied scores share a rank and skip the next: OK');
}

// 참가자 1명뿐이면 항상 1위
{
  const ranks = computeRanks({ a: 42 });
  assert.deepStrictEqual(ranks, { a: 1 });
  console.log('computeRanks: single participant is always rank 1: OK');
}

// 전원 동점이면 전원 공동 1위
{
  const ranks = computeRanks({ a: 10, b: 10, c: 10 });
  assert.deepStrictEqual(ranks, { a: 1, b: 1, c: 1 });
  console.log('computeRanks: all tied means everyone is rank 1: OK');
}

console.log('battleSimulation.test.mjs: OK');
