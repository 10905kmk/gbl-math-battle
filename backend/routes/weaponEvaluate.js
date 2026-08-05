import { Router } from 'express';
import { evaluateWeapon, DAMAGE_MIN, DAMAGE_MAX } from '../lib/aiClient.js';
import { getShapeById } from '../../shapes/registry.js';
import { statsFromShape } from '../../shapes/stats.js';
import { validateWeaponState } from '../lib/weaponStateValidation.js';

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

const router = Router();

router.post('/', async (req, res) => {
  const { weaponState } = req.body ?? {};
  const validation = validateWeaponState(weaponState);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }
  try {
    const { damage } = await evaluateWeapon(weaponState);
    res.json({ damage });
  } catch (err) {
    console.error('[weaponEvaluate] AI 평가 실패, fallback으로 대체:', err);
    res.json({ damage: fallbackDamage(weaponState), fallback: true });
  }
});

export default router;
