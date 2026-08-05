# 대전 화면 무기 표시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대전 화면에서 각 캐릭터가 자기가 제작한 무기(도형 조합)를 작게 들고 있는 것처럼 보이게 한다.

**Architecture:** 무기 부품 배열(bounding box 계산 + Konva 그리기)을 `shapes/weaponRenderer.js`에 순수 함수 + Konva 함수로 분리해서 만들고(백엔드는 import 안 함, 프론트/미래의 result-page가 재사용), `backend/socket/battle.js`가 `battleRoom.players[id].weaponParts`에 원본 부품 배열을 실어 기존 `battle:state` 브로드캐스트에 포함시키고, `frontend/src/screens/battle.js`가 캐릭터 노드 생성 시 한 번만 그려서 캐싱한 뒤 매 틱 `facing` 방향 오프셋만 갱신한다.

**Tech Stack:** Konva.js(프론트 렌더링), Node.js(백엔드), `node:assert` 기반 수작업 테스트 스크립트(이 프로젝트엔 테스트 프레임워크가 없음)

## Global Constraints

- `shapes/weaponRenderer.js`는 백엔드가 import하지 않는다 — Konva 의존성을 backend/에 끌어들이지 않기 위함 (spec "배치 확정" 절)
- 무기 아이콘 크기는 `targetSize` 기본값 20px(`CHARACTER_RADIUS`와 동일)로 무기 전체를 통째로 스케일한다 — 부품 각각이 아니라 무기 전체 bounding box 기준 (spec "`shapes/weaponRenderer.js` API" 절)
- 무기는 `facing` 방향으로 캐릭터 중심에서 오프셋되어 표시된다, 회전은 이번 스펙 범위 밖 (spec "스코프" 절)
- 존재하지 않는 shapeId를 가진 부품은 조용히 건너뛴다 — 대전 화면이 무기 하나 때문에 죽으면 안 됨 (spec "`shapes/weaponRenderer.js` API" 절)

---

### Task 1: `shapes/weaponRenderer.js` — bounding box 계산 + Konva 그리기

**Files:**
- Create: `shapes/weaponRenderer.js`
- Test: `shapes/weaponRenderer.test.mjs`

**Interfaces:**
- Consumes: `getShapeGeometry(shapeId, size=60)` (기존, `shapes/registry.js`) — `{ type: 'polygon', points: [{x,y},...] }` 또는 `{ type: 'triangles', triangles: [[{x,y},{x,y},{x,y}],...] }` 또는 `null`(존재하지 않는 shapeId) 반환
- Produces:
  - `computeWeaponBounds(parts: Array<{shapeId, x, y, rotation, scale}>) => { minX, minY, maxX, maxY, width, height }` — 순수 함수, Konva 의존 없음
  - `drawWeaponGroup(parts, { targetSize = 20 } = {}) => Konva.Group` — Task 3에서 사용

- [ ] **Step 1: 실패하는 테스트 작성 (computeWeaponBounds)**

