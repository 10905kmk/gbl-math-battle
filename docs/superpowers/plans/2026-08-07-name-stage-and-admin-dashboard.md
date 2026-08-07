# 이름 입력 단계 + 관리자 대시보드 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참가자 이름 입력을 서버 stage(`name`)로 승격시키고, `create`→`battle` 전환을
관리자 수동으로 바꾸며, 그 과정에서 필요해진 참가자별 진행 상태 추적을 관리자
대시보드(실시간 리스트/낙오자 강제 마감/에러 로그)가 그대로 재사용하도록 만든다.

**Architecture:** `backend/socket/session.js`의 `STAGE_ORDER`에 `'name'`을 추가하고,
`joined`(Set) + `participantNames`(Map) + `cohort.participants`(create 완료자만)로
흩어져 있던 참가자 추적을 `cohort.participants` 배열 하나로 통합한다(`participant:join`
시점부터 엔트리 생성). 이 통합된 배열을 `admin:participants`로 broadcast해서 관리자
대시보드의 실시간 리스트와 낙오자 강제 마감(`admin:forceFinish`) 양쪽에 그대로 쓴다.
에러 로그는 `backend/lib/errorLog.js`의 메모리 링버퍼 + 소켓 broadcast로 구현한다.

**Tech Stack:** Node.js/Express/Socket.io(백엔드), 번들러 없는 Preact+htm(프론트,
esm.sh CDN import), `node --test` 없이 순수 `assert` 기반 `.test.mjs` 스크립트(기존
관례 — `node <path>.test.mjs`로 개별 실행, 실패 시 `assert`가 throw).

## Global Constraints

- 참가자 데이터 모델은 `cohort.participants` 배열 하나로 통합한다 — 필드는
  `{ id, name, createDone, weapon }`.
- `name`/`create`→`battle` 전환은 관리자의 `admin:nextStage` 수동 클릭으로만 일어난다
  (완료 인원 자동 집계로 인한 자동 전환 없음).
- `admin:reset`과 `admin:startSession` 둘 다 참가자 엔트리 자체(연결 식별자)는
  지우지 않고, 그 라운드의 `name`/`createDone`/`weapon` 필드만 초기화한다 — 기기를
  새로고침 없이 계속 켜두는 운영 방식이라, "접속 여부"와 "이번 라운드 진행 상태"를
  분리해야 한다.
- 에러 로그는 최대 20개, 최신이 배열 맨 앞.
- 기본 무기(`admin:forceFinish`가 부여)는 `weaponEvaluate.js`의 기존 폴백 함수
  (`fallbackDamage`, `fallbackAttackRange`)를 빈 `parts: []`로 호출한 값을 그대로
  쓴다 — 새 상수를 만들지 않는다.
- 이번 작업 범위 밖: 제출 현황(Supabase 저장 건수) 대시보드, 관리자 로그인 UI,
  CDN 오프라인 대비, battle 단계 자체의 흐름.

---

## Task 1: 에러 로그 모듈 (`backend/lib/errorLog.js`)

**Files:**
- Create: `backend/lib/errorLog.js`
- Test: `backend/lib/errorLog.test.mjs`

**Interfaces:**
- Consumes: 없음 (독립 모듈, socket.io 서버 인스턴스는 `initErrorLog`로 나중에 주입됨)
- Produces:
  - `initErrorLog(io)` — 이후 `logError`가 broadcast에 쓸 `io` 인스턴스를 등록.
  - `logError(context: string, err: unknown)` — `console.error`로도 찍고, 최근 20개
    링버퍼에 `{context, message, timestamp}` 형태로 추가하고, `io`가 등록돼 있으면
    `io.emit('admin:error', entry)`.
  - `getErrorLog(): Array<{context, message, timestamp}>` — 현재 버퍼 전체(최신이
    맨 앞) 반환. Task 2~3에서 서버 시작/신규 소켓 연결 시 이 값을 그대로 보낸다.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/lib/errorLog.test.mjs`:
```js
import assert from 'node:assert';
import { initErrorLog, logError, getErrorLog } from './errorLog.js';

// 초기엔 빈 배열
assert.deepStrictEqual(getErrorLog(), []);

// io 초기화 전에도 logError는 죽지 않아야 한다(유닛 테스트/미초기화 상태 방어)
logError('test', new Error('before init'));
assert.strictEqual(getErrorLog().length, 1);
assert.strictEqual(getErrorLog()[0].context, 'test');
assert.strictEqual(getErrorLog()[0].message, 'before init');
console.log('logError works before initErrorLog is called: OK');

// initErrorLog 이후엔 새 에러가 io.emit('admin:error', ...)로 브로드캐스트되어야 한다
const emitted = [];
initErrorLog({ emit: (ev, payload) => emitted.push([ev, payload]) });
logError('weaponChat', new Error('boom'));
assert.strictEqual(emitted.length, 1);
assert.strictEqual(emitted[0][0], 'admin:error');
assert.strictEqual(emitted[0][1].context, 'weaponChat');
assert.strictEqual(emitted[0][1].message, 'boom');
assert.ok(emitted[0][1].timestamp);
console.log('logError broadcasts admin:error after initErrorLog: OK');

// MAX_ENTRIES(20) 캡 — 최신이 앞에 오고 오래된 건 잘려나가야 한다
for (let i = 0; i < 25; i += 1) {
  logError('bulk', new Error(`err-${i}`));
}
const log = getErrorLog();
assert.strictEqual(log.length, 20, '최대 20개까지만 유지되어야 함');
assert.strictEqual(log[0].message, 'err-24', '최신 항목이 맨 앞이어야 함');
console.log('getErrorLog caps at MAX_ENTRIES and keeps newest first: OK');

// err가 Error 인스턴스가 아니어도(문자열 등) 죽지 않아야 한다
logError('weird', 'just a string');
assert.strictEqual(getErrorLog()[0].message, 'just a string');
console.log('logError tolerates non-Error values: OK');

