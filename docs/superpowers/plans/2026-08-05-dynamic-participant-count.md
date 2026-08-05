# 참가 인원 유동화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `backend/socket/session.js`의 `EXPECTED_PARTICIPANTS = 5` 하드코딩을 없애고, 관리자가 "세션 시작"을 누르는 시점에 접속해 있던 참가자 수를 그 세션의 목표 인원으로 동적으로 고정한다. 동시에 스폰 지점/캐릭터 색상을 8개까지로 늘려 여유를 둔다.

**Architecture:** 참가자 화면(`frontend/src/app.js`)이 소켓 연결 시 `participant:join`을 서버로 보낸다. 서버(`session.js`)는 이 신호를 보낸 소켓 id를 `Set`으로 추적하다가, `admin:startSession` 시점에 그 크기를 `cohort.expectedParticipants`로 스냅샷한다. 진행률 표시와 자동 대전 전환 조건이 이 값을 참조한다.

**Tech Stack:** Node.js(ES modules) + Socket.IO 백엔드, Preact + htm 프론트엔드(빌드 도구 없음, 브라우저 import map으로 직접 로드). 자동 테스트는 `node:assert` 기반 `.mjs` 스크립트(테스트 프레임워크 없음) — 프론트엔드(`frontend/`) 쪽은 애초에 Node로 import 불가능한 브라우저 전용 코드라 자동 테스트 대상이 아니다(기존 `shapes/weaponRenderer.js` 등과 동일한 제약).

## Global Constraints

- 실제 예상 참가 인원 범위: 3~6명 (사용자 확인).
- 스폰 지점(`SPAWN_POINTS`)·캐릭터 식별자(`CHARACTER_IDS`)·캐릭터 색상(`CHARACTER_COLORS`)은 8개까지 여유를 둔다(사용자 명시 요청: "스폰/캐릭 8개정도까지는 여유분 있어야할듯").
- 접속 참가자가 0명인 상태에서 "세션 시작"을 눌러도 별도 방어 로직을 넣지 않는다(사용자 확인 — 실제 문제를 일으키지 않으므로 스코프 아님).
- 관리자 화면(`frontend/admin/admin.js`)의 자체 진행률 표시(`doneCount/participants.length`)는 이 작업과 무관한 기존 미완성 상태이므로 손대지 않는다.
- 새 스폰 지점은 `backend/lib/battleMap.js`의 `DEFAULT_MAP.walls`(벽: `{x:350,y:250,w:100,h:20}`, `{x:100,y:100,w:20,h:150}`, `{x:680,y:350,w:20,h:150}`)와 겹치지 않아야 한다.

---

### Task 1: 서버 — 참가 인원을 세션 시작 시점에 동적으로 고정

**Files:**
- Modify: `backend/socket/session.js` (전체 재작성 — 아래 Step 3 코드가 최종 내용)
- Test: `backend/socket/session.createDone.test.mjs` (기존 파일 수정)

**Interfaces:**
- Consumes: 없음 (이 태스크가 최초 정의)
- Produces:
  - 소켓 이벤트 `participant:join` (payload 없음) — 참가자 화면이 접속 시 보냄, Task 2가 클라이언트에서 이 이벤트를 emit함
  - `cohort.expectedParticipants` (number) — `admin:startSession` 시점에 그때까지 `participant:join`을 보낸 소켓 수로 고정됨. `create:progress` 이벤트의 `total` 필드와 자동 대전 전환 조건이 이 값을 씀

- [ ] **Step 1: 기존 테스트를 새 흐름에 맞게 수정 (RED 유도)**

`backend/socket/session.createDone.test.mjs`에서 아래 3곳을 수정한다.

첫 번째 — 파일 26~34번째 줄 근처, 소켓 등록 직후에 `participant:join` 호출을 추가:

```js
// 5개의 서로 다른 소켓을 등록
for (let i = 1; i <= 5; i += 1) {
  registerSessionHandlers(io, makeSocket(`s${i}`));
}

// 참가자 화면은 접속 시 participant:join을 보낸다 — admin:startSession 시점에 이 신호를
// 보낸 소켓 수가 이번 세션의 목표 인원(cohort.expectedParticipants)으로 고정된다.
for (let i = 1; i <= 5; i += 1) {
  handlers[`s${i}`]['participant:join']();
}

// create:done은 실제로는 create 화면이 떠 있을 때만(=stage가 'create'일 때만) 올 수 있다 —
// stage latch(아래 회귀 테스트)를 제대로 검증하려면 이 테스트도 실제 흐름처럼 먼저
// learn -> create로 진행시켜야 한다.
handlers.s1['admin:startSession'](); // -> learn (여기서 expectedParticipants = 5로 고정)
handlers.s1['admin:nextStage'](); // -> create
```

두 번째 — "회귀 테스트: 참가자가 새로고침해서..." 블록 안, `registerSessionHandlers`로 `r1`~`r5`를 등록한 직후에 join 호출 추가:

```js
  handlers.r1['admin:reset']();
  emitted.length = 0; // 이전 시나리오의 이벤트는 이 검증과 무관하니 비움
  for (let i = 1; i <= 5; i += 1) {
    registerSessionHandlers(io, makeSocket(`r${i}`));
  }
  for (let i = 1; i <= 5; i += 1) {
    handlers[`r${i}`]['participant:join']();
  }
  handlers.r1['admin:startSession']();
  handlers.r1['admin:nextStage'](); // -> create
```

세 번째 — 파일 맨 끝, `stopBattleRoom();` 직전에 새 회귀 테스트 블록을 추가(더 이상 5로 고정되지 않았음을 직접 증명):

```js
// 회귀 테스트: 5명 고정이 아니라 "세션 시작 시점에 접속해 있던 인원"이 목표가 되어야 한다 —
// 3명만 참가했다면 3명 완료로 battle 전환돼야 한다(예전처럼 5명을 기다리며 멈춰있으면 안 됨).
{
  handlers.r1['admin:reset']();
  emitted.length = 0;
  for (let i = 1; i <= 3; i += 1) {
    registerSessionHandlers(io, makeSocket(`t${i}`));
    handlers[`t${i}`]['participant:join']();
  }
  handlers.t1['admin:startSession']();
  handlers.t1['admin:nextStage'](); // -> create

  handlers.t1['create:done']({ damage: 100 });
  handlers.t2['create:done']({ damage: 100 });
  assert.ok(
    !emitted.some(([ev, stage]) => ev === 'stage:change' && stage === 'battle'),
    '3명 세션에서 2명만 완료 시 아직 battle 전환 안 됨',
  );

  handlers.t3['create:done']({ damage: 100 });
  assert.ok(
    emitted.some(([ev, stage]) => ev === 'stage:change' && stage === 'battle'),
    '3명 세션은 3명만 완료해도 battle로 전환되어야 함(5명 고정이 아님)',
  );
  console.log('session locks expected participant count to join-time headcount, not a fixed 5: OK');
}

stopBattleRoom();
```

(참고: 파일에 이미 `stopBattleRoom();`이 마지막 줄로 있으므로, 새 블록을 그 줄 "바로 앞"에 삽입하는 것이지 별도로 추가하는 게 아니다.)

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/socket/session.createDone.test.mjs`
Expected: `handlers[...]['participant:join']`이 함수가 아니라서(아직 서버에 해당 핸들러가 없음) `TypeError: handlers...['participant:join'] is not a function`으로 즉시 실패.

- [ ] **Step 3: `session.js`를 새 흐름으로 재작성**

`backend/socket/session.js` 전체를 아래 내용으로 교체한다:

```js
import { startBattleRoom, stopBattleRoom } from './battle.js';
import { saveParticipantResults } from '../lib/resultStorage.js';

