# 실제 Gemini 연동 + 다중 provider 키 저장소 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `backend/lib/aiClient.js`의 스텁 `requestDamageRange`/`requestToolCalls`를 실제 Gemini `generateContent` REST 호출로 채우고, API 키를 `.env`가 아니라 provider별 JSON 설정 파일(`backend/config/apiKeys.json`)에서 읽도록 바꾼다.

**Architecture:** `backend/lib/apiKeys.js`가 `backend/config/apiKeys.json`(gitignore 대상)을 읽어 provider 이름으로 키 배열을 돌려주는 범용 로더 역할을 한다. `aiClient.js`의 `callGeminiWithRotation`은 이 로더를 기본값으로 쓰되 파라미터로 pool을 주입받을 수 있어 테스트가 실제 키 없이도 로테이션 로직을 검증한다. `requestDamageRange`/`requestToolCalls`는 Node 내장 `fetch`로 Gemini REST 엔드포인트를 직접 호출한다(새 의존성 없음).

**Tech Stack:** Node.js(ES modules), Node 24 내장 `fetch`, Gemini `generateContent` REST API(`gemini-2.0-flash`, structured JSON 출력 + function calling). 테스트는 `node:assert` 기반 `.mjs` 스크립트(테스트 프레임워크 없음), `global.fetch`를 직접 모킹.

## Global Constraints

- API 키는 `backend/config/apiKeys.json`에 `{ "<provider>": ["key1", "key2", ...] }` 형태로 저장한다(gitignore 대상). 커밋되는 템플릿은 `backend/config/apiKeys.example.json`.
- `.env`의 `GEMINI_API_KEYS`는 제거한다. `MOCK_AI`/`PORT`/`ADMIN_PASSWORD`/`SUPABASE_URL`/`SUPABASE_SERVICE_KEY`는 `.env`에 그대로 둔다(이번 스코프 아님).
- 새 npm 의존성을 추가하지 않는다 — Node 내장 `fetch` 사용.
- 테스트는 절대 실제 `backend/config/apiKeys.json`(사용자의 진짜 키가 들어갈 파일)을 읽거나 쓰지 않는다 — 임시 파일(`.test-scratch/`, 이미 루트 `.gitignore` 대상) 또는 파라미터 주입만 사용한다.
- Gemini 모델: `gemini-2.0-flash`. 엔드포인트: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}`.
- 이번 스코프에서 Gemini 외 다른 provider(OpenAI 등) 연동 코드는 만들지 않는다.

---

### Task 1: API 키 저장소(JSON 로더 + 설정 파일)

**Files:**
- Create: `backend/lib/apiKeys.js`
- Test: `backend/lib/apiKeys.test.mjs`
- Create: `backend/config/apiKeys.example.json`
- Modify: `.gitignore` (루트)
- Modify: `backend/.env.example`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `loadApiKeysFromFile(filePath: string): object` — 파일을 읽어 JSON 파싱, 실패 시 `{}`
  - `filterValidKeys(keys: unknown): string[]` — 배열이 아니거나 빈 문자열/문자열이 아닌 항목을 걸러냄
  - `getApiKeys(provider: string): string[]` — `backend/config/apiKeys.json`에서 해당 provider의 유효한 키 배열(Task 2가 `aiClient.js`에서 이 함수를 씀)

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/lib/apiKeys.test.mjs` 파일을 새로 만든다:

```js
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { loadApiKeysFromFile, filterValidKeys } from './apiKeys.js';

// 실제 backend/config/apiKeys.json(사용자의 진짜 키가 들어갈 수 있는 gitignore 대상 파일)은
// 절대 건드리지 않는다 — 테스트 전용 임시 파일만 사용한다.
const SCRATCH_DIR = path.join(process.cwd(), '.test-scratch');
mkdirSync(SCRATCH_DIR, { recursive: true });

// 정상 파일
{
  const p = path.join(SCRATCH_DIR, 'apiKeys.valid.json');
  writeFileSync(p, JSON.stringify({ gemini: ['a', 'b'] }));
  assert.deepStrictEqual(loadApiKeysFromFile(p), { gemini: ['a', 'b'] });
}
console.log('loadApiKeysFromFile reads a valid JSON file: OK');

// 없는 파일 -> 빈 객체(크래시 없음) — 사용자가 아직 apiKeys.json을 안 만들었을 때의 정상 상태
{
  const result = loadApiKeysFromFile(path.join(SCRATCH_DIR, 'does-not-exist.json'));
  assert.deepStrictEqual(result, {});
}
console.log('loadApiKeysFromFile tolerates a missing file: OK');

// 깨진 JSON -> 빈 객체(크래시 없음)
{
  const p = path.join(SCRATCH_DIR, 'apiKeys.broken.json');
  writeFileSync(p, '{ not valid json');
  const result = loadApiKeysFromFile(p);
  assert.deepStrictEqual(result, {});
}
console.log('loadApiKeysFromFile tolerates malformed JSON: OK');

// filterValidKeys — 빈 문자열/공백/문자열이 아닌 값은 걸러진다
{
  assert.deepStrictEqual(filterValidKeys(['a', '', '  ', 'b', 123, null]), ['a', 'b']);
  assert.deepStrictEqual(filterValidKeys(undefined), []);
  assert.deepStrictEqual(filterValidKeys('not-an-array'), []);
}
console.log('filterValidKeys drops empty/non-string entries: OK');

rmSync(SCRATCH_DIR, { recursive: true, force: true });
console.log('apiKeys.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/lib/apiKeys.test.mjs`
Expected: `backend/lib/apiKeys.js` 파일 자체가 없어서 `ERR_MODULE_NOT_FOUND`로 실패.

- [ ] **Step 3: `apiKeys.js` 구현**

`backend/lib/apiKeys.js` 파일을 새로 만든다:

```js
// backend/lib/apiKeys.js — provider별 API 키 배열을 담은 JSON 설정 파일(backend/config/apiKeys.json)
// 로더. GEMINI 외 다른 provider(OpenAI 등)가 나중에 추가돼도 이 파일은 안 바뀐다 —
// apiKeys.json에 provider 키만 더 추가하면 됨.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.join(__dirname, '../config/apiKeys.json');

// 파일이 없거나(아직 설정 안 함) JSON이 깨졌으면 빈 객체를 반환한다 — 호출부(getApiKeys)가
// 빈 배열로 처리해서, 키 미설정 상태에서도 서버 기동 자체는 죽지 않고 실제 그 provider를
// 쓰려고 할 때만("키가 없습니다" 에러로) 실패한다.
export function loadApiKeysFromFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function filterValidKeys(keys) {
  if (!Array.isArray(keys)) return [];
  return keys.filter((k) => typeof k === 'string' && k.trim().length > 0);
}

let cache = null;

export function getApiKeys(provider) {
  if (!cache) {
    cache = loadApiKeysFromFile(DEFAULT_CONFIG_PATH);
  }
  return filterValidKeys(cache[provider]);
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/lib/apiKeys.test.mjs`
Expected: `apiKeys.test.mjs: OK`까지 전부 출력.

- [ ] **Step 5: 설정 파일 템플릿 + gitignore + `.env.example` 정리**

`backend/config/apiKeys.example.json` 파일을 새로 만든다:

```json
{
  "gemini": []
}
```

루트 `.gitignore`에 아래 한 줄을 `.env`/`.env.local` 근처에 추가한다:

```
backend/config/apiKeys.json
```

`backend/.env.example` 전체를 아래로 교체한다:

```
PORT=3000
ADMIN_PASSWORD=changeme

# Supabase 프로젝트(https://supabase.com)에서 URL/서비스 키 발급 후 채우기.
# 비워두면 결과 저장이 mock 폴백으로 동작함 (backend/lib/supabaseClient.js 참고) —
# 개발/데모는 이 값 없이도 가능하지만, 실제 부스 운영 전엔 반드시 채워야 결과가 영구 보관됨.
# schema.sql(backend/lib/supabase/schema.sql)을 프로젝트의 SQL Editor에서 먼저 실행할 것.
SUPABASE_URL=
SUPABASE_SERVICE_KEY=

# Gemini(및 앞으로 추가될 다른 AI provider) API 키는 여기(.env)가 아니라
# backend/config/apiKeys.json에 provider별 배열로 넣는다(backend/config/apiKeys.example.json
# 참고, 실제 파일은 gitignore 대상). MOCK_AI=false로 실행하려면 그 파일의 "gemini" 배열을
# 먼저 채워야 한다 — 비어 있으면 AI 채점은 fallbackDamage로, AI 채팅은 502로 떨어진다.
MOCK_AI=true
```

마지막으로, 로컬(커밋 대상 아님) `backend/.env` 파일에서 `GEMINI_API_KEYS=` 줄과 `AI_API_KEY=` 줄(예전에 쓰던 흔적, 코드 어디서도 참조 안 함)을 지운다 — 이건 git으로 추적되는 변경이 아니라 로컬 파일 정리이므로 커밋 대상에 포함하지 않는다.

- [ ] **Step 6: 커밋**

```bash
git add backend/lib/apiKeys.js backend/lib/apiKeys.test.mjs backend/config/apiKeys.example.json .gitignore backend/.env.example
git commit -m "feat: provider별 API 키를 backend/config/apiKeys.json에서 읽는 로더 추가"
```

---

### Task 2: `callGeminiWithRotation`을 테스트 가능한 형태로 리팩터

**Files:**
- Modify: `backend/lib/aiClient.js` (전체 — 아래 Step 3 코드가 이 태스크 종료 시점의 최종 내용)
- Test: `backend/lib/aiClient.rotation.test.mjs` (신규)

**Interfaces:**
- Consumes: Task 1의 `getApiKeys(provider): string[]`
- Produces:
  - `callGeminiWithRotation(requestFn: (apiKey: string) => Promise<T>, pool?: string[]): Promise<T>` — `pool` 기본값은 `getApiKeys('gemini')`. Task 3/4가 이 함수로 `requestDamageRange`/`requestToolCalls`를 호출함.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/lib/aiClient.rotation.test.mjs` 파일을 새로 만든다:

```js
import assert from 'node:assert';
import { callGeminiWithRotation } from './aiClient.js';

// callGeminiWithRotation — 429면 다음 키로 재시도, 그 외 에러는 즉시 던짐. 실제 fetch 없이
// pool/requestFn을 직접 주입해서 로테이션 로직만 검증한다(DI 패턴 —
// shapes/weaponRenderer.js의 drawWeaponGroup(Konva, ...)와 같은 이유).
{
  const calls = [];
  const requestFn = async (key) => {
    calls.push(key);
    if (key === 'bad-key') {
      const err = new Error('rate limited');
      err.status = 429;
      throw err;
    }
    return `ok-from-${key}`;
  };
  const result = await callGeminiWithRotation(requestFn, ['bad-key', 'good-key']);
  assert.strictEqual(result, 'ok-from-good-key');
  assert.deepStrictEqual(calls, ['bad-key', 'good-key']);
}
console.log('callGeminiWithRotation retries the next key on 429: OK');

{
  const requestFn = async () => {
    const err = new Error('bad request');
    err.status = 400;
    throw err;
  };
  await assert.rejects(() => callGeminiWithRotation(requestFn, ['only-key']), /bad request/);
}
console.log('callGeminiWithRotation propagates non-429 errors immediately: OK');

