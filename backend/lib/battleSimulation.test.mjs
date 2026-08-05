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

console.log('battleSimulation.test.mjs (movement): OK');