console.log('errorLog.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node backend/lib/errorLog.test.mjs`
Expected: `Cannot find module '.../errorLog.js'` 에러로 FAIL

- [ ] **Step 3: 최소 구현 작성**

`backend/lib/errorLog.js`:
```js
// 관리자 대시보드가 보여줄 최근 서버 에러 링버퍼 — 부스 운영 중 AI 평가 실패, 결과 저장
// 실패 등이 콘솔에만 찍히면 아무도 안 보고 있을 때 조용히 묻힌다. io는 서버 시작 시
// initErrorLog로 나중에 주입한다(errorLog.js 자체는 socket.io를 몰라도 되게).
const MAX_ENTRIES = 20;
let entries = []; // 최신이 앞
let ioRef = null;

export function initErrorLog(io) {
  ioRef = io;
}

export function logError(context, err) {
  console.error(`[${context}]`, err);
  const entry = {
    context,
    message: err instanceof Error ? err.message : String(err),
    timestamp: new Date().toISOString(),
  };
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  ioRef?.emit('admin:error', entry);
}

export function getErrorLog() {
  return entries;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node backend/lib/errorLog.test.mjs`
Expected: 모든 `console.log(...: OK')` 출력, 에러 없이 종료(exit code 0)

- [ ] **Step 5: 커밋**

```bash
git add backend/lib/errorLog.js backend/lib/errorLog.test.mjs
git commit -m "feat: 관리자 대시보드용 서버 에러 로그 모듈 추가"
```

---

## Task 2: 에러 로그를 서버에 연결 + 기존 console.error 교체

**Files:**
- Modify: `backend/server.js`
- Modify: `backend/routes/weaponChat.js`
- Modify: `backend/routes/weaponEvaluate.js`
- Modify: `backend/lib/resultStorage.js`

**Interfaces:**
- Consumes: Task 1의 `initErrorLog(io)`, `logError(context, err)` (from
  `backend/lib/errorLog.js`).
- Produces: 없음 (이 Task는 기존 동작을 바꾸지 않고 로깅 경로만 교체 — 기존 라우트/모듈
  테스트가 그대로 통과해야 함).

- [ ] **Step 1: `server.js`에 `initErrorLog(io)` 연결**

`backend/server.js`에서 (line 6 근처) import 추가:
```js
import { initErrorLog } from './lib/errorLog.js';
```
그리고 `const io = new Server(server);` (line 37) 바로 다음 줄에 추가:
```js
initErrorLog(io);
```

- [ ] **Step 2: `weaponChat.js`의 console.error 교체**

`backend/routes/weaponChat.js` 상단 import에 추가:
```js
import { logError } from '../lib/errorLog.js';
```
`catch (err) { console.error('[weaponChat] AI 채팅 처리 실패:', err); ... }` (기존
line 74)를:
```js
catch (err) {
  logError('weaponChat', err);
  res.status(502).json({ error: 'chat failed' });
}
```
로 교체(메시지 텍스트가 context로 옮겨갔으므로 `logError('weaponChat', err)`만
호출, 나머지 `res.status(502)...` 줄은 그대로 유지).

- [ ] **Step 3: `weaponEvaluate.js`의 console.error 교체**

`backend/routes/weaponEvaluate.js` 상단 import에 추가:
```js
import { logError } from '../lib/errorLog.js';
```
`console.error('[weaponEvaluate] AI 평가 실패, fallback으로 대체:', err);` (기존
line 53)를 `logError('weaponEvaluate', err);`로 교체. 나머지 로직(fallback 계산 후
`res.json(...)`)은 그대로 유지.

- [ ] **Step 4: `resultStorage.js`의 console.error 2곳 교체**

`backend/lib/resultStorage.js` 상단 import에 추가(같은 디렉터리):
```js
import { logError } from './errorLog.js';
```
`console.error('[resultStorage] 참가자 결과 저장 실패:', participants[i].id, outcome.reason);`
(기존 line 63)를:
```js
logError(`resultStorage:${participants[i].id}`, outcome.reason);
```
로 교체(참가자 id를 context에 포함시켜 어느 참가자 저장이 실패했는지 에러 로그에서
바로 보이게 함).

`console.error('[resultStorage] fallback 파일 기록도 실패:', err);` (기존 line 86,
`appendFallback` 함수 내부)도:
```js
logError('resultStorage:fallback', err);
```
로 교체.

- [ ] **Step 5: 기존 테스트가 여전히 통과하는지 확인**

Run:
```bash
node backend/routes/weaponChat.test.mjs
node backend/routes/weaponEvaluate.test.mjs
node backend/lib/resultStorage.test.mjs
```
Expected: 세 파일 모두 기존과 동일하게 전부 `OK` 출력, 에러 없이 종료. (이 테스트들은
`console.error` 호출 자체를 검증하지 않으므로 — 사전 확인 완료 — 교체로 인해 깨질
이유가 없다. 혹시 실패하면 import 경로 오타를 먼저 의심할 것.)

- [ ] **Step 6: 커밋**

```bash
git add backend/server.js backend/routes/weaponChat.js backend/routes/weaponEvaluate.js backend/lib/resultStorage.js
git commit -m "refactor: 서버 에러 로그를 console.error 대신 errorLog 모듈로 통일"
```

---

## Task 3: `session.js` — name stage, 수동 전환, 참가자 모델 통합, 낙오자 강제 마감

**Files:**
- Modify: `backend/socket/session.js`
- Modify: `backend/socket/session.createDone.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `logError`, `getErrorLog` (from `../lib/errorLog.js`);
  `backend/routes/weaponEvaluate.js`가 이미 export하는 `fallbackDamage(weaponState)`,
  `fallbackAttackRange(weaponState)` (순수 함수, `weaponState.parts`만 읽음).
- Produces:
  - `cohort.participants: Array<{id, name, createDone, weapon}>` — 이후 이 파일
    내부에서만 쓰이지만, 이 배열이 곧 `admin:participants`로 나가는 payload의
    형태이므로 Task 5(admin.js)가 이 필드명을 그대로 가정한다.
  - 소켓 이벤트 `admin:participants` (payload: 위 배열 그대로), `admin:forceFinish`
    (관리자→서버, payload: `participantId: string`).
  - `STAGE_ORDER = ['name', 'learn', 'create', 'battle', 'result', 'thanks']`.

이 Task는 파일 전체를 새로 씀 — 아래가 `backend/socket/session.js`의 완성된 전체
내용이다(기존 파일을 이 내용으로 통째로 교체).

- [ ] **Step 1: 실패하는 테스트 작성 (`session.createDone.test.mjs` 전체 교체)**

`backend/socket/session.createDone.test.mjs`:
```js
import assert from 'node:assert';
import { registerSessionHandlers } from './session.js';
import { stopBattleRoom } from './battle.js';

const handlers = {};
function makeSocket(id) {
  // registerSessionHandlers는 등록 시점에 여러 socket.emit(...)을 바로 호출한다
  // (신규 접속 동기화 기능) — 목 소켓에도 emit이 있어야 한다.
  return {
    id,
    on: (ev, fn) => { handlers[id] = handlers[id] || {}; handlers[id][ev] = fn; },
    emit: () => {},
  };
}
const emitted = [];
// battle 라운드가 실제로 시작/종료되므로(session.js가 startBattleRoom을 호출)
// io.to(id).emit(...)까지 흉내낼 수 있어야 한다.
const io = {
  emit: (ev, payload) => emitted.push([ev, payload]),
  to: () => ({ emit: () => {} }),
};

function stageChanges() {
  return emitted.filter(([ev]) => ev === 'stage:change').map(([, s]) => s);
}

function latestParticipants() {
  return emitted.filter(([ev]) => ev === 'admin:participants').at(-1)?.[1] ?? [];
}

function countAdminParticipantsEmits() {
  return emitted.filter(([ev]) => ev === 'admin:participants').length;
}

// 5개의 서로 다른 소켓을 등록
for (let i = 1; i <= 5; i += 1) {
  registerSessionHandlers(io, makeSocket(`s${i}`));
}
for (let i = 1; i <= 5; i += 1) {
  handlers[`s${i}`]['participant:join']();
}

// admin:startSession -> 'name' (2026-08-07 설계: 더 이상 'learn'으로 직행하지 않는다 —
// 기기를 새로고침 없이 계속 켜두므로 매 라운드 이름을 다시 받아야 해서 실제 stage로
// 승격시켰다).
handlers.s1['admin:startSession']();
assert.deepStrictEqual(stageChanges(), ['name'], "admin:startSession은 이제 'name' 단계부터 시작해야 함");

// 'name' -> 'learn' -> 'create'는 모두 관리자 수동 전환.
handlers.s1['admin:nextStage'](); // -> learn
handlers.s1['admin:nextStage'](); // -> create
assert.deepStrictEqual(stageChanges(), ['name', 'learn', 'create']);

// 회귀 테스트: create:done을 전원이 보내도 더 이상 자동으로 battle로 넘어가면 안 된다
// (2026-08-07 설계 — create -> battle 전환도 관리자 수동 전환으로 바뀜).
for (let i = 1; i <= 5; i += 1) {
  handlers[`s${i}`]['create:done']({ damage: 1000 * i });
}
assert.deepStrictEqual(
  stageChanges(),
  ['name', 'learn', 'create'],
  '전원이 create:done을 보내도 자동으로 battle로 전환되면 안 됨 — 관리자가 다음 단계를 눌러야만 전환',
);

// 관리자가 수동으로 다음 단계를 누르면 그제서야 battle로 전환된다.
handlers.s1['admin:nextStage'](); // -> battle
assert.deepStrictEqual(stageChanges(), ['name', 'learn', 'create', 'battle']);
console.log('name/create stage transitions are manual-only (no auto-transition on completion): OK');

// 진행도(create:progress)는 여전히 완료 수만큼 정확히 브로드캐스트되어야 한다.
{
  const progressEvents = emitted.filter(([ev]) => ev === 'create:progress').map(([, p]) => p);
  assert.deepStrictEqual(
    progressEvents.map((p) => p.done),
    [0, 1, 2, 3, 4, 5],
    'admin:startSession 직후 done:0 브로드캐스트 + create:done마다 done count가 하나씩 늘며 브로드캐스트되어야 함',
  );
  assert.ok(progressEvents.every((p) => p.total === 5));
  console.log('create:progress broadcasts accurate done count: OK');
}

// admin:participants가 참가자별 이름/제작 완료 상태를 정확히 담아 브로드캐스트되어야 한다.
{
  const participants = latestParticipants();
  assert.strictEqual(participants.length, 5);
  assert.ok(participants.every((p) => p.createDone === true));
  assert.ok(participants.every((p) => p.weapon != null));
  console.log('admin:participants reflects per-participant createDone/weapon: OK');
}

// participant:name이 admin:participants에 반영되어야 한다.
{
  handlers.s1['participant:name']('철수');
  const participants = latestParticipants();
  const s1 = participants.find((p) => p.id === 's1');
  assert.strictEqual(s1.name, '철수');
  console.log('participant:name updates admin:participants: OK');
}

// 회귀 테스트: 참가자가 새로고침해서 소켓이 바뀌어도(옛 소켓 disconnect + 새 소켓으로
// 재등록) 중복으로 카운트되면 안 된다(Opus 리뷰 Critical #2b, 실제로 재현됨) — 통합된
// cohort.participants 모델에서도 그대로 성립해야 한다.
{
  handlers.s1['admin:reset']();
  emitted.length = 0;
  // admin:reset은 참가자 엔트리 자체(연결 상태)는 지우지 않고 이번 라운드 필드만
  // 초기화한다(기기가 새로고침 없이 계속 켜져 있다는 전제 — 2026-08-07 설계 문서
  // B 참고). 이 테스트는 "완전히 새로운 5명 세션"을 검증하려는 것이므로, 이전
  // 참가자들의 기기가 실제로 연결을 끊었다고 명시적으로 흉내낸다.
  for (let i = 1; i <= 5; i += 1) {
    handlers[`s${i}`]['disconnect']();
  }
  for (let i = 1; i <= 5; i += 1) {
    registerSessionHandlers(io, makeSocket(`r${i}`));
  }
  for (let i = 1; i <= 5; i += 1) {
    handlers[`r${i}`]['participant:join']();
  }
  handlers.r1['admin:startSession']();
  handlers.r1['admin:nextStage'](); // -> learn
  handlers.r1['admin:nextStage'](); // -> create

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const refreshedId = `r1-refresh${attempt}`;
    handlers.r1['disconnect']();
    registerSessionHandlers(io, makeSocket(refreshedId));
    handlers[refreshedId]['participant:join']();
    handlers[refreshedId]['create:done']({ damage: 100 });
    handlers.r1 = handlers[refreshedId];

    const latestProgress = emitted.filter(([ev]) => ev === 'create:progress').at(-1)[1];
    assert.strictEqual(
      latestProgress.done,
      1,
      `refresh ${attempt}회차 이후에도 완료 인원은 1명(r1 본인)이어야 함 — 유령 참가자가 쌓이면 안 됨`,
    );
  }

  for (let i = 2; i <= 5; i += 1) {
    handlers[`r${i}`]['create:done']({ damage: 100 });
  }
  handlers.r1['admin:nextStage'](); // -> battle (수동)

  assert.deepStrictEqual(
    stageChanges(),
    ['name', 'learn', 'create', 'battle'],
    '참가자 1명이 4번 새로고침해도 실제 완료 인원은 5명(새로고침한 1명 + 4명)이어야 하고, 관리자가 눌러야 battle로 전환됨',
  );
  console.log('refresh churn does not double-count participants: OK');
}

