# 대전 본인 캐릭터 이동 클라이언트 예측 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대전 화면에서 본인이 조작하는 캐릭터의 이동만 클라이언트 예측(client-side prediction) + 서버 재조정(reconciliation)으로 그려서, 입력 지연("굼뜸")과 20Hz 틱 간격으로 인한 끊김을 체감상 없앤다.

**Architecture:** 서버(`backend/lib/battleSimulation.js`)는 지금처럼 이동/충돌/공격의 유일한 권위로 남는다. 클라이언트(`frontend/src/screens/battle.js`)는 본인 캐릭터에 한해 같은 이동 물리(이동속도 + 벽 충돌, 스킬 속도배율 제외)를 매 애니메이션 프레임마다 로컬로 재현해서 그리고, `battle:state`가 도착할 때마다 예측 위치를 서버 값 쪽으로 어긋난 만큼만 보정한다. 다른 참가자는 기존 보간(interpolation) 렌더링 그대로 둔다.

**Tech Stack:** Preact + htm + Konva(프론트, 번들러 없이 importmap으로 네이티브 ES 모듈 로드), Node.js + socket.io(백엔드). 테스트는 프레임워크 없이 `node xxx.test.mjs` + `node:assert`.

## Global Constraints

- 서버가 이동/충돌/공격 판정의 유일한 권위로 남는다 — 클라이언트 예측은 순전히 렌더링(화면에 보이는 위치) 레이어이고, `battle:input` 전송이나 서버 검증 로직은 건드리지 않는다.
- 범위는 본인 캐릭터의 "이동"만 — 공격/스킬 판정, 다른 참가자 위치 표시는 이번 계획에서 손대지 않는다.
- 스킬로 인한 속도 배율(`speedMultiplier`, `backend/lib/skillEngine.js`)은 클라이언트 예측에서 재현하지 않는다.
- 벽(`walls`)/아레나 크기(`arenaSize`)는 서버가 `battle:state`로 안 보내므로(`buildBattleStatePayload`가 `walls`를 명시적으로 제외) 프론트가 이미 갖고 있는 `shapes/battleMap.js`의 `DEFAULT_MAP`을 그대로 쓴다 — 새 소켓 이벤트나 서버 변경 없음.
- 프론트엔드는 번들러/테스트 러너가 없다(순수 ES 모듈을 브라우저가 그대로 로드). 새로 추가하는 순수 함수(`selfPrediction.js`)만 `node xxx.test.mjs` + `assert`로 단위 테스트하고, `battle.js` 통합은 이 프로젝트의 기존 관례대로 자동화 테스트 없이 `node --check`로 구문만 검증한 뒤 라이브 검증으로 넘긴다.
- 코드 주석은 WHAT이 아니라 비자명한 WHY만, 이 코드베이스의 기존 한국어 주석 밀도/톤에 맞춘다.

---

## 파일 구조

- **신규** `frontend/src/screens/battle/selfPrediction.js` — DOM/Konva 의존 없는 순수 함수 2개(`predictSelfMove`, `reconcileSelfPosition`). 서버 `moveOne()`(`backend/lib/battleSimulation.js`)과 같은 축의 물리를 프론트에 재현하되 백엔드 전용 코드(스킬 엔진 등)를 끌어오지 않기 위해 완전히 독립된 파일로 둔다.
- **신규** `frontend/src/screens/battle/selfPrediction.test.mjs` — 위 두 함수의 단위 테스트.
- **수정** `frontend/src/screens/battle.js` — `predictedSelfRef`/`selfPlayerRef`/`moveSpeedRef` 추가, `onState`에서 본인 위치는 재조정만 하도록 변경, 본인 노드 위치는 새 `updateSelfPrediction()` 함수가 매 애니메이션 프레임 담당하도록 분리, `updateAimFromPointer`가 예측 위치를 참조하도록 변경, 기존 `selfPosRef` 제거.

---

## Task 1: `predictSelfMove` — 본인 이동 예측 순수 함수

**Files:**
- Create: `frontend/src/screens/battle/selfPrediction.js`
- Create: `frontend/src/screens/battle/selfPrediction.test.mjs`

**Interfaces:**
- Produces: `predictSelfMove(pos, input, moveSpeed, walls, arenaSize, radius, dtMs) -> { x: number, y: number }`
  - `pos`: `{ x, y }` — 예측 시작 위치.
  - `input`: `{ moveX, moveY }`(그 외 필드는 무시) — 대각선이면 정규화됨.
  - `moveSpeed`: 서버 정의와 동일한 "틱(50ms)당 픽셀" 단위 숫자.
  - `walls`: `shapes/battleMap.js`의 `DEFAULT_MAP.walls`와 같은 `{x,y,width,height}[]`.
  - `arenaSize`: `{ width, height }`.
  - `radius`: 캐릭터 충돌 반지름(픽셀).
  - `dtMs`: 이번 프레임 경과 시간(밀리초).

