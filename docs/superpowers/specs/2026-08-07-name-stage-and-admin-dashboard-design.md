# 이름 입력 단계 + 관리자 대시보드 개선 — 설계 문서

## 배경

부스 기기는 세션마다 새로고침하지 않고 계속 켜둔 채로 운영한다. 현재 참가자 이름
입력(`frontend/src/screens/name.js`)은 `app.js`가 "페이지 로드당 한 번"만 보여주는
전역 게이트라, 같은 기기로 여러 그룹을 연달아 받으면 두 번째 그룹부터는 첫 번째
그룹 참가자의 이름이 그대로 남는다.

동시에, 이전 감사에서 관리자 대시보드(`frontend/admin/admin.js`)가 스텁 상태로
방치되어 있음을 확인했다: 서버가 실제로 보내는 `create:progress` 이벤트를
구독하지 않아 진행도가 항상 0/0으로 보이고, 참가자 개별 이름/완료 상태를 보여줄
서버 이벤트 자체가 없으며, 제작 단계를 늦게 끝내는 참가자("낙오자")를 강제로
마감시킬 방법이 없어 그런 참가자는 대전에서 조용히 통째로 빠진다. 에러 로그와
제출 현황도 하드코딩된 placeholder다.

이 문서는 두 문제를 함께 다룬다 — 이름 입력을 실제 서버 stage로 승격시키는 김에,
그 stage 전환에 필요한 참가자별 진행 상태 추적을 관리자 대시보드가 그대로
재사용하도록 설계한다.

## 범위

**포함:**
- `name` stage 신설 (name → learn 전환)
- `create` stage의 자동 전환(전원 완료 시 battle로) → 관리자 수동 전환으로 변경
- 참가자 데이터 모델을 `cohort.participants` 하나로 통합
- 관리자 대시보드: 실시간 참가자 리스트/진행도, 에러 로그 뷰, 낙오자 강제 마감(기본 무기)

**제외 (이번 작업 범위 밖):**
- 제출 현황(Supabase 저장 건수) 대시보드 — 이번엔 안 함
- 관리자 인증(로그인 화면 연결) — 별도 감사 항목, 이번 스펙에 안 넣음
- CDN 오프라인 대비 — 별도 항목
- battle 단계 자체의 흐름 변경 없음 (기존 타이머/결과 저장 로직 그대로)

## A. Stage 머신 변경

`backend/socket/session.js`의 `STAGE_ORDER`를 다음으로 확장한다:

```js
const STAGE_ORDER = ['name', 'learn', 'create', 'battle', 'result', 'thanks'];
```

- `admin:startSession` 핸들러가 `goToStage(io, 'learn')` 대신 `goToStage(io, 'name')`을
  호출하도록 변경한다.
- `admin:nextStage`/`admin:prevStage`는 이미 `STAGE_ORDER` 배열을 그대로 순회하므로
  코드 변경 없이 새 stage를 자동으로 인식한다.
- `create:done` 핸들러 안의 자동 전환 로직(`if (cohort.expectedParticipants > 0 &&
  doneCount() >= cohort.expectedParticipants) { goToStage(io, 'battle'); }`)을
  삭제한다. `create` → `battle` 전환은 이제 오직 관리자의 `admin:nextStage`로만
  일어난다.
- `name` stage에는 참가자 완료를 집계해서 자동 전환하는 로직을 아예 만들지 않는다
  (애초에 관리자 수동 전환이므로 불필요).

### 참가자 화면 (`frontend/src/`)

- `app.js`: `SCREENS` 맵에 `name: NameScreen`을 추가한다. 기존의 `name === null`
  전역 게이트(`if (name === null) return html\`<${NameScreen} .../>\`;`)와 관련
  상태(`name`, `nameRef`, 재연결 시 이름 재전송 로직)는 전부 제거한다 — 서버가
  현재 stage를 신뢰 가능한 단일 진실 소스로 관리하므로, 재접속 시에도 서버가
  현재 stage를 그대로 다시 보내주는 기존 패턴(`stage:change`)만으로 충분하다.
- `screens/name.js`: 제출 후에도 컴포넌트가 그대로 남아있어야 하므로(다음 stage로
  넘어갈 때까지), 제출 완료 시 로컬 `phase` 상태를 `'waiting'`으로 바꿔 "제출
  완료! 시작을 기다리는 중입니다" 문구를 보여주는 대기 뷰를 추가한다
  (`create.js`의 `phase` 패턴과 동일한 모양).
  - 제출은 여전히 기존 `participant:name` 소켓 이벤트를 그대로 사용한다(빈 값
    제출 허용 동일).

