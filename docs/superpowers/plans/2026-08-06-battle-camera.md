# 대전 화면 카메라 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대전 화면의 Konva `Stage`를 월드 크기(2176x1632) 대신 고정 뷰포트(800x600)로 만들고, 참가자 자기 캐릭터를 중심으로 따라다니되 맵 가장자리에서 멈추는 카메라를 붙인다.

**Architecture:** `Layer` 하나를 통째로 `-cameraX, -cameraY`만큼 이동시켜 카메라를 구현한다 — 노드(캐릭터/무기/배경이미지)는 지금처럼 월드 좌표 그대로 두고, 매 `battle:state` 갱신마다 카메라 오프셋만 다시 계산해서 레이어에 적용한다. 마우스 조준은 `getPointerPosition()`이 반환하는 뷰포트 좌표를 카메라 오프셋으로 월드 좌표로 변환한 뒤 계산한다.

**Tech Stack:** Preact + htm(빌드 없음), Konva(`Layer.x()/y()`로 카메라 구현).

## Global Constraints

- `VIEWPORT_SIZE = { width: 800, height: 600 }`(고정 상수) — Konva `Stage`는 이제 이 크기로 생성한다. `DEFAULT_MAP.arenaSize`(월드 크기, 지금 2176x1632)로 `Stage`를 생성하지 않는다.
- 카메라 계산: `cameraX = clamp(myX - VIEWPORT_SIZE.width/2, 0, max(0, worldWidth - VIEWPORT_SIZE.width))`, Y도 같은 방식(`VIEWPORT_SIZE.height/2`, `worldHeight - VIEWPORT_SIZE.height` 기준).
- 카메라는 보간(이징) 없이 매 상태 갱신마다 즉시 그 위치로 이동한다.
- 노드(캐릭터/무기 아이콘/배경 이미지)의 좌표 계산 로직 자체는 바뀌지 않는다 — 전부 월드 좌표 그대로.
- 카메라 줌, 이징, 다른 참가자 화면 고려, 화면 밖 컬링 최적화는 이번 스코프가 아니다.
- 이 프로젝트는 빌드 스텝이 없다 — 새/수정 파일은 문법만 맞으면 된다.
- 프론트엔드 Konva 렌더링 변경은 자동화 테스트가 없다(이 프로젝트의 기존 관례) — `node --check` 문법 검증 + Playwright 라이브 검증으로 확인한다.

---

### Task 1: 뷰포트 고정 + 카메라 구현 + 마우스 조준 좌표 변환

**Files:**
- Modify: `frontend/src/screens/battle.js`

**Interfaces:**
- Consumes: `DEFAULT_MAP.arenaSize`(`shapes/battleMap.js`, 이미 존재) — 카메라 clamp 상한 계산에 사용.
- Produces: 없음(화면 최상위 컴포넌트). 이 태스크가 끝나면 `battle.js` 안에 `VIEWPORT_SIZE`(모듈 상수), `cameraRef`(컴포넌트 내부 ref, `{x, y}`), `updateCamera(myX, myY)`(함수)가 생긴다 — Task 2는 이 이름들을 그대로 쓴다.

- [ ] **Step 1: `VIEWPORT_SIZE` 상수와 `clamp` 헬퍼 추가**

`frontend/src/screens/battle.js` 맨 위 상수 선언부(`const CHARACTER_RADIUS = 20;` 바로 아래)를 찾아 교체한다:

기존:
```js
const CHARACTER_RADIUS = 20;
```

새로 교체:
```js
const CHARACTER_RADIUS = 20;
// 화면에 실제로 보이는 영역(뷰포트) — 맵 전체 크기(DEFAULT_MAP.arenaSize, 지금 2176x1632)와는
// 별개로 고정이다. Konva Stage를 이 크기로 만들고, 카메라가 이 뷰포트 안에서 맵을 따라 움직인다.
const VIEWPORT_SIZE = { width: 800, height: 600 };

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
```

- [ ] **Step 2: Stage 크기를 뷰포트로 변경**

`useEffect(() => { const stage = new Konva.Stage({...` 블록을 찾아 교체한다:

기존:
```js
    const stage = new Konva.Stage({
      container: containerRef.current,
      width: DEFAULT_MAP.arenaSize.width,
      height: DEFAULT_MAP.arenaSize.height,
    });
```

새로 교체:
```js
    const stage = new Konva.Stage({
      container: containerRef.current,
      width: VIEWPORT_SIZE.width,
      height: VIEWPORT_SIZE.height,
    });
```

(배경 이미지(`Konva.Image`)와 캐릭터/무기 노드의 `width`/`height`/`x`/`y` 계산은 전부 그대로 둔다 — 월드 좌표 기준 그대로.)

- [ ] **Step 3: `cameraRef` 추가**

컴포넌트 맨 위 ref 선언부(`const selfPosRef = useRef(...)` 바로 아래)를 찾아 교체한다:

기존:
```js
  const selfPosRef = useRef({ x: DEFAULT_MAP.arenaSize.width / 2, y: DEFAULT_MAP.arenaSize.height / 2 });
```

