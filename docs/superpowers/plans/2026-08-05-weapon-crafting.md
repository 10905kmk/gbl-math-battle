# 무기 제작 UI + AI 채점 일관성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캔버스(Konva) + AI 채팅으로 참가자가 도형을 조합해 무기를 만들고, AI가 데미지(1~10000)를 채점하되 동일/유사 무기는 항상 동일 점수가 나오도록 만든다.

**Architecture:** 무기는 `{ parts: [{id, shapeId, x, y, rotation, scale}] }` 구조로 프론트/백엔드가 공유한다. AI 채팅은 Gemini 네이티브 tool calling으로 이 구조를 직접 조작하고, 수동 편집(Konva 캔버스)도 같은 구조를 직접 조작한다. 채점은 정규화된 무기를 캐시 키로 써서, 캐시 히트 시 AI 호출 없이 즉시 반환하고 캐시 미스 시에만 AI에게 범위를 물어본 뒤 캐시 키를 시드로 결정론적 확정값을 산출한다.

**Tech Stack:** Preact + htm (CDN, 기존 유지), Konva.js (신규, CDN), Express + Socket.io (기존), Gemini API (fetch 직접 호출, SDK 미사용).

## Global Constraints

- 번들러 없음 — 모든 신규 프론트 코드는 `<script type="module">` + import map으로 CDN에서 로드 (기존 아키텍처 원칙, `docs/초안.md` 4번)
- `shapes/` 폴더는 프론트/백엔드 공통 순수 로직 — Node와 브라우저 양쪽에서 그대로 import 가능해야 함 (플랫폼 전용 API 사용 금지)
- API 키는 백엔드에만 존재, 프론트에 노출 금지 (`docs/초안.md` 3번)
- 캔버스 크기: 480×480 (모든 좌표는 이 범위 내로 clamp)
- part 개수 상한: 10개
- scale 범위: 0.2~3.0
- 데미지 범위: 1~10000
- AI 제공자: Gemini, `GEMINI_API_KEYS` 환경변수(콤마 구분, 여러 키 로테이션)
- 테스트 프레임워크 미설치 프로젝트이므로, 순수 함수 테스트는 `node:assert` + 독립 `.mjs` 스크립트로 작성하고 `node <파일>`로 직접 실행한다 (기존 세션에서 이미 이 패턴 사용함)

---

## Task 1: 기본 도형 좌표 생성 (`shapes/shapes.js`)

**Files:**
- Modify: `shapes/shapes.js`
- Test: `shapes/shapes.test.mjs` (임시 검증 스크립트, 통과 확인 후 삭제하지 않고 남겨둠)

**Interfaces:**
- Produces: `trianglePoints(size = 60): {x,y}[]` (길이 3), `squarePoints(size = 60): {x,y}[]` (길이 4). 둘 다 원점(0,0) 중심 기준 로컬 좌표.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// shapes/shapes.test.mjs
import assert from 'node:assert';
import { trianglePoints, squarePoints } from './shapes.js';

const tri = trianglePoints(60);
assert.strictEqual(tri.length, 3, 'triangle should have 3 points');

const sq = squarePoints(60);
assert.strictEqual(sq.length, 4, 'square should have 4 points');
assert.strictEqual(sq[0].x, -30, 'square left edge at -size/2');
assert.strictEqual(sq[0].y, -30, 'square top edge at -size/2');

