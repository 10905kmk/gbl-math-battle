# 배틀로얄 맵 — 배경 이미지 + 좌표 피커 인프라 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 직접 준비한 배경 이미지를 대전 화면에 붙이고, 벽/스폰 좌표를 이미지 보면서 직접 뽑을 수 있는 좌표 피커 도구까지 갖춘 맵 인프라를 만든다.

**Architecture:** 맵 설정(`DEFAULT_MAP`)을 `shapes/battleMap.js` 하나로 통합해 프론트엔드/백엔드가 같은 파일을 그대로 import하게 만들고(아레나 크기 중복 하드코딩 제거), 물리 엔진은 `room.arenaSize`를 따르도록, 프론트엔드는 배경 이미지를 로드해 렌더링하도록 바꾼다. 실제 좌표 지정은 별도 독립 HTML 도구로 지원한다.

**Tech Stack:** Node.js(순수 함수 + `node:assert` 기반 `.mjs` 테스트), Preact + htm(빌드 없음), Konva(`Konva.Image`), 좌표 피커는 프레임워크 없는 순수 HTML/Canvas/JS.

## Global Constraints

- `shapes/`는 프론트엔드(브라우저, 상대경로 import)와 백엔드(Node) 양쪽이 공유하는 순수 로직 폴더다 — 새 맵 설정 파일은 반드시 여기 둔다(`weaponRenderer.js`와 같은 패턴).
- `DEFAULT_MAP` 구조는 정확히 `{ arenaSize: {width, height}, imagePath: string, walls: [{x,y,width,height}], spawnPoints: [{x,y}] }`여야 한다 — 필드명이 이 계획의 모든 태스크에서 그대로 쓰인다.
- 기존 플레이스홀더 좌표값(벽 3개, 스폰 8개)은 리팩터링 중 값을 바꾸지 않고 그대로 옮긴다.
- 전투 상수(`CHARACTER_RADIUS=20`, `MOVE_SPEED=4`, `ATTACK_HITBOX_SIZE=30`, `ATTACK_COOLDOWN_MS=500`)는 이번 스펙에서 변경하지 않는다 — 아레나 크기와 무관하게 고정.
- `imagePath`가 아직 존재하지 않는 파일을 가리켜도(사용자가 이미지를 준비하기 전) 게임이 깨지면 안 된다 — 로드 실패 시 조용히 폴백.
- 벽(walls)은 게임 화면에서 더 이상 시각적으로 그리지 않는다 — 배경 이미지가 실제 그림을 담당하고, walls는 서버 충돌판정 전용 데이터가 된다.
- 좌표 피커 도구(`tools/map-coordinate-picker.html`)는 서버나 빌드 없이 `file://`로 단독 실행 가능해야 한다.
- 이 프로젝트는 빌드 스텝이 없다(`frontend/index.html`의 importmap으로 esm.sh CDN에서 바로 로드) — 새/수정 파일은 문법만 맞으면 된다.

---

### Task 1: 맵 설정을 `shapes/battleMap.js`로 이동·통합

**Files:**
- Create: `shapes/battleMap.js`
- Create: `shapes/battleMap.test.mjs`
- Delete: `backend/lib/battleMap.js`
- Modify: `backend/socket/battle.js` (import 경로 + `SPAWN_POINTS` 사용 변경)

**Interfaces:**
- Consumes: 없음(이 계획의 최하위 데이터 계층).
- Produces: `DEFAULT_MAP`(named export) — `{ arenaSize: {width, height}, imagePath, walls: [{x,y,width,height}], spawnPoints: [{x,y}] }`. Task 2/3이 `shapes/battleMap.js`에서 이 값을 import해서 쓴다.

- [ ] **Step 1: 새 테스트 작성(RED)**

`shapes/battleMap.test.mjs`를 새로 만든다:

