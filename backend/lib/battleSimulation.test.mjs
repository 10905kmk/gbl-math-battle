import assert from 'node:assert';
import {
  stepSimulation,
  hpDamageFromWeaponDamage,
  computeRanks,
  computeScore,
  buildStandings,
  clampMoveSpeed,
  DEFAULT_MOVE_SPEED,
  MOVE_SPEED_MIN,
  MOVE_SPEED_MAX,
  CHARACTER_RADIUS,
  HP_MAX,
  HP_DAMAGE_MIN,
  HP_DAMAGE_MAX,
  RESPAWN_MS,
  ASSIST_WINDOW_MS,
  BATTLE_DURATION_MS,
  SCORE_PER_KILL,
  SCORE_PER_DEATH,
  SCORE_PER_ASSIST,
} from './battleSimulation.js';
import { ATTACK_HITBOX_SIZE, PROJECTILE_SPEED, PROJECTILE_RADIUS } from '../../shapes/attackGeometry.js';

function approxEqual(a, b, eps = 1e-6, msg = '') {
  assert.ok(Math.abs(a - b) < eps, `${msg} expected ${a} ≈ ${b}`);
}

const SPEED = DEFAULT_MOVE_SPEED;
const noInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };

function makePlayer(overrides) {
  return {
    id: 'p1', characterId: 'char1', x: 400, y: 300, aimX: 0, aimY: 1,
    hp: HP_MAX, alive: true, respawnAt: 0,
    kills: 0, deaths: 0, assists: 0, recentDamagers: {},
    hpDamage: 10, connected: true, lastAttackAt: 0, attackRequested: false,
    isRanged: false, rangeDistance: null,
    input: { ...noInput }, ...overrides,
  };
}

function makeRoom(players, overrides) {
  return {
    status: 'active', endsAt: 1_000_000, players, walls: [],
    arenaSize: { width: 800, height: 600 },
    spawnPoints: [{ x: 50, y: 50 }, { x: 750, y: 550 }],
    moveSpeed: SPEED, projectiles: [],
    ...overrides,
  };
}

// ── 데미지 환산 ─────────────────────────────────────────────────────────
// 무기 데미지(1~10000)를 한 대당 HP %로 환산한다. 핵심 성질은 "상한이 있어서 절대 한 방에
// 안 죽는다".
assert.strictEqual(hpDamageFromWeaponDamage(10000), HP_DAMAGE_MAX, '최강 무기도 상한을 못 넘음');
assert.ok(hpDamageFromWeaponDamage(1) >= HP_DAMAGE_MIN, '최약 무기도 최소 데미지는 보장');
assert.ok(
  hpDamageFromWeaponDamage(5000) > hpDamageFromWeaponDamage(1000),
  '데미지가 클수록 HP를 더 많이 깎아야 함',
);
console.log('hpDamageFromWeaponDamage scales within bounds: OK');

// "바로 죽는 건 안 된다" — 체력을 90으로 낮춰도 최대 데미지 기준 최소 4번은 맞아야 한다.
assert.ok(HP_DAMAGE_MAX * 3 < HP_MAX, `최대 데미지로도 최소 4대는 맞아야 죽어야 함(현재 ${HP_DAMAGE_MAX}×3=${HP_DAMAGE_MAX * 3})`);
console.log('no weapon can defeat a full-health player in fewer than four hits: OK');

assert.strictEqual(hpDamageFromWeaponDamage('abc'), HP_DAMAGE_MIN, '숫자로 못 바꾸는 문자열');
assert.strictEqual(hpDamageFromWeaponDamage(undefined), HP_DAMAGE_MIN, 'undefined');
assert.strictEqual(hpDamageFromWeaponDamage(null), HP_DAMAGE_MIN, 'null');
assert.strictEqual(hpDamageFromWeaponDamage(NaN), HP_DAMAGE_MIN, 'NaN 직접 입력');
assert.strictEqual(hpDamageFromWeaponDamage(-500), HP_DAMAGE_MIN, '음수도 최소치로 취급');
assert.strictEqual(hpDamageFromWeaponDamage(1_000_000_000), HP_DAMAGE_MAX, '비정상적으로 큰 값도 상한으로 clamp');
console.log('hpDamageFromWeaponDamage guards bad input: OK');

