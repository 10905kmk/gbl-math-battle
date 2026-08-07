import { Router } from 'express';
import { evaluateWeapon, DAMAGE_MIN, DAMAGE_MAX } from '../lib/aiClient.js';
import { getShapeById } from '../../shapes/registry.js';
import { statsFromShape } from '../../shapes/stats.js';
import { computeWeaponBounds } from '../../shapes/weaponRenderer.js';
import { classifyWeaponRangeFallback } from '../../shapes/attackGeometry.js';
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
    const scale = Number.isFinite(Number(p?.scale)) ? Number(p.scale) : 1;
    const stats = statsFromShape(shape);
    return sum + (stats.attack + stats.defense) * scale;
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

const router = Router();

router.post('/', async (req, res) => {
  const { weaponState } = req.body ?? {};
  const validation = validateWeaponState(weaponState);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }
  try {
    const { damage, attackRange, attackRangeDistance } = await evaluateWeapon(weaponState);
    res.json({ damage, attackRange, attackRangeDistance });
  } catch (err) {
    logError('weaponEvaluate', err);
    const { attackRange, attackRangeDistance } = fallbackAttackRange(weaponState);
    res.json({ damage: fallbackDamage(weaponState), attackRange, attackRangeDistance, fallback: true });
  }
});

export default router;