`shapes/weaponRenderer.test.mjs`:
```js
import assert from 'node:assert';
import { computeWeaponBounds } from './weaponRenderer.js';

// 부품 없음 -> 전부 0
assert.deepStrictEqual(
  computeWeaponBounds([]),
  { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
);
console.log('computeWeaponBounds with no parts: OK');

// 삼각형 1개, 원점/무회전/scale=1 -> shapes.js의 trianglePoints(60) 그대로
{
  const bounds = computeWeaponBounds([{ shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 1 }]);
  assert.ok(Math.abs(bounds.width - 60) < 0.01, `width는 60이어야 함, 실제 ${bounds.width}`);
  assert.ok(Math.abs(bounds.height - 51.96) < 0.1, `height는 약 51.96이어야 함, 실제 ${bounds.height}`);
}
console.log('computeWeaponBounds single triangle at origin: OK');

// 정사각형을 45도 회전하면 대각선만큼 bounding box가 커져야 함 (60 -> 60*sqrt(2))
{
  const bounds = computeWeaponBounds([{ shapeId: 'square', x: 0, y: 0, rotation: 45, scale: 1 }]);
  const expected = 60 * Math.SQRT2;
  assert.ok(Math.abs(bounds.width - expected) < 0.5, `45도 회전한 정사각형의 width는 약 ${expected}이어야 함, 실제 ${bounds.width}`);
}
console.log('computeWeaponBounds accounts for rotation: OK');

// 서로 멀리 떨어진 부품 2개 -> 둘을 모두 감싸는 bounding box
{
  const bounds = computeWeaponBounds([
    { shapeId: 'square', x: 0, y: 0, rotation: 0, scale: 1 },
    { shapeId: 'square', x: 200, y: 0, rotation: 0, scale: 1 },
  ]);
  assert.ok(bounds.width > 230, `두 부품을 다 감싸는 넓은 bounding box여야 함, 실제 width ${bounds.width}`);
}
console.log('computeWeaponBounds spans multiple parts: OK');

// 존재하지 않는 shapeId는 조용히 건너뛴다 (크래시 없음)
{
  const bounds = computeWeaponBounds([{ shapeId: 'not-a-shape', x: 0, y: 0, rotation: 0, scale: 1 }]);
  assert.deepStrictEqual(bounds, { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 });
}
console.log('computeWeaponBounds ignores unknown shapeId: OK');

// 프랙탈(점이 많은 도형)도 정상 동작해야 함 — CanvasEditor.js 버그 수정 때 실측한 값과 동일
{
  const sierpinski = computeWeaponBounds([{ shapeId: 'sierpinski', x: 0, y: 0, rotation: 0, scale: 1 }]);
  assert.ok(Math.abs(sierpinski.width - 60) < 0.5, `sierpinski width, 실제 ${sierpinski.width}`);
  assert.ok(Math.abs(sierpinski.height - 52.0) < 0.5, `sierpinski height, 실제 ${sierpinski.height}`);

  const koch = computeWeaponBounds([{ shapeId: 'koch', x: 0, y: 0, rotation: 0, scale: 1 }]);
  assert.ok(Math.abs(koch.width - 60) < 0.5, `koch width, 실제 ${koch.width}`);
  assert.ok(Math.abs(koch.height - 69.3) < 0.5, `koch height, 실제 ${koch.height}`);
}
console.log('computeWeaponBounds handles fractals (many points): OK');

console.log('weaponRenderer.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node shapes/weaponRenderer.test.mjs`
Expected: `Cannot find module './weaponRenderer.js'` 등 모듈 없음 에러로 실패

- [ ] **Step 3: 구현**

`shapes/weaponRenderer.js`:
```js
import Konva from 'konva';
import { getShapeGeometry } from './registry.js';

// shapes.js/fractals.js의 좌표는 "원점 중심 로컬 좌표"다 — 부품의 x/y/rotation/scale을 적용해서
// 무기 전체 좌표계(제작 캔버스 기준) 상의 실제 위치로 변환한다. Konva가 노드를 그릴 때 쓰는
// transform(회전 -> 스케일 -> 이동)과 동일한 순서로 계산해야 CanvasEditor.js가 실제로 그리는
// 모습과 bounding box가 일치한다.
function transformPoint(point, part) {
  const scale = Number.isFinite(part.scale) ? part.scale : 1;
  const rotation = Number.isFinite(part.rotation) ? part.rotation : 0;
  const rad = (rotation * Math.PI) / 180;
  const sx = point.x * scale;
  const sy = point.y * scale;
  const rx = sx * Math.cos(rad) - sy * Math.sin(rad);
  const ry = sx * Math.sin(rad) + sy * Math.cos(rad);
  return { x: rx + (Number.isFinite(part.x) ? part.x : 0), y: ry + (Number.isFinite(part.y) ? part.y : 0) };
}

function partLocalPoints(part) {
  const geometry = getShapeGeometry(part.shapeId);
  if (!geometry) return null;
  return geometry.type === 'polygon' ? geometry.points : geometry.triangles.flat();
}

const EMPTY_BOUNDS = { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };

// 부품 전체를 감싸는 bounding box 계산 — 순수 함수, Konva 의존 없음. 존재하지 않는 shapeId를
// 가진 부품은 조용히 건너뛴다(대전 화면이 무기 하나 때문에 죽으면 안 됨).
export function computeWeaponBounds(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return { ...EMPTY_BOUNDS };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  parts.forEach((part) => {
    const localPoints = partLocalPoints(part);
    if (!localPoints) return;
    localPoints.forEach((lp) => {
      const p = transformPoint(lp, part);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });
  });

  if (minX === Infinity) return { ...EMPTY_BOUNDS };
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

// parts를 받아 Konva.Group으로 그려서 반환한다. Konva에 의존하므로 프론트에서만 import할 것 —
// 백엔드는 이 함수를 쓰지 않는다.
export function drawWeaponGroup(parts, { targetSize = 20 } = {}) {
  const group = new Konva.Group();
  if (!Array.isArray(parts) || parts.length === 0) return group;

  const bounds = computeWeaponBounds(parts);
  const maxDim = Math.max(bounds.width, bounds.height);
  const scale = maxDim > 0 ? targetSize / maxDim : 1;

  parts.forEach((part) => {
    const geometry = getShapeGeometry(part.shapeId);
    if (!geometry) return;
    const partScale = Number.isFinite(part.scale) ? part.scale : 1;
    const node = new Konva.Shape({
      x: ((Number.isFinite(part.x) ? part.x : 0) - bounds.minX) * scale,
      y: ((Number.isFinite(part.y) ? part.y : 0) - bounds.minY) * scale,
      rotation: Number.isFinite(part.rotation) ? part.rotation : 0,
      scaleX: partScale * scale,
      scaleY: partScale * scale,
      fill: '#8fd3ff',
      stroke: '#1a5f8a',
      strokeWidth: 1,
      sceneFunc: (ctx, shape) => {
        ctx.beginPath();
        if (geometry.type === 'polygon') {
          geometry.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.closePath();
        } else if (geometry.type === 'triangles') {
          geometry.triangles.forEach(([a, b, c]) => {
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.lineTo(c.x, c.y);
            ctx.closePath();
          });
        }
        ctx.fillStrokeShape(shape);
      },
    });
    group.add(node);
  });

  return group;
}
```

