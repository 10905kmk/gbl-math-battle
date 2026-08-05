import assert from 'node:assert';
import {
  stepSimulation,
  hitDamageFromWeaponDamage,
  MOVE_SPEED,
  CHARACTER_RADIUS,
} from './battleSimulation.js';

const noInput = { up: false, down: false, left: false, right: false, attack: false };
function makePlayer(overrides) {
  return {
    id: 'p1', characterId: 'char1', x: 400, y: 300, facing: 'down',
    hp: 100, hitDamage: 25, alive: true, lastAttackAt: 0,
    input: { ...noInput }, ...overrides,
  };
}
function makeRoom(players, overrides) {
  return { status: 'active', endsAt: 1_000_000, players, walls: [], ...overrides };
}

// hitDamageFromWeaponDamage clamp 범위
assert.strictEqual(hitDamageFromWeaponDamage(1), 5);
assert.strictEqual(hitDamageFromWeaponDamage(10000), 50);
assert.strictEqual(hitDamageFromWeaponDamage(5000), 25);
console.log('hitDamageFromWeaponDamage: OK');

// 이동: up 입력 시 y가 MOVE_SPEED만큼 감소
{
  const room = makeRoom({ p1: makePlayer({ input: { ...noInput, up: true } }) });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.y, 300 - MOVE_SPEED);
  assert.strictEqual(next.players.p1.x, 400);
  assert.strictEqual(next.players.p1.facing, 'up');
  console.log('movement up: OK');
}

// 아레나 경계를 못 뚫음
{
  const room = makeRoom({ p1: makePlayer({ x: CHARACTER_RADIUS, y: 300, input: { ...noInput, left: true } }) });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.x, CHARACTER_RADIUS);
  console.log('arena boundary clamp: OK');
}

// 벽을 뚫지 못함
{
  const wall = { x: 420, y: 280, width: 40, height: 40 };
  const room = makeRoom({ p1: makePlayer({ x: 400, y: 300, input: { ...noInput, right: true } }) }, { walls: [wall] });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.x, 400);
  console.log('wall collision: OK');
}

// status가 'active'가 아니면 아무 것도 안 함
{
  const room = makeRoom({ p1: makePlayer({ input: { ...noInput, up: true } }) }, { status: 'ended' });
  const { room: next, winners } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.y, 300);
  assert.strictEqual(winners, null);
  console.log('inactive room is a no-op: OK');
}

// 공격: 바라보는 방향에 있는 상대는 맞음
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, facing: 'right', hitDamage: 30, input: { ...noInput, attack: true } });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, hp: 100 });
  const room = makeRoom({ p1: attacker, p2: target });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.hp, 70, `70 기대, 실제 ${next.players.p2.hp}`);
  assert.strictEqual(next.players.p1.lastAttackAt, 1000);
  console.log('attack hits target in range: OK');
}

// 공격: 사거리 밖 상대는 안 맞음
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, facing: 'right', input: { ...noInput, attack: true } });
  const target = makePlayer({ id: 'p2', x: 600, y: 300, hp: 100 });
  const room = makeRoom({ p1: attacker, p2: target });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.hp, 100);
  console.log('attack misses out-of-range target: OK');
}

// 쿨다운: 쿨다운 중 재공격 무효
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, facing: 'right', hitDamage: 30, lastAttackAt: 900, input: { ...noInput, attack: true } });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, hp: 100 });
  const room = makeRoom({ p1: attacker, p2: target });
  // now=1000, lastAttackAt=900 -> 100ms 경과, ATTACK_COOLDOWN_MS=500이라 아직 쿨다운 중
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.hp, 100);
  assert.strictEqual(next.players.p1.lastAttackAt, 900);
  console.log('attack cooldown blocks re-attack: OK');
}

// 죽은 상대는 공격 대상에서 제외 (hp가 0 밑으로 안 내려감)
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, facing: 'right', hitDamage: 30, input: { ...noInput, attack: true } });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, hp: 100, alive: false });
  const room = makeRoom({ p1: attacker, p2: target });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.hp, 100, '이미 죽은 상대는 데미지 안 받음');
  console.log('dead target takes no damage: OK');
}

console.log('battleSimulation.test.mjs (movement): OK');
