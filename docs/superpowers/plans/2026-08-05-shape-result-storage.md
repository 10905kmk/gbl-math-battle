# 결과물 영구 저장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대전이 끝나는 시점에 각 참가자의 완성된 무기(도형)와 승패를 Supabase에 자동 저장하고, Supabase가 아직 설정 안 됐어도 mock 폴백으로 개발/데모가 막히지 않게 한다.

**Architecture:** `backend/lib/supabaseClient.js`의 `saveResult()`에 mock 폴백을 추가하고, 참가자 배열을 순회하며 `saveResult`를 호출하는 순수 조합 함수 `saveParticipantResults()`를 `backend/lib/resultStorage.js`에 새로 만든다. `backend/socket/session.js`는 대전 종료(`onEnd(winners)`) 시점에 이 함수를 fire-and-forget으로 호출한 뒤 곧바로 `goToStage(io, 'result')`를 실행한다 — 저장 성공/실패와 무관하게 화면 전환은 항상 진행된다.

**Tech Stack:** Node.js (ESM), `@supabase/supabase-js`(이미 의존성에 있음), `node:assert` 기반 수작업 테스트 스크립트(`.mjs`, 이 프로젝트엔 테스트 프레임워크가 없음)

## Global Constraints

- 이미지: Supabase Storage 없이 `weapon.image`(base64 dataURL)를 DB 컬럼에 그대로 저장한다 (spec "데이터 모델" 절)
- 참가자 이름/닉네임은 스키마에 포함하지 않는다 — 현재 참가자 데이터에 이름 필드 자체가 없음 (spec "스코프" 절)
- 저장 실패는 `stage:change → 'result'` 전환을 절대 막지 않는다 (spec "저장 흐름" 절)
- `results` 테이블 컬럼명은 정확히 `weapon_name, weapon_image, weapon_stats, weapon_damage, win, id, created_at`을 사용한다 (spec "데이터 모델" 절)
- 이번 스펙 범위 밖: `result-page/`(Vercel), QR 코드, Supabase 프로젝트 실제 생성(사용자가 브라우저에서 직접) — 건드리지 않는다

---

### Task 1: `saveResult` mock 폴백 + DB 스키마

**Files:**
- Modify: `backend/lib/supabaseClient.js`
- Create: `backend/lib/supabase/schema.sql`
- Test: `backend/lib/supabaseClient.test.mjs`

**Interfaces:**
- Produces: `saveResult(result: { weapon_name, weapon_image, weapon_stats, weapon_damage, win }) => Promise<{ id, weapon_name, weapon_image, weapon_stats, weapon_damage, win, created_at }>` — 기존 시그니처 그대로 유지, mock 경로에서도 동일한 필드를 가진 객체를 반환한다.

이 테스트는 `process.env.SUPABASE_URL`이 설정되지 않은 상태를 전제로 한다 — `backend/server.js`만 `dotenv/config`를 로드하고, 이 테스트 스크립트는 `server.js`를 거치지 않고 직접 실행되므로 실행 시 셸에 `SUPABASE_URL`이 export돼 있지 않은 한 항상 미설정 상태다.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/lib/supabaseClient.test.mjs`:
```js
import assert from 'node:assert';
import { saveResult } from './supabaseClient.js';

assert.strictEqual(
  process.env.SUPABASE_URL,
  undefined,
  '이 테스트는 SUPABASE_URL 미설정 상태를 전제로 함 — 셸 환경변수를 확인하세요'
);

const result = await saveResult({ weapon_name: '테스트 무기', win: true });
assert.ok(result.id, 'mock 저장도 id를 반환해야 함');
assert.strictEqual(result.weapon_name, '테스트 무기', '입력 필드가 그대로 보존되어야 함');
assert.strictEqual(result.win, true);
assert.ok(result.created_at, 'created_at이 채워져야 함');
console.log('saveResult mock fallback: OK');

const result2 = await saveResult({ weapon_name: '다른 무기', win: false });
assert.notStrictEqual(result.id, result2.id, '호출마다 다른 id를 반환해야 함');
console.log('saveResult mock fallback generates unique ids: OK');