- [ ] **Step 1: Write the failing test**

`frontend/src/screens/battle/selfPrediction.test.mjs` 새로 작성:

```js
import assert from 'node:assert';
import { predictSelfMove } from './selfPrediction.js';

const ARENA = { width: 1000, height: 1000 };
const RADIUS = 20;

// 평지 이동 — 벽 없음, moveSpeed(틱당 픽셀)를 dtMs 기준으로 정확히 환산해야 한다.
{
  const result = predictSelfMove({ x: 500, y: 500 }, { moveX: 1, moveY: 0 }, 8, [], ARENA, RADIUS, 50);
  assert.strictEqual(result.x, 508, '50ms 경과 시 moveSpeed(8px/틱)만큼 정확히 이동해야 함');
  assert.strictEqual(result.y, 500);
}
console.log('predictSelfMove: 평지 이동 OK');

// 프레임 간격이 절반이면 이동량도 절반이어야 한다(연속 프레임 기준 환산 확인).
{
  const result = predictSelfMove({ x: 500, y: 500 }, { moveX: 1, moveY: 0 }, 8, [], ARENA, RADIUS, 25);
  assert.strictEqual(result.x, 504);
}
console.log('predictSelfMove: dtMs 비례 이동 OK');

// 대각선 입력은 정규화되어 축 이동과 같은 속도로 움직여야 한다(서버 normalizeIfLong과 동일 규칙).
{
  const result = predictSelfMove({ x: 500, y: 500 }, { moveX: 1, moveY: 1 }, 8, [], ARENA, RADIUS, 50);
  const dist = Math.hypot(result.x - 500, result.y - 500);
  assert.ok(Math.abs(dist - 8) < 1e-9, `대각선 이동 거리는 축 이동과 같아야 함(실제: ${dist})`);
}
console.log('predictSelfMove: 대각선 정규화 OK');

// 아레나 경계 — radius만큼만 안쪽으로 clamp되어야 한다.
{
  const result = predictSelfMove({ x: 975, y: 500 }, { moveX: 1, moveY: 0 }, 8, [], ARENA, RADIUS, 50);
  assert.strictEqual(result.x, ARENA.width - RADIUS, '오른쪽 경계를 넘지 못하고 반지름만큼 안쪽에서 멈춰야 함');
}
console.log('predictSelfMove: 아레나 경계 clamp OK');

// 벽 — 진행 방향에 벽이 있으면 그 축 이동이 취소되어야 한다.
{
  const wall = { x: 520, y: 480, width: 40, height: 40 };
  const result = predictSelfMove({ x: 500, y: 500 }, { moveX: 1, moveY: 0 }, 8, [wall], ARENA, RADIUS, 50);
  assert.strictEqual(result.x, 500, '벽에 막혀 x 이동이 취소되어야 함');
}
console.log('predictSelfMove: 벽 충돌 차단 OK');

console.log('selfPrediction.test.mjs (predictSelfMove): all tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/src/screens/battle/selfPrediction.test.mjs`
Expected: FAIL — `Cannot find module './selfPrediction.js'` (파일이 아직 없음).

- [ ] **Step 3: Write minimal implementation**

`frontend/src/screens/battle/selfPrediction.js` 새로 작성:

```js
// 서버(backend/lib/battleSimulation.js)의 moveOne()과 같은 축의 이동 물리를 본인 캐릭터에
// 한해 클라이언트에서 미리 계산한다 — 서버 응답(battle:state, 20Hz)을 기다리지 않고 매
// 애니메이션 프레임 그려서 입력 지연 체감을 없앤다. 스킬로 인한 속도 배율(가속/감속/시간정지
// 등, backend/lib/skillEngine.js의 speedMultiplier)은 의도적으로 재현하지 않는다 — 그 상태가
// 걸린 짧은 동안만 예측이 살짝 어긋났다가 reconcileSelfPosition이 다음 상태 수신 시 자연스럽게
// 맞춰준다(docs/superpowers/specs/2026-08-10-battle-movement-prediction-design.md 참고).
import { circleOverlapsAnyWall, resolveCircleFromWalls } from '../../../../shapes/collision.js';

// 서버 moveSpeed 단위 기준(틱당 픽셀) — 이 값으로 dtMs 기반 속도로 환산한다.
const SERVER_TICK_MS = 50;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// 서버 normalizeIfLong과 동일한 규칙 — 대각선 입력이 자동으로 √2배 빨라지지 않게 한다.
function normalizeIfLong(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const len = Math.hypot(x, y);
  if (len <= 1) return { x, y };
  return { x: x / len, y: y / len };
}

export function predictSelfMove(pos, input, moveSpeed, walls, arenaSize, radius, dtMs) {
  const move = normalizeIfLong(input?.moveX ?? 0, input?.moveY ?? 0);
  const effective = (moveSpeed / SERVER_TICK_MS) * dtMs;
  const dx = move.x * effective;
  const dy = move.y * effective;

  const safeStart = resolveCircleFromWalls(pos.x, pos.y, radius, walls, arenaSize);
  let x = clamp(safeStart.x + dx, radius, arenaSize.width - radius);
  let y = clamp(safeStart.y + dy, radius, arenaSize.height - radius);

  if (circleOverlapsAnyWall(x, safeStart.y, radius, walls)) x = safeStart.x;
  if (circleOverlapsAnyWall(x, y, radius, walls)) y = safeStart.y;

  return { x, y };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/src/screens/battle/selfPrediction.test.mjs`
