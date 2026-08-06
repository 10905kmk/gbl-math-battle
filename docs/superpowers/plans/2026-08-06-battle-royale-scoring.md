# 배틀로얄 점수제 전투 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대전 시스템을 HP=100/사망 기반에서 탈락 없는 누적 점수제로 바꾼다 — 맞히면 점수를 얻고 맞으면 점수를 잃되(0 밑으로는 안 내려감), 제한시간(90초) 종료 시점 최고 점수 참가자(들)가 승리한다.

**Architecture:** `backend/lib/battleSimulation.js`의 순수 함수 `stepSimulation`이 `player.hp`/`player.alive`를 `player.score`/`player.connected`로 바꾸고, 승리 판정을 "생존자 1명 이하" 분기 없이 "제한시간 종료 시 최고 점수"로 단순화한다. 이 변경이 `backend/socket/battle.js`(필드 초기화, 라운드 종료 콜백에 점수 스냅샷 전달) → `backend/socket/session.js`(그 점수를 결과 저장에 전달) → `backend/lib/resultStorage.js`(DB에 점수 저장) → `frontend/src/screens/battle.js`(HP 바 대신 점수 표시)로 이어진다.

**Tech Stack:** Node.js(ES modules) 백엔드, Preact + htm 프론트엔드(빌드 도구 없음). 테스트는 `node:assert` 기반 `.mjs` 스크립트.

## Global Constraints

- 한 대 맞았을 때 점수 변동량: `round(공격자.weaponDamage × 0.05)` — 상수명 `HIT_SCORE_COEFFICIENT = 0.05`.
- 점수는 0 밑으로 내려가지 않는다. 상한은 없다.
- 승패는 오직 제한시간(`room.endsAt`) 종료 시점에만 갈린다 — 탈락으로 인한 조기 종료는 없다.
- 동점이면 그 점수를 가진 참가자 전원이 공동 승리.
- 연결이 끊긴 참가자(`connected: false`)는 공격 대상에서 제외되지만, 자기 점수는 그대로 유지한 채 최종 승패 판정에는 포함된다(죽는 개념이 없으므로).
- 맵(브롤스타즈 스타일 이미지/장애물 배치)은 이번 스코프 아님 — 기존 `DEFAULT_MAP.walls`(단순 사각형 벽 3개)를 그대로 쓴다.
- 이동/공격 히트박스/쿨다운(`MOVE_SPEED`, `ATTACK_HITBOX_SIZE`, `ATTACK_COOLDOWN_MS`)은 그대로 유지.

---

### Task 1: `battleSimulation.js` — 점수제로 재작성

**Files:**
- Modify: `backend/lib/battleSimulation.js` (전체 재작성)
- Test: `backend/lib/battleSimulation.test.mjs` (전체 재작성)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `hitScoreFromWeaponDamage(weaponDamage: unknown): number` — 무기 데미지를 한 대당 점수 변동량으로 변환(숫자가 아니거나 0 이하면 최소치 1로 취급 후 반올림). Task 2가 `battle.js`에서 씀.
  - `stepSimulation(room, now)`에서 다루는 player 객체 필드: `score`(number), `connected`(boolean), `hitScore`(number) — `hp`/`alive`/`hitDamage`는 더 이상 안 씀. Task 2가 이 필드들로 player를 초기화함.
  - `stepSimulation`의 승리 판정: 제한시간 종료 시에만 `winners`가 배열이 됨(그 전엔 항상 `null`).

- [ ] **Step 1: 실패하는 테스트로 전체 재작성**

`backend/lib/battleSimulation.test.mjs` 전체를 아래로 교체한다:

```js
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

// hitScoreFromWeaponDamage 방어: 숫자가 아니거나 0 이하면 최소치(1)로 취급 -> round(1*0.05)=0
assert.strictEqual(hitScoreFromWeaponDamage('abc'), 0, '숫자로 못 바꾸는 문자열');
assert.strictEqual(hitScoreFromWeaponDamage(undefined), 0, 'undefined');
assert.strictEqual(hitScoreFromWeaponDamage(null), 0, 'null');
assert.strictEqual(hitScoreFromWeaponDamage(NaN), 0, 'NaN 직접 입력');
assert.strictEqual(hitScoreFromWeaponDamage(-500), 0, '음수도 최소치(1)로 취급');
console.log('hitScoreFromWeaponDamage guards non-numeric/non-positive input: OK');

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

console.log('battleSimulation.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/lib/battleSimulation.test.mjs`
Expected: `hitScoreFromWeaponDamage`가 아직 export 안 됨 → `SyntaxError: The requested module './battleSimulation.js' does not provide an export named 'hitScoreFromWeaponDamage'`.

- [ ] **Step 3: `battleSimulation.js` 재작성**

`backend/lib/battleSimulation.js` 전체를 아래로 교체한다:

```js
export const ARENA_SIZE = { width: 800, height: 600 };
export const CHARACTER_RADIUS = 20;
export const MOVE_SPEED = 4;
export const HIT_SCORE_COEFFICIENT = 0.05;
export const ATTACK_HITBOX_SIZE = 30;
export const ATTACK_COOLDOWN_MS = 500;
export const BATTLE_DURATION_MS = 90000;

// weaponDamage는 소켓으로 들어오는 클라이언트 제공 값이라 숫자가 아니거나 0 이하일 수도 있다 —
// 검증 없이 곱하면 NaN/음수 점수 변동으로 이어져 사고가 난다. 숫자가 아니거나 0 이하면
// 최소치(1)로 취급한다.
export function hitScoreFromWeaponDamage(weaponDamage) {
  const value = Number(weaponDamage);
  const safeValue = Number.isFinite(value) && value > 0 ? value : 1;
  return Math.round(safeValue * HIT_SCORE_COEFFICIENT);
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

// 입력 방향 우선순위 고정: up > down > left > right. 여러 방향이 동시에 눌려도(대각선 입력 등)
// 하나만 적용 — "마지막으로 누른 방향" 추적은 상태가 필요해 순수 함수 원칙과 안 맞아서 단순화.
function moveOne(player, walls) {
  const { up, down, left, right } = player.input;
  let dx = 0;
  let dy = 0;
  let facing = player.facing;
  if (up) {
    dy = -MOVE_SPEED;
    facing = 'up';
  } else if (down) {
    dy = MOVE_SPEED;
    facing = 'down';
  } else if (left) {
    dx = -MOVE_SPEED;
    facing = 'left';
  } else if (right) {
    dx = MOVE_SPEED;
    facing = 'right';
  }

  let x = clamp(player.x + dx, CHARACTER_RADIUS, ARENA_SIZE.width - CHARACTER_RADIUS);
  let y = clamp(player.y + dy, CHARACTER_RADIUS, ARENA_SIZE.height - CHARACTER_RADIUS);

  if (circleOverlapsAnyWall(x, player.y, CHARACTER_RADIUS, walls)) x = player.x;
  if (circleOverlapsAnyWall(x, y, CHARACTER_RADIUS, walls)) y = player.y;

  return { ...player, x, y, facing };
}

function attackHitboxRect(player) {
  const offset = CHARACTER_RADIUS + ATTACK_HITBOX_SIZE / 2;
  const center = {
    up: { x: player.x, y: player.y - offset },
    down: { x: player.x, y: player.y + offset },
    left: { x: player.x - offset, y: player.y },
    right: { x: player.x + offset, y: player.y },
  }[player.facing];
  return {
    x: center.x - ATTACK_HITBOX_SIZE / 2,
    y: center.y - ATTACK_HITBOX_SIZE / 2,
    width: ATTACK_HITBOX_SIZE,
    height: ATTACK_HITBOX_SIZE,
  };
}

export function stepSimulation(room, now) {
  if (room.status !== 'active') return { room, winners: null };

  const players = {};
  for (const id of Object.keys(room.players)) {
    const p = room.players[id];
    players[id] = p.connected ? moveOne(p, room.walls) : { ...p };
  }

  // 공격 판정 — 참가자 순서(입장 순서)대로 한 명씩 처리, 쿨다운 통과 시 즉시 판정.
  // 맞히면 공격자 점수는 오르고, 맞은 쪽 점수는 내려가되 0 밑으로는 안 내려간다(탈락 없음).
  for (const id of Object.keys(players)) {
    const attacker = players[id];
    if (!attacker.connected) continue;
    if (!attacker.input.attack) continue;
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

  // 탈락이 없으므로 승패는 오직 제한시간 종료 시점에만 갈린다 — 그 전까지는 winners가 항상 null.
  let winners = null;
  let status = room.status;
  if (now >= room.endsAt) {
    const allPlayers = Object.values(players);
    const maxScore = Math.max(...allPlayers.map((p) => p.score));
    winners = allPlayers.filter((p) => p.score === maxScore).map((p) => p.id);
    status = 'ended';
  }

  return { room: { ...room, players, status }, winners };
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/lib/battleSimulation.test.mjs`
Expected: 모든 블록 `OK`, 마지막 `battleSimulation.test.mjs: OK`.

- [ ] **Step 5: 커밋**

```bash
git add backend/lib/battleSimulation.js backend/lib/battleSimulation.test.mjs
git commit -m "feat: 대전을 HP/사망 기반에서 누적 점수제로 재작성"
```

---

### Task 2: `battle.js`(백엔드 소켓) — 필드 초기화 갱신 + 점수 스냅샷 전달

**Files:**
- Modify: `backend/socket/battle.js` (전체 재작성)
- Test: `backend/socket/battleIntegration.test.mjs` (일부 수정)

**Interfaces:**
- Consumes: Task 1의 `hitScoreFromWeaponDamage(weaponDamage)`
- Produces:
  - `startBattleRoom(io, participants, { onEnd })`의 `onEnd` 콜백 시그니처가 `onEnd(winners)`에서 `onEnd(winners, scores)`로 바뀜 — `scores`는 `{ [participantId]: number }`. Task 3의 `session.js`가 이 두 번째 인자를 받아서 씀.
  - `room.players[id]`에 `score`(number)/`connected`(boolean)/`hitScore`(number) 필드 — Task 4의 프론트엔드가 `battle:state`로 받아서 씀.

