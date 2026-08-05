# 대전 시스템 — 설계 문서

- 브랜치: `feature/battle-system` (base: `feature/shared-shapes`)
- 관련 문서: `docs/초안.md` 7-③ 대전 화면, 8번 미결 사항
- 작성일: 2026-08-05

## 배경

`docs/초안.md`는 대전 형식(페어링 방식, 실시간 액션 vs 스탯 기반 자동전투)이 팀 내부에서 미정이라 브레인스토밍을 보류해뒀다. 이번 대화에서 확정한 방향:

- **진짜 실시간 액션** (스탯 비교 자동판정이 아님) — 단, 실제 브롤스타즈 수준은 아니고 9일 안에 되는 선에서 최대한 단순화
- **5명 동시 난투** (배틀로얄식) — 토너먼트 페어링 없음, 전원이 한 방에서 동시에 시작해서 동시에 끝남 (기존 "코호트 전체가 같이 움직인다"는 프로젝트 설계와 맞음)
- **근접 전투만** — 도형 모양에 따라 근접/원거리가 갈린다는 아이디어가 있었지만, 그 판정 자체가 AI 채점 대상이 될 것으로 보여 이번 스펙 범위 밖. 모든 무기를 근접으로 취급
- 맵(벽 배치)과 캐릭터 스프라이트는 **아직 실제 에셋이 없음** — 팀이 나중에 Manus 결과물로 교체할 수 있는 플레이스홀더 형식만 이번에 정의

## 스코프

**이번 스펙에 포함**
1. 서버 권위형 실시간 시뮬레이션 (이동/충돌/공격 판정, 20Hz 틱)
2. 5인 동시 난투 + 승리 조건 (마지막 생존자 또는 제한시간 종료 시 최다 체력)
3. 무기 데미지 스탯(1~10000) → 전투 수치(타격당 데미지) 정규화
4. 맵/캐릭터 플레이스홀더 데이터 형식 + Konva 기반 렌더링
5. 대전 종료 → `state.battleResult` 세팅 → `stage='result'` 전환

**이번 스펙에서 명시적으로 제외 (별도 스펙 예정)**
- 원거리 공격 / 도형 모양에 따른 근접·원거리 판정 (AI 채점 붙을 때 별도 스펙)
- 실제 맵 이미지·좌표 데이터, 실제 캐릭터 스프라이트 (팀이 Manus로 제작해서 플레이스홀더 교체 — 이번엔 형식만 정의)
- 결과물 PDF/이미지 다운로드 (별도 스펙, `docs/초안.md` 8번 항목)
- 참가자 연결 끊김 이후 재접속/복구, 서버 재시작 시 대전 상태 복원 (단발 부스 세션 전제, 프로젝트 전체가 이 전제를 따름)

## 데이터 모델

```js
// backend/socket/battle.js 내부 상태 — 5명이 공유하는 하나의 대전 방
battleRoom = {
  status: 'countdown' | 'active' | 'ended',
  endsAt: 0,                 // Date.now() + duration(ms), status='active' 진입 시 설정
  players: {
    // key: socket.id
    p1: {
      id: 'p1',
      characterId: 'char1',  // 'char1' ~ 'char6' 중 참가자 입장 순서대로 배정
      x: 0, y: 0,
      facing: 'down',        // 'up' | 'down' | 'left' | 'right'
      hp: 100,
      hitDamage: 25,         // weapon.damage(1~10000)를 정규화한 타격당 데미지
      alive: true,
      lastAttackAt: 0,       // Date.now(), 쿨다운 계산용
      input: { up: false, down: false, left: false, right: false, attack: false },
    },
  },
  walls: [ /* {x, y, width, height}[] — backend/lib/battleMap.js의 DEFAULT_MAP에서 로드 */ ],
};
```

- `ARENA_SIZE = { width: 800, height: 600 }`
- `hitDamage = clamp(round(weapon.damage / 200), 5, 50)` — Task 13(`create.js`)에서 이미 `state.weapon.damage`로 채점 결과가 들어있으므로, 대전 시작 시 이 값을 읽어 `player.hitDamage`를 계산한다.
- 캐릭터 반경(충돌용) `CHARACTER_RADIUS = 20`, 이동속도 `MOVE_SPEED = 4`(틱당 px, 20Hz 기준 초당 80px)

## 아키텍처

### 서버: `backend/socket/battle.js` (전면 재작성)

**시뮬레이션 로직은 순수 함수로 분리** — 소켓 배선과 별도로 테스트 가능하게:

```js
// backend/lib/battleSimulation.js (신규)
export function stepSimulation(room, now) {
  // 1. 생존자별 이동 처리(입력 방향 * MOVE_SPEED, 벽/아레나 경계 clamp)
  // 2. 공격 판정(쿨다운 지난 상태에서 input.attack === true면 히트박스 생성,
  //    겹치는 다른 생존자에게 hitDamage 적용, hp<=0이면 alive=false)
  // 3. 승리 조건 체크(생존자 1명 이하 or now >= room.endsAt) → status='ended'로 전환하고
  //    승자 socket id 목록 반환
  return { room, winners: [] | ['p1', 'p3', ...] };
}
```

