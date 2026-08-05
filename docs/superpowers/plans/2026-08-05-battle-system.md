# 대전 시스템 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5인 동시난투 실시간 근접 전투를 서버 권위형 시뮬레이션으로 구현하고, Konva로 렌더링하며, 승리 조건 확정 시 결과 화면으로 자동 연결한다.

**Architecture:** 이동/충돌/공격/승리판정을 `backend/lib/battleSimulation.js`의 순수 함수 `stepSimulation(room, now)`로 분리해 소켓 배선과 독립적으로 테스트한다. `backend/socket/battle.js`가 20Hz 틱 루프로 이 함수를 반복 호출하며 상태를 broadcast하고, `session.js`가 `stage='battle'` 진입 시점에 콜백 주입 방식(순환 import 없이)으로 대전을 시작시킨다.

**Tech Stack:** Preact + htm (CDN, 기존 유지), Konva.js (CDN, 이 브랜치엔 아직 없어서 재도입), Express + Socket.io (기존).

## Global Constraints

- 번들러 없음 — 모든 신규 프론트 코드는 `<script type="module">` + import map으로 CDN에서 로드
- 아레나 크기: 800×600, 캐릭터 충돌 반경 20px, 이동속도 틱당 4px, 20Hz(50ms) 틱
- 공격: 바라보는 방향 30×30px 히트박스, 쿨다운 500ms, 즉시 판정(지속시간 없음 — 아래 설계 노트 참고)
- 타격 데미지 정규화: `hitDamage = clamp(round(weapon.damage / 200), 5, 50)`
- 체력: 전원 고정 100
- 라운드 제한시간: 90000ms(90초)
- 승리 조건: 생존자 1명 이하(즉시 종료) 또는 시간 초과 시 최다 체력자(동점이면 동점자 전원) 승리
- 근접 전투만 (원거리 없음), 맵/캐릭터는 플레이스홀더 데이터 (실제 에셋 아직 없음)
- 5명 모두 하나의 대전 방을 공유(배틀로얄), 페어링/토너먼트 없음
- 테스트 프레임워크 미설치 — 순수 함수 테스트는 `node:assert` + 독립 `.mjs` 스크립트로 작성, `node <파일>`로 직접 실행

## 설계 노트: 스펙과의 차이 (구현 편의를 위한 의도적 단순화)

스펙 문서는 공격 히트박스가 "2틱(100ms) 동안 활성화"된다고 적었지만, 이 계획에서는 **공격키가 눌리고 쿨다운이 끝난 바로 그 틱에 즉시 1회 판정**하는 것으로 단순화한다. 히트박스가 여러 틱에 걸쳐 지속되면 "이번 틱에 새로 생긴 히트박스인지, 이전 틱부터 있던 것인지" 상태를 추적해야 해서 구현/테스트가 복잡해지는데, 20Hz·근접 거리에서는 즉시판정과 체감 차이가 거의 없다. 순수 함수라 나중에 필요하면 쉽게 바꿀 수 있다.

---

## Task 1: 맵 플레이스홀더 데이터 (`backend/lib/battleMap.js`)

**Files:**
- Create: `backend/lib/battleMap.js`

**Interfaces:**
- Produces: `DEFAULT_MAP: { arenaSize: {width, height}, walls: {x,y,width,height}[] }`

- [ ] **Step 1: 구현** (순수 데이터 파일, 별도 실패 테스트 없이 바로 작성 — Task 2에서 `stepSimulation`이 이 데이터를 실제로 소비하며 검증됨)

```js
// backend/lib/battleMap.js
// 실제 맵 에셋이 아직 없어서 플레이스홀더 — 팀이 Manus 결과물 좌표를 얻으면 walls 배열만 교체.
export const DEFAULT_MAP = {
  arenaSize: { width: 800, height: 600 },
  walls: [
    { x: 350, y: 250, width: 100, height: 20 },
    { x: 100, y: 100, width: 20, height: 150 },
    { x: 680, y: 350, width: 20, height: 150 },
  ],
};
```

- [ ] **Step 2: 검증**

Run:
```bash
node -e "import('./backend/lib/battleMap.js').then(m => console.log(m.DEFAULT_MAP.walls.length, 'walls loaded'))"
```
Expected: `3 walls loaded`

- [ ] **Step 3: 커밋**