**계획 수정(구현 중 발견)**: 스펙/이 계획의 원안은 `drawWeaponGroup(parts, options)`가 파일 안에서 `import Konva from 'konva'`를 직접 하는 걸 전제로 했다. 실제로 테스트를 실행해보니 `shapes/weaponRenderer.js`를 Node에서 import하는 것 자체가(순수 함수인 `computeWeaponBounds`만 쓰더라도) `konva` 패키지를 못 찾아 즉시 실패했다 — 이 프로젝트에서 Konva는 브라우저 CDN import map으로만 존재하고 npm 패키지로 설치돼 있지 않기 때문. 그래서 `drawWeaponGroup(Konva, parts, options)`로 시그니처를 바꿔서, 호출 측(이미 자기 쪽에서 Konva를 import해둔 `battle.js`)이 자신의 Konva 참조를 넘겨주도록 했다. Task 3의 호출부도 이에 맞춰 `drawWeaponGroup(Konva, p.weaponParts, { targetSize: CHARACTER_RADIUS })`로 읽을 것.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node shapes/weaponRenderer.test.mjs`
Expected: `weaponRenderer.test.mjs: OK` 출력, exit code 0

- [ ] **Step 5: 커밋**

```bash
git add shapes/weaponRenderer.js shapes/weaponRenderer.test.mjs
git commit -m "feat: 무기 부품 bounding box 계산 + Konva 그리기 (shapes/weaponRenderer.js)"
```

---

### Task 2: `backend/socket/battle.js` — `weaponParts`를 `battle:state`에 포함

**Files:**
- Modify: `backend/socket/battle.js:26-44` (`startBattleRoom` 함수)
- Test: `backend/socket/battleIntegration.test.mjs` (확장)

**Interfaces:**
- Consumes: 없음(신규 인터페이스 소비 없음, 기존 `participant.weapon.parts` 필드 사용)
- Produces: `battleRoom.players[id].weaponParts` — `Array<{shapeId, x, y, rotation, scale}>` (참가자가 만든 무기 그대로, 없으면 빈 배열). Task 3이 `battle:state` 이벤트에서 이 필드를 읽는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/socket/battleIntegration.test.mjs`의 다음 블록(31번째 줄, `create:done` 호출 부분)을 아래로 교체:

```js
for (let i = 1; i <= 5; i += 1) {
  const parts = i === 1 ? [{ id: 'x1', shapeId: 'triangle', x: 100, y: 100, rotation: 0, scale: 1 }] : [];
  handlers[`p${i}`]['create:done']({ damage: 1000 * i, parts });
}
```

