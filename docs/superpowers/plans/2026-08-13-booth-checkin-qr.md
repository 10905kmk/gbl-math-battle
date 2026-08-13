# 부스 QR 체크인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 부스 입구에서 참가자 QR 배지를 스캔해 빈 게임 기기에 자동 배정하고, 게임 종료 시 그 방문자 목록을 외부 GBL2026 허브에 일괄 등록하는 기능을 추가한다.

**Architecture:** 외부 허브 API(`/api/auth/boothadmin`, `/api/user/{uid}`, `/api/booth/adduser`)는 백엔드가 전부 프록시한다(비밀번호를 브라우저에 절대 노출하지 않기 위함). 새 Preact 관리자 페이지(`frontend/admin/checkin.html`)가 카메라로 QR을 스캔하고, 기존 `cohort.participants`(이름 미기입 기기)에 자동 배정하는 소켓 이벤트를 새 백엔드 모듈(`backend/socket/checkin.js`)이 처리한다. 기기↔uid 매핑은 별도 리스트로 관리되며, 관리자 대시보드의 수동 버튼으로 소진(등록)한다.

**Tech Stack:** Node.js(내장 `fetch`, `node --test`), Express, Socket.IO, Preact + htm(esm.sh, 빌드 없음), `jsqr`(esm.sh) — 기존 스택 그대로, 신규 npm 의존성 없음(importmap CDN 참조만 추가).

**Spec:** `docs/superpowers/specs/2026-08-13-booth-checkin-qr-design.md`

> **Post-implementation revision (2026-08-13):** Task 3/7의 코드 블록은 이 계획을
> 최초 구현할 당시의 동작(`admin:resetParticipant`와 `disconnect`가 각각
> `removeByDeviceId`를 호출해 `checkinList`에서 해당 기기 항목을 연쇄 삭제)을
> 그대로 보여준다. 이는 이후 제품 결정으로 뒤집혔다: `checkinList` 항목은
> "이 사람이 부스를 방문했다"는 방문 기록이므로, 기기 초기화나 소켓 재연결
> 같은 부수 효과로 지워지면 안 된다. 현재 구현(`backend/socket/checkin.js`)은
> `removeByDeviceId`를 완전히 제거했고, `checkinList`를 지우는 경로는
> `checkin:unlink`(명시적 "연결 해제")와 `consumeCheckinList`의 성공 등록
> 처리 두 가지뿐이다. 아래 Task 3/7의 코드 블록은 최초 구현 당시 기록이므로
> 그대로 남겨두되, 이 문단을 최신 동작의 기준으로 삼을 것.

## Global Constraints

- 외부 허브 base URL: `BOOTH_API_URL`(기본값 `https://34-227-8-239.sslip.io`), 부스 비밀번호: `BOOTH_PASSWORD`(값 `Y00DeJZsJZrCA4Qd`) — 둘 다 `backend/.env`에만 두고 `backend/.env.example`에는 플레이스홀더만 커밋한다. 브라우저로 절대 전달하지 않는다.
- QR 페이로드 형식: `{"version":1,"uid":"<firebase-uid>"}` — `version !== 1`이거나 `uid`가 없으면 무효.
- 백엔드 테스트는 기존 컨벤션을 따른다: `node:assert` + 플레인 `.test.mjs`, 프레임워크 없이 `node --test <file>`로 개별 실행. 각 테스트 파일은 별도 프로세스로 실행되므로 모듈 싱글턴 상태(`cohort`, `checkinList`, `cachedBid`)가 파일마다 깨끗하게 시작한다.
- 프론트엔드(Preact 컴포넌트)는 기존 프로젝트에 컴포넌트 테스트 하네스가 없다 — 이 저장소 컨벤션대로 수동 테스트만 한다(자동 브라우저 테스트 없음).
- 코드 주석은 "왜"만 남긴다(무엇을 하는지는 코드 자체로 드러나야 함) — 기존 파일들의 주석 스타일을 그대로 따른다.
- 기존 파일의 코드 스타일/네이밍 컨벤션(예: `admin:*`, `checkin:*` 소켓 이벤트 네이밍, `button.kick`/`button.rescue` CSS 클래스)을 그대로 따른다.

---

### Task 1: 허브 API 클라이언트 (`backend/lib/boothApi.js`)

**Files:**
- Create: `backend/lib/boothApi.js`
- Test: `backend/lib/boothApi.test.mjs`

**Interfaces:**
- Produces: `login(): Promise<string>` (bid 반환, 실패 시 throw, 성공 시에만 모듈 내부에 bid 캐싱), `fetchUser(uid: string): Promise<{ok:true,name,profile_image}|{ok:false,status,message}>`, `addUser(uid: string): Promise<{ok:true,status}|{ok:false,status,message}>`, `_resetCacheForTest(): void`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/lib/boothApi.test.mjs`:
```js
import assert from 'node:assert';
import * as boothApi from './boothApi.js';

process.env.BOOTH_API_URL = 'https://fake-hub.test';
process.env.BOOTH_PASSWORD = 'test-pw';

function mockFetchSequence(responses) {
  let i = 0;
  globalThis.fetch = async (url, opts) => {
    const step = responses[i++];
    if (!step) throw new Error('no more mock responses queued');
    step.assert?.(url, opts);
    return {
      ok: step.status < 400,
      status: step.status,
      json: async () => step.body,
    };
  };
}

// login: 성공 시 bid 반환
{
  boothApi._resetCacheForTest();
  mockFetchSequence([
    {
      status: 200,
      body: { bid: 'M8', is_created: true, role: 'booth_operator' },
      assert: (url, opts) => {
        assert.strictEqual(url, 'https://fake-hub.test/api/auth/boothadmin');
        assert.strictEqual(JSON.parse(opts.body).password, 'test-pw');
      },
    },
  ]);
  const bid = await boothApi.login();
  assert.strictEqual(bid, 'M8');
  console.log('login returns bid on success: OK');
}

// login: 실패 시 throw
{
  boothApi._resetCacheForTest();
  mockFetchSequence([{ status: 401, body: {} }]);
  await assert.rejects(() => boothApi.login());
  console.log('login throws on failure: OK');
}

// fetchUser: 성공
{
  mockFetchSequence([
    {
      status: 200,
      body: { name: '홍길동', profile_image: 'https://example.com/a.png', history: [] },
      assert: (url) => assert.strictEqual(url, 'https://fake-hub.test/api/user/abc123'),
    },
  ]);
  const result = await boothApi.fetchUser('abc123');
  assert.deepStrictEqual(result, { ok: true, name: '홍길동', profile_image: 'https://example.com/a.png' });
  console.log('fetchUser returns ok:true with name/profile_image: OK');
}

// fetchUser: 404
{
  mockFetchSequence([{ status: 404, body: {} }]);
  const result = await boothApi.fetchUser('없는uid');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.status, 404);
  console.log('fetchUser returns ok:false on 404: OK');
}