// ── 이동 속도 ───────────────────────────────────────────────────────────
assert.strictEqual(clampMoveSpeed(999), MOVE_SPEED_MAX);
assert.strictEqual(clampMoveSpeed(0), MOVE_SPEED_MIN);
assert.strictEqual(clampMoveSpeed('fast'), DEFAULT_MOVE_SPEED, '숫자가 아니면 기본 속도');
assert.ok(DEFAULT_MOVE_SPEED > 4, '기본 이동 속도가 예전 값(4)보다 빨라야 함');
console.log('move speed clamps to its admin-adjustable range: OK');

// 관리자가 바꾼 속도(room.moveSpeed)가 실제 이동에 반영된다 — 모듈 상수를 그대로 쓰고
// 있으면 이 테스트가 실패한다.
{
  const room = makeRoom({ p1: makePlayer({ input: { ...noInput, moveY: -1 } }) }, { moveSpeed: 13 });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.y, 300 - 13, 'room.moveSpeed가 이동 거리를 결정해야 함');
  console.log('room.moveSpeed (admin-adjustable) drives movement: OK');
}

// ── 카운트다운 ──────────────────────────────────────────────────────────
// 카운트다운 중에는 아무도 못 움직이고, 끝나는 순간 본 게임 타이머가 걸린다.
{
  const room = makeRoom(
    { p1: makePlayer({ input: { ...noInput, moveY: -1 } }) },
    { status: 'countdown', countdownEndsAt: 5000 },
  );
  const { room: mid, winners } = stepSimulation(room, 3000);
  assert.strictEqual(mid.players.p1.y, 300, '카운트다운 중엔 이동이 없어야 함');
  assert.strictEqual(mid.status, 'countdown');
  assert.strictEqual(winners, null);

  const { room: started, events } = stepSimulation(room, 5000);
  assert.strictEqual(started.status, 'active', '카운트다운이 끝나면 active로 전환');
  assert.strictEqual(started.endsAt, 5000 + BATTLE_DURATION_MS, '본 게임 제한시간은 카운트다운 종료 시점부터');
  assert.ok(events.some((e) => e.type === 'roundStart'));
console.log('countdown freezes the round and starts the clock when it ends: OK');

{
  const room = makeRoom({}, { status: 'countdown', countdownEndsAt: 1000, endsAt: null, durationMs: 90_000 });
  const { room: active } = stepSimulation(room, 1000);
  assert.strictEqual(active.endsAt, 91_000, '설정한 게임 시간이 카운트다운 종료 뒤 적용되어야 함');
  console.log('configured battle duration drives the active round clock: OK');
}
}

// ── 이동/충돌 (기존 성질 유지) ──────────────────────────────────────────
{
  const room = makeRoom({ p1: makePlayer({ input: { ...noInput, moveX: 1, moveY: 1 } }) });
  const { room: next } = stepSimulation(room, 1000);
  const dx = next.players.p1.x - 400;
  const dy = next.players.p1.y - 300;
  approxEqual(Math.hypot(dx, dy), SPEED, 1e-6, '대각선 이동 거리는 이동속도와 같아야 함(더 빠르면 안 됨)');
  approxEqual(dx, dy, 1e-6, '두 축 모두 같은 비율로 정규화되어야 함');
  console.log('diagonal movement is normalized: OK');
}

{
  const room = makeRoom({ p1: makePlayer({ input: { ...noInput, moveX: 3, moveY: 4 } }) });
  const { room: next } = stepSimulation(room, 1000);
  approxEqual(next.players.p1.x - 400, SPEED * 0.6, 1e-6);
  approxEqual(next.players.p1.y - 300, SPEED * 0.8, 1e-6);
  console.log('overlong move vector is clamped to length 1: OK');
}