```bash
git add backend/lib/battleMap.js
git commit -m "feat: 대전 맵 플레이스홀더 데이터 추가"
```

---

## Task 2: 이동 + 벽/경계 충돌 + 데미지 정규화 (`backend/lib/battleSimulation.js`)

**Files:**
- Create: `backend/lib/battleSimulation.js`
- Test: `backend/lib/battleSimulation.test.mjs`

**Interfaces:**
- Consumes: 없음 (독립적인 순수 함수 모듈)
- Produces: `ARENA_SIZE`, `CHARACTER_RADIUS`, `MOVE_SPEED`, `HIT_DAMAGE_MIN`, `HIT_DAMAGE_MAX`, `ATTACK_HITBOX_SIZE`, `ATTACK_COOLDOWN_MS`, `BATTLE_DURATION_MS` 상수, `hitDamageFromWeaponDamage(weaponDamage): number`, `stepSimulation(room, now): {room, winners}` (이 태스크에서는 이동/벽충돌만 구현하고 공격/승리판정은 Task 3/4에서 채움 — `stepSimulation`은 매 태스크마다 이 파일에 계속 확장됨)

**player 객체 shape** (이후 모든 태스크가 공유):
```js
{
  id: string,
  characterId: string,
  x: number, y: number,
  facing: 'up' | 'down' | 'left' | 'right',
  hp: number,
  hitDamage: number,
  alive: boolean,
  lastAttackAt: number,       // ms epoch
  input: { up: boolean, down: boolean, left: boolean, right: boolean, attack: boolean },
}
```
**room 객체 shape**: `{ status: 'active'|'ended', endsAt: number, players: {[id]: player}, walls: {x,y,width,height}[] }`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// backend/lib/battleSimulation.test.mjs
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
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/lib/battleSimulation.test.mjs`
Expected: `Cannot find module './battleSimulation.js'`로 FAIL

- [ ] **Step 3: 구현**

```js
// backend/lib/battleSimulation.js
export const ARENA_SIZE = { width: 800, height: 600 };
export const CHARACTER_RADIUS = 20;
export const MOVE_SPEED = 4;
export const HIT_DAMAGE_MIN = 5;
export const HIT_DAMAGE_MAX = 50;
export const ATTACK_HITBOX_SIZE = 30;
export const ATTACK_COOLDOWN_MS = 500;
export const BATTLE_DURATION_MS = 90000;