// admin:forceFinish — 미완료 참가자를 기본 무기로 강제 마감.
{
  handlers.r1['admin:reset']();
  emitted.length = 0;
  for (let i = 1; i <= 5; i += 1) {
    handlers[`r${i}`]['disconnect']();
  }
  for (let i = 1; i <= 3; i += 1) {
    registerSessionHandlers(io, makeSocket(`f${i}`));
    handlers[`f${i}`]['participant:join']();
  }
  handlers.f1['admin:startSession']();
  handlers.f1['admin:nextStage'](); // -> learn
  handlers.f1['admin:nextStage'](); // -> create

  handlers.f1['create:done']({ damage: 500 });
  // f2, f3은 제작을 안 끝냄 — 관리자가 f2만 강제 마감시킴
  handlers.f1['admin:forceFinish']('f2');

  const participants = latestParticipants();
  const f2 = participants.find((p) => p.id === 'f2');
  assert.strictEqual(f2.createDone, true, '강제 마감된 참가자는 createDone=true여야 함');
  assert.strictEqual(f2.weapon.parts.length, 0, '기본 무기는 빈 parts를 가져야 함');
  assert.strictEqual(f2.weapon.attackRange, 'melee', '기본 무기는 melee여야 함');
  assert.ok(f2.weapon.damage >= 1, '기본 무기도 유효한 damage 값을 가져야 함');

  const f3 = participants.find((p) => p.id === 'f3');
  assert.strictEqual(f3.createDone, false, '강제 마감하지 않은 참가자는 그대로 미완료여야 함');

  // 중복 강제 마감은 무시되어야 한다(이미 완료된 참가자에게 다시 호출).
  const beforeRepeat = countAdminParticipantsEmits();
  handlers.f1['admin:forceFinish']('f2');
  assert.strictEqual(countAdminParticipantsEmits(), beforeRepeat, '이미 완료된 참가자에게 다시 강제 마감을 호출하면 아무 일도 없어야 함');

  // 존재하지 않는(이미 연결 끊긴) 참가자에 대한 강제 마감도 무시되어야 한다.
  handlers.f1['admin:forceFinish']('ghost-id');
  assert.strictEqual(countAdminParticipantsEmits(), beforeRepeat, '존재하지 않는 참가자 id에 대한 강제 마감은 무시되어야 함');

  console.log('admin:forceFinish assigns a fixed fallback weapon and ignores already-done/unknown participants: OK');
}

