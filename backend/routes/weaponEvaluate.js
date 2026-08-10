import { Router } from 'express';
import { evaluateWeapon, DAMAGE_MIN, DAMAGE_MAX } from '../lib/aiClient.js';
import { getShapeById, partScale } from '../../shapes/registry.js';
import { statsFromShape } from '../../shapes/stats.js';
import { computeWeaponBounds } from '../../shapes/weaponRenderer.js';
import {
  classifyWeaponRangeFallback,
  RANGE_DISTANCE_MIN,
  RANGE_DISTANCE_MAX,
} from '../../shapes/attackGeometry.js';
import { validateWeaponState } from '../lib/weaponStateValidation.js';
import { logError } from '../lib/errorLog.js';

// AI 채점이 전부 실패했을 때 쓰는 결정론적 폴백 — 참가자가 절대 막히지 않게 한다.
// sqrt로 스케일해서 부품이 5개 안팎만 돼도 바로 최댓값(10000)에 포화되지 않게 한다 —
// 예전 total*100 방식은 부품 1개=2000, 5개부터는 전부 10000으로 뭉개져서 부품을 많이
// 붙일수록 결과가 다 똑같아지는 문제가 있었다(Opus 리뷰 Important #4).
// weaponState 자체는 라우트 진입점에서 이미 validateWeaponState로 걸러지지만, 이 함수는
// 그 검증 없이 직접 호출될 수도 있으므로(예: 미래에 다른 경로에서 재사용) 여기서도
// 한 번 더 방어한다 — 특히 이 함수가 크래시하면 catch 블록 안에서 또 던지는 것이라
// Critical #1과 똑같은 방식으로 서버가 죽는다.
export function fallbackDamage(weaponState) {
  const parts = weaponState?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return DAMAGE_MIN;
  const total = parts.reduce((sum, p) => {
    const shape = getShapeById(p?.shapeId);
    if (!shape) return sum;
    // 가로/세로를 따로 늘릴 수 있게 된 뒤로(자유 변형) 옛 단일 scale 필드는 클라이언트가
    // 더 이상 보내지 않는다 — partScale()로 읽어야 실제 크기가 반영된다. 안 그러면 이
    // 폴백은 항상 sx=sy=1로 취급해, 부품을 아무리 키워도 데미지가 안 오른다(Opus 리뷰
    // Critical #2, 2026-08-10). 면적 개념으로 sx*sy를 곱한다 — 다른 곳(aiClient.js 등)의
    // partScale 사용과 같은 축이다.
    const { sx, sy } = partScale(p);
    const stats = statsFromShape(shape);
    return sum + (stats.attack + stats.defense) * sx * sy;
  }, 0);
  const damage = Math.sqrt(total) * 450;
  if (!Number.isFinite(damage)) return DAMAGE_MIN;
  return Math.round(Math.min(DAMAGE_MAX, Math.max(DAMAGE_MIN, damage)));
}

// AI 채점 실패 시 근접/원거리도 결정론적으로 정해야 한다 — shapes/attackGeometry.js의
// 가로세로 비율 규칙을 그대로 쓴다(MOCK_AI 경로도 같은 함수를 씀, aiClient.js 참고). fallbackDamage와
// 같은 이유로 이 함수도 절대 던지지 않는다 — computeWeaponBounds/classifyWeaponRangeFallback
// 둘 다 이미 malformed 입력을 방어하므로 별도 방어 코드는 안 붙인다.
export function fallbackAttackRange(weaponState) {
  const bounds = computeWeaponBounds(weaponState?.parts);
  return classifyWeaponRangeFallback(bounds);
}

export function resolveAttackRangeSelection(selection, evaluatedRange, evaluatedDistance) {
  const attackRange = selection === 'melee' || selection === 'ranged'
    ? selection
    : evaluatedRange === 'ranged' ? 'ranged' : 'melee';
  if (attackRange !== 'ranged') {
    return { attackRange: 'melee', attackRangeDistance: null };
  }
  const rawDistance = Number(evaluatedDistance);
  const attackRangeDistance = Number.isFinite(rawDistance)
    ? Math.min(RANGE_DISTANCE_MAX, Math.max(RANGE_DISTANCE_MIN, rawDistance))
    : RANGE_DISTANCE_MIN;
  return { attackRange: 'ranged', attackRangeDistance };
}

const router = Router();

router.post('/', async (req, res) => {
  const { weaponState, attackRange: selectedAttackRange } = req.body ?? {};
  const validation = validateWeaponState(weaponState);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }
  try {
    const { damage, attackRange, attackRangeDistance } = await evaluateWeapon(weaponState);
    const selected = resolveAttackRangeSelection(selectedAttackRange, attackRange, attackRangeDistance);
    res.json({ damage, ...selected });
  } catch (err) {
    logError('weaponEvaluate', err);
    const fallback = fallbackAttackRange(weaponState);
    const selected = resolveAttackRangeSelection(
      selectedAttackRange,
      fallback.attackRange,
      fallback.attackRangeDistance,
    );
    res.json({ damage: fallbackDamage(weaponState), ...selected, fallback: true });
  }
});

export default router;
