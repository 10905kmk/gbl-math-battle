# 대전 공격 시스템 — 근접/원거리 판정 + 히트박스/사거리 미리보기

## 배경

지금 대전 공격은 무기 종류와 무관하게 전부 동일하다 — 캐릭터 중심에서 고정 거리(`CHARACTER_RADIUS + ATTACK_HITBOX_SIZE/2`)만큼 떨어진 고정 크기 히트박스가 즉시 판정된다. 이걸 무기 모양에 따라 근접/원거리로 나누고, 원거리는 실제로 투사체가 날아가게 하며, 두 경우 모두 조준 중 실제 판정 범위를 화면에 미리 보여준다(브롤스타즈 스타일).

## 무기 분류 & 사거리 판정 (AI)

지금 `backend/lib/aiClient.js`의 `requestDamageRange`가 무기 구조(부품 목록)를 텍스트로 Gemini에 보내 데미지 범위(min, max)를 받아온다 — 같은 요청/응답에 다음 두 필드를 추가한다:
- `attackRange`: `'melee' | 'ranged'`
- `attackRangeDistance`: 정수, `RANGE_DISTANCE_MIN`(150) ~ `RANGE_DISTANCE_MAX`(600) 범위(월드 픽셀 단위) — `attackRange`가 `'ranged'`일 때만 의미가 있다(근접 무기의 히트박스 거리는 고정이라 이 값을 안 쓴다).

프롬프트에 판단 기준을 문장으로 명시한다: "화살/창/총처럼 던지거나 발사되어 날아가는 무기처럼 보이면 원거리, 검/방패/도끼처럼 손에 들고 휘두르는 무기면 근접. 원거리라면 사거리(짧은 편~긴 편)도 함께 판단하라." 함수명을 `requestDamageRange` → `requestWeaponEvaluation`으로 바꾸고(이제 데미지만 평가하는 게 아니므로), 반환 형태를 `{min, max, attackRange, attackRangeDistance}`로 확장한다.

**캐싱**: 같은 무기는 항상 같은 결과가 나와야 하므로, `backend/lib/weaponCache.js`의 캐시 값을 `number`(damage)에서 `{damage, attackRange, attackRangeDistance}` 객체로 바꾼다(`getCached`/`setCached`/`seedCache` 전부 이 형태를 다룬다). `backend/lib/weaponEvaluationSamples.js`의 기존 few-shot 샘플 3개(검/방패/창)에도 각각 `attackRange: 'melee'`를 채운다(셋 다 손에 들고 쓰는 무기라 근접으로 판단).

**폴백**: AI 호출이 실패하거나(`backend/routes/weaponEvaluate.js`의 catch 경로) `MOCK_AI=true`일 때는 결정론적 규칙으로 대체한다 — `shapes/weaponRenderer.js`의 `computeWeaponBounds(parts)`로 무기 바운딩박스를 구해서, `max(width,height) / max(1,min(width,height))`(가로세로 비율)가 임계값(`ASPECT_RATIO_THRESHOLD`, 2.5)을 넘으면 `'ranged'`(길쭉할수록 사거리도 비례해서 `RANGE_DISTANCE_MIN`~`RANGE_DISTANCE_MAX` 사이로 매핑), 아니면 `'melee'`.

**데이터 흐름**: `/api/weapon/evaluate` 응답에 `attackRange`/`attackRangeDistance` 추가 → `frontend/src/screens/create.js`의 `evaluate()`가 `weapon` 객체에 담아 `create:done`으로 전송 → `backend/socket/battle.js`의 `startBattleRoom`이 `participant.weapon?.attackRange`/`attackRangeDistance`를 읽어 플레이어 상태에 반영한다. AI가 범위 밖 값을 주거나 형식이 이상해도(신뢰 안 함) `RANGE_DISTANCE_MIN`~`MAX`로 clamp하고, `attackRange`가 `'melee'`/`'ranged'` 둘 다 아니면 `'melee'`로 취급한다(기존 프로젝트 전반의 "클라이언트/AI 제공값은 항상 서버가 재검증" 원칙).

