# 배틀로얄 점수제 전투 재설계

## 배경

지금 4단계 대전(`backend/lib/battleSimulation.js`)은 HP=100/사망 기반이다 — 공격에 맞으면 HP가 깎이고, HP가 0이 되면 `alive=false`로 탈락 처리되며 공격 대상/승리 후보에서 제외된다. 승리는 "생존자 1명 이하가 되는 순간" 또는 "제한시간(90초) 종료 시점 생존자 중 최고 HP"로 판정한다.

이걸 다음 방식으로 바꾼다: 탈락 없이 전원이 제한시간 끝까지 참여하고, 맞히면 점수를 얻고 맞으면 점수를 잃는 누적 점수제로 승부를 낸다. 맵(브롤스타즈 스타일, 좀비고 테마, 벽/장애물 포함)은 팀이 별도로 제작 중이라 이번 스코프에는 포함하지 않는다 — 지금의 단순 사각형 벽 3개(`DEFAULT_MAP.walls`)를 그대로 쓴다.

## 데이터 모델 변경

`room.players[id]`에서:
- `hp`(number, 100 시작) → 제거
- `alive`(boolean) → `connected`(boolean, `true`로 시작) — 의미가 "생존 여부"에서 "접속 여부"로 바뀐다. 연결이 끊긴 참가자는 지금과 마찬가지로 공격 대상에서 제외되고 화면에서 흐리게 표시되지만, 더 이상 "죽는" 것이 아니라 "조작 불가 상태로 그 자리에 멈춰 있는" 것이다.
- 새 필드 `score`(number, `0`으로 시작) 추가.

이동/공격 히트박스/쿨다운(`ATTACK_COOLDOWN_MS`, `ATTACK_HITBOX_SIZE`)은 그대로 유지 — 바뀌는 건 "맞았을 때 무슨 일이 일어나는가"뿐이다.

## 점수 계산

새 상수 `HIT_SCORE_COEFFICIENT = 0.05`. 새 함수 `hitScoreFromWeaponDamage(weaponDamage)`가 기존 `hitDamageFromWeaponDamage`를 대체한다 — 무기 데미지(1~10000, 클라이언트 제공값이라 숫자가 아닐 수도 있음)를 받아 `round(weaponDamage × HIT_SCORE_COEFFICIENT)`를 돌려주되, 숫자가 아니면 안전한 기본값으로 대체한다(기존 NaN 가드 패턴 유지).

공격자 A가 대상 B를 맞히면:
- `delta = hitScoreFromWeaponDamage(A.weaponDamage)`
- `A.score += delta`
- `B.score = max(0, B.score - delta)`

한 틱에 A가 여러 명을 동시에 맞히면(히트박스가 여러 대상과 겹치는 경우) 각 대상마다 독립적으로 위 계산이 적용되고, A의 점수는 맞힌 인원수만큼 여러 번 증가한다(기존 코드도 이미 이런 다중 타격을 허용하는 구조라 그대로 따름).

## 승리 판정

"생존자 1명 이하" 분기를 완전히 제거한다. 제한시간(`room.endsAt`) 종료 시점에만 승패를 가른다:
- 전체 참가자(연결이 끊긴 참가자 포함 — 기존 타임아웃 판정이 "끊긴 사람은 최고 HP 후보에서만 제외"했던 것과 달리, 이제는 죽는 개념이 없으므로 끊긴 사람도 자기 점수 그대로 후보에 포함된다) 중 최고 점수를 찾는다.
- 그 점수와 같은 점수를 가진 참가자 전원이 공동 승리.

라운드 도중에는 절대 `status`가 `'ended'`로 안 바뀐다 — 지금처럼 조기 종료(생존자 1명) 분기가 없어졌기 때문에, 매 라운드가 항상 90초를 꽉 채운다.

## UI 변경

`frontend/src/screens/battle.js`:
- HP 바(`entry.hpBar`) 관련 코드를 제거.
- 캐릭터 옆에 현재 점수를 숫자 텍스트로 표시하는 노드를 추가(캐릭터 이름표와 비슷한 위치/스타일).
- 캐릭터/이름표/무기 아이콘의 투명도 처리(`p.alive ? 1 : 0.2`)를 `p.connected ? 1 : 0.2`로 이름만 바꾼다 — 시각적 동작은 동일.

## 결과 저장

`backend/lib/supabase/schema.sql`의 `results` 테이블에 `score integer` 컬럼을 추가한다(사용자가 Supabase SQL Editor에서 직접 `alter table results add column score integer;` 실행 필요 — 이 스펙은 SQL 문구만 준비하고 실제 실행은 사용자 몫).

`backend/lib/resultStorage.js`의 `saveParticipantResults(participants, winners, ...)`는 지금 `winners` 배열(참가자 id 목록)만 받는데, 점수를 저장하려면 참가자별 최종 점수도 필요하다. 시그니처를 `saveParticipantResults(participants, winners, scores, ...)`로 확장한다 — `scores`는 `{ [participantId]: number }` 형태. `session.js`가 대전 종료 콜백(`onEnd`)에서 `winners`와 함께 최종 `room.players`의 점수 스냅샷을 넘겨준다.

## 스코프 제외

- 맵 이미지/장애물 배치 교체 — 팀이 별도로 준비 중, 이번 스펙 대상 아님.
- 히트/피격 시각 효과(화면 흔들림, 데미지 숫자 팝업 등) — 지금 범위에 없던 것이라 이번에도 추가하지 않는다.
- 점수 상한 — 사용자가 명시한 건 하한(0)뿐이라 상한은 두지 않는다.

## 테스트 범위

- `backend/lib/battleSimulation.test.mjs`(기존 파일 대폭 수정): HP/사망/생존자 판정 테스트를 전부 점수 기반으로 다시 쓴다 — `hitScoreFromWeaponDamage` 단위 테스트, 맞았을 때 점수 증감 검증, 점수가 0 밑으로 안 내려가는 것, 제한시간 전엔 몇 대를 맞아도 `winners`가 `null`인 것(탈락 없음의 핵심 증거), 제한시간 종료 시 최고 점수 승리, 동점 시 전원 공동 승리.
- `backend/socket/battleIntegration.test.mjs`(기존 파일 일부 수정): `alive`/`hp` 관련 단언을 `connected`/`score`로 갱신.
- `backend/lib/resultStorage.test.mjs`(기존 파일 일부 수정): `saveParticipantResults`의 새 `scores` 파라미터가 저장 payload의 `score` 필드로 정확히 전달되는지 검증.