{
  const room = makeRoom({ p1: makePlayer({ x: CHARACTER_RADIUS, y: 300, input: { ...noInput, moveX: -1 } }) });
  assert.strictEqual(stepSimulation(room, 1000).room.players.p1.x, CHARACTER_RADIUS);
  console.log('arena boundary clamp: OK');
}

{
  const wall = { x: 420, y: 280, width: 40, height: 40 };
  const room = makeRoom({ p1: makePlayer({ x: 400, y: 300, input: { ...noInput, moveX: 1 } }) }, { walls: [wall] });
  assert.strictEqual(stepSimulation(room, 1000).room.players.p1.x, 400);
  console.log('wall collision: OK');
}

{
  const room = makeRoom({ p1: makePlayer({ input: { ...noInput, moveY: -1 } }) }, { status: 'ended' });
  const { room: next, winners } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.y, 300);
  assert.strictEqual(winners, null);
  console.log('inactive room is a no-op: OK');
}

{
  const room = makeRoom(
    { p1: makePlayer({ x: 79, y: 79, input: { ...noInput, moveX: 1, moveY: 1 } }) },
    { arenaSize: { width: 100, height: 100 } },
  );
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.x, 100 - CHARACTER_RADIUS);
  assert.strictEqual(next.players.p1.y, 100 - CHARACTER_RADIUS);
  console.log('room.arenaSize drives the boundary clamp: OK');
}

// ── 조준 ────────────────────────────────────────────────────────────────
{
  const room = makeRoom({ p1: makePlayer({ aimX: 1, aimY: 0, input: { ...noInput, aimX: 0, aimY: -1 } }) });
  const { room: next } = stepSimulation(room, 1000);
  approxEqual(next.players.p1.aimX, 0, 1e-6);
  approxEqual(next.players.p1.aimY, -1, 1e-6);
  console.log('aim updates from sufficiently long input vector: OK');
}

{
  const room = makeRoom({ p1: makePlayer({ aimX: 1, aimY: 0, input: { ...noInput, aimX: 0.005, aimY: 0.005 } }) });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.aimX, 1, '데드존보다 짧은 입력은 무시되고 이전 조준 유지');
  console.log('aim below deadzone keeps previous aim: OK');
}

// 회귀(Opus 리뷰 Important I3): 길이가 Infinity로 오버플로하는 조준 입력은 무시해야 한다 —
// 안 그러면 aim이 (0,0)으로 영구 저장되어 전방위 히트박스가 된다.
{
  const room = makeRoom({
    p1: makePlayer({ aimX: 1, aimY: 0, input: { ...noInput, aimX: Number.MAX_VALUE, aimY: Number.MAX_VALUE } }),
  });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.aimX, 1);
  assert.strictEqual(next.players.p1.aimY, 0);
  console.log('aim input that overflows to Infinity length keeps previous aim: OK');
}

// 회귀(Opus 리뷰 Minor M1): NaN/Infinity 이동 입력이 위치를 오염시키면 안 된다.
{
  const room = makeRoom({ p1: makePlayer({ input: { ...noInput, moveX: NaN, moveY: Infinity } }) });
  const { room: next } = stepSimulation(room, 1000);
  assert.ok(Number.isFinite(next.players.p1.x));
  assert.ok(Number.isFinite(next.players.p1.y));
  console.log('NaN/Infinity move input does not poison position: OK');
}

// ── 공격 → 체력 ─────────────────────────────────────────────────────────
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hpDamage: 20, attackRequested: true });
  const target = makePlayer({ id: 'p2', x: 450, y: 300 });
  const { room: next } = stepSimulation(makeRoom({ p1: attacker, p2: target }), 1000);
  assert.strictEqual(next.players.p2.hp, HP_MAX - 20, '맞으면 HP가 깎인다');
  assert.strictEqual(next.players.p2.alive, true, '한 방으로는 안 죽는다');
  assert.strictEqual(next.players.p1.kills, 0, '죽이지 못했으면 킬 없음');
  assert.strictEqual(next.players.p1.lastAttackAt, 1000);
  assert.strictEqual(next.players.p1.attackRequested, false, 'attackRequested는 처리 후 항상 리셋됨');
  console.log('attack damages HP in the aim direction: OK');
}

