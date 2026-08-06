# 공용화면 미니맵+리더보드 & 참가자 이름 수집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참가자 화면 맨 처음에 이름 입력을 추가하고, 그 이름과 실시간 캐릭터 위치/점수를 공용화면(전자칠판)에 미니맵+리더보드로 보여준다.

**Architecture:** 이름은 `participant:join`(인원수 집계, 서버가 신뢰하는 타이밍-critical 신호)과 완전히 분리된 별도 이벤트(`participant:name`)로 수집해 서버가 `cohort.participants`에 저장하고, `startBattleRoom`이 그걸 플레이어 상태에 실어 보낸다. 공용화면은 이미 전체 브로드캐스트되는 `battle:state`를 그대로 구독해서 맵(축소된 Konva 렌더)과 리더보드(DOM 목록)를 그린다 — 백엔드에 새 이벤트/room 분리가 필요 없다.

**Tech Stack:** Socket.io, Preact + htm(빌드 없음), Konva, `node:assert` 테스트.

## Global Constraints

- `participant:name`은 `participant:join`과 절대 합치지 않는다 — 이름 입력이 늦어져도 인원수 집계 타이밍에 영향을 주면 안 된다(과거 인원수 집계 어긋남 버그와 같은 부류의 사고 방지).
- 이름은 서버가 항상 재검증한다: 문자열이 아니면 무시, 앞뒤 공백 제거, 20자로 자름. 빈 값/미입력은 `null`로 취급.
- **`backend/socket/battle.js`(`startBattleRoom`의 플레이어 초기화 블록)는 근접/원거리 공격 시스템 작업이 동시에 수정 중인 파일이다 — Task 2는 그 작업이 먼저 병합된 뒤에 실행한다.** 이 계획의 Task 2 코드 블록은 지금(그 작업이 병합되기 전) 시점의 파일 내용을 기준으로 작성됐다 — 실행 시점에 이미 병합되어 내용이 달라져 있으면, 아래 예시와 똑같은 텍스트를 찾지 못할 수 있다. 그런 경우 `startBattleRoom`의 참가자별 플레이어 객체 리터럴 안에 `name: participant.name ?? null,` 한 줄만 추가하면 된다(다른 필드와 무관, 어디에 추가해도 상관없음).
- 공용화면(`frontend/admin/`)의 미니맵/리더보드는 참가자 화면(`frontend/src/screens/battle.js`)과 별개 파일이다 — 그 파일이 다른 작업으로 자주 바뀌는 중이므로 `CHARACTER_COLORS` 등을 공유 모듈로 빼지 않고 그대로 복제한다.
- 이 프로젝트는 빌드 스텝이 없다 — 새/수정 파일은 문법만 맞으면 된다.
- 프론트엔드(이름 입력 화면, 공용화면 미니맵/리더보드)는 자동화 테스트가 없다(이 프로젝트의 기존 관례) — `node --check` + 라이브 검증으로 확인한다.

---

### Task 1: 참가자 화면 — 이름 입력

**Files:**
- Create: `frontend/src/screens/name.js`
- Modify: `frontend/src/app.js`
- Modify: `frontend/style.css`

**Interfaces:**
- Consumes: 없음(백엔드 의존 없음 — `participant:name` emit은 서버에 리스너가 없어도 조용히 무시될 뿐 에러가 안 남).
- Produces: `NameScreen({onSubmit})` 컴포넌트. `App`이 이름을 안 넣은 동안(`name === null`) 이 화면을 단계와 무관하게 보여주고, 제출되면 `socket.emit('participant:name', name)`을 보낸다 — Task 2가 서버에서 이 이벤트를 받는다.

이 태스크는 프론트 화면이라 자동화 테스트가 없다 — 문법 검증 후 라이브 검증(Task 3과 함께 최종 확인)으로 넘어간다.

- [ ] **Step 1: `NameScreen` 작성**

`frontend/src/screens/name.js`를 새로 만든다:

```js
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

// 참가자 화면 맨 처음(단계와 무관하게) 뜨는 이름 입력 화면. 빈 값으로 제출해도 넘어갈 수
// 있다(건너뛰기와 같은 효과) — 서버가 어차피 trim/길이 제한으로 다시 검증하므로 여기선
// 자유롭게 입력받는다.
export function NameScreen({ onSubmit }) {
  const [name, setName] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(name);
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

- [ ] **Step 2: `App`이 이름 입력을 단계 라우팅보다 먼저 보여주도록 수정**

`frontend/src/app.js`를 아래 내용으로 전체 교체한다:

```js
import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
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
  learn: LearnScreen,
  create: CreateScreen,
  battle: BattleScreen,
  result: ResultScreen,
  thanks: ThanksScreen,
};

function App() {
  const [stage, setStage] = useState('learn');
  const [socket] = useState(() => io());
  // null이면 아직 이름을 안 넣은 상태 — 단계(stage)와 무관하게 이름 입력 화면을 먼저 보여준다.
  const [name, setName] = useState(null);

  useEffect(() => {
    socket.on('stage:change', setStage);
    return () => socket.off('stage:change', setStage);
  }, [socket]);

  useEffect(() => {
    // 서버는 "누가 참가자 화면에 접속해 있는지"를 이 신호로만 안다(관리자/공용화면도 같은
    // 서버에 소켓으로 접속하므로 접속 자체로는 구분이 안 됨) — admin:startSession 시점에
    // 이 신호를 보낸 소켓 수가 그 세션의 목표 인원으로 고정된다(backend/socket/session.js
    // 참고). 네트워크가 끊겼다 재연결되는 경우에도 다시 등록되도록 'connect'에 건다.
    // 이름 입력 여부와는 완전히 무관하게 항상 즉시 보낸다 — 이름 입력에 시간이 걸려서 이
    // 신호가 늦어지면 인원수 집계가 어긋나는 사고로 이어질 수 있다(예전에 실제로 겪은
    // 문제와 같은 부류).
    function join() {
      socket.emit('participant:join');
    }
    socket.on('connect', join);
    if (socket.connected) join();
    return () => socket.off('connect', join);
  }, [socket]);

  if (name === null) {
    return html`<${NameScreen} onSubmit=${(n) => { socket.emit('participant:name', n); setName(n); }} />`;
  }

  const Screen = SCREENS[stage] ?? LearnScreen;
  return html`<${Screen} socket=${socket} state=${state} />`;
}

render(html`<${App} />`, document.getElementById('app'));
```

- [ ] **Step 3: 최소 스타일 추가**

`frontend/style.css` 맨 끝에 추가한다:

```css
.name-screen {
  text-align: center;
  max-width: 24rem;
}

.name-screen input {
  font-size: 1.2rem;
  padding: 0.5rem;
  width: 100%;
  margin: 1rem 0;
  box-sizing: border-box;
}

.name-screen button {
  font-size: 1.2rem;
  padding: 0.5rem 1.5rem;
}
```

- [ ] **Step 4: 문법 검증**

Run: `node --check frontend/src/app.js && node --check frontend/src/screens/name.js`
Expected: 조용히 exit code 0.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/screens/name.js frontend/src/app.js frontend/style.css
git commit -m "feat: 참가자 화면에 이름 입력 화면 추가"
```

---

### Task 2: 서버 — 이름 저장 + 대전 플레이어 상태에 반영

**Files:**
- Modify: `backend/socket/session.js`
- Modify: `backend/socket/battle.js`
- Modify: `backend/socket/battleIntegration.test.mjs`

**Interfaces:**
- Consumes: Task 1이 보내는 `participant:name` 이벤트(문자열 payload).
- Produces: `startBattleRoom`이 만드는 각 플레이어가 `name`(문자열 또는 `null`)을 갖는다 — `battle:state`를 통해 Task 3(공용화면)이 이 필드를 읽는다.