Expected: PASS — 모든 `console.log('... OK')` 출력, 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/battle/selfPrediction.js frontend/src/screens/battle/selfPrediction.test.mjs
git commit -m "feat: 본인 캐릭터 이동 클라이언트 예측 순수 함수(predictSelfMove) 추가"
```

---

## Task 2: `reconcileSelfPosition` — 서버 재조정 순수 함수

**Files:**
- Modify: `frontend/src/screens/battle/selfPrediction.js` (Task 1에서 만든 파일에 함수 추가)
- Modify: `frontend/src/screens/battle/selfPrediction.test.mjs` (Task 1 테스트 파일에 케이스 추가)

**Interfaces:**
- Consumes: 없음(Task 1과 독립된 순수 함수, 같은 파일에 위치).
- Produces: `reconcileSelfPosition(predicted, serverPos) -> { x: number, y: number }`
  - `predicted`: `{ x, y }` — 지금까지 클라이언트가 예측해온 위치.
  - `serverPos`: `{ x, y }` — 서버가 이번 `battle:state`로 알려준 본인의 실제 위치.
  - 오차가 4px 미만이면 `predicted`를 그대로 반환, 150px 이상이면 `serverPos`로 즉시 스냅, 그 사이면 오차의 30%만큼만 당겨서 반환(여러 번 호출하면 서버 위치로 수렴).

- [ ] **Step 1: Write the failing test**

`frontend/src/screens/battle/selfPrediction.test.mjs` 맨 아래(`console.log('selfPrediction.test.mjs (predictSelfMove): all tests passed');` 다음 줄)에 추가:

```js
import { reconcileSelfPosition } from './selfPrediction.js';

// 오차가 작으면 그대로 둔다(매 상태 패킷마다 미세하게 흔들리는 것 방지).
{
  const result = reconcileSelfPosition({ x: 500, y: 500 }, { x: 502, y: 500 });
  assert.deepStrictEqual(result, { x: 500, y: 500 }, '4px 미만 오차는 무시해야 함');
}
console.log('reconcileSelfPosition: 작은 오차 무시 OK');

// 오차가 크면(리스폰/대시/넉백 등) 즉시 서버 값으로 스냅한다.
{
  const result = reconcileSelfPosition({ x: 500, y: 500 }, { x: 800, y: 500 });
  assert.deepStrictEqual(result, { x: 800, y: 500 }, '150px 이상 오차는 즉시 스냅해야 함');
}
console.log('reconcileSelfPosition: 큰 오차 스냅 OK');

// 중간 오차는 한 번에 다 당기지 않고 일부만 보정 — 반복 호출로 서버 위치에 수렴해야 한다.
{
  let predicted = { x: 500, y: 500 };
  const server = { x: 550, y: 500 };
  predicted = reconcileSelfPosition(predicted, server);
  assert.ok(predicted.x > 500 && predicted.x < 550, '한 번에 다 당기지 않고 일부만 보정해야 함');
  for (let i = 0; i < 30; i += 1) predicted = reconcileSelfPosition(predicted, server);
  assert.ok(Math.abs(predicted.x - 550) < 1, '반복 보정하면 서버 위치로 수렴해야 함');
}
console.log('reconcileSelfPosition: 중간 오차 점진 수렴 OK');

console.log('selfPrediction.test.mjs (reconcileSelfPosition): all tests passed');
```

(파일 맨 위 `import` 구문 두 개는 자연스럽게 파일 상단으로 모아도 되고, ESM에서는 import가 파일 어디에 있어도 호이스팅되므로 위치는 상관없다 — 다만 가독성을 위해 Step 3에서 최종적으로 파일 맨 위로 정리한다.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node frontend/src/screens/battle/selfPrediction.test.mjs`
Expected: FAIL — `reconcileSelfPosition is not a function` (아직 export 안 됨).

- [ ] **Step 3: Write minimal implementation**

`frontend/src/screens/battle/selfPrediction.js`에 추가(파일 끝, `predictSelfMove` 아래):

