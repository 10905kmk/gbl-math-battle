import { Router } from 'express';
import { generateWeapon } from '../lib/aiClient.js';

const router = Router();

// POST /api/weapon — 참가자의 도형 선택 + 자연어 설명을 받아 AI로 무기를 생성
router.post('/', async (req, res) => {
  const { shape, description } = req.body;
  try {
    const weapon = await generateWeapon({ shape, description });
    res.json(weapon);
  } catch (err) {
    res.status(502).json({ error: 'weapon generation failed' });
  }
});

export default router;
