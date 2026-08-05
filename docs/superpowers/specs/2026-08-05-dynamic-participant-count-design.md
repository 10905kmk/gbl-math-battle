# 참가 인원 유동화 설계

## 배경

`backend/socket/session.js`의 `EXPECTED_PARTICIPANTS = 5`가 "몇 명이 다 완료해야 자동으로 대전을 시작할지"와 진행률 표시(`n/5`)의 분모로 쓰이고 있다. 부스 실제 운영 시 참가 인원이 3~6명 사이에서 회차마다 달라질 수 있어, 이 숫자를 하드코딩하지 않고 실제 참가자 수에 맞춰 동작해야 한다.

## 핵심 아이디어

관리자가 "세션 시작"(`admin:startSession`)을 누르는 시점에 그때 접속해 있는 참가자 수를 스냅샷으로 찍어, 그 세션의 목표 인원(`cohort.expectedParticipants`)으로 고정한다.

## 문제: 참가자 식별

서버는 현재 `create:done`(무기 제작 완료)이 와야 비로소 "이 소켓은 참가자"라고 안다. 그 전에는 접속된 소켓이 참가자 기기(`frontend/src/app.js`)인지, 관리자 화면(`admin.js`)인지, 공용화면(`display.js`)인지 구분할 수 없다 — 셋 다 같은 서버에 동일한 방식(`io()`)으로 접속하기 때문이다.

## 데이터 흐름

1. 참가자 화면(`frontend/src/app.js`)이 소켓 연결(및 재연결) 시 `participant:join` 이벤트를 서버로 보낸다.
2. 서버(`session.js`)는 현재 접속 중인 참가자 소켓 id를 `joined`라는 `Set`으로 추적한다.
   - `participant:join` 수신 시 `joined.add(socket.id)`
   - `disconnect` 시 `joined.delete(socket.id)` (기존 `cohort.participants` 정리 로직과 나란히)
3. `admin:startSession` 핸들러가 `goToStage(io, 'learn')` 호출 전에 `cohort.expectedParticipants = joined.size`로 고정한다.
4. `broadcastProgress`(`create:progress` 이벤트의 `total` 필드)와 `create:done` 핸들러의 자동 전환 조건(`doneCount() >= expectedParticipants`)이 이 값을 참조한다.
5. `admin:reset`은 `cohort.expectedParticipants`를 0으로 되돌린다(다른 cohort 필드와 동일하게). `joined` Set 자체는 리셋하지 않는다 — 참가자 기기는 여전히 접속돼 있으므로, 다음 "세션 시작"에서 그 시점 인원으로 재고정된다.

## 여유분: 스폰 지점 / 캐릭터 색상 8개로 확장

실제 예상 인원은 3~6명이지만, 스폰 지점(`backend/lib/battleMap.js`의 `SPAWN_POINTS`, 현재 5개)과 캐릭터 식별자(`backend/socket/battle.js`의 `CHARACTER_IDS`, 현재 6개)를 8개로 늘려 여유를 둔다. `frontend/src/screens/battle.js`의 `CHARACTER_COLORS`도 2개 색상을 추가해 8개 캐릭터가 모두 구분되는 색을 갖도록 한다.

새 스폰 지점 3개(`{x:400,y:60}`, `{x:60,y:300}`, `{x:740,y:300}`)는 기존 벽 배치(`DEFAULT_MAP.walls`)와 겹치지 않도록 배치한다.

## 엣지 케이스

- **접속 인원 0명 상태에서 세션 시작**: `expectedParticipants = 0`이 되지만 실제 문제를 일으키지 않는다(참가자가 없으니 `create:done`도 오지 않음). 별도 방어 로직을 넣지 않는다 — 사용자 확인 완료.
- **참가자 새로고침(재연결)**: 기존 `cohort.participants` 정리와 동일한 패턴으로 `joined` Set도 `disconnect`에서 정리되므로, 새로고침으로 소켓 id가 바뀌어도 중복 집계되지 않는다.
- **8명 초과**: 범위 밖(스코프 아님) — 필요해지면 그때 배열을 다시 늘린다.

## 스코프 제외

- 관리자 화면(`admin.js`)의 진행률 표시(`doneCount/participants.length`)는 애초에 `create:progress` 이벤트를 구독하지 않는 기존 미완성 상태다. 이 작업과 무관한 별개 이슈이므로 손대지 않는다.
- `frontend/src/screens/create.js`의 초기 로컬 상태 `{ done: 0, total: 5 }`는 첫 `create:progress` 이벤트 도착 전 잠깐 보이는 기본값이다. `total: 0`으로 바꿔 하드코딩된 5를 제거한다(실질적 동작 변화는 없음, 일관성 차원).

## 테스트 범위

- `session.createDone.test.mjs`: 각 mock 소켓이 `admin:startSession` 전에 `participant:join`을 보내도록 갱신. 기존 5명 시나리오 유지.
- 새 회귀 테스트: 3명만 `participant:join` + 세션 시작 → 3명 `create:done`으로 battle 전환되는지 확인 (더 이상 5로 고정되지 않았음을 직접 증명).
- 새 회귀 테스트: 8명이 스폰/캐릭터를 배정받을 때 스폰 좌표와 캐릭터 id가 겹치지 않는지 확인.