// fetchUser: 네트워크 에러
{
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  const result = await boothApi.fetchUser('abc123');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.status, 502);
  console.log('fetchUser returns ok:false on network error: OK');
}

// addUser: bid 캐시 없으면 login을 먼저 호출한 뒤 등록
{
  boothApi._resetCacheForTest();
  mockFetchSequence([
    { status: 200, body: { bid: 'M8' } },
    {
      status: 200,
      body: { booth_code: 'M8', status: 'ok', user_name: '홍길동' },
      assert: (url, opts) => {
        assert.strictEqual(url, 'https://fake-hub.test/api/booth/adduser');
        const parsed = JSON.parse(opts.body);
        assert.strictEqual(parsed.uid, 'abc123');
        assert.strictEqual(parsed.bid, 'M8');
        assert.strictEqual(parsed.password, 'test-pw');
      },
    },
  ]);
  const result = await boothApi.addUser('abc123');
  assert.deepStrictEqual(result, { ok: true, status: 'ok' });
  console.log('addUser logs in first when bid not cached, then registers: OK');
}

// addUser: bid 캐시가 있으면 재로그인 없이 바로 등록
{
  mockFetchSequence([{ status: 200, body: { status: 'ok' } }]);
  const result = await boothApi.addUser('def456');
  assert.strictEqual(result.ok, true);
  console.log('addUser reuses cached bid without re-login: OK');
}

console.log('boothApi.test.mjs: all scenarios OK');
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test backend/lib/boothApi.test.mjs`
Expected: FAIL (`boothApi.js` 파일이 없어 모듈을 찾을 수 없음)

- [ ] **Step 3: 최소 구현 작성**

`backend/lib/boothApi.js`:
```js
// GBL2026 허브(이 저장소 밖의 외부 시스템)와 통신하는 클라이언트. 부스 비밀번호는
// 여기서만 다루고 브라우저로는 절대 내보내지 않는다(HAR 분석 보고서가 지적한 평문
// 비밀번호 노출 위험을 이 프록시 계층으로 막는다).
let cachedBid = null;

function baseUrl() {
  return process.env.BOOTH_API_URL || 'https://34-227-8-239.sslip.io';
}

function password() {
  return process.env.BOOTH_PASSWORD || '';
}