export function hitDamageFromWeaponDamage(weaponDamage) {
  return Math.min(HIT_DAMAGE_MAX, Math.max(HIT_DAMAGE_MIN, Math.round(weaponDamage / 200)));
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

export function stepSimulation(room, now) {
  if (room.status !== 'active') return { room, winners: null };

  const players = {};
  for (const id of Object.keys(room.players)) {
    const p = room.players[id];
    players[id] = p.alive ? moveOne(p, room.walls) : { ...p };
  }

  return { room: { ...room, players }, winners: null };
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/lib/battleSimulation.test.mjs`
Expected: 모든 줄에 `OK` 출력, 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add backend/lib/battleSimulation.js backend/lib/battleSimulation.test.mjs
git commit -m "feat: 대전 시뮬레이션 - 이동/벽충돌/데미지 정규화 구현"
```

---

## Task 3: 공격 판정 (`backend/lib/battleSimulation.js` 확장)

**Files:**
- Modify: `backend/lib/battleSimulation.js`
- Modify: `backend/lib/battleSimulation.test.mjs`

**Interfaces:**
- Consumes: Task 2의 `stepSimulation`, player/room shape
- Produces: `stepSimulation`이 이제 공격 판정도 수행 (승리판정은 아직 없음 — `winners`는 여전히 항상 `null`)

- [ ] **Step 1: 실패하는 테스트 추가**

`backend/lib/battleSimulation.test.mjs`의 마지막 `console.log('battleSimulation.test.mjs (movement): OK');` 줄 **앞에** 아래를 추가:

```js
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
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/lib/battleSimulation.test.mjs`
Expected: `attack hits target in range` 관련 assertion에서 `70 기대, 실제 100`로 FAIL (아직 공격 로직이 없어서 데미지가 안 들어감)

- [ ] **Step 3: 구현**

`battleSimulation.js`에 아래 함수를 `moveOne` 아래, `stepSimulation` 위에 추가:

```js
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
```

그리고 `stepSimulation`의 `return { room: { ...room, players }, winners: null };` 줄 **앞에** 공격 판정 루프를 삽입:

```js
  // 공격 판정 — 참가자 순서(입장 순서)대로 한 명씩 처리, 쿨다운 통과 시 즉시 판정
  for (const id of Object.keys(players)) {
    const attacker = players[id];
    if (!attacker.alive) continue;
    if (!attacker.input.attack) continue;
    if (now - attacker.lastAttackAt < ATTACK_COOLDOWN_MS) continue;

    const hitbox = attackHitboxRect(attacker);
    for (const targetId of Object.keys(players)) {
      if (targetId === id) continue;
      const target = players[targetId];
      if (!target.alive) continue;
      if (circleRectOverlap(target.x, target.y, CHARACTER_RADIUS, hitbox.x, hitbox.y, hitbox.width, hitbox.height)) {
        const hp = Math.max(0, target.hp - attacker.hitDamage);
        players[targetId] = { ...target, hp, alive: hp > 0 };
      }
    }
    players[id] = { ...attacker, lastAttackAt: now };
  }
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/lib/battleSimulation.test.mjs`
Expected: 모든 줄에 `OK`, 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add backend/lib/battleSimulation.js backend/lib/battleSimulation.test.mjs
git commit -m "feat: 대전 시뮬레이션 - 근접 공격 판정 구현"
```

---

## Task 4: 승리 조건 (`backend/lib/battleSimulation.js` 확장)

**Files:**
- Modify: `backend/lib/battleSimulation.js`
- Modify: `backend/lib/battleSimulation.test.mjs`

**Interfaces:**
- Consumes: Task 2/3의 `stepSimulation`
- Produces: `stepSimulation`이 이제 `winners: null | string[]`을 실제로 반환 (생존자 1명 이하 또는 시간 초과 시), `room.status`가 `'ended'`로 전환됨

- [ ] **Step 1: 실패하는 테스트 추가**

`battleSimulation.test.mjs`의 마지막 `console.log('battleSimulation.test.mjs (movement): OK');` 줄 **앞에** 추가:

```js
// 승리: 마지막 생존자
{
  const p1 = makePlayer({ id: 'p1', x: 400, y: 300, facing: 'right', hitDamage: 100, input: { ...noInput, attack: true } });
  const p2 = makePlayer({ id: 'p2', x: 450, y: 300, hp: 50 });
  const room = makeRoom({ p1, p2 });
  const { room: next, winners } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p2.alive, false);
  assert.deepStrictEqual(winners, ['p1']);
  assert.strictEqual(next.status, 'ended');
  console.log('win by last survivor: OK');
}

// 승리: 시간 초과 시 체력 최다자
{
  const p1 = makePlayer({ id: 'p1', hp: 80 });
  const p2 = makePlayer({ id: 'p2', hp: 40 });
  const room = makeRoom({ p1, p2 }, { endsAt: 1000 });
  const { winners, room: next } = stepSimulation(room, 1000);
  assert.deepStrictEqual(winners, ['p1']);
  assert.strictEqual(next.status, 'ended');
  console.log('win by timeout (highest hp): OK');
}

// 승리: 시간 초과 + 동점 -> 전원 승자
{
  const p1 = makePlayer({ id: 'p1', hp: 60 });
  const p2 = makePlayer({ id: 'p2', hp: 60 });
  const p3 = makePlayer({ id: 'p3', hp: 30 });
  const room = makeRoom({ p1, p2, p3 }, { endsAt: 1000 });
  const { winners } = stepSimulation(room, 1000);
  assert.deepStrictEqual(winners.sort(), ['p1', 'p2']);
  console.log('win by timeout tie (multiple winners): OK');
}
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/lib/battleSimulation.test.mjs`
Expected: `win by last survivor` 관련 assertion에서 `winners`가 `null`이라 FAIL

- [ ] **Step 3: 구현**

`stepSimulation`의 `return { room: { ...room, players }, winners: null };`를 아래로 교체:

```js
  const alivePlayers = Object.values(players).filter((p) => p.alive);
  let winners = null;
  let status = room.status;
  if (alivePlayers.length <= 1) {
    winners = alivePlayers.map((p) => p.id);
    status = 'ended';
  } else if (now >= room.endsAt) {
    const maxHp = Math.max(...Object.values(players).map((p) => p.hp));
    winners = Object.values(players)
      .filter((p) => p.hp === maxHp)
      .map((p) => p.id);
    status = 'ended';
  }

  return { room: { ...room, players, status }, winners };
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/lib/battleSimulation.test.mjs`
Expected: 모든 줄에 `OK`, `battleSimulation.test.mjs (movement): OK`까지 에러 없이 출력

- [ ] **Step 5: 커밋**

```bash
git add backend/lib/battleSimulation.js backend/lib/battleSimulation.test.mjs
git commit -m "feat: 대전 시뮬레이션 - 승리 조건 구현"
```

---

## Task 5: 대전 소켓 배선 (`backend/socket/battle.js`)

**Files:**
- Modify: `backend/socket/battle.js` (전체 재작성)

**Interfaces:**
- Consumes: `stepSimulation`, `hitDamageFromWeaponDamage`, `BATTLE_DURATION_MS` (Task 2/3/4), `DEFAULT_MAP` (Task 1)
- Produces: `registerBattleHandlers(io, socket)` (기존 시그니처 유지 — `server.js`가 이미 이렇게 호출 중), `startBattleRoom(io, participants, {onEnd} = {}): void`, `stopBattleRoom(): void`, `getBattleRoom(): room|null`

**설계 노트**: `session.js`가 `stage='battle'` 진입 시 `startBattleRoom`을 호출해야 하는데, 대전이 끝나면 다시 `session.js`의 단계 전환 로직(`stage='result'`)을 트리거해야 한다. `battle.js`가 `session.js`를 import하면 `session.js`도 `battle.js`를 import하는 순환 참조가 생기므로, **콜백 주입**(`onEnd`)으로 해결한다 — `battle.js`는 `session.js`를 전혀 모른 채로 끝난다.

- [ ] **Step 1: 구현**

```js
// backend/socket/battle.js
import { stepSimulation, hitDamageFromWeaponDamage, BATTLE_DURATION_MS } from '../lib/battleSimulation.js';
import { DEFAULT_MAP } from '../lib/battleMap.js';

const CHARACTER_IDS = ['char1', 'char2', 'char3', 'char4', 'char5', 'char6'];
// 기본 맵의 벽(중앙/좌상단/우하단)에서 떨어진 5개 스폰 지점
const SPAWN_POINTS = [
  { x: 80, y: 80 },
  { x: 720, y: 80 },
  { x: 80, y: 520 },
  { x: 720, y: 520 },
  { x: 400, y: 520 },
];
const TICK_MS = 50;

let battleRoom = null;
let tickInterval = null;

export function getBattleRoom() {
  return battleRoom;
}

export function stopBattleRoom() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
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
      hp: 100,
      hitDamage: hitDamageFromWeaponDamage(participant.weapon?.damage ?? 1),
      alive: true,
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
      stopBattleRoom();
      for (const id of Object.keys(battleRoom.players)) {
        io.to(id).emit('battle:result', { win: winners.includes(id) });
      }
      if (onEnd) onEnd(winners);
    }
  }, TICK_MS);
}