- [ ] **Step 1: 실패하는 테스트로 기존 테스트 수정**

`backend/socket/battleIntegration.test.mjs`에서 42~43번째 줄을 아래로 바꾼다:

```js
assert.strictEqual(room.players.p1.hitScore, 50, 'damage=1000 -> round(1000*0.05)=50');
assert.strictEqual(room.players.p5.hitScore, 250, 'damage=5000 -> round(5000*0.05)=250');
```

75~78번째 줄("연결이 끊기면 해당 참가자는 죽은 것으로 처리되어야 한다" 블록)을 아래로 바꾼다:

```js
  // 연결이 끊기면 해당 참가자는 조작 불가 상태로 처리되어야 한다(더 이상 "죽는" 개념은 없음).
  battleHandlers['disconnect']();
  assert.strictEqual(getBattleRoom().players.p1.connected, false, '연결 끊긴 참가자는 connected=false');
  console.log('disconnect marks player as not connected: OK');
```

103~108번째 줄(결과 통지 검증 블록)을 아래로 바꾼다 — 이 테스트에서는 아무도 서로 공격하지 않으므로 전원 0점 동점이 되고, 탈락 개념이 없으니 연결이 끊긴 p1도 그 동점 승리에 포함되어야 한다(기존엔 "죽은 p1은 패배"였던 것과 반대 결과이니 주의):

```js
  // p1은 앞서 disconnect 처리돼서 connected=false였지만, 아무도 서로 공격하지 않아 전원 점수가
  // 0으로 동점이다 — 탈락 개념이 없으므로 연결이 끊긴 참가자도 자기 점수 그대로 판정에
  // 포함되어 전원 공동 승리 처리된다(HP 기반 시절엔 반대로 "죽었으니 패배"였다).
  assert.ok(resultsSentTo.p1, 'p1(연결 끊김 처리된 참가자)에게도 battle:result가 전달되어야 함');
  assert.strictEqual(resultsSentTo.p1[0][1].win, true, '연결이 끊겨도 점수는 유지되어 동점 공동 승리에 포함됨');
  assert.ok(resultsSentTo.p2 && resultsSentTo.p2[0][0] === 'battle:result', 'p2에게 battle:result가 전달되어야 함');
  assert.strictEqual(resultsSentTo.p2[0][1].win, true, '아무도 공격하지 않아 전원 0점 동점으로 전원 승리 처리');
  console.log('battle end -> stage change to result: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/socket/battleIntegration.test.mjs`
Expected: `room.players.p1.hitScore`가 `undefined`라서 첫 번째 새 assert(`assert.strictEqual(undefined, 50, ...)`)에서 실패.

- [ ] **Step 3: `battle.js` 재작성**

`backend/socket/battle.js` 전체를 아래로 교체한다:

```js
import { stepSimulation, hitScoreFromWeaponDamage, BATTLE_DURATION_MS } from '../lib/battleSimulation.js';
import { DEFAULT_MAP, SPAWN_POINTS } from '../lib/battleMap.js';

const CHARACTER_IDS = ['char1', 'char2', 'char3', 'char4', 'char5', 'char6', 'char7', 'char8'];
const TICK_MS = 50;

let battleRoom = null;
let tickInterval = null;

export function getBattleRoom() {
  return battleRoom;
}

// 진행 중인 대전이 있으면 정지시키고 상태를 완전히 비운다 — 멈추기만 하고 battleRoom을 그대로
// 두면, 이미 끊긴 상태인데도 getBattleRoom()이 "진행 중"으로 보이거나 오래된 소켓의
// battle:input이 계속 그 데이터를 건드릴 수 있다.
export function stopBattleRoom() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  battleRoom = null;
}

// participants: [{ id, weapon: { damage, ... } }, ...] — session.js의 cohort.participants
export function startBattleRoom(io, participants, { onEnd } = {}) {
  stopBattleRoom();

  const players = {};
  participants.forEach((participant, i) => {
    const spawn = SPAWN_POINTS[i % SPAWN_POINTS.length];
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
  });

  battleRoom = {
    status: 'active',
    endsAt: Date.now() + BATTLE_DURATION_MS,
    players,
    walls: DEFAULT_MAP.walls,
  };

  tickInterval = setInterval(() => {
    const { room, winners } = stepSimulation(battleRoom, Date.now());
    battleRoom = room;
    io.emit('battle:state', battleRoom);

    if (winners !== null) {
      // stopBattleRoom()이 battleRoom을 null로 비우기 전에, 결과를 보낼 대상 목록과 최종
      // 점수 스냅샷을 먼저 뽑아둔다 — session.js가 결과 저장에 점수를 함께 쓴다.
      const endedRoom = battleRoom;
      const scores = {};
      for (const id of Object.keys(endedRoom.players)) {
        scores[id] = endedRoom.players[id].score;
      }
      stopBattleRoom();
      for (const id of Object.keys(endedRoom.players)) {
        io.to(id).emit('battle:result', { win: winners.includes(id) });
      }
      if (onEnd) onEnd(winners, scores);
    }
  }, TICK_MS);
}

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

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/socket/battleIntegration.test.mjs`
Expected: 모든 블록 `OK`, 마지막 `battleIntegration.test.mjs: OK`.