**⚠️ 실행 전 확인**: `backend/socket/battle.js`는 근접/원거리 공격 시스템 작업이 동시에 수정 중이다. 그 작업이 먼저 병합됐는지 확인하고(`git log`로 관련 커밋이 `shape-battle`에 있는지), 안 됐다면 병합을 먼저 기다린다.

- [ ] **Step 1: 회귀 테스트 작성(RED)**

`backend/socket/battleIntegration.test.mjs`에서 소켓 등록 루프 바로 다음, `create:done` 루프 시작 전에 새 코드를 삽입한다:

기존:
```js
for (let i = 1; i <= 5; i += 1) {
  registerSessionHandlers(io, makeSocket(`p${i}`));
}

for (let i = 1; i <= 5; i += 1) {
  const parts = i === 1 ? [{ id: 'x1', shapeId: 'triangle', x: 100, y: 100, rotation: 0, scale: 1 }] : [];
  handlers[`p${i}`]['create:done']({ damage: 1000 * i, parts });
}
```

새로 교체:
```js
for (let i = 1; i <= 5; i += 1) {
  registerSessionHandlers(io, makeSocket(`p${i}`));
}

// participant:name — 이름을 먼저 보내두면 이후 create:done 때 참가자 엔트리에 반영된다.
// trim/길이 제한(20자)/비문자열 방어를 함께 확인한다 — 클라이언트 제공값을 그대로 믿지
// 않는 이 프로젝트의 기존 원칙(weaponDamage clamp 등)과 같은 이유. p4/p5는 아예 안 보내서
// "이름을 안 넣은 참가자는 null" 경로도 같이 확인한다.
handlers.p1['participant:name']('  민수  ');
handlers.p2['participant:name']('가'.repeat(50));
handlers.p3['participant:name'](12345);

for (let i = 1; i <= 5; i += 1) {
  const parts = i === 1 ? [{ id: 'x1', shapeId: 'triangle', x: 100, y: 100, rotation: 0, scale: 1 }] : [];
  handlers[`p${i}`]['create:done']({ damage: 1000 * i, parts });
}
```

`assert.strictEqual(room.status, 'active');` 바로 다음(같은 블록 안)에 새 검증을 추가한다:

기존:
```js
assert.strictEqual(room.status, 'active');
console.log('battle room initialized from participants: OK');
```

새로 교체:
```js
assert.strictEqual(room.status, 'active');
console.log('battle room initialized from participants: OK');

assert.strictEqual(room.players.p1.name, '민수', '앞뒤 공백은 trim되어야 함');
assert.strictEqual(room.players.p2.name, '가'.repeat(20), '20자를 넘는 이름은 잘려야 함');
assert.strictEqual(room.players.p3.name, null, '문자열이 아닌 이름은 무시되고 null이어야 함');
assert.strictEqual(room.players.p4.name, null, '이름을 아예 안 보낸 참가자는 null');
console.log('participant names flow from participant:name through create:done into battleRoom.players: OK');
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node backend/socket/battleIntegration.test.mjs`
Expected: FAIL — `handlers.p1['participant:name']`가 아직 등록되지 않아 `TypeError: handlers.p1['participant:name'] is not a function`.

- [ ] **Step 3: `session.js` 수정**

`backend/socket/session.js`에서 `joined` Set 선언 바로 다음을 찾아 교체한다:

기존:
```js
const joined = new Set();
```

새로 교체:
```js
const joined = new Set();

// participant:name으로 받은 이름을 socket.id 기준으로 잠깐 보관해둔다 — 이름이 무기 완성
// (create:done)보다 먼저 도착하므로, 그때까지 cohort.participants 엔트리가 아직 없어도
// 저장해둘 곳이 필요하다. create:done 시점에 이 값을 참가자 엔트리에 합쳐 넣는다.
const participantNames = new Map();
```

`socket.on('participant:join', ...)` 핸들러 바로 다음에 새 핸들러를 추가한다:

기존:
```js
  // 참가자 화면만 보내는 신호 — 관리자/공용화면은 이 이벤트를 보내지 않으므로 joined에 안 잡힌다.
  socket.on('participant:join', () => {
    joined.add(socket.id);
  });
```

새로 교체:
```js
  // 참가자 화면만 보내는 신호 — 관리자/공용화면은 이 이벤트를 보내지 않으므로 joined에 안 잡힌다.
  socket.on('participant:join', () => {
    joined.add(socket.id);
  });

  // 참가자 이름 — 인원수 집계(participant:join)와 완전히 분리된 별도 신호다. 이름 입력에
  // 시간이 걸려도 인원수 집계 타이밍에 영향을 주면 안 되므로 절대 합치지 않는다. 클라이언트가
  // 보낸 값을 그대로 믿지 않고 문자열인지 확인한 뒤 trim + 20자로 제한한다.
  socket.on('participant:name', (name) => {
    const safeName = typeof name === 'string' ? name.trim().slice(0, 20) : '';
    participantNames.set(socket.id, safeName);
  });
```

`create:done` 핸들러를 찾아 교체한다:

기존:
```js
  socket.on('create:done', (weapon) => {
    const existing = cohort.participants.find((p) => p.id === socket.id);
    if (existing) {
      existing.done = true;
      existing.weapon = weapon;
    } else {
      cohort.participants.push({ id: socket.id, done: true, weapon });
    }
    broadcastProgress(io);
```

새로 교체:
```js
  socket.on('create:done', (weapon) => {
    // 빈 문자열(이름을 안 넣었거나 participant:name을 아예 안 보낸 경우 모두)은 null로
    // 통일한다 — 화면 쪽에서 "이름 없음"을 한 가지 값으로만 처리하면 되게.
    const name = participantNames.get(socket.id) || null;
    const existing = cohort.participants.find((p) => p.id === socket.id);
    if (existing) {
      existing.done = true;
      existing.weapon = weapon;
      existing.name = name;
    } else {
      cohort.participants.push({ id: socket.id, done: true, weapon, name });
    }
    broadcastProgress(io);
```

`disconnect` 핸들러를 찾아 정리 코드를 추가한다:

기존:
```js
  socket.on('disconnect', () => {
    joined.delete(socket.id);
    const before = cohort.participants.length;
```

새로 교체:
```js
  socket.on('disconnect', () => {
    joined.delete(socket.id);
    participantNames.delete(socket.id);
    const before = cohort.participants.length;
```

- [ ] **Step 4: `battle.js` 수정**

`backend/socket/battle.js`의 참가자별 플레이어 객체 리터럴에 `name` 필드를 추가한다(정확한 위치는 이 파일의 현재 상태에 따라 다를 수 있다 — 위 Global Constraints의 안내를 참고). 지금(이 계획 작성 시점) 기준 원래 블록:

기존:
```js
    players[participant.id] = {
      id: participant.id,
      characterId: CHARACTER_IDS[i % CHARACTER_IDS.length],
      x: spawn.x,
      y: spawn.y,
```

새로 교체(맨 위에 한 줄 추가):
```js
    players[participant.id] = {
      id: participant.id,
      name: participant.name ?? null,
      characterId: CHARACTER_IDS[i % CHARACTER_IDS.length],
      x: spawn.x,
      y: spawn.y,
```

- [ ] **Step 5: 테스트 실행 → 통과 확인 + 전체 회귀**

Run:
```bash
node backend/socket/battleIntegration.test.mjs
for f in shapes/*.test.mjs backend/lib/*.test.mjs backend/routes/*.test.mjs backend/socket/*.test.mjs; do node "$f" || echo "FAILED: $f"; done
```
Expected: 둘 다 `FAILED:` 없이 전부 통과.

- [ ] **Step 6: 커밋**

```bash
git add backend/socket/session.js backend/socket/battle.js backend/socket/battleIntegration.test.mjs
git commit -m "feat: 참가자 이름을 저장해 대전 플레이어 상태에 반영"
```