export function registerBattleHandlers(io, socket) {
  socket.on('battle:input', (input) => {
    if (!battleRoom || !battleRoom.players[socket.id]) return;
    battleRoom.players[socket.id].input = {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
      attack: !!input.attack,
    };
  });
}
```

- [ ] **Step 2: 문법 검증**

Run: `node --check backend/socket/battle.js`
Expected: 에러 없이 종료

- [ ] **Step 3: 커밋**

```bash
git add backend/socket/battle.js
git commit -m "feat: 대전 소켓 배선(틱 루프, startBattleRoom/stopBattleRoom) 구현"
```

---

## Task 6: `session.js` 연동 (참가자 무기 기록 + battle 단계 진입 시 대전 시작)

**Files:**
- Modify: `backend/socket/session.js`
- Test: `backend/socket/battleIntegration.test.mjs`

**Interfaces:**
- Consumes: `startBattleRoom`, `stopBattleRoom`, `getBattleRoom` (Task 5)
- Produces: `create:done` 소켓 핸들러가 `cohort.participants`에 `{id, weapon}`을 기록, `goToStage(io, 'battle')` 호출 시 자동으로 `startBattleRoom` 실행, 대전 종료 시 자동으로 `goToStage(io, 'result')` 호출, `admin:reset` 시 진행 중인 대전도 정지

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// backend/socket/battleIntegration.test.mjs
import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';
import { getBattleRoom, stopBattleRoom } from './battle.js';

const handlers = {};
function makeSocket(id) {
  return {
    id,
    on: (ev, fn) => { handlers[id] = handlers[id] || {}; handlers[id][ev] = fn; },
    emit: () => {},
  };
}
const emitted = [];
const io = { emit: (ev, payload) => emitted.push([ev, payload]), to: () => ({ emit: () => {} }) };

for (let i = 1; i <= 5; i += 1) {
  registerSessionHandlers(io, makeSocket(`p${i}`));
}

for (let i = 1; i <= 5; i += 1) {
  handlers[`p${i}`]['create:done']({ damage: 1000 * i, parts: [] });
}

handlers.p1['admin:startSession'](); // -> learn
handlers.p1['admin:nextStage'](); // -> create
handlers.p1['admin:nextStage'](); // -> battle (startBattleRoom 트리거되어야 함)

const room = getBattleRoom();
assert.ok(room, 'battle room이 생성되어 있어야 함');
assert.strictEqual(Object.keys(room.players).length, 5);
assert.strictEqual(room.players.p1.hitDamage, 5, 'damage=1000 -> round(1000/200)=5');
assert.strictEqual(room.players.p5.hitDamage, 25, 'damage=5000 -> round(5000/200)=25');
assert.strictEqual(room.status, 'active');

stopBattleRoom();
console.log('battleIntegration.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/socket/battleIntegration.test.mjs`
Expected: `room`이 `null`이라 `assert.ok(room, ...)`에서 FAIL (아직 `create:done`도 비어있고 `goToStage`가 `startBattleRoom`을 안 부름)