{
  await assert.rejects(
    () => callGeminiWithRotation(async () => 'unused', []),
    /gemini API 키가 없습니다/,
  );
}
console.log('callGeminiWithRotation throws a clear error when the key pool is empty: OK');

console.log('aiClient.rotation.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/lib/aiClient.rotation.test.mjs`
Expected: `callGeminiWithRotation`이 아직 export되지 않아서(현재 `aiClient.js`엔 export 안 된 내부 함수로만 있음) `TypeError: callGeminiWithRotation is not a function`.

- [ ] **Step 3: `aiClient.js`에서 `callGeminiWithRotation`을 export하고 pool을 파라미터로 받도록 변경**

`backend/lib/aiClient.js` 전체를 아래로 교체한다(이 태스크 종료 시점 기준 — `requestDamageRange`/`requestToolCalls`는 여전히 스텁이며 Task 3/4가 채운다):

```js
// backend/lib/aiClient.js — Gemini 연동: 무기 채팅 해석 + 무기 채점
import { cacheKey, seededPick, getCached, setCached, seedCache } from './weaponCache.js';
import { SAMPLES } from './weaponEvaluationSamples.js';
import { getApiKeys } from './apiKeys.js';

export const DAMAGE_MIN = 1;
export const DAMAGE_MAX = 10000;
const GEMINI_MODEL = 'gemini-2.0-flash';

seedCache(SAMPLES);

let keyIndex = 0;
function nextKey(pool) {
  const key = pool[keyIndex % pool.length];
  keyIndex += 1;
  return key;
}

// 키 풀을 순환하며 요청. 429(rate limit)면 다음 키로 재시도, 그 외 에러는 즉시 던짐.
// pool은 기본으로 apiKeys.json의 gemini 키 배열을 쓰지만, 파라미터로 받을 수 있게 해서
// 테스트가 실제 키 파일 없이도 가짜 키 배열을 주입해 로테이션 로직만 따로 검증할 수 있다
// (shapes/weaponRenderer.js의 drawWeaponGroup(Konva, ...)와 같은 이유의 의존성 주입).
export async function callGeminiWithRotation(requestFn, pool = getApiKeys('gemini')) {
  if (pool.length === 0) {
    throw new Error('gemini API 키가 없습니다 — backend/config/apiKeys.json의 "gemini" 배열을 채워주세요');
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

// TODO(Task 3에서 구현): 실제 Gemini fetch 호출.
async function requestDamageRange() {
  throw new Error('requestDamageRange not implemented yet');
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

// TODO(Task 4에서 구현): 실제 Gemini function-calling 호출.
async function requestToolCalls() {
  throw new Error('requestToolCalls not implemented yet');
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

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/lib/aiClient.rotation.test.mjs`
Expected: `aiClient.rotation.test.mjs: OK`까지 전부 출력.

- [ ] **Step 5: 기존 MOCK_AI 테스트가 여전히 통과하는지 확인**

Run:
```bash
node backend/lib/aiClient.test.mjs
node backend/lib/aiClient.chat.test.mjs
```
Expected: 둘 다 각자의 `OK` 로그로 끝남(`GEMINI_API_KEYS` 환경변수를 더는 안 쓰므로 이 테스트들의 MOCK_AI 경로엔 영향 없음).

- [ ] **Step 6: 커밋**

```bash
git add backend/lib/aiClient.js backend/lib/aiClient.rotation.test.mjs
git commit -m "refactor: callGeminiWithRotation이 키 풀을 파라미터로 받도록 변경(테스트 가능하게)"
```

---

### Task 3: 무기 채점 — `requestDamageRange` 실제 구현

**Files:**
- Modify: `backend/lib/aiClient.js` (전체 — 아래 Step 3 코드가 이 태스크 종료 시점의 최종 내용)
- Modify: `backend/lib/aiClient.rotation.test.mjs` (테스트 블록 추가)

**Interfaces:**
- Consumes: Task 2의 `callGeminiWithRotation`, `DAMAGE_MIN`/`DAMAGE_MAX`, `SAMPLES`(`weaponEvaluationSamples.js`, 이미 존재)
- Produces: `requestDamageRange(apiKey: string, weaponState: {parts: Part[]}): Promise<{min: number, max: number}>` — Task 4 이후에도 시그니처 안 바뀜, `evaluateWeapon`이 그대로 씀

- [ ] **Step 1: 실패하는 테스트 추가**

`backend/lib/aiClient.rotation.test.mjs`의 import 줄을 아래로 바꾸고:

```js
import { callGeminiWithRotation, requestDamageRange } from './aiClient.js';
```

파일 맨 끝의 `console.log('aiClient.rotation.test.mjs: OK');` 줄 바로 앞에 아래 블록을 추가한다:

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

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/lib/aiClient.rotation.test.mjs`
Expected: `requestDamageRange`가 아직 export 안 됨 → `TypeError: requestDamageRange is not a function`.

- [ ] **Step 3: `requestDamageRange` 실제 구현**

`backend/lib/aiClient.js` 전체를 아래로 교체한다:

```js
// backend/lib/aiClient.js — Gemini 연동: 무기 채팅 해석 + 무기 채점
import { cacheKey, seededPick, getCached, setCached, seedCache } from './weaponCache.js';
import { SAMPLES } from './weaponEvaluationSamples.js';
import { getApiKeys } from './apiKeys.js';

export const DAMAGE_MIN = 1;
export const DAMAGE_MAX = 10000;
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

seedCache(SAMPLES);

let keyIndex = 0;
function nextKey(pool) {
  const key = pool[keyIndex % pool.length];
  keyIndex += 1;
  return key;
}

// 키 풀을 순환하며 요청. 429(rate limit)면 다음 키로 재시도, 그 외 에러는 즉시 던짐.
// pool은 기본으로 apiKeys.json의 gemini 키 배열을 쓰지만, 파라미터로 받을 수 있게 해서
// 테스트가 실제 키 파일 없이도 가짜 키 배열을 주입해 로테이션 로직만 따로 검증할 수 있다
// (shapes/weaponRenderer.js의 drawWeaponGroup(Konva, ...)와 같은 이유의 의존성 주입).
export async function callGeminiWithRotation(requestFn, pool = getApiKeys('gemini')) {
  if (pool.length === 0) {
    throw new Error('gemini API 키가 없습니다 — backend/config/apiKeys.json의 "gemini" 배열을 채워주세요');
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

// TODO(Task 4에서 구현): 실제 Gemini function-calling 호출.
async function requestToolCalls() {
  throw new Error('requestToolCalls not implemented yet');
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

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/lib/aiClient.rotation.test.mjs`
Expected: 모든 블록이 `OK`로 끝나고 마지막에 `aiClient.rotation.test.mjs: OK`.

- [ ] **Step 5: 기존 테스트 회귀 확인**

Run:
```bash
node backend/lib/aiClient.test.mjs
node backend/lib/aiClient.chat.test.mjs
node backend/routes/weaponEvaluate.test.mjs
```
Expected: 셋 다 통과(MOCK_AI 경로는 안 바뀌었으므로).

- [ ] **Step 6: 커밋**

```bash
git add backend/lib/aiClient.js backend/lib/aiClient.rotation.test.mjs
git commit -m "feat: requestDamageRange 실제 Gemini 연동 구현"
```

---

### Task 4: 무기 채팅 — `requestToolCalls` 실제 구현

**Files:**
- Modify: `backend/lib/aiClient.js` (전체 — 아래 Step 3 코드가 최종 내용)
- Modify: `backend/lib/aiClient.rotation.test.mjs` (테스트 블록 추가)

**Interfaces:**
- Consumes: Task 2의 `callGeminiWithRotation`, `backend/routes/weaponChat.js`의 기존 `applyToolCalls`가 소비하는 `{op, ...args}` 형태(이미 존재, 이 태스크가 새로 만드는 게 아니라 맞춰야 하는 대상)
- Produces: `requestToolCalls(apiKey: string, weaponState, message: string, availableShapeIds: string[], canvasSize: {width,height}): Promise<{toolCalls: object[], reply: string}>`

- [ ] **Step 1: 실패하는 테스트 추가**

`backend/lib/aiClient.rotation.test.mjs`의 import 줄을 아래로 바꾸고:

```js
import { callGeminiWithRotation, requestDamageRange, requestToolCalls } from './aiClient.js';
```

파일 맨 끝의 `console.log('aiClient.rotation.test.mjs: OK');` 줄 바로 앞에 아래 블록을 추가한다:

```js
// requestToolCalls — functionCall 파트를 {op, ...args}로, text 파트를 reply로 매핑.
{
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{
        content: {
          parts: [
            { functionCall: { name: 'addPart', args: { shapeId: 'triangle', x: 100, y: 100 } } },
            { text: '삼각형을 추가했어요.' },
          ],
        },
      }],
    }),
  });
  const result = await requestToolCalls('fake-key', { parts: [] }, '삼각형 추가해줘', ['triangle'], { width: 480, height: 480 });
  global.fetch = origFetch;
  assert.deepStrictEqual(result.toolCalls, [{ op: 'addPart', shapeId: 'triangle', x: 100, y: 100 }]);
  assert.strictEqual(result.reply, '삼각형을 추가했어요.');
}
console.log('requestToolCalls maps functionCall parts to {op, ...args} and text parts to reply: OK');