{
  const offset = CHARACTER_RADIUS + ATTACK_HITBOX_SIZE / 2;
  const attacker = makePlayer({
    id: 'p1', x: 400, y: 300, aimX: Math.SQRT1_2, aimY: Math.SQRT1_2, hpDamage: 20, attackRequested: true,
  });
  const target = makePlayer({ id: 'p2', x: 400 + Math.SQRT1_2 * offset, y: 300 + Math.SQRT1_2 * offset });
  const { room: next } = stepSimulation(makeRoom({ p1: attacker, p2: target }), 1000);
  assert.strictEqual(next.players.p2.hp, HP_MAX - 20, '45도 대각선 조준도 그 방향의 상대를 맞혀야 함');
  console.log('attack hitbox follows continuous aim angle: OK');
}

for (const [label, attackerOverrides, targetOverrides] of [
  ['attackRequested가 false면 발동하지 않음', { attackRequested: false }, {}],
  ['사거리 밖은 안 맞음', { attackRequested: true }, { x: 600 }],
  ['연결 끊긴 상대는 대상에서 제외', { attackRequested: true }, { connected: false }],
  // respawnAt을 멀리 두지 않으면 이 틱에서 바로 부활해버려 "죽어 있는 상대"를 검증하지 못한다.
  ['이미 죽어서 부활 대기 중인 상대는 대상에서 제외', { attackRequested: true }, { alive: false, hp: 0, respawnAt: 999_999 }],
]) {
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hpDamage: 20, ...attackerOverrides });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, ...targetOverrides });
  const { room: next } = stepSimulation(makeRoom({ p1: attacker, p2: target }), 1000);
  const expected = targetOverrides.hp ?? HP_MAX;
  assert.strictEqual(next.players.p2.hp, expected, label);
}
console.log('attacks respect request/range/connection/alive conditions: OK');

{
  const attacker = makePlayer({
    id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hpDamage: 20, lastAttackAt: 900, attackRequested: true,
  });
  const target = makePlayer({ id: 'p2', x: 450, y: 300 });
  // now=1000, lastAttackAt=900 -> 100ms 경과, ATTACK_COOLDOWN_MS=500이라 아직 쿨다운 중
  const { room: next } = stepSimulation(makeRoom({ p1: attacker, p2: target }), 1000);
  assert.strictEqual(next.players.p2.hp, HP_MAX);
  assert.strictEqual(next.players.p1.lastAttackAt, 900);
  assert.strictEqual(next.players.p1.attackRequested, false, '쿨다운에 막힌 요청도 대기열에 안 남고 소비됨');
  console.log('attack cooldown drops the request instead of queueing: OK');
}

// ── 죽음 / 킬 / 데스 / 어시스트 ─────────────────────────────────────────
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hpDamage: 20, attackRequested: true });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, hp: 15 });
  const { room: next, events } = stepSimulation(makeRoom({ p1: attacker, p2: target }), 1000);
  assert.strictEqual(next.players.p2.hp, 0);
  assert.strictEqual(next.players.p2.alive, false, 'HP가 0이면 죽는다');
  assert.strictEqual(next.players.p2.deaths, 1);
  assert.strictEqual(next.players.p2.respawnAt, 1000 + RESPAWN_MS, `${RESPAWN_MS / 1000}초 뒤 부활 예약`);
  assert.strictEqual(next.players.p1.kills, 1, '막타를 친 사람이 킬을 가져간다');
  assert.ok(events.some((e) => e.type === 'kill' && e.targetId === 'p2' && e.attackerId === 'p1'));
  console.log('lethal hit records a kill and schedules a respawn: OK');
}