- [ ] **Step 3: 구현**

`backend/socket/session.js` 상단 import에 추가:
```js
import { startBattleRoom, stopBattleRoom } from './battle.js';
```

`goToStage` 함수를 아래로 교체:
```js
function goToStage(io, nextStage) {
  cohort.stage = nextStage;
  cohort.slideIndex = 0;
  io.emit('stage:change', cohort.stage);
  if (nextStage === 'battle') {
    startBattleRoom(io, cohort.participants, {
      onEnd: () => goToStage(io, 'result'),
    });
  }
}
```

`admin:reset` 핸들러를 아래로 교체 (진행 중인 대전도 같이 정지):
```js
  socket.on('admin:reset', () => {
    stopBattleRoom();
    cohort.stage = 'idle';
    cohort.slideIndex = 0;
    cohort.participants = [];
    io.emit('stage:change', cohort.stage);
  });
```

기존의:
```js
  socket.on('create:done', () => {
    // TODO: participant별 완료 처리, 전원 완료 시 stage='battle' broadcast (docs/초안.md 7-② 참고)
  });
```
를 아래로 교체:
```js
  socket.on('create:done', (weapon) => {
    const existing = cohort.participants.find((p) => p.id === socket.id);
    if (existing) {
      existing.weapon = weapon;
    } else {
      cohort.participants.push({ id: socket.id, weapon });
    }
  });
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/socket/battleIntegration.test.mjs`
Expected: `battleIntegration.test.mjs: OK`

- [ ] **Step 5: 기존 session.js 테스트 회귀 확인 없음** — 이 브랜치엔 이전 세션의 `session.createDone.test.mjs`/`session.stage-order` 테스트 파일이 없다(다른 브랜치인 `feature/weapon-crafting`에만 있었음). 대신 위 통합 테스트 안에서 `admin:startSession`/`admin:nextStage` 단계 이동도 같이 검증되므로 별도 회귀 테스트 불필요.

- [ ] **Step 6: 커밋**

```bash
git add backend/socket/session.js backend/socket/battleIntegration.test.mjs
git commit -m "feat: session.js - create:done 참가자 무기 기록 + battle 단계 진입 시 대전 자동 시작"
```

---

## Task 7: 프론트 — Konva 재도입 + 벽/캐릭터 렌더링 골격 (`frontend/src/screens/battle.js`)

**Files:**
- Modify: `frontend/index.html` (import map에 Konva 추가, battle.css 링크 추가)
- Modify: `frontend/src/screens/battle.js` (전면 재작성)
- Create: `frontend/src/screens/battle.css`

