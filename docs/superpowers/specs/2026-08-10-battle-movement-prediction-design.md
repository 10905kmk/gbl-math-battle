# 대전 화면 — 본인 캐릭터 이동 클라이언트 예측(client-side prediction)

## 배경

현재 대전(`battle`)은 완전히 서버 권위 구조다. 클라이언트는 입력(`moveX/moveY/aimX/aimY`)만 소켓으로 보내고(`battle:input`), 서버가 20Hz(`stepSimulation`, `backend/lib/battleSimulation.js`)로 이동/충돌/공격을 계산해 `battle:state`로 뿌리면, 클라이언트는 수신한 두 위치 사이를 50ms(`NETWORK_FRAME_MS`) 동안 선형보간해서 매끄럽게 보여준다(`frontend/src/screens/battle.js`의 `moveNodeSmoothly`). 본인 캐릭터조차 예측 이동 없이 서버 응답을 기다려야 화면이 움직이는 구조라, RTT가 조금만 있어도 "입력 → 화면 반응"이 그대로 늦게 느껴지고, 20Hz 틱 간격 자체가 체감상 뚝뚝 끊기는 느낌으로 나타난다(실제 사용자 피드백: "이동이 조금 굼뜨고, 20hz라서 그런지 살짝살짝씩 끊김").

이 문제를 표준적인 클라이언트 예측(client-side prediction) + 서버 재조정(reconciliation) 패턴으로 해결한다 — 서버는 지금처럼 이동/충돌/공격 판정의 유일한 권위로 남고, 본인 캐릭터의 "화면에 보이는 위치"만 클라이언트가 같은 물리를 미리 계산해서 매 프레임 그린 뒤, 서버 값이 도착할 때마다 어긋난 만큼만 보정한다.

## 스코프

본인이 조작하는 캐릭터의 "이동"만 대상으로 한다. 공격 판정, 스킬 발동, 다른 참가자의 위치 표시는 이번 스펙에서 손대지 않는다 — 사용자가 실제로 체감한 지연은 본인 이동 한정이었고(공격 판정이 억울하다는 피드백은 없었음), 본인이 직접 조작하는 대상일수록 지연이 훨씬 민감하게 느껴지기 때문에 범위를 여기로 좁힌다.

## 설계

### 새 모듈: `frontend/src/screens/battle/selfPrediction.js`

DOM/Konva 의존 없는 순수 함수만 모은 파일 — `backend/lib/battleSimulation.js`의 `moveOne()`과 같은 축의 로직을 프론트에 재현하되, 서버와 별개 파일로 둔다(프론트 번들에 백엔드 전용 코드를 끌어오지 않기 위해).

- `predictSelfMove(pos, input, moveSpeed, walls, arenaSize, dtMs)`
  - `input.moveX/moveY`를 정규화(대각선 이동이 `√2`배 빨라지지 않게, 서버의 `normalizeIfLong`과 같은 규칙)한 뒤, `moveSpeed`(서버 정의: "틱(50ms)당 픽셀")를 `dtMs` 기준으로 환산(`moveSpeed / 50 * dtMs`)해서 이동시킨다.
  - 벽/경계 충돌은 `shapes/collision.js`의 `resolveCircleFromWalls`/`circleOverlapsAnyWall`을 그대로 재사용(이미 프레임워크 독립적인 순수 함수라 프론트에서 import만 하면 됨).
  - 스킬로 인한 속도 배율(`speedMultiplier`, `backend/lib/skillEngine.js`)은 재현하지 않는다 — 서버는 `player.status`(가속/감속/시간정지 등)를 참조해 배율을 계산하는데, 이 로직 전체를 프론트로 옮기는 비용 대비 이득이 작다(해당 상태가 걸린 짧은 시간 동안만 예측이 살짝 어긋났다가, 다음 서버 상태 수신 시 재조정으로 자연스럽게 맞는다).
- `reconcileSelfPosition(predicted, serverPos)`
  - 오차가 작으면(예: 4px 미만) 그대로 둔다 — 이미 거의 일치하는 상태에서 매 상태 패킷마다 미세하게 흔들리는 것 방지.
  - 오차가 크면(예: 150px 이상 — 리스폰/대시/블랙홀/넉백 등 원인 불문) 즉시 스냅한다 — 원인별로 분기하지 않고 "큰 오차는 순간이동"이라는 하나의 규칙으로 통일(YAGNI).
  - 그 사이 값이면 몇 프레임에 걸쳐 서버 위치 쪽으로 부드럽게 당긴다(비례 보정, 매 프레임 `predicted += (server - predicted) * CORRECTION_RATE`).
  - 정확한 임계값(4px/150px 등)과 `CORRECTION_RATE`는 구현 계획 단계에서 확정한다 — 이 문서는 규칙의 존재와 3단계 구조(무시/보정/스냅)만 규정한다.