// 로그인 실패는 캐싱하지 않는다 — 허브가 일시적으로 다운됐을 수 있으므로 다음 호출에서
// 다시 시도할 수 있어야 한다.
export async function login() {
  const res = await fetch(`${baseUrl()}/api/auth/boothadmin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: password() }),
  });
  if (!res.ok) {
    throw new Error(`boothadmin login failed: ${res.status}`);
  }
  const data = await res.json();
  cachedBid = data.bid;
  return cachedBid;
}

export async function fetchUser(uid) {
  try {
    const res = await fetch(`${baseUrl()}/api/user/${encodeURIComponent(uid)}`);
    if (!res.ok) {
      return { ok: false, status: res.status, message: `조회 실패 (${res.status})` };
    }
    const data = await res.json();
    return { ok: true, name: data.name, profile_image: data.profile_image };
  } catch (err) {
    return { ok: false, status: 502, message: err.message };
  }
}

export async function addUser(uid) {
  try {
    if (!cachedBid) await login();
    const res = await fetch(`${baseUrl()}/api/booth/adduser`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, bid: cachedBid, password: password() }),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, message: `등록 실패 (${res.status})` };
    }
    const data = await res.json();
    return { ok: true, status: data.status };
  } catch (err) {
    return { ok: false, status: 502, message: err.message };
  }
}

// 테스트 전용 — 모듈 싱글턴 bid 캐시를 초기화한다.
export function _resetCacheForTest() {
  cachedBid = null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test backend/lib/boothApi.test.mjs`
Expected: PASS (모든 `console.log(...: OK')` 출력 + `pass 1`)

- [ ] **Step 5: 커밋**

```bash
git add backend/lib/boothApi.js backend/lib/boothApi.test.mjs
git commit -m "feat: 부스 허브 API 프록시 클라이언트(boothApi) 추가"
```

---

### Task 2: `session.js`에 기기 배정/초기화 헬퍼 추가

**Files:**
- Modify: `backend/socket/session.js` (파일 끝, `registerSessionHandlers` 함수가 끝나는 `}` 바로 뒤에 추가)
- Test: `backend/socket/session.checkinHelpers.test.mjs`

**Interfaces:**
- Consumes: 없음(기존 모듈 내부 `cohort`, `broadcastProgress`, `broadcastParticipants`, `sanitizeParticipantName` 재사용)
- Produces: `findUnassignedParticipant(): {id,name,createDone,weapon}|null`, `assignParticipantName(io, id: string, name: string): boolean`, `resetParticipant(io, id: string): boolean`(battle 단계면 아무 것도 안 하고 `false` 반환)

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/socket/session.checkinHelpers.test.mjs`:
```js
// 부스 QR 체크인(checkin.js)이 쓰는 session.js의 세 헬퍼 — 별도 파일에서 검증한다
// (reopenCreate 테스트와 같은 이유: cohort는 모듈 싱글턴이라 stage를 옮기는 테스트는
// 파일을 분리해야 서로 간섭하지 않는다. node --test는 파일마다 별도 프로세스).
//
// battle 단계 가드를 검증하려면 실제로 battle 단계까지 들어가야 하는데, 그러면
// session.js가 startBattleRoom(setInterval 틱 루프)을 실제로 돌린다 — 파일 끝에서
// stopBattleRoom()으로 반드시 정리해야 프로세스가 매달리지 않는다(session.createDone.test.mjs
// 와 동일한 패턴).
import assert from 'node:assert';
import {
  registerSessionHandlers,
  findUnassignedParticipant,
  assignParticipantName,
  resetParticipant,
} from './session.js';
import { stopBattleRoom } from './battle.js';

const handlers = {};
function makeSocket(id) {
  return {
    id,
    on: (ev, fn) => {
      handlers[id] = handlers[id] || {};
      handlers[id][ev] = fn;
    },
    emit: () => {},
  };
}

const emitted = [];
const targeted = [];
const io = {
  emit: (ev, payload) => emitted.push([ev, payload]),
  to: (id) => ({ emit: (ev, payload) => targeted.push([id, ev, payload]) }),
};

const latestParticipants = () => emitted.filter(([ev]) => ev === 'admin:participants').at(-1)?.[1] ?? [];
const entryOf = (id) => latestParticipants().find((p) => p.id === id);

// participant:join을 s1 -> s2 순서로 보내므로 cohort.participants도 이 순서로 쌓인다.
// findUnassignedParticipant는 배열의 첫 매치를 반환하므로, 이후 어느 소켓 id가 먼저
// 배정되는지는 이 순서로 결정적이다(테스트 전체가 이 순서에 의존한다).
for (const id of ['s1', 's2']) registerSessionHandlers(io, makeSocket(id));
for (const id of ['s1', 's2']) handlers[id]['participant:join']();
handlers.s1['admin:startSession'](); // -> name stage, 둘 다 name === null

// findUnassignedParticipant: 이름 없는 첫 참가자(s1)를 찾는다
{
  const found = findUnassignedParticipant();
  assert.strictEqual(found?.id, 's1');
  console.log('findUnassignedParticipant finds the first nameless entry: OK');
}

// assignParticipantName: 이름을 설정하고 브로드캐스트한다
{
  const ok = assignParticipantName(io, 's1', '26_10905김민규');
  assert.strictEqual(ok, true);
  assert.strictEqual(entryOf('s1').name, '26_10905김민규');
  console.log('assignParticipantName sets name and broadcasts: OK');
}

// findUnassignedParticipant: 방금 배정된 s1은 더 이상 대상이 아니고 s2가 남는다
{
  const remaining = findUnassignedParticipant();
  assert.strictEqual(remaining?.id, 's2', '이미 이름이 배정된 s1은 더 이상 대상이 아니어야 함');
  assert.strictEqual(entryOf('s1').name, '26_10905김민규', '이전에 배정한 s1의 이름은 유지되어야 함');
  console.log('findUnassignedParticipant skips already-named devices: OK');
}

// assignParticipantName: 존재하지 않는 id는 무시하고 false 반환
{
  const ok = assignParticipantName(io, '존재하지-않는-id', '아무개');
  assert.strictEqual(ok, false);
  console.log('assignParticipantName ignores unknown id: OK');
}

// resetParticipant: name/createDone/weapon을 모두 지운다
{
  handlers.s1['create:done']({ damage: 4200, name: '창' });
  assert.strictEqual(entryOf('s1').createDone, true);

  const ok = resetParticipant(io, 's1');
  assert.strictEqual(ok, true);
  assert.strictEqual(entryOf('s1').name, null);
  assert.strictEqual(entryOf('s1').createDone, false);
  assert.strictEqual(entryOf('s1').weapon, null);
  console.log('resetParticipant clears name/createDone/weapon: OK');
}

// resetParticipant: battle 단계에서는 아무 것도 하지 않는다
{
  handlers.s1['admin:nextStage'](); // name -> learn
  handlers.s1['admin:nextStage'](); // learn -> create
  handlers.s1['create:done']({ damage: 1000, name: '창2' });
  handlers.s2['create:done']({ damage: 1000, name: '방패2' });
  handlers.s1['admin:nextStage'](); // create -> battle (startBattleRoom이 실제로 돈다)

  const before = entryOf('s1');
  const ok = resetParticipant(io, 's1');
  assert.strictEqual(ok, false, 'battle 단계에서는 초기화가 거부되어야 함');
  assert.deepStrictEqual(entryOf('s1'), before, 'battle 단계에서는 상태가 바뀌면 안 됨');
  console.log('resetParticipant is rejected during battle stage: OK');
}

stopBattleRoom();
console.log('session.checkinHelpers.test.mjs: all scenarios OK');
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test backend/socket/session.checkinHelpers.test.mjs`
Expected: FAIL (`findUnassignedParticipant`/`assignParticipantName`/`resetParticipant`가 export되지 않아 undefined)

- [ ] **Step 3: `backend/socket/session.js` 파일 끝(마지막 `}` 다음 줄)에 추가**

```js

// 부스 QR 체크인(backend/socket/checkin.js)이 쓰는 헬퍼 — cohort.participants를
// 직접 export하지 않고 이 세 함수로만 접근을 허용해, checkin.js가 cohort 내부 구조를
// 몰라도 되게 한다.

// 아직 이름을 받지 않은 기기(=참가자가 QR로 배정될 수 있는 기기)를 찾는다.
export function findUnassignedParticipant() {
  return cohort.participants.find((p) => p.name === null) ?? null;
}

export function assignParticipantName(io, id, name) {
  const entry = cohort.participants.find((p) => p.id === id);
  if (!entry) return false;
  entry.name = sanitizeParticipantName(name);
  if (cohort.stage !== 'idle') broadcastProgress(io);
  broadcastParticipants(io);
  return true;
}

// 이름까지 입력했지만 부스를 나간 참가자의 기기를 새 참가자에게 다시 내줄 때 쓴다.
// battle 단계에서는 거부한다 — 이미 대전 시작 시점의 참가자 스냅샷(cohort.battleRoster)이
// 떠 있어서, 여기서 지워봐야 진행 중인 대전에는 반영되지 않고 다음 판 로스터 계산만
// 어긋난다(admin:reopenCreate가 create 단계로 제한하는 것과 같은 이유).
export function resetParticipant(io, id) {
  if (cohort.stage === 'battle') return false;
  const entry = cohort.participants.find((p) => p.id === id);
  if (!entry) return false;
  entry.name = null;
  entry.createDone = false;
  entry.weapon = null;
  if (cohort.stage !== 'idle') broadcastProgress(io);
  broadcastParticipants(io);
  return true;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test backend/socket/session.checkinHelpers.test.mjs`
Expected: PASS

- [ ] **Step 5: 기존 session 테스트가 여전히 통과하는지 확인(회귀 없음 검증)**

Run: `node --test backend/socket/session.createDone.test.mjs backend/socket/session.reopenCreate.test.mjs`
Expected: PASS (둘 다)

- [ ] **Step 6: 커밋**

```bash
git add backend/socket/session.js backend/socket/session.checkinHelpers.test.mjs
git commit -m "feat: session.js에 체크인용 기기 배정/초기화 헬퍼 추가"
```

---

### Task 3: 체크인 소켓 모듈 (`backend/socket/checkin.js`)

**Files:**
- Create: `backend/socket/checkin.js`
- Test: `backend/socket/checkin.test.mjs`

**Interfaces:**
- Consumes: `findUnassignedParticipant`, `assignParticipantName`, `resetParticipant`(Task 2), `addUser`(Task 1, `../lib/boothApi.js`)
- Produces: `checkinList: Array<{deviceId,uid,name,profile_image,assignedAt}>`, `initCheckinIo(io): void`, `registerCheckinHandlers(socket): void`, `consumeCheckinList(): Promise<Array<{uid,name,status,message?}>>`, `removeByDeviceId(deviceId): boolean`, `_resetForTest(): void`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/socket/checkin.test.mjs`:
```js
import assert from 'node:assert';
import { registerSessionHandlers, findUnassignedParticipant } from './session.js';
import {
  checkinList,
  initCheckinIo,
  registerCheckinHandlers,
  consumeCheckinList,
  _resetForTest,
} from './checkin.js';

process.env.BOOTH_API_URL = 'https://fake-hub.test';
process.env.BOOTH_PASSWORD = 'test-pw';

// 실제 socket.io 소켓은 같은 이벤트에 여러 리스너를 등록할 수 있다(EventEmitter) —
// 이 소켓엔 registerSessionHandlers와 registerCheckinHandlers가 둘 다 'disconnect'를
// 등록하므로, 마지막 등록만 남기는 { [ev]: fn } 형태로는 세션 쪽 정리 로직이 조용히
// 덮어써진다. 이벤트당 리스너 배열을 쌓고 fire()로 전부 호출해 실제 동작을 재현한다.
const handlers = {};
function makeSocket(id) {
  handlers[id] = {};
  return {
    id,
    on: (ev, fn) => {
      handlers[id][ev] = handlers[id][ev] || [];
      handlers[id][ev].push(fn);
    },
    emit: () => {},
  };
}
function fire(id, ev, ...args) {
  (handlers[id]?.[ev] ?? []).forEach((fn) => fn(...args));
}

const emitted = [];
const targeted = [];
const io = {
  emit: (ev, payload) => emitted.push([ev, payload]),
  to: (id) => ({ emit: (ev, payload) => targeted.push([id, ev, payload]) }),
};
initCheckinIo(io);

for (const id of ['s1', 's2']) {
  const socket = makeSocket(id);
  registerSessionHandlers(io, socket);
  registerCheckinHandlers(socket);
}
for (const id of ['s1', 's2']) fire(id, 'participant:join');
fire('s1', 'admin:startSession'); // -> name, s1/s2 둘 다 name === null

function ack() {
  let called = null;
  const fn = (response) => {
    called = response;
  };
  fn.result = () => called;
  return fn;
}

// checkin:confirmAssign은 "어느 소켓이 이벤트를 보냈는지"가 아니라 cohort.participants
// 안에서 이름이 없는 첫 기기를 찾아 배정한다 — s1이 participant:join을 먼저 보냈으므로
// (등록 순서, 위 for 루프 참고) 항상 s1부터 채워지고, 그다음 s2가 채워진다. 이 결정적
// 순서에 기대어 아래 시나리오를 이어서 검증한다.

// checkin:confirmAssign — 빈 기기(s1)에 배정 성공
{
  const respond = ack();
  fire('s1', 'checkin:confirmAssign', { uid: 'uid-1', name: '26_10905김민규', profile_image: 'https://example.com/a.png' }, respond);
  assert.deepStrictEqual(respond.result(), { ok: true });
  assert.strictEqual(checkinList.length, 1);
  assert.strictEqual(checkinList[0].deviceId, 's1');
  assert.strictEqual(checkinList[0].uid, 'uid-1');

  const prefills = targeted.filter(([, ev]) => ev === 'name:prefill');
  assert.deepStrictEqual(prefills, [['s1', 'name:prefill', '26_10905김민규']]);
  console.log('checkin:confirmAssign assigns to the first unnamed device and prefills its name: OK');
}

// checkin:confirmAssign — 이미 체크인된 uid는 거부(s2는 여전히 비어 있지만 중복이라 막힘)
{
  const respond = ack();
  fire('s2', 'checkin:confirmAssign', { uid: 'uid-1', name: '중복', profile_image: null }, respond);
  assert.deepStrictEqual(respond.result(), { ok: false, reason: 'already_checked_in' });
  assert.strictEqual(checkinList.length, 1, '중복 uid는 목록에 추가되면 안 됨');
  console.log('checkin:confirmAssign rejects a duplicate uid: OK');
}

// checkin:confirmAssign — 남은 빈 기기(s2)에 배정 성공
{
  const respond = ack();
  fire('s2', 'checkin:confirmAssign', { uid: 'uid-2', name: '아무개', profile_image: null }, respond);
  assert.deepStrictEqual(respond.result(), { ok: true });
  assert.strictEqual(checkinList.length, 2);
  assert.strictEqual(checkinList[1].deviceId, 's2');
  console.log('checkin:confirmAssign assigns the next unnamed device: OK');
}

// checkin:confirmAssign — 이제 s1/s2 둘 다 배정되어 빈 기기가 없으므로 거부
{
  const respond = ack();
  fire('s1', 'checkin:confirmAssign', { uid: 'uid-3', name: '자리없음', profile_image: null }, respond);
  assert.deepStrictEqual(respond.result(), { ok: false, reason: 'no_device' });
  assert.strictEqual(checkinList.length, 2);
  console.log('checkin:confirmAssign rejects when no device is available: OK');
}

// checkin:unlink — uid-1 항목만 목록에서 제거(uid-2/s2는 남는다)
{
  fire('s1', 'checkin:unlink', 'uid-1');
  assert.strictEqual(checkinList.length, 1);
  assert.strictEqual(checkinList[0].uid, 'uid-2');
  console.log('checkin:unlink removes only the targeted entry: OK');
}

// admin:resetParticipant — s2를 초기화하면 이름도 지워지고, 연결된 체크인 항목(uid-2)도
// 같이 사라진다 — s2는 다시 findUnassignedParticipant 대상이 된다.
{
  fire('s1', 'admin:resetParticipant', 's2');
  assert.strictEqual(checkinList.length, 0, '기기 초기화 시 체크인 항목도 같이 지워져야 함');
  assert.strictEqual(findUnassignedParticipant()?.id, 's2', '초기화된 기기는 다시 배정 대상이 되어야 함');
  console.log('admin:resetParticipant cascades into checkinList cleanup: OK');
}

// disconnect — 배정된 기기(s2)의 연결이 끊기면 그 체크인 항목도 같이 정리된다
{
  fire('s1', 'checkin:confirmAssign', { uid: 'uid-4', name: '누구2', profile_image: null }, ack());
  assert.strictEqual(checkinList.length, 1);
  assert.strictEqual(checkinList[0].deviceId, 's2');

  fire('s2', 'disconnect');
  assert.strictEqual(checkinList.length, 0, 'disconnect 시 그 기기의 체크인 항목이 정리되어야 함');
  console.log('disconnect cleans up the disconnected device checkin entry: OK');
}

// consumeCheckinList — 성공한 uid만 목록에서 제거, 실패분은 남는다
{
  _resetForTest();
  checkinList.push(
    { deviceId: 'dX', uid: 'uid-ok', name: '성공', profile_image: null, assignedAt: Date.now() },
    { deviceId: 'dY', uid: 'uid-fail', name: '실패', profile_image: null, assignedAt: Date.now() },
  );

  let call = 0;
  globalThis.fetch = async (url, opts) => {
    if (url.endsWith('/api/auth/boothadmin')) {
      return { ok: true, status: 200, json: async () => ({ bid: 'M8' }) };
    }
    call += 1;
    if (call === 1) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };

  const results = await consumeCheckinList();
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results.find((r) => r.uid === 'uid-ok').status, 'ok');
  assert.strictEqual(results.find((r) => r.uid === 'uid-fail').status, 'error');
  assert.strictEqual(checkinList.length, 1, '실패한 uid만 목록에 남아야 함');
  assert.strictEqual(checkinList[0].uid, 'uid-fail');
  console.log('consumeCheckinList removes only successfully-registered uids: OK');
}

console.log('checkin.test.mjs: all scenarios OK');
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test backend/socket/checkin.test.mjs`
Expected: FAIL (`checkin.js` 파일이 없어 모듈을 찾을 수 없음)

- [ ] **Step 3: 최소 구현 작성**

`backend/socket/checkin.js`:
```js
// 부스 QR 체크인 — 관리자가 checkin.html에서 스캔한 참가자를 빈 게임 기기에 배정하고,
// 기기↔uid 매핑을 들고 있다가 게임 종료 시 허브에 일괄 등록한다(routes/checkin.js의
// consumeCheckinList 호출부).
//
// cohort.participants는 session.js가 소유한다 — 이 모듈은 findUnassignedParticipant/
// assignParticipantName/resetParticipant 세 헬퍼로만 접근해서 cohort 내부 구조를 몰라도
// 되게 한다.
import { findUnassignedParticipant, assignParticipantName, resetParticipant } from './session.js';
import { addUser } from '../lib/boothApi.js';

// io는 서버 시작 시 initCheckinIo로 나중에 주입한다(errorLog.js와 같은 패턴) —
// REST 라우트(routes/checkin.js)의 consumeCheckinList는 소켓 연결 없이 브로드캐스트가
// 필요하기 때문에, 매 소켓 이벤트마다 io를 넘겨받는 대신 모듈이 직접 들고 있는다.
let ioRef = null;

// { deviceId, uid, name, profile_image, assignedAt }[]
export const checkinList = [];

export function initCheckinIo(io) {
  ioRef = io;
}

function broadcastList() {
  ioRef?.emit('checkin:list', checkinList);
}

export function removeByDeviceId(deviceId) {
  const before = checkinList.length;
  const remaining = checkinList.filter((entry) => entry.deviceId !== deviceId);
  if (remaining.length === before) return false;
  checkinList.length = 0;
  checkinList.push(...remaining);
  broadcastList();
  return true;
}

function removeByUid(uid) {
  const before = checkinList.length;
  const remaining = checkinList.filter((entry) => entry.uid !== uid);
  if (remaining.length === before) return false;
  checkinList.length = 0;
  checkinList.push(...remaining);
  broadcastList();
  return true;
}

export function registerCheckinHandlers(socket) {
  socket.emit('checkin:list', checkinList);

  socket.on('checkin:confirmAssign', ({ uid, name, profile_image } = {}, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    if (checkinList.some((entry) => entry.uid === uid)) {
      respond({ ok: false, reason: 'already_checked_in' });
      return;
    }
    const device = findUnassignedParticipant();
    if (!device) {
      respond({ ok: false, reason: 'no_device' });
      return;
    }
    assignParticipantName(ioRef, device.id, name);
    // 참가자 화면(NameScreen)이 입력 필드를 미리 채우도록, 배정된 기기에만 원본
    // (트림/길이 제한 전) 이름을 그대로 전달한다 — 참가자가 그대로 제출하거나 수정한다.
    ioRef?.to(device.id).emit('name:prefill', name);
    checkinList.push({ deviceId: device.id, uid, name, profile_image, assignedAt: Date.now() });
    broadcastList();
    respond({ ok: true });
  });

  socket.on('checkin:unlink', (uid) => {
    removeByUid(uid);
  });

  socket.on('admin:resetParticipant', (participantId) => {
    if (resetParticipant(ioRef, participantId)) {
      removeByDeviceId(participantId);
    }
  });

  // 새로고침 없이 완전히 연결이 끊긴 기기(부스를 그냥 나가버린 경우)는 체크인 목록에서도
  // 같이 정리해야 한다 — 안 그러면 게임 종료 시 소진 등록에 유령 uid가 섞여 들어간다.
  socket.on('disconnect', () => {
    removeByDeviceId(socket.id);
  });
}

// 관리자가 "체크인 목록 소진" 버튼을 누르면 호출된다(routes/checkin.js). 허브 쪽 부하를
// 피하려고 병렬이 아니라 순차로 호출한다. 실패한 항목은 목록에 남겨 재시도할 수 있게 한다.
export async function consumeCheckinList() {
  const results = [];
  const remaining = [];
  for (const entry of checkinList) {
    const outcome = await addUser(entry.uid);
    if (outcome.ok) {
      results.push({ uid: entry.uid, name: entry.name, status: 'ok' });
    } else {
      results.push({ uid: entry.uid, name: entry.name, status: 'error', message: outcome.message });
      remaining.push(entry);
    }
  }
  checkinList.length = 0;
  checkinList.push(...remaining);
  broadcastList();
  return results;
}

// 테스트 전용 — 모듈 싱글턴 목록을 초기화한다.
export function _resetForTest() {
  checkinList.length = 0;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test backend/socket/checkin.test.mjs`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/socket/checkin.js backend/socket/checkin.test.mjs
git commit -m "feat: 체크인 목록/배정 소켓 모듈(checkin.js) 추가"
```

---

### Task 4: REST 라우트 + `server.js` 연결 + 환경변수

**Files:**
- Create: `backend/routes/checkin.js`
- Modify: `backend/server.js`
- Modify: `backend/.env`(로컬 전용, 커밋 안 됨 — `.gitignore`에 이미 포함), `backend/.env.example`

**Interfaces:**
- Consumes: `fetchUser`(Task 1), `consumeCheckinList`, `registerCheckinHandlers`, `initCheckinIo`(Task 3)
- Produces: `GET /api/checkin/user/:uid`, `POST /api/checkin/consume`

- [ ] **Step 1: `backend/routes/checkin.js` 작성**

```js
import { Router } from 'express';
import { fetchUser } from '../lib/boothApi.js';
import { consumeCheckinList } from '../socket/checkin.js';

const router = Router();

router.get('/user/:uid', async (req, res) => {
  const result = await fetchUser(req.params.uid);
  if (!result.ok) {
    return res.status(result.status ?? 502).json({ error: result.message });
  }
  res.json({ name: result.name, profile_image: result.profile_image });
});

router.post('/consume', async (req, res) => {
  const results = await consumeCheckinList();
  res.json({ results });
});

export default router;
```

- [ ] **Step 2: `backend/server.js` 수정**

`import resultRoutes from './routes/result.js';` 아래에 추가:
```js
import checkinRoutes from './routes/checkin.js';
```

`import { registerDevBattleHandlers } from './socket/devBattle.js';` 아래에 추가:
```js
import { registerCheckinHandlers, initCheckinIo } from './socket/checkin.js';
```

`app.use('/api/weapon/evaluate', weaponEvaluateRoutes);` 아래에 추가:
```js
app.use('/api/checkin', checkinRoutes);
```

`initErrorLog(io);` 다음 줄에 추가:
```js
initCheckinIo(io);
```

`registerDevBattleHandlers(socket);` 다음 줄에 추가:
```js
  registerCheckinHandlers(socket);
```

수정 후 `io.on('connection', ...)` 블록 전체는 다음과 같아야 한다:
```js
io.on('connection', (socket) => {
  registerSessionHandlers(io, socket);
  registerBattleHandlers(io, socket);
  registerDevBattleHandlers(socket);
  registerCheckinHandlers(socket);
});
```

- [ ] **Step 3: `backend/.env`, `backend/.env.example`에 환경변수 추가**

`backend/.env`(로컬 파일, git에 커밋되지 않음) 맨 아래에 추가:
```
BOOTH_API_URL=https://34-227-8-239.sslip.io
BOOTH_PASSWORD=Y00DeJZsJZrCA4Qd
```

`backend/.env.example` 맨 아래에 추가:
```

# 부스 QR 체크인이 호출하는 외부 GBL2026 허브 설정. BOOTH_PASSWORD는 부스별 고유
# 비밀번호(HAR 캡처로 이미 알려진 값이라도 반드시 이 파일이 아닌 .env에만 채워둘 것) —
# 이 값이 없으면 /api/checkin/* 호출이 모두 실패한다.
BOOTH_API_URL=https://34-227-8-239.sslip.io
BOOTH_PASSWORD=
```

- [ ] **Step 4: 서버가 정상적으로 뜨는지 확인**

Run: `cd backend && node server.js`
Expected: `GBL local server listening on http://localhost:3000` 출력, 에러 없이 계속 실행됨(Ctrl+C로 종료)

- [ ] **Step 5: 기존 백엔드 테스트 전체 회귀 확인**

Run: `cd backend && node --test`
Expected: 모든 테스트 파일이 PASS(신규 3개 포함, 기존 테스트 실패 없음)

- [ ] **Step 6: 커밋**

```bash
git add backend/routes/checkin.js backend/server.js backend/.env.example
git commit -m "feat: 체크인 REST 라우트를 서버에 연결하고 허브 환경변수 추가"
```

(`backend/.env`는 `.gitignore` 대상이라 커밋되지 않는다 — 로컬에서 직접 값을 채워야 한다.)

---

### Task 5: 참가자 이름 화면 — 체크인 배정 시 미리채움

**Files:**
- Modify: `frontend/src/screens/name.js`

**Interfaces:**
- Consumes: 서버가 보내는 `name:prefill`(string) 이벤트(Task 3에서 추가됨)

- [ ] **Step 1: `frontend/src/screens/name.js` 전체를 아래로 교체**

```js
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

// 매 세션(라운드)마다 새로 보여지는 stage — 기기를 새로고침 없이 계속 켜두므로, 이름
// 입력은 전역 게이트가 아니라 서버가 관리하는 'name' stage로 존재한다(app.js 참고).
// 빈 값으로 제출해도 넘어갈 수 있다 — 서버가 어차피 trim/길이 제한으로 다시 검증하므로
// 여기선 자유롭게 입력받는다. 제출 후엔 다음 단계(learn)로 서버가 넘겨줄 때까지 대기
// 화면을 보여준다 — 폼이 그대로 남아있으면 "제출이 안 된 것처럼" 보인다.
export function NameScreen({ socket, onNameSubmit }) {
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    // 관리자가 부스 입구에서 이 참가자의 QR 배지를 스캔해 이 기기에 배정하면, 서버가
    // 이름을 미리 채워준다 — 참가자는 그대로 제출하거나 자유롭게 고쳐서 제출할 수 있다.
    // 이미 제출한 뒤에 도착하면 무시한다(다음 화면으로 이미 넘어간 참가자를 건드리지
    // 않기 위함 — submittedRef로 확인하는 이유는 이 클로저가 마운트 시점에 한 번만
    // 만들어져 최신 submitted 값을 모르기 때문).
    function onPrefill(prefillName) {
      if (submittedRef.current) return;
      setName(prefillName ?? '');
    }
    socket.on('name:prefill', onPrefill);
    return () => socket.off('name:prefill', onPrefill);
  }, [socket]);

  function handleSubmit(e) {
    e.preventDefault();
    submittedRef.current = true;
    onNameSubmit(name);
    socket.emit('participant:name', name);
    setSubmitted(true);
  }

  if (submitted) {
    return html`
      <div class="card name-screen">
        <p class="eyebrow">준비 완료</p>
        <h2 class="title">${name.trim() || '도전자'}님, 반가워요!</h2>
        <p class="subtitle">
          진행자가 시작하면 자동으로 넘어가요
          <span class="dots"><i></i><i></i><i></i></span>
        </p>
      </div>
    `;
  }

  return html`
    <div class="card name-screen">
      <p class="eyebrow">수학 도형 무기 배틀</p>
      <h2 class="title">이름을 알려주세요</h2>
      <p class="subtitle">공용화면 리더보드에 표시돼요<br />안 넣어도 진행할 수 있어요</p>
      <form onSubmit=${handleSubmit}>
        <input
          class="field"
          type="text"
          value=${name}
          onInput=${(e) => setName(e.target.value)}
          placeholder="이름"
          maxlength="20"
        />
        <button class="btn btn--primary btn--block" type="submit">시작하기</button>
      </form>
    </div>
  `;
}
```

- [ ] **Step 2: 수동 확인**

Run: `cd backend && node server.js`, 브라우저로 `http://localhost:3000` 접속 → 관리자 창(`/admin/`)에서 `admin:startSession`을 눌러 name 단계로 진입 → 참가자 창에서 이름 입력 폼이 정상적으로 뜨는지 확인(이 시점엔 아직 checkin.js가 없으므로 `name:prefill`은 오지 않음 — 폼이 기존과 동일하게 동작하는지만 확인). Task 6~7 완료 후 실제 QR 배정으로 재확인한다.

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/screens/name.js
git commit -m "feat: 체크인 배정 시 이름 입력 필드를 미리 채우는 name:prefill 반영"
```

---

### Task 6: 체크인 화면 (`frontend/admin/checkin.html` + `checkin.js` + `checkin.css`)

**Files:**
- Create: `frontend/admin/checkin.html`
- Create: `frontend/admin/checkin.js`
- Create: `frontend/admin/checkin.css`

**Interfaces:**
- Consumes: `GET /api/checkin/user/:uid`(Task 4), 소켓 `checkin:list`/`checkin:confirmAssign`/`checkin:unlink`(Task 3)

- [ ] **Step 1: `frontend/admin/checkin.html` 작성**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>부스 체크인 - 수학 도형 무기 온라인 베틀</title>
  <link rel="stylesheet" href="admin.css" />
  <link rel="stylesheet" href="checkin.css" />
  <script type="importmap">
  {
    "imports": {
      "preact": "https://esm.sh/preact@10",
      "preact/hooks": "https://esm.sh/preact@10/hooks",
      "htm": "https://esm.sh/htm@3",
      "socket.io-client": "https://esm.sh/socket.io-client@4",
      "jsqr": "https://esm.sh/jsqr@1"
    }
  }
  </script>
</head>
<body>
  <div id="checkin-app"></div>
  <script type="module" src="checkin.js"></script>
</body>
</html>
```

- [ ] **Step 2: `frontend/admin/checkin.css` 작성**

```css
.checkin-shell {
  max-width: 480px;
  margin: 0 auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.checkin-header h1 {
  font-size: 1.1rem;
  margin: 0;
}

.checkin-camera {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
}

.checkin-camera video {
  width: 100%;
  display: block;
}

.checkin-camera-error {
  color: var(--danger);
}

.checkin-toast {
  padding: 0.6rem 0.9rem;
  border-radius: 8px;
  background: #16203a;
  color: #fff;
  text-align: center;
}

.checkin-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}

.checkin-modal {
  background: #fff;
  border-radius: 12px;
  padding: 1.5rem;
  width: min(320px, 90vw);
  text-align: center;
}

.checkin-modal-photo {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  object-fit: cover;
  margin-bottom: 0.75rem;
}

.checkin-modal-name {
  font-size: 1.2rem;
  font-weight: 700;
}

.checkin-modal-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  margin-top: 1rem;
}

.checkin-list-panel {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 1rem;
}

.checkin-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.checkin-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
```

- [ ] **Step 3: `frontend/admin/checkin.js` 작성**

```js
import { h, render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';
import jsQR from 'jsqr';

const html = htm.bind(h);
// 매 프레임(보통 60fps)마다 디코딩하면 저전력 부스 기기에서 카메라 미리보기가 버벅인다.
const SCAN_INTERVAL_MS = 250;

function parseQrPayload(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || data.version !== 1 || typeof data.uid !== 'string' || !data.uid) return null;
  return data.uid;
}

function CheckinApp() {
  const [socket] = useState(() => io());
  const [checkinList, setCheckinList] = useState([]);
  const [pending, setPending] = useState(null);
  const [toast, setToast] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const scanningRef = useRef(true);
  const lastScanRef = useRef(0);
  const lastUidRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    socket.on('checkin:list', setCheckinList);
    return () => socket.off('checkin:list', setCheckinList);
  }, [socket]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let stream;

    function tick() {
      rafRef.current = requestAnimationFrame(tick);
      const now = Date.now();
      if (!scanningRef.current || now - lastScanRef.current < SCAN_INTERVAL_MS) return;
      lastScanRef.current = now;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (!code) return;
      const uid = parseQrPayload(code.data);
      if (!uid || uid === lastUidRef.current) return;
      lastUidRef.current = uid;
      handleScan(uid);
    }

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        setCameraError(err.message || '카메라를 열 수 없습니다');
        return;
      }
      tick();
    }

    async function handleScan(uid) {
      scanningRef.current = false;
      try {
        const res = await fetch(`/api/checkin/user/${encodeURIComponent(uid)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setToast(body.error || `사용자를 찾지 못했습니다 (${res.status})`);
          resumeScanning();
          return;
        }
        const data = await res.json();
        setPending({ uid, name: data.name, profile_image: data.profile_image });
      } catch (err) {
        setToast(err.message || '네트워크 오류');
        resumeScanning();
      }
    }

    function resumeScanning() {
      lastUidRef.current = null;
      scanningRef.current = true;
    }

    startCamera();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function cancelPending() {
    setPending(null);
    lastUidRef.current = null;
    scanningRef.current = true;
  }

  function confirmPending() {
    const { uid, name, profile_image } = pending;
    socket.emit('checkin:confirmAssign', { uid, name, profile_image }, (response) => {
      if (response.ok) {
        setToast(`${name}님 체크인 완료`);
      } else if (response.reason === 'no_device') {
        setToast('빈 기기가 없습니다. 기기를 정리한 뒤 다시 스캔해주세요');
      } else if (response.reason === 'already_checked_in') {
        setToast('이미 체크인된 사용자입니다');
      } else {
        setToast('체크인 실패');
      }
      setPending(null);
      lastUidRef.current = null;
      scanningRef.current = true;
    });
  }

  function unlink(uid) {
    socket.emit('checkin:unlink', uid);
  }

  return html`
    <div class="checkin-shell">
      <header class="checkin-header"><h1>부스 체크인</h1></header>
      ${cameraError
        ? html`<p class="checkin-camera-error">카메라를 사용할 수 없습니다: ${cameraError}</p>`
        : html`
            <div class="checkin-camera">
              <video ref=${videoRef} playsinline muted></video>
              <canvas ref=${canvasRef} style="display:none"></canvas>
            </div>
          `}
      ${toast ? html`<div class="checkin-toast">${toast}</div>` : null}
      ${pending
        ? html`
            <div class="checkin-modal-backdrop">
              <div class="checkin-modal">
                ${pending.profile_image
                  ? html`<img class="checkin-modal-photo" src=${pending.profile_image} alt=${pending.name} />`
                  : null}
                <p class="checkin-modal-name">${pending.name}</p>
                <p>본인이 맞나요?</p>
                <div class="checkin-modal-actions">
                  <button onClick=${cancelPending}>아니오</button>
                  <button class="primary" onClick=${confirmPending}>예</button>
                </div>
              </div>
            </div>
          `
        : null}
      <section class="checkin-list-panel">
        <h2>체크인 목록 (${checkinList.length}건)</h2>
        ${checkinList.length === 0
          ? html`<p class="empty">아직 체크인된 참가자가 없습니다.</p>`
          : html`
              <ul class="checkin-list">
                ${checkinList.map(
                  (entry) => html`
                    <li key=${entry.uid}>
                      <span>${entry.name}</span>
                      <button class="kick" onClick=${() => unlink(entry.uid)}>연결 해제</button>
                    </li>
                  `,
                )}
              </ul>
            `}
      </section>
    </div>
  `;
}