**Interfaces:**
- Consumes: 없음 (이 태스크는 렌더링 골격만 — 입력 처리는 Task 8)
- Produces: `BattleScreen({socket, state})` — 기존 시그니처 유지 (`app.js`가 이미 이렇게 렌더링 중)

이 브랜치(`feature/battle-system`)는 `feature/shared-shapes`에서 분기해서 Konva가 아직 없다 — `feature/weapon-crafting`에서 했던 것과 동일하게 다시 추가한다.

- [ ] **Step 1: `frontend/index.html`에 Konva를 import map에 추가**

```html
<script type="importmap">
{
  "imports": {
    "preact": "https://esm.sh/preact@10",
    "preact/hooks": "https://esm.sh/preact@10/hooks",
    "htm": "https://esm.sh/htm@3",
    "socket.io-client": "https://esm.sh/socket.io-client@4",
    "konva": "https://esm.sh/konva@9"
  }
}
</script>
```

`<link rel="stylesheet" href="style.css" />` 아래에 추가:
```html
<link rel="stylesheet" href="src/screens/battle.css" />
```

- [ ] **Step 2: battle.css 작성**

```css
/* frontend/src/screens/battle.css */
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
  gap: 2rem;
}

.dpad {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.dpad-row {
  display: flex;
  gap: 0.25rem;
}

.dpad button,
.attack-button {
  width: 3rem;
  height: 3rem;
  font-size: 1.2rem;
  touch-action: none;
}

.attack-button {
  width: 5rem;
  height: 5rem;
  border-radius: 50%;
  background: #c0392b;
  color: #fff;
}
```

- [ ] **Step 3: battle.js 렌더링 골격 구현**

```js
// frontend/src/screens/battle.js
import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import Konva from 'konva';

const html = htm.bind(h);

const ARENA_SIZE = { width: 800, height: 600 };
const CHARACTER_RADIUS = 20;
const CHARACTER_COLORS = {
  char1: '#e74c3c', char2: '#3498db', char3: '#2ecc71',
  char4: '#f1c40f', char5: '#9b59b6', char6: '#e67e22',
};

// 실시간 대전 화면. docs/초안.md 7-③, 2026-08-05 대전 시스템 설계 문서 참고.
// 입력 처리(방향패드/키보드)는 Task 8에서 추가 — 이 태스크는 상태 수신 + 렌더링까지만.
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
          const circle = new Konva.Circle({
            x: p.x, y: p.y, radius: CHARACTER_RADIUS,
            fill: CHARACTER_COLORS[p.characterId] ?? '#999',
          });
          const hpBar = new Konva.Rect({
            x: p.x - CHARACTER_RADIUS, y: p.y - CHARACTER_RADIUS - 8,
            width: CHARACTER_RADIUS * 2, height: 4, fill: '#2ecc71',
          });
          layer.add(circle);
          layer.add(hpBar);
          entry = { circle, hpBar };
          nodesRef.current[p.id] = entry;
        }
        entry.circle.x(p.x);
        entry.circle.y(p.y);
        entry.circle.opacity(p.alive ? 1 : 0.2);
        entry.hpBar.x(p.x - CHARACTER_RADIUS);
        entry.hpBar.y(p.y - CHARACTER_RADIUS - 8);
        entry.hpBar.width(CHARACTER_RADIUS * 2 * Math.max(0, p.hp / 100));
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

  return html`
    <div class="battle-shell">
      <div class="battle-arena" ref=${containerRef}></div>
    </div>
  `;
}
```

- [ ] **Step 4: 문법 검증**

Run: `node --check frontend/src/screens/battle.js`
Expected: 에러 없이 종료

- [ ] **Step 5: 커밋**

```bash
git add frontend/index.html frontend/src/screens/battle.css frontend/src/screens/battle.js
git commit -m "feat: Konva 재도입 + 대전 화면 렌더링 골격(벽/캐릭터/체력바)"
```

---

## Task 8: 프론트 — 입력 처리 (방향패드 + 키보드) + battle:input 전송

**Files:**
- Modify: `frontend/src/screens/battle.js`

**Interfaces:**
- Consumes: Task 7의 `BattleScreen` 골격
- Produces: `BattleScreen`이 이제 `battle:input`을 실제로 전송 (props/시그니처 변경 없음)

- [ ] **Step 1: 입력 처리 추가**