// 회귀 테스트: 세션 시작 시점의 접속 인원이 목표가 되어야 한다(5명 고정 아님).
{
  handlers.f1['admin:reset']();
  emitted.length = 0;
  for (let i = 1; i <= 3; i += 1) {
    handlers[`f${i}`]['disconnect']();
  }
  for (let i = 1; i <= 3; i += 1) {
    registerSessionHandlers(io, makeSocket(`t${i}`));
    handlers[`t${i}`]['participant:join']();
  }
  handlers.t1['admin:startSession']();
  handlers.t1['admin:nextStage'](); // -> learn
  handlers.t1['admin:nextStage'](); // -> create

  handlers.t1['create:done']({ damage: 100 });
  handlers.t2['create:done']({ damage: 100 });
  const progressEvents = emitted.filter(([ev]) => ev === 'create:progress').map(([, p]) => p);
  assert.ok(progressEvents.every((p) => p.total === 3), '3명 세션에서 total은 3이어야 함(5명 고정 아님)');
  console.log('session locks expected participant count to join-time headcount, not a fixed 5: OK');
}

// 회귀 테스트: admin:startSession이 목표 인원을 고정하는 즉시 create:progress로
// 브로드캐스트해야 한다.
{
  handlers.t1['admin:reset']();
  emitted.length = 0;
  for (let i = 1; i <= 3; i += 1) {
    handlers[`t${i}`]['disconnect']();
  }
  registerSessionHandlers(io, makeSocket('w1'));
  handlers.w1['participant:join']();
  registerSessionHandlers(io, makeSocket('w2'));
  handlers.w2['participant:join']();
  registerSessionHandlers(io, makeSocket('w3'));
  handlers.w3['participant:join']();

  handlers.w1['admin:startSession']();

  const latestProgress = emitted.filter(([ev]) => ev === 'create:progress').at(-1)?.[1];
  assert.ok(latestProgress, 'admin:startSession 직후 create:progress가 브로드캐스트되어야 함');
  assert.strictEqual(latestProgress.total, 3, 'create:progress의 total이 방금 고정된 expectedParticipants와 즉시 일치해야 함');
  console.log('admin:startSession immediately broadcasts the newly locked expectedParticipants: OK');
}

// 회귀 테스트: admin:reset/admin:startSession으로 새 라운드가 시작되면 이전 라운드의
// 이름/제작 완료 상태가 남아있으면 안 된다(기기를 계속 켜두는 운영 방식 — 2026-08-07
// 설계 문서 배경 참고. 이게 없으면 다음 그룹 참가자가 이전 그룹 이름/완료 상태를 그대로
// 물려받는다).
{
  handlers.w1['admin:reset']();
  emitted.length = 0;
  handlers.w1['participant:name']('영희'); // 리셋 후에도 기기는 연결이 유지된 채임
  handlers.w1['admin:startSession'](); // 새 라운드 시작 — 이전 이름/완료 상태는 초기화되어야 함

  const participants = latestParticipants();
  const w1 = participants.find((p) => p.id === 'w1');
  assert.strictEqual(w1.name, null, '새 라운드가 시작되면 이전 라운드에 입력했던 이름은 초기화되어야 함');
  assert.strictEqual(w1.createDone, false, '새 라운드가 시작되면 제작 완료 상태도 초기화되어야 함');
  console.log("a new admin:startSession resets each surviving participant's round fields: OK");
}

stopBattleRoom();

console.log('session.createDone.test.mjs: all scenarios OK');
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node backend/socket/session.createDone.test.mjs`
Expected: 첫 assertion(`admin:startSession은 이제 'name' 단계부터 시작해야 함`)에서
FAIL (`stageChanges()`가 여전히 `['learn']`을 반환하므로) — 아직 `session.js`를
안 고쳤으니 당연히 실패.

- [ ] **Step 3: `session.js` 전체 교체**

`backend/socket/session.js`:
```js
import { startBattleRoom, stopBattleRoom } from './battle.js';
import { saveParticipantResults } from '../lib/resultStorage.js';
import { fallbackDamage, fallbackAttackRange } from '../routes/weaponEvaluate.js';
import { logError, getErrorLog } from '../lib/errorLog.js';

// 세션(코호트) 상태 — 부스 참가자들이 공유하는 stage, slideIndex, 참가자 진행도.
// 목표 인원(expectedParticipants)은 고정값이 아니라 admin:startSession 시점에 그때까지
// participant:join을 보낸 소켓 수로 매번 새로 고정된다(참가 인원 유동화 설계 문서 참고).
const cohort = {
  stage: 'idle',
  slideIndex: 0,
  // { id, name, createDone, weapon } — participant:join 시점에 엔트리가 생기고
  // disconnect로만 제거된다. admin:reset/admin:startSession은 엔트리 자체는 남기고
  // 이번 라운드 관련 필드(name/createDone/weapon)만 초기화한다 — 기기를 새로고침 없이
  // 계속 켜두는 운영 방식이라(2026-08-07 설계 문서), "몇 명이 접속해 있는지"와 "이번
  // 라운드에서 뭘 했는지"를 분리해야 한다. 예전엔 joined(Set) + participantNames(Map) +
  // cohort.participants(create 완료자만) 세 구조로 흩어져 있었는데, 관리자 대시보드가
  // "지금 접속한 모두"를 실시간으로 봐야 해서 하나로 합쳤다.
  participants: [],
  expectedParticipants: 0,
};

