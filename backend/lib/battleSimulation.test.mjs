import assert from 'node:assert';
import {
  stepSimulation,
  hitScoreFromWeaponDamage,
  MOVE_SPEED,
  CHARACTER_RADIUS,
} from './battleSimulation.js';

const noInput = { up: false, down: false, left: false, right: false, attack: false };
function makePlayer(overrides) {
  return {
    id: 'p1', characterId: 'char1', x: 400, y: 300, facing: 'down',
    score: 0, hitScore: 25, connected: true, lastAttackAt: 0,
    input: { ...noInput }, ...overrides,
  };
}
function makeRoom(players, overrides) {
  return { status: 'active', endsAt: 1_000_000, players, walls: [], ...overrides };
}

// hitScoreFromWeaponDamage — 데미지 1~10000 x 계수 0.05
assert.strictEqual(hitScoreFromWeaponDamage(1000), 50);
assert.strictEqual(hitScoreFromWeaponDamage(10000), 500);
assert.strictEqual(hitScoreFromWeaponDamage(5000), 250);
console.log('hitScoreFromWeaponDamage: OK');

// hitScoreFromWeaponDamage 방어: 숫자가 아니거나 0 이하면 최소치(1)로 취급하고, 한 대라도
// 맞히면 최소 1점은 보장한다(Opus 리뷰 Important I1 — round(1*0.05)=0이라 "최소치"가 실제로는
// 0점이 되어, 정상적인 최소 데미지 무기로도 90초 내내 한 점도 못 얻는 문제가 있었음).
assert.strictEqual(hitScoreFromWeaponDamage('abc'), 1, '숫자로 못 바꾸는 문자열');
assert.strictEqual(hitScoreFromWeaponDamage(undefined), 1, 'undefined');
assert.strictEqual(hitScoreFromWeaponDamage(null), 1, 'null');
assert.strictEqual(hitScoreFromWeaponDamage(NaN), 1, 'NaN 직접 입력');
assert.strictEqual(hitScoreFromWeaponDamage(-500), 1, '음수도 최소치(1)로 취급');
console.log('hitScoreFromWeaponDamage guards non-numeric/non-positive input: OK');

// hitScoreFromWeaponDamage 방어: 클라이언트가 보낸 weapon.damage는 서버 검증을 안 거치므로
// 비정상적으로 큰 값(치트/버그)이 와도 AI 채점 상한(DAMAGE_MAX=10000, aiClient.js)을 넘겨
// 그대로 점수에 반영되면 안 된다(Opus 리뷰 Critical C1 — 상한 없이 곱하면 한 방에 상대를
// 0점으로 만들고, DB의 score integer 컬럼 범위도 넘길 수 있었음).
assert.strictEqual(hitScoreFromWeaponDamage(1_000_000_000), 500, '10000을 넘는 값은 10000으로 clamp된 뒤 계수를 곱함');
console.log('hitScoreFromWeaponDamage clamps abnormally large weapon damage: OK');

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

// 공격: 맞으면 공격자는 점수를 얻고, 맞은 쪽은 그만큼 점수를 잃는다
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, facing: 'right', hitScore: 30, input: { ...noInput, attack: true } });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, score: 100 });
  const room = makeRoom({ p1: attacker, p2: target });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.score, 70, `70 기대, 실제 ${next.players.p2.score}`);
  assert.strictEqual(next.players.p1.score, 30, '공격자는 자기 hitScore만큼 점수 획득');
  assert.strictEqual(next.players.p1.lastAttackAt, 1000);
  console.log('attack hits target in range: OK');
}

// 공격: 사거리 밖 상대는 안 맞고, 점수 변화도 없음
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, facing: 'right', hitScore: 30, input: { ...noInput, attack: true } });
  const target = makePlayer({ id: 'p2', x: 600, y: 300, score: 50 });
  const room = makeRoom({ p1: attacker, p2: target });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.score, 50, '사거리 밖이면 점수 변화 없음');
  assert.strictEqual(next.players.p1.score, 0, '명중 못 하면 공격자도 점수 안 오름');
  console.log('attack misses out-of-range target: OK');
}

// 쿨다운: 쿨다운 중 재공격 무효 -> 점수 변화 없음
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, facing: 'right', hitScore: 30, lastAttackAt: 900, input: { ...noInput, attack: true } });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, score: 50 });
  const room = makeRoom({ p1: attacker, p2: target });
  // now=1000, lastAttackAt=900 -> 100ms 경과, ATTACK_COOLDOWN_MS=500이라 아직 쿨다운 중
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.score, 50);
  assert.strictEqual(next.players.p1.lastAttackAt, 900);
  console.log('attack cooldown blocks re-attack: OK');
}

// 연결 끊긴 상대는 공격 대상에서 제외(탈락이 아니라 접속 상태 문제이므로 점수 자체는 안 건드림)
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, facing: 'right', hitScore: 30, input: { ...noInput, attack: true } });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, score: 50, connected: false });
  const room = makeRoom({ p1: attacker, p2: target });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.score, 50, '연결 끊긴 상대는 공격 대상에서 제외되어 점수 변화 없음');
  assert.strictEqual(next.players.p1.score, 0, '아무도 못 맞혔으니 공격자도 점수 안 오름');
  console.log('disconnected target is not a valid attack target: OK');
}

// 점수는 0 밑으로 안 내려감
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, facing: 'right', hitScore: 30, input: { ...noInput, attack: true } });
  const target = makePlayer({ id: 'p2', x: 450, y: 300, score: 10 }); // hitScore(30)보다 적은 점수
  const room = makeRoom({ p1: attacker, p2: target });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.score, 0, '점수는 음수로 안 내려가고 0에서 멈춤');
  console.log('score never drops below 0: OK');
}

// 탈락 없음: 제한시간이 한참 남았으면 아무리 맞아도(심지어 0점이어도) 라운드가 안 끝남
{
  const attacker = makePlayer({ id: 'p1', x: 400, y: 300, facing: 'right', hitScore: 100, input: { ...noInput, attack: true } });
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

// 참가자가 1명뿐이면 제한시간을 다 채울 이유가 없다 — 관리자가 아무도(또는 한 명만) 완료 안
// 한 상태에서 강제로 battle 단계로 넘긴 경우 부스 화면이 90초간 정지해 있는 걸 막는다
// (Opus 리뷰 Important I3).
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

console.log('battleSimulation.test.mjs: OK');
