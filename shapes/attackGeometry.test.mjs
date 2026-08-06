import assert from 'node:assert';
import {
  ATTACK_HITBOX_SIZE,
  RANGE_DISTANCE_MIN,
  RANGE_DISTANCE_MAX,
  ASPECT_RATIO_THRESHOLD,
  meleeHitboxRect,
  classifyWeaponRangeFallback,
} from './attackGeometry.js';

// meleeHitboxRect — 캐릭터 중심에서 조준 방향으로 오프셋만큼 떨어진 고정 크기 정사각형
{
  const rect = meleeHitboxRect(400, 300, 1, 0, 20);
  assert.strictEqual(rect.x, 420, 'centerX=400+(20+15)=435, rect.x=435-15=420');
  assert.strictEqual(rect.y, 285, 'centerY=300+0=300, rect.y=300-15=285');
  assert.strictEqual(rect.width, ATTACK_HITBOX_SIZE);
  assert.strictEqual(rect.height, ATTACK_HITBOX_SIZE);
  console.log('meleeHitboxRect computes offset rect in aim direction: OK');
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
