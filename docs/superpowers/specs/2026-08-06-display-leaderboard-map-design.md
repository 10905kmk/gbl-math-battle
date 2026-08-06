# 공용화면 — 대전 미니맵 + 점수 리더보드, 참가자 이름 수집

## 배경

공용화면(`frontend/admin/display.js`, "전자칠판" 등에 팝업으로 띄워두는 화면)은 지금 `battle` 단계에서 "대전이 진행 중입니다"라는 정적 텍스트만 보여준다. 실제로 누가 어디서 싸우고 있고 누가 이기고 있는지 보이지 않는다 — 참가자 위치가 표시되는 실제 맵 미니뷰와, 점수 순위 리더보드를 추가한다.

리더보드에 참가자 실명을 보여주고 싶은데, 지금 이 앱에는 이름을 수집하는 곳이 어디에도 없다(무기 이름도 항상 "내가 만든 무기" 고정값). 참가자 화면 맨 처음(단계와 무관하게)에 이름 입력 화면을 추가한다.

## 이름 수집

`frontend/src/app.js`에 로컬 상태(서버 동기화 아님) `name`을 추가한다 — 초기값 `null`. `name === null`이면 현재 `stage`가 무엇이든 상관없이 이름 입력 화면(`frontend/src/screens/name.js`, 신규)을 먼저 보여준다. 텍스트 입력 하나 + 제출 버튼 — 빈 값으로 제출하는 것도 허용한다(건너뛰기와 같은 효과). 제출하면 `participant:name` 이벤트로 서버에 보내고, 로컬 `name` 상태를 채워서 정상적인 단계 라우팅(`SCREENS[stage]`)으로 넘어간다.

기존 `participant:join`(참가자 인원수 집계용 신호, `admin:startSession` 시점에 그때까지 접속한 소켓 수를 목표 인원으로 고정하는 데 쓰임)은 이름 입력과 완전히 무관하게 지금처럼 접속 즉시(`connect` 이벤트에서) 그대로 보낸다 — 이름 입력에 시간이 걸려 이 신호가 늦어지면 예전에 고쳤던 "인원수 집계 어긋남" 버그(Opus 리뷰 Critical #2a/#2b, `session.js` 주석 참고)가 재발할 수 있다.

`backend/socket/session.js`에 `participantNames = new Map()`(`socket.id` → 이름 문자열)를 새로 둔다. `participant:name` 수신 시 값을 문자열로 검증 후 trim + 20자로 잘라서 저장한다(클라이언트 제공값을 신뢰하지 않는 이 프로젝트의 기존 원칙). `create:done` 핸들러가 `cohort.participants` 엔트리를 만들거나 갱신할 때 `name: participantNames.get(socket.id) || null`을 같이 채운다(이 필드 자체는 `cohort.participants: [], // { id, name, done }` 주석에 원래부터 예정돼 있었다). `disconnect` 시 `participantNames`에서도 정리한다(기존 `joined.delete(socket.id)`와 같은 이유 — 끊긴 소켓의 데이터가 무한정 쌓이는 것 방지).

`backend/socket/battle.js`의 `startBattleRoom`이 플레이어 객체에 `name: participant.name ?? null`을 추가한다 — `battle:state`를 타고 공용화면까지 전달된다. 이 부분은 지금 근접/원거리 공격 시스템 작업이 같은 파일(플레이어 초기화 블록)을 수정 중이므로, 그 작업이 먼저 병합된 뒤에 진행한다.

## 공용화면 — 미니맵 + 리더보드

`frontend/admin/display.js`가 `stage === 'battle'`일 때 새 컴포넌트(`frontend/admin/BattleMapView.js`, 신규)를 렌더링한다. 이미 `battle:state`가 `io.emit`으로 전체 브로드캐스트되고 있어서(참가자 전용 채널이 아님), 이 컴포넌트가 그 이벤트를 그대로 구독하면 된다 — **백엔드에 새 이벤트나 방(room) 분리가 필요 없다.**

**맵**: `shapes/battleMap.js`의 `DEFAULT_MAP`(배경 이미지 경로, 월드 크기)을 그대로 가져다 쓴다. 공용화면 전용 고정 크기(960x720, 월드와 같은 4:3 비율)로 Konva Stage를 만들고, `scale = 960 / DEFAULT_MAP.arenaSize.width`로 배경 이미지와 캐릭터 좌표를 전부 축소해서 그린다. 카메라 추적 없이 월드 전체가 한 번에 보이는 관전자 시점이다. 캐릭터는 작은 색상 원으로 표시하고, 색상표(`CHARACTER_COLORS`)는 `frontend/src/screens/battle.js`에서 공유 모듈로 빼지 않고 `BattleMapView.js`에 그대로 복제한다 — 지금 그 파일을 다른 작업이 수정 중이라 충돌을 피하는 것도 있고, 8개 고정 색상표라 중복 위험이 낮다.

**리더보드**: `room.players`를 점수 내림차순으로 정렬해서 순위/색상 원/이름(또는 없으면 "캐릭터 N")/점수를 세로 목록으로 보여준다.

**레이아웃**: 화면을 맵(왼쪽, 넓게)과 리더보드(오른쪽, 세로 목록) 두 영역으로 나눈다.

## 스코프 제외

- 투사체/공격 미리보기 표시 — 참가자 화면 전용, 공용화면은 관전용 요약만.
- 실시간 순위 변동 애니메이션 — 매 `battle:state`마다 그냥 다시 정렬해서 그린다.
- 이름 유효성 검사(욕설 필터링 등) — 트림 + 길이 제한만, 내용 검증은 스코프 밖.
- `learn`/`create`/`result`/`thanks` 등 다른 단계의 공용화면 표시 — 지금 있는 텍스트 안내 그대로 유지, 이번 스펙은 `battle` 단계만 다룬다.

## 테스트 범위

- `backend/socket/session.js`(`participant:name`/`create:done`의 이름 처리): 이름이 trim/길이 제한되는지, 없으면 `null`로 처리되는지, `disconnect` 시 `participantNames`가 정리되는지 — 기존 `battleIntegration.test.mjs` 계열에 새 테스트 추가.
- `backend/socket/battle.js`(`startBattleRoom`이 `name`을 플레이어 객체에 반영하는지) — 기존 `battleIntegration.test.mjs`에 추가.
- 프론트엔드(이름 입력 화면, 공용화면 미니맵/리더보드)는 이 프로젝트의 기존 관례대로 자동화 테스트 없이 라이브 검증으로 확인한다.