// 어시스트: 최근에 피해를 준 사람(막타 제외)이 어시스트를 받는다.
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hpDamage: 20, attackRequested: true });
  const helper = makePlayer({ id: 'p3', x: 100, y: 100 });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, hp: 15, recentDamagers: { p3: 1000 - 2000 } });
  const { room: next } = stepSimulation(makeRoom({ p1: attacker, p2: target, p3: helper }), 1000);
  assert.strictEqual(next.players.p3.assists, 1, '어시스트 시간 안에 때린 사람은 어시스트를 받는다');
  assert.strictEqual(next.players.p1.assists, 0, '막타를 친 사람은 어시스트를 중복으로 받지 않는다');
  console.log('assists go to recent damagers other than the finisher: OK');
}

// 어시스트 시간이 지난 기록은 무시된다.
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hpDamage: 20, attackRequested: true });
  const helper = makePlayer({ id: 'p3', x: 100, y: 100 });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, hp: 15, recentDamagers: { p3: 1000 - ASSIST_WINDOW_MS - 1 } });
  const { room: next } = stepSimulation(makeRoom({ p1: attacker, p2: target, p3: helper }), 1000);
  assert.strictEqual(next.players.p3.assists, 0, '어시스트 시간이 지난 기록은 무시');
  console.log('stale damage records do not grant assists: OK');
}

// 부활: 시간이 되면 만피로 되살아나고, 살아 있는 다른 사람에게서 가장 먼 스폰을 고른다.
{
  const dead = makePlayer({ id: 'p1', alive: false, hp: 0, respawnAt: 5000, x: 400, y: 300 });
  const alive = makePlayer({ id: 'p2', x: 60, y: 60 }); // 스폰 (50,50) 바로 옆
  const room = makeRoom({ p1: dead, p2: alive });

  const { room: waiting } = stepSimulation(room, 4999);
  assert.strictEqual(waiting.players.p1.alive, false, '부활 시각 전에는 계속 죽어 있어야 함');

  const { room: revived, events } = stepSimulation(room, 5000);
  assert.strictEqual(revived.players.p1.alive, true);
  assert.strictEqual(revived.players.p1.hp, HP_MAX, '부활하면 만피');
  assert.deepStrictEqual(
    { x: revived.players.p1.x, y: revived.players.p1.y },
    { x: 750, y: 550 },
    '살아 있는 상대에게서 먼 스폰을 골라야 함(스폰 캠핑 방지)',
  );
  assert.ok(events.some((e) => e.type === 'respawn' && e.playerId === 'p1'));
  console.log('respawn restores full HP at the safest spawn point: OK');
}

// 죽은 사람은 움직이지도 공격하지도 못한다.
{
  const dead = makePlayer({
    id: 'p1', alive: false, hp: 0, respawnAt: 999_999,
    attackRequested: true, aimX: 1, aimY: 0, hpDamage: 20,
    input: { ...noInput, moveX: 1 },
  });
  const target = makePlayer({ id: 'p2', x: 450, y: 300 });
  const { room: next } = stepSimulation(makeRoom({ p1: dead, p2: target }), 1000);
  assert.strictEqual(next.players.p1.x, 400, '죽은 상태에서는 이동 불가');
  assert.strictEqual(next.players.p2.hp, HP_MAX, '죽은 상태에서는 공격 불가');
  console.log('dead players cannot move or attack while waiting to respawn: OK');
}

// ── 점수 ────────────────────────────────────────────────────────────────
assert.strictEqual(computeScore({ kills: 3, deaths: 2, assists: 4 }), 3 * SCORE_PER_KILL + 2 * SCORE_PER_DEATH + 4 * SCORE_PER_ASSIST);
assert.strictEqual(computeScore({ kills: 3, deaths: 2, assists: 4 }), 60 - 20 + 20);
assert.strictEqual(computeScore({}), 0, '기록이 없으면 0점');
assert.strictEqual(computeScore({ kills: 0, deaths: 3, assists: 0 }), -30, '많이 죽으면 음수도 된다');
console.log('computeScore: kill +20 / death -10 / assist +5: OK');

// ── 승패 / 순위 ─────────────────────────────────────────────────────────
{
  const room = makeRoom(
    { p1: makePlayer({ id: 'p1', kills: 4 }), p2: makePlayer({ id: 'p2', kills: 2 }) },
    { endsAt: 1_000_000 },
  );
  const { winners, room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.status, 'active', '제한시간 전엔 라운드가 끝나지 않는다(목숨 무한)');
  assert.strictEqual(winners, null);
  console.log('rounds never end early — lives are unlimited: OK');
}