`frontend/src/screens/battle.js`의 두 번째 `useEffect`(`battle:result` 처리부) **아래**에 추가:

```js
  const inputRef = useRef({ up: false, down: false, left: false, right: false, attack: false });

  function sendInput(patch) {
    inputRef.current = { ...inputRef.current, ...patch };
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
      if (dir) sendInput({ [dir]: true });
    }
    function onKeyUp(e) {
      const dir = keyToDirection(e.key);
      if (dir) sendInput({ [dir]: false });
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);
```

`useRef` import에 이미 있는지 확인 (Task 7에서 이미 `useRef`를 import했으므로 추가 import 불필요).

`return html\`...\`;` 블록을 아래로 교체 (방향패드 + 공격 버튼 추가 — 터치/클릭 다 되는 Pointer Events 사용):

```js
  return html`
    <div class="battle-shell">
      <div class="battle-arena" ref=${containerRef}></div>
      <div class="battle-controls">
        <div class="dpad">
          <button
            onPointerDown=${() => sendInput({ up: true })}
            onPointerUp=${() => sendInput({ up: false })}
          >↑</button>
          <div class="dpad-row">
            <button
              onPointerDown=${() => sendInput({ left: true })}
              onPointerUp=${() => sendInput({ left: false })}
            >←</button>
            <button
              onPointerDown=${() => sendInput({ down: true })}
              onPointerUp=${() => sendInput({ down: false })}
            >↓</button>
            <button
              onPointerDown=${() => sendInput({ right: true })}
              onPointerUp=${() => sendInput({ right: false })}
            >→</button>
          </div>
        </div>
        <button
          class="attack-button"
          onPointerDown=${() => sendInput({ attack: true })}
          onPointerUp=${() => sendInput({ attack: false })}
        >공격</button>
      </div>
    </div>
  `;
```

- [ ] **Step 2: 문법 검증**

Run: `node --check frontend/src/screens/battle.js`
Expected: 에러 없이 종료

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/screens/battle.js
git commit -m "feat: 대전 화면 입력 처리(방향패드+키보드) 추가"
```

---

## Task 9: 서버 기동 + 정적 서빙 확인

**Files:** 없음 (검증 전용 태스크)

**Interfaces:** 없음

- [ ] **Step 1: 서버 기동, 신규 정적 파일 서빙 확인**

Run:
```bash
cd backend && node server.js > /tmp/gbl-battle-server.log 2>&1 &
sleep 1
curl -s -o /dev/null -w "index: %{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "battle.js: %{http_code}\n" http://localhost:3000/src/screens/battle.js
curl -s -o /dev/null -w "battle.css: %{http_code}\n" http://localhost:3000/src/screens/battle.css
kill %1
```
Expected: 전부 200

- [ ] **Step 2: 결과를 다음 태스크(Playwright)로 넘김 — 커밋 없음 (검증만)**

---

## Task 10: End-to-end Playwright 스모크 테스트

**Files:** 없음 (Playwright MCP로 직접 조작/확인)

**Interfaces:** 없음

이 브랜치엔 무기 제작 화면이 없어서(다른 브랜치 소관), 실제 참가자 5명이 무기를 만들고 대전까지 가는 전체 흐름은 재현할 수 없다. 대신 서버가 기동된 상태에서 소켓으로 직접 5명의 `create:done`을 흉내내고 admin으로 `battle` 단계까지 넘긴 뒤, 대전 화면이 에러 없이 로드/렌더링되는지만 확인한다.

- [ ] **Step 1: 서버 기동**

Run:
```bash
cd backend && node server.js > /tmp/gbl-battle-server.log 2>&1 &
sleep 1
```

- [ ] **Step 2: Node 스크립트로 5명의 참가자를 흉내내서 battle 단계까지 진행**

`socket.io-client`가 backend에 설치되어 있지 않으므로, 브라우저 쪽(Playwright)에서 관리자 페이지로 `admin:startSession` → `admin:nextStage`(learn→create) → `admin:nextStage`(create→battle)까지는 누를 수 있지만, `create:done`을 실제로 emit해줄 참가자 클라이언트가 이 브랜치엔 없다. 따라서 **참가자 없이(0명) battle 단계에 진입하는 시나리오**로 화면 렌더링만 확인한다 — `cohort.participants`가 비어있어도 `startBattleRoom`은 빈 방으로 초기화되고 즉시 `winners: []`로 종료되지만, `battle:state`가 최소 1회는 broadcast되므로 화면이 에러 없이 그 상태를 받아 렌더링하는지는 확인 가능하다.

- Playwright로 `http://localhost:3000/admin/` 접속 → "세션 시작" 클릭 → "다음 단계" 두 번 클릭(learn→create→battle)
- 참가자 화면(`http://localhost:3000`) 새 탭으로 접속 → 대전 화면이 렌더링되는지 스크린샷으로 확인 (Konva 캔버스 요소가 보이는지, 콘솔 에러 없는지)
- 방향패드/공격 버튼이 화면에 보이는지 확인

