# 대전 조작방식 듀얼스틱 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대전(4단계) 조작을 4방향 이동+스페이스바 공격에서, 대각선 이동이 자유롭고 이동/조준이 완전히 분리된 브롤스타즈 스타일 듀얼스틱(모바일)/WASD+마우스(PC) 방식으로 바꾼다.

**Architecture:** 서버(`backend/lib/battleSimulation.js`)의 `player.input`을 불리언 4방향+attack에서 연속 벡터 `{moveX, moveY, aimX, aimY}`로 바꾸고, 공격은 상태가 아니라 `battle:attack` 1회성 이벤트로 분리한다. 프론트엔드는 새 `VirtualJoystick` 컴포넌트(터치 드래그)를 이동/조준 양쪽에 재사용하고, PC는 키보드(WASD+화살표) 이동 + 마우스 방향 조준 + 클릭 공격을 병행 지원한다.

**Tech Stack:** Node.js(순수 함수 + `node:assert` 기반 `.mjs` 테스트, 프레임워크 없음), Socket.io, Preact + htm(빌드 없이 importmap으로 esm.sh CDN에서 로드), Konva.

## Global Constraints

- 서버 틱 주기 `TICK_MS = 50`(`backend/socket/battle.js`)은 바꾸지 않는다.
- 기존 상수값 유지: `MOVE_SPEED = 4`, `ATTACK_COOLDOWN_MS = 500`, `ATTACK_HITBOX_SIZE = 30`, `CHARACTER_RADIUS = 20`(모두 `backend/lib/battleSimulation.js`).
- 조준 데드존(서버): 벡터 길이가 `0.01` 미만이면 조준을 갱신하지 않고 이전 값을 유지한다.
- 클라이언트가 보내는 입력 벡터는 항상 서버에서 재검증한다 — 길이가 1을 넘으면 방향은 유지한 채 길이만 1로 clamp(기존 `weaponDamage` clamp와 같은 원칙, 클라이언트를 신뢰하지 않는다).
- 공격은 "누르고 있는 상태"가 아니라 1회성 요청이다 — 쿨다운 중에 들어온 요청은 버리고 대기열에 쌓지 않는다.
- 맵 이미지 교체, 캐릭터 선택 UI, 타격 이펙트(화면 흔들림/궤적/파티클), 조이스틱 시각 디자인 커스터마이징은 이번 스코프에 없다.
- 프론트엔드는 빌드 스텝이 없다(`frontend/index.html`의 importmap으로 CDN에서 바로 로드) — 새 파일은 문법만 맞으면 되고 별도 빌드 명령이 없다.

---

### Task 1: `battleSimulation.js` — 연속 이동/조준/공격 판정 로직

**Files:**
- Modify: `backend/lib/battleSimulation.js`
- Test: `backend/lib/battleSimulation.test.mjs` (전면 재작성)

**Interfaces:**
- Consumes: 없음(이 프로젝트의 최하위 순수 로직 계층).
- Produces: `stepSimulation(room, now)` — 이제 `room.players[id].input`이 `{moveX, moveY, aimX, aimY}`(모두 number)여야 하고, `room.players[id]`에 `aimX`(number), `aimY`(number), `attackRequested`(boolean)가 있어야 한다. `facing` 필드와 `input.attack`은 더 이상 쓰이지 않는다(Task 2가 이 player shape로 초기화한다). `hitScoreFromWeaponDamage`, `ARENA_SIZE`, `CHARACTER_RADIUS`, `MOVE_SPEED`, `ATTACK_COOLDOWN_MS`, `BATTLE_DURATION_MS`, `HIT_SCORE_COEFFICIENT` export는 이름/의미 변경 없음.

- [ ] **Step 1: 새 테스트 전체를 작성(RED)**

`backend/lib/battleSimulation.test.mjs`를 아래 내용으로 완전히 교체한다(기존 hitScoreFromWeaponDamage/승리판정 테스트는 그대로 유지하되 `makePlayer`/`noInput` 기본값만 새 shape로 바꾸고, 이동/공격 관련 테스트를 연속 벡터 기준으로 다시 쓴다):

```js
import assert from 'node:assert';
import {
  stepSimulation,
  hitScoreFromWeaponDamage,
  MOVE_SPEED,
  CHARACTER_RADIUS,
  ATTACK_HITBOX_SIZE,
} from './battleSimulation.js';

function approxEqual(a, b, eps = 1e-6, msg = '') {
  assert.ok(Math.abs(a - b) < eps, `${msg} expected ${a} ≈ ${b}`);
}

const noInput = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
function makePlayer(overrides) {
  return {
    id: 'p1', characterId: 'char1', x: 400, y: 300, aimX: 0, aimY: 1,
    score: 0, hitScore: 25, connected: true, lastAttackAt: 0, attackRequested: false,
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

console.log('battleSimulation.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node backend/lib/battleSimulation.test.mjs`
Expected: FAIL — `input.moveX`가 없거나(`undefined`) `player.facing`을 참조하는 기존 구현 때문에 이동/조준/공격 관련 assert들이 깨진다.

- [ ] **Step 3: `battleSimulation.js` 구현을 교체(GREEN)**

`backend/lib/battleSimulation.js` 전체를 아래 내용으로 교체한다(파일 상단 `export const` 상수들과 `hitScoreFromWeaponDamage`, `clamp`, `circleRectOverlap`, `circleOverlapsAnyWall`은 지금 그대로 두고, 그 아래 이동/공격 관련 함수들만 바뀐다):