그리고 44번째 줄(`console.log('battle room initialized from participants: OK');`) 바로 다음에 추가:

```js
assert.deepStrictEqual(
  room.players.p1.weaponParts,
  [{ id: 'x1', shapeId: 'triangle', x: 100, y: 100, rotation: 0, scale: 1 }],
  'p1의 weapon.parts가 battleRoom.players.p1.weaponParts로 그대로 전달되어야 함',
);
assert.deepStrictEqual(room.players.p2.weaponParts, [], '무기 부품이 없으면 빈 배열이어야 함');
console.log('battle room carries weaponParts from participant weapon: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `timeout 5 node backend/socket/battleIntegration.test.mjs`
Expected: `room.players.p1.weaponParts`가 `undefined`라서 `AssertionError`로 실패

- [ ] **Step 3: 구현**

`backend/socket/battle.js`의 `startBattleRoom` 안, `players[participant.id] = {...}` 객체 리터럴(현재 33-43줄)에 필드 하나 추가 — `input: {...}` 다음 줄에:

```js
    players[participant.id] = {
      id: participant.id,
      characterId: CHARACTER_IDS[i % CHARACTER_IDS.length],
      x: spawn.x,
      y: spawn.y,
      facing: 'down',
      hp: 100,
      hitDamage: hitDamageFromWeaponDamage(participant.weapon?.damage),
      weaponParts: participant.weapon?.parts ?? [],
      alive: true,
      lastAttackAt: 0,
      input: { up: false, down: false, left: false, right: false, attack: false },
    };
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `timeout 5 node backend/socket/battleIntegration.test.mjs`
Expected: 모든 assert 통과, `battleIntegration.test.mjs: OK` 출력, exit code 0

- [ ] **Step 5: 회귀 확인 (다른 대전 관련 테스트도 함께)**

Run: `node backend/lib/battleSimulation.test.mjs && node backend/socket/session.createDone.test.mjs`
Expected: 둘 다 `OK`, exit code 0

- [ ] **Step 6: 커밋**

```bash
git add backend/socket/battle.js backend/socket/battleIntegration.test.mjs
git commit -m "feat: battleRoom.players에 weaponParts 추가해 battle:state로 브로드캐스트"
```

---

### Task 3: `frontend/src/screens/battle.js` — 캐릭터가 무기를 든 것처럼 그리기

**Files:**
- Modify: `frontend/src/screens/battle.js:1-87` (import 및 `onState` 핸들러)

**Interfaces:**
- Consumes: `drawWeaponGroup(parts, { targetSize })` (Task 1), `battleRoom.players[id].weaponParts` (Task 2)

- [ ] **Step 1: import 추가**

`frontend/src/screens/battle.js` 최상단 import 블록에 추가:

```js
import { drawWeaponGroup } from '../../../shapes/weaponRenderer.js';
```

- [ ] **Step 2: 캐릭터 노드 최초 생성 블록에 무기 그룹 추가**

`onState` 함수 안, `if (!entry) { ... }` 블록(현재 46-71줄)을 아래로 교체:

```js
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
          const hpBar = new Konva.Rect({
            x: p.x - CHARACTER_RADIUS, y: p.y - CHARACTER_RADIUS - 8,
            width: CHARACTER_RADIUS * 2, height: 4, fill: '#2ecc71',
          });
          const label = new Konva.Text({
            x: p.x - CHARACTER_RADIUS, y: p.y - 7,
            width: CHARACTER_RADIUS * 2,
            text: (p.characterId ?? '').replace('char', ''),
            fontSize: 14, fontStyle: 'bold', fill: '#fff', align: 'center',
          });
          // 참가자가 제작 화면에서 만든 무기를 작게 그려서 캐릭터 옆에 붙인다 — 무기는 대전 중
          // 안 바뀌므로(제작 단계에서 확정) 여기서 한 번만 그리고 이후엔 위치만 옮긴다.
          const weaponGroup = drawWeaponGroup(p.weaponParts, { targetSize: CHARACTER_RADIUS });
          layer.add(circle);
          layer.add(hpBar);
          layer.add(label);
          layer.add(weaponGroup);
          entry = { circle, hpBar, label, weaponGroup };
          nodesRef.current[p.id] = entry;
        }
```

- [ ] **Step 3: 매 틱 위치 갱신에 무기 오프셋 추가**

