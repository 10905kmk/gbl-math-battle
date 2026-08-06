# 대전 조작방식 재설계 — 듀얼스틱

## 배경

지금 대전(`backend/lib/battleSimulation.js`, `frontend/src/screens/battle.js`)의 조작은 방향키 4개(상하좌우 중 하나만, 대각선 불가) + 스페이스바 공격이다. 공격 방향은 별도 조준 없이 "마지막으로 이동한 방향"(`player.facing`)을 그대로 쓴다. 모바일은 화면 하단 D-pad 버튼으로 같은 입력을 흉내낸다.

사용자가 지적한 문제:
- 모바일 D-pad 조작감이 부스 환경(태블릿/폰)에서 불편하다.
- 공격이 이동 방향에 종속돼 정밀 조준이 안 된다.
- 대각선 이동이 안 된다.
- 이동이 약간 끊기는 느낌이 있다(부차적).

대전 화면은 이미 "브롤스타즈 스타일"을 표방하고 있으므로(`docs/초안.md`, `battle-royale-scoring` 설계 문서), 조작도 브롤스타즈처럼 듀얼스틱(이동 스틱 + 조준/공격 스틱) 구조로 재설계한다. PC는 WASD/화살표 이동 + 마우스 방향 조준 + 마우스 클릭 공격의 하이브리드로 지원한다.

이 스펙은 조작방식만 다룬다. 맵 교체, 캐릭터 선택 UI는 별도 스펙(추후 진행).

## 데이터 모델 변경

`room.players[id]`에서:
- `facing`(문자열 4방향: up/down/left/right) → 제거. 대신 `aimX`, `aimY`(정규화된 단위벡터, 기본값 `{aimX: 0, aimY: 1}` — 기존 기본 facing `'down'`과 동일한 의미) 추가.
- `input`이 `{up, down, left, right, attack}` → `{moveX, moveY, aimX, aimY}`(전부 number, -1~1)로 바뀐다. `attack` 필드는 사라진다.
- 새 필드 `attackRequested`(boolean, `false`로 시작) 추가 — `battle:attack` 이벤트로 켜지고, 틱에서 소비된 뒤 항상 `false`로 리셋된다(성공/쿨다운 실패 여부와 무관하게 매번 리셋 — "누른 채 대기"가 아니라 "그 순간의 요청 1회"이기 때문).

`battle:input` 이벤트 payload가 `{up,down,left,right,attack}`에서 `{moveX, moveY, aimX, aimY}`로 바뀐다. 공격은 새 이벤트 `battle:attack`(payload 없음)으로 완전히 분리된다.

## 이동

`moveOne(player, walls)`:
- `dx = player.input.moveX * MOVE_SPEED`, `dy = player.input.moveY * MOVE_SPEED`로 계산한다.
- 입력 벡터 길이가 1을 넘으면(클라이언트 버그 또는 조작된 입력) 방어적으로 정규화한 뒤 적용한다 — `weaponDamage` clamp와 같은 "클라이언트 제공값은 항상 서버에서 재검증" 원칙.
- 벽 충돌/아레나 경계 clamp 로직(`circleOverlapsAnyWall`, `clamp`)은 그대로 유지 — 축만 바뀔 뿐 판정 방식은 동일.
- 대각선 입력이 자동으로 가능해진다(`moveX`, `moveY`가 동시에 0이 아닐 수 있으므로) — 더 이상 "우선순위 하나만 적용" 분기가 필요 없다.

이동 입력의 근원(키보드 vs 조이스틱)에 따라 클라이언트가 벡터를 다르게 만든다:
- **키보드(WASD + 화살표, 둘 다 지원)**: 눌린 키 조합을 방향벡터로 합친 뒤 정규화해서 보낸다 — 예: W+D 동시 입력 시 `(0.707, -0.707)`. 눌린 키가 없으면 `(0, 0)`. 항상 길이 0 또는 1(조이스틱처럼 "살짝 민" 상태가 없음).
- **모바일 이동 스틱**: 드래그 거리를 스틱 반경으로 나눈 비율(0~1)만큼의 길이를 갖는 벡터를 그대로 보낸다 — 살짝 밀면 느리게, 끝까지 밀면 최대속도(거리 비례).

## 조준

`aimX`, `aimY`는 이동과 완전히 분리된 별도 입력이다:
- **PC**: 매 마우스 이동마다 "내 캐릭터 화면 좌표 → 마우스 좌표" 벡터를 정규화해서 `aimX/aimY`로 보낸다. 대전 아레나(Konva stage) 위에서만 추적하며, `stage.getPointerPosition()`으로 좌표를 얻는다.
- **모바일**: 오른쪽(조준) 스틱을 드래그하는 동안 그 방향을 정규화해서 계속 보낸다. 스틱이 중앙(길이 0에 가까움)이면 마지막으로 유효했던 조준 방향을 그대로 유지한다(0벡터를 그대로 보내면 공격 히트박스가 캐릭터 자기 자신 위치에 겹쳐버리는 문제 방지).
- 서버는 들어온 `aimX/aimY`의 길이가 거의 0(예: `< 0.01`)이면 무시하고 이전 `player.aimX/aimY`를 유지한다 — 클라이언트 가드와 별개로 서버도 같은 원칙을 한 번 더 지킨다(방어적 이중화, 기존 프로젝트 전반의 패턴).
- 길이가 0이 아니면 정규화(단위벡터화)해서 저장한다.