{
  const room = makeRoom({ p1: makePlayer({ id: 'p1', kills: 4 }), p2: makePlayer({ id: 'p2', kills: 2 }) }, { endsAt: 1000 });
  const { winners, room: next } = stepSimulation(room, 1000);
  assert.deepStrictEqual(winners, ['p1']);
  assert.strictEqual(next.status, 'ended');
  console.log('win by timeout (highest score): OK');
}

{
  const room = makeRoom(
    {
      p1: makePlayer({ id: 'p1', kills: 3 }),
      p2: makePlayer({ id: 'p2', kills: 3 }),
      p3: makePlayer({ id: 'p3', kills: 1 }),
    },
    { endsAt: 1000 },
  );
  const { winners } = stepSimulation(room, 1000);
  assert.deepStrictEqual(winners.sort(), ['p1', 'p2']);
  console.log('win by timeout tie (multiple winners): OK');
}

{
  const room = makeRoom({ p1: makePlayer({ id: 'p1' }) }, { endsAt: 1_000_000 });
  const { winners, room: next } = stepSimulation(room, 1000);
  assert.strictEqual(winners, null, '참가자 1명이어도 제한시간 전에는 종료하지 않음');
  assert.strictEqual(next.status, 'active');
  const ended = stepSimulation(room, room.endsAt);
  assert.deepStrictEqual(ended.winners, ['p1'], '참가자 1명 게임도 제한시간에 정상 종료');
  assert.strictEqual(ended.room.status, 'ended');
  console.log('battle with only 1 participant runs until the configured timeout: OK');
}

{
  const { winners, room: next } = stepSimulation(makeRoom({}, { endsAt: 1_000_000 }), 1000);
  assert.deepStrictEqual(winners, []);
  assert.strictEqual(next.status, 'ended');
  console.log('battle with 0 participants ends immediately without crashing: OK');
}

// ── 최종 순위 대시보드 ──────────────────────────────────────────────────
{
  const standings = buildStandings({
    p1: makePlayer({ id: 'p1', name: '가', kills: 5, deaths: 2, assists: 1 }), // 100-20+5 = 85
    p2: makePlayer({ id: 'p2', name: '나', kills: 4, deaths: 1, assists: 3 }), // 80-10+15 = 85
    p3: makePlayer({ id: 'p3', name: '다', kills: 0, deaths: 4, assists: 0 }), // -40
  });
  assert.deepStrictEqual(standings.map((p) => p.id), ['p1', 'p2', 'p3'], '점수 높은 순, 동점은 킬 많은 순');
  assert.deepStrictEqual(standings.map((p) => p.rank), [1, 1, 3], '동점은 등수를 공유하고 다음 등수는 건너뜀');
  assert.deepStrictEqual(standings.map((p) => p.score), [85, 85, -40]);
  assert.deepStrictEqual(standings[0], { id: 'p1', name: '가', characterId: 'char1', kills: 5, deaths: 2, assists: 1, score: 85, rank: 1 });
  console.log('buildStandings ranks everyone with K/D/A and total score: OK');
}

// ── 투사체 ──────────────────────────────────────────────────────────────
{
  const attacker = makePlayer({
    id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hpDamage: 15,
    isRanged: true, rangeDistance: 300, attackRequested: true,
  });
  const { room: next } = stepSimulation(makeRoom({ p1: attacker }), 1000);
  assert.strictEqual(next.projectiles.length, 1, '투사체가 하나 생성되어야 함');
  assert.strictEqual(next.projectiles[0].ownerId, 'p1');
  assert.strictEqual(next.projectiles[0].hpDamage, 15);
  assert.strictEqual(next.projectiles[0].maxRange, 300);
  assert.strictEqual(next.players.p1.lastAttackAt, 1000, '원거리도 쿨다운은 똑같이 적용됨');
  console.log('ranged attack spawns a projectile: OK');
}