// 관리자가 수동으로 단계를 앞뒤로 넘길 때의 순서. idle은 startSession/reset으로만 드나든다.
// 'name'이 맨 앞에 추가됨(2026-08-07) — 기기를 새로고침 없이 계속 켜두므로 라운드마다
// 이름을 다시 물어봐야 해서, 전역 화면 게이트가 아니라 실제 stage로 승격시켰다.
const STAGE_ORDER = ['name', 'learn', 'create', 'battle', 'result', 'thanks'];

function goToStage(io, nextStage) {
  cohort.stage = nextStage;
  cohort.slideIndex = 0;
  io.emit('stage:change', cohort.stage);
  if (nextStage === 'battle') {
    // 대전 시작 시점의 참가자 목록을 스냅샷으로 떼어둔다 — cohort.participants는 대전 도중
    // 참가자가 연결을 끊으면 disconnect 핸들러가 그 참가자를 걸러낸 "새 배열"로 재할당해버려서,
    // 라운드가 끝난 뒤 결과 저장 시점엔 이미 그 참가자가 사라지고 없다(연결이 끊겼어도 대전
    // 결과 자체는 저장돼야 하므로, 대전 중 필터링과 결과 저장은 서로 다른 참가자 목록을 봐야 함).
    const participantsAtBattleStart = [...cohort.participants];
    startBattleRoom(io, participantsAtBattleStart, {
      // 관리자가 대전 도중 다른 단계로 수동 이동한 뒤에 뒤늦게 라운드가 끝나면(타이머 만료 등)
      // 이 콜백이 그때 가서 엉뚱하게 result로 되돌려버릴 수 있다 — 그 사이 stage가 이미
      // battle이 아니게 됐으면 무시한다. (아래 else 분기가 stopBattleRoom도 호출하므로
      // 정상 경로에서는 이 콜백 자체가 그 뒤로 불릴 일이 없다 — 이건 이중 방어.)
      onEnd: (winners, scores) => {
        // 저장이 끝나야 각 참가자 결과 행의 id를 알 수 있다(QR/링크가 그 id로 result-page를
        // 가리켜야 하므로) — outcomes는 participantsAtBattleStart와 같은 순서라 인덱스로
        // 그대로 짝지을 수 있다. 저장 실패(rejected)한 참가자에게는 보내지 않는다 — 존재하지
        // 않는 id로 QR을 만들면 스캔했을 때 "결과 없음"만 보게 되므로, 아예 안 보내는 쪽이
        // 참가자 화면이 QR 없이 요약만 보여주는 정상적인 폴백으로 이어진다.
        saveParticipantResults(participantsAtBattleStart, winners, scores)
          .then((outcomes) => {
            outcomes.forEach((outcome, i) => {
              if (outcome.status === 'fulfilled' && outcome.value?.id) {
                io.to(participantsAtBattleStart[i].id).emit('result:saved', { id: outcome.value.id });
              }
            });
          })
          .catch((err) => {
            logError('session', err);
          });
        if (cohort.stage === 'battle') goToStage(io, 'result');
      },
    });
  } else {
    // battle이 아닌 다른 단계로 넘어가면(관리자가 수동으로 건너뛴 경우 포함) 진행 중이던
    // 대전은 더 이상 의미가 없으니 같이 정지 — 안 그러면 admin:reset 없이도 뒷단계까지
    // battle:state가 계속 broadcast되고, 나중에 끝났을 때 엉뚱한 단계에서 result로 끌려간다.
    stopBattleRoom();
  }
}

function doneCount() {
  return cohort.participants.filter((p) => p.createDone).length;
}

function broadcastProgress(io) {
  io.emit('create:progress', { done: doneCount(), total: cohort.expectedParticipants });
}

function broadcastParticipants(io) {
  io.emit('admin:participants', cohort.participants);
}

// admin:reset과 admin:startSession 둘 다 이걸 부른다 — 참가자 엔트리(연결 식별자) 자체는
// 남기고 "이번 라운드" 관련 필드만 지운다. 안 그러면 admin:reset을 거치지 않고 바로
// 다음 admin:startSession을 눌러도(실제 운영에서 흔함) 이전 라운드의 이름/완료 상태가
// 새 라운드로 그대로 넘어온다.
function resetRoundFields() {
  cohort.participants.forEach((p) => {
    p.name = null;
    p.createDone = false;
    p.weapon = null;
  });
}

function findOrCreateParticipant(id) {
  let entry = cohort.participants.find((p) => p.id === id);
  if (!entry) {
    entry = { id, name: null, createDone: false, weapon: null };
    cohort.participants.push(entry);
  }
  return entry;
}

// admin:forceFinish가 부여하는 "기본 무기" — AI 평가 자체를 시도하지 않은 참가자용이므로
// weaponEvaluate.js가 AI 평가 "실패" 시 쓰는 결정론적 폴백을 그대로 재사용한다(빈
// parts에 대한 값은 항상 DAMAGE_MIN/melee/RANGE_DISTANCE_MIN로 고정) — 새 상수를 따로
// 만들지 않아 두 값이 나중에 어긋날 걱정이 없다.
function defaultWeapon() {
  const { attackRange, attackRangeDistance } = fallbackAttackRange({ parts: [] });
  return {
    name: '기본 무기',
    image: null,
    damage: fallbackDamage({ parts: [] }),
    attackRange,
    attackRangeDistance,
    parts: [],
  };
}

