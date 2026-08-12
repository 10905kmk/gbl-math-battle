// 공격 히트박스/사거리 관련 상수와 순수 함수 — 백엔드(backend/lib/battleSimulation.js)와
// 프론트(frontend/src/screens/battle.js) 양쪽이 이 파일을 그대로 import해서 쓴다. 미리보기
// (텔레그래프)가 실제 판정과 어긋나지 않으려면 계산식이 한 곳에만 있어야 한다 — shapes/battleMap.js
// 와 같은 이유의 단일 소스 원칙.
export const ATTACK_HITBOX_SIZE = 30;
// 근접 무기의 조준 방향 도달 길이. 기존 30px에서 1.5배인 45px로 확장한다.
// 좌우 폭은 ATTACK_HITBOX_SIZE를 유지해 옆에 있는 대상까지 과도하게 맞지 않게 한다.
export const MELEE_ATTACK_LENGTH = ATTACK_HITBOX_SIZE * 1.5;
export const RANGE_DISTANCE_MIN = 150;
export const RANGE_DISTANCE_MAX = 600;
// AI 평가/저장 값은 유지하되, 원거리 우세를 줄이기 위해 실전 배율을 기존 3배의 절반으로 조정.
export const RANGED_COMBAT_RANGE_MULTIPLIER = 1.5;
export const ASPECT_RATIO_THRESHOLD = 2.5;
export const PROJECTILE_SPEED = 12;
export const PROJECTILE_RADIUS = 8;

// frontend/src/screens/create/CanvasEditor.js의 CANVAS_SIZE(480x480)와 일치 — 무기 제작
// 캔버스의 좌표계 크기다. classifyWeaponRangeFallback이 무기의 "길쭉한 정도"를 이 크기
// 기준으로 정규화해서 사거리로 매핑한다.
const CANVAS_MAX_DIM = 480;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// 근접 공격 히트박스 — 캐릭터 중심에서 조준 방향으로 고정 거리만큼 떨어진 지점에 고정
// 크기 정사각형을 조준 방향으로 회전시켜서 둔다(오리엔티드 박스). 무기별로 이 오프셋/크기가
// 달라지지 않는다(근접은 항상 고정 — 데미지 배율만 무기에 따라 달라진다,
// backend/lib/battleSimulation.js의 MELEE_DAMAGE_MULTIPLIER 참고). angle은 라디안이고,
// battle.js의 무기 아이콘 회전(atan2(aimY,aimX))과 같은 좌표계라 미리보기가 캐릭터가 든
// 무기 방향과 시각적으로도 맞아떨어진다.
export function meleeHitboxRect(x, y, aimX, aimY, characterRadius) {
  const offset = characterRadius + MELEE_ATTACK_LENGTH / 2;
  return {
    centerX: x + aimX * offset,
    centerY: y + aimY * offset,
    width: MELEE_ATTACK_LENGTH,
    height: ATTACK_HITBOX_SIZE,
    angle: Math.atan2(aimY, aimX),
  };
}

// 회전된 사각형(rect: {centerX, centerY, width, height, angle}) vs 원 충돌판정 — 원 중심을
// 사각형 회전의 역방향으로 돌려 사각형이 축에 정렬된 것처럼 보이는 "로컬 좌표계"로 옮긴 뒤,
// 기존 clamp 방식(circleRectOverlap과 같은 원리)으로 검사한다. 미리보기(battle.js)와 실제
// 판정(battleSimulation.js)이 항상 같은 결과를 내도록 이 함수 하나만 양쪽에서 공유한다.
export function circleOverlapsRotatedRect(cx, cy, r, rect) {
  const dx = cx - rect.centerX;
  const dy = cy - rect.centerY;
  const cos = Math.cos(rect.angle);
  const sin = Math.sin(rect.angle);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const closestX = clamp(localX, -halfW, halfW);
  const closestY = clamp(localY, -halfH, halfH);
  const distX = localX - closestX;
  const distY = localY - closestY;
  return distX * distX + distY * distY < r * r;
}

// AI 평가가 실패했을 때(할당량 초과 등) 쓰는 결정론적 근접/원거리 분류. 무기 바운딩박스
// (shapes/weaponRenderer.js의 computeWeaponBounds(parts) 반환값)의 가로세로 비율이 길쭉할수록
// (ASPECT_RATIO_THRESHOLD를 "넘으면") 원거리로 판단하고, 그 길쭉한 정도(maxDim)를
// RANGE_DISTANCE_MIN~MAX 사이로 매핑해 사거리로 쓴다. 근접이면 사거리는 안 쓰이므로 null.
export function classifyWeaponRangeFallback(bounds) {
  const width = Number.isFinite(bounds?.width) ? bounds.width : 0;
  const height = Number.isFinite(bounds?.height) ? bounds.height : 0;
  const maxDim = Math.max(width, height);
  const minDim = Math.max(1, Math.min(width, height));
  const aspectRatio = maxDim / minDim;
  if (aspectRatio <= ASPECT_RATIO_THRESHOLD) {
    return { attackRange: 'melee', attackRangeDistance: null };
  }
  const ratio = clamp(maxDim / CANVAS_MAX_DIM, 0, 1);
  const attackRangeDistance = Math.round(RANGE_DISTANCE_MIN + ratio * (RANGE_DISTANCE_MAX - RANGE_DISTANCE_MIN));
  return { attackRange: 'ranged', attackRangeDistance };
}