(참고: 두 번째 시나리오 블록 — "대전 도중 참가자가 연결을 끊어도 결과 저장은 전원에 대해 시도되어야 한다" — 은 저장 시도 횟수(warning 개수)만 확인하므로 이번 변경으로 안 깨진다. `session.js`/`resultStorage.js`가 아직 `onEnd(winners, scores)`의 새 두 번째 인자를 안 받아도 이 테스트는 통과한다 — Task 3에서 마저 연결한다.)

- [ ] **Step 5: 커밋**

```bash
git add backend/socket/battle.js backend/socket/battleIntegration.test.mjs
git commit -m "feat: battle.js가 점수제 필드로 참가자를 초기화하고 종료 시 점수 스냅샷을 전달"
```

---

### Task 3: 결과 저장에 최종 점수 반영

**Files:**
- Modify: `backend/socket/session.js:37-43` (onEnd 콜백)
- Modify: `backend/lib/resultStorage.js` (전체 재작성)
- Modify: `backend/lib/supabase/schema.sql`
- Test: `backend/lib/resultStorage.test.mjs` (일부 수정)

**Interfaces:**
- Consumes: Task 2의 `onEnd(winners, scores)` 콜백 시그니처
- Produces: `saveParticipantResults(participants, winners, scores, saveFn?, fallbackPath?)` — `scores`는 `{ [participantId]: number }`, 없거나 잘못된 타입이면 안전하게 빈 객체로 취급.

- [ ] **Step 1: 실패하는 테스트로 기존 테스트 수정**

`backend/lib/resultStorage.test.mjs`를 아래처럼 고친다.

15~29번째 줄(정상 케이스 블록)을 아래로 바꾼다:

```js
{
  const calls = [];
  const fakeSaveFn = async (payload) => { calls.push(payload); return { id: 'saved-' + calls.length }; };
  const participants = [makeParticipant('p1'), makeParticipant('p2')];
  const outcomes = await saveParticipantResults(participants, ['p1'], { p1: 120, p2: 45 }, fakeSaveFn);

  assert.strictEqual(calls.length, 2, '참가자 수만큼 saveFn이 호출되어야 함');
  assert.deepStrictEqual(calls[0], {
    weapon_name: '무기-p1', weapon_image: 'data:image/png;base64,AAA',
    weapon_stats: { attack: 10, defense: 5 }, weapon_damage: 500, win: true, score: 120,
  }, 'winners에 포함된 p1은 win:true, score는 scores[p1] 값, parts는 저장 대상에서 제외되어야 함');
  assert.strictEqual(calls[1].win, false, 'winners에 없는 p2는 win:false');
  assert.strictEqual(calls[1].score, 45);
  assert.strictEqual(outcomes.every((o) => o.status === 'fulfilled'), true);
  console.log('saveParticipantResults maps participants to saveFn calls: OK');
}
```

31~43번째 줄(실패 케이스 블록)의 `saveParticipantResults(participants, [], fakeSaveFn)` 호출을 아래로 바꾼다(세 번째 자리에 `scores`가 새로 끼어들었으므로 `fakeSaveFn`은 네 번째 인자로 밀려남):

```js
  await assert.doesNotReject(
    () => saveParticipantResults(participants, [], {}, fakeSaveFn),
    '일부 저장 실패가 전체를 throw하게 만들면 안 됨',
  );
```

46~50번째 줄(참가자 0명 케이스)을 아래로 바꾼다:

```js
{
  const outcomes = await saveParticipantResults([], [], {}, async () => { throw new Error('should not be called'); });
  assert.deepStrictEqual(outcomes, []);
  console.log('saveParticipantResults with no participants: OK');
}
```

52~62번째 줄(winners가 배열이 아닌 경우) 블록을 아래로 바꾼다 — `scores`도 함께 비정상 값(`undefined`)을 줘서 두 방어 로직을 한 번에 확인한다:

```js
// 회귀 테스트: winners/scores가 정상 형태가 아니어도(undefined 등) map() 콜백 안에서 던지면
// 안 된다. session.js가 이 함수를 await 없이 fire-and-forget으로 호출하므로, 여기서 던지면
// Promise.allSettled로도 못 잡는 unhandled rejection이 되어 서버가 죽는다(Opus 리뷰 Important #2).
{
  const calls = [];
  const fakeSaveFn = async (payload) => { calls.push(payload); return { id: 'saved' }; };
  const outcomes = await saveParticipantResults([makeParticipant('p1')], undefined, undefined, fakeSaveFn);
  assert.strictEqual(calls[0].win, false, 'winners가 배열이 아니면 아무도 승자가 아닌 것으로 취급');
  assert.strictEqual(calls[0].score, null, 'scores가 객체가 아니면 score는 null로 취급');
  assert.strictEqual(outcomes[0].status, 'fulfilled');
}
console.log('saveParticipantResults tolerates non-array winners and missing scores: OK');
```

66~87번째 줄(fallback 파일 기록 블록)의 `saveParticipantResults(participants, ['p2'], fakeSaveFn, fallbackPath)` 호출을 아래로 바꾸고, `score` 필드 검증을 하나 추가한다:

```js
  await saveParticipantResults(participants, ['p2'], { p1: 10 }, fakeSaveFn, fallbackPath);

  const content = await readFile(fallbackPath, 'utf8');
  const lines = content.trim().split('\n').map((line) => JSON.parse(line));
  assert.strictEqual(lines.length, 1, '실패한 p1 하나만 fallback 파일에 기록되어야 함');
  assert.strictEqual(lines[0].weapon_name, '무기-p1');
  assert.strictEqual(lines[0].win, false);
  assert.strictEqual(lines[0].score, 10);
  assert.ok(lines[0].failed_at, 'failed_at 타임스탬프가 있어야 함');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/lib/resultStorage.test.mjs`
Expected: 첫 번째 블록에서 `calls[0].score`가 `undefined`라 `deepStrictEqual`이 실패(현재 `saveParticipantResults`가 아직 `scores` 파라미터를 안 받음).

- [ ] **Step 3: `resultStorage.js`에 `scores` 파라미터 추가**

`backend/lib/resultStorage.js` 전체를 아래로 교체한다:

```js
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveResult } from './supabaseClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FALLBACK_PATH = path.join(__dirname, '../data/results-fallback.jsonl');

// 대전 종료 시 참가자별 결과를 저장한다. 저장 실패는 절대 호출자를 막지 않도록
// Promise.allSettled로 감싼다 — 부스 운영 중엔 저장 실패보다 stage 전환이 막히는 쪽이 더 나쁘다.
//
// winners는 배열이 아닌 값(undefined 등)이 들어와도 여기서 막아야 한다 — 이 함수는 호출자가
// await 없이 fire-and-forget으로 호출하므로(session.js), map() 콜백 안에서 던지는 예외는
// Promise.allSettled가 절대 잡아주지 못하고 그대로 unhandled rejection이 되어 서버가 죽는다.
// scores도 같은 이유로 방어한다 — { [participantId]: number } 형태가 아니면 각 참가자의
// score를 null로 남긴다.
export async function saveParticipantResults(participants, winners, scores, saveFn = saveResult, fallbackPath = DEFAULT_FALLBACK_PATH) {
  const winnerIds = Array.isArray(winners) ? winners : [];
  const safeScores = scores && typeof scores === 'object' ? scores : {};
  const payloads = participants.map((p) => ({
    weapon_name: p.weapon?.name,
    weapon_image: p.weapon?.image,
    weapon_stats: p.weapon?.stats,
    weapon_damage: p.weapon?.damage,
    win: winnerIds.includes(p.id),
    score: Number.isFinite(safeScores[p.id]) ? safeScores[p.id] : null,
  }));

  const outcomes = await Promise.allSettled(payloads.map((payload) => saveFn(payload)));

  const failedPayloads = [];
  outcomes.forEach((outcome, i) => {
    if (outcome.status === 'rejected') {
      console.error('[resultStorage] 참가자 결과 저장 실패:', participants[i].id, outcome.reason);
      failedPayloads.push(payloads[i]);
    }
  });

  // Supabase 저장이 실패해도 결과 자체를 완전히 잃어버리진 않도록 로컬 파일에 남긴다 —
  // 콘솔 로그만으로는 부스 운영 중 아무도 안 보고 있으면 그날 저장이 전부 유실된 걸
  // 행사가 끝난 뒤에야 알게 된다.
  if (failedPayloads.length > 0) {
    await appendFallback(failedPayloads, fallbackPath);
  }

  return outcomes;
}

async function appendFallback(payloads, fallbackPath) {
  try {
    await mkdir(path.dirname(fallbackPath), { recursive: true });
    const lines = payloads
      .map((payload) => JSON.stringify({ ...payload, failed_at: new Date().toISOString() }))
      .join('\n') + '\n';
    await appendFile(fallbackPath, lines, 'utf8');
  } catch (err) {
    console.error('[resultStorage] fallback 파일 기록도 실패:', err);
  }
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/lib/resultStorage.test.mjs`
Expected: 모든 블록 `OK`, 마지막 `resultStorage.test.mjs: OK`.

- [ ] **Step 5: `session.js`의 `onEnd` 콜백이 `scores`를 받아서 전달하도록 수정**

`backend/socket/session.js`의 37번째 줄:

```js
      onEnd: (winners) => {
        saveParticipantResults(participantsAtBattleStart, winners).catch((err) => {
```

를 아래로 바꾼다:

```js
      onEnd: (winners, scores) => {
        saveParticipantResults(participantsAtBattleStart, winners, scores).catch((err) => {
```

- [ ] **Step 6: `schema.sql`에 `score` 컬럼 추가**

`backend/lib/supabase/schema.sql`의 `create table` 블록 안, `win boolean,` 줄 바로 다음에 아래 줄을 추가한다:

```sql
  score integer,
```

파일 맨 위에 마이그레이션 안내 주석도 추가한다(이미 운영 중인 Supabase 프로젝트가 있다면 `create table if not exists`는 기존 테이블을 안 건드리므로, 컬럼을 직접 추가해야 한다는 걸 알려주기 위함):

