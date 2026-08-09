import assert from 'node:assert';
import {
  ATTACK_HITBOX_SIZE,
  RANGE_DISTANCE_MIN,
  RANGE_DISTANCE_MAX,
  RANGED_COMBAT_RANGE_MULTIPLIER,
  ASPECT_RATIO_THRESHOLD,
  meleeHitboxRect,
  circleOverlapsRotatedRect,
  classifyWeaponRangeFallback,
} from './attackGeometry.js';

assert.strictEqual(RANGED_COMBAT_RANGE_MULTIPLIER, 1.5, '원거리 실전 사거리는 기존 3배의 절반');

// meleeHitboxRect — 캐릭터 중심에서 조준 방향으로 오프셋만큼 떨어진 고정 크기 정사각형,
// 조준 방향으로 회전(angle)까지 반환
{
  const rect = meleeHitboxRect(400, 300, 1, 0, 20);
  assert.strictEqual(rect.centerX, 435, 'centerX=400+(20+15)*1=435');
  assert.strictEqual(rect.centerY, 300, 'centerY=300+(20+15)*0=300');
  assert.strictEqual(rect.width, ATTACK_HITBOX_SIZE);
  assert.strictEqual(rect.height, ATTACK_HITBOX_SIZE);
  assert.strictEqual(rect.angle, 0, 'aimX=1,aimY=0(오른쪽) -> angle 0');
  console.log('meleeHitboxRect computes offset+rotated rect in aim direction: OK');
}
{
  const rect = meleeHitboxRect(400, 300, 0, 1, 20);
  assert.strictEqual(rect.centerX, 400, 'centerX=400+(20+15)*0=400');
  assert.strictEqual(rect.centerY, 335, 'centerY=300+(20+15)*1=335');
  assert.strictEqual(rect.angle, Math.PI / 2, 'aimX=0,aimY=1(아래) -> angle 90도');
  console.log('meleeHitboxRect angle follows aim direction: OK');
}

// circleOverlapsRotatedRect — 회전 여부에 따라 같은 점이라도 충돌 결과가 달라져야 한다
// (회전이 실제로 판정에 반영되는지 확인). width=40(로컬 x축), height=10(로컬 y축)인
// 사각형을 원점에 두고, 회전 전엔 안 겹치던 점이 90도 회전 후엔 겹치는지 검증.
{
  const flat = { centerX: 0, centerY: 0, width: 40, height: 10, angle: 0 };
  assert.strictEqual(circleOverlapsRotatedRect(0, 15, 1, flat), false, '회전 전: y=15는 half-height(5) 밖 -> 안 겹침');
  const rotated = { ...flat, angle: Math.PI / 2 };
  assert.strictEqual(circleOverlapsRotatedRect(0, 15, 1, rotated), true, '90도 회전 후: 원래 폭(half=20)이 y축으로 옮겨져서 겹침');
  console.log('circleOverlapsRotatedRect: rotation changes collision result as expected: OK');
}

// classifyWeaponRangeFallback — 가로세로 비율이 낮으면(뭉툭함) 근접, distance는 null
{
  const result = classifyWeaponRangeFallback({ width: 100, height: 90 });
  assert.strictEqual(result.attackRange, 'melee');
  assert.strictEqual(result.attackRangeDistance, null);
  console.log('classifyWeaponRangeFallback: compact bounds -> melee: OK');
}

// 가로세로 비율이 높으면(길쭉함) 원거리, 사거리는 min~max 범위 안
{
  const result = classifyWeaponRangeFallback({ width: 400, height: 40 });
  assert.strictEqual(result.attackRange, 'ranged');
  assert.ok(result.attackRangeDistance >= RANGE_DISTANCE_MIN && result.attackRangeDistance <= RANGE_DISTANCE_MAX);
  console.log('classifyWeaponRangeFallback: elongated bounds -> ranged with distance in range: OK');
}

// 경계값 바로 위/아래
{
  const justMelee = classifyWeaponRangeFallback({ width: ASPECT_RATIO_THRESHOLD, height: 1 });
  assert.strictEqual(justMelee.attackRange, 'melee', '비율이 임계값과 같으면(초과 아님) 근접');
  const justRanged = classifyWeaponRangeFallback({ width: ASPECT_RATIO_THRESHOLD + 0.01, height: 1 });
  assert.strictEqual(justRanged.attackRange, 'ranged', '비율이 임계값을 살짝 넘으면 원거리');
  console.log('classifyWeaponRangeFallback: threshold boundary: OK');
}

// 방어: bounds가 없거나 비어있어도(예: 부품이 하나도 없는 무기) 크래시 없이 근접으로 처리
{
  assert.doesNotThrow(() => classifyWeaponRangeFallback(undefined));
  assert.strictEqual(classifyWeaponRangeFallback(undefined).attackRange, 'melee');
  assert.strictEqual(classifyWeaponRangeFallback({ width: 0, height: 0 }).attackRange, 'melee');
  console.log('classifyWeaponRangeFallback tolerates missing/empty bounds: OK');
}

console.log('attackGeometry.test.mjs: OK');