새로 교체:
```js
  const selfPosRef = useRef({ x: DEFAULT_MAP.arenaSize.width / 2, y: DEFAULT_MAP.arenaSize.height / 2 });
  // 현재 카메라가 월드 좌표계에서 어디를 보고 있는지(뷰포트 왼쪽 위 모서리의 월드 좌표).
  // 마우스 조준 좌표 변환(뷰포트 좌표 -> 월드 좌표)에도 이 값이 필요해서 ref로 공유한다.
  const cameraRef = useRef({ x: 0, y: 0 });
```

- [ ] **Step 4: `updateCamera` 함수 추가 + `onState`에서 호출**

`updateAimFromPointer` 함수 선언 바로 앞(같은 컴포넌트 안 아무 곳이나 가능하지만, 관련 함수끼리 묶어 여기 둔다)에 새 함수를 추가한다. `updateAimFromPointer`가 시작되는 줄을 찾아 그 앞에 삽입한다:

기존(해당 줄 앞부분):
```js
  function updateAimFromPointer() {
```

새로 교체(함수를 하나 추가하고 기존 줄은 그대로 유지):
```js
  // 카메라 — 내 캐릭터(월드 좌표 myX, myY)가 화면 중앙에 오도록 레이어를 이동시키되, 맵
  // 가장자리에서는 그 이상 못 밀리게 clamp한다. cameraRef에 저장해두는 이유는
  // updateAimFromPointer가 뷰포트 좌표를 월드 좌표로 되돌릴 때 이 값이 필요하기 때문.
  function updateCamera(myX, myY) {
    const layer = layerRef.current;
    if (!layer) return;
    const maxX = Math.max(0, DEFAULT_MAP.arenaSize.width - VIEWPORT_SIZE.width);
    const maxY = Math.max(0, DEFAULT_MAP.arenaSize.height - VIEWPORT_SIZE.height);
    const cameraX = clamp(myX - VIEWPORT_SIZE.width / 2, 0, maxX);
    const cameraY = clamp(myY - VIEWPORT_SIZE.height / 2, 0, maxY);
    cameraRef.current = { x: cameraX, y: cameraY };
    layer.x(-cameraX);
    layer.y(-cameraY);
  }

  function updateAimFromPointer() {
```

이제 `onState` 안에서 내 캐릭터 위치를 갱신하는 부분을 찾아 `updateCamera`를 호출하도록 바꾼다. `updateCamera`는 그 틱의 `updateAimFromPointer`가 최신 카메라 값을 쓸 수 있도록 반드시 `updateAimFromPointer()` 호출보다 먼저 실행돼야 한다:

기존:
```js
        if (p.id === socket.id) {
          selfPosRef.current = { x: p.x, y: p.y };
          // 마우스가 가만히 있어도 내 캐릭터는 서버 틱마다 움직이므로, "캐릭터 -> 마우스"
          // 조준 방향도 그때마다 다시 계산해야 한다 — mousemove 이벤트에서만 갱신하면
          // 이동 중엔 조준이 마지막으로 마우스가 움직였던 순간에 멈춰버린다(Opus 리뷰
          // Important I2).
          updateAimFromPointer();
        }
```

새로 교체:
```js
        if (p.id === socket.id) {
          selfPosRef.current = { x: p.x, y: p.y };
          updateCamera(p.x, p.y);
          // 마우스가 가만히 있어도 내 캐릭터는 서버 틱마다 움직이므로, "캐릭터 -> 마우스"
          // 조준 방향도 그때마다 다시 계산해야 한다 — mousemove 이벤트에서만 갱신하면
          // 이동 중엔 조준이 마지막으로 마우스가 움직였던 순간에 멈춰버린다(Opus 리뷰
          // Important I2). updateCamera가 먼저 실행돼서 cameraRef가 이 틱 기준으로
          // 최신 상태여야 아래 updateAimFromPointer의 좌표 변환이 정확하다.
          updateAimFromPointer();
        }
```

- [ ] **Step 5: `updateAimFromPointer`가 뷰포트 좌표를 월드 좌표로 변환하도록 수정**

기존:
```js
  function updateAimFromPointer() {
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
```

새로 교체:
```js
  function updateAimFromPointer() {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const { x: sx, y: sy } = selfPosRef.current;
    // getPointerPosition()은 뷰포트(스테이지) 기준 좌표(0~800, 0~600)를 반환한다 —
    // 카메라 오프셋을 더해서 월드 좌표로 변환한 뒤에야 내 캐릭터(월드 좌표)와 정확히
    // 비교할 수 있다. 안 그러면 카메라가 원점(0,0)에서 벗어나는 순간 조준 방향이 어긋난다.
    const { x: camX, y: camY } = cameraRef.current;
    const worldPointerX = pointer.x + camX;
    const worldPointerY = pointer.y + camY;
    const dx = worldPointerX - sx;
    const dy = worldPointerY - sy;
    const len = Math.hypot(dx, dy);
    if (len < 1) return; // 캐릭터 위치와 거의 겹치면(1px 미만) 조준을 갱신하지 않음
    sendInput({ aimX: dx / len, aimY: dy / len });
  }
```