---

### Task 3: 공용화면 — 미니맵 + 리더보드

**Files:**
- Create: `frontend/admin/BattleMapView.js`
- Modify: `frontend/admin/display.js`
- Modify: `frontend/admin/display.html`
- Modify: `frontend/admin/display.css`

**Interfaces:**
- Consumes: Task 2가 `battle:state`로 보내는 `room.players[id].name`. `shapes/battleMap.js`의 `DEFAULT_MAP`(이미 존재).
- Produces: `BattleMapView({socket})` 컴포넌트 — `display.js`가 `stage === 'battle'`일 때 렌더링한다.

이 태스크는 프론트 Konva 렌더링이라 자동화 테스트가 없다 — 문법 검증 + 라이브 검증으로 확인한다.

- [ ] **Step 1: `BattleMapView.js` 작성**

`frontend/admin/BattleMapView.js`를 새로 만든다:

```js
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import Konva from 'konva';
import { DEFAULT_MAP } from '../../shapes/battleMap.js';

const html = htm.bind(h);

// 공용화면 전용 고정 크기 — 월드(DEFAULT_MAP.arenaSize)와 같은 4:3 비율로 축소해서 보여준다.
// 참가자 화면의 뷰포트(800x600, 카메라 추적용)와는 다른 목적이라 별도 상수를 둔다 — 여긴
// 카메라 없이 맵 전체를 한 번에 보여주는 관전자 시점이다.
const DISPLAY_MAP_SIZE = { width: 960, height: 720 };
const SCALE = DISPLAY_MAP_SIZE.width / DEFAULT_MAP.arenaSize.width;
const CHARACTER_RADIUS = 6; // 미니맵이라 참가자 화면(20)보다 작게 그린다

// frontend/src/screens/battle.js의 CHARACTER_COLORS와 같은 값 — 공유 모듈로 빼지 않고 그대로
// 복제했다(그 파일이 다른 작업으로 자주 바뀌는 중이라 충돌을 피하려는 목적, 8개 고정값이라
// 중복돼도 드리프트 위험이 낮음).
const CHARACTER_COLORS = {
  char1: '#e74c3c', char2: '#3498db', char3: '#2ecc71',
  char4: '#f1c40f', char5: '#9b59b6', char6: '#e67e22',
  char7: '#1abc9c', char8: '#34495e',
};

function characterLabel(characterId) {
  return `캐릭터 ${(characterId ?? '').replace('char', '')}`;
}

export function BattleMapView({ socket }) {
  const containerRef = useRef(null);
  const layerRef = useRef(null);
  const nodesRef = useRef({});
  const [players, setPlayers] = useState({});

  useEffect(() => {
    const stage = new Konva.Stage({
      container: containerRef.current,
      width: DISPLAY_MAP_SIZE.width,
      height: DISPLAY_MAP_SIZE.height,
    });
    const layer = new Konva.Layer();
    stage.add(layer);
    layerRef.current = layer;

    // 배경 이미지 — 참가자 화면과 같은 이유로, 없거나 로드 실패해도 조용히 어두운 배경으로
    // 폴백한다(게임/화면이 깨지면 안 됨).
    let cancelled = false;
    const bgImage = new Image();
    bgImage.onload = () => {
      if (cancelled) return;
      const bg = new Konva.Image({
        image: bgImage, x: 0, y: 0,
        width: DISPLAY_MAP_SIZE.width, height: DISPLAY_MAP_SIZE.height,
      });
      layer.add(bg);
      bg.moveToBottom();
      layer.draw();
    };
    bgImage.onerror = () => {};
    bgImage.src = DEFAULT_MAP.imagePath;

    return () => {
      cancelled = true;
      stage.destroy();
    };
  }, []);

  useEffect(() => {
    function onState(room) {
      const layer = layerRef.current;
      if (!layer) return;

      Object.values(room.players).forEach((p) => {
        let node = nodesRef.current[p.id];
        if (!node) {
          node = new Konva.Circle({
            radius: CHARACTER_RADIUS,
            fill: CHARACTER_COLORS[p.characterId] ?? '#999',
          });
          layer.add(node);
          nodesRef.current[p.id] = node;
        }
        node.x(p.x * SCALE);
        node.y(p.y * SCALE);
        node.opacity(p.connected !== false ? 1 : 0.2);
      });

      layer.draw();
      // 리더보드는 Konva가 아니라 일반 DOM으로 그린다 — 텍스트 목록이라 캔버스를 쓸 이유가
      // 없고, 정렬된 목록을 매번 다시 그리는 게 DOM이 훨씬 간단하다.
      setPlayers(room.players);
    }
    socket.on('battle:state', onState);
    return () => socket.off('battle:state', onState);
  }, [socket]);

  const sorted = Object.values(players).sort((a, b) => b.score - a.score);

  return html`
    <div class="battle-map-view">
      <div class="battle-map-canvas" ref=${containerRef}></div>
      <ol class="leaderboard">
        ${sorted.map((p) => html`
          <li key=${p.id}>
            <span class="leaderboard-swatch" style=${{ background: CHARACTER_COLORS[p.characterId] ?? '#999' }}></span>
            <span class="leaderboard-name">${p.name || characterLabel(p.characterId)}</span>
            <span class="leaderboard-score">${p.score}</span>
          </li>
        `)}
      </ol>
    </div>
  `;
}
```

