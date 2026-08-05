# 대전 화면 무기 표시 — 설계 문서

- 브랜치: `shape-battle` (base: `video-demo`)
- 관련 문서: `docs/superpowers/specs/2026-08-05-battle-system-design.md`(대전 시스템), `docs/superpowers/specs/2026-08-05-weapon-crafting-design.md`(무기 제작)
- 작성일: 2026-08-05

## 배경

대전 화면(`frontend/src/screens/battle.js`)은 지금 캐릭터를 색깔 원 + 체력바 + 캐릭터 번호 라벨로만 그린다. 참가자가 제작 화면에서 직접 만든 무기(도형 조합)는 `weapon.parts`로 서버에 저장돼 있지만, 대전 화면까지는 전달되지 않는다 — `backend/socket/battle.js`의 `startBattleRoom`은 `weapon.damage`만 뽑아서 `hitDamage`로 쓰고 `parts`는 버린다. 참가자가 직접 만든 무기를 대전 중에도 눈으로 볼 수 있게, 캐릭터가 자기 무기를 든 것처럼 작게 그려 붙인다.

## 스코프

**이번 스펙에 포함**
1. `shapes/weaponRenderer.js` 신규 — 부품(parts) 배열의 bounding box 계산(순수 함수) + Konva로 축소된 무기 아이콘을 그리는 함수
2. `backend/socket/battle.js` — `battleRoom.players[id]`에 `weaponParts` 필드 추가, 기존 `battle:state` 브로드캐스트에 실어 보냄
3. `frontend/src/screens/battle.js` — 캐릭터 노드 생성 시 무기 아이콘도 같이 만들어 캐싱, 매 틱 `facing` 방향 오프셋 위치 갱신, 사망 시 투명도 처리

**이번 스펙에서 명시적으로 제외**
- `create.js`(제작 화면)나 `result.js`(결과 화면)에서 `weaponRenderer.js`를 실제로 가져다 쓰는 것 — 지금 당장은 대전 화면에만 연결한다. 다만 이 파일을 `frontend/src/screens/create/` 같은 특정 화면 하위가 아니라 `shapes/`에 두는 이유가 바로 이 재사용을 위해서다 (결과 확인 페이지가 나중에 Vercel에 별도로 배포될 예정이라 그때 그대로 가져다 쓸 수 있게).
- 무기가 `facing`에 맞춰 회전하는 것(예: 위를 보면 무기도 위쪽을 향하게) — 이번엔 위치 오프셋만, 회전은 범위 밖
- 부품 개별 애니메이션(휘두르기 등) — 정적 표시만

## 데이터 흐름

```
backend/socket/battle.js (startBattleRoom)
  participant.weapon.parts
    → battleRoom.players[id].weaponParts = participant.weapon?.parts ?? []
    → (기존 그대로) io.emit('battle:state', battleRoom) — 매 틱(20Hz) 브로드캐스트

frontend/src/screens/battle.js (onState 핸들러)
  최초 진입 시(entry가 없을 때):
    weaponRenderer.drawWeaponGroup(p.weaponParts, { targetSize: CHARACTER_RADIUS })
      → Konva.Group 반환, entry.weaponGroup으로 캐싱
  매 틱:
    entry.weaponGroup의 x/y만 갱신 (facing 방향 오프셋 적용)
    entry.weaponGroup.opacity(p.alive ? 1 : 0.2)
```

`weaponParts`는 대전 중 바뀌지 않으므로(무기는 제작 단계에서 확정) 매 틱 그대로 재전송되지만, 클라이언트는 캐릭터 노드를 처음 만들 때 한 번만 Konva 노드로 그리고 이후엔 위치만 갱신한다 — 기존 `circle`/`hpBar`/`label`과 동일한 노드 재사용 패턴(`nodesRef`).

## `shapes/weaponRenderer.js` API