console.log('shapes.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node shapes/shapes.test.mjs`
Expected: `trianglePoints is not a function` 등 import 에러로 FAIL

- [ ] **Step 3: 구현**

`shapes/shapes.js` 전체를 아래로 교체:

```js
// 기본 도형 정의 (프론트/백엔드 공통)
export const SHAPES = [
  { id: 'triangle', name: '삼각형', baseStats: { attack: 10, defense: 10 } },
  { id: 'square', name: '사각형', baseStats: { attack: 8, defense: 14 } },
];

// 정삼각형, 원점 중심 로컬 좌표
export function trianglePoints(size = 60) {
  const h = (size * Math.sqrt(3)) / 2;
  return [
    { x: 0, y: -(h * 2) / 3 },
    { x: -size / 2, y: h / 3 },
    { x: size / 2, y: h / 3 },
  ];
}

// 정사각형, 원점 중심 로컬 좌표
export function squarePoints(size = 60) {
  const half = size / 2;
  return [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ];
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node shapes/shapes.test.mjs`
Expected: `shapes.test.mjs: OK`

- [ ] **Step 5: 커밋**

```bash
git add shapes/shapes.js shapes/shapes.test.mjs
git commit -m "feat: 기본 도형 좌표 생성 함수 추가"
```

---

## Task 2: 프랙탈 도형 좌표 생성 (`shapes/fractals.js`)

**Files:**
- Modify: `shapes/fractals.js`
- Test: `shapes/fractals.test.mjs`

**Interfaces:**
- Consumes: 없음 (독립적인 재귀 기하 계산)
- Produces: `sierpinskiTriangles(size = 60, depth = 4): [{x,y},{x,y},{x,y}][]` (삼각형 목록), `kochSnowflakePoints(size = 60, depth = 3): {x,y}[]` (닫힌 폴리곤 점 목록)

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// shapes/fractals.test.mjs
import assert from 'node:assert';
import { sierpinskiTriangles, kochSnowflakePoints } from './fractals.js';

// depth 0: 삼각형 1개
assert.strictEqual(sierpinskiTriangles(60, 0).length, 1);
// depth 1: 3개로 분할
assert.strictEqual(sierpinskiTriangles(60, 1).length, 3);
// depth 2: 9개
assert.strictEqual(sierpinskiTriangles(60, 2).length, 9);

// koch depth 0: 삼각형 꼭짓점 그대로, 변당 점 1개(시작점)씩 = 3개
const koch0 = kochSnowflakePoints(60, 0);
assert.strictEqual(koch0.length, 3);
// depth 1: 변당 4배 세분 = 12개
const koch1 = kochSnowflakePoints(60, 1);
assert.strictEqual(koch1.length, 12);

// 각 변의 돌출점(bump)은 도형 중심(0,0)이 아니라 바깥쪽으로 튀어나와야 한다.
// (점 개수만 세면 돌출 방향이 반대로 뒤집혀 중심으로 붕괴하는 버그를 못 잡는다)
// 한 변은 [시작점, 1/3점, 돌출점(bump), 2/3점] 순서로 4개 점을 낸다 — koch1[2]가 첫 변의 돌출점.
const bumpPoint = koch1[2];
const distFromCenter = Math.hypot(bumpPoint.x, bumpPoint.y);
assert.ok(distFromCenter > 20, `돌출점이 중심에서 충분히 떨어져 있어야 함 (실제: ${distFromCenter})`);

console.log('fractals.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node shapes/fractals.test.mjs`
Expected: import 에러로 FAIL

- [ ] **Step 3: 구현**

`shapes/fractals.js` 전체를 아래로 교체:

```js
// 프랙탈 도형 정의 (시에르핀스키, 코흐눈꽃 등)
export const FRACTALS = [
  { id: 'sierpinski', name: '시에르핀스키 삼각형', baseStats: { attack: 14, defense: 6 } },
  { id: 'koch', name: '코흐눈꽃', baseStats: { attack: 6, defense: 16 } },
];

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function sierpinskiRecurse(a, b, c, depth, out) {
  if (depth === 0) {
    out.push([a, b, c]);
    return;
  }
  const ab = midpoint(a, b);
  const bc = midpoint(b, c);
  const ca = midpoint(c, a);
  sierpinskiRecurse(a, ab, ca, depth - 1, out);
  sierpinskiRecurse(ab, b, bc, depth - 1, out);
  sierpinskiRecurse(ca, bc, c, depth - 1, out);
}

// 시에르핀스키 삼각형 — 채워야 할 작은 삼각형들의 목록을 반환
export function sierpinskiTriangles(size = 60, depth = 4) {
  const h = (size * Math.sqrt(3)) / 2;
  const a = { x: 0, y: -(h * 2) / 3 };
  const b = { x: -size / 2, y: h / 3 };
  const c = { x: size / 2, y: h / 3 };
  const out = [];
  sierpinskiRecurse(a, b, c, depth, out);
  return out;
}

function kochSegment(a, b, depth) {
  if (depth === 0) return [a];
  const dx = (b.x - a.x) / 3;
  const dy = (b.y - a.y) / 3;
  const p1 = { x: a.x + dx, y: a.y + dy };
  const p3 = { x: a.x + dx * 2, y: a.y + dy * 2 };
  const angle = Math.atan2(dy, dx) + Math.PI / 3;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const p2 = { x: p1.x + Math.cos(angle) * dist, y: p1.y + Math.sin(angle) * dist };
  return [
    ...kochSegment(a, p1, depth - 1),
    ...kochSegment(p1, p2, depth - 1),
    ...kochSegment(p2, p3, depth - 1),
    ...kochSegment(p3, b, depth - 1),
  ];
}

// 코흐눈꽃 — 닫힌 폴리곤을 이루는 점 목록을 반환 (마지막 점→첫 점은 호출부에서 닫는다고 가정)
export function kochSnowflakePoints(size = 60, depth = 3) {
  const h = (size * Math.sqrt(3)) / 2;
  const a = { x: 0, y: -(h * 2) / 3 };
  const b = { x: -size / 2, y: h / 3 };
  const c = { x: size / 2, y: h / 3 };
  return [...kochSegment(a, b, depth), ...kochSegment(b, c, depth), ...kochSegment(c, a, depth)];
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node shapes/fractals.test.mjs`
Expected: `fractals.test.mjs: OK`

- [ ] **Step 5: 커밋**

```bash
git add shapes/fractals.js shapes/fractals.test.mjs
git commit -m "feat: 프랙탈 도형(시에르핀스키/코흐눈꽃) 좌표 생성 함수 추가"
```

---

## Task 3: 도형 레지스트리 (`shapes/registry.js`)

**Files:**
- Create: `shapes/registry.js`
- Test: `shapes/registry.test.mjs`

**Interfaces:**
- Consumes: `SHAPES`, `trianglePoints`, `squarePoints` (Task 1); `FRACTALS`, `sierpinskiTriangles`, `kochSnowflakePoints` (Task 2)
- Produces: `ALL_SHAPES: {id,name,baseStats}[]`, `getShapeById(shapeId): shape|null`, `isValidShapeId(shapeId): boolean`, `getShapeGeometry(shapeId, size=60): {type:'polygon',points}|{type:'triangles',triangles}|null`, `generatePartId(): string`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// shapes/registry.test.mjs
import assert from 'node:assert';
import { ALL_SHAPES, getShapeById, isValidShapeId, getShapeGeometry, generatePartId } from './registry.js';

assert.strictEqual(ALL_SHAPES.length, 4);
assert.strictEqual(getShapeById('triangle').name, '삼각형');
assert.strictEqual(getShapeById('nope'), null);
assert.strictEqual(isValidShapeId('sierpinski'), true);
assert.strictEqual(isValidShapeId('nope'), false);

const tri = getShapeGeometry('triangle');
assert.strictEqual(tri.type, 'polygon');
assert.strictEqual(tri.points.length, 3);

const sier = getShapeGeometry('sierpinski');
assert.strictEqual(sier.type, 'triangles');
assert.ok(sier.triangles.length > 0);

const id1 = generatePartId();
const id2 = generatePartId();
assert.notStrictEqual(id1, id2, 'ids should be unique');
assert.match(id1, /^p[a-z0-9]+$/);

console.log('registry.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node shapes/registry.test.mjs`
Expected: `Cannot find module './registry.js'`로 FAIL

- [ ] **Step 3: 구현**

```js
// shapes/registry.js
import { SHAPES, trianglePoints, squarePoints } from './shapes.js';
import { FRACTALS, sierpinskiTriangles, kochSnowflakePoints } from './fractals.js';

export const ALL_SHAPES = [...SHAPES, ...FRACTALS];

export function getShapeById(shapeId) {
  return ALL_SHAPES.find((s) => s.id === shapeId) ?? null;
}

export function isValidShapeId(shapeId) {
  return getShapeById(shapeId) !== null;
}

export function getShapeGeometry(shapeId, size = 60) {
  switch (shapeId) {
    case 'triangle':
      return { type: 'polygon', points: trianglePoints(size) };
    case 'square':
      return { type: 'polygon', points: squarePoints(size) };
    case 'sierpinski':
      return { type: 'triangles', triangles: sierpinskiTriangles(size, 4) };
    case 'koch':
      return { type: 'polygon', points: kochSnowflakePoints(size, 3) };
    default:
      return null;
  }
}

// 프론트(수동 편집)와 백엔드(AI 채팅 addPart) 양쪽에서 part id를 생성할 때 공용으로 쓴다.
export function generatePartId() {
  return `p${Math.random().toString(36).slice(2, 8)}`;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node shapes/registry.test.mjs`
Expected: `registry.test.mjs: OK`

- [ ] **Step 5: 커밋**

```bash
git add shapes/registry.js shapes/registry.test.mjs
git commit -m "feat: 도형 레지스트리(ALL_SHAPES/getShapeGeometry/generatePartId) 추가"
```

---

## Task 4: 무기 정규화 + 캐시 키 + 시드 확정값 (`backend/lib/weaponCache.js`)

**Files:**
- Create: `backend/lib/weaponCache.js`
- Test: `backend/lib/weaponCache.test.mjs`

**Interfaces:**
- Produces: `normalize(weaponState): part[]`, `cacheKey(weaponState): string`, `seededPick(key, min, max): number`, `getCached(key): number|undefined`, `setCached(key, damage): void`, `seedCache(samples): void`, `cacheSize(): number`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// backend/lib/weaponCache.test.mjs
import assert from 'node:assert';
import { normalize, cacheKey, seededPick, getCached, setCached, seedCache, cacheSize } from './weaponCache.js';

// 살짝 다른(드래그 오차) 두 무기는 같은 키로 수렴해야 함
const a = { parts: [{ id: 'p1', shapeId: 'triangle', x: 101, y: 99, rotation: 2, scale: 1.01 }] };
const b = { parts: [{ id: 'p2', shapeId: 'triangle', x: 104, y: 96, rotation: 6, scale: 1.04 }] };

// normalize 자체도 직접 검증 — 10px/15도 단위로 반올림되는지
const normA = normalize(a);
assert.strictEqual(normA[0].x, 100);
assert.strictEqual(normA[0].y, 100);
assert.strictEqual(normA[0].rotation, 0);

// 음수 회전(반시계 드래그로 자연스럽게 발생)도 [0,360) 범위로 정규화되어야 함 (-30도 == 330도)
const negRotation = { parts: [{ id: 'p1', shapeId: 'triangle', x: 0, y: 0, rotation: -30, scale: 1 }] };
const posRotation = { parts: [{ id: 'p2', shapeId: 'triangle', x: 0, y: 0, rotation: 330, scale: 1 }] };
assert.strictEqual(normalize(negRotation)[0].rotation, 330);
assert.strictEqual(cacheKey(negRotation), cacheKey(posRotation), '-30도와 330도는 같은 캐시 키');

assert.strictEqual(cacheKey(a), cacheKey(b), '거의 같은 무기는 같은 캐시 키');

// 확실히 다른 무기는 다른 키
const c = { parts: [{ id: 'p3', shapeId: 'square', x: 101, y: 99, rotation: 2, scale: 1.01 }] };
assert.notStrictEqual(cacheKey(a), cacheKey(c));

// 시드 확정값은 같은 키에 항상 같은 값
const p1 = seededPick(cacheKey(a), 100, 200);
const p2 = seededPick(cacheKey(b), 100, 200);
assert.strictEqual(p1, p2);
assert.ok(p1 >= 100 && p1 <= 200);

// 캐시 get/set
const key = cacheKey(a);
assert.strictEqual(getCached(key), undefined);
setCached(key, 5000);
assert.strictEqual(getCached(key), 5000);

// 사전 시딩
const before = cacheSize();
seedCache([{ parts: [{ id: 'x', shapeId: 'koch', x: 0, y: 0, rotation: 0, scale: 1 }], damage: 999 }]);
assert.strictEqual(cacheSize(), before + 1);

console.log('weaponCache.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/lib/weaponCache.test.mjs`
Expected: `Cannot find module './weaponCache.js'`로 FAIL

- [ ] **Step 3: 구현**

```js
// backend/lib/weaponCache.js
const cache = new Map();

// x/y는 10px 단위, rotation은 15도 단위로 반올림해서 "거의 같은 무기"를 같은 키로 수렴시킨다.
export function normalize(weaponState) {
  return [...weaponState.parts]
    .map((p) => ({
      shapeId: p.shapeId,
      x: Math.round(p.x / 10) * 10,
      y: Math.round(p.y / 10) * 10,
      // JS의 %는 음수 부호를 그대로 보존하므로(-30 % 360 === -30), +360 후 다시 %로 [0,360) 범위로 감는다.
      // Konva 드래그로 반시계 방향 회전하면 rotation이 자연스럽게 음수가 되므로 이 처리가 없으면
      // -30도와 330도(시각적으로 동일)가 다른 캐시 키로 갈라진다.
      rotation: (((Math.round(p.rotation / 15) * 15) % 360) + 360) % 360,
      scale: Math.round(p.scale * 10) / 10,
    }))
    .sort((a, b) => a.shapeId.localeCompare(b.shapeId) || a.x - b.x || a.y - b.y);
}

export function cacheKey(weaponState) {
  return JSON.stringify(normalize(weaponState));
}

// 같은 key는 항상 같은 정수를 [min, max] 범위 안에서 반환 (결정론적 해시 기반)
export function seededPick(key, min, max) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  const range = max - min + 1;
  return min + (hash % range);
}

export function getCached(key) {
  return cache.get(key);
}

export function setCached(key, damage) {
  cache.set(key, damage);
}

// few-shot 샘플(팀이 미리 만든 무기-데미지 쌍)을 캐시에 미리 채워, 그 무기들은 AI 호출 없이 항상 정해진 값이 나가게 한다.
export function seedCache(samples) {
  for (const sample of samples) {
    cache.set(cacheKey(sample), sample.damage);
  }
}

export function cacheSize() {
  return cache.size;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/lib/weaponCache.test.mjs`
Expected: `weaponCache.test.mjs: OK`

- [ ] **Step 5: 커밋**

```bash
git add backend/lib/weaponCache.js backend/lib/weaponCache.test.mjs
git commit -m "feat: 무기 정규화/캐시키/시드 확정값 함수 추가"
```

---

## Task 5: few-shot 샘플 (`backend/lib/weaponEvaluationSamples.js`)

**Files:**
- Create: `backend/lib/weaponEvaluationSamples.js`

**Interfaces:**
- Consumes: 없음 (정적 데이터)
- Produces: `SAMPLES: {parts, damage, note}[]`

이 파일의 실제 샘플 값(팀이 채점 기준으로 삼을 무기-데미지 쌍)은 이후 팀이 직접 다듬을 자리다. 지금은 형식이 맞는 예시 3개로 시작한다.

- [ ] **Step 1: 구현** (순수 데이터 파일이라 별도 실패 테스트 없이 바로 작성, Task 4의 `seedCache`로 다음 태스크에서 검증됨)

```js
// backend/lib/weaponEvaluationSamples.js
// AI 채점 few-shot 프롬프트 + 캐시 사전 시딩 겸용 샘플. damage는 팀이 정한 기준값.
export const SAMPLES = [
  {
    parts: [{ id: 's1', shapeId: 'triangle', x: 100, y: 100, rotation: 0, scale: 1 }],
    damage: 3000,
    note: '기본 삼각형 검',
  },
  {
    parts: [{ id: 's1', shapeId: 'square', x: 100, y: 100, rotation: 0, scale: 1 }],
    damage: 2500,
    note: '기본 사각형 방패',
  },
  {
    parts: [
      { id: 's1', shapeId: 'sierpinski', x: 100, y: 60, rotation: 0, scale: 0.6 },
      { id: 's2', shapeId: 'square', x: 100, y: 140, rotation: 0, scale: 1.4 },
    ],
    damage: 7200,
    note: '시에르핀스키 촉 + 사각 손잡이 창',
  },
];
```

- [ ] **Step 2: 검증**

Run:
```bash
node -e "import('./backend/lib/weaponEvaluationSamples.js').then(m => console.log(m.SAMPLES.length, 'samples loaded'))"
```
Expected: `3 samples loaded`

- [ ] **Step 3: 커밋**

```bash
git add backend/lib/weaponEvaluationSamples.js
git commit -m "feat: AI 채점 few-shot 샘플 데이터 추가"
```

---

## Task 6: AI 클라이언트 — 키 로테이션 + MOCK_AI + evaluateWeapon (`backend/lib/aiClient.js`)

**Files:**
- Modify: `backend/lib/aiClient.js` (전체 재작성)
- Modify: `backend/.env.example`
- Test: `backend/lib/aiClient.test.mjs`

**Interfaces:**
- Consumes: `normalize/cacheKey/seededPick/getCached/setCached/seedCache` (Task 4), `SAMPLES` (Task 5)
- Produces: `DAMAGE_MIN = 1`, `DAMAGE_MAX = 10000`, `evaluateWeapon(weaponState): Promise<{damage:number, cached:boolean}>`. (`interpretCommand`는 Task 7에서 같은 파일에 추가)

MOCK_AI=true일 때는 실제 Gemini 호출 없이 `seededPick`으로 결정론적 값을 바로 반환한다 — 로테이션 토큰을 쓰지 않고도 캐시/시드 로직 전체를 검증할 수 있다.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// backend/lib/aiClient.test.mjs
import assert from 'node:assert';

process.env.MOCK_AI = 'true';
const { evaluateWeapon, DAMAGE_MIN, DAMAGE_MAX } = await import('./aiClient.js');

const weapon = { parts: [{ id: 'p1', shapeId: 'triangle', x: 50, y: 50, rotation: 0, scale: 1 }] };

const first = await evaluateWeapon(weapon);
assert.strictEqual(first.cached, false, '첫 호출은 캐시 미스');
assert.ok(first.damage >= DAMAGE_MIN && first.damage <= DAMAGE_MAX);

const second = await evaluateWeapon(weapon);
assert.strictEqual(second.cached, true, '두번째 호출은 캐시 히트');
assert.strictEqual(second.damage, first.damage, '캐시된 값은 동일해야 함');

console.log('aiClient.test.mjs (evaluateWeapon): OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/lib/aiClient.test.mjs`
Expected: `evaluateWeapon is not a function` 등으로 FAIL (기존 aiClient.js에는 `generateWeapon`만 있음)

- [ ] **Step 3: 구현**

`backend/lib/aiClient.js` 전체를 아래로 교체 (tool calling인 `interpretCommand`의 실제 본문은 Task 7에서 채움 — 지금은 이 태스크에서 필요한 `evaluateWeapon`과 공용 인프라만 완성):

```js
// backend/lib/aiClient.js — Gemini 연동: 무기 채팅 해석 + 무기 채점
import { cacheKey, seededPick, getCached, setCached, seedCache } from './weaponCache.js';
import { SAMPLES } from './weaponEvaluationSamples.js';

export const DAMAGE_MIN = 1;
export const DAMAGE_MAX = 10000;
const GEMINI_MODEL = 'gemini-2.0-flash';

seedCache(SAMPLES);

function getKeyPool() {
  return (process.env.GEMINI_API_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

let keyIndex = 0;
function nextKey(pool) {
  const key = pool[keyIndex % pool.length];
  keyIndex += 1;
  return key;
}

// 키 풀을 순환하며 요청. 429(rate limit)면 다음 키로 재시도, 그 외 에러는 즉시 던짐.
async function callGeminiWithRotation(requestFn) {
  const pool = getKeyPool();
  if (pool.length === 0) {
    const err = new Error('GEMINI_API_KEYS not configured');
    throw err;
  }
  let lastError;
  for (let attempt = 0; attempt < pool.length; attempt += 1) {
    const key = nextKey(pool);
    try {
      return await requestFn(key);
    } catch (err) {
      lastError = err;
      if (err.status !== 429) throw err;
    }
  }
  throw lastError;
}

// TODO(후속 태스크): 실제 Gemini fetch 호출 + 프롬프트 구성(few-shot 예시 포함) 구현.
// 지금은 데모/영상 촬영이 급해서 MOCK_AI 경로만 완성하고 이 함수는 스텁으로 둔다.
// evaluateWeapon()이 이 함수를 호출하는 건 MOCK_AI가 아닐 때뿐이고, 이 함수가 던지면
// weaponEvaluate.js 라우트가 이미 fallbackDamage()로 안전하게 폴백하도록 되어 있어서(Task 8),
// 지금 스텁 상태로 둬도 다른 경로가 깨지지 않는다. 나중에 구현할 때 prompt 문구는
// SAMPLES(few-shot 예시)를 "- {parts} → 데미지 N (note)" 형태로 나열하고,
// "절대값이 아니라 범위(min,max)로 답해라. max-min은 1000 이내로 좁게" 지시를 포함시킬 것.
async function requestDamageRange() {
  throw new Error('requestDamageRange not implemented yet — real Gemini call is a follow-up task');
}

// 완성된 무기를 AI에게 채점받는다. 같은(또는 거의 같은) 무기는 항상 같은 damage를 반환한다.
export async function evaluateWeapon(weaponState) {
  const key = cacheKey(weaponState);
  const cached = getCached(key);
  if (cached !== undefined) {
    return { damage: cached, cached: true };
  }

  if (process.env.MOCK_AI === 'true') {
    const damage = seededPick(key, DAMAGE_MIN, DAMAGE_MAX);
    setCached(key, damage);
    return { damage, cached: false };
  }

  const { min, max } = await callGeminiWithRotation((apiKey) => requestDamageRange(apiKey, weaponState));
  const damage = seededPick(key, Math.max(DAMAGE_MIN, min), Math.min(DAMAGE_MAX, max));
  setCached(key, damage);
  return { damage, cached: false };
}

// Task 7에서 구현 채움
export async function interpretCommand() {
  throw new Error('not implemented yet — see Task 7');
}
```

`backend/.env.example`에 추가:

```
GEMINI_API_KEYS=key1,key2,key3
MOCK_AI=false
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `MOCK_AI=true node backend/lib/aiClient.test.mjs`
Expected: `aiClient.test.mjs (evaluateWeapon): OK`

- [ ] **Step 5: 커밋**

```bash
git add backend/lib/aiClient.js backend/lib/aiClient.test.mjs backend/.env.example
git commit -m "feat: aiClient 키 로테이션 + MOCK_AI + evaluateWeapon 구현"
```

---

## Task 7: AI 클라이언트 — interpretCommand 툴콜 (`backend/lib/aiClient.js`)

**Files:**
- Modify: `backend/lib/aiClient.js`
- Test: `backend/lib/aiClient.chat.test.mjs`

**Interfaces:**
- Consumes: `callGeminiWithRotation` (Task 6, 같은 파일 내부 함수)
- Produces: `interpretCommand({weaponState, message, availableShapeIds, canvasSize}): Promise<{toolCalls: {op,...}[], reply: string}>`

MOCK_AI=true일 때는 고정된 `addPart` 툴콜 하나를 반환해 실제 API 없이 이후 라우트/프론트 통합 테스트가 가능하게 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// backend/lib/aiClient.chat.test.mjs
import assert from 'node:assert';

process.env.MOCK_AI = 'true';
const { interpretCommand } = await import('./aiClient.js');

const weapon = { parts: [] };
const result = await interpretCommand({
  weaponState: weapon,
  message: '삼각형 하나 추가해줘',
  availableShapeIds: ['triangle', 'square', 'sierpinski', 'koch'],
  canvasSize: { width: 480, height: 480 },
});

assert.ok(Array.isArray(result.toolCalls));
assert.ok(result.toolCalls.length > 0);
assert.strictEqual(result.toolCalls[0].op, 'addPart');
assert.strictEqual(typeof result.reply, 'string');

console.log('aiClient.chat.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/lib/aiClient.chat.test.mjs`
Expected: `not implemented yet — see Task 7` 에러로 FAIL

- [ ] **Step 3: 구현**

`backend/lib/aiClient.js`에서 `export async function interpretCommand() { throw ... }` placeholder를 아래로 교체. 실제 Gemini 연동(`requestToolCalls`)은 후속 태스크로 미루고 지금은 스텁 + MOCK_AI 경로만 완성한다 (데모/영상 촬영 우선):

```js
// TODO(후속 태스크): 실제 Gemini function-calling 연동 구현. 지금은 데모/영상 촬영이 급해서
// MOCK_AI 경로(mockInterpretCommand)만 완성하고 실제 호출은 스텁으로 둔다.
// weaponChat.js 라우트(Task 8)는 interpretCommand가 던지면 502로 응답하도록 이미 되어 있어서,
// 스텁 상태로 둬도 다른 경로가 깨지지 않는다 (MOCK_AI=false로 실행하면 채팅이 매번 에러 표시만 됨).
//
// 나중에 구현할 때 필요한 tool 스키마(5개, Gemini function-calling 형식)와 시스템 프롬프트 요지:
//   - addPart(shapeId, x, y, rotation?, scale?) — 새 부품 추가
//   - movePart(partId, x, y) — 이동
//   - rotatePart(partId, rotation) — 회전
//   - scalePart(partId, scale) — 크기조절
//   - removePart(partId) — 삭제
//   시스템 프롬프트에는 사용 가능한 shapeId 목록, 캔버스 크기, 현재 weaponState.parts,
//   "부품은 최대 10개까지" 제약을 포함시킬 것. 응답은 functionCall 파트들 + 텍스트 reply 파트를
//   한 응답 안에서 함께 받는다(멀티스텝 루프 불필요).
async function requestToolCalls() {
  throw new Error('requestToolCalls not implemented yet — real Gemini call is a follow-up task');
}

function mockInterpretCommand(message) {
  return {
    toolCalls: [{ op: 'addPart', shapeId: 'triangle', x: 100, y: 100, rotation: 0, scale: 1 }],
    reply: `(MOCK) "${message}" 명령을 반영했어요.`,
  };
}

export async function interpretCommand({ weaponState, message, availableShapeIds, canvasSize }) {
  if (process.env.MOCK_AI === 'true') {
    return mockInterpretCommand(message);
  }
  return callGeminiWithRotation((apiKey) =>
    requestToolCalls(apiKey, weaponState, message, availableShapeIds, canvasSize),
  );
}
```

(이 코드는 파일 하단의 기존 `export async function interpretCommand() { throw ... }` 자리를 대체한다. `requestToolCalls`/`mockInterpretCommand`는 `callGeminiWithRotation` 정의 아래, `evaluateWeapon` 위나 아래 아무 곳에 추가해도 무방하다.)

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/lib/aiClient.chat.test.mjs`
Expected: `aiClient.chat.test.mjs: OK`

- [ ] **Step 5: 기존 evaluateWeapon 테스트도 여전히 통과하는지 회귀 확인**

Run: `node backend/lib/aiClient.test.mjs`
Expected: `aiClient.test.mjs (evaluateWeapon): OK`

- [ ] **Step 6: 커밋**

```bash
git add backend/lib/aiClient.js backend/lib/aiClient.chat.test.mjs
git commit -m "feat: aiClient interpretCommand(tool calling) 구현"
```

---

## Task 8: 백엔드 라우트 — `/api/weapon/chat`, `/api/weapon/evaluate`

**Files:**
- Create: `backend/routes/weaponChat.js`
- Create: `backend/routes/weaponEvaluate.js`
- Modify: `backend/server.js`
- Test: `backend/routes/weaponChat.test.mjs`, `backend/routes/weaponEvaluate.test.mjs`

(`backend/routes/weapon.js`는 구 2단계 텍스트 흐름 전용 파일로 이미 Task 6에서 삭제됨 — Task 6이
`aiClient.js`에서 `generateWeapon`을 제거하면서 이 파일이 참조하던 export가 없어져 서버가
아예 기동을 못 하는 걸 리뷰에서 발견해서, 그 자리에서 같이 정리했다. 그래서 이 태스크는
새 라우트만 만들고 연결하면 된다.)

**Interfaces:**
- Consumes: `interpretCommand`, `evaluateWeapon`, `DAMAGE_MIN`, `DAMAGE_MAX` (Task 6/7), `isValidShapeId`, `ALL_SHAPES`, `getShapeById` (Task 3), `statsFromShape` (기존 `shapes/stats.js`)
- Produces: `applyToolCalls(weaponState, toolCalls): weaponState` (weaponChat.js, 테스트용 named export), `fallbackDamage(weaponState): number` (weaponEvaluate.js, 테스트용 named export), `CANVAS_SIZE`, `MAX_PARTS` (weaponChat.js)

라우트 자체(HTTP 핸들러)는 실제 서버를 띄워야 정확히 테스트되지만, 핵심 로직(`applyToolCalls`, `fallbackDamage`)은 순수 함수로 분리해 라우터 파일에서 바로 export하고 네트워크 없이 테스트한다.

- [ ] **Step 1: 실패하는 테스트 작성 (applyToolCalls)**

```js
// backend/routes/weaponChat.test.mjs
import assert from 'node:assert';
import { applyToolCalls, MAX_PARTS, CANVAS_SIZE } from './weaponChat.js';

const empty = { parts: [] };

// addPart: 정상 추가
const afterAdd = applyToolCalls(empty, [{ op: 'addPart', shapeId: 'triangle', x: 100, y: 100 }]);
assert.strictEqual(afterAdd.parts.length, 1);
assert.strictEqual(afterAdd.parts[0].shapeId, 'triangle');

// addPart: 잘못된 shapeId는 무시
const afterBadAdd = applyToolCalls(empty, [{ op: 'addPart', shapeId: 'not-a-shape', x: 0, y: 0 }]);
assert.strictEqual(afterBadAdd.parts.length, 0);

// addPart: 캔버스 범위를 벗어난 좌표는 clamp
const afterClamp = applyToolCalls(empty, [{ op: 'addPart', shapeId: 'square', x: 99999, y: -999 }]);
assert.strictEqual(afterClamp.parts[0].x, CANVAS_SIZE.width);
assert.strictEqual(afterClamp.parts[0].y, 0);

// addPart: 상한(MAX_PARTS) 초과분은 무시
const many = Array.from({ length: MAX_PARTS + 5 }, () => ({ op: 'addPart', shapeId: 'triangle', x: 1, y: 1 }));
const afterMany = applyToolCalls(empty, many);
assert.strictEqual(afterMany.parts.length, MAX_PARTS);

// movePart / rotatePart / scalePart / removePart
const withOne = { parts: [{ id: 'p1', shapeId: 'triangle', x: 10, y: 10, rotation: 0, scale: 1 }] };
const moved = applyToolCalls(withOne, [{ op: 'movePart', partId: 'p1', x: 50, y: 60 }]);
assert.strictEqual(moved.parts[0].x, 50);
assert.strictEqual(moved.parts[0].y, 60);

const rotated = applyToolCalls(withOne, [{ op: 'rotatePart', partId: 'p1', rotation: 45 }]);
assert.strictEqual(rotated.parts[0].rotation, 45);

const scaled = applyToolCalls(withOne, [{ op: 'scalePart', partId: 'p1', scale: 99 }]);
assert.strictEqual(scaled.parts[0].scale, 3, 'scale은 3.0으로 clamp');

const scaledLow = applyToolCalls(withOne, [{ op: 'scalePart', partId: 'p1', scale: 0.01 }]);
assert.strictEqual(scaledLow.parts[0].scale, 0.2, 'scale은 0.2로 하한 clamp');

const removed = applyToolCalls(withOne, [{ op: 'removePart', partId: 'p1' }]);
assert.strictEqual(removed.parts.length, 0);

// clamp()는 숫자가 아닌/누락된 값이 들어와도 NaN을 절대 반환하면 안 된다 (min으로 안전하게 대체)
const afterMissingXY = applyToolCalls(empty, [{ op: 'addPart', shapeId: 'triangle' }]);
assert.strictEqual(afterMissingXY.parts[0].x, 0);
assert.strictEqual(afterMissingXY.parts[0].y, 0);

const afterBadScale = applyToolCalls(empty, [
  { op: 'addPart', shapeId: 'triangle', x: 10, y: 10, scale: 'large' },
]);
assert.strictEqual(afterBadScale.parts[0].scale, 0.2);

console.log('weaponChat.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/routes/weaponChat.test.mjs`
Expected: `Cannot find module './weaponChat.js'`로 FAIL

- [ ] **Step 3: weaponChat.js 구현**

```js
// backend/routes/weaponChat.js
import { Router } from 'express';
import { interpretCommand } from '../lib/aiClient.js';
import { ALL_SHAPES, isValidShapeId, generatePartId } from '../../shapes/registry.js';

export const CANVAS_SIZE = { width: 480, height: 480 };
export const MAX_PARTS = 10;

// AI(interpretCommand)가 필드를 누락하거나 숫자가 아닌 값을 줘도 NaN이 새어나가지 않게
// min으로 안전하게 대체한다 — NaN은 [min,max] 범위 밖이라 Global Constraints를 깨뜨림.
function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

export function applyToolCalls(weaponState, toolCalls) {
  let parts = [...weaponState.parts];
  for (const call of toolCalls) {
    if (call.op === 'addPart') {
      if (!isValidShapeId(call.shapeId)) continue;
      if (parts.length >= MAX_PARTS) continue;
      parts.push({
        id: generatePartId(),
        shapeId: call.shapeId,
        x: clamp(call.x, 0, CANVAS_SIZE.width),
        y: clamp(call.y, 0, CANVAS_SIZE.height),
        rotation: call.rotation ?? 0,
        scale: clamp(call.scale ?? 1, 0.2, 3),
      });
    } else if (call.op === 'movePart') {
      parts = parts.map((p) =>
        p.id === call.partId
          ? { ...p, x: clamp(call.x, 0, CANVAS_SIZE.width), y: clamp(call.y, 0, CANVAS_SIZE.height) }
          : p,
      );
    } else if (call.op === 'rotatePart') {
      parts = parts.map((p) => (p.id === call.partId ? { ...p, rotation: call.rotation } : p));
    } else if (call.op === 'scalePart') {
      parts = parts.map((p) => (p.id === call.partId ? { ...p, scale: clamp(call.scale, 0.2, 3) } : p));
    } else if (call.op === 'removePart') {
      parts = parts.filter((p) => p.id !== call.partId);
    }
  }
  return { parts };
}

const router = Router();

router.post('/', async (req, res) => {
  const { weaponState, message } = req.body;
  try {
    const availableShapeIds = ALL_SHAPES.map((s) => s.id);
    const { toolCalls, reply } = await interpretCommand({
      weaponState,
      message,
      availableShapeIds,
      canvasSize: CANVAS_SIZE,
    });
    const updated = applyToolCalls(weaponState, toolCalls);
    res.json({ weaponState: updated, reply });
  } catch (err) {
    res.status(502).json({ error: 'chat failed' });
  }
});

export default router;
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/routes/weaponChat.test.mjs`
Expected: `weaponChat.test.mjs: OK`

- [ ] **Step 5: 실패하는 테스트 작성 (fallbackDamage)**

```js
// backend/routes/weaponEvaluate.test.mjs
import assert from 'node:assert';
import { fallbackDamage } from './weaponEvaluate.js';

const weapon = { parts: [{ id: 'p1', shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 1 }] };
const damage = fallbackDamage(weapon);
assert.ok(damage >= 1 && damage <= 10000, 'fallback damage must stay in [1, 10000]');
assert.strictEqual(typeof damage, 'number');

console.log('weaponEvaluate.test.mjs: OK');
```

- [ ] **Step 6: 테스트 실행해서 실패 확인**

Run: `node backend/routes/weaponEvaluate.test.mjs`
Expected: `Cannot find module './weaponEvaluate.js'`로 FAIL

- [ ] **Step 7: weaponEvaluate.js 구현**

```js
// backend/routes/weaponEvaluate.js
import { Router } from 'express';
import { evaluateWeapon, DAMAGE_MIN, DAMAGE_MAX } from '../lib/aiClient.js';
import { getShapeById } from '../../shapes/registry.js';
import { statsFromShape } from '../../shapes/stats.js';

// AI 채점이 전부 실패했을 때 쓰는 결정론적 폴백 — 참가자가 절대 막히지 않게 한다.
export function fallbackDamage(weaponState) {
  const total = weaponState.parts.reduce((sum, p) => {
    const shape = getShapeById(p.shapeId);
    const stats = statsFromShape(shape);
    return sum + (stats.attack + stats.defense) * p.scale;
  }, 0);
  return Math.round(Math.min(DAMAGE_MAX, Math.max(DAMAGE_MIN, total * 100)));
}

const router = Router();

router.post('/', async (req, res) => {
  const { weaponState } = req.body;
  try {
    const { damage } = await evaluateWeapon(weaponState);
    res.json({ damage });
  } catch (err) {
    res.json({ damage: fallbackDamage(weaponState), fallback: true });
  }
});

export default router;
```

- [ ] **Step 8: 테스트 실행해서 통과 확인**

Run: `node backend/routes/weaponEvaluate.test.mjs`
Expected: `weaponEvaluate.test.mjs: OK`

- [ ] **Step 9: server.js에 신규 라우트 연결**

`backend/server.js`의 기존 라우트 import들 옆에 추가:
```js
import weaponChatRoutes from './routes/weaponChat.js';
import weaponEvaluateRoutes from './routes/weaponEvaluate.js';
```

그리고 기존 `app.use(...)` 라우트 마운트들 옆에 추가:
```js
app.use('/api/weapon/chat', weaponChatRoutes);
app.use('/api/weapon/evaluate', weaponEvaluateRoutes);
```

- [ ] **Step 10: 서버 기동 확인**

Run:
```bash
cd backend && MOCK_AI=true node server.js &
sleep 1
curl -s -X POST http://localhost:3000/api/weapon/chat -H 'Content-Type: application/json' \
  -d '{"weaponState":{"parts":[]},"message":"삼각형 추가해줘"}'
curl -s -X POST http://localhost:3000/api/weapon/evaluate -H 'Content-Type: application/json' \
  -d '{"weaponState":{"parts":[{"id":"p1","shapeId":"triangle","x":10,"y":10,"rotation":0,"scale":1}]}}'
kill %1
```
Expected: 첫 curl은 `{"weaponState":{"parts":[{...triangle...}]},"reply":"(MOCK) ..."}`, 둘째 curl은 `{"damage": <1~10000 사이 숫자>}`

- [ ] **Step 11: 커밋**

```bash
git add backend/routes/weaponChat.js backend/routes/weaponEvaluate.js backend/routes/weaponChat.test.mjs backend/routes/weaponEvaluate.test.mjs backend/server.js
git commit -m "feat: /api/weapon/chat, /api/weapon/evaluate 라우트 추가"
```

---

## Task 9: `session.js` — `create:done` 참가자 추적 + battle 전환

**Files:**
- Modify: `backend/socket/session.js`
- Test: `backend/socket/session.createDone.test.mjs`

**Interfaces:**
- Consumes: `goToStage` (기존, 같은 파일 내부 함수)
- Produces: `create:done` 소켓 핸들러가 `cohort.participants`를 채우고, 5명 전원 완료 시 `stage:change`로 `'battle'`을 broadcast

기존 코드에는 `EXPECTED_PARTICIPANTS`나 참가자 등록 절차가 없다. `docs/초안.md`의 "5명 단위 입장" 전제를 그대로 가져와 5를 고정 상수로 쓴다 (참가자 사전 등록 자체는 이 스펙 범위 밖).

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// backend/socket/session.createDone.test.mjs
import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';

const handlers = {};
function makeSocket(id) {
  // registerSessionHandlers는 등록 시점에 socket.emit('stage:change', ...)을 바로 호출한다
  // (신규 접속 동기화 기능) — 목 소켓에도 emit이 있어야 한다.
  return {
    id,
    on: (ev, fn) => { handlers[id] = handlers[id] || {}; handlers[id][ev] = fn; },
    emit: () => {},
  };
}
const emitted = [];
const io = { emit: (ev, payload) => emitted.push([ev, payload]) };

// 5개의 서로 다른 소켓을 등록
for (let i = 1; i <= 5; i += 1) {
  registerSessionHandlers(io, makeSocket(`s${i}`));
}

// 4명만 완료 — 아직 battle로 안 넘어가야 함
for (let i = 1; i <= 4; i += 1) {
  handlers[`s${i}`]['create:done']({ damage: 1000 * i });
}
assert.ok(!emitted.some(([ev, stage]) => ev === 'stage:change' && stage === 'battle'), '4명만 완료 시 battle 전환 안 됨');

// 5번째 완료 — battle로 전환되어야 함
handlers['s5']['create:done']({ damage: 5000 });
assert.ok(emitted.some(([ev, stage]) => ev === 'stage:change' && stage === 'battle'), '5명 전원 완료 시 battle 전환');

console.log('session.createDone.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/socket/session.createDone.test.mjs`
Expected: assertion 실패 (`create:done`이 지금은 빈 함수라 아무 것도 안 함) — `AssertionError`로 FAIL

- [ ] **Step 3: 구현**

`backend/socket/session.js`에서 `registerSessionHandlers` 함수 시작 부분(다른 `socket.on(...)` 등록들과 같은 위치)에 상수 하나와 핸들러를 추가/교체:

파일 상단, `const STAGE_ORDER = [...]` 아래에 추가:
```js
const EXPECTED_PARTICIPANTS = 5;
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
      existing.done = true;
      existing.weapon = weapon;
    } else {
      cohort.participants.push({ id: socket.id, done: true, weapon });
    }
    const doneCount = cohort.participants.filter((p) => p.done).length;
    if (doneCount >= EXPECTED_PARTICIPANTS) {
      goToStage(io, 'battle');
    }
  });
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/socket/session.createDone.test.mjs`
Expected: `session.createDone.test.mjs: OK`

- [ ] **Step 5: 기존 stage-order 테스트 회귀 확인 (이전 세션에서 만든 것과 동일한 패턴)**

Run:
```bash
node -e "
import('./backend/socket/session.js').then(({registerSessionHandlers}) => {
  const handlers = {};
  const socket = { id: 'admin', on: (ev, fn) => { handlers[ev] = fn; } };
  const emitted = [];
  const io = { emit: (ev, payload) => emitted.push([ev, payload]) };
  registerSessionHandlers(io, socket);
  handlers['admin:startSession']();
  handlers['admin:nextStage']();
  console.log(emitted.filter(([ev]) => ev === 'stage:change').map(([,s]) => s).join(' -> '));
});
"
```
Expected: `learn -> create`

- [ ] **Step 6: 커밋**

```bash
git add backend/socket/session.js backend/socket/session.createDone.test.mjs
git commit -m "feat: session.js create:done 참가자 추적 + 전원 완료 시 battle 전환"
```

---

## Task 10: 프론트 — Konva 도입 + CanvasEditor 배치/드래그

**Files:**
- Modify: `frontend/index.html` (import map에 Konva 추가)
- Create: `frontend/src/screens/create/CanvasEditor.js`
- Create: `frontend/src/screens/create/create.css`

**Interfaces:**
- Consumes: `ALL_SHAPES`, `getShapeGeometry`, `generatePartId` (Task 3)
- Produces: `CanvasEditor({parts, onChange, onStageReady})` Preact 컴포넌트, `CANVAS_SIZE`

이 태스크는 순수 함수가 아니라 실제 브라우저 렌더링이 필요해서, "실패하는 자동 테스트"를 먼저 쓰기보다 **구현 후 Playwright로 확인**하는 방식으로 진행한다 (Task 15에서 전체 흐름과 함께 자동화된 스모크 테스트로 재확인).

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
<link rel="stylesheet" href="src/screens/create/create.css" />
```

- [ ] **Step 2: CanvasEditor.js 구현**

```js
// frontend/src/screens/create/CanvasEditor.js
import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import Konva from 'konva';
import { ALL_SHAPES, getShapeGeometry, generatePartId } from '../../../../shapes/registry.js';

const html = htm.bind(h);

export const CANVAS_SIZE = { width: 480, height: 480 };
// 서버(backend/routes/weaponChat.js)의 MAX_PARTS와 같은 값 — 부품 상한 10개(Global Constraints)를
// 수동 편집(팔레트 클릭) 경로에도 동일하게 적용한다.
const MAX_PARTS = 10;

function drawShapeNode(part) {
  const geometry = getShapeGeometry(part.shapeId);
  return new Konva.Shape({
    x: part.x,
    y: part.y,
    rotation: part.rotation,
    scaleX: part.scale,
    scaleY: part.scale,
    draggable: true,
    id: part.id,
    name: 'part',
    fill: '#8fd3ff',
    stroke: '#1a5f8a',
    strokeWidth: 2,
    // 모든 좌표는 캔버스 범위(480x480) 내로 clamp (Global Constraints) — 서버 clamp(applyToolCalls)와
    // 동일 규칙을 드래그 중에도 적용.
    dragBoundFunc(pos) {
      return {
        x: Math.min(CANVAS_SIZE.width, Math.max(0, pos.x)),
        y: Math.min(CANVAS_SIZE.height, Math.max(0, pos.y)),
      };
    },
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
}

// 캔버스(좌) — 팔레트로 도형 추가, 드래그로 이동. 회전/크기조절 핸들은 Task 11에서 추가.
export function CanvasEditor({ parts, onChange, onStageReady }) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    const stage = new Konva.Stage({
      container: containerRef.current,
      width: CANVAS_SIZE.width,
      height: CANVAS_SIZE.height,
    });
    const layer = new Konva.Layer();
    stage.add(layer);
    stageRef.current = stage;
    layerRef.current = layer;
    if (onStageReady) onStageReady(stage);
    return () => stage.destroy();
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.find('.part').forEach((n) => n.destroy());
    parts.forEach((part) => {
      const node = drawShapeNode(part);
      node.on('dragend', () => {
        onChange(parts.map((p) => (p.id === part.id ? { ...p, x: node.x(), y: node.y() } : p)));
      });
      layer.add(node);
    });
    layer.draw();
  }, [parts]);

  function addShape(shapeId) {
    if (parts.length >= MAX_PARTS) return;
    onChange([
      ...parts,
      {
        id: generatePartId(),
        shapeId,
        x: CANVAS_SIZE.width / 2,
        y: CANVAS_SIZE.height / 2,
        rotation: 0,
        scale: 1,
      },
    ]);
  }

  return html`
    <div class="canvas-editor">
      <div class="shape-palette">
        ${ALL_SHAPES.map((s) => html`<button onClick=${() => addShape(s.id)}>${s.name}</button>`)}
      </div>
      <div class="canvas-container" ref=${containerRef}></div>
    </div>
  `;
}
```

- [ ] **Step 3: create.css 초안 작성**

```css
/* frontend/src/screens/create/create.css */
.create-shell {
  display: flex;
  gap: 1.5rem;
  align-items: flex-start;
  width: 100%;
  max-width: 960px;
}

.canvas-editor {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.shape-palette {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.canvas-container {
  width: 480px;
  height: 480px;
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

.chat-panel {
  display: flex;
  flex-direction: column;
  width: 320px;
  height: 480px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem;
}

.chat-msg--error {
  color: #ff8080;
}

.chat-input-row {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.chat-input-row input {
  flex: 1;
}

.evaluate-btn {
  margin-top: 1rem;
  font-size: 1.1rem;
  padding: 0.6rem 1.2rem;
}
```

- [ ] **Step 4: 수동 확인 (다음 태스크에서 create.js에 연결한 뒤 브라우저로 같이 확인 — 지금은 문법만 검증)**

Run: `node --check frontend/src/screens/create/CanvasEditor.js`
Expected: 에러 없이 종료 (import 대상 파일들이 아직 create.js에 안 연결돼 있어도 `node --check`는 문법만 봄)

- [ ] **Step 5: 커밋**

```bash
git add frontend/index.html frontend/src/screens/create/CanvasEditor.js frontend/src/screens/create/create.css
git commit -m "feat: Konva 도입 + CanvasEditor(팔레트/드래그) 컴포넌트"
```

---

## Task 11: 프론트 — CanvasEditor 회전/크기조절 핸들 + 삭제 + 스냅샷

**Files:**
- Modify: `frontend/src/screens/create/CanvasEditor.js`

**Interfaces:**
- Consumes: Task 10의 `CanvasEditor` 골격
- Produces: `CanvasEditor`에 `Konva.Transformer` 기반 회전/크기조절, 삭제 버튼 추가 (props/시그니처 변경 없음)

- [ ] **Step 1: Transformer + 선택/삭제 + transformend 처리 추가**

`CanvasEditor.js`의 첫 `useEffect`(Stage 생성부)를 아래로 교체:

```js
  useEffect(() => {
    const stage = new Konva.Stage({
      container: containerRef.current,
      width: CANVAS_SIZE.width,
      height: CANVAS_SIZE.height,
    });
    const layer = new Konva.Layer();
    const tr = new Konva.Transformer();
    layer.add(tr);
    stage.add(layer);
    stage.on('click tap', (e) => {
      if (e.target === stage) tr.nodes([]);
    });
    stageRef.current = stage;
    layerRef.current = layer;
    trRef.current = tr;
    if (onStageReady) onStageReady(stage);
    return () => stage.destroy();
  }, []);
```

`trRef` ref 선언을 `stageRef`/`layerRef` 옆에 추가:
```js
  const trRef = useRef(null);
```

두 번째 `useEffect`(parts 렌더링부)를 아래로 교체:

```js
  useEffect(() => {
    const layer = layerRef.current;
    const tr = trRef.current;
    if (!layer) return;
    layer.find('.part').forEach((n) => n.destroy());
    parts.forEach((part) => {
      const node = drawShapeNode(part);
      node.on('click tap', () => tr.nodes([node]));
      node.on('dragend', () => {
        onChange(parts.map((p) => (p.id === part.id ? { ...p, x: node.x(), y: node.y() } : p)));
      });
      node.on('transformend', () => {
        // scale 범위 0.2~3.0 (Global Constraints) — 서버 쪽 clamp(applyToolCalls)와 동일 범위를
        // 수동 드래그 편집에도 적용. 노드 자체의 scale도 되돌려서 화면이 clamp된 값과 어긋나지 않게 한다.
        const clampedScale = Math.min(3, Math.max(0.2, node.scaleX()));
        node.scaleX(clampedScale);
        node.scaleY(clampedScale);
        onChange(
          parts.map((p) =>
            p.id === part.id
              ? { ...p, x: node.x(), y: node.y(), rotation: node.rotation(), scale: clampedScale }
              : p,
          ),
        );
      });
      layer.add(node);
    });
    tr.moveToTop();
    layer.draw();
  }, [parts]);
```

`addShape` 함수 아래에 삭제 함수 추가:
```js
  function deleteSelected() {
    const tr = trRef.current;
    const selected = tr.nodes();
    if (selected.length === 0) return;
    const ids = selected.map((n) => n.id());
    tr.nodes([]);
    onChange(parts.filter((p) => !ids.includes(p.id)));
  }
```

팔레트 아래에 삭제 버튼 추가 — return문의 `.shape-palette` 안, 도형 버튼들 뒤에:
```js
        <button onClick=${deleteSelected}>선택 삭제</button>
```

- [ ] **Step 2: 문법 검증**

Run: `node --check frontend/src/screens/create/CanvasEditor.js`
Expected: 에러 없이 종료

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/screens/create/CanvasEditor.js
git commit -m "feat: CanvasEditor 회전/크기조절 핸들 + 선택 삭제 추가"
```

---

## Task 12: 프론트 — ChatPanel 컴포넌트

**Files:**
- Create: `frontend/src/screens/create/ChatPanel.js`

**Interfaces:**
- Consumes: `POST /api/weapon/chat` (Task 8)
- Produces: `ChatPanel({weaponState, onWeaponChange, disabled})` Preact 컴포넌트

- [ ] **Step 1: 구현**

```js
// frontend/src/screens/create/ChatPanel.js
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

export function ChatPanel({ weaponState, onWeaponChange, disabled }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    const message = input.trim();
    if (!message || sending) return;
    setMessages((m) => [...m, { role: 'user', text: message }]);
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/weapon/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weaponState, message }),
      });
      if (!res.ok) throw new Error('chat failed');
      const data = await res.json();
      onWeaponChange(data.weaponState);
      setMessages((m) => [...m, { role: 'ai', text: data.reply }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'error', text: 'AI가 응답하지 못했어요. 다시 시도해주세요.' }]);
    } finally {
      setSending(false);
    }
  }

  return html`
    <div class="chat-panel">
      <div class="chat-messages">
        ${messages.map((m) => html`<p class="chat-msg chat-msg--${m.role}">${m.text}</p>`)}
      </div>
      <div class="chat-input-row">
        <input
          value=${input}
          onInput=${(e) => setInput(e.target.value)}
          onKeyDown=${(e) => e.key === 'Enter' && send()}
          disabled=${disabled || sending}
          placeholder="어떤 무기를 만들까요?"
        />
        <button onClick=${send} disabled=${disabled || sending}>${sending ? '전송 중...' : '보내기'}</button>
      </div>
    </div>
  `;
}
```

- [ ] **Step 2: 문법 검증**

Run: `node --check frontend/src/screens/create/ChatPanel.js`
Expected: 에러 없이 종료

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/screens/create/ChatPanel.js
git commit -m "feat: ChatPanel 컴포넌트 추가"
```

---

## Task 13: 프론트 — `create.js` 오케스트레이션 (전체 조립)

**Files:**
- Modify: `frontend/src/screens/create.js` (전체 재작성)

**Interfaces:**
- Consumes: `CanvasEditor` (Task 10/11), `ChatPanel` (Task 12), `POST /api/weapon/evaluate` (Task 8)
- Produces: `CreateScreen({socket, state})` — 기존 시그니처 유지 (`app.js`의 `SCREENS.create`가 그대로 씀)

완료 시 `state.weapon`을 `result.js`/`thanks.js`가 이미 읽고 있는 필드(`name`/`image`/`stats.attack`/`stats.defense`)에 맞춰 채워서, 그 두 화면은 전혀 수정하지 않고도 계속 동작하게 한다.

- [ ] **Step 1: 구현**

`frontend/src/screens/create.js` 전체를 아래로 교체:

```js
import { h } from 'preact';
import { useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { CanvasEditor } from './create/CanvasEditor.js';
import { ChatPanel } from './create/ChatPanel.js';

const html = htm.bind(h);

// 캔버스(좌) + AI 채팅(우) 병렬 구조. docs/초안.md 7-②, 2026-08-05 설계 문서 참고.
export function CreateScreen({ socket, state }) {
  const [weaponState, setWeaponState] = useState({ parts: [] });
  const [phase, setPhase] = useState('editing'); // editing | evaluating | waiting
  const [progress] = useState({ done: 0, total: 5 });
  const stageRef = useRef(null);

  async function evaluate() {
    setPhase('evaluating');
    let damage = 1;
    try {
      const res = await fetch('/api/weapon/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weaponState }),
      });
      const data = await res.json();
      damage = data.damage;
    } catch (err) {
      damage = 1;
    }
    const previewImage = stageRef.current ? stageRef.current.toDataURL() : null;
    const weapon = {
      name: '내가 만든 무기',
      image: previewImage,
      stats: { attack: damage, defense: damage },
      damage,
      parts: weaponState.parts,
    };
    state.weapon = weapon;
    setPhase('waiting');
    socket.emit('create:done', weapon);
  }

  if (phase === 'waiting') {
    return html`
      <div class="weapon-card">
        <h3>${state.weapon?.name}</h3>
        <p>다른 도전자를 기다리는 중... (${progress.done}/${progress.total})</p>
      </div>
    `;
  }

  return html`
    <div class="create-shell">
      <${CanvasEditor}
        parts=${weaponState.parts}
        onChange=${(parts) => setWeaponState({ parts })}
        onStageReady=${(stage) => {
          stageRef.current = stage;
        }}
      />
      <${ChatPanel}
        weaponState=${weaponState}
        onWeaponChange=${setWeaponState}
        disabled=${phase !== 'editing'}
      />
      <button
        class="evaluate-btn"
        onClick=${evaluate}
        disabled=${phase !== 'editing' || weaponState.parts.length === 0}
      >
        ${phase === 'evaluating' ? '평가 중...' : 'AI 평가받기'}
      </button>
    </div>
  `;
}
```

- [ ] **Step 2: 문법 검증**

Run: `node --check frontend/src/screens/create.js`
Expected: 에러 없이 종료

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/screens/create.js
git commit -m "feat: create.js를 캔버스+채팅+평가받기 흐름으로 전면 재작성"
```

---

## Task 14: 서버 기동 + 정적 서빙 확인

**Files:** 없음 (검증 전용 태스크)

**Interfaces:** 없음

- [ ] **Step 1: MOCK_AI로 서버 기동, 신규 정적 파일 서빙 확인**

Run:
```bash
cd backend && MOCK_AI=true node server.js > /tmp/gbl-weapon-server.log 2>&1 &
sleep 1
curl -s -o /dev/null -w "index: %{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "CanvasEditor.js: %{http_code}\n" http://localhost:3000/src/screens/create/CanvasEditor.js
curl -s -o /dev/null -w "ChatPanel.js: %{http_code}\n" http://localhost:3000/src/screens/create/ChatPanel.js
curl -s -o /dev/null -w "create.css: %{http_code}\n" http://localhost:3000/src/screens/create/create.css
curl -s -o /dev/null -w "registry.js: %{http_code}\n" http://localhost:3000/../shapes/registry.js
kill %1
```
Expected: 전부 200 (마지막 `../shapes/registry.js`는 서버가 `frontend/`만 정적 서빙하므로 404가 정상 — 프론트 코드는 이 파일을 `<script type="module">` import로 가져오지 정적 URL로 직접 안 가져오기 때문. 이 줄은 그 사실을 확인하는 용도)

- [ ] **Step 2: 결과를 다음 태스크(Playwright)로 넘김 — 커밋 없음 (검증만)**

---

## Task 15: End-to-end Playwright 스모크 테스트

**Files:** 없음 (Playwright MCP로 직접 조작/확인)

**Interfaces:** 없음

- [ ] **Step 1: MOCK_AI 서버 기동**

Run:
```bash
cd backend && MOCK_AI=true node server.js > /tmp/gbl-weapon-server.log 2>&1 &
sleep 1
```

- [ ] **Step 2: Playwright로 create 화면 접속 후 도형 배치 확인**

- `http://localhost:3000` 접속 (app.js 기본 stage가 `learn`이므로, 브라우저 콘솔에서 소켓으로 stage를 `create`로 바꾸거나, 관리자 페이지에서 세션 시작 후 `다음 단계`를 눌러 `create`까지 이동)
- 팔레트에서 도형 버튼 클릭 → 캔버스에 도형이 나타나는지 스크린샷으로 확인
- 도형을 드래그 → 위치가 바뀌는지 확인

- [ ] **Step 3: 채팅 흐름 확인**

- 채팅 입력창에 아무 메시지나 입력 후 전송
- MOCK_AI 응답으로 삼각형이 하나 더 추가되고, 채팅창에 `(MOCK) ...` 응답이 뜨는지 확인

- [ ] **Step 4: 평가받기 흐름 확인**

- "AI 평가받기" 클릭
- "다른 도전자를 기다리는 중... (0/5)" 화면으로 전환되는지 확인
- 서버 로그 또는 관리자 대시보드에서 `create:done`이 처리됐는지 확인(선택 사항 — 참가자 수 카운트 UI 자체는 이 스펙 범위 밖이라, 크래시 없이 waiting 화면에 머무는지만 확인하면 충분)

- [ ] **Step 5: 서버 정리**

Run: `kill %1` (또는 `pgrep -f "node server.js"`로 찾아서 kill)

- [ ] **Step 6: 발견된 버그가 있다면 해당 태스크로 돌아가 수정 후 여기서 재확인. 문제 없으면 완료 — 커밋 없음 (이미 각 태스크에서 커밋됨)**

---

## Self-Review 메모 (계획 작성자용, 실행 시 참고)

- **스펙 커버리지**: 데이터 모델(Task 1-3), AI 채팅 tool calling(Task 6-7 후반, 8), AI 채점 일관성(Task 4-6), 제작 완료 흐름(Task 9, 13), 수동 편집(Task 10-11), 에러 처리/폴백(Task 8의 502, Task 8 fallbackDamage), MOCK_AI 테스트 인프라(Task 6) — 스펙의 모든 섹션에 대응하는 태스크가 있음
- **result.js/thanks.js는 의도적으로 미수정** — Task 13에서 `state.weapon`을 기존 필드 형태(`name/image/stats.attack/stats.defense`)에 맞춰 채우기 때문. 스펙에는 명시 안 됐던 부분이라 계획 작성 중 발견해 반영함
- **미결 사항**: few-shot 샘플의 실제 콘텐츠(Task 5의 3개 예시는 형식 검증용 placeholder에 가까움 — 팀이 실제 밸런스에 맞게 교체해야 함), 관리자 대시보드의 실시간 참가자 진행률 표시(기존부터 있던 별개 TODO, 이번 스코프 아님)