- [ ] **Step 2: `display.js`가 `battle` 단계에 이 컴포넌트를 연결하도록 수정**

`frontend/admin/display.js`를 아래 내용으로 전체 교체한다:

```js
import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { io } from 'socket.io-client';
import { BattleMapView } from './BattleMapView.js';

const html = htm.bind(h);

// 전자칠판 등에 팝업으로 띄워두는 공용 화면. admin.js의 "공용 화면 열기" 버튼으로 연다.
// learn 단계는 슬라이드를 크게 보여주고, battle 단계는 미니맵+리더보드, 그 외는 안내 문구만 표시한다.
const STAGE_MESSAGES = {
  idle: '세션 시작을 기다리는 중입니다',
  create: '각자 화면에서 무기를 제작 중입니다',
  result: '결과를 확인하는 중입니다',
  thanks: '체험을 마쳐주셔서 감사합니다',
};

function DisplayApp() {
  const [stage, setStage] = useState('idle');
  const [slides, setSlides] = useState([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const [socket] = useState(() => io());

  useEffect(() => {
    socket.on('stage:change', setStage);
    socket.on('learn:slide', setSlideIndex);
    return () => socket.disconnect();
  }, [socket]);

  useEffect(() => {
    fetch('../src/content/shapes-slides.json')
      .then((res) => res.json())
      .then(setSlides);
  }, []);

  if (stage === 'learn') {
    const slide = slides[slideIndex];
    if (!slide) return html`<div class="display-wait">슬라이드 준비 중...</div>`;
    return html`
      <div class="display-slide">
        <h1>${slide.title}</h1>
        <img src=${slide.image} alt=${slide.title} />
        <p>${slide.description}</p>
      </div>
    `;
  }

  if (stage === 'battle') {
    return html`<${BattleMapView} socket=${socket} />`;
  }

  return html`<div class="display-wait">${STAGE_MESSAGES[stage] ?? stage}</div>`;
}

render(html`<${DisplayApp} />`, document.getElementById('display-app'));
```

- [ ] **Step 3: `display.html`에 Konva 추가**

`frontend/admin/display.html`의 importmap을 찾아 교체한다:

기존:
```html
  <script type="importmap">
  {
    "imports": {
      "preact": "https://esm.sh/preact@10",
      "preact/hooks": "https://esm.sh/preact@10/hooks",
      "htm": "https://esm.sh/htm@3",
      "socket.io-client": "https://esm.sh/socket.io-client@4"
    }
  }
  </script>
```

새로 교체:
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