- [ ] **Step 3: 콘솔 에러 확인**

Playwright의 콘솔 메시지 확인 — `favicon.ico` 404 외의 에러가 없어야 함.

- [ ] **Step 4: 서버 정리**

Run: `kill %1` (또는 `pgrep -f "node server.js"`로 찾아서 kill)

- [ ] **Step 5: 발견된 버그가 있다면 해당 태스크로 돌아가 수정 후 재확인. 문제 없으면 완료 — 커밋 없음**

---

## Self-Review 메모 (계획 작성자용)

- **스펙 커버리지**: 데이터 모델(Task 2), 이동/충돌(Task 2), 공격 판정(Task 3), 승리 조건(Task 4), 맵 플레이스홀더(Task 1), 소켓 배선/틱 루프(Task 5), session.js 연동/결과화면 전환(Task 6), 렌더링(Task 7), 입력(Task 8), 검증(Task 9-10) — 스펙의 모든 섹션에 대응하는 태스크가 있음
- **사전 검증**: Task 2~4의 `stepSimulation` 로직(이동/벽충돌/공격판정/승리조건 11개 케이스)은 계획 작성 중 스크래치 디렉토리에서 실제로 실행해서 전부 통과 확인함
- **순환 import 방지**: `battle.js`가 `session.js`를 몰라도 되도록 `onEnd` 콜백 주입 방식으로 설계 (Task 5/6에서 명시)
- **다른 브랜치와의 경계**: 이 브랜치엔 무기 제작 화면(`create.js`)이 없어서 실제 참가자 플로우로 끝까지 테스트할 수 없음 — Task 6의 통합 테스트는 소켓 이벤트를 직접 흉내내는 방식으로, Task 10은 참가자 없는 상태의 렌더링만 확인하는 것으로 범위를 명시적으로 좁힘
- **미결 사항**: 원거리 공격/도형별 판정, 실제 맵·캐릭터 에셋, 결과물 PDF 내보내기 — 전부 스펙 문서에 명시된 대로 이번 계획 범위 밖

## 구현 후 최종 리뷰(Opus) 반영 사항

10개 태스크 구현 완료 후 최종 전체 브랜치 리뷰에서 발견되어 수정한 것들 (커밋 `629bdc7`):

- **스펙에는 있었는데 이 계획에서 빠뜨린 것**: 스펙의 "에러 처리" 절이 "참가자 연결 끊김 → alive=false 처리"를 명시했는데, 정작 어느 태스크에도 배정이 안 돼서 구현이 통째로 빠졌었다. 리뷰에서 지적받고 `battle.js`/`session.js`에 disconnect 핸들러를 추가해 메꿨다 — 다음에 비슷한 계획을 쓸 때 스펙의 "에러 처리" 항목들이 전부 태스크에 배정됐는지 self-review 단계에서 한 번 더 대조해볼 것.
- **계획에 없던 실행 시점 버그**: `battle:input`/`weapon.damage`에 대한 입력 검증 부재(크래시·NaN 데미지), 대전 종료 후 `battleRoom` 상태 정리 누락, 대전 단계를 벗어나도 틱 루프가 안 멈추던 문제, 시간 초과 승자 판정이 죽은 참가자를 포함하던 문제 — 전부 순수 함수 테스트만으로는 못 잡고 리뷰에서 발견됨 (참고: 소켓 I/O 경계, 생명주기 정리는 순수 함수 테스트의 사각지대라는 교훈).
- 상세 내용은 최종 리뷰 결과 전문 참고(이 저장소 히스토리엔 별도 보관 안 함 — 커밋 메시지 `629bdc7`에 요약 있음).
