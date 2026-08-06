# 대전 근접/원거리 공격 시스템 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 무기를 근접/원거리로 분류(AI 우선, 실패 시 결정론적 폴백)하고, 근접은 즉시 판정+데미지 보너스, 원거리는 AI가 정한 사거리만큼 실제로 투사체가 날아가게 하며, 조준 중 실제 판정 범위를 화면에 미리 보여준다.

**Architecture:** `shapes/attackGeometry.js`(신규)에 히트박스/사거리/분류 관련 상수와 순수 함수를 모아 백엔드(`battleSimulation.js`)와 프론트(`battle.js`)가 공유한다. AI 평가(`aiClient.js`)가 데미지 range와 함께 `attackRange`/`attackRangeDistance`를 반환하도록 확장되고, 그 결과가 `weaponEvaluate.js` → `create.js` → `create:done` → `battle.js`(소켓)를 거쳐 `battleSimulation.js`의 전투 로직에 반영된다.

**Tech Stack:** Node.js(순수 함수 + `node:assert` 테스트), Socket.io, Preact + htm(빌드 없음), Konva.

## Global Constraints

- `shapes/attackGeometry.js`에 다음 상수: `ATTACK_HITBOX_SIZE`(30), `RANGE_DISTANCE_MIN`(150), `RANGE_DISTANCE_MAX`(600), `ASPECT_RATIO_THRESHOLD`(2.5), `PROJECTILE_SPEED`(12), `PROJECTILE_RADIUS`(8).
- `backend/lib/battleSimulation.js`에 `MELEE_DAMAGE_MULTIPLIER`(1.3) — 근접 무기의 `hitScore`에 곱해지는 배율.
- AI(`requestWeaponEvaluation`) 응답 형태: `{ min, max, attackRange: 'melee'|'ranged', attackRangeDistance }`.
- 캐시(`weaponCache.js`)에 저장되는 값의 형태가 `number`(damage)에서 `{ damage, attackRange, attackRangeDistance }` 객체로 바뀐다.
- 근접 무기는 히트박스 위치/크기가 무기별로 안 바뀐다(고정 오프셋 유지) — 데미지 배율만 붙는다. 원거리 무기만 AI가 정한 사거리(`attackRangeDistance`)를 쓴다.
- 투사체는 관통하지 않는다(한 발에 한 명만), 속도(`PROJECTILE_SPEED`)는 전 무기 공통 고정값.
- 서버가 클라이언트/AI 제공값을 신뢰하지 않고 항상 재검증(clamp/기본값 대체)하는 이 프로젝트의 기존 원칙을 그대로 따른다.
- 프론트엔드 Konva 렌더링(투사체/미리보기)은 자동화 테스트가 없다(이 프로젝트의 기존 관례) — `node --check` + 라이브 검증으로 확인한다.

---

### Task 1: `shapes/attackGeometry.js` — 공유 상수/순수 함수

**Files:**
- Create: `shapes/attackGeometry.js`
- Create: `shapes/attackGeometry.test.mjs`

**Interfaces:**
- Consumes: 없음.
- Produces: `ATTACK_HITBOX_SIZE`, `RANGE_DISTANCE_MIN`, `RANGE_DISTANCE_MAX`, `ASPECT_RATIO_THRESHOLD`, `PROJECTILE_SPEED`, `PROJECTILE_RADIUS`(상수), `meleeHitboxRect(x, y, aimX, aimY, characterRadius)`(`{x,y,width,height}` 반환), `classifyWeaponRangeFallback(bounds)`(`{attackRange, attackRangeDistance}` 반환, `bounds`는 `{width, height}`를 가진 객체 — `shapes/weaponRenderer.js`의 `computeWeaponBounds(parts)` 반환값과 같은 형태). 이후 모든 태스크가 이 이름들을 그대로 가져다 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성(RED)**

`shapes/attackGeometry.test.mjs`를 새로 만든다:

```js
import assert from 'node:assert';
import {
  ATTACK_HITBOX_SIZE,
  RANGE_DISTANCE_MIN,
  RANGE_DISTANCE_MAX,
  ASPECT_RATIO_THRESHOLD,
  meleeHitboxRect,
  classifyWeaponRangeFallback,
} from './attackGeometry.js';

// meleeHitboxRect — 캐릭터 중심에서 조준 방향으로 오프셋만큼 떨어진 고정 크기 정사각형
{
  const rect = meleeHitboxRect(400, 300, 1, 0, 20);
  assert.strictEqual(rect.x, 420, 'centerX=400+(20+15)=435, rect.x=435-15=420');
  assert.strictEqual(rect.y, 285, 'centerY=300+0=300, rect.y=300-15=285');
  assert.strictEqual(rect.width, ATTACK_HITBOX_SIZE);
  assert.strictEqual(rect.height, ATTACK_HITBOX_SIZE);
  console.log('meleeHitboxRect computes offset rect in aim direction: OK');
}

// classifyWeaponRangeFallback — 가로세로 비율이 낮으면(뭉툭함) 근접, distance는 null
{
  const result = classifyWeaponRangeFallback({ width: 100, height: 90 });
  assert.strictEqual(result.attackRange, 'melee');
  assert.strictEqual(result.attackRangeDistance, null);
  console.log('classifyWeaponRangeFallback: compact bounds -> melee: OK');
}

// 가로세로 비율이 높으면(길쭉함) 원거리, 사거리는 min~max 범위 안
{
  const result = classifyWeaponRangeFallback({ width: 400, height: 40 });
  assert.strictEqual(result.attackRange, 'ranged');
  assert.ok(result.attackRangeDistance >= RANGE_DISTANCE_MIN && result.attackRangeDistance <= RANGE_DISTANCE_MAX);
  console.log('classifyWeaponRangeFallback: elongated bounds -> ranged with distance in range: OK');
}

// 경계값 바로 위/아래
{
  const justMelee = classifyWeaponRangeFallback({ width: ASPECT_RATIO_THRESHOLD, height: 1 });
  assert.strictEqual(justMelee.attackRange, 'melee', '비율이 임계값과 같으면(초과 아님) 근접');
  const justRanged = classifyWeaponRangeFallback({ width: ASPECT_RATIO_THRESHOLD + 0.01, height: 1 });
  assert.strictEqual(justRanged.attackRange, 'ranged', '비율이 임계값을 살짝 넘으면 원거리');
  console.log('classifyWeaponRangeFallback: threshold boundary: OK');
}

// 방어: bounds가 없거나 비어있어도(예: 부품이 하나도 없는 무기) 크래시 없이 근접으로 처리
{
  assert.doesNotThrow(() => classifyWeaponRangeFallback(undefined));
  assert.strictEqual(classifyWeaponRangeFallback(undefined).attackRange, 'melee');
  assert.strictEqual(classifyWeaponRangeFallback({ width: 0, height: 0 }).attackRange, 'melee');
  console.log('classifyWeaponRangeFallback tolerates missing/empty bounds: OK');
}

console.log('attackGeometry.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node shapes/attackGeometry.test.mjs`
Expected: FAIL — `./attackGeometry.js` 모듈을 찾을 수 없다는 에러(`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: `shapes/attackGeometry.js` 작성(GREEN)**

```js
// 공격 히트박스/사거리 관련 상수와 순수 함수 — 백엔드(backend/lib/battleSimulation.js)와
// 프론트(frontend/src/screens/battle.js) 양쪽이 이 파일을 그대로 import해서 쓴다. 미리보기
// (텔레그래프)가 실제 판정과 어긋나지 않으려면 계산식이 한 곳에만 있어야 한다 — shapes/battleMap.js
// 와 같은 이유의 단일 소스 원칙.
export const ATTACK_HITBOX_SIZE = 30;
export const RANGE_DISTANCE_MIN = 150;
export const RANGE_DISTANCE_MAX = 600;
export const ASPECT_RATIO_THRESHOLD = 2.5;
export const PROJECTILE_SPEED = 12;
export const PROJECTILE_RADIUS = 8;

// frontend/src/screens/create/CanvasEditor.js의 CANVAS_SIZE(480x480)와 일치 — 무기 제작
// 캔버스의 좌표계 크기다. classifyWeaponRangeFallback이 무기의 "길쭉한 정도"를 이 크기
// 기준으로 정규화해서 사거리로 매핑한다.
const CANVAS_MAX_DIM = 480;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// 근접 공격 히트박스 — 캐릭터 중심에서 조준 방향으로 고정 거리만큼 떨어진 지점에 고정
// 크기 정사각형을 둔다. 무기별로 이 오프셋/크기가 달라지지 않는다(근접은 항상 고정 — 데미지
// 배율만 무기에 따라 달라진다, backend/lib/battleSimulation.js의 MELEE_DAMAGE_MULTIPLIER 참고).
export function meleeHitboxRect(x, y, aimX, aimY, characterRadius) {
  const offset = characterRadius + ATTACK_HITBOX_SIZE / 2;
  const centerX = x + aimX * offset;
  const centerY = y + aimY * offset;
  return {
    x: centerX - ATTACK_HITBOX_SIZE / 2,
    y: centerY - ATTACK_HITBOX_SIZE / 2,
    width: ATTACK_HITBOX_SIZE,
    height: ATTACK_HITBOX_SIZE,
  };
}

// AI 평가가 실패했을 때(할당량 초과 등) 쓰는 결정론적 근접/원거리 분류. 무기 바운딩박스
// (shapes/weaponRenderer.js의 computeWeaponBounds(parts) 반환값)의 가로세로 비율이 길쭉할수록
// (ASPECT_RATIO_THRESHOLD를 "넘으면") 원거리로 판단하고, 그 길쭉한 정도(maxDim)를
// RANGE_DISTANCE_MIN~MAX 사이로 매핑해 사거리로 쓴다. 근접이면 사거리는 안 쓰이므로 null.
export function classifyWeaponRangeFallback(bounds) {
  const width = Number.isFinite(bounds?.width) ? bounds.width : 0;
  const height = Number.isFinite(bounds?.height) ? bounds.height : 0;
  const maxDim = Math.max(width, height);
  const minDim = Math.max(1, Math.min(width, height));
  const aspectRatio = maxDim / minDim;
  if (aspectRatio <= ASPECT_RATIO_THRESHOLD) {
    return { attackRange: 'melee', attackRangeDistance: null };
  }
  const ratio = clamp(maxDim / CANVAS_MAX_DIM, 0, 1);
  const attackRangeDistance = Math.round(RANGE_DISTANCE_MIN + ratio * (RANGE_DISTANCE_MAX - RANGE_DISTANCE_MIN));
  return { attackRange: 'ranged', attackRangeDistance };
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `node shapes/attackGeometry.test.mjs`
Expected: 모든 `console.log(...: OK)` 라인 출력, `attackGeometry.test.mjs: OK`로 종료.

- [ ] **Step 5: 커밋**

```bash
git add shapes/attackGeometry.js shapes/attackGeometry.test.mjs
git commit -m "feat: 공격 히트박스/사거리 공유 모듈(shapes/attackGeometry.js) 추가"
```

---

### Task 2: 캐시/few-shot 샘플이 근접·원거리 정보도 담도록 확장

**Files:**
- Modify: `backend/lib/weaponEvaluationSamples.js`
- Modify: `backend/lib/weaponCache.js`
- Modify: `backend/lib/weaponCache.test.mjs`

**Interfaces:**
- Consumes: 없음.
- Produces: `SAMPLES`(각 항목에 `attackRange: 'melee'|'ranged'` 필드 추가됨). `getCached(key)`/`setCached(key, value)`가 이제 `value`로 `{damage, attackRange, attackRangeDistance}` 형태의 객체를 다룬다(둘 다 이미 타입에 무관한 `Map` 래퍼라 시그니처 자체는 안 바뀜 — `setCached`의 두 번째 파라미터 이름만 `damage`→`value`로 바꿔 실제 쓰임에 맞춘다). `seedCache(samples)`가 샘플의 `attackRange`를 캐시 값에 반영한다.

- [ ] **Step 1: `weaponEvaluationSamples.js`에 `attackRange` 추가**

`backend/lib/weaponEvaluationSamples.js`를 통째로 교체한다:

```js
// AI 채점 few-shot 프롬프트 + 캐시 사전 시딩 겸용 샘플. damage/attackRange는 팀이 정한 기준값 —
// 셋 다 손에 들고 쓰는 무기(검/방패/창)라 attackRange는 전부 melee.
export const SAMPLES = [
  {
    parts: [{ id: 's1', shapeId: 'triangle', x: 100, y: 100, rotation: 0, scale: 1 }],
    damage: 3000,
    attackRange: 'melee',
    note: '기본 삼각형 검',
  },
  {
    parts: [{ id: 's1', shapeId: 'square', x: 100, y: 100, rotation: 0, scale: 1 }],
    damage: 2500,
    attackRange: 'melee',
    note: '기본 사각형 방패',
  },
  {
    parts: [
      { id: 's1', shapeId: 'sierpinski', x: 100, y: 60, rotation: 0, scale: 0.6 },
      { id: 's2', shapeId: 'square', x: 100, y: 140, rotation: 0, scale: 1.4 },
    ],
    damage: 7200,
    attackRange: 'melee',
    note: '시에르핀스키 촉 + 사각 손잡이 창',
  },
];
```

- [ ] **Step 2: `weaponCache.js`의 `seedCache`/`setCached` 수정**

`backend/lib/weaponCache.js`에서 `setCached`와 `seedCache`를 찾아 교체한다:

기존:
```js
export function setCached(key, damage) {
  cache.set(key, damage);
}

// few-shot 샘플(팀이 미리 만든 무기-데미지 쌍)을 캐시에 미리 채워, 그 무기들은 AI 호출 없이 항상 정해진 값이 나가게 한다.
export function seedCache(samples) {
  for (const sample of samples) {
    cache.set(cacheKey(sample), sample.damage);
  }
}
```

새로 교체:
```js
export function setCached(key, value) {
  cache.set(key, value);
}

// few-shot 샘플(팀이 미리 만든 무기 정보)을 캐시에 미리 채워, 그 무기들은 AI 호출 없이 항상
// 정해진 damage/attackRange가 나가게 한다. attackRangeDistance는 melee 샘플이면 안 쓰이므로
// null — ranged 샘플을 추가할 땐 sample.attackRangeDistance도 같이 채워야 한다.
export function seedCache(samples) {
  for (const sample of samples) {
    cache.set(cacheKey(sample), {
      damage: sample.damage,
      attackRange: sample.attackRange,
      attackRangeDistance: sample.attackRange === 'ranged' ? sample.attackRangeDistance : null,
    });
  }
}
```

- [ ] **Step 3: `weaponCache.test.mjs` 수정**

`backend/lib/weaponCache.test.mjs`에서 캐시 get/set 검증 부분과 사전 시딩 부분을 찾아 새 값 형태에 맞게 고친다:

기존:
```js
// 캐시 get/set
const key = cacheKey(a);
assert.strictEqual(getCached(key), undefined);
setCached(key, 5000);
assert.strictEqual(getCached(key), 5000);

// 사전 시딩
const before = cacheSize();
seedCache([{ parts: [{ id: 'x', shapeId: 'koch', x: 0, y: 0, rotation: 0, scale: 1 }], damage: 999 }]);
assert.strictEqual(cacheSize(), before + 1);
```

새로 교체:
```js
// 캐시 get/set — 이제 값은 damage 하나가 아니라 attackRange/attackRangeDistance를 포함한 객체
const key = cacheKey(a);
assert.strictEqual(getCached(key), undefined);
setCached(key, { damage: 5000, attackRange: 'melee', attackRangeDistance: null });
assert.deepStrictEqual(getCached(key), { damage: 5000, attackRange: 'melee', attackRangeDistance: null });

// 사전 시딩 — attackRange가 melee인 샘플은 attackRangeDistance가 null로 채워져야 함
const before = cacheSize();
seedCache([{ parts: [{ id: 'x', shapeId: 'koch', x: 0, y: 0, rotation: 0, scale: 1 }], damage: 999, attackRange: 'melee' }]);
assert.strictEqual(cacheSize(), before + 1);
const seededKey = cacheKey({ parts: [{ id: 'x', shapeId: 'koch', x: 0, y: 0, rotation: 0, scale: 1 }] });
assert.deepStrictEqual(getCached(seededKey), { damage: 999, attackRange: 'melee', attackRangeDistance: null });
console.log('seedCache stores attackRange/attackRangeDistance alongside damage: OK');
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `node backend/lib/weaponCache.test.mjs`
Expected: 모든 `console.log` 라인 출력, `weaponCache.test.mjs: OK`로 종료.

- [ ] **Step 5: 커밋**

```bash
git add backend/lib/weaponEvaluationSamples.js backend/lib/weaponCache.js backend/lib/weaponCache.test.mjs
git commit -m "feat: 무기 캐시/few-shot 샘플이 근접·원거리 정보도 담도록 확장"
```

---

### Task 3: AI 평가에 근접/원거리 판정 추가

**Files:**
- Modify: `backend/lib/aiClient.js`
- Modify: `backend/lib/aiClient.rotation.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `RANGE_DISTANCE_MIN`/`RANGE_DISTANCE_MAX`(`shapes/attackGeometry.js`), Task 2의 `SAMPLES`(각 항목 `attackRange` 포함), `weaponCache.js`의 `{damage, attackRange, attackRangeDistance}` 캐시 값 형태.
- Produces: `requestWeaponEvaluation(apiKey, weaponState)`(기존 `requestDamageRange`를 대체, `{min, max, attackRange, attackRangeDistance}` 반환). `evaluateWeapon(weaponState)`가 이제 `{damage, attackRange, attackRangeDistance, cached}`를 반환한다 — Task 4가 이 형태를 그대로 쓴다.

- [ ] **Step 1: 회귀 테스트 작성(RED)**

`backend/lib/aiClient.rotation.test.mjs`에서 `requestDamageRange` 관련 부분을 찾아 교체한다:

기존(import 줄):
```js
import { callGeminiWithRotation, requestDamageRange, requestToolCalls } from './aiClient.js';
```

새로 교체:
```js
import { callGeminiWithRotation, requestWeaponEvaluation, requestToolCalls } from './aiClient.js';
```

기존(`requestDamageRange` 테스트 블록 3개):
```js
// requestDamageRange — 실제 네트워크 없이 global.fetch를 모킹해서 응답 파싱만 검증.
{
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ min: 100, max: 900 }) }] } }],
    }),
  });
  const range = await requestDamageRange('fake-key', { parts: [{ shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 1 }] });
  global.fetch = origFetch;
  assert.deepStrictEqual(range, { min: 100, max: 900 });
}
console.log('requestDamageRange parses a well-formed Gemini response: OK');

{
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(() => requestDamageRange('fake-key', { parts: [] }), (err) => err.status === 429);
  global.fetch = origFetch;
}
console.log('requestDamageRange attaches the HTTP status to the thrown error: OK');

{
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ min: 'not-a-number', max: 900 }) }] } }] }),
  });
  await assert.rejects(() => requestDamageRange('fake-key', { parts: [] }), /min\/max/);
  global.fetch = origFetch;
}
console.log('requestDamageRange rejects a non-numeric min/max response: OK');
```

새로 교체:
```js
// requestWeaponEvaluation — 실제 네트워크 없이 global.fetch를 모킹해서 응답 파싱만 검증.
{
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{
        content: { parts: [{ text: JSON.stringify({ min: 100, max: 900, attackRange: 'ranged', attackRangeDistance: 400 }) }] },
      }],
    }),
  });
  const result = await requestWeaponEvaluation('fake-key', { parts: [{ shapeId: 'triangle', x: 0, y: 0, rotation: 0, scale: 1 }] });
  global.fetch = origFetch;
  assert.deepStrictEqual(result, { min: 100, max: 900, attackRange: 'ranged', attackRangeDistance: 400 });
}
console.log('requestWeaponEvaluation parses a well-formed Gemini response: OK');

{
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(() => requestWeaponEvaluation('fake-key', { parts: [] }), (err) => err.status === 429);
  global.fetch = origFetch;
}
console.log('requestWeaponEvaluation attaches the HTTP status to the thrown error: OK');

{
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ min: 'not-a-number', max: 900, attackRange: 'melee', attackRangeDistance: 150 }) }] } }] }),
  });
  await assert.rejects(() => requestWeaponEvaluation('fake-key', { parts: [] }), /min\/max/);
  global.fetch = origFetch;
}
console.log('requestWeaponEvaluation rejects a non-numeric min/max response: OK');

// 방어: attackRange가 'melee'/'ranged'가 아닌 이상한 값이면 조용히 'melee'로, attackRangeDistance가
// 숫자가 아니면 RANGE_DISTANCE_MIN으로 대체한다(min/max와 달리 안전한 기본값이 있으므로 던지지 않음).
{
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ min: 100, max: 900, attackRange: 'weird', attackRangeDistance: 'huge' }) }] } }],
    }),
  });
  const result = await requestWeaponEvaluation('fake-key', { parts: [] });
  global.fetch = origFetch;
  assert.strictEqual(result.attackRange, 'melee', "알 수 없는 attackRange 값은 'melee'로 대체");
  assert.strictEqual(result.attackRangeDistance, 150, '숫자가 아닌 attackRangeDistance는 RANGE_DISTANCE_MIN으로 대체');
}
console.log('requestWeaponEvaluation defends against malformed attackRange/attackRangeDistance: OK');
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node backend/lib/aiClient.rotation.test.mjs`
Expected: FAIL — `requestWeaponEvaluation`이 아직 export되지 않아 `undefined`를 호출하는 에러.

- [ ] **Step 3: `aiClient.js` 수정(GREEN)**

`backend/lib/aiClient.js` 맨 위 import 줄에 새 모듈을 추가한다:

기존:
```js
import { cacheKey, seededPick, getCached, setCached, seedCache } from './weaponCache.js';
import { SAMPLES } from './weaponEvaluationSamples.js';
import { getApiKeys } from './apiKeys.js';
```

새로 교체:
```js
import { cacheKey, seededPick, getCached, setCached, seedCache } from './weaponCache.js';
import { SAMPLES } from './weaponEvaluationSamples.js';
import { getApiKeys } from './apiKeys.js';
import { RANGE_DISTANCE_MIN, RANGE_DISTANCE_MAX, classifyWeaponRangeFallback } from '../../shapes/attackGeometry.js';
import { computeWeaponBounds } from '../../shapes/weaponRenderer.js';
```

`buildDamagePrompt`/`requestDamageRange`/`evaluateWeapon`을 찾아 전부 교체한다:

기존:
```js
function summarizeParts(parts) {
  return parts
    .map((p) => `${p.shapeId}(x:${p.x},y:${p.y},rotation:${p.rotation},scale:${p.scale})`)
    .join(', ');
}

function buildDamagePrompt(weaponState) {
  const examples = SAMPLES.map((s) => `- ${summarizeParts(s.parts)} → 데미지 ${s.damage} (${s.note})`).join('\n');
  return [
    '너는 수학 도형으로 만든 무기의 전투력을 채점하는 심판이다.',
    `데미지는 ${DAMAGE_MIN}~${DAMAGE_MAX} 범위의 정수다. 아래는 참고용 예시다:`,
    examples,
    '',
    `채점할 무기: ${summarizeParts(weaponState.parts)}`,
    '',
    '절대값이 아니라 (min, max) 범위로 답하라. max - min은 1000 이내로 좁게 잡아라.',
  ].join('\n');
}

// 완성된 무기 하나를 Gemini에게 채점받아 데미지 범위(min,max)를 받아온다.
export async function requestDamageRange(apiKey, weaponState) {
  const res = await fetch(`${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildDamagePrompt(weaponState) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            min: { type: 'INTEGER' },
            max: { type: 'INTEGER' },
          },
          required: ['min', 'max'],
        },
      },
    }),
  });
  if (!res.ok) {
    const err = new Error(`Gemini damage request failed with ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = JSON.parse(text);
  if (!Number.isFinite(parsed.min) || !Number.isFinite(parsed.max)) {
    throw new Error('Gemini damage response missing numeric min/max');
  }
  return { min: parsed.min, max: parsed.max };
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
```

새로 교체:
```js
function summarizeParts(parts) {
  return parts
    .map((p) => `${p.shapeId}(x:${p.x},y:${p.y},rotation:${p.rotation},scale:${p.scale})`)
    .join(', ');
}

function buildEvaluationPrompt(weaponState) {
  const examples = SAMPLES.map(
    (s) => `- ${summarizeParts(s.parts)} → 데미지 ${s.damage}, ${s.attackRange === 'ranged' ? '원거리' : '근접'} (${s.note})`,
  ).join('\n');
  return [
    '너는 수학 도형으로 만든 무기의 전투력을 채점하는 심판이다.',
    `데미지는 ${DAMAGE_MIN}~${DAMAGE_MAX} 범위의 정수다. 아래는 참고용 예시다:`,
    examples,
    '',
    `채점할 무기: ${summarizeParts(weaponState.parts)}`,
    '',
    '절대값이 아니라 (min, max) 범위로 답하라. max - min은 1000 이내로 좁게 잡아라.',
    '',
    '또한 이 무기가 화살/창/총처럼 던지거나 발사되어 날아가는 무기처럼 보이면 attackRange를',
    '"ranged"로, 검/방패/도끼처럼 손에 들고 휘두르는 무기면 "melee"로 판단하라.',
    `"ranged"라면 사거리(attackRangeDistance)도 ${RANGE_DISTANCE_MIN}~${RANGE_DISTANCE_MAX} 범위의`,
    '정수로 함께 판단하라(짧은 사거리 무기처럼 보이면 낮은 값, 긴 사거리 무기처럼 보이면 높은',
    `값). "melee"라면 attackRangeDistance는 ${RANGE_DISTANCE_MIN}으로 고정해서 답하라.`,
  ].join('\n');
}

// 완성된 무기 하나를 Gemini에게 채점받아 데미지 범위(min,max)와 근접/원거리 판정을 받아온다.
export async function requestWeaponEvaluation(apiKey, weaponState) {
  const res = await fetch(`${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildEvaluationPrompt(weaponState) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            min: { type: 'INTEGER' },
            max: { type: 'INTEGER' },
            attackRange: { type: 'STRING', enum: ['melee', 'ranged'] },
            attackRangeDistance: { type: 'INTEGER' },
          },
          required: ['min', 'max', 'attackRange', 'attackRangeDistance'],
        },
      },
    }),
  });
  if (!res.ok) {
    const err = new Error(`Gemini weapon evaluation request failed with ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = JSON.parse(text);
  if (!Number.isFinite(parsed.min) || !Number.isFinite(parsed.max)) {
    throw new Error('Gemini weapon evaluation response missing numeric min/max');
  }
  // attackRange/attackRangeDistance는 min/max와 달리 안전한 기본값이 있으므로(멀쩡한 데미지
  // 평가 자체를 무효화할 정도는 아님), 이상한 값이 와도 던지지 않고 조용히 대체한다.
  const attackRange = parsed.attackRange === 'ranged' ? 'ranged' : 'melee';
  const attackRangeDistance = Number.isFinite(parsed.attackRangeDistance) ? parsed.attackRangeDistance : RANGE_DISTANCE_MIN;
  return { min: parsed.min, max: parsed.max, attackRange, attackRangeDistance };
}

// 완성된 무기를 AI에게 채점받는다. 같은(또는 거의 같은) 무기는 항상 같은 damage/attackRange를 반환한다.
export async function evaluateWeapon(weaponState) {
  const key = cacheKey(weaponState);
  const cached = getCached(key);
  if (cached !== undefined) {
    return { ...cached, cached: true };
  }

  if (process.env.MOCK_AI === 'true') {
    const damage = seededPick(key, DAMAGE_MIN, DAMAGE_MAX);
    const bounds = computeWeaponBounds(weaponState?.parts);
    const { attackRange, attackRangeDistance } = classifyWeaponRangeFallback(bounds);
    const result = { damage, attackRange, attackRangeDistance };
    setCached(key, result);
    return { ...result, cached: false };
  }

  const { min, max, attackRange, attackRangeDistance } = await callGeminiWithRotation((apiKey) =>
    requestWeaponEvaluation(apiKey, weaponState),
  );
  const damage = seededPick(key, Math.max(DAMAGE_MIN, min), Math.min(DAMAGE_MAX, max));
  const result = { damage, attackRange, attackRangeDistance };
  setCached(key, result);
  return { ...result, cached: false };
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인 + 전체 회귀**

Run:
```bash
node backend/lib/aiClient.rotation.test.mjs
for f in shapes/*.test.mjs backend/lib/*.test.mjs backend/routes/*.test.mjs backend/socket/*.test.mjs; do node "$f" || echo "FAILED: $f"; done
```
Expected: 둘 다 `FAILED:` 없이 전부 통과. (`aiClient.chat.test.mjs`/`aiClient.test.mjs`는 `requestDamageRange`를 안 쓰므로 영향 없어야 함 — 혹시 참조하고 있다면 같은 방식으로 `requestWeaponEvaluation`으로 이름을 맞춰 고친다.)

- [ ] **Step 5: 커밋**

```bash
git add backend/lib/aiClient.js backend/lib/aiClient.rotation.test.mjs
git commit -m "feat: AI 무기 평가에 근접/원거리 판정과 사거리 추가"
```

---

### Task 4: `/api/weapon/evaluate` 응답 + 폴백에 근접/원거리 반영

**Files:**
- Modify: `backend/routes/weaponEvaluate.js`
- Modify: `backend/routes/weaponEvaluate.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `classifyWeaponRangeFallback`(`shapes/attackGeometry.js`), `computeWeaponBounds`(`shapes/weaponRenderer.js`), Task 3의 `evaluateWeapon`의 새 반환 형태(`{damage, attackRange, attackRangeDistance, cached}`).
- Produces: `fallbackAttackRange(weaponState)`(`{attackRange, attackRangeDistance}` 반환). `/api/weapon/evaluate` 응답 JSON에 `attackRange`/`attackRangeDistance` 필드 추가(성공/폴백 경로 둘 다). Task 5가 이 응답 필드를 그대로 쓴다.

- [ ] **Step 1: 회귀 테스트 작성(RED)**

`backend/routes/weaponEvaluate.test.mjs` 맨 위 import 줄을 찾아 교체한다:

기존:
```js
import assert from 'node:assert';
import { fallbackDamage } from './weaponEvaluate.js';
```

새로 교체:
```js
import assert from 'node:assert';
import { fallbackDamage, fallbackAttackRange } from './weaponEvaluate.js';
```

파일 맨 끝(`console.log('weaponEvaluate.test.mjs: OK');` 바로 앞)에 새 테스트를 추가한다:

```js
// fallbackAttackRange — 크래시 없이 항상 melee/ranged 중 하나를 반환
{
  const result = fallbackAttackRange(undefined);
  assert.strictEqual(result.attackRange, 'melee', 'weaponState가 undefined면 안전하게 근접');
  console.log('fallbackAttackRange tolerates undefined weaponState: OK');
}
{
  // 길쭉하게 뻗은 부품 배치 -> 원거리로 분류돼야 함
  const elongated = {
    parts: [
      { id: 'a', shapeId: 'square', x: 100, y: 100, rotation: 0, scale: 0.3 },
      { id: 'b', shapeId: 'square', x: 100, y: 400, rotation: 0, scale: 0.3 },
    ],
  };
  const result = fallbackAttackRange(elongated);
  assert.strictEqual(result.attackRange, 'ranged');
  assert.ok(result.attackRangeDistance >= 150 && result.attackRangeDistance <= 600);
  console.log('fallbackAttackRange classifies elongated weapons as ranged: OK');
}
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node backend/routes/weaponEvaluate.test.mjs`
Expected: FAIL — `fallbackAttackRange`가 아직 export되지 않아 `undefined`를 호출하는 에러.

- [ ] **Step 3: `weaponEvaluate.js` 수정(GREEN)**

`backend/routes/weaponEvaluate.js`를 통째로 교체한다:

```js
import { Router } from 'express';
import { evaluateWeapon, DAMAGE_MIN, DAMAGE_MAX } from '../lib/aiClient.js';
import { getShapeById } from '../../shapes/registry.js';
import { statsFromShape } from '../../shapes/stats.js';
import { computeWeaponBounds } from '../../shapes/weaponRenderer.js';
import { classifyWeaponRangeFallback } from '../../shapes/attackGeometry.js';
import { validateWeaponState } from '../lib/weaponStateValidation.js';

// AI 채점이 전부 실패했을 때 쓰는 결정론적 폴백 — 참가자가 절대 막히지 않게 한다.
// sqrt로 스케일해서 부품이 5개 안팎만 돼도 바로 최댓값(10000)에 포화되지 않게 한다 —
// 예전 total*100 방식은 부품 1개=2000, 5개부터는 전부 10000으로 뭉개져서 부품을 많이
// 붙일수록 결과가 다 똑같아지는 문제가 있었다(Opus 리뷰 Important #4).
// weaponState 자체는 라우트 진입점에서 이미 validateWeaponState로 걸러지지만, 이 함수는
// 그 검증 없이 직접 호출될 수도 있으므로(예: 미래에 다른 경로에서 재사용) 여기서도
// 한 번 더 방어한다 — 특히 이 함수가 크래시하면 catch 블록 안에서 또 던지는 것이라
// Critical #1과 똑같은 방식으로 서버가 죽는다.
export function fallbackDamage(weaponState) {
  const parts = weaponState?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return DAMAGE_MIN;
  const total = parts.reduce((sum, p) => {
    const shape = getShapeById(p?.shapeId);
    if (!shape) return sum;
    const scale = Number.isFinite(Number(p?.scale)) ? Number(p.scale) : 1;
    const stats = statsFromShape(shape);
    return sum + (stats.attack + stats.defense) * scale;
  }, 0);
  const damage = Math.sqrt(total) * 450;
  if (!Number.isFinite(damage)) return DAMAGE_MIN;
  return Math.round(Math.min(DAMAGE_MAX, Math.max(DAMAGE_MIN, damage)));
}

// AI 채점 실패 시 근접/원거리도 결정론적으로 정해야 한다 — shapes/attackGeometry.js의
// 가로세로 비율 규칙을 그대로 쓴다(MOCK_AI 경로도 같은 함수를 씀, aiClient.js 참고). fallbackDamage와
// 같은 이유로 이 함수도 절대 던지지 않는다 — computeWeaponBounds/classifyWeaponRangeFallback
// 둘 다 이미 malformed 입력을 방어하므로 별도 방어 코드는 안 붙인다.
export function fallbackAttackRange(weaponState) {
  const bounds = computeWeaponBounds(weaponState?.parts);
  return classifyWeaponRangeFallback(bounds);
}

const router = Router();

router.post('/', async (req, res) => {
  const { weaponState } = req.body ?? {};
  const validation = validateWeaponState(weaponState);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }
  try {
    const { damage, attackRange, attackRangeDistance } = await evaluateWeapon(weaponState);
    res.json({ damage, attackRange, attackRangeDistance });
  } catch (err) {
    console.error('[weaponEvaluate] AI 평가 실패, fallback으로 대체:', err);
    const { attackRange, attackRangeDistance } = fallbackAttackRange(weaponState);
    res.json({ damage: fallbackDamage(weaponState), attackRange, attackRangeDistance, fallback: true });
  }
});

export default router;
```

- [ ] **Step 4: 테스트 실행 → 통과 확인 + 전체 회귀**

Run:
```bash
node backend/routes/weaponEvaluate.test.mjs
for f in shapes/*.test.mjs backend/lib/*.test.mjs backend/routes/*.test.mjs backend/socket/*.test.mjs; do node "$f" || echo "FAILED: $f"; done
```
Expected: 둘 다 `FAILED:` 없이 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add backend/routes/weaponEvaluate.js backend/routes/weaponEvaluate.test.mjs
git commit -m "feat: /api/weapon/evaluate 응답과 폴백에 근접/원거리 판정 추가"
```

---

### Task 5: 프론트 제작 화면이 근접/원거리 정보를 무기에 담아 전송

**Files:**
- Modify: `frontend/src/screens/create.js`

**Interfaces:**
- Consumes: Task 4의 `/api/weapon/evaluate` 응답(`{damage, attackRange, attackRangeDistance}`).
- Produces: `create:done`으로 전송되는 `weapon` 객체에 `attackRange`/`attackRangeDistance` 필드 추가. Task 7이 `backend/socket/battle.js`에서 `participant.weapon.attackRange`/`attackRangeDistance`로 이 필드를 읽는다.

이 태스크는 프론트 화면 로직이라 자동화 테스트가 없다(이 프로젝트의 기존 관례) — 문법 검증 후 라이브 검증(Task 8과 함께 한 번에 확인)으로 넘어간다.

- [ ] **Step 1: `evaluate()`가 응답의 `attackRange`/`attackRangeDistance`를 무기 객체에 담도록 수정**

`frontend/src/screens/create.js`의 `evaluate` 함수를 찾아 교체한다:

기존:
```js
  async function evaluate() {
    setPhase('evaluating');
    setError(null);
    let damage;
    try {
      const res = await fetch('/api/weapon/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weaponState }),
      });
      if (!res.ok) throw new Error(`evaluate request failed with ${res.status}`);
      const data = await res.json();
      damage = data.damage;
    } catch (err) {
      // 예전엔 여기서 damage=1로 조용히 대체하고 그대로 waiting 화면으로 넘어갔다 — 네트워크
      // 문제 한 번으로 참가자가 최저 점수에 영구히 고정되고 재시도도 못 했다(Opus 리뷰
      // Important #12). 이제는 편집 화면에 그대로 남겨서 다시 시도할 수 있게 한다.
      setPhase('editing');
      setError('평가에 실패했어요. 잠시 후 다시 시도해주세요.');
      return;
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
```

새로 교체:
```js
  async function evaluate() {
    setPhase('evaluating');
    setError(null);
    let damage;
    let attackRange;
    let attackRangeDistance;
    try {
      const res = await fetch('/api/weapon/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weaponState }),
      });
      if (!res.ok) throw new Error(`evaluate request failed with ${res.status}`);
      const data = await res.json();
      damage = data.damage;
      attackRange = data.attackRange;
      attackRangeDistance = data.attackRangeDistance;
    } catch (err) {
      // 예전엔 여기서 damage=1로 조용히 대체하고 그대로 waiting 화면으로 넘어갔다 — 네트워크
      // 문제 한 번으로 참가자가 최저 점수에 영구히 고정되고 재시도도 못 했다(Opus 리뷰
      // Important #12). 이제는 편집 화면에 그대로 남겨서 다시 시도할 수 있게 한다.
      setPhase('editing');
      setError('평가에 실패했어요. 잠시 후 다시 시도해주세요.');
      return;
    }
    const previewImage = stageRef.current ? stageRef.current.toDataURL() : null;
    const weapon = {
      name: '내가 만든 무기',
      image: previewImage,
      stats: { attack: damage, defense: damage },
      damage,
      attackRange,
      attackRangeDistance,
      parts: weaponState.parts,
    };
    state.weapon = weapon;
    setPhase('waiting');
    socket.emit('create:done', weapon);
  }
```

- [ ] **Step 2: 문법 검증**

Run: `node --check frontend/src/screens/create.js`
Expected: 조용히 exit code 0.

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/screens/create.js
git commit -m "feat: 무기 제작 화면이 근접/원거리 판정을 무기 객체에 담아 전송"
```

---

### Task 6: 물리 엔진 — 근접 데미지 배율 + 투사체 시스템

**Files:**
- Modify: `backend/lib/battleSimulation.js`
- Modify: `backend/lib/battleSimulation.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `meleeHitboxRect`, `PROJECTILE_SPEED`, `PROJECTILE_RADIUS`, `RANGE_DISTANCE_MIN`(`shapes/attackGeometry.js`).
- Produces: `MELEE_DAMAGE_MULTIPLIER`(export, 1.3). `stepSimulation(room, now)`가 이제 `room.players[id].isRanged`(boolean)와 `room.players[id].rangeDistance`(number|null)를 읽고, `room.projectiles`(배열, 없으면 빈 배열로 취급)를 읽어서 이동/충돌 판정한 뒤 결과 `room`에 `projectiles`(업데이트된 배열)를 포함해서 반환한다. `attackHitboxRect`(private 함수)는 제거되고 `meleeHitboxRect` 호출로 대체된다 — 이제 `ATTACK_HITBOX_SIZE`는 이 파일에서 export하지 않는다(`shapes/attackGeometry.js`가 유일한 소스). Task 7이 `MELEE_DAMAGE_MULTIPLIER`를 가져다 쓴다.

- [ ] **Step 1: 회귀 테스트 작성(RED)**

`backend/lib/battleSimulation.test.mjs` 맨 위 import 부분을 찾아 교체한다:

기존:
```js
import assert from 'node:assert';
import {
  stepSimulation,
  hitScoreFromWeaponDamage,
  MOVE_SPEED,
  CHARACTER_RADIUS,
  ATTACK_HITBOX_SIZE,
} from './battleSimulation.js';
```

새로 교체:
```js
import assert from 'node:assert';
import {
  stepSimulation,
  hitScoreFromWeaponDamage,
  MOVE_SPEED,
  CHARACTER_RADIUS,
} from './battleSimulation.js';
import { ATTACK_HITBOX_SIZE, PROJECTILE_SPEED, PROJECTILE_RADIUS } from '../../shapes/attackGeometry.js';
```

`makePlayer`/`makeRoom` 헬퍼를 찾아 교체한다:

기존:
```js
function makePlayer(overrides) {
  return {
    id: 'p1', characterId: 'char1', x: 400, y: 300, aimX: 0, aimY: 1,
    score: 0, hitScore: 25, connected: true, lastAttackAt: 0, attackRequested: false,
    input: { ...noInput }, ...overrides,
  };
}
function makeRoom(players, overrides) {
  return { status: 'active', endsAt: 1_000_000, players, walls: [], arenaSize: { width: 800, height: 600 }, ...overrides };
}
```

새로 교체:
```js
function makePlayer(overrides) {
  return {
    id: 'p1', characterId: 'char1', x: 400, y: 300, aimX: 0, aimY: 1,
    score: 0, hitScore: 25, connected: true, lastAttackAt: 0, attackRequested: false,
    isRanged: false, rangeDistance: null,
    input: { ...noInput }, ...overrides,
  };
}
function makeRoom(players, overrides) {
  return {
    status: 'active', endsAt: 1_000_000, players, walls: [],
    arenaSize: { width: 800, height: 600 }, projectiles: [],
    ...overrides,
  };
}
```

파일 맨 끝(`console.log('battleSimulation.test.mjs: OK');` 바로 앞)에 새 테스트들을 추가한다:

```js
// 원거리 무기 공격: 즉시 판정 대신 투사체를 스폰한다 — 스폰 시점엔 점수 변화가 없다.
{
  const attacker = makePlayer({
    id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hitScore: 30,
    isRanged: true, rangeDistance: 300, attackRequested: true,
  });
  const room = makeRoom({ p1: attacker });
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.players.p1.score, 0, '투사체 발사 시점엔 점수 변화 없음');
  assert.strictEqual(next.projectiles.length, 1, '투사체가 하나 생성되어야 함');
  assert.strictEqual(next.projectiles[0].ownerId, 'p1');
  assert.strictEqual(next.projectiles[0].maxRange, 300);
  assert.strictEqual(next.players.p1.lastAttackAt, 1000, '원거리도 쿨다운은 똑같이 적용됨');
  console.log('ranged attack spawns a projectile instead of an instant hit: OK');
}

// 투사체는 매 틱 조준 방향으로 PROJECTILE_SPEED만큼 이동한다.
{
  const room = makeRoom(
    { p1: makePlayer({ id: 'p1' }) },
    { projectiles: [{ id: 'pr1', ownerId: 'p1', x: 100, y: 100, aimX: 1, aimY: 0, traveled: 0, hitScore: 30, maxRange: 300 }] },
  );
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.projectiles.length, 1);
  assert.strictEqual(next.projectiles[0].x, 100 + PROJECTILE_SPEED);
  assert.strictEqual(next.projectiles[0].traveled, PROJECTILE_SPEED);
  console.log('projectile advances by PROJECTILE_SPEED each tick: OK');
}

// 사거리를 다 쓰면(traveled >= maxRange) 아무 효과 없이 소멸한다.
{
  const room = makeRoom(
    { p1: makePlayer({ id: 'p1' }), p2: makePlayer({ id: 'p2', x: 5000, y: 5000, score: 50 }) },
    { projectiles: [{ id: 'pr1', ownerId: 'p1', x: 100, y: 100, aimX: 1, aimY: 0, traveled: 295, hitScore: 30, maxRange: 300 }] },
  );
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.projectiles.length, 0, '사거리를 넘으면 투사체가 사라져야 함');
  assert.strictEqual(next.players.p2.score, 50, '아무도 못 맞혔으니 점수 변화 없음');
  console.log('projectile disappears without effect once it exceeds its max range: OK');
}

// 벽에 부딪히면 소멸한다.
{
  const wall = { x: 150, y: 80, width: 40, height: 40 };
  const room = makeRoom(
    { p1: makePlayer({ id: 'p1' }) },
    { walls: [wall], projectiles: [{ id: 'pr1', ownerId: 'p1', x: 100, y: 100, aimX: 1, aimY: 0, traveled: 0, hitScore: 30, maxRange: 300 }] },
  );
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.projectiles.length, 0, '벽과 충돌하면 투사체가 사라져야 함');
  console.log('projectile disappears on wall collision: OK');
}

// 상대와 겹치면 점수를 반영하고 소멸한다(관통 없음).
{
  const room = makeRoom(
    {
      p1: makePlayer({ id: 'p1', x: 0, y: 0, score: 0 }),
      p2: makePlayer({ id: 'p2', x: 100 + PROJECTILE_RADIUS + CHARACTER_RADIUS - 1, y: 100, score: 50 }),
    },
    { projectiles: [{ id: 'pr1', ownerId: 'p1', x: 100, y: 100, aimX: 0, aimY: 0, traveled: 0, hitScore: 30, maxRange: 300 }] },
  );
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.projectiles.length, 0, '명중하면 투사체가 사라져야 함');
  assert.strictEqual(next.players.p2.score, 20, '피격자는 hitScore만큼 점수 감소(50-30=20)');
  assert.strictEqual(next.players.p1.score, 30, '발사자는 hitScore만큼 점수 획득');
  console.log('projectile hits an overlapping player, transfers score, and is removed (no piercing): OK');
}

// 원거리 무기도 쿨다운 중엔 새 투사체를 안 만든다(기존 근접 쿨다운 로직과 동일).
{
  const attacker = makePlayer({
    id: 'p1', x: 400, y: 300, aimX: 1, aimY: 0, hitScore: 30, lastAttackAt: 900,
    isRanged: true, rangeDistance: 300, attackRequested: true,
  });
  const room = makeRoom({ p1: attacker });
  // now=1000, lastAttackAt=900 -> 100ms 경과, ATTACK_COOLDOWN_MS=500이라 아직 쿨다운 중
  const { room: next } = stepSimulation(room, 1000);
  assert.strictEqual(next.projectiles.length, 0, '쿨다운 중이면 투사체가 생기지 않아야 함');
  assert.strictEqual(next.players.p1.lastAttackAt, 900);
  console.log('ranged attack respects the same cooldown as melee: OK');
}
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node backend/lib/battleSimulation.test.mjs`
Expected: FAIL — `ATTACK_HITBOX_SIZE`를 여전히 `battleSimulation.js`에서 export하고 있고 `isRanged`/`projectiles` 로직이 없어서, 새 테스트들(투사체 스폰/이동/소멸/명중)이 전부 실패하거나 `undefined` 관련 에러.

- [ ] **Step 3: `battleSimulation.js` 수정(GREEN)**

`backend/lib/battleSimulation.js` 파일 전체를 아래 내용으로 교체한다:

```js
import { meleeHitboxRect, PROJECTILE_SPEED, PROJECTILE_RADIUS, RANGE_DISTANCE_MIN } from '../../shapes/attackGeometry.js';

export const CHARACTER_RADIUS = 20;
export const MOVE_SPEED = 4;
export const HIT_SCORE_COEFFICIENT = 0.05;
export const ATTACK_COOLDOWN_MS = 500;
export const BATTLE_DURATION_MS = 90000;
// 근접 무기는 원거리보다 위험을 더 감수해야(가까이 붙어야) 하므로 데미지가 더 세다 —
// hitScoreFromWeaponDamage의 결과에 이 배율을 곱해서 최종 hitScore를 만든다(적용 지점은
// backend/socket/battle.js의 플레이어 초기화 — 이 파일은 이미 계산된 hitScore를 그대로 쓴다).
export const MELEE_DAMAGE_MULTIPLIER = 1.3;
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
// NaN/Infinity가 섞여 있으면(소켓 레이어에서 이미 걸러지지만, 방어적 이중화 원칙에 따라
// 여기서도 한 번 더) 이동 없음(0,0)으로 취급 — 위치가 NaN으로 영구 오염되는 것을 막는다.
function normalizeIfLong(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const len = Math.hypot(x, y);
  if (len <= 1) return { x, y };
  return { x: x / len, y: y / len };
}

// 이동 벡터(moveX/moveY, -1~1)로 이동한다 — 대각선 입력이 자동으로 가능해지고(둘 다 0이
// 아닐 수 있으므로), 벽/경계 충돌 판정은 기존과 동일하다.
function moveOne(player, walls, arenaSize) {
  const input = player.input ?? {};
  const move = normalizeIfLong(input.moveX ?? 0, input.moveY ?? 0);
  const dx = move.x * MOVE_SPEED;
  const dy = move.y * MOVE_SPEED;

  let x = clamp(player.x + dx, CHARACTER_RADIUS, arenaSize.width - CHARACTER_RADIUS);
  let y = clamp(player.y + dy, CHARACTER_RADIUS, arenaSize.height - CHARACTER_RADIUS);

  if (circleOverlapsAnyWall(x, player.y, CHARACTER_RADIUS, walls)) x = player.x;
  if (circleOverlapsAnyWall(x, y, CHARACTER_RADIUS, walls)) y = player.y;

  return { ...player, x, y };
}

// 조준(aimX/aimY)은 이동과 분리된 별개 입력이라 여기서 따로 갱신한다. 입력 벡터가
// 데드존보다 짧으면(스틱이 중앙 근처, 마우스가 캐릭터 위인 등) 이전 조준을 그대로
// 유지하고, 그렇지 않으면 정규화(단위벡터화)해서 저장한다.
// len이 Infinity로 오버플로하는 경우(예: Number.MAX_VALUE급 입력값)도 데드존 미달과 같이
// 취급해 이전 조준을 유지한다 — 안 그러면 x/len, y/len이 둘 다 0이 되어 "조준 없음"이
// 영구 저장되고, 그 상태의 히트박스는 캐릭터 중심에 고정돼 전방위로 맞아버린다(Opus 리뷰
// Important I3).
function applyAim(player) {
  const input = player.input ?? {};
  const x = input.aimX ?? 0;
  const y = input.aimY ?? 0;
  const len = Math.hypot(x, y);
  if (!Number.isFinite(len) || len < AIM_DEADZONE) return player;
  return { ...player, aimX: x / len, aimY: y / len };
}

// 투사체 하나를 한 틱만큼 이동시킨 다음 상태를 반환한다 — 순수 함수, room 자체를 안 건드림.
function moveProjectile(proj) {
  return {
    ...proj,
    x: proj.x + proj.aimX * PROJECTILE_SPEED,
    y: proj.y + proj.aimY * PROJECTILE_SPEED,
    traveled: proj.traveled + PROJECTILE_SPEED,
  };
}

export function stepSimulation(room, now) {
  if (room.status !== 'active') return { room, winners: null };

  const players = {};
  for (const id of Object.keys(room.players)) {
    const p = room.players[id];
    players[id] = p.connected ? applyAim(moveOne(p, room.walls, room.arenaSize)) : { ...p };
  }

  // 기존 투사체를 먼저 이동/판정한다 — 이번 틱에 새로 발사되는 투사체는 여기 안 끼고
  // 다음 틱부터 이동을 시작한다(플레이어 이동과 같은 "한 틱에 한 번만 갱신" 원칙).
  const projectiles = [];
  for (const proj of room.projectiles ?? []) {
    const next = moveProjectile(proj);
    if (next.traveled >= next.maxRange) continue; // 사거리 소진 — 소멸, 효과 없음
    if (circleOverlapsAnyWall(next.x, next.y, PROJECTILE_RADIUS, room.walls)) continue; // 벽 충돌 — 소멸

    let hit = false;
    for (const targetId of Object.keys(players)) {
      if (targetId === next.ownerId) continue;
      const target = players[targetId];
      if (!target.connected) continue;
      const dx = target.x - next.x;
      const dy = target.y - next.y;
      const hitRadius = PROJECTILE_RADIUS + CHARACTER_RADIUS;
      if (dx * dx + dy * dy < hitRadius * hitRadius) {
        players[targetId] = { ...target, score: Math.max(0, target.score - next.hitScore) };
        players[next.ownerId] = { ...players[next.ownerId], score: players[next.ownerId].score + next.hitScore };
        hit = true;
        break; // 한 발에 한 명만 — 관통 없음
      }
    }
    if (!hit) projectiles.push(next);
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

    if (attacker.isRanged === true) {
      // 원거리 무기는 즉시 판정하지 않고 투사체를 하나 스폰한다 — 이동/충돌은 다음 틱부터
      // 위 "기존 투사체" 루프에서 처리된다. 사거리(maxRange)는 AI(또는 폴백)가 이 무기에
      // 대해 정한 값을 그대로 쓰되, 값이 없거나 이상하면 최소 사거리로 방어한다.
      const maxRange = Number.isFinite(attacker.rangeDistance) ? attacker.rangeDistance : RANGE_DISTANCE_MIN;
      projectiles.push({
        id: `${id}-${now}-${Math.random().toString(36).slice(2, 8)}`,
        ownerId: id,
        x: attacker.x,
        y: attacker.y,
        aimX: attacker.aimX ?? 0,
        aimY: attacker.aimY ?? 1,
        traveled: 0,
        hitScore: attacker.hitScore,
        maxRange,
      });
    } else {
      const hitbox = meleeHitboxRect(attacker.x, attacker.y, attacker.aimX ?? 0, attacker.aimY ?? 1, CHARACTER_RADIUS);
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

  return { room: { ...room, players, projectiles, status }, winners };
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인 + 전체 회귀**

Run:
```bash
node backend/lib/battleSimulation.test.mjs
for f in shapes/*.test.mjs backend/lib/*.test.mjs backend/routes/*.test.mjs backend/socket/*.test.mjs; do node "$f" || echo "FAILED: $f"; done
```
Expected: 둘 다 `FAILED:` 없이 전부 통과. (`backend/socket/battle.js`/`battleIntegration.test.mjs`/`battle.headroom.test.mjs`는 Task 7에서 고치므로, 이 시점에 그 파일들이 실패해도 정상이다 — 아직 `MELEE_DAMAGE_MULTIPLIER` 등을 안 가져다 쓰고 있어서 새 필드가 없어도 기존 필드만으로 통과해야 한다. 만약 여기서 `backend/socket/*.test.mjs`가 실패한다면 `battleSimulation.js`의 export 목록이 실수로 빠졌는지 확인한다.)

- [ ] **Step 5: 커밋**

```bash
git add backend/lib/battleSimulation.js backend/lib/battleSimulation.test.mjs
git commit -m "feat: 물리 엔진에 근접 데미지 배율과 원거리 투사체 시스템 추가"
```

---

### Task 7: `backend/socket/battle.js` — 플레이어 초기화에 근접/원거리 반영

**Files:**
- Modify: `backend/socket/battle.js`
- Modify: `backend/socket/battleIntegration.test.mjs`

**Interfaces:**
- Consumes: Task 6의 `MELEE_DAMAGE_MULTIPLIER`(`backend/lib/battleSimulation.js`), Task 1의 `RANGE_DISTANCE_MIN`/`RANGE_DISTANCE_MAX`(`shapes/attackGeometry.js`), Task 5가 `weapon` 객체에 담아 보내는 `attackRange`/`attackRangeDistance`.
- Produces: `startBattleRoom`이 만드는 각 플레이어가 `isRanged`(boolean)와 `rangeDistance`(number|null)를 갖고, `hitScore`가 근접이면 `MELEE_DAMAGE_MULTIPLIER`만큼 배율 적용된 값이 된다. `battleRoom.projectiles`가 빈 배열로 초기화된다. Task 8이 `battle:state`로 이 필드들을 받는다.

- [ ] **Step 1: 회귀 테스트 작성(RED)**

`backend/socket/battleIntegration.test.mjs` 맨 위 import 줄에 새 모듈을 추가한다:

기존:
```js
import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';
import { getBattleRoom, stopBattleRoom, startBattleRoom } from './battle.js';
import { DEFAULT_MAP } from '../../shapes/battleMap.js';
```

새로 교체:
```js
import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';
import { getBattleRoom, stopBattleRoom, startBattleRoom } from './battle.js';
import { DEFAULT_MAP } from '../../shapes/battleMap.js';
import { RANGE_DISTANCE_MIN, RANGE_DISTANCE_MAX } from '../../shapes/attackGeometry.js';
```

`console.log('battle.js onEnd callback delivers accurate score snapshot: OK');` 블록 바로 다음, `stopBattleRoom();`(파일 맨 끝) 앞에 새 테스트 두 개를 추가한다:

```js
// 회귀: startBattleRoom이 weapon.attackRange/attackRangeDistance를 읽어 플레이어 상태에
// 정확히 반영하는지 직접 확인 — 근접은 데미지 배율이 붙고, 원거리는 AI가 정한 사거리를
// 그대로 갖는다.
{
  startBattleRoom(io, [
    { id: 'r1', weapon: { damage: 1000, attackRange: 'ranged', attackRangeDistance: 400 } },
    { id: 'm1', weapon: { damage: 1000, attackRange: 'melee' } },
  ]);
  const room = getBattleRoom();
  assert.strictEqual(room.players.r1.isRanged, true);
  assert.strictEqual(room.players.r1.rangeDistance, 400);
  assert.strictEqual(room.players.r1.hitScore, 50, '원거리는 배율 없이 hitScoreFromWeaponDamage(1000)=50 그대로');

  assert.strictEqual(room.players.m1.isRanged, false);
  assert.strictEqual(room.players.m1.rangeDistance, null);
  assert.strictEqual(room.players.m1.hitScore, 65, '근접은 50 * 1.3 = 65(반올림)');
  assert.deepStrictEqual(room.projectiles, [], 'projectiles는 빈 배열로 시작');
  console.log('startBattleRoom applies isRanged/rangeDistance/melee damage multiplier from weapon.attackRange: OK');
}

// 방어: attackRange가 이상한 값이거나 attackRangeDistance가 범위 밖/비숫자여도 안전하게
// 처리된다(근접으로 취급 / 사거리는 clamp).
{
  startBattleRoom(io, [
    { id: 'x1', weapon: { damage: 1000, attackRange: 'not-a-real-type' } },
    { id: 'x2', weapon: { damage: 1000, attackRange: 'ranged', attackRangeDistance: 999999 } },
    { id: 'x3', weapon: { damage: 1000, attackRange: 'ranged', attackRangeDistance: 'huge' } },
  ]);
  const room2 = getBattleRoom();
  assert.strictEqual(room2.players.x1.isRanged, false, '알 수 없는 attackRange 값은 근접으로 취급');
  assert.strictEqual(room2.players.x2.rangeDistance, RANGE_DISTANCE_MAX, '범위를 넘는 사거리는 상한으로 clamp');
  assert.strictEqual(room2.players.x3.rangeDistance, RANGE_DISTANCE_MIN, '숫자가 아닌 사거리는 하한으로 대체');
  console.log('startBattleRoom defends against malformed attackRange/attackRangeDistance: OK');
}
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node backend/socket/battleIntegration.test.mjs`
Expected: FAIL — `room.players.r1.isRanged`가 `undefined`라 assert 실패.

- [ ] **Step 3: `battle.js` 수정(GREEN)**

`backend/socket/battle.js` 맨 위 import 줄에 새 모듈을 추가한다:

기존:
```js
import { stepSimulation, hitScoreFromWeaponDamage, BATTLE_DURATION_MS } from '../lib/battleSimulation.js';
import { DEFAULT_MAP } from '../../shapes/battleMap.js';
```

새로 교체:
```js
import { stepSimulation, hitScoreFromWeaponDamage, BATTLE_DURATION_MS, MELEE_DAMAGE_MULTIPLIER } from '../lib/battleSimulation.js';
import { DEFAULT_MAP } from '../../shapes/battleMap.js';
import { RANGE_DISTANCE_MIN, RANGE_DISTANCE_MAX } from '../../shapes/attackGeometry.js';
```

플레이어 초기화 블록을 찾아 교체한다:

기존:
```js
  const players = {};
  participants.forEach((participant, i) => {
    const spawn = DEFAULT_MAP.spawnPoints[i % DEFAULT_MAP.spawnPoints.length];
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
  });

  battleRoom = {
    status: 'active',
    endsAt: Date.now() + BATTLE_DURATION_MS,
    players,
    walls: DEFAULT_MAP.walls,
    arenaSize: DEFAULT_MAP.arenaSize,
  };
```

새로 교체:
```js
  const players = {};
  participants.forEach((participant, i) => {
    const spawn = DEFAULT_MAP.spawnPoints[i % DEFAULT_MAP.spawnPoints.length];
    // AI(또는 실패 시 폴백)가 판단한 근접/원거리 — 서버가 신뢰하지 않고 항상 재검증한다
    // (기존 weaponDamage clamp와 같은 원칙). 'ranged'가 아니면 전부 근접으로 취급.
    const isRanged = participant.weapon?.attackRange === 'ranged';
    const rawDistance = Number(participant.weapon?.attackRangeDistance);
    const rangeDistance = isRanged
      ? Math.min(RANGE_DISTANCE_MAX, Math.max(RANGE_DISTANCE_MIN, Number.isFinite(rawDistance) ? rawDistance : RANGE_DISTANCE_MIN))
      : null;
    const baseHitScore = hitScoreFromWeaponDamage(participant.weapon?.damage);
    // 근접은 가까이 가야 하는 위험을 감수하므로 원거리보다 데미지가 더 세다.
    const hitScore = isRanged ? baseHitScore : Math.round(baseHitScore * MELEE_DAMAGE_MULTIPLIER);
    players[participant.id] = {
      id: participant.id,
      characterId: CHARACTER_IDS[i % CHARACTER_IDS.length],
      x: spawn.x,
      y: spawn.y,
      // 기본 조준 방향(아래쪽) — 기존 facing:'down' 기본값과 같은 의미.
      aimX: 0,
      aimY: 1,
      score: 0,
      hitScore,
      isRanged,
      rangeDistance,
      weaponParts: participant.weapon?.parts ?? [],
      connected: true,
      lastAttackAt: 0,
      attackRequested: false,
      input: { moveX: 0, moveY: 0, aimX: 0, aimY: 0 },
    };
  });

  battleRoom = {
    status: 'active',
    endsAt: Date.now() + BATTLE_DURATION_MS,
    players,
    walls: DEFAULT_MAP.walls,
    arenaSize: DEFAULT_MAP.arenaSize,
    projectiles: [],
  };
```

- [ ] **Step 4: 테스트 실행 → 통과 확인 + 전체 회귀**

Run:
```bash
node backend/socket/battleIntegration.test.mjs
for f in shapes/*.test.mjs backend/lib/*.test.mjs backend/routes/*.test.mjs backend/socket/*.test.mjs; do node "$f" || echo "FAILED: $f"; done
```
Expected: 둘 다 `FAILED:` 없이 전부 통과 — `battle.headroom.test.mjs`도 이 시점에 다시 통과해야 한다(플레이어 shape 변경이 스폰/캐릭터 유일성 검증에 영향 없음).

- [ ] **Step 5: 커밋**

```bash
git add backend/socket/battle.js backend/socket/battleIntegration.test.mjs
git commit -m "feat: startBattleRoom이 근접/원거리 판정으로 hitScore/rangeDistance를 계산하도록 변경"
```

---

### Task 8: 프론트 — 투사체 렌더링 + 공격 미리보기

**Files:**
- Modify: `frontend/src/screens/battle.js`

**Interfaces:**
- Consumes: Task 1의 `meleeHitboxRect`, `ATTACK_HITBOX_SIZE`, `PROJECTILE_RADIUS`(`shapes/attackGeometry.js`), Task 7이 `battle:state`로 보내는 `room.projectiles`, `player.isRanged`, `player.rangeDistance`.
- Produces: 없음(화면 최상위 컴포넌트).

이 태스크는 프론트 Konva 렌더링이라 자동화 테스트가 없다(이 프로젝트의 기존 관례) — 문법 검증 + 라이브 검증으로 확인한다.

- [ ] **Step 1: import 추가**

`frontend/src/screens/battle.js` 맨 위를 찾아 교체한다:

기존:
```js
import { drawWeaponGroup } from '../../../shapes/weaponRenderer.js';
import { DEFAULT_MAP } from '../../../shapes/battleMap.js';
import { VirtualJoystick } from './VirtualJoystick.js';
```

새로 교체:
```js
import { drawWeaponGroup } from '../../../shapes/weaponRenderer.js';
import { DEFAULT_MAP } from '../../../shapes/battleMap.js';
import { meleeHitboxRect, ATTACK_HITBOX_SIZE, PROJECTILE_RADIUS } from '../../../shapes/attackGeometry.js';
import { VirtualJoystick } from './VirtualJoystick.js';
```

- [ ] **Step 2: 투사체/미리보기 노드용 ref 추가**

`nodesRef` 선언부를 찾아 교체한다:

기존:
```js
  const nodesRef = useRef({});
  // PC 마우스 조준을 계산하려면 "내 캐릭터가 화면에서 어디 있는지"가 필요한데, battle:state로만
  // 갱신되는 서버 진실이라 여기 별도로 캐시해둔다(마우스 이벤트는 그 사이 계속 발생하므로).
  const selfPosRef = useRef({ x: DEFAULT_MAP.arenaSize.width / 2, y: DEFAULT_MAP.arenaSize.height / 2 });
```

새로 교체:
```js
  const nodesRef = useRef({});
  // 투사체는 플레이어와 달리 계속 생겼다 없어지므로 별도로 관리한다(id별 Konva 노드).
  const projectileNodesRef = useRef({});
  // 내 캐릭터의 공격 미리보기(텔레그래프) 노드 — 무기 종류(근접 Rect/원거리 Line)는 대전
  // 중 안 바뀌므로 한 번만 만들고 이후 위치만 갱신한다.
  const previewNodeRef = useRef(null);
  // PC 마우스 조준을 계산하려면 "내 캐릭터가 화면에서 어디 있는지"가 필요한데, battle:state로만
  // 갱신되는 서버 진실이라 여기 별도로 캐시해둔다(마우스 이벤트는 그 사이 계속 발생하므로).
  const selfPosRef = useRef({ x: DEFAULT_MAP.arenaSize.width / 2, y: DEFAULT_MAP.arenaSize.height / 2 });
```

- [ ] **Step 3: 내 캐릭터 공격 미리보기 추가**

`onState` 안에서 `updateAimFromPointer();` 호출 직후를 찾아 교체한다:

기존:
```js
          // Important I2). updateCamera가 먼저 실행돼서 cameraRef가 이 틱 기준으로
          // 최신 상태여야 아래 updateAimFromPointer의 좌표 변환이 정확하다.
          updateAimFromPointer();
        }
```

새로 교체:
```js
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
              : new Konva.Rect({ width: ATTACK_HITBOX_SIZE, height: ATTACK_HITBOX_SIZE, fill: 'rgba(255,255,255,0.25)' });
            layer.add(previewNodeRef.current);
          }
          if (p.isRanged) {
            const range = p.rangeDistance ?? 0;
            previewNodeRef.current.points([p.x, p.y, p.x + previewAimX * range, p.y + previewAimY * range]);
          } else {
            const hitbox = meleeHitboxRect(p.x, p.y, previewAimX, previewAimY, CHARACTER_RADIUS);
            previewNodeRef.current.x(hitbox.x);
            previewNodeRef.current.y(hitbox.y);
          }
        }
```

- [ ] **Step 4: 투사체 렌더링 추가**

`Object.values(room.players).forEach(...)` 루프가 끝나고 `layer.draw();` 하기 직전을 찾아 교체한다:

기존:
```js
        entry.weaponGroup.opacity(isConnected ? 1 : 0.2);
      });

      layer.draw();
    }
```

새로 교체:
```js
        entry.weaponGroup.opacity(isConnected ? 1 : 0.2);
      });

      // 투사체 렌더링 — 플레이어 노드와 달리 계속 생겼다 없어지므로, 이번 프레임에 없는
      // id의 노드는 지운다(플레이어 노드는 한 번 생기면 안 사라지는 지금 방식과 다름).
      const liveProjectileIds = new Set((room.projectiles ?? []).map((proj) => proj.id));
      Object.keys(projectileNodesRef.current).forEach((id) => {
        if (!liveProjectileIds.has(id)) {
          projectileNodesRef.current[id].destroy();
          delete projectileNodesRef.current[id];
        }
      });
      (room.projectiles ?? []).forEach((proj) => {
        let node = projectileNodesRef.current[proj.id];
        if (!node) {
          node = new Konva.Circle({ radius: PROJECTILE_RADIUS, fill: '#f1c40f' });
          layer.add(node);
          projectileNodesRef.current[proj.id] = node;
        }
        node.x(proj.x);
        node.y(proj.y);
      });

      layer.draw();
    }
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
git commit -m "feat: 대전 화면에 투사체 렌더링과 공격 미리보기(텔레그래프) 추가"
```

- [ ] **Step 7: 라이브 검증**

로컬 서버를 띄우고 브라우저로 대전 화면까지 진행한다(참가자를 최소 2명 만들어서, 한 명은 길쭉한 부품 배치로 원거리 판정을 받도록 유도 — 예를 들어 `MOCK_AI=true`면 결정론적 폴백(가로세로 비율 규칙)이 적용되므로, 한 부품을 다른 부품에서 멀리 떨어뜨려 배치하면 원거리로 분류된다). 다음을 확인한다:

1. **미리보기**: 근접 무기 캐릭터는 조준 방향에 반투명 사각형이, 원거리 무기 캐릭터는 조준 방향으로 뻗는 얇은 선이 계속 따라다니는지.
2. **투사체**: 원거리 캐릭터가 공격하면(클릭/조준 스틱 놓기) 작은 원이 조준 방향으로 날아가다가 사거리를 다 쓰거나 벽에 부딪히면 사라지는지, 상대와 겹치면 사라지면서 점수가 반영되는지.
3. **근접 데미지 보너스**: 근접 캐릭터와 원거리 캐릭터가 같은 `damage` 값을 가졌다면(예: 둘 다 콘솔에서 확인), 근접이 한 대 맞혔을 때 점수가 더 크게 오르는지.
4. 브라우저 콘솔에 에러가 없는지.

문제가 있으면 앞 태스크로 돌아가 수정한다.

---

## Self-Review 메모 (계획 작성자 기록)

- **스펙 커버리지**: AI 근접/원거리 판정+캐싱(Task 3) / 결정론적 폴백(Task 1, 4) / 근접 데미지 보너스(Task 6, 7) / 서버 투사체 시스템(Task 6) / 공유 모듈(Task 1) / 프론트 투사체 렌더링+미리보기(Task 8) / 데이터 흐름 전체(Task 5→7→8) / 스코프 제외 항목(계획에 관통, 무기별 속도차, 근접 히트박스 가변화, 시각 이펙트, 캐시 마이그레이션 관련 태스크 없음 — Global Constraints에 명시) — 스펙의 모든 섹션이 태스크로 커버됨.
- **타입/이름 일관성**: `attackRange`/`attackRangeDistance`(AI 응답·weapon 객체·소켓 페이로드 전체에서 동일한 이름), `isRanged`/`rangeDistance`(서버 플레이어 상태), `meleeHitboxRect`/`classifyWeaponRangeFallback`/`PROJECTILE_SPEED`/`PROJECTILE_RADIUS`/`RANGE_DISTANCE_MIN`/`RANGE_DISTANCE_MAX`(공유 모듈, Task 1~8 전체에서 동일하게 사용) — 교차 확인 완료.
- **라이브 검증**: Task 8의 Step 7이 이 계획의 유일한 라이브 검증 지점이다. 계획 완료 후 사용자가 요청하면 Opus 최종 리뷰를 별도로 진행한다.