**소켓 이벤트**
- `battle:input` (참가자→서버) — `{ up, down, left, right, attack }` 현재 눌림 상태를 그대로 보냄(이벤트가 아니라 상태). 서버는 `room.players[socket.id].input`을 덮어씀.
- `battle:state` (서버→전체, 매 틱 20Hz) — `battleRoom` 스냅샷 전체를 그대로 broadcast. 5명뿐이라 델타 압축 없이 전체를 보내도 부담 없음.
- `battle:result` (서버→각자, 대전 종료 시 1회) — `{ win: boolean }`

**틱 루프**: `stage='battle'` 진입 시 `setInterval(() => { ...stepSimulation 호출, battle:state emit... }, 50)` 시작, `status='ended'`가 되면 interval 정지 + `battle:result` emit + `stage='result'` broadcast(기존 `session.js`의 `goToStage`와 동일 패턴 재사용).

### 백엔드: `backend/lib/battleMap.js` (신규)

```js
export const DEFAULT_MAP = {
  arenaSize: { width: 800, height: 600 },
  walls: [
    { x: 350, y: 250, width: 100, height: 20 },
    { x: 100, y: 100, width: 20, height: 150 },
    { x: 680, y: 350, width: 20, height: 150 },
  ],
};
```
팀이 실제 Manus 맵 좌표를 얻으면 이 파일의 `walls` 배열만 교체하면 된다 — 형식(사각형 좌표 배열)은 유지.

### 프론트: `frontend/src/screens/battle.js` (전면 재작성)

- Konva 재도입 필요 (`feature/battle-system`은 `feature/shared-shapes`에서 분기해서 Konva가 아직 없음 — `frontend/index.html` import map에 다시 추가)
- 캐릭터는 실제 스프라이트 대신 6색상 원 + 라벨로 임시 렌더링:
  ```js
  const CHARACTER_COLORS = {
    char1: '#e74c3c', char2: '#3498db', char3: '#2ecc71',
    char4: '#f1c40f', char5: '#9b59b6', char6: '#e67e22',
  };
  ```
- **매 틱 노드 재생성 금지** — 20Hz로 위치가 계속 바뀌므로, `CanvasEditor.js`처럼 destroy/recreate하면 깜빡임. 기존 Konva 노드를 찾아서 `.x()/.y()`만 갱신
- **입력**: 화면에 항상 방향패드 + 공격 버튼(터치/클릭 겸용)을 띄우고, 추가로 키보드 방향키/스페이스바 리스너도 등록 — 디바이스(노트북/태블릿) 상관없이 동작하게. 4방향만 지원(대각선 없음, 마지막 눌린 방향이 우선)
- `battle:input`은 입력 상태가 바뀔 때마다 즉시 전송(폴링 아님)
- `battle:state` 수신 시 각 플레이어 노드 위치/체력바 갱신
- `battle:result` 수신 시 `state.battleResult = win ? 'win' : 'lose'` 세팅 (기존 `result.js`가 이미 이 필드를 읽고 있어서 그대로 호환, `result.js` 자체는 수정 안 함)

## 승리 조건

1. 생존자가 1명 이하가 되면 즉시 종료, 그 1명이 승자 (0명이면 전원 패배 처리)
2. `endsAt` 도달 시 그 순간 체력 최다자가 승자 — 동점이면 동점자 전원 승자 (임의로 한 명만 승자로 정하는 불공평 방지)
3. 라운드 제한시간 `BATTLE_DURATION = 90_000`(90초)

## 에러 처리

- **참가자 연결 끊김**: 해당 캐릭터를 `alive=false`로 처리하고 시뮬레이션은 나머지 생존자로 계속 진행 — 대전 자체가 멈추지 않음
- **서버 재시작/크래시**: 별도 복구 로직 없음 (단발 부스 세션 전제, 이미 `session.js`의 `cohort` 상태 전체가 인메모리라 같은 전제를 따름)
- **잘못된 `battle:input` payload**: 서버는 예상 shape(`{up,down,left,right,attack}` boolean)만 신뢰하고, 없는 키는 `false`로 취급 (별도 검증 로직 불필요할 만큼 단순한 shape)

## 테스트

- `stepSimulation(room, now)`는 순수 함수 — `node:assert` 스크립트로 이동/충돌/공격판정/승리조건을 직접 검증 (기존 프로젝트 전체가 이 패턴 사용 중, 테스트 프레임워크 미설치)
  - 이동이 벽/경계를 뚫지 못하는지
  - 공격 히트박스가 겹친 상대에게만 데미지를 주는지, 쿨다운 중엔 재발동 안 하는지
  - 생존자 1명 남으면 즉시 종료되는지, 시간 초과 시 최다 체력자(또는 동점자 전원)가 승자인지
- 프론트(Konva 렌더링, 실시간 다중 클라이언트 동기화)는 자동화 비용이 커서, 화면이 에러 없이 로드/렌더링되는 정도만 Playwright로 확인하고 나머지는 수동 QA

## 미결 사항 (이번 스펙 밖, 참고용)

- 원거리 공격 및 도형→근접/원거리 판정 (AI 채점, 별도 스펙)
- 실제 맵/캐릭터 에셋 제작 (팀 작업, Manus)
- 결과물 PDF/이미지 다운로드 (별도 스펙)
- 참가자 재접속/복구 시나리오