render(html`<${CheckinApp} />`, document.getElementById('checkin-app'));
```

- [ ] **Step 4: 수동 확인**

Run: `cd backend && node server.js`, 브라우저(카메라 있는 기기)로 `http://localhost:3000/admin/checkin.html` 접속.
Expected: 카메라 권한 요청이 뜨고 허용 시 미리보기가 보인다. 실물 QR 코드(`{"version":1,"uid":"..."}` 내용을 담은 QR을 아무 생성기로 만들어 테스트)를 비추면 확인 모달이 뜨는지 확인. 별도 창(`/admin/`)에서 `admin:startSession`으로 name 단계를 만들어 둔 뒤 스캔 → "예" 클릭 시 참가자 창(`/`)의 이름 입력 필드가 채워지는지 확인(Task 5에서 이미 반영됨).

- [ ] **Step 5: 커밋**

```bash
git add frontend/admin/checkin.html frontend/admin/checkin.js frontend/admin/checkin.css
git commit -m "feat: 부스 QR 체크인 화면(카메라 스캔) 추가"
```

---

### Task 7: 관리자 대시보드 — 체크인 화면 열기 / 목록 소진 / 기기 초기화

**Files:**
- Modify: `frontend/admin/admin.js`
- Modify: `frontend/admin/admin.css`