- [ ] **Step 6: 문법 검증 + 전체 백엔드 회귀(공유 모듈이 안 깨졌는지 재확인)**

Run:
```bash
node --check frontend/src/screens/battle.js
for f in shapes/*.test.mjs backend/lib/*.test.mjs backend/routes/*.test.mjs backend/socket/*.test.mjs; do node "$f" || echo "FAILED: $f"; done
```
Expected: 문법 검증은 조용히 exit code 0, 회귀 루프는 `FAILED:` 없이 전부 통과.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/screens/battle.js
git commit -m "feat: 대전 화면에 플레이어 추적 카메라 도입(뷰포트 800x600 고정)"
```

---

### Task 2: `--arena-width`를 뷰포트 기준으로 변경 + 라이브 검증

**Files:**
- Modify: `frontend/src/screens/battle.js`
- Modify: `frontend/src/screens/battle.css`(주석만)

**Interfaces:**
- Consumes: Task 1의 `VIEWPORT_SIZE`.
- Produces: 없음.

`.battle-arena`/`.battle-controls`의 CSS 크기 기준이 지금은 `DEFAULT_MAP.arenaSize.width`(월드 너비, 2176)로 잡혀 있어서 화면이 뷰포트보다 훨씬 커진다 — 뷰포트 너비(800, `VIEWPORT_SIZE.width`)로 바꾼다.

- [ ] **Step 1: `--arena-width` 값을 뷰포트 기준으로 변경**

`frontend/src/screens/battle.js`의 JSX return 부분에서 `--arena-width`를 설정하는 줄을 찾아 교체한다:

기존:
```js
    <div class="battle-shell" style=${{ '--arena-width': `${DEFAULT_MAP.arenaSize.width}px` }}>
```

새로 교체:
```js
    <div class="battle-shell" style=${{ '--arena-width': `${VIEWPORT_SIZE.width}px` }}>
```

- [ ] **Step 2: `battle.css`의 관련 주석을 뷰포트 기준으로 갱신(코드 동작은 안 바뀜, 설명만 최신화)**

`frontend/src/screens/battle.css`의 `.battle-controls` 규칙 위 주석을 찾아 교체한다:

기존:
```css
.battle-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* --arena-width는 battle.js가 DEFAULT_MAP.arenaSize.width로 인라인 설정한다(위 .battle-arena
     주석과 같은 이유로 하드코딩 대신 실제 아레나 크기를 따라감). 좁은 화면(부스 태블릿/폰)에서는
     뷰포트 폭 기준으로 줄여서, 이동 스틱이 화면 밖으로 밀려나 손이 안 닿는 걸 막는다. */
  width: min(var(--arena-width), 100vw - 3rem);
}
```

새로 교체:
```css
.battle-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* --arena-width는 battle.js가 VIEWPORT_SIZE.width(화면에 보이는 고정 뷰포트 너비, 맵 전체
     크기와는 별개)로 인라인 설정한다. 좁은 화면(부스 태블릿/폰)에서는 뷰포트 폭보다 더
     줄여서, 이동 스틱이 화면 밖으로 밀려나 손이 안 닿는 걸 막는다. */
  width: min(var(--arena-width), 100vw - 3rem);
}
```

- [ ] **Step 3: 문법 검증**

Run: `node --check frontend/src/screens/battle.js`
Expected: 조용히 exit code 0.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/screens/battle.js frontend/src/screens/battle.css
git commit -m "fix: 대전 화면 반응형 폭 기준을 월드 크기 대신 고정 뷰포트로 변경"
```

- [ ] **Step 5: 라이브 검증(Playwright 등)**

로컬 서버를 띄우고 브라우저로 대전 화면까지 진행한 뒤(참가자 여러 명을 시뮬레이션하거나 최소 1명으로 진행) 다음을 확인한다:

1. **뷰포트 크기**: `.battle-arena`가 800x600 근처 크기로 보이고(뷰포트보다 훨씬 큰 화면이 아님), 스크롤 없이 한 화면에 들어온다.
2. **카메라 추적**: WASD/화살표 또는 이동 조이스틱으로 캐릭터를 움직이면 화면(카메라)이 캐릭터를 따라간다 — 캐릭터가 항상 화면 중앙 근처에 있어야 한다.
3. **가장자리 clamp**: 캐릭터를 맵 가장자리(예: 좌상단 구석)까지 이동시키면, 카메라가 거기서 멈추고 캐릭터가 화면 중앙이 아니라 그 가장자리 쪽으로 치우쳐 보인다(맵 밖의 빈 공간이 보이면 안 됨).
4. **마우스 조준 정확도**: 카메라가 원점(0,0)에서 벗어난 상태(캐릭터가 맵 중앙 근처로 이동한 상태)에서 마우스를 특정 방향으로 움직였을 때, 무기 아이콘이 실제로 그 화면상 방향을 향하는지 확인한다(카메라 오프셋 변환이 틀리면 방향이 어긋나 보인다).

문제가 있으면 Task 1로 돌아가 수정한다.