export function registerSessionHandlers(io, socket) {
  // 새로 연결된 소켓(새로고침한 참가자, 나중에 여는 관리자/공용화면 등)에게 현재 상태를
  // 바로 알려준다. 이게 없으면 stage:change/learn:slide 등은 "그 이후 변경분"만 받기
  // 때문에 계속 idle/빈 값으로 보인다.
  socket.emit('stage:change', cohort.stage);
  socket.emit('learn:slide', cohort.slideIndex);
  socket.emit('create:progress', { done: doneCount(), total: cohort.expectedParticipants });
  socket.emit('admin:participants', cohort.participants);
  socket.emit('admin:errorLog', getErrorLog());

  // 참가자 화면만 보내는 신호 — 관리자/공용화면은 이 이벤트를 보내지 않으므로
  // cohort.participants에 안 잡힌다.
  socket.on('participant:join', () => {
    findOrCreateParticipant(socket.id);
    broadcastParticipants(io);
  });

  // 참가자 이름 — 인원수 집계(participant:join)와 완전히 분리된 별도 신호다. 클라이언트가
  // 보낸 값을 그대로 믿지 않고 문자열인지 확인한 뒤 trim + 20자로 제한한다.
  socket.on('participant:name', (name) => {
    const safeName = typeof name === 'string' ? name.trim().slice(0, 20) : '';
    const existing = cohort.participants.find((p) => p.id === socket.id);
    if (existing) existing.name = safeName || null;
    broadcastParticipants(io);
  });

  socket.on('admin:startSession', () => {
    // 이 시점까지 접속해 있던(=cohort.participants에 엔트리가 있는) 참가자 수를 이번
    // 세션의 목표 인원으로 고정한다.
    cohort.expectedParticipants = cohort.participants.length;
    // 새 라운드가 시작되므로 이전 라운드의 이름/제작 완료 상태를 지운다(resetRoundFields
    // 주석 참고) — admin:reset을 거치지 않고 바로 다음 세션을 시작하는 경우에도 항상
    // 여기서 초기화되어야 한다.
    resetRoundFields();
    console.log(`[session] 세션 시작 — 목표 인원 ${cohort.expectedParticipants}명으로 고정`);
    goToStage(io, 'name');
    broadcastProgress(io);
    broadcastParticipants(io);
  });

  socket.on('admin:nextSlide', () => {
    cohort.slideIndex += 1;
    io.emit('learn:slide', cohort.slideIndex);
  });

  socket.on('admin:prevSlide', () => {
    cohort.slideIndex = Math.max(0, cohort.slideIndex - 1);
    io.emit('learn:slide', cohort.slideIndex);
  });

  socket.on('admin:nextStage', () => {
    const idx = STAGE_ORDER.indexOf(cohort.stage);
    const next = STAGE_ORDER[Math.min(idx + 1, STAGE_ORDER.length - 1)];
    goToStage(io, next);
  });

  socket.on('admin:prevStage', () => {
    const idx = STAGE_ORDER.indexOf(cohort.stage);
    if (idx <= 0) return;
    goToStage(io, STAGE_ORDER[idx - 1]);
  });

  socket.on('admin:reset', () => {
    stopBattleRoom();
    cohort.stage = 'idle';
    cohort.slideIndex = 0;
    resetRoundFields();
    cohort.expectedParticipants = 0;
    io.emit('stage:change', cohort.stage);
    broadcastProgress(io);
    broadcastParticipants(io);
  });

  socket.on('create:done', (weapon) => {
    const entry = findOrCreateParticipant(socket.id);
    entry.createDone = true;
    entry.weapon = weapon;
    broadcastProgress(io);
    broadcastParticipants(io);
  });

  // 관리자가 제작 단계에서 시간을 다 채우고도 완료하지 못한 참가자("낙오자")를 강제로
  // 마감시킬 때 쓴다 — create -> battle 전환이 이제 전원 완료를 기다리지 않고 관리자
  // 수동으로 일어나므로, 이걸 안 만들면 미완료 참가자는 무기 없이 battle에서 통째로
  // 빠진다(대전 참여도 결과 저장도 못 함).
  socket.on('admin:forceFinish', (participantId) => {
    const entry = cohort.participants.find((p) => p.id === participantId);
    if (!entry || entry.createDone) return;
    entry.createDone = true;
    entry.weapon = defaultWeapon();
    broadcastProgress(io);
    broadcastParticipants(io);
  });

  // 참가자가 완전히 연결을 끊으면(기기를 끄거나 브라우저를 닫는 등) 명단에서 제거한다.
  // 새로고침만으로는 여기 안 온다고 가정하면 안 된다 — 새로고침도 기존 소켓의
  // disconnect를 먼저 발생시키고 새 소켓으로 다시 연결되므로, 옛 id를 지워두지 않으면
  // 유령 참가자가 계속 쌓인다(Opus 리뷰 Critical #2b, 실제로 재현됨).
  socket.on('disconnect', () => {
    const before = cohort.participants.length;
    cohort.participants = cohort.participants.filter((p) => p.id !== socket.id);
    if (cohort.participants.length !== before) {
      broadcastProgress(io);
      broadcastParticipants(io);
    }
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node backend/socket/session.createDone.test.mjs`
Expected: 모든 `console.log(...: OK')` 출력, 마지막에
`session.createDone.test.mjs: all scenarios OK` 출력, 에러 없이 종료.

- [ ] **Step 5: 다른 socket 테스트가 여전히 통과하는지 확인**

Run:
```bash
node backend/socket/battle.headroom.test.mjs
node backend/socket/battleIntegration.test.mjs
```
Expected: 둘 다 기존과 동일하게 통과. (이 두 파일은 `battle.js`를 직접 테스트하고
`session.js`의 stage 머신과는 독립적이라 영향이 없어야 하지만, `session.js`가
`battle.js`의 `startBattleRoom`/`stopBattleRoom`을 호출하는 관계이므로 회귀가 없는지
확인.)

- [ ] **Step 6: 커밋**

```bash
git add backend/socket/session.js backend/socket/session.createDone.test.mjs
git commit -m "feat: name stage 도입 + create/battle 수동 전환 + 참가자 모델 통합 + 낙오자 강제 마감"
```

---

## Task 4: 참가자 화면 — `app.js` / `name.js` / `result.js`

**Files:**
- Modify: `frontend/src/app.js`
- Modify: `frontend/src/screens/name.js`
- Modify: `frontend/src/screens/result.js`

**Interfaces:**
- Consumes: Task 3에서 서버가 이제 `'name'`을 첫 stage로 broadcast한다는 것,
  기존 `participant:name` 소켓 이벤트(변경 없음), `battleResult`/`weapon` 필드는
  `state.js`에 이미 있음(변경 없음).
- Produces: 없음(참가자 쪽 UI만 변경, 다른 Task가 이 파일들을 참조하지 않음).

번들러가 없는 프로젝트라 브라우저에서 직접 문법 오류를 확인해야 한다 — 이 Task엔
자동화된 유닛 테스트가 없다(기존 코드베이스도 `frontend/src/`쪽엔 `.test.mjs`가 없음).
대신 각 Step마다 `node --check`로 최소한의 구문 검증을 하고, 마지막에 로컬 서버를
띄워 브라우저로 직접 확인한다.

- [ ] **Step 1: `app.js`에서 이름 게이트를 stage 기반으로 교체**

`frontend/src/app.js` 전체를 아래 내용으로 교체:
```js
import { h, render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';

import { state } from './state.js';
import { NameScreen } from './screens/name.js';
import { LearnScreen } from './screens/learn.js';
import { CreateScreen } from './screens/create.js';
import { BattleScreen } from './screens/battle.js';
import { ResultScreen } from './screens/result.js';
import { ThanksScreen } from './screens/thanks.js';

const html = htm.bind(h);

const SCREENS = {
  name: NameScreen,
  learn: LearnScreen,
  create: CreateScreen,
  battle: BattleScreen,
  result: ResultScreen,
  thanks: ThanksScreen,
};

function App() {
  const [stage, setStage] = useState('name');
  const [socket] = useState(() => io());
  // socket.io는 재연결 시 새 socket.id를 발급한다 — 서버가 이름을 참가자 엔트리에
  // socket.id 기준으로 들고 있어서(backend/socket/session.js), 재연결 후
  // participant:name을 다시 안 보내면 와이파이가 잠깐 끊겼다 붙는 것만으로 이름이
  // 사라진다. 예전엔 이 값으로 "이름 입력 화면을 아예 건너뛸지"도 결정했지만, 이제
  // 이름 입력은 서버 stage('name')가 결정하므로 nameRef는 순수하게 재접속 시
  // 재전송하는 용도로만 쓰인다.
  const nameRef = useRef(null);
  // 결과 저장(Supabase) 완료 후 서버가 알려주는 저장된 행의 id — result-page QR/링크에 쓴다.
  // battle.js가 아니라 여기서 듣는 이유: 저장은 비동기라 stage가 이미 result로 넘어가
  // BattleScreen이 unmount된 뒤에 이 이벤트가 도착하는 경우가 흔한데, App은 화면 전환과
  // 무관하게 항상 떠 있어서 놓치지 않는다.
  const [resultId, setResultId] = useState(null);

  useEffect(() => {
    function onStageChange(nextStage) {
      setStage(nextStage);
      if (nextStage === 'battle') setResultId(null);
    }
    socket.on('stage:change', onStageChange);
    return () => socket.off('stage:change', onStageChange);
  }, [socket]);

  useEffect(() => {
    function onSaved({ id }) {
      setResultId(id);
    }
    socket.on('result:saved', onSaved);
    return () => socket.off('result:saved', onSaved);
  }, [socket]);

  useEffect(() => {
    function join() {
      socket.emit('participant:join');
      if (nameRef.current !== null) {
        socket.emit('participant:name', nameRef.current);
      }
    }
    socket.on('connect', join);
    if (socket.connected) join();
    return () => socket.off('connect', join);
  }, [socket]);

  const Screen = SCREENS[stage] ?? LearnScreen;
  return html`<${Screen}
    socket=${socket}
    state=${state}
    resultId=${resultId}
    onNameSubmit=${(n) => {
      nameRef.current = n;
    }}
  />`;
}

render(html`<${App} />`, document.getElementById('app'));
```

- [ ] **Step 2: 구문 확인**

Run: `node --check frontend/src/app.js`
Expected: 아무 출력 없이 종료(exit code 0)

- [ ] **Step 3: `NameScreen`을 stage 화면 + 제출 후 대기 뷰로 변경**

`frontend/src/screens/name.js` 전체를 아래 내용으로 교체:
```js
import { h } from 'preact';
import { useState } from 'preact/hooks';
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

  function handleSubmit(e) {
    e.preventDefault();
    onNameSubmit(name);
    socket.emit('participant:name', name);
    setSubmitted(true);
  }

  if (submitted) {
    return html`
      <div class="name-screen">
        <h2>입력 완료!</h2>
        <p>시작을 기다리는 중입니다...</p>
      </div>
    `;
  }

  return html`
    <div class="name-screen">
      <h2>이름을 알려주세요</h2>
      <p>공용화면 리더보드에 표시돼요 (안 넣어도 진행할 수 있어요)</p>
      <form onSubmit=${handleSubmit}>
        <input
          type="text"
          value=${name}
          onInput=${(e) => setName(e.target.value)}
          placeholder="이름"
          maxlength="20"
        />
        <button type="submit">시작하기</button>
      </form>
    </div>
  `;
}
```

- [ ] **Step 4: 구문 확인**

Run: `node --check frontend/src/screens/name.js`
Expected: 아무 출력 없이 종료(exit code 0)

- [ ] **Step 5: `result.js`에서 이미지 없는 무기(낙오자 기본 무기) 대응**

`frontend/src/screens/result.js`의 `<img src=${weapon?.image} alt=${weapon?.name} />`
줄을 조건부 렌더링으로 교체:
```js
${weapon?.image && html`<img src=${weapon.image} alt=${weapon?.name} />`}
```
(전체 파일 중 이 한 줄만 교체 — `weapon.image`가 `null`인 경우(admin:forceFinish로
부여된 기본 무기) `<img>` 태그 자체를 안 그려서 깨진 이미지 아이콘이 안 보이게 함.)

- [ ] **Step 6: 구문 확인**

Run: `node --check frontend/src/screens/result.js`
Expected: 아무 출력 없이 종료(exit code 0)

- [ ] **Step 7: 로컬 서버로 직접 확인**

Run: `cd backend && node server.js` (백그라운드로 띄운 뒤) 브라우저로
`http://localhost:3000`을 열어:
1. 이름 입력 화면이 뜨는지, 제출 시 "입력 완료! 시작을 기다리는 중입니다..." 로
   바뀌는지 확인.
2. 관리자 페이지(`http://localhost:3000/admin/index.html`)에서 "세션 시작" →
   "다음 단계"를 눌러 learn으로 넘어가는지 확인.
서버 종료 후 다음 Step으로.

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/app.js frontend/src/screens/name.js frontend/src/screens/result.js
git commit -m "feat: 이름 입력을 name stage로 승격 + 제출 후 대기 뷰 + 기본 무기 이미지 누락 대응"
```

---

## Task 5: 관리자 대시보드 — 실시간 참가자 리스트/낙오자 강제 마감/에러 로그

**Files:**
- Modify: `frontend/admin/admin.js`
- Modify: `frontend/admin/admin.css`

**Interfaces:**
- Consumes: Task 3이 broadcast하는 `admin:participants`(payload:
  `Array<{id, name, createDone, weapon}>`), `admin:error`(payload:
  `{context, message, timestamp}`), `admin:errorLog`(payload: 위와 같은 배열),
  기존 `create:progress`(`{done, total}`), 기존 `admin:forceFinish` 소켓 이벤트
  (payload: `participantId: string`, Task 3에서 이미 서버 핸들러 구현됨).
- Produces: 없음(최종 UI, 다른 Task가 참조하지 않음).

- [ ] **Step 1: `admin.js` 전체 교체**

`frontend/admin/admin.js` 전체를 아래 내용으로 교체:
```js
import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';

const html = htm.bind(h);

// 공통 상단바(stage/진행도/전역 버튼) + stage별 본문 전환. docs/초안.md 7-⑥,
// 2026-08-07 설계 문서 참고. "남은 시간"은 더 이상 표시하지 않는다 — battle을 제외한
// 모든 단계가 관리자 수동 전환으로 바뀌면서 표시할 서버 타이머 자체가 없어졌다(battle
// 단계 타이머는 BattleMapView.js/battle.js가 각자 이미 보여주고 있어 여기서 중복으로
// 가질 필요 없음).
function AdminApp() {
  const [socket] = useState(() => io());
  const [stage, setStage] = useState('idle');
  const [participants, setParticipants] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    function onNewError(entry) {
      setErrors((prev) => [entry, ...prev].slice(0, 20));
    }
    socket.on('stage:change', setStage);
    socket.on('admin:participants', setParticipants);
    socket.on('create:progress', setProgress);
    socket.on('admin:errorLog', setErrors);
    socket.on('admin:error', onNewError);
    return () => {
      socket.off('stage:change', setStage);
      socket.off('admin:participants', setParticipants);
      socket.off('create:progress', setProgress);
      socket.off('admin:errorLog', setErrors);
      socket.off('admin:error', onNewError);
    };
  }, [socket]);

  function openDisplay() {
    window.open('/admin/display.html', 'gbl-display', 'width=1280,height=720');
  }

  function forceFinish(participantId) {
    socket.emit('admin:forceFinish', participantId);
  }

  return html`
    <div class="admin-shell">
      <header class="admin-topbar">
        <span>현재 단계: ${stage}</span>
        <span>제작 완료: ${progress.done}/${progress.total}</span>
        <button onClick=${() => socket.emit('admin:startSession')}>세션 시작</button>
        <button onClick=${() => socket.emit('admin:prevStage')}>이전 단계</button>
        <button onClick=${() => socket.emit('admin:nextStage')}>다음 단계</button>
        <button onClick=${() => socket.emit('admin:reset')}>전체 강제 리셋</button>
        <button onClick=${openDisplay}>공용 화면 열기</button>
      </header>

      <main class="admin-body">
        ${stage === 'learn'
          ? html`<${PresenterPanel} socket=${socket} />`
          : html`<${DashboardPanel} participants=${participants} errors=${errors} onForceFinish=${forceFinish} />`}
      </main>
    </div>
  `;
}

function PresenterPanel({ socket }) {
  return html`
    <div class="presenter-panel">
      <div class="slide-preview">현재 슬라이드 미리보기</div>
      <div class="slide-controls">
        <button onClick=${() => socket.emit('admin:prevSlide')}>이전 슬라이드</button>
        <button onClick=${() => socket.emit('admin:nextSlide')}>다음 슬라이드</button>
      </div>
    </div>
  `;
}

function DashboardPanel({ participants, errors, onForceFinish }) {
  return html`
    <div class="dashboard-panel">
      <ul class="participant-list">
        ${participants.map((p) => html`
          <li>
            <span class="participant-name">${p.name ?? '이름 없음'}</span>
            <span class="participant-status">${p.createDone ? '제작 완료' : '제작 중'}</span>
            ${!p.createDone && html`<button onClick=${() => onForceFinish(p.id)}>기본 무기로 마감</button>`}
          </li>
        `)}
      </ul>
      <div class="error-log">
        <h3>에러 로그</h3>
        ${errors.length === 0
          ? html`<p>없음</p>`
          : html`<ul>${errors.map((e) => html`<li>[${e.context}] ${e.message}</li>`)}</ul>`}
      </div>
      <div class="submission-status">제출 현황: -</div>
    </div>
  `;
}

render(html`<${AdminApp} />`, document.getElementById('admin-app'));
```

- [ ] **Step 2: 구문 확인**

Run: `node --check frontend/admin/admin.js`
Expected: 아무 출력 없이 종료(exit code 0)

- [ ] **Step 3: `admin.css`에 참가자 리스트/에러 로그 스타일 추가**

`frontend/admin/admin.css` 끝에 추가:
```css
.participant-list {
  list-style: none;
  padding: 0;
  margin: 0 0 1.5rem;
}

.participant-list li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid #ddd;
}

.participant-name {
  flex: 1;
}

.error-log {
  margin-top: 1.5rem;
}

.error-log ul {
  list-style: none;
  padding: 0;
  margin: 0;
  font-family: monospace;
  font-size: 0.85rem;
}

.error-log li {
  padding: 0.25rem 0;
  color: #b00020;
}
```

- [ ] **Step 4: 로컬 서버로 직접 확인**

Run: `cd backend && node server.js` 브라우저로
`http://localhost:3000/admin/index.html`을 열어:
1. "세션 시작"을 누르고 참가자 기기(또는 새 탭에서 `http://localhost:3000`)를 접속시켜
   `participant:join`이 리스트에 즉시 반영되는지 확인.
2. 참가자가 이름을 입력하면 리스트의 이름이 실시간으로 바뀌는지 확인.
3. "다음 단계"를 눌러 create까지 가서, 아직 무기를 안 만든 참가자 옆의
   "기본 무기로 마감" 버튼을 눌러 "제작 완료"로 바뀌는지, 다시 눌러도 아무 일 없는지
   확인.
4. 의도적으로 AI 평가 실패를 유발(예: `backend/.env`의 `GEMINI_API_KEY`를 잠깐
   비우거나 `MOCK_AI`를 건드리는 등, 실제로 건드리지 않아도 되면 로그만 확인)하거나,
   기존 콘솔 로그에 찍히는 에러가 있으면 대시보드 "에러 로그"에도 같이 뜨는지 확인.
서버 종료 후 다음 Step으로.

- [ ] **Step 5: 커밋**

```bash
git add frontend/admin/admin.js frontend/admin/admin.css
git commit -m "feat: 관리자 대시보드에 실시간 참가자 리스트, 낙오자 강제 마감, 에러 로그 추가"
```

---

## Self-Review 메모 (계획 작성자용, 실행 시 참고)

- **Spec 커버리지:** A(name stage), B(참가자 모델 통합), C(대시보드), D(낙오자 강제
  마감), E(에러 로그) 모두 Task 1~5에 매핑됨. 제외 항목(제출 현황, 관리자 인증, CDN
  오프라인, battle 흐름 변경)은 이번 계획에서 손대지 않음.
- **의존 순서:** Task 1(errorLog) → Task 2(콘솔 교체, errorLog 사용) → Task 3
  (session.js, errorLog + weaponEvaluate.js의 fallback 함수 사용) → Task 4/5
  (프론트, Task 3이 broadcast하는 이벤트 payload 형태에 의존) — 반드시 이 순서로
  진행해야 함.
- **알려진 트레이드오프:** `session.js`가 `routes/weaponEvaluate.js`의
  `fallbackDamage`/`fallbackAttackRange`를 import하는 건 socket↔route 계층을
  가로지르는 다소 이례적인 의존이지만, 새 상수를 중복 정의하지 않기 위한
  의도적 선택(설계 문서 D 참고).