```js
// 오차 판정 임계값 — 작을수록 서버와 자주 미세 보정하고, 클수록(리스폰/대시/넉백 등) 슬라이딩
// 없이 즉시 순간이동한다. 원인별로 분기하지 않고 "오차 크기"만으로 판단한다(YAGNI).
const RECONCILE_IGNORE_PX = 4;
const RECONCILE_SNAP_PX = 150;
const RECONCILE_CORRECTION_RATE = 0.3;

export function reconcileSelfPosition(predicted, serverPos) {
  const dx = serverPos.x - predicted.x;
  const dy = serverPos.y - predicted.y;
  const dist = Math.hypot(dx, dy);
  if (dist < RECONCILE_IGNORE_PX) return predicted;
  if (dist >= RECONCILE_SNAP_PX) return { x: serverPos.x, y: serverPos.y };
  return {
    x: predicted.x + dx * RECONCILE_CORRECTION_RATE,
    y: predicted.y + dy * RECONCILE_CORRECTION_RATE,
  };
}
```

그리고 Step 1에서 테스트 파일 중간에 추가한 `import { reconcileSelfPosition } from './selfPrediction.js';`를 파일 맨 위, 기존 `import { predictSelfMove } from './selfPrediction.js';` 옆으로 옮겨서 하나로 합친다:

```js
import assert from 'node:assert';
import { predictSelfMove, reconcileSelfPosition } from './selfPrediction.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node frontend/src/screens/battle/selfPrediction.test.mjs`
Expected: PASS — `predictSelfMove`/`reconcileSelfPosition` 테스트 로그가 모두 출력되고 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/battle/selfPrediction.js frontend/src/screens/battle/selfPrediction.test.mjs
git commit -m "feat: 서버 재조정 순수 함수(reconcileSelfPosition) 추가"
```

---

## Task 3: `battle.js`에 예측/재조정 통합

**Files:**
- Modify: `frontend/src/screens/battle.js`

**Interfaces:**
- Consumes: `predictSelfMove(pos, input, moveSpeed, walls, arenaSize, radius, dtMs)`, `reconcileSelfPosition(predicted, serverPos)` (Task 1/2에서 만든 함수, `frontend/src/screens/battle/selfPrediction.js`에서 import).
- Produces: 없음(이 프로젝트의 최종 소비 지점 — 이후 태스크 없음).

이 태스크는 한 파일(`battle.js`) 안에서 서로 맞물린 여러 지점을 함께 바꿔야 하나로 완결된다(위치만 옮기고 다른 시각 요소는 안 옮기면 캐릭터와 체력바/이름표가 따로 노는 시각적 버그가 생김) — 아래 순서대로 전부 적용한 뒤에 검증한다.

- [ ] **Step 1: 상수/ref 추가**

`frontend/src/screens/battle.js`에서 `const NETWORK_FRAME_MS = 50;` 바로 아래에 추가:

```js
// 서버 backend/lib/battleSimulation.js의 DEFAULT_MOVE_SPEED와 같은 값 — 첫 battle:state
// 수신 전(아주 짧은 순간) 예측 이동에 쓸 값이 필요해서 폴백으로 하나 둔다. room.moveSpeed가
// 도착하는 즉시 대체되므로 실제 영향은 첫 프레임 몇 개뿐이다.
const SELF_PREDICT_MOVE_SPEED_FALLBACK = 8;
```

파일 상단 import 목록에 추가(`import { hasLocalDamage } from './battle/battleFeedback.js';` 다음 줄):

```js
import { predictSelfMove, reconcileSelfPosition } from './battle/selfPrediction.js';
```

다음 줄을 찾아서:

```js
  const selfPosRef = useRef({ x: DEFAULT_MAP.arenaSize.width / 2, y: DEFAULT_MAP.arenaSize.height / 2 });
```

아래 세 줄로 교체(`selfPosRef`를 완전히 대체):

```js
  // 서버가 확인해준 마지막 내 위치에서 시작해 매 프레임 예측 이동한 결과 — null이면 아직 첫
  // battle:state를 못 받은 것(그 전엔 예측할 입력 기준 위치가 없음).
  const predictedSelfRef = useRef(null);
  // 예측/미리보기 계산에 필요한, 서버가 준 내 최신 상태(조준/원거리 여부/사거리/생존 여부) —
  // 위치 필드도 들어있지만 화면 렌더링에는 predictedSelfRef만 쓴다.
  const selfPlayerRef = useRef(null);
  // room.moveSpeed 캐시 — 관리자가 부스 현장에서 실시간으로 바꿀 수 있는 값이라 매 상태
  // 패킷마다 갱신한다.
  const moveSpeedRef = useRef(SELF_PREDICT_MOVE_SPEED_FALLBACK);