```js
export const ARENA_SIZE = { width: 800, height: 600 };
export const CHARACTER_RADIUS = 20;
export const MOVE_SPEED = 4;
export const HIT_SCORE_COEFFICIENT = 0.05;
export const ATTACK_HITBOX_SIZE = 30;
export const ATTACK_COOLDOWN_MS = 500;
export const BATTLE_DURATION_MS = 90000;
// 조준 벡터가 이 길이보다 짧으면 "조준 입력 없음"으로 보고 이전 조준을 유지한다 — 모바일
// 조준 스틱이 중앙 근처에 있거나 마우스가 캐릭터 위에 있을 때, 히트박스가 캐릭터 자기
// 자신 위치로 무너지는 것을 방지한다.
const AIM_DEADZONE = 0.01;
// aiClient.js의 DAMAGE_MAX와 같은 상한 — weapon.damage는 소켓으로 들어오는 클라이언트 제공
// 값이라 서버 검증을 거치지 않는다. 상한 없이 곱하면 비정상적으로 큰 값(치트/버그)이 그대로
// 점수에 반영되어 한 방에 상대를 0점으로 만들거나, DB의 score integer 컬럼 범위를 넘길 수
// 있다(Opus 리뷰 Critical C1).
const WEAPON_DAMAGE_MAX = 10000;

// weaponDamage는 숫자가 아니거나 0 이하일 수도 있다 — 검증 없이 곱하면 NaN/음수 점수 변동으로
// 이어져 사고가 난다. 숫자가 아니거나 0 이하면 최소치(1)로 취급하고, 큰 값은 위 상한으로
// clamp한다. 계산 결과가 0이 되면(약한 무기가 반올림으로 0점) 한 대 맞혔는데도 점수가 전혀
// 안 오르는 게 되므로, 명중은 항상 최소 1점을 보장한다(Opus 리뷰 Important I1).
export function hitScoreFromWeaponDamage(weaponDamage) {
  const value = Number(weaponDamage);
  const safeValue = Number.isFinite(value) && value > 0 ? Math.min(value, WEAPON_DAMAGE_MAX) : 1;
  return Math.max(1, Math.round(safeValue * HIT_SCORE_COEFFICIENT));
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function circleRectOverlap(cx, cy, r, rectX, rectY, rectW, rectH) {
  const closestX = clamp(cx, rectX, rectX + rectW);
  const closestY = clamp(cy, rectY, rectY + rectH);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}

function circleOverlapsAnyWall(cx, cy, r, walls) {
  return walls.some((w) => circleRectOverlap(cx, cy, r, w.x, w.y, w.width, w.height));
}

// 벡터 길이가 1을 넘으면 방향은 유지한 채 길이만 1로 줄인다 — 클라이언트가 정규화 안 된
// 값(버그 또는 조작된 입력)을 보내도 서버가 항상 재검증한다(weaponDamage clamp와 같은 원칙).
function normalizeIfLong(x, y) {
  const len = Math.hypot(x, y);
  if (len <= 1) return { x, y };
  return { x: x / len, y: y / len };
}

// 이동 벡터(moveX/moveY, -1~1)로 이동한다 — 대각선 입력이 자동으로 가능해지고(둘 다 0이
// 아닐 수 있으므로), 벽/경계 충돌 판정은 기존과 동일하다.
function moveOne(player, walls) {
  const move = normalizeIfLong(player.input.moveX ?? 0, player.input.moveY ?? 0);
  const dx = move.x * MOVE_SPEED;
  const dy = move.y * MOVE_SPEED;

  let x = clamp(player.x + dx, CHARACTER_RADIUS, ARENA_SIZE.width - CHARACTER_RADIUS);
  let y = clamp(player.y + dy, CHARACTER_RADIUS, ARENA_SIZE.height - CHARACTER_RADIUS);

  if (circleOverlapsAnyWall(x, player.y, CHARACTER_RADIUS, walls)) x = player.x;
  if (circleOverlapsAnyWall(x, y, CHARACTER_RADIUS, walls)) y = player.y;

  return { ...player, x, y };
}

// 조준(aimX/aimY)은 이동과 분리된 별개 입력이라 여기서 따로 갱신한다. 입력 벡터가
// 데드존보다 짧으면(스틱이 중앙 근처, 마우스가 캐릭터 위인 등) 이전 조준을 그대로
// 유지하고, 그렇지 않으면 정규화(단위벡터화)해서 저장한다.
function applyAim(player) {
  const x = player.input.aimX ?? 0;
  const y = player.input.aimY ?? 0;
  const len = Math.hypot(x, y);
  if (len < AIM_DEADZONE) return player;
  return { ...player, aimX: x / len, aimY: y / len };
}

// 공격 히트박스 — 캐릭터 중심에서 조준 방향으로 고정 거리만큼 떨어진 지점에 고정 크기
// 정사각형을 둔다. 4방향 lookup 대신 연속 각도(aimX/aimY)로 위치만 계산하므로, 히트박스
// 자체는 회전하지 않는 axis-aligned 사각형 그대로라 circleRectOverlap을 그대로 재사용한다.
function attackHitboxRect(player) {
  const offset = CHARACTER_RADIUS + ATTACK_HITBOX_SIZE / 2;
  const centerX = player.x + player.aimX * offset;
  const centerY = player.y + player.aimY * offset;
  return {
    x: centerX - ATTACK_HITBOX_SIZE / 2,
    y: centerY - ATTACK_HITBOX_SIZE / 2,
    width: ATTACK_HITBOX_SIZE,
    height: ATTACK_HITBOX_SIZE,
  };
}

export function stepSimulation(room, now) {
  if (room.status !== 'active') return { room, winners: null };

  const players = {};
  for (const id of Object.keys(room.players)) {
    const p = room.players[id];
    players[id] = p.connected ? applyAim(moveOne(p, room.walls)) : { ...p };
  }

  // 공격 판정 — 참가자 순서(입장 순서)대로 한 명씩 처리, 쿨다운 통과 시 즉시 판정.
  // attackRequested는 "그 순간의 요청 1회"라, 처리 결과(성공/쿨다운 실패)와 무관하게 이
  // 틱에서 항상 소비(false로 리셋)한다 — 다음 틱까지 대기열에 남지 않는다.
  for (const id of Object.keys(players)) {
    const attacker = players[id];
    const wantsAttack = attacker.connected && attacker.attackRequested;
    players[id] = { ...attacker, attackRequested: false };
    if (!wantsAttack) continue;
    if (now - attacker.lastAttackAt < ATTACK_COOLDOWN_MS) continue;

    const hitbox = attackHitboxRect(attacker);
    const delta = attacker.hitScore;
    for (const targetId of Object.keys(players)) {
      if (targetId === id) continue;
      const target = players[targetId];
      if (!target.connected) continue;
      if (circleRectOverlap(target.x, target.y, CHARACTER_RADIUS, hitbox.x, hitbox.y, hitbox.width, hitbox.height)) {
        players[targetId] = { ...target, score: Math.max(0, target.score - delta) };
        players[id] = { ...players[id], score: players[id].score + delta };
      }
    }
    players[id] = { ...players[id], lastAttackAt: now };
  }

  // 탈락이 없으므로 승패는 원칙적으로 제한시간 종료 시점에만 갈린다 — 다만 참가자가 0~1명이면
  // (관리자가 아무도/한 명만 완료 안 한 상태에서 강제로 battle 단계로 넘긴 경우) 제한시간을
  // 다 채울 이유가 없으므로 그 즉시 종료한다(Opus 리뷰 Important I3).
  const allPlayers = Object.values(players);
  let winners = null;
  let status = room.status;
  if (allPlayers.length <= 1) {
    winners = allPlayers.map((p) => p.id);
    status = 'ended';
  } else if (now >= room.endsAt) {
    const maxScore = Math.max(...allPlayers.map((p) => p.score));
    winners = allPlayers.filter((p) => p.score === maxScore).map((p) => p.id);
    status = 'ended';
  }
  return { room: { ...room, players, status }, winners };
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `node backend/lib/battleSimulation.test.mjs`
Expected: 모든 `console.log(...: OK)` 라인이 출력되고 `battleSimulation.test.mjs: OK`로 끝나며 에러 없이 종료(exit code 0).

- [ ] **Step 5: 커밋**

```bash
git add backend/lib/battleSimulation.js backend/lib/battleSimulation.test.mjs
git commit -m "feat: 대전 이동/조준/공격을 연속 벡터 기반 듀얼스틱 로직으로 재작성"
```

---

### Task 2: `backend/socket/battle.js` — 입력 스키마 변경 + `battle:attack` 이벤트

**Files:**
- Modify: `backend/socket/battle.js`
- Test: `backend/socket/battleIntegration.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `stepSimulation(room, now)`(입력 shape `{moveX,moveY,aimX,aimY}`, player shape에 `aimX/aimY/attackRequested` 필요), `hitScoreFromWeaponDamage`(변경 없음).
- Produces: `startBattleRoom(io, participants, {onEnd})`(시그니처 변경 없음)이 만드는 player가 이제 `aimX: 0, aimY: 1, attackRequested: false, input: {moveX:0,moveY:0,aimX:0,aimY:0}`을 갖는다(`facing`/`input.attack` 없음). 소켓 이벤트 `battle:input`의 payload가 `{moveX,moveY,aimX,aimY}`로 바뀌고, 새 이벤트 `battle:attack`(payload 없음)이 추가된다 — Task 3/4의 프론트엔드가 이 두 이벤트를 emit한다.

