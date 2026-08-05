import { Router } from 'express';
import { evaluateWeapon, DAMAGE_MIN, DAMAGE_MAX } from '../lib/aiClient.js';
import { getShapeById } from '../../shapes/registry.js';
import { statsFromShape } from '../../shapes/stats.js';

// AI 채점이 전부 실패했을 때 쓰는 결정론적 폴백 — 참가자가 절대 막히지 않게 한다.
export function fallbackDamage(weaponState) {
  const total = weaponState.parts.reduce((sum, p) => {
    const shape = getShapeById(p.shapeId);
    const stats = statsFromShape(shape);
    return sum + (stats.attack + stats.defense) * p.scale;
  }, 0);
  return Math.round(Math.min(DAMAGE_MAX, Math.max(DAMAGE_MIN, total * 100)));
}

const router = Router();

router.post('/', async (req, res) => {
  const { weaponState } = req.body;
  try {
    const { damage } = await evaluateWeapon(weaponState);
    res.json({ damage });
  } catch (err) {
    res.json({ damage: fallbackDamage(weaponState), fallback: true });
  }
});

export default router;