```sql
-- 이미 results 테이블이 있는 기존 Supabase 프로젝트라면(create table if not exists는 기존
-- 테이블의 컬럼을 바꿔주지 않음) SQL Editor에서 아래를 먼저 실행할 것:
--   alter table results add column if not exists score integer;
```

- [ ] **Step 7: 전체 회귀 확인**

Run:
```bash
for f in shapes/*.test.mjs backend/lib/*.test.mjs backend/routes/*.test.mjs backend/socket/*.test.mjs; do
  echo "== $f =="; node "$f" || echo "FAILED: $f";
done
```
Expected: `FAILED` 없이 전부 통과.

- [ ] **Step 8: 커밋**

```bash
git add backend/socket/session.js backend/lib/resultStorage.js backend/lib/resultStorage.test.mjs backend/lib/supabase/schema.sql
git commit -m "feat: 대전 결과 저장에 최종 점수 반영"
```

---

### Task 4: 프론트엔드 대전 화면 — HP 바 대신 점수 표시

**Files:**
- Modify: `frontend/src/screens/battle.js` (전체 재작성)

**Interfaces:**
- Consumes: Task 2가 `battle:state`로 브로드캐스트하는 `room.players[id].score`(number)/`connected`(boolean)
- Produces: 없음 (최종 소비자)

이 파일은 브라우저 전용 코드라 Node에서 자동 테스트할 수 없다(레포에 프론트엔드 빌드/테스트 도구가 없음 — `shapes/weaponRenderer.js`와 같은 제약). 코드 정확성을 직접 검토하고, 서버를 띄워 실제로 확인한다.

- [ ] **Step 1: `battle.js` 재작성**

`frontend/src/screens/battle.js` 전체를 아래로 교체한다:

```js
import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import Konva from 'konva';
import { drawWeaponGroup } from '../../../shapes/weaponRenderer.js';

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

// 실시간 대전 화면. docs/초안.md 7-③, 2026-08-06 배틀로얄 점수제 설계 문서 참고.
export function BattleScreen({ socket, state }) {
  const containerRef = useRef(null);
  const layerRef = useRef(null);
  const nodesRef = useRef({});

  useEffect(() => {
    const stage = new Konva.Stage({
      container: containerRef.current,
      width: ARENA_SIZE.width,
      height: ARENA_SIZE.height,
    });
    const layer = new Konva.Layer();
    stage.add(layer);
    layerRef.current = layer;
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
          // 탈락이 없는 점수제라 체력바 대신 현재 누적 점수를 숫자로 보여준다.
          const scoreLabel = new Konva.Text({
            x: p.x - CHARACTER_RADIUS, y: p.y - CHARACTER_RADIUS - 18,
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
          // 안 바뀌므로(제작 단계에서 확정) 여기서 한 번만 그리고 이후엔 위치만 옮긴다.
          const weaponGroup = drawWeaponGroup(Konva, p.weaponParts, { targetSize: WEAPON_ICON_SIZE });
          layer.add(circle);
          layer.add(scoreLabel);
          layer.add(label);
          layer.add(weaponGroup);
          entry = { circle, scoreLabel, label, weaponGroup };
          nodesRef.current[p.id] = entry;
        }
        entry.circle.x(p.x);
        entry.circle.y(p.y);
        // 탈락이 없으므로 이 흐림 처리는 "죽음"이 아니라 "연결 끊김"만 의미한다.
        entry.circle.opacity(p.connected ? 1 : 0.2);
        entry.scoreLabel.x(p.x - CHARACTER_RADIUS);
        entry.scoreLabel.y(p.y - CHARACTER_RADIUS - 18);
        entry.scoreLabel.text(String(p.score ?? 0));
        entry.scoreLabel.opacity(p.connected ? 1 : 0.2);
        entry.label.x(p.x - CHARACTER_RADIUS);
        entry.label.y(p.y - 7);
        entry.label.opacity(p.connected ? 1 : 0.2);
        // 공격 히트박스(backend/lib/battleSimulation.js의 attackHitboxRect)와 같은
        // facing -> 오프셋 매핑 — 캐릭터가 바라보는 쪽에 무기를 든 것처럼 보이게 한다.
        // weaponGroup은 drawWeaponGroup 안에서 이미 자기 중심 기준으로 offset돼 있으므로,
        // 여기 오프셋은 "무기 아이콘의 중심"이 캐릭터 중심에서 얼마나 떨어지는지를 뜻한다.
        const WEAPON_OFFSET = CHARACTER_RADIUS;
        const weaponOffset = {
          up: { x: 0, y: -WEAPON_OFFSET },
          down: { x: 0, y: WEAPON_OFFSET },
          left: { x: -WEAPON_OFFSET, y: 0 },
          right: { x: WEAPON_OFFSET, y: 0 },
        }[p.facing] ?? { x: WEAPON_OFFSET, y: 0 };
        // 벽 근처에서 무기 아이콘이 화면 밖으로 잘리지 않게 아레나 범위 안으로 clamp —
        // dragBoundFunc(CanvasEditor.js)/moveOne(battleSimulation.js)과 같은 패턴.
        entry.weaponGroup.x(Math.min(ARENA_SIZE.width, Math.max(0, p.x + weaponOffset.x)));
        entry.weaponGroup.y(Math.min(ARENA_SIZE.height, Math.max(0, p.y + weaponOffset.y)));
        entry.weaponGroup.opacity(p.connected ? 1 : 0.2);
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

  const inputRef = useRef({ up: false, down: false, left: false, right: false, attack: false });

  function sendInput(patch) {
    const next = { ...inputRef.current, ...patch };
    // 값이 실제로 바뀔 때만 전송 — 특히 키보드 반복입력(OS auto-repeat)이 초당 수십 번
    // 동일한 keydown을 발생시켜도 여기서 걸러지므로 서버로 불필요한 이벤트가 안 나간다.
    const changed = Object.keys(patch).some((key) => inputRef.current[key] !== next[key]);
    if (!changed) return;
    inputRef.current = next;
    socket.emit('battle:input', inputRef.current);
  }

  useEffect(() => {
    function keyToDirection(key) {
      if (key === 'ArrowUp') return 'up';
      if (key === 'ArrowDown') return 'down';
      if (key === 'ArrowLeft') return 'left';
      if (key === 'ArrowRight') return 'right';
      if (key === ' ') return 'attack';
      return null;
    }
    function onKeyDown(e) {
      const dir = keyToDirection(e.key);
      if (!dir) return;
      e.preventDefault(); // 방향키/스페이스바로 페이지가 스크롤되는 것 방지
      if (e.repeat) return; // OS 키 반복은 무시 (sendInput의 변경감지와 이중 방어)
      sendInput({ [dir]: true });
    }
    function onKeyUp(e) {
      const dir = keyToDirection(e.key);
      if (!dir) return;
      e.preventDefault();
      sendInput({ [dir]: false });
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // 방향패드/공격 버튼 공용 핸들러 — 터치로 누르고 있다가 손가락이 버튼 밖으로 미끄러지면
  // pointerup이 아니라 pointerleave/pointercancel이 발생해서, 그 경우도 놓치지 않고 떼야
  // "버튼에서 손을 뗐는데 캐릭터가 계속 움직이는" 상태가 안 생긴다.
  function releaseOn(key) {
    return () => sendInput({ [key]: false });
  }
  function pressOn(key) {
    return () => sendInput({ [key]: true });
  }

  return html`
    <div class="battle-shell">
      <div class="battle-arena" ref=${containerRef}></div>
      <div class="battle-controls">
        <div class="dpad">
          <button
            onPointerDown=${pressOn('up')}
            onPointerUp=${releaseOn('up')}
            onPointerLeave=${releaseOn('up')}
            onPointerCancel=${releaseOn('up')}
          >↑</button>
          <div class="dpad-row">
            <button
              onPointerDown=${pressOn('left')}
              onPointerUp=${releaseOn('left')}
              onPointerLeave=${releaseOn('left')}
              onPointerCancel=${releaseOn('left')}
            >←</button>
            <button
              onPointerDown=${pressOn('down')}
              onPointerUp=${releaseOn('down')}
              onPointerLeave=${releaseOn('down')}
              onPointerCancel=${releaseOn('down')}
            >↓</button>
            <button
              onPointerDown=${pressOn('right')}
              onPointerUp=${releaseOn('right')}
              onPointerLeave=${releaseOn('right')}
              onPointerCancel=${releaseOn('right')}
            >→</button>
          </div>
        </div>
        <button
          class="attack-button"
          onPointerDown=${pressOn('attack')}
          onPointerUp=${releaseOn('attack')}
          onPointerLeave=${releaseOn('attack')}
          onPointerCancel=${releaseOn('attack')}
        >공격</button>
      </div>
    </div>
  `;
}
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/src/screens/battle.js
git commit -m "feat: 대전 화면에서 HP 바를 없애고 누적 점수를 표시"
```

---

## 완료 후 최종 리뷰

4개 태스크 커밋이 끝나면, 이 세션에서 계속 써온 패턴대로 Opus 모델로 최종 리뷰를 돌린다:

1. `Agent` 도구로 `model: opus`, 이 4개 커밋 diff를 대상으로 코드 리뷰 디스패치.
2. Critical/Important 발견 사항 전부 수정 — 각 수정 전에 `git stash`로 수정 전 코드에서 회귀 테스트가 실제로 실패하는지(RED) 확인.
3. 서버(`MOCK_AI=true node server.js`, `backend/` 디렉터리에서 실행)를 띄우고 Playwright로 최소 2명이 실제로 서로 공격을 주고받게 한 뒤:
   - 한쪽이 다른 쪽 점수보다 낮아져도 화면에서 캐릭터가 사라지거나 조작 불가 상태가 되지 않는지(탈락 없음)
   - 캐릭터 옆 숫자가 실제로 명중할 때마다 바뀌는지
   - 제한시간이 끝났을 때 점수가 더 높은 쪽이 승리 처리되는지
   를 실측으로 확인한다(90초를 실제로 기다리기 부담스러우면 `getBattleRoom().endsAt`을 서버 콘솔/디버거로 앞당기는 기존 테스트 패턴을 참고할 것 — 자동 테스트가 이미 이 경로를 커버하므로 라이브 검증은 "화면이 실제로 그렇게 보이는가"에 집중한다).