{
  const room = makeRoom(
    { p1: makePlayer({ id: 'p1' }) },
    { projectiles: [{ id: 'pr1', ownerId: 'p1', x: 100, y: 100, aimX: 1, aimY: 0, traveled: 0, hpDamage: 15, maxRange: 300 }] },
  );
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.projectiles[0].x, 100 + PROJECTILE_SPEED);
  assert.strictEqual(next.projectiles[0].traveled, PROJECTILE_SPEED);
  console.log('projectile advances by PROJECTILE_SPEED each tick: OK');
}

{
  const room = makeRoom(
    { p1: makePlayer({ id: 'p1' }), p2: makePlayer({ id: 'p2', x: 5000, y: 5000 }) },
    { projectiles: [{ id: 'pr1', ownerId: 'p1', x: 100, y: 100, aimX: 1, aimY: 0, traveled: 295, hpDamage: 15, maxRange: 300 }] },
  );
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.projectiles.length, 0, '사거리를 넘으면 투사체가 사라져야 함');
  assert.strictEqual(next.players.p2.hp, HP_MAX);
  console.log('projectile disappears once it exceeds its max range: OK');
}

// 벽 위치는 "출발 시점엔 안 닿고, 딱 한 틱 이동하면 닿는" 자리로 잡았다 — 더 멀리 두면
// 벽 충돌이 아니라 그냥 "아직 안 닿음"을 확인하게 된다.
{
  const room = makeRoom(
    { p1: makePlayer({ id: 'p1' }) },
    {
      walls: [{ x: 115, y: 80, width: 40, height: 40 }],
      projectiles: [{ id: 'pr1', ownerId: 'p1', x: 100, y: 100, aimX: 1, aimY: 0, traveled: 0, hpDamage: 15, maxRange: 300 }],
    },
  );
  assert.strictEqual(stepSimulation(room, 1000).room.projectiles.length, 0, '벽과 충돌하면 투사체가 사라져야 함');
  console.log('projectile disappears on wall collision: OK');
}

{
  const room = makeRoom(
    {
      p1: makePlayer({ id: 'p1', x: 0, y: 0 }),
      p2: makePlayer({ id: 'p2', x: 100 + PROJECTILE_RADIUS + CHARACTER_RADIUS - 1, y: 100 }),
    },
    { projectiles: [{ id: 'pr1', ownerId: 'p1', x: 100, y: 100, aimX: 0, aimY: 0, traveled: 0, hpDamage: 15, maxRange: 300 }] },
  );
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.projectiles.length, 0, '명중하면 투사체가 사라져야 함(관통 없음)');
  assert.strictEqual(next.players.p2.hp, HP_MAX - 15, '피격자는 투사체 데미지만큼 HP 감소');
  console.log('projectile hits an overlapping player and is removed: OK');
}

{
  const attacker = makePlayer({
    id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hpDamage: 15, lastAttackAt: 900,
    isRanged: true, rangeDistance: 300, attackRequested: true,
  });
  assert.strictEqual(stepSimulation(makeRoom({ p1: attacker }), 1000).room.projectiles.length, 0, '쿨다운 중이면 투사체가 안 생김');
  console.log('ranged attack respects the same cooldown as melee: OK');
}

// ── computeRanks ────────────────────────────────────────────────────────
assert.deepStrictEqual(computeRanks({ a: 90, b: 70, c: 80 }), { a: 1, b: 3, c: 2 });
assert.deepStrictEqual(computeRanks({ a: 90, b: 90, c: 80 }), { a: 1, b: 1, c: 3 });
assert.deepStrictEqual(computeRanks({ a: 42 }), { a: 1 });
assert.deepStrictEqual(computeRanks({ a: 10, b: 10, c: 10 }), { a: 1, b: 1, c: 1 });
assert.deepStrictEqual(computeRanks({ a: -30, b: 0 }), { a: 2, b: 1 }, '음수 점수도 정상적으로 순위가 매겨져야 함');
console.log('computeRanks: OK');

console.log('battleSimulation.test.mjs: OK');