- [ ] **Step 4: `display.css`에 레이아웃 스타일 추가**

`frontend/admin/display.css` 맨 끝에 추가한다:

```css
.battle-map-view {
  display: flex;
  align-items: flex-start;
  gap: 2rem;
}

.battle-map-canvas {
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

.leaderboard {
  list-style: none;
  margin: 0;
  padding: 0;
  min-width: 300px;
  text-align: left;
}

.leaderboard li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 1.5rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.leaderboard-swatch {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  flex-shrink: 0;
}

.leaderboard-name {
  flex: 1;
}

.leaderboard-score {
  font-weight: bold;
}
```

- [ ] **Step 5: 문법 검증 + 전체 백엔드 회귀(공유 모듈이 안 깨졌는지 재확인)**

Run:
```bash
node --check frontend/admin/display.js
node --check frontend/admin/BattleMapView.js
for f in shapes/*.test.mjs backend/lib/*.test.mjs backend/routes/*.test.mjs backend/socket/*.test.mjs; do node "$f" || echo "FAILED: $f"; done
```
Expected: 문법 검증은 조용히 exit code 0, 회귀 루프는 `FAILED:` 없이 전부 통과.

- [ ] **Step 6: 커밋**

```bash
git add frontend/admin/BattleMapView.js frontend/admin/display.js frontend/admin/display.html frontend/admin/display.css
git commit -m "feat: 공용화면에 대전 미니맵과 점수 리더보드 추가"
```

- [ ] **Step 7: 사용자 직접 확인용 체크리스트**

Playwright 등으로 자동 확인하지 않는다(라이브 검증은 사용자가 직접 브라우저에서 확인). 로컬 서버를 띄우고 관리자 화면에서 "공용 화면 열기"로 공용화면 탭을 연 뒤, 참가자 몇 명을 이름을 넣고/안 넣고 섞어서 진행시켜 대전 단계까지 보내고 다음을 확인해달라고 안내한다:

1. **미니맵**: 배경 이미지가 축소되어 보이고, 참가자 수만큼 색상 원이 실제 캐릭터 위치와 같은 상대적 배치로 움직이는지.
2. **리더보드**: 점수 내림차순으로 정렬되어 있는지, 이름을 넣은 참가자는 이름이, 안 넣은 참가자는 "캐릭터 N"이 보이는지, 전투 중 점수가 바뀌면 순위가 실시간으로 다시 정렬되는지.
3. 브라우저 콘솔에 에러가 없는지.

문제가 있으면 앞 태스크로 돌아가 수정한다.

---

## Self-Review 메모 (계획 작성자 기록)

- **스펙 커버리지**: 이름 수집(participant:join과 분리, trim/길이 제한) — Task 1, 2 / 서버 저장·전달(session.js→battle.js) — Task 2 / 공용화면 미니맵(Task 3) / 리더보드(이름 폴백 포함, Task 3) / 스코프 제외 항목(계획에 투사체 미리보기 표시, 순위 변동 애니메이션, 이름 내용 검증, 다른 단계 공용화면 변경 관련 태스크 없음 — Global Constraints/스펙 그대로) — 스펙의 모든 섹션이 태스크로 커버됨.
- **타입/이름 일관성**: `participant:name`(이벤트명), `name`(session.js의 `cohort.participants`/battle.js의 player 필드/battle:state 페이로드 전체에서 동일), `DISPLAY_MAP_SIZE`/`SCALE`/`CHARACTER_COLORS`(Task 3 내부에서 일관) — 교차 확인 완료.
- **파일 충돌 위험**: `backend/socket/battle.js`가 근접/원거리 작업과 겹치는 유일한 지점 — Task 2에 명시적 경고와 대체 지침을 넣어뒀다.
- **라이브 검증**: Task 3의 Step 7이 이 계획의 유일한 라이브 검증 지점이다. 계획 완료 후 사용자가 요청하면 Opus 최종 리뷰를 별도로 진행한다.