```

- [ ] **Step 2: `onState` — 본인 위치는 재조정만 하도록 변경**

다음 블록을 찾아서:

```js
      if (me) {
        setSkillChoices((previous) => {
```

`if (me) {` 바로 다음 줄에 세 줄 추가(그 아래 `setSkillChoices(...)`는 그대로 둔다):

```js
      if (me) {
        selfPlayerRef.current = me;
        moveSpeedRef.current = Number.isFinite(room.moveSpeed) ? room.moveSpeed : SELF_PREDICT_MOVE_SPEED_FALLBACK;
        predictedSelfRef.current = predictedSelfRef.current
          ? reconcileSelfPosition(predictedSelfRef.current, { x: me.x, y: me.y })
          : { x: me.x, y: me.y };
        setSkillChoices((previous) => {
```

- [ ] **Step 3: `onState`의 players.forEach — 본인 카메라/조준/미리보기 위치 계산 제거**

다음 블록을 찾아서:

```js
      Object.values(room.players).forEach((p) => {
        if (p.id === socket.id) {
          selfPosRef.current = { x: p.x, y: p.y };
          updateCamera(p.x, p.y);
          // 마우스가 가만히 있어도 내 캐릭터는 서버 틱마다 움직이므로, "캐릭터 -> 마우스"
          // 조준 방향도 그때마다 다시 계산해야 한다 — mousemove 이벤트에서만 갱신하면
          // 이동 중엔 조준이 마지막으로 마우스가 움직였던 순간에 멈춰버린다(Opus 리뷰
          // Important I2). updateCamera가 먼저 실행돼서 cameraRef가 이 틱 기준으로
          // 최신 상태여야 아래 updateAimFromPointer의 좌표 변환이 정확하다.
          updateAimFromPointer();

          // 공격 미리보기(텔레그래프) — 내 캐릭터 것만 보여준다(브롤스타즈처럼 상대 조준은
          // 화면에 안 보임). 무기 종류(근접/원거리)는 대전 중 안 바뀌므로 노드 타입은 한 번만
          // 정하고, 이후엔 위치/방향만 갱신한다. meleeHitboxRect는 서버(battleSimulation.js)와
          // 똑같은 계산식을 shapes/attackGeometry.js에서 그대로 가져다 쓴 것이라, 여기 보이는
          // 자리가 실제 판정 자리와 항상 일치한다.
          const previewAimX = p.aimX ?? 0;
          const previewAimY = p.aimY ?? 1;
          if (!previewNodeRef.current) {
            previewNodeRef.current = p.isRanged
              ? new Konva.Line({ points: [0, 0, 0, 0], stroke: 'rgba(255,255,255,0.5)', strokeWidth: 3 })
              : new Konva.Rect({
                  width: ATTACK_HITBOX_SIZE,
                  height: ATTACK_HITBOX_SIZE,
                  // 회전축을 중심에 맞춘다 — 기본값(좌상단 기준 회전)이면 rotation()을 걸었을 때
                  // 실제 판정 자리(meleeHitboxRect의 centerX/centerY 중심)와 어긋나 보인다.
                  offsetX: ATTACK_HITBOX_SIZE / 2,
                  offsetY: ATTACK_HITBOX_SIZE / 2,
                  fill: 'rgba(255,255,255,0.25)',
                });
            layer.add(previewNodeRef.current);
          }
          if (p.isRanged) {
            const range = p.rangeDistance ?? 0;
            previewNodeRef.current.points([p.x, p.y, p.x + previewAimX * range, p.y + previewAimY * range]);
          } else {
            // meleeHitboxRect가 중심좌표+회전각을 주므로, 미리보기도 캐릭터가 든 무기 방향과
            // 똑같이 회전시킨다 — 서버 판정(battleSimulation.js)이 쓰는 값과 완전히 같은
            // 계산식이라 여기 보이는 자리가 실제 판정 자리와 항상 일치한다.
            const hitbox = meleeHitboxRect(p.x, p.y, previewAimX, previewAimY, CHARACTER_RADIUS);
            previewNodeRef.current.x(hitbox.centerX);
            previewNodeRef.current.y(hitbox.centerY);
            previewNodeRef.current.rotation((hitbox.angle * 180) / Math.PI);
          }
        }
        let entry = nodesRef.current[p.id];
        let isNewEntry = false;
        if (!entry) {
          isNewEntry = true;
          const isSelf = p.id === socket.id;
          const circle = new Konva.Circle({
```

아래로 교체(카메라/조준/미리보기 위치 계산은 `updateSelfPrediction`으로 옮기고, 미리보기 노드 "생성"만 여기 남긴다 — 노드 타입은 대전 중 안 바뀌므로 한 번만 정하면 되고, 그 판단 자체는 `me.isRanged`로 여기서 하는 게 자연스럽다):

```js
      Object.values(room.players).forEach((p) => {
        const isSelf = p.id === socket.id;
        // 공격 미리보기(텔레그래프) 노드는 여기서 한 번만 만든다 — 위치/방향 갱신은
        // updateSelfPrediction()이 매 프레임 담당한다(아래 useEffect 밖에 정의).
        if (isSelf && !previewNodeRef.current) {
          previewNodeRef.current = p.isRanged
            ? new Konva.Line({ points: [0, 0, 0, 0], stroke: 'rgba(255,255,255,0.5)', strokeWidth: 3 })
            : new Konva.Rect({
                width: ATTACK_HITBOX_SIZE,
                height: ATTACK_HITBOX_SIZE,
                offsetX: ATTACK_HITBOX_SIZE / 2,
                offsetY: ATTACK_HITBOX_SIZE / 2,
                fill: 'rgba(255,255,255,0.25)',
              });
          layer.add(previewNodeRef.current);
        }
        let entry = nodesRef.current[p.id];
        let isNewEntry = false;
        if (!entry) {
          isNewEntry = true;
          const circle = new Konva.Circle({
```

(`const isSelf = p.id === socket.id;`가 원래 있던 `if (!entry) { isNewEntry = true; const isSelf = ...` 자리에서는 삭제됐다 — 위에서 forEach 맨 위로 옮겼으므로 아래쪽 `stroke: isSelf ? '#ffffff' : undefined` 줄은 그대로 두되 그 바로 위의 중복 선언 줄만 지운다.)

- [ ] **Step 4: 본인 노드 위치 설정(`moveNodeSmoothly`) 전부 건너뛰기**

다음 블록을 찾아서:

```js
        const localHitFlash = p.id === socket.id && hitFlashUntilRef.current > receivedAt;
        moveNodeSmoothly(entry.circle, p.x, p.y, isNewEntry);
        entry.circle.visible(!hiddenByCloak);
        entry.circle.fill(localHitFlash ? '#ff4d4d' : CHARACTER_COLORS[p.characterId] ?? '#999');
        entry.circle.shadowColor(localHitFlash ? '#ff1f1f' : 'transparent');
        entry.circle.shadowBlur(localHitFlash ? 18 : 0);
        entry.circle.opacity(opacity);
        moveNodeSmoothly(entry.label, p.x - CHARACTER_RADIUS, p.y - 7, isNewEntry);
        entry.label.visible(!hiddenByCloak);
        entry.label.opacity(opacity);
```

아래로 교체(본인이면 위치 설정을 건너뛴다 — `updateSelfPrediction()`이 매 프레임 이미 위치시키고 있으므로, 여기서도 20Hz로 같이 위치를 설정하면 두 갱신 주기가 서로 덮어써서 떨림이 생긴다):

```js
        const localHitFlash = isSelf && hitFlashUntilRef.current > receivedAt;
        if (!isSelf) moveNodeSmoothly(entry.circle, p.x, p.y, isNewEntry);
        entry.circle.visible(!hiddenByCloak);
        entry.circle.fill(localHitFlash ? '#ff4d4d' : CHARACTER_COLORS[p.characterId] ?? '#999');
        entry.circle.shadowColor(localHitFlash ? '#ff1f1f' : 'transparent');
        entry.circle.shadowBlur(localHitFlash ? 18 : 0);
        entry.circle.opacity(opacity);
        if (!isSelf) moveNodeSmoothly(entry.label, p.x - CHARACTER_RADIUS, p.y - 7, isNewEntry);
        entry.label.visible(!hiddenByCloak);
        entry.label.opacity(opacity);
```

이어서 다음 블록을 찾아서:

```js
        moveNodeSmoothly(entry.hpBarBg, barX, barY, isNewEntry);
        entry.hpBarBg.visible(isAlive && !hiddenByCloak);
        moveNodeSmoothly(entry.hpBarFill, barX, barY, isNewEntry);
        entry.hpBarFill.width(HP_BAR_WIDTH * hpRatio);
```

아래로 교체:

```js
        if (!isSelf) moveNodeSmoothly(entry.hpBarBg, barX, barY, isNewEntry);
        entry.hpBarBg.visible(isAlive && !hiddenByCloak);
        if (!isSelf) moveNodeSmoothly(entry.hpBarFill, barX, barY, isNewEntry);
        entry.hpBarFill.width(HP_BAR_WIDTH * hpRatio);
```

이어서:

```js
        moveNodeSmoothly(entry.nameLabel, p.x - 60, barY - 15, isNewEntry);
        entry.nameLabel.text(p.name ?? `캐릭터 ${(p.characterId ?? '').replace('char', '')}`);
```

아래로 교체:

```js
        if (!isSelf) moveNodeSmoothly(entry.nameLabel, p.x - 60, barY - 15, isNewEntry);
        entry.nameLabel.text(p.name ?? `캐릭터 ${(p.characterId ?? '').replace('char', '')}`);
```

이어서:

```js
        if (showRespawn) {
          moveNodeSmoothly(entry.respawnLabel, p.x - 60, barY - 2, isNewEntry);
          entry.respawnLabel.text(`부활 ${Math.max(0, Math.ceil((p.respawnAt - serverNow) / 1000))}`);
        }
```

아래로 교체:

```js
        if (showRespawn) {
          if (!isSelf) moveNodeSmoothly(entry.respawnLabel, p.x - 60, barY - 2, isNewEntry);
          entry.respawnLabel.text(`부활 ${Math.max(0, Math.ceil((p.respawnAt - serverNow) / 1000))}`);
        }
```

마지막으로:

```js
        moveNodeSmoothly(entry.rightHand, handX, handY, isNewEntry);
        entry.rightHand.visible(!hiddenByCloak);
        entry.rightHand.opacity(opacity);
        moveNodeSmoothly(entry.weaponGroup, handX, handY, isNewEntry);
        entry.weaponGroup.rotation((Math.atan2(aimY, aimX) * 180) / Math.PI);
```

아래로 교체:

```js
        if (!isSelf) moveNodeSmoothly(entry.rightHand, handX, handY, isNewEntry);
        entry.rightHand.visible(!hiddenByCloak);
        entry.rightHand.opacity(opacity);
        if (!isSelf) moveNodeSmoothly(entry.weaponGroup, handX, handY, isNewEntry);
        entry.weaponGroup.rotation((Math.atan2(aimY, aimX) * 180) / Math.PI);
```

- [ ] **Step 5: `updateAimFromPointer`가 예측 위치를 참조하도록 변경**

다음 블록을 찾아서:

```js
  function updateAimFromPointer() {
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const { x: sx, y: sy } = selfPosRef.current;
```

아래로 교체:

```js
  function updateAimFromPointer() {
    const stage = stageRef.current;
    if (!stage || !predictedSelfRef.current) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const { x: sx, y: sy } = predictedSelfRef.current;
```

- [ ] **Step 6: `updateSelfPrediction()` 함수 추가**

`updateAimFromPointer` 함수 정의가 끝나는 지점(닫는 `}` 다음, `useEffect(() => { function onMouseDown(e) {` 시작 전) 바로 아래에 새 함수를 추가:

```js
  // 내 캐릭터만 서버 응답을 기다리지 않고 매 애니메이션 프레임(rAF) 미리 이동시켜 그린다 —
  // 다른 참가자는 그대로 moveNodeSmoothly 보간(50ms 목표)을 쓴다. 체력바 채움/색/텍스트 같은
  // "위치가 아닌" 값은 여기서 안 건드리고 onState의 일반 루프가 그대로 담당한다 — 같은 값을
  // 서로 다른 주기(여기는 매 프레임, onState는 20Hz)로 건드리면 두 갱신이 부딪혀 떨린다.
  function updateSelfPrediction(dtMs) {
    const me = selfPlayerRef.current;
    if (!me || !predictedSelfRef.current) return;
    // 사망 중엔 서버도 입력을 비우므로(recordDeath) 예측도 멈춘다 — 로컬 inputRef에 죽기
    // 직전 입력이 남아 있어도 캐릭터가 제자리에서 계속 밀리지 않게 방어.
    if (me.alive !== false) {
      predictedSelfRef.current = predictSelfMove(
        predictedSelfRef.current,
        inputRef.current,
        moveSpeedRef.current,
        DEFAULT_MAP.walls,
        DEFAULT_MAP.arenaSize,
        CHARACTER_RADIUS,
        dtMs,
      );
    }
    const { x, y } = predictedSelfRef.current;
    updateCamera(x, y);
    updateAimFromPointer();

    const entry = nodesRef.current[socket.id];
    if (entry) {
      entry.circle.position({ x, y });
      entry.label.position({ x: x - CHARACTER_RADIUS, y: y - 7 });
      const barX = x - HP_BAR_WIDTH / 2;
      const barY = Math.max(0, y - CHARACTER_RADIUS - 22);
      entry.hpBarBg.position({ x: barX, y: barY });
      entry.hpBarFill.position({ x: barX, y: barY });
      entry.nameLabel.position({ x: x - 60, y: barY - 15 });
      if (entry.respawnLabel.visible()) entry.respawnLabel.position({ x: x - 60, y: barY - 2 });

      const aimX = me.aimX ?? 0;
      const aimY = me.aimY ?? 1;
      const handForward = CHARACTER_RADIUS * 0.45;
      const handSide = CHARACTER_RADIUS * 0.78;
      const handX = Math.min(DEFAULT_MAP.arenaSize.width, Math.max(0, x + aimX * handForward - aimY * handSide));
      const handY = Math.min(DEFAULT_MAP.arenaSize.height, Math.max(0, y + aimY * handForward + aimX * handSide));
      entry.rightHand.position({ x: handX, y: handY });
      entry.weaponGroup.position({ x: handX, y: handY });
    }

    if (previewNodeRef.current) {
      const aimX = me.aimX ?? 0;
      const aimY = me.aimY ?? 1;
      if (me.isRanged) {
        const range = me.rangeDistance ?? 0;
        previewNodeRef.current.points([x, y, x + aimX * range, y + aimY * range]);
      } else {
        const hitbox = meleeHitboxRect(x, y, aimX, aimY, CHARACTER_RADIUS);
        previewNodeRef.current.x(hitbox.centerX);
        previewNodeRef.current.y(hitbox.centerY);
        previewNodeRef.current.rotation((hitbox.angle * 180) / Math.PI);
      }
    }
  }
```

- [ ] **Step 7: 마운트 애니메이션 루프에서 매 프레임 호출**

다음 블록을 찾아서:

```js
    const motionAnimation = new Konva.Animation(() => {
      const now = performance.now();
      for (const [node, motion] of motionTargetsRef.current) {
        const t = Math.min(1, Math.max(0, (now - motion.startedAt) / NETWORK_FRAME_MS));
        node.position({
          x: motion.fromX + (motion.toX - motion.fromX) * t,
          y: motion.fromY + (motion.toY - motion.fromY) * t,
        });
        if (t >= 1) motionTargetsRef.current.delete(node);
      }
    }, layer);
```

아래로 교체:

```js
    const motionAnimation = new Konva.Animation((frame) => {
      const now = performance.now();
      for (const [node, motion] of motionTargetsRef.current) {
        const t = Math.min(1, Math.max(0, (now - motion.startedAt) / NETWORK_FRAME_MS));
        node.position({
          x: motion.fromX + (motion.toX - motion.fromX) * t,
          y: motion.fromY + (motion.toY - motion.fromY) * t,
        });
        if (t >= 1) motionTargetsRef.current.delete(node);
      }
      // updateSelfPrediction은 컴포넌트 본문 아래쪽에 함수 선언(hoisting)으로 정의돼 있어
      // 여기서 참조 가능하다 — 이 마운트 이펙트가 실제로 실행되는 시점엔 컴포넌트 함수 전체가
      // 이미 평가된 뒤이므로 선언 순서와 무관하게 최신 클로저를 참조한다.
      updateSelfPrediction(frame?.timeDiff ?? 16);
    }, layer);
```

- [ ] **Step 8: 구문 검증**

Run: `node --check frontend/src/screens/battle.js`
Expected: 출력 없음, exit code 0(구문 오류 없음).

Run: `node --check frontend/src/screens/battle/selfPrediction.js`
Expected: 출력 없음, exit code 0.

- [ ] **Step 9: 회귀 확인 — 단위 테스트 재실행**

Run: `node frontend/src/screens/battle/selfPrediction.test.mjs`
Expected: PASS (Task 1/2에서 이미 통과했지만, Step 1~7에서 이 파일을 안 건드렸는지 다시 한번 확인).

Run: 저장소 안의 모든 `backend/**/*.test.mjs`를 개별 실행해서 전부 PASS 확인(예: `for f in backend/**/*.test.mjs; do node "$f" || echo "FAILED: $f"; done` 형태로, 또는 하나씩) — 이번 태스크는 프론트만 건드렸지만, `git status`로 다른 미완료 변경이 섞여 있지 않은지 확인하는 차원에서 전체 스위트를 한 번 돈다.

- [ ] **Step 10: 라이브 검증 체크리스트 (자동화 불가 — 사용자가 직접 확인)**

이 프로젝트는 프론트엔드 자동화 테스트/브라우저 구동 검증을 하지 않는 관례라(수동 확인), 아래 체크리스트를 사용자에게 전달하고 직접 확인받는다:

1. 백엔드 서버 실행 후 대전 화면 진입(개발자 테스트 창 `devBattle:start`로도 가능) — 이동키(WASD/화살표)를 누르면 캐릭터가 눈에 띄는 지연 없이 바로 반응하는지.
2. 카메라가 캐릭터를 따라가며 부드럽게 움직이고, 20Hz 틱 경계에서 뚝뚝 끊기지 않는지.
3. 공격 미리보기(근접 사각형/원거리 선)가 캐릭터 위치와 항상 겹쳐서 따라다니는지(따로 노는 잔상이 없는지).
4. 체력바/이름표/부활 카운트다운/무기 아이콘이 캐릭터와 같이 붙어서 이동하는지(뒤처지거나 겹상이 생기지 않는지).
5. 사망 후 부활 시 캐릭터가 화면을 슬라이딩하며 가로지르지 않고 스폰 지점에 깔끔하게 순간이동하는지.
6. 다른 참가자(본인이 조종하지 않는 캐릭터)의 이동은 기존과 동일하게 보이는지(회귀 확인).
7. 브라우저 콘솔에 새로 발생하는 에러/경고가 없는지.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/screens/battle.js
git commit -m "feat: 대전 화면에 본인 캐릭터 이동 클라이언트 예측 통합"
```