```js
import assert from 'node:assert';
import { DEFAULT_MAP } from './battleMap.js';

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// arenaSize — {width, height} 양의 숫자쌍
assert.ok(isFiniteNumber(DEFAULT_MAP.arenaSize.width), 'arenaSize.width는 유한한 숫자여야 함');
assert.ok(isFiniteNumber(DEFAULT_MAP.arenaSize.height), 'arenaSize.height는 유한한 숫자여야 함');
assert.ok(DEFAULT_MAP.arenaSize.width > 0 && DEFAULT_MAP.arenaSize.height > 0, 'arenaSize는 양수여야 함');
console.log('DEFAULT_MAP.arenaSize shape: OK');

// imagePath — 문자열
assert.strictEqual(typeof DEFAULT_MAP.imagePath, 'string', 'imagePath는 문자열이어야 함');
console.log('DEFAULT_MAP.imagePath shape: OK');

// walls — {x, y, width, height} 객체 배열
assert.ok(Array.isArray(DEFAULT_MAP.walls), 'walls는 배열이어야 함');
DEFAULT_MAP.walls.forEach((w, i) => {
  assert.ok(isFiniteNumber(w.x), `walls[${i}].x는 유한한 숫자여야 함`);
  assert.ok(isFiniteNumber(w.y), `walls[${i}].y는 유한한 숫자여야 함`);
  assert.ok(isFiniteNumber(w.width) && w.width > 0, `walls[${i}].width는 양의 숫자여야 함`);
  assert.ok(isFiniteNumber(w.height) && w.height > 0, `walls[${i}].height는 양의 숫자여야 함`);
});
console.log('DEFAULT_MAP.walls shape: OK');

// spawnPoints — {x, y} 객체 배열, 최소 1개 이상
assert.ok(Array.isArray(DEFAULT_MAP.spawnPoints), 'spawnPoints는 배열이어야 함');
assert.ok(DEFAULT_MAP.spawnPoints.length > 0, 'spawnPoints는 최소 1개 이상이어야 함');
DEFAULT_MAP.spawnPoints.forEach((p, i) => {
  assert.ok(isFiniteNumber(p.x), `spawnPoints[${i}].x는 유한한 숫자여야 함`);
  assert.ok(isFiniteNumber(p.y), `spawnPoints[${i}].y는 유한한 숫자여야 함`);
});
console.log('DEFAULT_MAP.spawnPoints shape: OK');

console.log('battleMap.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node shapes/battleMap.test.mjs`
Expected: FAIL — `./battleMap.js`가 아직 `shapes/` 안에 없어서 모듈을 찾을 수 없다는 에러(`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: `shapes/battleMap.js` 생성(GREEN)**

```js
// 실제 맵 에셋이 아직 없어서 walls/spawnPoints는 플레이스홀더 — tools/map-coordinate-picker.html로
// 실제 배경 이미지를 보면서 좌표를 직접 지정한 뒤 이 파일만 교체하면 된다.
// 프론트엔드(브라우저)와 백엔드(Node) 양쪽이 이 파일을 그대로 import해서 쓴다(shapes/는 두
// 런타임이 공유하는 순수 로직 폴더, weaponRenderer.js와 같은 패턴) — arenaSize를 두 군데에
// 따로 하드코딩해서 값이 어긋나는 사고를 막기 위한 단일 소스.
export const DEFAULT_MAP = {
  arenaSize: { width: 800, height: 600 },
  // 아직 실제 이미지 파일이 없다 — frontend/assets/maps/에 파일을 넣고 이 경로만 맞추면 된다.
  // 파일이 없는 동안은 프론트엔드가 조용히 어두운 배경색으로 폴백한다(게임은 깨지지 않음).
  imagePath: '/assets/maps/battle-map.png',
  walls: [
    { x: 350, y: 250, width: 100, height: 20 },
    { x: 100, y: 100, width: 20, height: 150 },
    { x: 680, y: 350, width: 20, height: 150 },
  ],
  spawnPoints: [
    { x: 60, y: 60 },
    { x: 740, y: 60 },
    { x: 60, y: 540 },
    { x: 740, y: 540 },
    { x: 400, y: 550 },
    { x: 400, y: 60 },
    { x: 60, y: 300 },
    { x: 740, y: 300 },
  ],
};
```

- [ ] **Step 4: 옛 파일 삭제**

```bash
rm backend/lib/battleMap.js
```

- [ ] **Step 5: `backend/socket/battle.js`의 import/사용처 수정**

`backend/socket/battle.js` 맨 위의 import 줄을 찾아 교체한다:

기존:
```js
import { DEFAULT_MAP, SPAWN_POINTS } from '../lib/battleMap.js';
```

새로 교체:
```js
import { DEFAULT_MAP } from '../../shapes/battleMap.js';
```

같은 파일에서 `SPAWN_POINTS`를 쓰는 줄을 찾아 교체한다:

기존:
```js
    const spawn = SPAWN_POINTS[i % SPAWN_POINTS.length];
```

새로 교체:
```js
    const spawn = DEFAULT_MAP.spawnPoints[i % DEFAULT_MAP.spawnPoints.length];
```

- [ ] **Step 6: 새 테스트 통과 확인 + 전체 회귀**

Run:
```bash
node shapes/battleMap.test.mjs
for f in shapes/*.test.mjs backend/lib/*.test.mjs backend/routes/*.test.mjs backend/socket/*.test.mjs; do node "$f" || echo "FAILED: $f"; done
```
Expected: `battleMap.test.mjs: OK`가 출력되고, 회귀 루프에서 `FAILED:` 줄이 하나도 없어야 한다(특히 `battleIntegration.test.mjs`가 새 import 경로로도 그대로 통과하는지가 핵심).

- [ ] **Step 7: 커밋**

```bash
git add shapes/battleMap.js shapes/battleMap.test.mjs backend/socket/battle.js
git rm backend/lib/battleMap.js
git commit -m "refactor: 맵 설정을 shapes/battleMap.js로 이동해 프론트/백엔드 단일 소스로 통합"
```

---

### Task 2: 물리 엔진이 `room.arenaSize`를 따르도록 변경

**Files:**
- Modify: `backend/lib/battleSimulation.js`
- Modify: `backend/lib/battleSimulation.test.mjs`
- Modify: `backend/socket/battle.js`
- Modify: `backend/socket/battleIntegration.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `shapes/battleMap.js`의 `DEFAULT_MAP.arenaSize`.
- Produces: `stepSimulation(room, now)`가 이제 `room.arenaSize`(`{width, height}`)가 있어야 정상 동작한다(없으면 `moveOne` 내부에서 `undefined.width` 접근으로 에러 — 이 계획 안에서는 항상 `battle.js`가 채워주므로 문제 없음). `battleRoom.arenaSize`가 `DEFAULT_MAP.arenaSize`와 같은 값으로 채워진다 — Task 3의 프론트엔드가 이 필드를 신뢰하지 않고 대신 같은 `DEFAULT_MAP`을 직접 import하지만(마운트 시점 동기 접근을 위해), 서버 쪽 진실은 이 필드다.

- [ ] **Step 1: 회귀 테스트 작성(RED)**

`backend/lib/battleSimulation.test.mjs`에서 `makeRoom` 헬퍼를 찾아 기본값에 `arenaSize`를 추가한다:

기존:
```js
function makeRoom(players, overrides) {
  return { status: 'active', endsAt: 1_000_000, players, walls: [], ...overrides };
}
```

새로 교체:
```js
function makeRoom(players, overrides) {
  return { status: 'active', endsAt: 1_000_000, players, walls: [], arenaSize: { width: 800, height: 600 }, ...overrides };
}
```

파일 맨 끝(`console.log('battleSimulation.test.mjs: OK');` 바로 앞)에 새 테스트 블록을 추가한다:

```js
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
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node backend/lib/battleSimulation.test.mjs`
Expected: FAIL — `next.players.p1.x`가 `80`이 아니라 모듈 상수 `ARENA_SIZE.width - CHARACTER_RADIUS`(`800-20=780`)에 가까운 값이 나와서 assert 실패.

- [ ] **Step 3: `battleSimulation.js` 수정(GREEN)**

파일 맨 위의 `ARENA_SIZE` export를 제거한다:

기존:
```js
export const ARENA_SIZE = { width: 800, height: 600 };
export const CHARACTER_RADIUS = 20;
```

새로 교체:
```js
export const CHARACTER_RADIUS = 20;
```

`moveOne` 함수를 찾아 `arenaSize` 파라미터를 받도록 바꾼다:

기존:
```js
function moveOne(player, walls) {
  const input = player.input ?? {};
  const move = normalizeIfLong(input.moveX ?? 0, input.moveY ?? 0);
  const dx = move.x * MOVE_SPEED;
  const dy = move.y * MOVE_SPEED;

  let x = clamp(player.x + dx, CHARACTER_RADIUS, ARENA_SIZE.width - CHARACTER_RADIUS);
  let y = clamp(player.y + dy, CHARACTER_RADIUS, ARENA_SIZE.height - CHARACTER_RADIUS);
```

새로 교체:
```js
function moveOne(player, walls, arenaSize) {
  const input = player.input ?? {};
  const move = normalizeIfLong(input.moveX ?? 0, input.moveY ?? 0);
  const dx = move.x * MOVE_SPEED;
  const dy = move.y * MOVE_SPEED;

  let x = clamp(player.x + dx, CHARACTER_RADIUS, arenaSize.width - CHARACTER_RADIUS);
  let y = clamp(player.y + dy, CHARACTER_RADIUS, arenaSize.height - CHARACTER_RADIUS);
```

`stepSimulation` 안에서 `moveOne`을 호출하는 줄을 찾아 `room.arenaSize`를 같이 넘기도록 바꾼다:

기존:
```js
    players[id] = p.connected ? applyAim(moveOne(p, room.walls)) : { ...p };
```

새로 교체:
```js
    players[id] = p.connected ? applyAim(moveOne(p, room.walls, room.arenaSize)) : { ...p };
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `node backend/lib/battleSimulation.test.mjs`
Expected: 모든 `console.log(...: OK)` 라인이 출력되고 `battleSimulation.test.mjs: OK`로 끝난다.

- [ ] **Step 5: `battle.js`가 room에 `arenaSize`를 채우도록 수정 + 회귀 테스트(RED→GREEN)**

`backend/socket/battleIntegration.test.mjs` 맨 위 import 줄에 `DEFAULT_MAP`을 추가한다:

기존:
```js
import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';
import { getBattleRoom, stopBattleRoom, startBattleRoom } from './battle.js';
```

새로 교체:
```js
import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';
import { getBattleRoom, stopBattleRoom, startBattleRoom } from './battle.js';
import { DEFAULT_MAP } from '../../shapes/battleMap.js';
```

`console.log('battle room initialized from participants: OK');` 바로 다음 줄에 새 검증을 추가한다:

기존:
```js
assert.strictEqual(room.status, 'active');
console.log('battle room initialized from participants: OK');
```

새로 교체:
```js
assert.strictEqual(room.status, 'active');
console.log('battle room initialized from participants: OK');

assert.deepStrictEqual(room.arenaSize, DEFAULT_MAP.arenaSize, 'battle room의 arenaSize가 DEFAULT_MAP.arenaSize와 일치해야 함');
console.log('battle room carries arenaSize from DEFAULT_MAP: OK');
```

먼저 이 상태로 실행해서 실패를 확인한다.

Run: `node backend/socket/battleIntegration.test.mjs`
Expected: FAIL — `room.arenaSize`가 `undefined`라 `deepStrictEqual`이 실패.

이제 `backend/socket/battle.js`에서 `battleRoom` 생성 부분을 찾아 수정한다:

기존:
```js
  battleRoom = {
    status: 'active',
    endsAt: Date.now() + BATTLE_DURATION_MS,
    players,
    walls: DEFAULT_MAP.walls,
  };
```

새로 교체:
```js
  battleRoom = {
    status: 'active',
    endsAt: Date.now() + BATTLE_DURATION_MS,
    players,
    walls: DEFAULT_MAP.walls,
    arenaSize: DEFAULT_MAP.arenaSize,
  };
```

- [ ] **Step 6: 테스트 실행 → 통과 확인 + 전체 회귀**

Run:
```bash
node backend/socket/battleIntegration.test.mjs
for f in shapes/*.test.mjs backend/lib/*.test.mjs backend/routes/*.test.mjs backend/socket/*.test.mjs; do node "$f" || echo "FAILED: $f"; done
```
Expected: 두 명령 모두 `FAILED:` 없이 전부 통과.

- [ ] **Step 7: 커밋**

```bash
git add backend/lib/battleSimulation.js backend/lib/battleSimulation.test.mjs backend/socket/battle.js backend/socket/battleIntegration.test.mjs
git commit -m "feat: 물리 엔진 경계 판정이 모듈 상수 대신 room.arenaSize를 따르도록 변경"
```

---

### Task 3: 프론트엔드 배경 이미지 렌더링 + 아레나 크기 단일 소스화

**Files:**
- Modify: `frontend/src/screens/battle.js`

**Interfaces:**
- Consumes: Task 1의 `shapes/battleMap.js`의 `DEFAULT_MAP`(`arenaSize`, `imagePath`).
- Produces: 없음(화면 최상위 컴포넌트).

이 태스크는 프론트엔드 Konva 렌더링이라 이 프로젝트의 기존 관례(자동화된 프론트 테스트 없음)에 따라 문법 검증 + 라이브 검증으로 확인한다.

- [ ] **Step 1: import 추가 + `ARENA_SIZE` 모듈 상수 제거**

`frontend/src/screens/battle.js` 맨 위를 찾아 교체한다:

기존:
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
```

새로 교체:
```js
import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import Konva from 'konva';
import { drawWeaponGroup } from '../../../shapes/weaponRenderer.js';
import { DEFAULT_MAP } from '../../../shapes/battleMap.js';
import { VirtualJoystick } from './VirtualJoystick.js';

const html = htm.bind(h);

const CHARACTER_RADIUS = 20;
```

- [ ] **Step 2: `selfPosRef` 기본값과 Konva Stage 생성부를 `DEFAULT_MAP.arenaSize` 기준으로 바꾸고 배경 이미지 로딩 추가**

기존:
```js
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
```

새로 교체:
```js
  const selfPosRef = useRef({ x: DEFAULT_MAP.arenaSize.width / 2, y: DEFAULT_MAP.arenaSize.height / 2 });

  useEffect(() => {
    const stage = new Konva.Stage({
      container: containerRef.current,
      width: DEFAULT_MAP.arenaSize.width,
      height: DEFAULT_MAP.arenaSize.height,
    });
    const layer = new Konva.Layer();
    stage.add(layer);
    layerRef.current = layer;
    stageRef.current = stage;

    // 배경 이미지 — 아직 파일이 없거나 로드에 실패해도(onerror) 아무 것도 하지 않고
    // .battle-arena의 어두운 배경색이 그대로 보이게 조용히 폴백한다(게임이 깨지면 안 됨).
    const bgImage = new Image();
    bgImage.onload = () => {
      const bg = new Konva.Image({
        image: bgImage,
        x: 0,
        y: 0,
        width: DEFAULT_MAP.arenaSize.width,
        height: DEFAULT_MAP.arenaSize.height,
      });
      layer.add(bg);
      bg.moveToBottom();
      layer.draw();
    };
    bgImage.onerror = () => {};
    bgImage.src = DEFAULT_MAP.imagePath;

    return () => stage.destroy();
  }, []);
```

- [ ] **Step 3: 벽 시각화 제거**

기존:
```js
      if (layer.find('.wall').length === 0) {
        room.walls.forEach((w) => {
          layer.add(new Konva.Rect({ x: w.x, y: w.y, width: w.width, height: w.height, fill: '#555', name: 'wall' }));
        });
      }

      Object.values(room.players).forEach((p) => {
```

새로 교체:
```js
      // 벽은 배경 이미지에 실제 그림으로 이미 표현돼 있다고 가정하고, 여기서는 시각적으로
      // 그리지 않는다 — room.walls는 서버 충돌판정 전용 데이터.
      Object.values(room.players).forEach((p) => {
```

- [ ] **Step 4: 무기 아이콘 아레나 경계 clamp를 `DEFAULT_MAP.arenaSize` 기준으로 변경**

기존:
```js
        entry.weaponGroup.x(Math.min(ARENA_SIZE.width, Math.max(0, p.x + aimX * WEAPON_OFFSET)));
        entry.weaponGroup.y(Math.min(ARENA_SIZE.height, Math.max(0, p.y + aimY * WEAPON_OFFSET)));
```

새로 교체:
```js
        entry.weaponGroup.x(Math.min(DEFAULT_MAP.arenaSize.width, Math.max(0, p.x + aimX * WEAPON_OFFSET)));
        entry.weaponGroup.y(Math.min(DEFAULT_MAP.arenaSize.height, Math.max(0, p.y + aimY * WEAPON_OFFSET)));
```

- [ ] **Step 5: 문법 검증 + 전체 백엔드 회귀(공유 모듈이 안 깨졌는지 재확인)**

Run:
```bash
node --check frontend/src/screens/battle.js
for f in shapes/*.test.mjs backend/lib/*.test.mjs backend/routes/*.test.mjs backend/socket/*.test.mjs; do node "$f" || echo "FAILED: $f"; done
```
Expected: 문법 검증은 조용히 exit code 0, 회귀 루프는 `FAILED:` 없이 전부 통과.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/screens/battle.js
git commit -m "feat: 대전 화면에 배경 이미지 렌더링 추가, 아레나 크기를 shapes/battleMap.js 단일 소스로 통일"
```

---

### Task 4: 좌표 피커 도구

**Files:**
- Create: `tools/map-coordinate-picker.html`

**Interfaces:**
- Consumes: 없음(다른 태스크 코드와 독립적인 개발자 전용 정적 페이지).
- Produces: 없음(게임에 배포되지 않음).

이 태스크는 게임 서버/빌드와 무관한 순수 정적 HTML 파일이라 자동화 테스트가 없다(스펙의 스코프 제외 항목) — 브라우저로 직접 열어 라이브 검증한다.

- [ ] **Step 1: 도구 작성**

`tools/map-coordinate-picker.html`을 새로 만든다:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<title>맵 좌표 피커</title>
<style>
  body { font-family: sans-serif; background: #222; color: #eee; margin: 0; padding: 1rem; }
  #controls { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; }
  button { background: #444; color: #eee; border: 1px solid #666; border-radius: 4px; padding: 0.4rem 0.8rem; cursor: pointer; }
  button:hover { background: #555; }
  #canvasWrap { overflow: auto; max-width: 100%; border: 1px solid #555; }
  canvas { display: block; cursor: crosshair; }
  #output { white-space: pre; background: #111; color: #9f9; padding: 0.75rem; margin-top: 0.75rem; overflow-x: auto; font-family: monospace; font-size: 0.85rem; }
  .mode-label { padding: 0.3rem 0.6rem; border: 1px solid #666; border-radius: 4px; cursor: pointer; }
  .mode-label.active { background: #2ecc71; color: #111; border-color: #2ecc71; }
</style>
</head>
<body>
  <h1>맵 좌표 피커</h1>
  <p>이미지를 불러온 뒤, "벽" 모드에서는 드래그로 사각형을, "스폰" 모드에서는 클릭으로 점을 찍으세요. 아래 출력을 그대로 <code>shapes/battleMap.js</code>에 붙여넣으면 됩니다.</p>
  <div id="controls">
    <input type="file" id="fileInput" accept="image/*" />
    <span class="mode-label active" id="wallModeLabel">벽 모드</span>
    <span class="mode-label" id="spawnModeLabel">스폰 모드</span>
    <button id="undoBtn">실행취소</button>
    <button id="clearBtn">초기화</button>
    <button id="copyBtn">복사</button>
  </div>
  <div id="canvasWrap">
    <canvas id="canvas" width="800" height="600"></canvas>
  </div>
  <pre id="output"></pre>

  <script>
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const fileInput = document.getElementById('fileInput');
    const wallModeLabel = document.getElementById('wallModeLabel');
    const spawnModeLabel = document.getElementById('spawnModeLabel');
    const undoBtn = document.getElementById('undoBtn');
    const clearBtn = document.getElementById('clearBtn');
    const copyBtn = document.getElementById('copyBtn');
    const output = document.getElementById('output');

    let image = null;
    let mode = 'wall'; // 'wall' | 'spawn'
    let walls = [];
    let spawnPoints = [];
    let dragStart = null;
    let dragCurrent = null;

    function setMode(next) {
      mode = next;
      wallModeLabel.classList.toggle('active', mode === 'wall');
      spawnModeLabel.classList.toggle('active', mode === 'spawn');
    }
    wallModeLabel.addEventListener('click', () => setMode('wall'));
    spawnModeLabel.addEventListener('click', () => setMode('spawn'));

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const img = new Image();
      img.onload = () => {
        image = img;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        redraw();
      };
      img.src = URL.createObjectURL(file);
    });

    function redraw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (image) ctx.drawImage(image, 0, 0);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#e74c3c';
      ctx.fillStyle = 'rgba(231, 76, 60, 0.3)';
      walls.forEach((w) => {
        ctx.fillRect(w.x, w.y, w.width, w.height);
        ctx.strokeRect(w.x, w.y, w.width, w.height);
      });
      ctx.fillStyle = '#3498db';
      spawnPoints.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fill();
      });
      if (mode === 'wall' && dragStart && dragCurrent) {
        const x = Math.min(dragStart.x, dragCurrent.x);
        const y = Math.min(dragStart.y, dragCurrent.y);
        const width = Math.abs(dragCurrent.x - dragStart.x);
        const height = Math.abs(dragCurrent.y - dragStart.y);
        ctx.strokeStyle = '#f1c40f';
        ctx.fillStyle = 'rgba(241, 196, 15, 0.25)';
        ctx.fillRect(x, y, width, height);
        ctx.strokeRect(x, y, width, height);
      }
      updateOutput();
    }

    function canvasPoint(e) {
      const rect = canvas.getBoundingClientRect();
      // canvas가 CSS로 확대/축소돼 있어도(지금은 안 그러지만 방어적으로) 실제 픽셀 좌표로
      // 환산 — naturalWidth 기준 canvas.width와 화면에 보이는 rect.width가 다를 수 있음.
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY),
      };
    }

    canvas.addEventListener('mousedown', (e) => {
      const p = canvasPoint(e);
      if (mode === 'wall') {
        dragStart = p;
        dragCurrent = p;
      } else {
        spawnPoints.push(p);
        redraw();
      }
    });
    canvas.addEventListener('mousemove', (e) => {
      if (mode === 'wall' && dragStart) {
        dragCurrent = canvasPoint(e);
        redraw();
      }
    });
    canvas.addEventListener('mouseup', (e) => {
      if (mode === 'wall' && dragStart) {
        const end = canvasPoint(e);
        const x = Math.min(dragStart.x, end.x);
        const y = Math.min(dragStart.y, end.y);
        const width = Math.abs(end.x - dragStart.x);
        const height = Math.abs(end.y - dragStart.y);
        if (width > 2 && height > 2) {
          walls.push({ x, y, width, height });
        }
        dragStart = null;
        dragCurrent = null;
        redraw();
      }
    });

    undoBtn.addEventListener('click', () => {
      if (mode === 'wall') walls.pop();
      else spawnPoints.pop();
      redraw();
    });
    clearBtn.addEventListener('click', () => {
      walls = [];
      spawnPoints = [];
      redraw();
    });
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(output.textContent);
    });

    function formatArray(name, items) {
      const lines = items.map((it) => '    ' + JSON.stringify(it).replace(/"([a-zA-Z]+)":/g, '$1:'));
      return `  ${name}: [\n${lines.join(',\n')}${items.length ? ',' : ''}\n  ],`;
    }

    function updateOutput() {
      const sizeLine = image
        ? `  arenaSize: { width: ${canvas.width}, height: ${canvas.height} },`
        : '  arenaSize: { width: 800, height: 600 },';
      output.textContent =
        '{\n' + sizeLine + '\n' +
        formatArray('walls', walls) + '\n' +
        formatArray('spawnPoints', spawnPoints) + '\n' +
        '}';
    }

    redraw();
  </script>
</body>
</html>
```

- [ ] **Step 2: 라이브 검증**

브라우저로 `tools/map-coordinate-picker.html`을 직접 연다(더블클릭 또는 `file://` 경로로). 아무 이미지 파일이나 하나 선택해서: (1) 벽 모드에서 드래그하면 노란 미리보기 → 놓으면 빨간 사각형으로 확정되고 아래 출력에 `walls` 항목이 추가되는지, (2) 스폰 모드로 전환 후 클릭하면 파란 점이 찍히고 출력에 `spawnPoints` 항목이 추가되는지, (3) 실행취소/초기화/복사 버튼이 각각 의도대로 동작하는지, (4) 브라우저 콘솔에 에러가 없는지 확인한다.

- [ ] **Step 3: 커밋**

```bash
git add tools/map-coordinate-picker.html
git commit -m "feat: 맵 벽/스폰 좌표를 이미지 보면서 뽑는 좌표 피커 도구 추가"
```

---

## Self-Review 메모 (계획 작성자 기록)

- **스펙 커버리지**: 맵 설정 단일화(Task 1) / 물리 엔진 `room.arenaSize`(Task 2) / 배경 이미지 렌더링 + 벽 비가시화(Task 3) / 좌표 피커 도구(Task 4) / 스코프 제외 항목(계획에 실제 맵 아트 제작, 사각형 이외 벽 모양, 전투 상수 스케일링, 다중 맵 관련 태스크 없음 — Global Constraints에 명시) / 테스트 범위(각 태스크의 Step이 스펙의 "테스트 범위" 섹션과 1:1 대응) — 스펙의 모든 섹션이 태스크로 커버됨.
- **타입/이름 일관성**: `DEFAULT_MAP.{arenaSize, imagePath, walls, spawnPoints}`, `room.arenaSize`, `moveOne(player, walls, arenaSize)` 시그니처를 Task 1~3 전체에서 동일하게 사용(교차 확인 완료).
- **라이브 검증**: 이 계획은 코드 구현까지만 다룬다. 실행 완료 후 사용자가 요청하면 Opus 최종 리뷰 + Playwright 라이브 검증(이 프로젝트의 기존 관례)을 별도로 진행한다.