## B. 참가자 데이터 모델 통합 (`session.js`)

현재 세 개로 흩어진 추적 구조:
- `joined` (Set) — 접속한 참가자 소켓 id
- `participantNames` (Map) — 소켓 id → 이름
- `cohort.participants` (Array) — **create 완료자만** 들어있는 배열

이를 `cohort.participants` 하나로 합친다:

```js
// { id, name, createDone, weapon }
cohort.participants = [];
```

- `participant:join` 시점에 엔트리가 없으면 생성한다: `{ id: socket.id, name: null,
  createDone: false, weapon: null }`. (기존엔 이 시점에 아무 엔트리도 안 만들고
  `joined` Set에만 추가했다 — 그래서 지금까지 관리자가 "제작 중인" 참가자를 아예
  볼 방법이 없었다.)
- `participant:name` → 매칭되는 엔트리의 `name` 갱신 (기존과 동일한 trim/20자
  제한, 빈 문자열은 `null`).
- `create:done` → 엔트리의 `createDone=true`, `weapon=...`으로 갱신 (엔트리가
  없으면 새로 만듦 — 이론상 join 없이 create:done만 오는 경우는 없지만 방어
  차원에서 유지).
- `admin:forceFinish`(신규, D 참고) → `create:done`과 동일하게 엔트리를
  `createDone=true`로 갱신하되 weapon은 고정 폴백 값.
- `disconnect` → 기존과 동일하게 해당 엔트리를 배열에서 제거.
- `expectedParticipants`는 그대로 유지한다 — `admin:startSession` 시점의 인원
  스냅샷이라는 역할은 변하지 않는다(자동 전환 트리거로는 더 이상 안 쓰이지만,
  진행도 표시의 분모로는 여전히 필요).
- 뭔가 바뀔 때마다(`participant:join`/`participant:name`/`create:done`/
  `admin:forceFinish`/`disconnect`) `io.emit('admin:participants', cohort.participants)`로
  전체 배열을 broadcast한다. 새로 연결되는 소켓에도 `registerSessionHandlers`
  초입에서 기존 `stage:change`/`learn:slide`/`create:progress`와 같은 자리에
  현재 배열을 즉시 보내준다.
- 참가자 화면용 `create:progress`(집계 `{done, total}`)는 그대로 유지하되, 이제
  `cohort.participants.filter(p => p.createDone).length`로 계산한다(로직은
  기존과 동일, 데이터 소스만 통합).

## C. 관리자 대시보드 (`frontend/admin/admin.js`)

- `admin:participants` 이벤트를 구독해 실시간 리스트를 렌더링한다: 이름(없으면
  "이름 없음"), 제작 완료 여부.
- 완료되지 않은 참가자(`createDone === false`) 옆에 **"기본 무기로 마감"** 버튼을
  보여준다. 클릭 시 `socket.emit('admin:forceFinish', participant.id)`.
- 상단바의 "남은 시간" 항목은 제거한다 — battle 단계를 제외한 모든 단계가 관리자
  수동 전환으로 바뀌므로 표시할 타이머 자체가 없다. (battle 단계 타이머는
  `BattleMapView.js`/`battle.js`가 이미 각자 표시하고 있어 admin 상단바가
  중복으로 가질 필요 없음.)
- 상단바의 "진행도"는 `cohort.participants.filter(p=>p.createDone).length /
  expectedParticipants`로 계산해 계속 보여준다. 라벨을 "제작 완료: N/총원"으로
  명시해서, `name`/`learn` 단계처럼 아직 create를 시작도 안 한 시점엔 항상
  0으로 보이는 게 "진행이 안 됨"이 아니라 "제작 단계가 아직 아님"이라는 걸
  헷갈리지 않게 한다. 그 외 단계별 진행 상황(누가 이름을 입력했는지 등)은
  참가자 리스트를 직접 보면 되므로 별도 집계 숫자를 추가하지 않는다.
- 에러 로그 패널(E 참고)을 대시보드 패널에 추가한다.
- "제출 현황" 항목은 이번 스펙 범위 밖이므로 기존 하드코딩된 `-` 표시를 그대로
  둔다(제거하지 않음 — 나중에 별도 작업으로 채울 자리로 남겨둠).

## D. 낙오자 강제 마감 = 기본 무기

- 서버(`session.js`)에 `socket.on('admin:forceFinish', (participantId) => {...})`
  핸들러를 추가한다.