- [ ] **Step 1: 기존 통합테스트에서 새 shape를 요구하도록 수정(RED)**

`backend/socket/battleIntegration.test.mjs`에서 아래 블록(현재 파일의 57~79번째 줄 부근, `battle:input` 관련 검증)을 찾아 교체한다:

기존:
```js
  // 정상 입력은 실제로 반영되는지도 같이 확인
  battleHandlers['battle:input']({ right: true });
  assert.strictEqual(getBattleRoom().players.p1.input.right, true);
  battleHandlers['battle:input'](undefined);
  assert.strictEqual(getBattleRoom().players.p1.input.right, false, 'undefined는 전부 false로 취급');
```

새로 교체:
```js
  // 정상 입력은 실제로 반영되는지도 같이 확인
  battleHandlers['battle:input']({ moveX: 1, moveY: 0, aimX: 1, aimY: 0 });
  assert.strictEqual(getBattleRoom().players.p1.input.moveX, 1);
  assert.strictEqual(getBattleRoom().players.p1.input.aimX, 1);
  battleHandlers['battle:input'](undefined);
  assert.strictEqual(getBattleRoom().players.p1.input.moveX, 0, 'undefined는 전부 0으로 취급');

  // battle:attack — 1회성 공격 요청. 페이로드 없이 emit되고 attackRequested만 세팅한다.
  assert.strictEqual(getBattleRoom().players.p1.attackRequested, false, '초기값은 false');
  battleHandlers['battle:attack']();
  assert.strictEqual(getBattleRoom().players.p1.attackRequested, true, 'battle:attack 수신 시 attackRequested가 true로 세팅됨');
  console.log('battle:attack sets attackRequested: OK');
```

(이 파일의 나머지 부분 — `create:done` 초기화, `disconnect`, 라운드 종료/결과저장 검증 블록들은 이번 태스크와 무관하므로 그대로 둔다.)

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node backend/socket/battleIntegration.test.mjs`
Expected: FAIL — `battleHandlers['battle:attack']`가 `undefined`라 `TypeError: battleHandlers['battle:attack'] is not a function`, 또는 `input.moveX`가 없어서(현재 핸들러가 `up/down/left/right/attack`만 저장) 관련 assert 실패.

- [ ] **Step 3: `battle.js` 구현 수정(GREEN)**

`backend/socket/battle.js`에서 `startBattleRoom`의 player 초기화 블록(현재 `characterId: CHARACTER_IDS[...]`부터 `input: { up: false, ... }`까지)을 찾아 교체한다:

기존:
```js
    players[participant.id] = {
      id: participant.id,
      characterId: CHARACTER_IDS[i % CHARACTER_IDS.length],
      x: spawn.x,
      y: spawn.y,
      facing: 'down',
      score: 0,
      hitScore: hitScoreFromWeaponDamage(participant.weapon?.damage),
      weaponParts: participant.weapon?.parts ?? [],
      connected: true,
      lastAttackAt: 0,
      input: { up: false, down: false, left: false, right: false, attack: false },
    };