## 근접 데미지 보너스

근접 무기는 위험을 감수하고 가까이 가야 하니 원거리보다 데미지가 더 세다. `backend/socket/battle.js`의 `startBattleRoom`에서 플레이어별 `hitScore`를 계산할 때, `attackRange === 'melee'`면 기존 `hitScoreFromWeaponDamage(damage)` 결과에 `MELEE_DAMAGE_MULTIPLIER`(1.3, `backend/lib/battleSimulation.js`에 상수로 추가)를 곱한다. `hitScoreFromWeaponDamage` 함수 자체는 안 바뀐다 — 근접 보너스는 그 결과에 곱해지는 별도 단계다.

## 서버 — 투사체 시스템

`room.projectiles` 배열을 새로 둔다. 원거리 무기가 공격하면(기존 `attackRequested` 소비 로직은 그대로 — 성공 시 무슨 일이 일어나는가만 분기) 즉시 판정 대신 투사체 하나를 생성한다: `{ id, ownerId, x, y, aimX, aimY, traveled: 0, hitScore, maxRange }` — `maxRange`는 그 플레이어의 `attackRangeDistance`(AI가 정한 값)를 그대로 쓴다. 근접 무기는 지금 로직(`attackHitboxRect` 즉시 판정) 그대로 유지한다.

매 틱마다 살아있는 투사체를 조준 방향으로 `PROJECTILE_SPEED`(픽셀/틱, `shapes/attackGeometry.js`에 상수로 정의)만큼 이동시키고 `traveled`를 누적한다. 다음 조건 중 하나면 그 자리에서 소멸한다:
- `traveled >= maxRange` (사거리 소진, 아무 효과 없음)
- 벽과 겹침(`circleOverlapsAnyWall`, 반경 `PROJECTILE_RADIUS`) — 아무 효과 없음
- 자기 자신이 아닌 연결된 플레이어와 겹침(원 판정, 반경 `PROJECTILE_RADIUS + CHARACTER_RADIUS`) — 그 대상에게 점수 반영(기존 근접 판정과 동일: 공격자 `+hitScore`, 대상 `max(0, score-hitScore)`) 후 소멸. 한 발에 한 명만 맞는다(관통 없음, 여러 명이 동시에 겹쳐도 판정 순서상 처음 만난 한 명만).

## 공유 모듈

`shapes/attackGeometry.js`(신규)에 다음을 모은다 — 서버(`backend/lib/battleSimulation.js`)와 프론트(`frontend/src/screens/battle.js`) 양쪽이 그대로 가져다 써서, 미리보기가 실제 판정과 어긋나지 않게 한다:
- 상수: `ATTACK_HITBOX_SIZE`(30), `RANGE_DISTANCE_MIN`(150), `RANGE_DISTANCE_MAX`(600), `ASPECT_RATIO_THRESHOLD`(2.5), `PROJECTILE_SPEED`, `PROJECTILE_RADIUS`.
- `meleeHitboxRect(x, y, aimX, aimY, characterRadius)`: 지금 `battleSimulation.js`의 `attackHitboxRect`와 같은 계산을 그대로 옮긴 것.
- `classifyWeaponRangeFallback(bounds)`: 위 "폴백" 절의 가로세로 비율 규칙 — `{ attackRange, attackRangeDistance }`를 반환. `backend/routes/weaponEvaluate.js`(AI 실패 시)와 `backend/lib/aiClient.js`(MOCK_AI 경로) 양쪽이 이 함수를 쓴다.

`backend/lib/battleSimulation.js`의 `attackHitboxRect`(private 함수)는 제거하고 `meleeHitboxRect` 호출로 대체한다.

## 프론트 — 투사체 렌더링 + 미리보기