{
  const origFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [] } }] }),
  });
  const result = await requestToolCalls('fake-key', { parts: [] }, '아무 말', [], { width: 480, height: 480 });
  global.fetch = origFetch;
  assert.deepStrictEqual(result.toolCalls, []);
  assert.strictEqual(result.reply, '(응답 텍스트가 없어요)', '텍스트 파트가 전혀 없으면 기본 안내 문구로 대체되어야 함');
}
console.log('requestToolCalls falls back to a placeholder reply when Gemini returns no text: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/lib/aiClient.rotation.test.mjs`
Expected: `requestToolCalls`가 아직 export 안 됨 → `TypeError: requestToolCalls is not a function`.

- [ ] **Step 3: `requestToolCalls` 실제 구현**

`backend/lib/aiClient.js` 전체를 아래로 교체한다(최종 완성 버전):

```js
// backend/lib/aiClient.js — Gemini 연동: 무기 채팅 해석 + 무기 채점
import { cacheKey, seededPick, getCached, setCached, seedCache } from './weaponCache.js';
import { SAMPLES } from './weaponEvaluationSamples.js';
import { getApiKeys } from './apiKeys.js';

export const DAMAGE_MIN = 1;
export const DAMAGE_MAX = 10000;
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

seedCache(SAMPLES);

let keyIndex = 0;
function nextKey(pool) {
  const key = pool[keyIndex % pool.length];
  keyIndex += 1;
  return key;
}

// 키 풀을 순환하며 요청. 429(rate limit)면 다음 키로 재시도, 그 외 에러는 즉시 던짐.
// pool은 기본으로 apiKeys.json의 gemini 키 배열을 쓰지만, 파라미터로 받을 수 있게 해서
// 테스트가 실제 키 파일 없이도 가짜 키 배열을 주입해 로테이션 로직만 따로 검증할 수 있다
// (shapes/weaponRenderer.js의 drawWeaponGroup(Konva, ...)와 같은 이유의 의존성 주입).
export async function callGeminiWithRotation(requestFn, pool = getApiKeys('gemini')) {
  if (pool.length === 0) {
    throw new Error('gemini API 키가 없습니다 — backend/config/apiKeys.json의 "gemini" 배열을 채워주세요');
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

const TOOL_DECLARATIONS = [
  {
    name: 'addPart',
    description: '무기에 새 도형 부품을 추가한다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        shapeId: { type: 'STRING' },
        x: { type: 'NUMBER' },
        y: { type: 'NUMBER' },
        rotation: { type: 'NUMBER' },
        scale: { type: 'NUMBER' },
      },
      required: ['shapeId', 'x', 'y'],
    },
  },
  {
    name: 'movePart',
    description: '기존 부품을 새 위치로 옮긴다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        partId: { type: 'STRING' },
        x: { type: 'NUMBER' },
        y: { type: 'NUMBER' },
      },
      required: ['partId', 'x', 'y'],
    },
  },
  {
    name: 'rotatePart',
    description: '기존 부품을 회전시킨다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        partId: { type: 'STRING' },
        rotation: { type: 'NUMBER' },
      },
      required: ['partId', 'rotation'],
    },
  },
  {
    name: 'scalePart',
    description: '기존 부품의 크기를 바꾼다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        partId: { type: 'STRING' },
        scale: { type: 'NUMBER' },
      },
      required: ['partId', 'scale'],
    },
  },
  {
    name: 'removePart',
    description: '기존 부품을 제거한다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        partId: { type: 'STRING' },
      },
      required: ['partId'],
    },
  },
];

function buildChatSystemInstruction(weaponState, availableShapeIds, canvasSize) {
  return [
    '너는 수학 도형 무기 제작을 도와주는 도우미다. 사용자의 자연어 명령을 아래 함수 호출로 변환하라.',
    `사용 가능한 shapeId: ${availableShapeIds.join(', ')}`,
    `캔버스 크기: ${canvasSize.width}x${canvasSize.height} (x/y는 이 범위 안)`,
    `현재 부품 목록: ${JSON.stringify(weaponState.parts)}`,
    '부품은 최대 10개까지만 추가할 수 있다.',
    '함수 호출과 함께, 사용자에게 보여줄 짧은 한국어 응답 텍스트도 반드시 함께 답하라.',
  ].join('\n');
}

// 사용자의 자연어 명령을 Gemini function calling으로 해석해 toolCalls로 변환한다.
export async function requestToolCalls(apiKey, weaponState, message, availableShapeIds, canvasSize) {
  const res = await fetch(`${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildChatSystemInstruction(weaponState, availableShapeIds, canvasSize) }] },
      contents: [{ role: 'user', parts: [{ text: message }] }],
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    }),
  });
  if (!res.ok) {
    const err = new Error(`Gemini chat request failed with ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const toolCalls = [];
  let reply = '';
  for (const part of parts) {
    if (part.functionCall) {
      toolCalls.push({ op: part.functionCall.name, ...part.functionCall.args });
    } else if (part.text) {
      reply += part.text;
    }
  }
  return { toolCalls, reply: reply || '(응답 텍스트가 없어요)' };
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

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/lib/aiClient.rotation.test.mjs`
Expected: 모든 블록 `OK`, 마지막 `aiClient.rotation.test.mjs: OK`.

- [ ] **Step 5: 전체 회귀**

Run:
```bash
for f in shapes/*.test.mjs backend/lib/*.test.mjs backend/routes/*.test.mjs backend/socket/*.test.mjs; do
  echo "== $f =="; node "$f" || echo "FAILED: $f";
done
```
Expected: `FAILED` 없이 전부 통과.

- [ ] **Step 6: 커밋**

```bash
git add backend/lib/aiClient.js backend/lib/aiClient.rotation.test.mjs
git commit -m "feat: requestToolCalls 실제 Gemini function calling 연동 구현"
```

---

## 구현 완료 후: 실제 키로 라이브 검증

4개 태스크 커밋이 끝나면(자동 테스트는 전부 `global.fetch` 모킹이라 실제 키 없이도 통과함), 사용자가 발급한 실제 Gemini 키로 다음을 확인한다:

1. 사용자에게 [Google AI Studio](https://aistudio.google.com/apikey)에서 발급받은 키를 요청한다.
2. `backend/config/apiKeys.json` 파일을 만들어(없으면) `{ "gemini": ["<받은 키>"] }`로 채운다 — gitignore 대상이라 커밋되지 않는다.
3. `backend/.env`의 `MOCK_AI`를 `false`로 바꾼다(로컬 파일 직접 수정, 커밋 대상 아님).
4. `cd backend && node server.js`로 서버를 띄운다(`MOCK_AI=true` prefix 없이 — `.env`의 값을 그대로 씀).
5. 실제 무기 하나를 만들어 "AI 평가받기"를 눌러서 `evaluateWeapon`이 실제 Gemini 응답으로 채점하는지 확인한다(네트워크 탭 또는 서버 로그에서 `Gemini damage request` 관련 에러가 없는지, 응답이 매번 캐시 히트가 아니라 최초엔 실제 호출이 도는지).
6. AI 채팅 패널에서 "삼각형 하나 추가해줘" 같은 명령을 보내서 `requestToolCalls`가 실제로 도형을 추가하는지 확인한다.
7. 만약 응답 형식이 기대(`responseSchema`/function calling 스키마)와 다르게 오면, 실제 Gemini 응답 payload를 로그로 남겨서 `buildDamagePrompt`/`TOOL_DECLARATIONS`/파싱 로직을 조정한다 — 이건 실제 API 응답을 보기 전까진 100% 확신할 수 없는 부분이라, 필요하면 이 계획 문서에 "실제 연동 중 발견한 조정 사항" 섹션을 추가해 기록한다.
8. 문제 없이 확인되면 `backend/.env`의 `MOCK_AI`를 다시 `true`로 되돌린다(부스 당일 기본값 — 실제 연동이 안정화되기 전까지는 데모/운영 중 네트워크 문제로 막히지 않도록).

## 실제 연동 중 발견한 조정 사항

사용자가 발급한 실제 Gemini 키 3개로 검증했다:

- **`gemini-2.0-flash` 모델은 이 계정에서 429(RESOURCE_EXHAUSTED, `limit: 0`)로 항상 실패**했다 — 키 자체는 유효(인증 통과)하지만 이 프로젝트의 무료 티어 할당량이 해당 모델에 대해 0으로 설정돼 있었다. `gemini-2.5-flash`/`gemini-1.5-flash`는 404("no longer available"/"not found")였고, `gemini-flash-latest`는 200으로 정상 응답했다. `GEMINI_MODEL` 상수를 `gemini-flash-latest`로 변경(커밋 `702e2c3`) — 엔드포인트/요청 형식은 동일해서 다른 코드는 안 바뀜.
- `requestDamageRange`/`requestToolCalls`를 직접 호출(`node -e`)해서 검증: 채점은 `{min:5500,max:6300}`처럼 정상 범위를 반환했고, 채팅은 `삼각형 하나 추가해줘` → `{op:'addPart', shapeId:'triangle', x:240, y:240}`으로 정확히 매핑됨. `/api/weapon/evaluate`/`/api/weapon/chat` 라우트로도 end-to-end 확인(damage:6080, fallback 아님 / weaponState에 실제로 삼각형 추가됨).
- **관찰(수정 안 함)**: 채팅 응답에서 Gemini가 `functionCall`만 보내고 `text` 파트를 안 보낸 경우가 있었다 — 설계대로 `'(응답 텍스트가 없어요)'` 폴백이 동작했지만, 매번 이 문구만 보이면 UX가 어색할 수 있다. 지금 스코프에서는 수정하지 않고 기록만 남긴다 — 필요하면 나중에 시스템 프롬프트를 더 강하게 쓰거나, 응답 텍스트가 없을 때 클라이언트 쪽에서 자체 안내 문구를 생성하는 방향을 고려할 것.