**Interfaces:**
- Consumes: 소켓 `checkin:list`(Task 3), `POST /api/checkin/consume`(Task 4), 소켓 `admin:resetParticipant`(Task 3)

- [ ] **Step 1: `AdminApp`에 `checkin:list` 구독 추가**

`const [battleState, setBattleState] = useState(null);` 다음 줄에 추가:
```js
  const [checkinList, setCheckinList] = useState([]);
```

`socket.on('battle:state', onBattleState);` 다음 줄에 추가:
```js
    socket.on('checkin:list', setCheckinList);
```

그 아래 `return () => { ... }` 블록의 `socket.off('battle:state', onBattleState);` 다음 줄에 추가:
```js
      socket.off('checkin:list', setCheckinList);
```

- [ ] **Step 2: 체크인 화면 열기 / 목록 소진 함수 + 버튼 추가**

`function openDevBattle() { ... }` 함수 다음(그 닫는 `}` 바로 뒤)에 추가:
```js

  function openCheckin() {
    window.open('/admin/checkin.html', 'gbl-checkin', 'width=480,height=800');
  }

  async function consumeCheckin() {
    const res = await fetch('/api/checkin/consume', { method: 'POST' });
    const data = await res.json();
    const okCount = data.results.filter((r) => r.status === 'ok').length;
    const failCount = data.results.length - okCount;
    alert(
      `체크인 등록 완료: 성공 ${okCount}건` +
        (failCount > 0 ? `, 실패 ${failCount}건(목록에 남아 재시도 가능)` : ''),
    );
  }
```