```

새로 교체:
```js
    players[participant.id] = {
      id: participant.id,
      characterId: CHARACTER_IDS[i % CHARACTER_IDS.length],
      x: spawn.x,
      y: spawn.y,
      // 기본 조준 방향(아래쪽) — 기존 facing:'down' 기본값과 같은 의미.
      aimX: 0,
      aimY: 1,
      score: 0,
      hitScore: hitScoreFromWeaponDamage(participant.weapon?.damage),
      weaponParts: participant.weapon?.parts ?? [],
      connected: true,
      lastAttackAt: 0,
      attackRequested: false,
      input: { moveX: 0, moveY: 0, aimX: 0, aimY: 0 },
    };
```

같은 파일의 `registerBattleHandlers` 함수 전체를 교체한다:

기존:
```js
export function registerBattleHandlers(io, socket) {
  socket.on('battle:input', (input) => {
    if (!battleRoom || !battleRoom.players[socket.id]) return;
    // input이 아예 안 왔거나(undefined/null) 이상한 값이어도 크래시하지 않게 방어.
    const src = input ?? {};
    battleRoom.players[socket.id].input = {
      up: !!src.up,
      down: !!src.down,
      left: !!src.left,
      right: !!src.right,
      attack: !!src.attack,
    };
  });

  // 대전 중 연결이 끊긴 참가자는 더 이상 조작할 수 없는 상태로 처리 — 이동/공격 대상에서
  // 제외되지만(stepSimulation의 connected 체크), 점수는 그대로 유지되어 최종 판정에 포함된다.
  socket.on('disconnect', () => {
    if (battleRoom && battleRoom.players[socket.id]) {
      battleRoom.players[socket.id] = { ...battleRoom.players[socket.id], connected: false };
    }
  });
}
```

새로 교체:
```js
export function registerBattleHandlers(io, socket) {
  socket.on('battle:input', (input) => {
    if (!battleRoom || !battleRoom.players[socket.id]) return;
    // input이 아예 안 왔거나(undefined/null) 이상한 값/타입이 섞여 있어도 크래시하지 않게 방어.
    const src = input ?? {};
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    battleRoom.players[socket.id].input = {
      moveX: num(src.moveX),
      moveY: num(src.moveY),
      aimX: num(src.aimX),
      aimY: num(src.aimY),
    };
  });

  // 공격은 더 이상 "누르고 있는 상태"가 아니라 1회성 요청이다 — PC는 마우스 클릭, 모바일은
  // 조준 스틱을 놓는 순간 한 번만 emit된다(조작방식 재설계 스펙 참고). stepSimulation이 다음
  // 틱에서 이 요청을 소비한다.
  socket.on('battle:attack', () => {
    if (!battleRoom || !battleRoom.players[socket.id]) return;
    battleRoom.players[socket.id].attackRequested = true;
  });

  // 대전 중 연결이 끊긴 참가자는 더 이상 조작할 수 없는 상태로 처리 — 이동/공격 대상에서
  // 제외되지만(stepSimulation의 connected 체크), 점수는 그대로 유지되어 최종 판정에 포함된다.
  socket.on('disconnect', () => {
    if (battleRoom && battleRoom.players[socket.id]) {
      battleRoom.players[socket.id] = { ...battleRoom.players[socket.id], connected: false };
    }
  });
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `node backend/socket/battleIntegration.test.mjs`
Expected: 모든 `console.log(...: OK)` 라인이 출력되고 `battleIntegration.test.mjs: OK`로 끝난다.

- [ ] **Step 5: 전체 백엔드 회귀 테스트**

Run:
```bash
for f in shapes/*.test.mjs backend/lib/*.test.mjs backend/routes/*.test.mjs backend/socket/*.test.mjs; do node "$f" || echo "FAILED: $f"; done
```
Expected: `FAILED:` 줄이 하나도 안 나와야 한다(다른 대전 관련 테스트나 `resultStorage.test.mjs` 등이 이번 변경으로 깨지지 않았는지 확인).

- [ ] **Step 6: 커밋**

```bash
git add backend/socket/battle.js backend/socket/battleIntegration.test.mjs
git commit -m "feat: battle:input을 연속 벡터로, 공격을 battle:attack 1회성 이벤트로 분리"
```

---

### Task 3: `VirtualJoystick` 컴포넌트 (프론트엔드)

**Files:**
- Create: `frontend/src/screens/VirtualJoystick.js`
- Modify: `frontend/src/screens/battle.css`

**Interfaces:**
- Consumes: 없음(순수 UI 컴포넌트, socket이나 게임 상태를 모른다).
- Produces: `VirtualJoystick({ radius, onChange, onRelease, className })` — Preact 컴포넌트. `onChange({x, y})`를 드래그 중 계속 호출(x/y는 -1~1로 clamp된 값, 손을 떼면 `{x:0, y:0}`으로 마지막 호출). `onRelease()`는 손을 뗄 때(pointerup/leave/cancel) 한 번 호출(선택적, 조준 스틱만 씀). Task 4가 이 컴포넌트를 `import { VirtualJoystick } from './VirtualJoystick.js'`로 가져다 쓴다.

이 컴포넌트는 Konva/서버 상태와 무관한 순수 DOM 드래그 UI라, 이 프로젝트에 자동화된 프론트엔드 단위테스트 도구가 없다는 기존 관례(spec의 "테스트 범위" 참고)에 따라 자동 테스트 없이 문법 검증 + 다음 태스크의 라이브 검증으로 확인한다.

- [ ] **Step 1: 컴포넌트 작성**

`frontend/src/screens/VirtualJoystick.js`를 새로 만든다:

```js
import { h } from 'preact';
import { useRef } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

// 스틱 중심에서 이만큼(px) 벗어나면 벡터 길이가 1로 clamp된다.
const DEFAULT_RADIUS = 40;

// 터치/마우스 드래그로 -1~1 범위의 2D 벡터를 만들어내는 가상 스틱. 이동 스틱과 조준
// 스틱 양쪽에서 재사용한다(브롤스타즈 스타일 듀얼스틱, 2026-08-06 조작방식 재설계 스펙) —
// 조준 스틱은 onRelease로 "손을 뗀 순간"을 추가로 받아 battle.js가 그 시점에 공격을
// 트리거하는 데 쓴다.
export function VirtualJoystick({ radius = DEFAULT_RADIUS, onChange, onRelease, className = '' }) {
  const baseRef = useRef(null);
  const knobRef = useRef(null);
  const draggingRef = useRef(false);

  function updateFromClientPos(clientX, clientY) {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let x = (clientX - cx) / radius;
    let y = (clientY - cy) / radius;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
    }
    onChange({ x, y });
  }

  function onPointerDown(e) {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientPos(e.clientX, e.clientY);
  }
  function onPointerMove(e) {
    if (!draggingRef.current) return;
    updateFromClientPos(e.clientX, e.clientY);
  }
  // pointerup뿐 아니라 pointerleave/pointercancel에서도 같은 방식으로 손 뗌 처리 —
  // 터치 중 손가락이 스틱 밖으로 미끄러지면 pointerup이 아니라 그쪽 이벤트가 발생한다
  // (기존 D-pad 버튼의 releaseOn과 같은 이유).
  function onPointerUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
    onChange({ x: 0, y: 0 });
    if (onRelease) onRelease();
  }

  return html`
    <div
      class="joystick-base ${className}"
      ref=${baseRef}
      onPointerDown=${onPointerDown}
      onPointerMove=${onPointerMove}
      onPointerUp=${onPointerUp}
      onPointerLeave=${onPointerUp}
      onPointerCancel=${onPointerUp}
    >
      <div class="joystick-knob" ref=${knobRef}></div>
    </div>
  `;
}
```

- [ ] **Step 2: 문법 검증**

Run: `node --check frontend/src/screens/VirtualJoystick.js`
Expected: 아무 출력 없이 종료(exit code 0) — 이 프로젝트는 빌드 스텝이 없고 브라우저가 importmap으로 esm.sh CDN에서 `preact`/`htm`을 직접 로드하므로(`frontend/index.html`), `node --check`는 import 해석 없이 순수 문법만 확인한다.

- [ ] **Step 3: CSS 교체**

`frontend/src/screens/battle.css`를 아래 내용으로 완전히 교체한다(기존 `.dpad`/`.attack-button` 관련 규칙을 조이스틱 규칙으로 바꾼다):

```css
.battle-shell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.battle-arena {
  width: 800px;
  height: 600px;
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

.battle-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 800px;
}

.joystick-base {
  position: relative;
  width: 6rem;
  height: 6rem;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.25);
  touch-action: none;
}

.joystick-base.aim {
  background: rgba(192, 57, 43, 0.12);
  border-color: rgba(192, 57, 43, 0.4);
}

.joystick-knob {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2.5rem;
  height: 2.5rem;
  margin: -1.25rem;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.6);
  pointer-events: none;
}

.joystick-base.aim .joystick-knob {
  background: #c0392b;
}
```

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/screens/VirtualJoystick.js frontend/src/screens/battle.css
git commit -m "feat: 듀얼스틱용 VirtualJoystick 컴포넌트와 스타일 추가"
```

---

### Task 4: `battle.js`(프론트엔드) — 듀얼스틱 통합 + 키보드/마우스 지원

**Files:**
- Modify: `frontend/src/screens/battle.js`

**Interfaces:**
- Consumes: Task 3의 `VirtualJoystick({radius, onChange, onRelease, className})`. Task 2의 소켓 이벤트 계약 — `battle:input` payload `{moveX,moveY,aimX,aimY}`, `battle:attack`(payload 없음). `battle:state`로 오는 각 player 객체는 이제 `aimX`/`aimY`(number)를 갖고 `facing`은 없다.
- Produces: 없음(화면 최상위 컴포넌트).

이 태스크도 Task 3과 같은 이유로 자동화된 프론트엔드 테스트가 없다 — 문법 검증 후, 계획 실행이 끝나면 실제 브라우저(Playwright 등)로 라이브 검증하는 것을 권장한다(이 프로젝트에서 지금까지 거쳐온 방식과 동일).

- [ ] **Step 1: `battle.js` 전체 교체**

`frontend/src/screens/battle.js`를 아래 내용으로 완전히 교체한다:

```js
import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import Konva from 'konva';
import { drawWeaponGroup } from '../../../shapes/weaponRenderer.js';
import { VirtualJoystick } from './VirtualJoystick.js';

const html = htm.bind(h);

const ARENA_SIZE = { width: 800, height: 600 };
const CHARACTER_RADIUS = 20;
// CHARACTER_RADIUS(20)과 똑같이 하면 시에르핀스키/코흐눈꽃처럼 점이 많은 프랙탈은 뭉개져서
// 거의 안 보인다(Opus 리뷰에서 실측: 20px 아이콘에 43픽셀만 칠해짐) — 조금 더 키운다.
const WEAPON_ICON_SIZE = 28;
const CHARACTER_COLORS = {
  char1: '#e74c3c', char2: '#3498db', char3: '#2ecc71',
  char4: '#f1c40f', char5: '#9b59b6', char6: '#e67e22',
  char7: '#1abc9c', char8: '#34495e',
};
// battle:input을 보낼지 말지 판단하는 임계값 — 연속값(moveX/moveY/aimX/aimY)은 불리언처럼
// 정확히 같은지 비교할 수 없어서, 이 값보다 작게 변하면 "그대로"로 본다(마우스 좌표가 1px만
// 흔들려도 매 프레임 emit되는 걸 방지).
const INPUT_EPSILON = 0.02;

// 실시간 대전 화면. docs/초안.md 7-③, 2026-08-06 배틀로얄 점수제/조작방식 재설계 문서 참고.
export function BattleScreen({ socket, state }) {
  const containerRef = useRef(null);
  const layerRef = useRef(null);
  const stageRef = useRef(null);
  const nodesRef = useRef({});
  // PC 마우스 조준을 계산하려면 "내 캐릭터가 화면에서 어디 있는지"가 필요한데, battle:state로만
  // 갱신되는 서버 진실이라 여기 별도로 캐시해둔다(마우스 이벤트는 그 사이 계속 발생하므로).
  const selfPosRef = useRef({ x: ARENA_SIZE.width / 2, y: ARENA_SIZE.height / 2 });

  useEffect(() => {
    const stage = new Konva.Stage({
      container: containerRef.current,
      width: ARENA_SIZE.width,
      height: ARENA_SIZE.height,
    });
    const layer = new Konva.Layer();
    stage.add(layer);
    layerRef.current = layer;
    stageRef.current = stage;
    return () => stage.destroy();
  }, []);

  useEffect(() => {
    function onState(room) {
      const layer = layerRef.current;
      if (!layer) return;

      if (layer.find('.wall').length === 0) {
        room.walls.forEach((w) => {
          layer.add(new Konva.Rect({ x: w.x, y: w.y, width: w.width, height: w.height, fill: '#555', name: 'wall' }));
        });
      }

      Object.values(room.players).forEach((p) => {
        if (p.id === socket.id) {
          selfPosRef.current = { x: p.x, y: p.y };
        }
        let entry = nodesRef.current[p.id];
        if (!entry) {
          const isSelf = p.id === socket.id;
          const circle = new Konva.Circle({
            x: p.x, y: p.y, radius: CHARACTER_RADIUS,
            fill: CHARACTER_COLORS[p.characterId] ?? '#999',
            // 본인 캐릭터는 흰 테두리로 구분 — 다섯 명이 같은 화면에 있으면 어느 게 내 것인지
            // 색만으로는 구별하기 어려워서(설계 리뷰에서 지적됨).
            stroke: isSelf ? '#ffffff' : undefined,
            strokeWidth: isSelf ? 3 : 0,
          });
          // 탈락이 없는 점수제라 체력바 대신 현재 누적 점수를 숫자로 보여준다. moveOne이
          // 캐릭터를 y=CHARACTER_RADIUS까지 위로 붙게 허용하므로, 라벨을 그 위 18px에 그대로
          // 두면 위쪽 벽 근처에서 stage 밖(y<0)으로 잘려나간다 — 0으로 clamp(Opus 리뷰 Important I2).
          const scoreLabel = new Konva.Text({
            x: p.x - CHARACTER_RADIUS, y: Math.max(0, p.y - CHARACTER_RADIUS - 18),
            width: CHARACTER_RADIUS * 2,
            text: String(p.score ?? 0),
            fontSize: 12, fontStyle: 'bold', fill: '#fff', align: 'center',
          });
          const label = new Konva.Text({
            x: p.x - CHARACTER_RADIUS, y: p.y - 7,
            width: CHARACTER_RADIUS * 2,
            text: (p.characterId ?? '').replace('char', ''),
            fontSize: 14, fontStyle: 'bold', fill: '#fff', align: 'center',
          });
          // 참가자가 제작 화면에서 만든 무기를 작게 그려서 캐릭터 옆에 붙인다 — 무기는 대전 중
          // 안 바뀌므로(제작 단계에서 확정) 여기서 한 번만 그리고 이후엔 위치/회전만 옮긴다.
          const weaponGroup = drawWeaponGroup(Konva, p.weaponParts, { targetSize: WEAPON_ICON_SIZE });
          layer.add(circle);
          layer.add(scoreLabel);
          layer.add(label);
          layer.add(weaponGroup);
          entry = { circle, scoreLabel, label, weaponGroup };
          nodesRef.current[p.id] = entry;
        }
        // p.connected가 없는(구버전 상태 등 예상 밖) 프레임이 와도 전원이 흐려지지 않도록
        // 명시적으로 false일 때만 흐리게 — p.score ?? 0과 같은 방어 원칙(Opus 리뷰 Minor M2).
        const isConnected = p.connected !== false;
        entry.circle.x(p.x);
        entry.circle.y(p.y);
        // 탈락이 없으므로 이 흐림 처리는 "죽음"이 아니라 "연결 끊김"만 의미한다.
        entry.circle.opacity(isConnected ? 1 : 0.2);
        entry.scoreLabel.x(p.x - CHARACTER_RADIUS);
        entry.scoreLabel.y(Math.max(0, p.y - CHARACTER_RADIUS - 18));
        entry.scoreLabel.text(String(p.score ?? 0));
        entry.scoreLabel.opacity(isConnected ? 1 : 0.2);
        entry.label.x(p.x - CHARACTER_RADIUS);
        entry.label.y(p.y - 7);
        entry.label.opacity(isConnected ? 1 : 0.2);

        // 무기 아이콘 위치/방향 — 조준 벡터(aimX/aimY)를 기준으로 캐릭터 중심에서 연속적으로
        // 오프셋되고, 그 각도만큼 회전한다(예전 4방향 스냅 대신 브롤스타즈처럼 자유 조준).
        // 벽 근처에서 아이콘이 화면 밖으로 잘리지 않게 아레나 범위 안으로 clamp —
        // dragBoundFunc(CanvasEditor.js)/moveOne(battleSimulation.js)과 같은 패턴.
        const aimX = p.aimX ?? 0;
        const aimY = p.aimY ?? 1;
        const WEAPON_OFFSET = CHARACTER_RADIUS;
        entry.weaponGroup.x(Math.min(ARENA_SIZE.width, Math.max(0, p.x + aimX * WEAPON_OFFSET)));
        entry.weaponGroup.y(Math.min(ARENA_SIZE.height, Math.max(0, p.y + aimY * WEAPON_OFFSET)));
        entry.weaponGroup.rotation((Math.atan2(aimY, aimX) * 180) / Math.PI);
        entry.weaponGroup.opacity(isConnected ? 1 : 0.2);
      });

      layer.draw();
    }
    socket.on('battle:state', onState);
    return () => socket.off('battle:state', onState);
  }, [socket]);

  useEffect(() => {
    function onResult({ win }) {
      state.battleResult = win ? 'win' : 'lose';
    }
    socket.on('battle:result', onResult);
    return () => socket.off('battle:result', onResult);
  }, [socket, state]);

  const inputRef = useRef({ moveX: 0, moveY: 0, aimX: 0, aimY: 0 });
  const keysRef = useRef({ up: false, down: false, left: false, right: false });

  function sendInput(patch) {
    const next = { ...inputRef.current, ...patch };
    // 값이 임계값(INPUT_EPSILON) 이상 실제로 바뀔 때만 전송 — 마우스 이동처럼 아주 잦은
    // 이벤트가 매번 소켓으로 나가지 않게 한다(불리언 시절의 "값이 바뀔 때만 전송"과 같은
    // 원칙을 연속값에 맞게 확장).
    const changed = Object.keys(patch).some(
      (key) => Math.abs(inputRef.current[key] - next[key]) > INPUT_EPSILON,
    );
    if (!changed) return;
    inputRef.current = next;
    socket.emit('battle:input', inputRef.current);
  }

  // 키보드 이동 — WASD/화살표 둘 다 지원. 눌린 키 조합을 방향벡터로 합친 뒤 정규화해서
  // 보낸다(대각선 입력이 √2배 빨라지지 않게). 조준은 마우스가 담당하므로 여기서는 안 건드림.
  function updateMoveFromKeys() {
    const { up, down, left, right } = keysRef.current;
    let x = (right ? 1 : 0) - (left ? 1 : 0);
    let y = (down ? 1 : 0) - (up ? 1 : 0);
    const len = Math.hypot(x, y);
    if (len > 0) {
      x /= len;
      y /= len;
    }
    sendInput({ moveX: x, moveY: y });
  }

  useEffect(() => {
    function keyToDirection(key) {
      if (key === 'ArrowUp' || key === 'w' || key === 'W') return 'up';
      if (key === 'ArrowDown' || key === 's' || key === 'S') return 'down';
      if (key === 'ArrowLeft' || key === 'a' || key === 'A') return 'left';
      if (key === 'ArrowRight' || key === 'd' || key === 'D') return 'right';
      return null;
    }
    function onKeyDown(e) {
      const dir = keyToDirection(e.key);
      if (!dir) return;
      e.preventDefault(); // 방향키/WASD로 페이지가 스크롤/타이핑되는 것 방지
      if (e.repeat) return; // OS 키 반복은 무시
      keysRef.current = { ...keysRef.current, [dir]: true };
      updateMoveFromKeys();
    }
    function onKeyUp(e) {
      const dir = keyToDirection(e.key);
      if (!dir) return;
      e.preventDefault();
      keysRef.current = { ...keysRef.current, [dir]: false };
      updateMoveFromKeys();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // PC 조준 — 아레나 위 마우스 위치와 내 캐릭터 위치(selfPosRef, battle:state로 갱신됨)의
  // 차이를 방향벡터로 보낸다. mousedown(누르는 순간)은 그 시점의 조준 방향으로 공격을 1회
  // 발사한다 — 누르고 있어도 추가로 발사되지 않는다(쿨다운마다 다시 클릭해야 함).
  useEffect(() => {
    function onMouseMove(e) {
      const stage = stageRef.current;
      if (!stage) return;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const { x: sx, y: sy } = selfPosRef.current;
      const dx = pointer.x - sx;
      const dy = pointer.y - sy;
      const len = Math.hypot(dx, dy);
      if (len < 1) return; // 캐릭터 위치와 거의 겹치면(1px 미만) 조준을 갱신하지 않음
      sendInput({ aimX: dx / len, aimY: dy / len });
    }
    function onMouseDown() {
      socket.emit('battle:attack');
    }
    const el = containerRef.current;
    el?.addEventListener('mousemove', onMouseMove);
    el?.addEventListener('mousedown', onMouseDown);
    return () => {
      el?.removeEventListener('mousemove', onMouseMove);
      el?.removeEventListener('mousedown', onMouseDown);
    };
  }, [socket]);

  function onMoveStick({ x, y }) {
    sendInput({ moveX: x, moveY: y });
  }
  function onAimStick({ x, y }) {
    // 스틱이 중앙 근처(길이 거의 0)면 조준을 보내지 않는다 — 서버의 데드존과 같은 이유로,
    // 손을 떼는 순간 조준이 (0,0)으로 무너져 공격 위치가 캐릭터 자기 자신으로 붕괴하는 것 방지.
    if (Math.hypot(x, y) < 0.05) return;
    sendInput({ aimX: x, aimY: y });
  }
  function onAimRelease() {
    socket.emit('battle:attack');
  }

  return html`
    <div class="battle-shell">
      <div class="battle-arena" ref=${containerRef}></div>
      <div class="battle-controls">
        <${VirtualJoystick} onChange=${onMoveStick} />
        <${VirtualJoystick} onChange=${onAimStick} onRelease=${onAimRelease} className="aim" />
      </div>
    </div>
  `;
}
```

- [ ] **Step 2: 문법 검증**

Run: `node --check frontend/src/screens/battle.js`
Expected: 아무 출력 없이 종료(exit code 0).

- [ ] **Step 3: 전체 백엔드 회귀 테스트(프론트 변경이 백엔드 계약을 깨지 않았는지 재확인)**

Run:
```bash
for f in shapes/*.test.mjs backend/lib/*.test.mjs backend/routes/*.test.mjs backend/socket/*.test.mjs; do node "$f" || echo "FAILED: $f"; done
```
Expected: `FAILED:` 줄이 하나도 없어야 한다.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/screens/battle.js
git commit -m "feat: 대전 화면에 듀얼스틱/키보드+마우스 조작 통합"
```

---

## 구현 후 최종 리뷰(Opus) 반영 사항

Opus 모델로 전체 브랜치 diff를 최종 리뷰한 결과, 다음 이슈가 발견되어 모두 수정했다(커밋: `fix: opus 리뷰에서 발견된 Critical/Important 이슈 수정`):

- **Important I1**: `.battle-controls { width: 800px }`가 부스 태블릿/폰 같은 좁은 뷰포트에서 이동 조이스틱을 화면 밖(음수 좌표)으로 밀어내 손이 안 닿는 상태를 만들었다 — 실제 브라우저 측정으로 확인된 회귀. `width: min(800px, 100vw - 3rem)`로 수정.
- **Important I2**: PC 조준(`updateAimFromPointer`, 옛 `onMouseMove`)이 `mousemove` 이벤트에서만 갱신돼서, 마우스를 가만히 두고 WASD로만 이동하면 조준이 마지막 마우스 위치 기준으로 멈춰버렸다 — 이 기능의 핵심(이동/조준 분리)이 무너지는 문제. `battle:state` 갱신(내 캐릭터 위치가 바뀔 때)에서도 같은 함수를 호출하도록 수정.
- **Important I3**: `applyAim`이 `Number.MAX_VALUE`급 입력처럼 `Math.hypot`이 `Infinity`로 오버플로하는 케이스를 걸러내지 못해 `x/len, y/len`이 둘 다 `0`이 되고, 그 상태가 영구 저장되어 히트박스가 캐릭터 중심에 고정된 채 전방위로 맞는 취약점이 됐다. `Number.isFinite(len)` 체크 추가.
- **Important I4**: `VirtualJoystick`이 `pointerId`를 추적하지 않아 두 번째 손가락이 스틱에 닿으면 조작권이 넘어가고, 첫 손가락을 떼는 순간 스틱이 리셋되며(조준 스틱의 경우 `battle:attack`까지 오발동) 남은 손가락 입력이 무시됐다. `activeIdRef`로 조작 중인 손가락 하나만 추적하도록 수정.
- **Important I5**: 모바일 조준 스틱(`onAimStick`)이 정규화 안 된 벡터를 그대로 보내서, 살짝 민 입력일수록(길이가 짧을수록) `INPUT_EPSILON` 임계값을 넘기기 위한 실제 각도 변화폭이 커져 조준 해상도가 나빠졌다(실측: 풀로 밀면 1.25°, 살짝 밀면 23.75°). PC 마우스 조준과 동일하게 단위벡터로 정규화해서 전송하도록 수정.
- **Minor(반영)**: `normalizeIfLong`/`moveOne`에 NaN/Infinity·`player.input` 누락 방어 추가(소켓 레이어의 `num()` 가드와의 이중 방어), `attackHitboxRect`에 `aimX/aimY` 기본값 추가, PC 공격이 우클릭에도 발동하던 것을 좌클릭(`e.button === 0`)으로 제한, `VirtualJoystick`의 `setPointerCapture` 실패 시 입력 유실 방지(`try/catch`).
- **보류(수정 안 함)**: 무기 아이콘 오프셋의 아레나 clamp가 현재 상수값 조합상 항상 no-op이라는 지적(Minor) — 맵이 넓어지거나 오프셋 상수가 커지면 실제로 동작할 방어 코드라 그대로 둠. 터치+키보드 동시 사용 시 스틱을 떼면 키보드 이동이 순간 끊기는 문제(Minor) — 이 부스 환경에서 한 기기가 터치와 키보드를 동시에 쓸 일이 사실상 없어 보류.

## Self-Review 메모 (계획 작성자 기록)

- **스펙 커버리지**: 데이터 모델 변경(Task 1,2) / 이동·조준·공격 로직(Task 1) / 프론트엔드 컴포넌트+통합(Task 3,4) / 스코프 제외 항목(계획에 새 맵/캐릭터선택/이펙트 관련 태스크 없음, Global Constraints에 명시) / 테스트 범위(각 태스크의 Step 1~4가 스펙의 "테스트 범위" 섹션과 1:1 대응) — 스펙의 모든 섹션이 태스크로 커버됨.
- **타입/이름 일관성**: `input.{moveX,moveY,aimX,aimY}`, `player.{aimX,aimY,attackRequested}`, 이벤트명 `battle:input`/`battle:attack`을 Task 1~4 전체에서 동일하게 사용(교차 확인 완료).
- **라이브 검증**: 이 계획은 코드 구현까지만 다룬다. 실행 완료 후 사용자가 요청하면 Opus 최종 리뷰 + Playwright 라이브 검증(이 프로젝트의 기존 관례)을 별도로 진행한다.