// 세션(코호트) 상태 — 부스 참가자들이 공유하는 stage, slideIndex, 참가자 진행도.
// 목표 인원(expectedParticipants)은 고정값이 아니라 admin:startSession 시점에 그때까지
// participant:join을 보낸 소켓 수로 매번 새로 고정된다(참가 인원 유동화 설계 문서 참고).
const cohort = {
  stage: 'idle',
  slideIndex: 0,
  participants: [], // { id, name, done }
  expectedParticipants: 0,
};

// 현재 접속 중인 "참가자" 소켓 id 집합. 관리자 화면/공용화면도 같은 서버에 소켓으로
// 접속하므로, 접속 자체만으로는 참가자인지 구분할 수 없다 — 참가자 화면(frontend/src/app.js)이
// 접속 시 보내는 participant:join 신호로만 구분한다.
const joined = new Set();

// 관리자가 수동으로 단계를 앞뒤로 넘길 때의 순서. idle은 startSession/reset으로만 드나든다.
const STAGE_ORDER = ['learn', 'create', 'battle', 'result', 'thanks'];

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
      onEnd: (winners) => {
        saveParticipantResults(participantsAtBattleStart, winners).catch((err) => {
          console.error('[session] 결과 저장 중 예외:', err);
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
  return cohort.participants.filter((p) => p.done).length;
}

function broadcastProgress(io) {
  io.emit('create:progress', { done: doneCount(), total: cohort.expectedParticipants });
}

export function registerSessionHandlers(io, socket) {
  // 새로 연결된 소켓(새로고침한 참가자, 나중에 여는 공용화면 등)에게 현재 상태를 바로 알려준다.
  // 이게 없으면 stage:change/learn:slide는 "그 이후 변경분"만 받기 때문에 계속 idle로 보임.
  socket.emit('stage:change', cohort.stage);
  socket.emit('learn:slide', cohort.slideIndex);
  socket.emit('create:progress', { done: doneCount(), total: cohort.expectedParticipants });

  // 참가자 화면만 보내는 신호 — 관리자/공용화면은 이 이벤트를 보내지 않으므로 joined에 안 잡힌다.
  socket.on('participant:join', () => {
    joined.add(socket.id);
  });

  socket.on('admin:startSession', () => {
    // 이 시점까지 접속해 있던 참가자 수를 이번 세션의 목표 인원으로 고정한다. 하드코딩된
    // 상수(예전엔 5) 대신, 실제 부스 회차마다 다를 수 있는 인원에 맞춘다.
    cohort.expectedParticipants = joined.size;
    goToStage(io, 'learn');
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
    cohort.participants = [];
    cohort.expectedParticipants = 0;
    io.emit('stage:change', cohort.stage);
    broadcastProgress(io);
  });

  socket.on('create:done', (weapon) => {
    const existing = cohort.participants.find((p) => p.id === socket.id);
    if (existing) {
      existing.done = true;
      existing.weapon = weapon;
    } else {
      cohort.participants.push({ id: socket.id, done: true, weapon });
    }
    broadcastProgress(io);
    // 관리자가 이미 create 단계를 벗어난 뒤에(강제로 다음 단계로 넘긴 경우 등) 뒤늦게 도착한
    // create:done은 무시한다 — 안 그러면 느린 참가자가 뒤늦게 "AI 평가받기"를 눌렀을 때 이미
    // battle/result까지 진행된 코호트를 도로 battle로 되돌려버릴 수 있다(Opus 리뷰 Critical #2a).
    if (cohort.stage !== 'create') return;
    if (doneCount() >= cohort.expectedParticipants) {
      goToStage(io, 'battle');
    }
  });

  // 참가자가 새로고침 등으로 끊기면 새 소켓으로 다시 잡을 때 새 id로 등록되므로, 끊긴 옛
  // id를 지워두지 않으면 명단에 유령 참가자가 계속 쌓인다 — 한 명이 실수로 여러 번
  // 새로고침하면 실제로는 4명인데 서버는 5명 완료로 잘못 세어서 battle로 조기 전환될 수
  // 있다(Opus 리뷰 Critical #2b, 실제로 재현됨).
  socket.on('disconnect', () => {
    joined.delete(socket.id);
    const before = cohort.participants.length;
    cohort.participants = cohort.participants.filter((p) => p.id !== socket.id);
    if (cohort.participants.length !== before) {
      broadcastProgress(io);
    }
  });
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/socket/session.createDone.test.mjs`
Expected: `session.createDone.test.mjs: all scenarios OK`까지 전부 출력, 에러 없음(마지막에 `session locks expected participant count to join-time headcount, not a fixed 5: OK` 줄도 포함).

- [ ] **Step 5: 다른 소켓 테스트가 여전히 통과하는지 확인**

Run: `node backend/socket/battleIntegration.test.mjs`
Expected: `battleIntegration.test.mjs: OK`. (이 파일은 `create:done`을 `admin:startSession` 이전, stage가 `idle`일 때 호출하기 때문에 `cohort.expectedParticipants` 검사 자체를 안 거친다 — `admin:nextStage()`로 직접 battle까지 넘기므로 이번 변경으로 깨지지 않는다. 혹시 실패하면 이 가정이 틀린 것이니 먼저 원인을 파악할 것.)

- [ ] **Step 6: 커밋**

```bash
git add backend/socket/session.js backend/socket/session.createDone.test.mjs
git commit -m "feat: 참가 인원을 세션 시작 시점 접속 인원으로 동적으로 고정"
```

---

### Task 2: 클라이언트 — 참가자 화면이 접속 시 participant:join 전송

**Files:**
- Modify: `frontend/src/app.js` (전체 — 아래 Step 1 코드가 최종 내용)
- Modify: `frontend/src/screens/create.js:14`

**Interfaces:**
- Consumes: Task 1이 정의한 소켓 이벤트 `participant:join`(payload 없음)
- Produces: 없음 (최종 소비자)

이 태스크는 브라우저 전용 코드라 Node에서 import/테스트할 수 없다(레포에 프론트엔드 빌드/테스트 도구가 없음 — `shapes/weaponRenderer.js`가 Konva를 주입받는 것과 같은 이유). 자동 테스트 대신 코드 정확성을 직접 검토하고, 이 플랜의 최종 리뷰 단계에서 Playwright로 라이브 검증한다.

- [ ] **Step 1: `app.js`에 참가자 접속 신호 추가**

`frontend/src/app.js` 전체를 아래 내용으로 교체한다:

```js
import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';

import { state } from './state.js';
import { LearnScreen } from './screens/learn.js';
import { CreateScreen } from './screens/create.js';
import { BattleScreen } from './screens/battle.js';
import { ResultScreen } from './screens/result.js';
import { ThanksScreen } from './screens/thanks.js';

const html = htm.bind(h);

const SCREENS = {
  learn: LearnScreen,
  create: CreateScreen,
  battle: BattleScreen,
  result: ResultScreen,
  thanks: ThanksScreen,
};

function App() {
  const [stage, setStage] = useState('learn');
  const [socket] = useState(() => io());

  useEffect(() => {
    socket.on('stage:change', setStage);
    return () => socket.off('stage:change', setStage);
  }, [socket]);

  useEffect(() => {
    // 서버는 "누가 참가자 화면에 접속해 있는지"를 이 신호로만 안다(관리자/공용화면도 같은
    // 서버에 소켓으로 접속하므로 접속 자체로는 구분이 안 됨) — admin:startSession 시점에
    // 이 신호를 보낸 소켓 수가 그 세션의 목표 인원으로 고정된다(backend/socket/session.js
    // 참고). 네트워크가 끊겼다 재연결되는 경우에도 다시 등록되도록 'connect'에 건다.
    function join() {
      socket.emit('participant:join');
    }
    socket.on('connect', join);
    if (socket.connected) join();
    return () => socket.off('connect', join);
  }, [socket]);

  const Screen = SCREENS[stage] ?? LearnScreen;
  return html`<${Screen} socket=${socket} state=${state} />`;
}

render(html`<${App} />`, document.getElementById('app'));
```

- [ ] **Step 2: `create.js`의 초기 진행률 fallback에서 하드코딩된 5 제거**

`frontend/src/screens/create.js` 14번째 줄:

```js
  const [progress, setProgress] = useState({ done: 0, total: 5 });
```

를 아래로 바꾼다:

```js
  const [progress, setProgress] = useState({ done: 0, total: 0 });
```

(참고: 이 값은 첫 `create:progress` 이벤트가 도착하기 전 잠깐 보이는 기본값일 뿐이다 — 참가자가 실제로 waiting 화면을 보는 시점엔 이미 `create:done`을 보낸 뒤라 서버로부터 정확한 total을 받은 상태다.)

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/app.js frontend/src/screens/create.js
git commit -m "feat: 참가자 화면 접속 시 participant:join 전송"
```

---

### Task 3: 스폰 지점 / 캐릭터를 8개까지 확장

**Files:**
- Modify: `backend/lib/battleMap.js`
- Modify: `backend/socket/battle.js:4`
- Modify: `frontend/src/screens/battle.js:14-17`
- Create: `backend/socket/battle.headroom.test.mjs`

**Interfaces:**
- Consumes: `startBattleRoom(io, participants, options)` — Task 1 이전부터 이미 `battle.js`에 존재하는 함수, 이 태스크는 내부 배열만 늘린다(시그니처 변경 없음)
- Produces: 없음 (배열 확장이 전부)

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/socket/battle.headroom.test.mjs` 파일을 새로 만든다:

```js
import assert from 'node:assert';
import { startBattleRoom, getBattleRoom, stopBattleRoom } from './battle.js';
import { SPAWN_POINTS } from '../lib/battleMap.js';

// 실제 예상 인원은 3~6명이지만, 스폰 지점/캐릭터는 8명까지 여유를 두기로 했다
// (2026-08-05 참가 인원 유동화 설계 문서) — 8명이 참가해도 스폰 좌표와 캐릭터가 겹치면
// 안 된다는 걸 직접 확인한다.
const io = { emit: () => {}, to: () => ({ emit: () => {} }) };

const participants = Array.from({ length: 8 }, (_, i) => ({ id: `h${i + 1}`, weapon: { damage: 1000 } }));
startBattleRoom(io, participants);

const room = getBattleRoom();
assert.strictEqual(Object.keys(room.players).length, 8, '8명 전원이 battle room에 등록되어야 함');

const players = Object.values(room.players);
const spawnKeys = new Set(players.map((p) => `${p.x},${p.y}`));
assert.strictEqual(
  spawnKeys.size,
  8,
  `8명의 스폰 좌표가 모두 달라야 함(SPAWN_POINTS가 최소 8개 필요), 실제 서로 다른 좌표 수 ${spawnKeys.size}`,
);

const characterIds = new Set(players.map((p) => p.characterId));
assert.strictEqual(
  characterIds.size,
  8,
  `8명의 캐릭터 id가 모두 달라야 함(CHARACTER_IDS가 최소 8개 필요), 실제 서로 다른 id 수 ${characterIds.size}`,
);

assert.ok(SPAWN_POINTS.length >= 8, 'SPAWN_POINTS는 최소 8개여야 함');

stopBattleRoom();
console.log('battle.headroom.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/socket/battle.headroom.test.mjs`
Expected: `spawnKeys.size`/`characterIds.size`가 5 또는 6에서 멈춰서(현재 배열이 5개/6개뿐이라 8명 중 나머지는 `i % length`로 앞의 좌표/id를 재사용함) `AssertionError`로 실패.

- [ ] **Step 3: `SPAWN_POINTS`를 8개로 확장**

`backend/lib/battleMap.js`의 `SPAWN_POINTS` 배열 전체를 아래로 교체한다:

```js
export const SPAWN_POINTS = [
  { x: 60, y: 60 },
  { x: 740, y: 60 },
  { x: 60, y: 540 },
  { x: 740, y: 540 },
  { x: 400, y: 550 },
  { x: 400, y: 60 },
  { x: 60, y: 300 },
  { x: 740, y: 300 },
];
```

- [ ] **Step 4: `CHARACTER_IDS`를 8개로 확장**

`backend/socket/battle.js` 4번째 줄:

```js
const CHARACTER_IDS = ['char1', 'char2', 'char3', 'char4', 'char5', 'char6'];
```

를 아래로 바꾼다:

```js
const CHARACTER_IDS = ['char1', 'char2', 'char3', 'char4', 'char5', 'char6', 'char7', 'char8'];
```

- [ ] **Step 5: 테스트 실행해서 통과 확인**

Run: `node backend/socket/battle.headroom.test.mjs`
Expected: `battle.headroom.test.mjs: OK`

- [ ] **Step 6: 다른 socket/lib 테스트가 여전히 통과하는지 확인**

Run:
```bash
for f in backend/lib/*.test.mjs backend/socket/*.test.mjs; do
  echo "== $f =="; node "$f" || echo "FAILED: $f";
done
```
Expected: 모든 파일이 `FAILED` 없이 각자의 `OK` 로그로 끝남.

- [ ] **Step 7: 프론트엔드 `CHARACTER_COLORS`도 8개로 확장**

`frontend/src/screens/battle.js` 14~17번째 줄:

```js
const CHARACTER_COLORS = {
  char1: '#e74c3c', char2: '#3498db', char3: '#2ecc71',
  char4: '#f1c40f', char5: '#9b59b6', char6: '#e67e22',
};
```

를 아래로 바꾼다:

```js
const CHARACTER_COLORS = {
  char1: '#e74c3c', char2: '#3498db', char3: '#2ecc71',
  char4: '#f1c40f', char5: '#9b59b6', char6: '#e67e22',
  char7: '#1abc9c', char8: '#34495e',
};
```

(이 파일은 브라우저 전용이라 Node 테스트 대상이 아니다 — Task 2와 동일한 이유. 최종 리뷰의 Playwright 라이브 검증에서 8명 대전 화면을 확인한다.)

- [ ] **Step 8: 커밋**

```bash
git add backend/lib/battleMap.js backend/socket/battle.js backend/socket/battle.headroom.test.mjs frontend/src/screens/battle.js
git commit -m "feat: 스폰 지점/캐릭터를 8명까지 지원하도록 확장"
```

---

## 완료 후 최종 리뷰

3개 태스크 커밋이 모두 끝나면, 이 세션에서 계속 써온 패턴대로 Opus 모델로 최종 리뷰를 돌린다:

1. `Agent` 도구로 `model: opus`, 이 브랜치(`shape-battle`)의 최근 3개 커밋 diff를 대상으로 코드 리뷰 디스패치.
2. Critical/Important 발견 사항 전부 수정 — 각 수정은 `git stash`로 수정 전 코드에 대해 RED 재현 테스트를 만들어 실제 버그였음을 확인한 뒤 고칠 것.
3. 서버(`MOCK_AI=true node server.js`, `backend/` 디렉터리에서 실행)를 띄우고 Playwright로:
   - 3명짜리 세션(참가자 3명 접속 → 세션 시작 → 3명 모두 무기 제작 완료)이 5명을 기다리지 않고 battle로 정상 전환되는지
   - 8명짜리 battle room에서 캐릭터/스폰이 겹치지 않고 정상 렌더링되는지
   를 실측으로 확인.
4. Minor/보류 항목은 이 계획 문서(`docs/superpowers/plans/2026-08-05-dynamic-participant-count.md`) 맨 아래에 "## 구현 후 최종 리뷰(Opus) 반영 사항" 섹션을 추가해 기록.
5. 작업 종료 후 `.playwright-mcp/` 스크린샷 아티팩트 정리, 서버 프로세스 종료, `git status` 클린 확인.