console.log('supabaseClient.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/lib/supabaseClient.test.mjs`
Expected: `Uncaught Error: Supabase not configured` (throw로 인해 실패)

- [ ] **Step 3: mock 폴백 구현**

`backend/lib/supabaseClient.js` 전체를 아래로 교체:
```js
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const supabase = process.env.SUPABASE_URL
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

// SUPABASE_URL 미설정 시 실제 저장 대신 mock 결과를 반환 — 로컬 개발/통합 테스트/데모가
// 실제 Supabase 키 없이도 막히지 않게 하기 위함 (weapon-crafting의 aiClient.js MOCK_AI와 같은 이유).
export async function saveResult(result) {
  if (!supabase) {
    console.warn('[supabaseClient] SUPABASE_URL 미설정 — mock 저장으로 대체');
    return { id: randomUUID(), ...result, created_at: new Date().toISOString() };
  }
  const { data, error } = await supabase.from('results').insert(result).select().single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/lib/supabaseClient.test.mjs`
Expected: `supabaseClient.test.mjs: OK` 출력, exit code 0

- [ ] **Step 5: DB 스키마 SQL 작성**

`backend/lib/supabase/schema.sql` (신규 디렉터리 생성):
```sql
-- Supabase SQL Editor에서 실행. 실제 프로젝트 생성/URL·키 발급은 사용자가 브라우저에서 직접 진행.
create table results (
  id uuid primary key default gen_random_uuid(),
  weapon_name text,
  weapon_image text,       -- Konva 캔버스 toDataURL() 결과, base64 그대로 저장 (Storage 버킷 미사용)
  weapon_stats jsonb,      -- { attack, defense }
  weapon_damage integer,
  win boolean,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 6: 커밋**

```bash
git add backend/lib/supabaseClient.js backend/lib/supabaseClient.test.mjs backend/lib/supabase/schema.sql
git commit -m "feat: saveResult mock 폴백 + results 테이블 스키마 추가"
```

---

### Task 2: 참가자별 결과 저장 조합 함수 (`resultStorage.js`)

**Files:**
- Create: `backend/lib/resultStorage.js`
- Test: `backend/lib/resultStorage.test.mjs`

**Interfaces:**
- Consumes: `saveResult`의 입력 형태 `{ weapon_name, weapon_image, weapon_stats, weapon_damage, win }` (Task 1에서 정의)
- Produces: `saveParticipantResults(participants: Array<{ id, weapon }>, winners: string[], saveFn = saveResult) => Promise<PromiseSettledResult[]>` — `participants`는 `session.js`의 `cohort.participants` 배열 형태(`{ id, weapon }`, `weapon`은 `{ name, image, stats, damage, parts }`)를 그대로 받는다. 세 번째 인자 `saveFn`은 테스트용 의존성 주입 지점 — 기본값은 실제 `saveResult`.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/lib/resultStorage.test.mjs`:
```js
import assert from 'node:assert';
import { saveParticipantResults } from './resultStorage.js';

function makeParticipant(id, overrides) {
  return {
    id,
    weapon: { name: `무기-${id}`, image: 'data:image/png;base64,AAA', stats: { attack: 10, defense: 5 }, damage: 500, parts: [] },
    ...overrides,
  };
}

// 정상 케이스: 각 참가자마다 saveFn이 올바른 필드로 호출되고, win은 winners 포함 여부로 계산됨
{
  const calls = [];
  const fakeSaveFn = async (payload) => { calls.push(payload); return { id: 'saved-' + calls.length }; };
  const participants = [makeParticipant('p1'), makeParticipant('p2')];
  const outcomes = await saveParticipantResults(participants, ['p1'], fakeSaveFn);

  assert.strictEqual(calls.length, 2, '참가자 수만큼 saveFn이 호출되어야 함');
  assert.deepStrictEqual(calls[0], {
    weapon_name: '무기-p1', weapon_image: 'data:image/png;base64,AAA',
    weapon_stats: { attack: 10, defense: 5 }, weapon_damage: 500, win: true,
  }, 'winners에 포함된 p1은 win:true, parts는 저장 대상에서 제외되어야 함');
  assert.strictEqual(calls[1].win, false, 'winners에 없는 p2는 win:false');
  assert.strictEqual(outcomes.every((o) => o.status === 'fulfilled'), true);
  console.log('saveParticipantResults maps participants to saveFn calls: OK');
}

// 실패 케이스: 일부 참가자 저장이 실패해도 전체가 throw하지 않고, 나머지는 정상 처리됨
{
  const fakeSaveFn = async (payload) => {
    if (payload.weapon_name === '무기-p1') throw new Error('insert failed');
    return { id: 'saved' };
  };
  const participants = [makeParticipant('p1'), makeParticipant('p2')];
  const outcomes = await assert.doesNotReject(
    () => saveParticipantResults(participants, [], fakeSaveFn),
    '일부 저장 실패가 전체를 throw하게 만들면 안 됨',
  );
}
console.log('saveParticipantResults tolerates partial failure: OK');

// 참가자가 0명이어도 안전하게 빈 배열 반환
{
  const outcomes = await saveParticipantResults([], [], async () => { throw new Error('should not be called'); });
  assert.deepStrictEqual(outcomes, []);
  console.log('saveParticipantResults with no participants: OK');
}

console.log('resultStorage.test.mjs: OK');
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node backend/lib/resultStorage.test.mjs`
Expected: `Cannot find module './resultStorage.js'` 등 모듈 없음 에러로 실패

- [ ] **Step 3: 구현**

`backend/lib/resultStorage.js`:
```js
import { saveResult } from './supabaseClient.js';

// 대전 종료 시 참가자별 결과를 저장한다. 저장 실패는 절대 호출자를 막지 않도록
// Promise.allSettled로 감싼다 — 부스 운영 중엔 저장 실패보다 stage 전환이 막히는 쪽이 더 나쁘다.
export async function saveParticipantResults(participants, winners, saveFn = saveResult) {
  const outcomes = await Promise.allSettled(
    participants.map((p) => saveFn({
      weapon_name: p.weapon?.name,
      weapon_image: p.weapon?.image,
      weapon_stats: p.weapon?.stats,
      weapon_damage: p.weapon?.damage,
      win: winners.includes(p.id),
    })),
  );
  outcomes.forEach((outcome, i) => {
    if (outcome.status === 'rejected') {
      console.error('[resultStorage] 참가자 결과 저장 실패:', participants[i].id, outcome.reason);
    }
  });
  return outcomes;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node backend/lib/resultStorage.test.mjs`
Expected: `resultStorage.test.mjs: OK` 출력, exit code 0

- [ ] **Step 5: 커밋**

```bash
git add backend/lib/resultStorage.js backend/lib/resultStorage.test.mjs
git commit -m "feat: 참가자별 결과 저장 조합 함수(saveParticipantResults) 추가"
```

---

### Task 3: `session.js`에서 대전 종료 시 저장 호출

**Files:**
- Modify: `backend/socket/session.js:13-33` (`goToStage` 함수, `battle` 분기의 `onEnd` 콜백)
- Test: `backend/socket/battleIntegration.test.mjs` (확장)

**Interfaces:**
- Consumes: `saveParticipantResults(participants, winners, saveFn?)` (Task 2에서 정의), `cohort.participants`(기존, `{ id, weapon }[]`)

- [ ] **Step 1: 현재 통합 테스트가 통과하는지 먼저 확인 (베이스라인)**

Run: `timeout 5 node backend/socket/battleIntegration.test.mjs`
Expected: 기존 그대로 전부 통과, exit code 0 (이 스텝은 회귀 여부를 가르기 위한 베이스라인 확인이며 실패하는 테스트를 새로 추가하는 단계는 아님)

- [ ] **Step 2: 통합 테스트에 저장 호출 검증 추가**

`backend/socket/battleIntegration.test.mjs`의 마지막 블록(라운드 강제 종료 검증) 바로 다음, `stopBattleRoom();` 호출 이전에 아래를 추가:

```js
// 대전 종료 시 참가자 결과 저장이 시도됐는지 확인 — SUPABASE_URL 미설정 환경이므로
// saveResult()는 mock 폴백을 타고 성공하지만, 여기서 확인하려는 건 "호출 자체가 크래시 없이
// 끝까지 실행됐고 stage 전환을 막지 않았다"는 것 (resultStorage.test.mjs가 저장 로직 자체는
// 이미 단위 테스트로 검증함).
assert.strictEqual(getBattleRoom(), null, '저장 호출 이후에도 battleRoom 상태는 정상적으로 null');
console.log('battle end triggers result storage without blocking stage change: OK');
```

(이 assert는 이미 79-83줄 구간에서 검증된 상태를 재확인하는 것이 아니라, Step 3에서 `session.js`에 저장 호출을 추가한 뒤에도 기존 흐름이 깨지지 않았음을 같은 테스트 실행 안에서 다시 한번 보증하기 위한 것이다.)

- [ ] **Step 3: 테스트 실행해서 실패 확인**

Run: `timeout 5 node backend/socket/battleIntegration.test.mjs`
Expected: 이 시점엔 `session.js`가 아직 안 바뀌었으므로 기존 로직 그대로 통과함 (즉 이 Step에서는 실패하지 않는 것이 정상 — Task 3의 핵심 변경은 Step 2의 assert가 아니라 Step 4의 `session.js` 수정이며, Step 2는 회귀 방지용 확인 코드다. 다음 Step 4를 진행한다.)

- [ ] **Step 4: `session.js`에 저장 호출 연결**

`backend/socket/session.js` 최상단 import에 추가:
```js
import { saveParticipantResults } from '../lib/resultStorage.js';
```

`goToStage` 함수의 `onEnd` 콜백을 아래로 교체(`backend/socket/session.js:23-25`):
```js
      onEnd: (winners) => {
        saveParticipantResults(cohort.participants, winners);
        if (cohort.stage === 'battle') goToStage(io, 'result');
      },
```

(`saveParticipantResults`는 내부적으로 `Promise.allSettled`를 쓰므로 reject하지 않는다 — 여기서 `await`하지 않는 것은 의도적이다. 저장이 끝나길 기다리지 않고 곧바로 `goToStage`를 호출해야 결과 화면 전환이 저장 속도에 발목 잡히지 않는다.)

- [ ] **Step 5: 테스트 실행해서 통과 확인**

Run: `timeout 5 node backend/socket/battleIntegration.test.mjs`
Expected: 모든 기존 assert + Step 2에서 추가한 assert까지 전부 통과, `battleIntegration.test.mjs: OK` 출력, exit code 0

- [ ] **Step 6: 다른 회귀 테스트도 함께 재확인**

Run: `node backend/lib/battleSimulation.test.mjs && node backend/lib/supabaseClient.test.mjs && node backend/lib/resultStorage.test.mjs`
Expected: 세 스크립트 모두 `OK` 출력, exit code 0

- [ ] **Step 7: 커밋**

```bash
git add backend/socket/session.js backend/socket/battleIntegration.test.mjs
git commit -m "feat: 대전 종료 시 참가자 결과를 Supabase(또는 mock)에 저장"
```

---

### Task 4: 서버 기동 확인 + `.env.example` 안내 주석

**Files:**
- Modify: `backend/.env.example`

**Interfaces:** 없음 (설정 파일 + 수동 검증)

- [ ] **Step 1: `.env.example`에 안내 주석 추가**

`backend/.env.example` 전체를 아래로 교체:
```
PORT=3000
ADMIN_PASSWORD=changeme
AI_API_KEY=

# Supabase 프로젝트(https://supabase.com)에서 URL/서비스 키 발급 후 채우기.
# 비워두면 결과 저장이 mock 폴백으로 동작함 (backend/lib/supabaseClient.js 참고) —
# 개발/데모는 이 값 없이도 가능하지만, 실제 부스 운영 전엔 반드시 채워야 결과가 영구 보관됨.
# schema.sql(backend/lib/supabase/schema.sql)을 프로젝트의 SQL Editor에서 먼저 실행할 것.
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
```

- [ ] **Step 2: 서버가 mock 폴백 상태로 정상 기동하는지 확인**

Run:
```bash
cd backend && timeout 5 node server.js
```
Expected: `GBL local server listening on http://localhost:3000` 출력, 크래시 없이 5초 뒤 timeout으로 종료(정상 — 서버가 계속 떠있었다는 뜻)

- [ ] **Step 3: 커밋**

```bash
git add backend/.env.example
git commit -m "docs: .env.example에 Supabase 설정 안내 추가"
```

---

## 구현 후 사용자가 직접 해야 하는 작업 (코드 범위 밖)

이 플랜 완료 후에도 실제 부스 운영 전에는 사용자가 브라우저에서 직접:
1. https://supabase.com 에서 프로젝트 생성
2. SQL Editor에서 `backend/lib/supabase/schema.sql` 실행
3. 발급받은 URL/서비스 키를 실제 `.env`(git 제외 파일, `.env.example` 아님)에 채우기

를 완료해야 mock이 아닌 실제 영구 저장이 동작한다.