```js
// 부품 전체를 감싸는 bounding box 계산 — 순수 함수, Konva 의존 없음.
// shapes/registry.js의 getShapeGeometry를 재사용해 각 부품의 실제 그려지는 좌표 범위를 구한다.
export function computeWeaponBounds(parts) {
  // parts: [{ shapeId, x, y, rotation, scale }, ...] (create.js/CanvasEditor.js가 쓰는 형태)
  // 반환: { minX, minY, maxX, maxY, width, height } — 부품이 없으면 { minX:0, minY:0, maxX:0, maxY:0, width:0, height:0 }
}

// parts를 받아 Konva.Group으로 그려서 반환한다. Konva에 의존하므로 프론트에서만 import.
export function drawWeaponGroup(parts, { targetSize } = {}) {
  // targetSize: 무기 아이콘의 최종 가로/세로 최댓값(px). 기본값 20 (CHARACTER_RADIUS와 동일).
  // computeWeaponBounds로 전체 bounding box를 구해 scale = targetSize / max(width, height, 1)를 계산하고,
  // 그 scale을 Group 전체에 적용 — 부품 하나하나가 아니라 무기 전체를 통째로 축소한다.
  // 각 부품은 CanvasEditor.js의 drawShapeNode와 같은 방식(getShapeGeometry + sceneFunc)으로 그리되,
  // 원본 캔버스(480x480) 좌표를 그대로 쓰지 않고 bounding box의 좌상단을 (0,0)으로 맞춰서 그린다.
  // 반환된 Group의 x(0)/y(0)이 무기의 좌상단 기준점이 되므로, 호출 측(battle.js)이
  // Group.offsetX/offsetY로 중심을 맞추거나 Group.x()/y()로 원하는 위치에 배치한다.
}
```

`getShapeGeometry`가 `null`을 반환하는(존재하지 않는 shapeId) 부품은 조용히 건너뛴다 — 대전 화면이 무기 하나 때문에 죽으면 안 되므로, 방어적으로 처리하고 그 부품만 생략한다.

## `backend/socket/battle.js` 변경

`startBattleRoom`의 `players[participant.id] = {...}` 객체 리터럴에 필드 하나 추가:

```js
weaponParts: participant.weapon?.parts ?? [],
```

`weapon`이나 `parts`가 없는 참가자(제작 단계 타임아웃으로 기본 무기 처리된 경우 등)는 빈 배열이 되고, 프론트는 빈 배열이면 무기 노드를 아예 만들지 않는다.

## `frontend/src/screens/battle.js` 변경

- `import { drawWeaponGroup } from '../../../shapes/weaponRenderer.js';` 추가
- 캐릭터 노드 최초 생성 블록(`if (!entry) { ... }`)에서 `drawWeaponGroup(p.weaponParts, { targetSize: CHARACTER_RADIUS })` 호출, 반환된 Group을 `layer.add()`, `entry.weaponGroup`으로 저장
- 매 틱 위치 갱신 블록에 오프셋 계산 추가:

```js
const WEAPON_OFFSET = CHARACTER_RADIUS + 4; // 캐릭터 반경 + 여백
const offset = {
  up: { x: 0, y: -WEAPON_OFFSET },
  down: { x: 0, y: WEAPON_OFFSET },
  left: { x: -WEAPON_OFFSET, y: 0 },
  right: { x: WEAPON_OFFSET, y: 0 },
}[p.facing] ?? { x: WEAPON_OFFSET, y: 0 };
entry.weaponGroup.x(p.x + offset.x);
entry.weaponGroup.y(p.y + offset.y);
entry.weaponGroup.opacity(p.alive ? 1 : 0.2);
```

(공격 히트박스 계산인 `backend/lib/battleSimulation.js`의 `attackHitboxRect`가 이미 같은 facing→오프셋 매핑을 쓰고 있음 — 같은 패턴.)

## 테스트 전략

- `shapes/weaponRenderer.test.mjs`(신규, Node 환경에서 순수 함수만 검증): `computeWeaponBounds`가 부품 1개/여러 개/빈 배열에서 올바른 bounding box를 계산하는지, 프랙탈(부품 좌표 점이 많은 `sierpinski`/`koch`)에서도 정상 동작하는지. `drawWeaponGroup`은 Konva가 브라우저 canvas API에 의존하므로 Node 환경 단위 테스트 대상에서 제외(순수 함수인 `computeWeaponBounds`만 테스트).
- `backend/socket/battleIntegration.test.mjs` 확장: `battle:state`로 브로드캐스트되는 각 플레이어 객체에 `weaponParts`가 원래 참가자의 `weapon.parts`와 일치하는지 확인.
- Playwright로 실제 대전 화면 확인: 참가자가 도형을 만들어 대전에 진입했을 때 캐릭터 옆에 무기 아이콘이 나오는지, 이동하면 같이 따라가는지, 사망 시 투명해지는지, 프랙탈(시에르핀스키/코흐눈꽃)로 만든 무기도 정상적으로 축소돼 그려지는지 스크린샷으로 확인.

## 미결 사항

- 무기 아이콘의 `targetSize`(현재 제안값: `CHARACTER_RADIUS`=20px) 실제로 봤을 때 너무 작거나 커 보이면 조정 필요 — 실측 후 판단
- `create.js`/`result.js`가 이 렌더러를 실제로 가져다 쓰는 시점과 방식은 각각의 스펙에서 별도로 다룸