- 이미 `createDone`인 참가자에 대한 호출은 무시한다(중복 클릭 방어).
- 존재하지 않는 참가자(이미 연결 종료됨)에 대한 호출도 조용히 무시한다.
- 부여하는 "기본 무기"는 완전히 새로 만들지 않고, `weaponEvaluate.js`가 AI 평가
  실패 시 이미 쓰고 있는 폴백 값 계산 방식을 그대로 재사용한다:
  ```js
  {
    name: '기본 무기',
    image: null,
    damage: DAMAGE_MIN,               // aiClient.js, 현재 1
    attackRange: 'melee',
    attackRangeDistance: RANGE_DISTANCE_MIN, // attackGeometry.js
    parts: [],
  }
  ```
  (`fallbackDamage({parts: []})`/`fallbackAttackRange({parts: []})`를 그대로
  호출해도 같은 값이 나오므로, 새 상수를 만드는 대신 이 두 함수를 재사용한다.)
- `weapon.image`가 `null`인 채로 배틀/결과 화면에 들어가도 깨지지 않아야 한다.
  `frontend/src/screens/result.js`의 `<img src=${weapon?.image} .../>`를
  `weapon?.image`가 있을 때만 렌더링하도록 조건부로 바꾼다(이미지가 없으면
  아예 `<img>` 태그를 그리지 않음). `battle.js`/`weaponRenderer.js`는 이미
  빈 `parts` 배열을 안전하게 처리하므로(개별 확인 완료) 추가 수정 불필요.

## E. 에러 로그

- `backend/lib/errorLog.js` 신설:
  ```js
  const MAX_ENTRIES = 20;
  let entries = [];       // 최신이 앞
  let ioRef = null;

  export function initErrorLog(io) { ioRef = io; }

  export function logError(context, err) {
    console.error(`[${context}]`, err);
    const entry = {
      context,
      message: err?.message ?? String(err),
      timestamp: new Date().toISOString(),
    };
    entries = [entry, ...entries].slice(0, MAX_ENTRIES);
    ioRef?.emit('admin:error', entry);
  }

  export function getErrorLog() {
    return entries;
  }
  ```
- `backend/server.js`에서 Socket.io 서버 생성 직후 `initErrorLog(io)` 호출.
- 기존 `console.error(...)` 호출부를 `logError(context, err)`로 교체한다:
  - `backend/routes/weaponChat.js` — `console.error('[weaponChat] AI 채팅 처리 실패:', err)`
    → `logError('weaponChat', err)`
  - `backend/routes/weaponEvaluate.js` — `console.error('[weaponEvaluate] AI 평가 실패, fallback으로 대체:', err)`
    → `logError('weaponEvaluate', err)` (fallback 자체는 그대로 진행, 로깅만 교체)
  - `backend/lib/resultStorage.js` — `console.error('[resultStorage] 참가자 결과 저장 실패:', ...)`
    → `logError('resultStorage', reason)`
  - `backend/socket/session.js` — `console.error('[session] 결과 저장 중 예외:', err)`
    → `logError('session', err)`
- `registerSessionHandlers` 초입(기존 `stage:change`/`learn:slide`/`create:progress`
  전송하는 자리)에서 `socket.emit('admin:errorLog', getErrorLog())`로 현재 버퍼를
  즉시 보낸다. 참가자/디스플레이 화면도 같이 받지만 그냥 안 듣는다(기존
  이벤트들과 동일한 방식 — 소켓 종류를 구분하지 않음).
- `admin.js`는 `admin:errorLog`(초기 버퍼, 배열)와 `admin:error`(신규 1건)를 모두
  구독해서 리스트에 합친다. 표시는 최근 20개, 시간 역순.

## 테스트 계획

- `backend/socket/session.createDone.test.mjs` (기존 파일) — `cohort.participants`
  통합 이후에도 create:done 관련 기존 동작(이름 매핑, 자동 전환 제거로 인한 동작
  변경)을 커버하도록 갱신. 특히 **자동 전환 제거**를 검증하는 회귀 테스트를
  추가한다(전원이 create:done을 보내도 stage가 여전히 'create'로 남아있어야 함).
- `admin:forceFinish` 핸들러: 신규 유닛 테스트 — 미완료 참가자 강제 마감 시
  `createDone=true` + 폴백 무기값, 이미 완료된 참가자에겐 무시됨, 존재하지 않는
  id도 무시됨.
- `errorLog.js`: 신규 유닛 테스트 — `MAX_ENTRIES` 캡, `logError` 호출 시 `io.emit`
  호출 여부.
- `name` stage 전환: `session.js` 관련 테스트에 `admin:startSession` 후 stage가
  `'name'`인지 확인하는 케이스 추가.