### `battle.js` 통합

- `predictedSelfRef`(useRef `{x, y}`)를 추가 — 최초 값은 첫 `battle:state` 수신 시 서버가 준 본인 좌표로 초기화.
- 기존 rAF 루프(첫 `useEffect`의 `motionAnimation`, `Konva.Animation`)에 매 프레임:
  1. `inputRef.current`(이미 존재 — 입력 전송용으로 쓰던 것을 그대로 재사용)와 캐시된 `moveSpeed`로 `predictSelfMove` 호출, `predictedSelfRef` 갱신.
  2. 본인 캐릭터의 Konva 노드(원/이름표/체력바/무기 아이콘 등, 지금 `onState` 안에서 `p.x, p.y` 기준으로 그리는 부분 중 본인 항목)와 `updateCamera()`를 `predictedSelfRef.current` 기준으로 위치시킨다.
  3. 사망 중(`alive === false`)이면 예측 이동을 멈춘다 — 서버도 사망 시 입력을 `{0,0,0,0}`으로 비우므로(`recordDeath`) 자연스럽게 정지해야 정상이며, 로컬 `inputRef`에 죽기 직전 입력이 잔류해 있을 경우를 방어한다.
- `onState`(`battle:state` 핸들러) 안에서: 본인 항목은 더 이상 `moveNodeSmoothly`로 즉시/보간 렌더링하지 않고, `reconcileSelfPosition(predictedSelfRef.current, {x: p.x, y: p.y})`만 호출해 `predictedSelfRef`를 보정한다. `moveSpeed`는 `room.moveSpeed`(매 틱 포함되어 옴)를 캐시해두고, 첫 상태 수신 전 짧은 순간에는 로컬 폴백 상수(서버 `DEFAULT_MOVE_SPEED`와 같은 값, 주석으로 출처 명시)를 쓴다.
- 다른 참가자는 지금처럼 `onState`에서 `moveNodeSmoothly`로 보간 렌더링 — 변경 없음.
- 벽/아레나 크기는 서버가 `battle:state`에 아예 안 보내므로(`buildBattleStatePayload`가 `walls`를 명시적으로 제외) 프론트가 이미 갖고 있는 `DEFAULT_MAP.walls`/`DEFAULT_MAP.arenaSize`(`shapes/battleMap.js`, 이미 import돼 있음)를 그대로 쓴다.

## 예외 처리

- 리스폰/대시/블랙홀/넉백 등으로 서버 위치가 크게 점프하는 모든 경우 → `reconcileSelfPosition`의 스냅 임계값 하나로 통일 처리(원인별 분기 없음).
- 사망 중에는 예측 이동 정지.
- 스킬로 인한 속도 배율(가속/감속/시간정지 등)은 예측에서 의도적으로 무시 — 알려진 한계로 남기고, 재조정이 매 상태 패킷(50ms)마다 자연스럽게 오차를 흡수한다.
- 네트워크 끊김/재접속: 새 서버 상태가 오면 재조정이 알아서 맞춘다 — 별도 처리 불필요.

## 스코프 제외

- 공격/스킬 판정의 클라이언트 예측 — 이번 사용자 피드백은 이동 지연/끊김에 한정됨.
- 다른 참가자 위치 보간 방식 개선 — 본인이 직접 조작하지 않는 대상이라 지연 체감이 훨씬 약함, 별도 이슈로 남김.
- 서버 틱레이트 변경 — 근본 해결책이 아니라고 판단해 이번 스펙에서 배제(검토 과정에서 기각).

## 테스트 범위

- `selfPrediction.js`는 순수 함수라 프로젝트 기존 방식 그대로(`node xxx.test.mjs` + `assert`) 단위 테스트:
  - `predictSelfMove`: 벽 없는 평지 이동, 벽에 막히는 경우, 아레나 경계 clamp, 대각선 이동 정규화.
  - `reconcileSelfPosition`: 작은 오차 무시, 큰 오차 즉시 스냅, 중간 오차가 여러 프레임에 걸쳐 수렴.
- `battle.js` 쪽 렌더링/rAF 통합은 이 프로젝트의 기존 관례대로 자동화 테스트 없이 직접 확인(라이브 체감 테스트)한다.
