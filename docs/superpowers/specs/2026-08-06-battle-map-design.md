# 배틀로얄 맵 — 배경 이미지 + 좌표 피커 인프라

## 배경

지금 대전 맵(`backend/lib/battleMap.js`)은 사각형 벽 3개짜리 플레이스홀더다 — 주석에 "팀이 Manus 결과물 좌표를 얻으면 walls 배열만 교체"라고 돼 있었지만, 실제로는 맵 아트를 대신 만들어줄 외부 팀이 없다. 이 스펙은 사용자가 직접 준비한 배경 이미지를 게임에 붙이고, 그 이미지를 보면서 벽/스폰 좌표를 직접 지정할 수 있는 인프라를 만든다. 실제 좀비고 테마 이미지 제작과 좌표 지정 자체는 사용자가 이 인프라를 이용해 나중에 직접 한다 — 이번 스코프는 "이미지를 붙이면 동작하는 파이프라인"까지다.

조사 중 기존 코드에서 발견한 문제: `ARENA_SIZE`(800x600)가 `backend/lib/battleSimulation.js`와 `frontend/src/screens/battle.js`에 각각 하드코딩돼 있고, `battleMap.js`의 `arenaSize` 필드는 어디서도 쓰이지 않는 죽은 데이터였다. 아레나 크기를 이미지 크기에 맞추려면 이 중복부터 정리해야 한다 — 이번 스펙에 포함한다.

## 맵 설정 단일화

`backend/lib/battleMap.js`를 `shapes/battleMap.js`로 옮긴다 — `shapes/`는 이미 `weaponRenderer.js` 등 프론트엔드(브라우저, 상대경로 import)와 백엔드(Node, 같은 상대경로 import) 양쪽이 공유하는 순수 로직 폴더다. 별도 API 호출이나 값 동기화 없이, 두 런타임이 정말로 같은 파일을 읽게 된다.

`DEFAULT_MAP`을 다음 형태로 통합한다(지금 별도 export였던 `SPAWN_POINTS`도 이 객체 안으로 옮긴다 — 맵이 바뀌면 벽과 스폰 지점이 같이 바뀌어야 하므로 한 곳에 두는 게 자연스럽다):

```js
export const DEFAULT_MAP = {
  arenaSize: { width: 800, height: 600 },
  imagePath: '/assets/maps/battle-map.png',
  walls: [ /* { x, y, width, height } */ ],
  spawnPoints: [ /* { x, y } */ ],
};
```

리팩터링 직후에는 지금 있는 플레이스홀더 벽 3개 + 스폰 8개 좌표값을 그대로 옮겨서 게임이 계속 정상 동작하게 하고, `imagePath`는 아직 존재하지 않는 경로를 가리키게 둔다(아래 "이미지 로딩" 절의 폴백 동작으로 인해 이미지가 없어도 게임은 깨지지 않는다).

## 물리 엔진 — `arenaSize`를 room에서 받기

`backend/lib/battleSimulation.js`의 모듈 상수 `export const ARENA_SIZE = { width: 800, height: 600 }`를 제거한다. `moveOne(player, walls)`가 받던 경계값을 `room.arenaSize`에서 가져오도록 시그니처를 바꾼다 — 이미 `room.walls`를 이 방식으로 받고 있어서 같은 패턴이다. `stepSimulation(room, now)`은 그대로 `room` 전체를 받으므로 내부에서 `room.arenaSize`를 꺼내 `moveOne`에 넘긴다.

`backend/socket/battle.js`의 `startBattleRoom`이 `battleRoom` 생성 시 `arenaSize: DEFAULT_MAP.arenaSize`를 채운다(지금 `walls: DEFAULT_MAP.walls`를 채우는 것과 같은 자리).

`CHARACTER_RADIUS`, `MOVE_SPEED`, `ATTACK_HITBOX_SIZE` 등 전투 관련 상수는 아레나 크기와 무관하게 지금 값 그대로 고정 상수로 남는다(스코프 제외 — 아래 참고).

## 배경 이미지 렌더링

이미지 파일은 `frontend/assets/maps/`에 두면 지금 있는 정적 파일 서빙(`express.static(frontend)`)으로 `/assets/maps/<파일명>`에서 바로 접근된다. `DEFAULT_MAP.imagePath`가 이 URL을 가리킨다.

`frontend/src/screens/battle.js`는 마운트 시점에 `shapes/battleMap.js`에서 `DEFAULT_MAP`을 직접 import해서 `ARENA_SIZE` 대신 `DEFAULT_MAP.arenaSize`로 Konva Stage 크기를 정한다(백엔드의 `battle:state`를 기다릴 필요 없음 — 프론트/백엔드가 같은 정적 값을 보고 있으므로).