`room.projectiles`를 받아 작은 원(Konva.Circle, 반경 `PROJECTILE_RADIUS`)으로 그린다. 캐릭터 노드와 달리 투사체는 계속 생겼다 없어지므로, 매 `battle:state`마다 "이번에 없는 id의 노드는 제거"하는 정리 로직이 필요하다(플레이어 노드는 한 번 생기면 안 사라지는 지금 방식과 다름).

미리보기(텔레그래프)는 조준 중(내 캐릭터의 aimX/aimY가 갱신될 때마다) 항상 표시한다:
- 근접(`isRanged === false`): `meleeHitboxRect`(공유 모듈)로 계산한 자리에 반투명 사각형.
- 원거리(`isRanged === true`): 캐릭터에서 조준 방향으로 **내 무기의 `rangeDistance`만큼**(AI가 정한 값, 무기마다 다름) 뻗는 얇은 반투명 선.

## 스코프 제외

- 투사체 관통(다중 타격) — 한 발에 한 명만.
- 투사체 속도(`PROJECTILE_SPEED`)를 무기별로 다르게 하는 것 — AI는 사거리(거리)만 판단하고, 속도는 전 무기 공통 고정값.
- 근접 무기의 히트박스 거리를 무기별로 다르게 하는 것 — 근접은 지금처럼 고정 오프셋 유지, 데미지 배율만 붙는다.
- 투사체 시각 이펙트(궤적, 회전, 파티클) — 단순한 원 하나로 표시.
- 기존에 캐시/시딩된 데미지 값이 있는 무기들(few-shot 샘플 제외)의 `attackRange` 재평가 — 이번 변경으로 캐시 값 형태가 바뀌므로, 서버 재시작 시 캐시가 비워지는 것으로 충분하고 별도 마이그레이션은 하지 않는다.

## 테스트 범위

- `backend/lib/weaponCache.test.mjs`(기존 파일 수정): 캐시 값이 `{damage, attackRange, attackRangeDistance}` 형태로 저장/조회되는지, `seedCache`가 few-shot 샘플의 `attackRange`도 같이 시딩하는지.
- `backend/routes/weaponEvaluate.test.mjs`(기존 파일 수정): AI 실패 시 폴백 경로가 `attackRange`/`attackRangeDistance`도 결정론적으로 채우는지, `classifyWeaponRangeFallback`이 뾰족하고 긴 무기와 뭉툭한 무기를 각각 올바르게 분류하는지(가로세로 비율 경계값 포함).
- `backend/lib/aiClient.test.mjs`류(기존 파일 수정): `requestWeaponEvaluation`의 응답 스키마에 `attackRange`/`attackRangeDistance`가 포함되고, 값이 없거나 이상한 형식이면 에러를 던지는지(기존 min/max 검증과 같은 패턴).
- `backend/lib/battleSimulation.test.mjs`(대폭 수정): `meleeHitboxRect`가 기존 `attackHitboxRect`와 동일하게 동작하는지, 근접 무기의 `MELEE_DAMAGE_MULTIPLIER` 적용 여부, 원거리 무기의 투사체 스폰/이동/사거리 소진 소멸/벽 충돌 소멸/플레이어 명중(점수 반영 후 소멸)/관통 없음(한 발에 한 명)을 각각 검증.
- `backend/socket/battleIntegration.test.mjs`(일부 수정): `startBattleRoom`이 `participant.weapon`의 `attackRange`/`attackRangeDistance`를 읽어 플레이어 상태(`isRanged`, `rangeDistance`, 보너스 적용된 `hitScore`)에 정확히 반영하는지, 유효하지 않은 값(`attackRange`가 이상한 문자열, `attackRangeDistance`가 범위 밖/비숫자)이 안전하게 clamp/기본값 처리되는지.
- 프론트엔드(투사체 렌더링, 미리보기)는 이 프로젝트의 기존 관례대로 자동화 테스트 없이 라이브 검증(Playwright 등)으로 확인한다.