`<button onClick=${openDisplay}>공용 화면 열기</button>` 다음 줄에 추가:
```js
          <button onClick=${openCheckin}>체크인 화면 열기</button>
          <button disabled=${checkinList.length === 0} onClick=${consumeCheckin}>
            체크인 목록 소진 (${checkinList.length}건)
          </button>
```

- [ ] **Step 3: `ParticipantCard`에 "기기 초기화" 버튼 추가**

`function ParticipantCard({ participant, canReopen, onForceFinish, onReopen, onKick }) {` 줄을 아래로 교체:
```js
function ParticipantCard({ participant, canReopen, canResetDevice, onForceFinish, onReopen, onKick, onResetDevice }) {
```

`<button\n          class="kick"\n          title="이 참가자의 연결을 서버가 강제로 끊습니다(유령/이름없음 정리용)"\n          onClick=${() => onKick(participant.id, label)}\n        >\n          ⏻ 강제 연결 끊기\n        </button>` 앞에 추가(같은 `.participant-actions` 안):
```js
        ${canResetDevice &&
        html`
          <button
            class="rescue"
            title="이 기기의 이름/제작 상태를 지우고 새 참가자를 받을 수 있게 합니다(체크인 연결도 함께 해제)"
            onClick=${() => onResetDevice(participant.id, label)}
          >
            ⟲ 기기 초기화
          </button>
        `}
```