배경 이미지는 `new Image()`로 로드해서 로드가 끝나면 `Konva.Image`로 만들어 레이어의 가장 아래(캐릭터/무기보다 먼저 추가된 자리)에 놓는다. `img.onerror`(파일이 아직 없거나 깨진 경우)는 아무것도 하지 않고 지금처럼 `.battle-arena`의 어두운 배경색(`#1a1a1a`)이 그대로 보이게 조용히 폴백한다 — 사용자가 이미지를 아직 준비하지 않은 상태에서도 게임이 깨지면 안 된다.

벽(walls)은 실제 그림이 배경 이미지에 이미 그려져 있다고 가정하고, 게임 화면에서는 시각적으로 그리지 않는다(투명한 충돌 판정용 히트박스로만 존재) — 지금처럼 회색 사각형(`fill: '#555'`)을 이미지 위에 겹쳐 그리지 않는다.

## 좌표 피커 도구

`tools/map-coordinate-picker.html` — 프레임워크·빌드 없이 순수 HTML/canvas/JS 한 파일로 만든다. 게임 서버와 무관하게 `file://`로 직접 열어서 쓴다(배포/서빙 대상 아님, 개발자 전용 도구).

기능:
- `<input type="file" accept="image/*">`로 로컬 이미지 파일을 선택하면 canvas에 원본 픽셀 크기 그대로 그린다.
- "벽" / "스폰" 모드 토글.
- 벽 모드: 마우스 드래그(누른 지점~뗀 지점)로 사각형을 그리면 `{ x, y, width, height }`가 목록에 추가되고, canvas 위에 반투명 사각형으로 계속 표시된다(다음 좌표를 잡을 때 이미 잡은 벽과 겹치는지 눈으로 확인 가능).
- 스폰 모드: 클릭하면 `{ x, y }`가 목록에 추가되고 canvas 위에 작은 점으로 표시된다.
- 화면 아래에 지금까지 잡은 walls/spawnPoints를 `shapes/battleMap.js`에 그대로 붙여넣을 수 있는 형태(유효한 JS 배열 리터럴 텍스트)로 보여주고, 복사 버튼(Clipboard API)을 둔다.
- 실행취소(마지막 항목 제거) / 전체 초기화 버튼.

## 스코프 제외

- 실제 좀비고 테마 맵 이미지 제작과 최종 벽/스폰 좌표 지정 — 사용자가 이 인프라를 이용해 나중에 직접 한다.
- 벽 모양을 축에 맞는 사각형 이외(회전된 사각형, 다각형, 원형 장애물)로 확장하는 것 — 지금 충돌판정(`circleRectOverlap`)이 axis-aligned rect만 다루고, 이번 스펙에서 바꾸지 않는다.
- 아레나 크기에 따라 `MOVE_SPEED`/`ATTACK_HITBOX_SIZE` 등 전투 상수를 비례 조정하는 것.
- 맵을 여러 개 두고 상황에 따라 선택하는 기능 — `DEFAULT_MAP` 하나만 존재.
- 좌표 피커 도구의 자동화 테스트 — 게임에 배포되지 않는 개발자 전용 도구라, 이 프로젝트의 기존 관례(Konva/캔버스 드래그 UI는 라이브 검증만)를 따른다.

## 테스트 범위

- `shapes/battleMap.test.mjs`(신규): `DEFAULT_MAP.arenaSize`가 `{width, height}` 숫자쌍인지, `walls`가 `{x,y,width,height}` 객체 배열인지, `spawnPoints`가 `{x,y}` 객체 배열인지 구조 검증.
- `backend/lib/battleSimulation.test.mjs`(일부 수정): 경계 clamp가 모듈 상수가 아니라 `room.arenaSize`를 실제로 따르는지 — 예를 들어 기본값(800x600)과 다른 작은 커스텀 아레나(`{width: 100, height: 100}`)를 가진 room으로 캐릭터가 그 경계에서 멈추는지 검증(하드코딩이 남아있으면 이 테스트가 실패한다).
- `backend/socket/battleIntegration.test.mjs`(일부 수정): `startBattleRoom`이 만든 room의 `arenaSize`가 `DEFAULT_MAP.arenaSize`와 일치하는지 검증.
- 프론트엔드(`battle.js`의 이미지 로딩/렌더링)와 좌표 피커 도구는 자동테스트 없이 라이브 검증(Playwright 등)으로 확인.