전송 빈도: PC의 `mousemove`는 매우 잦으므로, 클라이언트에서 이전 전송값과의 차이가 임계값(예: 각도 변화 무시 가능한 수준) 이상일 때만 새로 emit한다 — 기존 `sendInput`의 "값이 실제로 바뀔 때만 전송" 원칙을 불리언 정확히 일치 비교 대신 연속값용 epsilon 비교로 확장한다.

## 공격

- `battle:attack`(payload 없음) — PC는 아레나 위에서 `mousedown` 시점(누르는 순간, 누르고 있는 동안 계속이 아님), 모바일은 조준 스틱을 놓는(release) 시점에 1회 emit한다.
- 서버 핸들러: 룸/플레이어가 존재하면 `player.attackRequested = true`로 세팅.
- `stepSimulation` 틱마다: `attackRequested`가 true인 플레이어에 대해 쿨다운(`ATTACK_COOLDOWN_MS`, 기존 500ms 유지)을 통과했으면 그 순간의 `aimX/aimY`로 히트박스를 계산해 판정하고 `lastAttackAt`을 갱신한다. 쿨다운 중이면 요청을 그냥 버린다(대기열 없음 — 다시 트리거해야 함). 판정 성공/실패 여부와 무관하게 `attackRequested`는 매 틱 끝에 `false`로 리셋한다.
- `attackHitboxRect(player)`: 기존처럼 `CHARACTER_RADIUS + ATTACK_HITBOX_SIZE/2`만큼 떨어진 지점에 고정 크기(`ATTACK_HITBOX_SIZE`) 정사각 히트박스를 두되, 오프셋 방향이 4방향 lookup 테이블 대신 `{x: player.x + aimX*offset, y: player.y + aimY*offset}` 연속 계산이 된다. 히트박스 자체는 회전하지 않는(axis-aligned) 정사각형 그대로라 `circleRectOverlap` 충돌판정 함수는 변경 없이 재사용된다.

## 프론트엔드

**새 컴포넌트** `frontend/src/screens/VirtualJoystick.js` — pointerdown/move/up(및 leave/cancel) 기반 드래그 스틱. base 원 반경 안에서 손가락 위치를 추적해 `{x, y}`(길이 0~1로 clamp)를 콜백으로 전달한다. 이동 스틱과 조준 스틱 양쪽에 재사용(조준 스틱은 release 시 추가로 `onRelease` 콜백을 한 번 호출해 `battle:attack` 트리거).

**`battle.js` 변경:**
- 기존 D-pad 버튼(`.dpad`)과 공격 버튼(`.attack-button`)을 두 개의 `VirtualJoystick`(왼쪽 이동, 오른쪽 조준)으로 교체.
- 키보드 리스너: WASD와 화살표 키 둘 다 방향 매핑에 포함, 눌린 키 집합으로 정규화된 이동벡터를 계산해 전송. 스페이스바 공격 트리거는 제거(PC는 마우스 클릭이 공격 트리거).
- 마우스 리스너: 아레나 컨테이너에 `mousemove`(조준 벡터 갱신) + `mousedown`(공격 트리거) 등록.
- `weaponGroup` 렌더링: 기존 4방향 오프셋 lookup 테이블 대신 `p.aimX, p.aimY` 기반 연속 오프셋으로 위치를 계산(아레나 경계 clamp는 기존 로직 유지)하고, `weaponGroup.rotation(Math.atan2(p.aimY, p.aimX) * 180 / Math.PI)`로 무기 아이콘을 조준 방향에 맞춰 연속 회전시킨다.
- 키보드/마우스 리스너와 터치 조이스틱은 기기 감지 없이 항상 동시에 등록된다 — 지금 D-pad+키보드가 동시에 동작하던 것과 같은 패턴.

## 스코프 제외

- 맵 이미지/장애물 배치 교체 — 별도 스펙.
- 캐릭터 선택 UI — 별도 스펙.
- 조이스틱의 시각 디자인(스킨, 색상 커스터마이징) — 기능 동작만, 스타일은 최소 수준.
- 타격 이펙트(화면 흔들림, 궤적, 파티클) — 지금 범위에 없던 것이라 이번에도 추가하지 않는다.
- 서버 틱 주기(50ms) 변경 — 입력 모델만 바뀌고 판정 주기는 그대로.

## 테스트 범위

- `backend/lib/battleSimulation.test.mjs`(대폭 수정): `moveOne`이 대각선 입력에서 속도가 정규화되는지(예: `moveX=moveY=1` 입력이 `MOVE_SPEED`보다 빠르게 이동하지 않아야 함), 길이 1 초과 입력이 clamp되는지, `attackHitboxRect`가 연속 각도(예: 대각선 조준)에서 올바른 위치에 놓이는지, `attackRequested`가 쿨다운 중엔 무시되고 매 틱 끝에 항상 리셋되는지, 조준 벡터가 0에 가까우면 이전 값이 유지되는지.
- `backend/socket/battle.js`에 대한 통합 테스트(`battleIntegration.test.mjs` 수정): `battle:input`이 새 payload 형태(`moveX/moveY/aimX/aimY`)를 받아 반영하는지, `battle:attack` 이벤트가 `attackRequested`를 세팅하는지, malformed/undefined payload에도 크래시하지 않는지(기존 방어 테스트 패턴 유지).
- 프론트엔드 `VirtualJoystick`은 별도 자동화 테스트 없이 라이브 검증(Playwright)으로 확인 — 기존 프로젝트에 프론트 컴포넌트 단위테스트 관례가 없음(Konva 렌더링 위주라 DOM 테스트 도구 미도입).