`onState` 함수 안, 노드 위치 갱신 블록(현재 72-80줄, `entry.circle.x(p.x);`로 시작하는 부분) 바로 다음에 추가:

```js
        // 공격 히트박스(backend/lib/battleSimulation.js의 attackHitboxRect)와 같은
        // facing -> 오프셋 매핑 — 캐릭터가 바라보는 쪽에 무기를 든 것처럼 보이게 한다.
        const WEAPON_OFFSET = CHARACTER_RADIUS + 4;
        const weaponOffset = {
          up: { x: 0, y: -WEAPON_OFFSET },
          down: { x: 0, y: WEAPON_OFFSET },
          left: { x: -WEAPON_OFFSET, y: 0 },
          right: { x: WEAPON_OFFSET, y: 0 },
        }[p.facing] ?? { x: WEAPON_OFFSET, y: 0 };
        entry.weaponGroup.x(p.x + weaponOffset.x);
        entry.weaponGroup.y(p.y + weaponOffset.y);
        entry.weaponGroup.opacity(p.alive ? 1 : 0.2);
```

- [ ] **Step 4: 문법 검증**

Run: `node --check frontend/src/screens/battle.js`
Expected: 에러 없이 종료

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/screens/battle.js
git commit -m "feat: 대전 화면에서 캐릭터가 자기 무기를 든 것처럼 표시"
```

---

### Task 4: 서버 기동 + Playwright로 실제 확인

**Files:** 없음 (검증 전용 태스크)

**Interfaces:** 없음

- [ ] **Step 1: MOCK_AI로 서버 기동**

Run:
```bash
cd backend && MOCK_AI=true node server.js > /tmp/gbl-weapon-render-server.log 2>&1 &
sleep 1.5
curl -s -o /dev/null -w "index: %{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "weaponRenderer.js: %{http_code}\n" http://localhost:3000/../shapes/weaponRenderer.js
```
Expected: 둘 다 200. (`weaponRenderer.js`는 `/shapes/weaponRenderer.js` 경로로 정적 서빙되고 있어야 함 — 이미 `server.js`가 `/shapes`를 정적 서빙하도록 되어 있음.)

- [ ] **Step 2: Playwright로 관리자 페이지 + 참가자 2명 접속, 학습→제작까지 진행**

- `http://localhost:3000/admin/` 접속, "세션 시작" → "다음 단계"(create로)
- 참가자 탭 2개를 열어 각각 도형(예: 삼각형, 시에르핀스키)을 캔버스에 배치하고 "AI 평가받기" 클릭해 무기 확정
- 관리자 페이지에서 "다음 단계"를 눌러 battle로 진입

- [ ] **Step 3: 대전 화면에서 무기 아이콘 확인**

- 참가자 탭에서 캐릭터 옆에 작은 도형(무기) 아이콘이 보이는지 스크린샷으로 확인
- 방향키로 캐릭터를 이동시키며 무기가 같이 따라오는지, `facing`이 바뀌면(예: 위쪽 이동 후 오른쪽 이동) 무기 위치도 그에 맞게 바뀌는지 확인
- 브라우저 콘솔에 에러가 없는지 확인(`mcp__playwright__browser_console_messages`)

- [ ] **Step 4: 서버 정리**

Run: `pkill -f "node server.js"`

- [ ] **Step 5: 발견된 버그가 있다면 해당 태스크로 돌아가 수정 후 여기서 재확인. 문제 없으면 완료 — 커밋 없음(이미 각 태스크에서 커밋됨)**

---

## Self-Review 메모 (계획 작성자용, 실행 시 참고)

- **스펙 커버리지**: `shapes/weaponRenderer.js`(Task 1), `battle.js`의 `weaponParts` 전달(Task 2), 프론트 표시+facing 오프셋(Task 3), 실제 확인(Task 4) — 스펙의 모든 섹션에 대응하는 태스크가 있음
- **의도적으로 범위 밖으로 둔 것**(스펙에 이미 명시): `create.js`/`result.js`에서 `weaponRenderer.js` 사용, 무기 회전, 부품 애니메이션 — 이번 플랜에 태스크 없음(의도된 것)
- **타입 일관성**: `computeWeaponBounds`/`drawWeaponGroup`의 시그니처가 스펙과 Task 1~3에서 동일(`parts`, `{ targetSize }`)