4. Minor/보류 항목은 이 계획 문서 맨 아래에 "## 구현 후 최종 리뷰(Opus) 반영 사항" 섹션을 추가해 기록.
5. 작업 종료 후 `.playwright-mcp/` 스크린샷 아티팩트 정리, 서버 프로세스 종료, `git status` 클린 확인.

## 구현 후 최종 리뷰(Opus) 반영 사항

Opus 모델(별도 에이전트, 코드를 직접 실행/프로브해서 검증)로 커밋 `648f97e..6f6445b` diff를 리뷰. Critical 2건, Important 4건, Minor 4건 발견.

**수정한 항목:**

- **Critical C1 — 무기 데미지 상한 소실.** 예전 `hitDamageFromWeaponDamage`는 `[5,50]`으로 clamp했지만 새 `hitScoreFromWeaponDamage`는 상한이 없었다. 클라이언트가 보낸 `weapon.damage`는 서버 검증 없이 그대로 쓰이므로, 비정상적으로 큰 값(치트/버그)이 오면 한 방에 상대를 0점으로 만들고 DB `score integer` 컬럼 범위도 넘길 수 있었다. `WEAPON_DAMAGE_MAX = 10000`(aiClient.js의 DAMAGE_MAX와 동일)으로 clamp 재도입.
- **Important I1 — "최소치 1" 주석과 실제 동작 불일치.** `round(1 * 0.05) = 0`이라 약한 무기는 맞혀도 0점이었다(주석은 "최소치 1"이라고 해놓고). `Math.max(1, ...)`로 명중 시 최소 1점을 보장하도록 수정.
- **Important I2 — 점수 라벨이 위쪽 벽 근처에서 화면 밖으로 잘림.** `y = p.y - CHARACTER_RADIUS - 18`이 캐릭터가 상단 경계(`y=CHARACTER_RADIUS`)에 붙으면 음수가 되어 stage 밖으로 나감. `Math.max(0, ...)`로 clamp.
- **Important I3 — 참가자 0~1명 대전이 90초를 꽉 채움.** 탈락 판정을 없애면서 "생존자 1명 이하" 조기 종료 분기도 같이 사라져, 관리자가 실수로 아무도(또는 한 명만) 완료 안 한 상태에서 battle 단계로 넘기면 빈 화면이 90초간 정지했다. 참가자 수가 0~1명이면 제한시간과 무관하게 그 즉시 종료하는 구조적 가드를 추가(런타임 탈락 로직은 아님 — 방 크기만 봄).
- **Important I4 — 점수 전달 경로의 end-to-end 테스트 부재.** 기존 통합 테스트는 결과 저장 "시도 횟수"만 셌지, `battle.js`의 `onEnd(winners, scores)`가 실제 종료 시점 점수와 정확히 일치하는 `scores`를 넘기는지는 검증하지 않았다. `startBattleRoom`을 직접 호출해 점수를 임의로 세팅한 뒤 `onEnd` 콜백 인자를 직접 검증하는 테스트 추가.
- **Minor M2 — `p.connected` 방어 부재.** `p.score ?? 0`과 다르게 `p.connected`는 falsy면 무조건 흐리게 처리돼서, `connected` 필드가 없는 예상 밖 프레임에서 전원이 흐려질 수 있었다. `p.connected !== false`로 변경(명시적으로 false일 때만 흐리게).

**보류(문서화만, 코드 수정 없음):**

- **Critical C2 — `score` 컬럼 없는 기존 Supabase 프로젝트에서 그 회차 저장이 전부 조용히 fallback으로 빠짐.** 이미 `schema.sql`에 "기존 프로젝트라면 `alter table`을 먼저 실행하라"는 안내 주석이 있고(Task 3), 실패 시에도 로컬 JSONL fallback으로 데이터 자체는 안 잃는다(기존 설계). 서버가 부팅 시점에 컬럼 존재를 확인하는 헬스체크까지 추가하는 건 이 학교 부스 프로젝트 규모에 비해 과함 — 부스 운영 전 체크리스트 항목으로만 남긴다.
- **Minor M1 — 동시 타격/동점 근처에서 `Object.keys` 처리 순서에 따른 결과 편향.** 예: 대상이 5점, 두 공격자의 hitScore가 각각 다를 때 어느 쪽이 먼저 처리되느냐에 따라 최종 0점 도달 여부가 갈릴 수 있음. 입장 순서 기반이라 라운드 내내 편향이 일관되긴 하지만, 완전한 동시 처리(예: 그 틱의 피해를 한꺼번에 모아서 한 번에 적용)로 바꾸는 건 범위 밖 — 학교 부스 게임 특성상 체감되는 불공정은 아니라고 판단.
- **Minor M3 — 참가자 화면에 최종 점수가 안 보임.** `battle:result`는 지금도 `{win}`만 보내고 결과 화면(`ResultScreen`)도 승/패만 표시 — 최종 점수는 DB에만 남는다. 원래 설계 문서 스코프가 "대전 화면"까지였고 결과 화면 UI 변경은 포함하지 않았으므로 이번엔 손대지 않음.