- [ ] **Step 4: `DashboardPanel`에서 핸들러 정의 + `ParticipantCard`로 전달**

`function kick(participantId, name) { ... }` 함수 다음에 추가:
```js

  function resetDevice(participantId, name) {
    if (
      !confirm(
        `"${name}" 기기를 초기화하고 새 참가자를 받을까요?\n\n이름/제작 진행 상태가 모두 지워지고, 체크인 연결도 함께 해제됩니다.`,
      )
    ) {
      return;
    }
    socket.emit('admin:resetParticipant', participantId);
  }
```

`<${ParticipantCard}\n                      key=${p.id}\n                      participant=${p}\n                      canReopen=${canReopen}\n                      onForceFinish=${forceFinish}\n                      onReopen=${reopen}\n                      onKick=${kick}\n                    />` 를 아래로 교체:
```js
                    <${ParticipantCard}
                      key=${p.id}
                      participant=${p}
                      canReopen=${canReopen}
                      canResetDevice=${stage !== 'battle'}
                      onForceFinish=${forceFinish}
                      onReopen=${reopen}
                      onKick=${kick}
                      onResetDevice=${resetDevice}
                    />
```

- [ ] **Step 5: `frontend/admin/admin.css`에 소진 버튼 비활성 스타일 추가**

파일 끝에 추가:
```css

/* 체크인 목록 소진 버튼 — 대기 건수가 0이면 눌러도 할 일이 없으므로 비활성화 표시. */
.topbar-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 6: 수동 확인**

Run: `cd backend && node server.js`, `/admin/` 접속.
Expected:
1. 상단바에 "체크인 화면 열기" 버튼과 "체크인 목록 소진 (0건)" 버튼(비활성 상태)이 보인다.
2. "체크인 화면 열기" 클릭 시 Task 6의 체크인 창이 새 팝업으로 열린다.
3. 체크인 창에서 QR을 스캔해 배정하면, 관리자 창의 "체크인 목록 소진" 버튼 건수가 올라가고 활성화된다.
4. 참가자 목록에서 이름이 있는 참가자 카드에 "기기 초기화" 버튼이 보이고, 클릭 시 확인창 → 승인하면 그 참가자의 이름/제작 상태가 지워지고 체크인 목록에서도 사라진다.
5. `battle` 단계에서는 "기기 초기화" 버튼이 보이지 않는다.
6. "체크인 목록 소진" 클릭 시(실제 허브가 응답 가능한 네트워크 환경에서) 성공/실패 건수 알림이 뜬다.

- [ ] **Step 7: 커밋**

```bash
git add frontend/admin/admin.js frontend/admin/admin.css
git commit -m "feat: 관리자 대시보드에 체크인 화면 열기/목록 소진/기기 초기화 추가"
```

---

## 최종 점검

- [ ] `cd backend && node --test` — 전체 백엔드 테스트 그린
- [ ] 실기기(카메라 있는 부스 노트북)에서 `checkin.html` 카메라 동작 확인(터치+마우스 하이브리드 Windows 11 노트북 환경 — 기존 부스 기기 메모리 참고)
- [ ] 실제 QR(uid 형식) 스캔 → `/api/user/{uid}` 조회 성공 → 확인 모달 → 빈 기기 자동 배정까지 엔드투엔드 1회 수동 확인
- [ ] 게임 종료 후 "체크인 목록 소진" 버튼으로 실제 허브(`34-227-8-239.sslip.io`)에 등록되는지 1회 수동 확인(실사용 전 반드시)
