import { Router } from 'express';
import { saveResult } from '../lib/supabaseClient.js';

const router = Router();

// POST /api/result — 완성된 결과(도형/무기/스탯)를 Supabase에 저장
router.post('/', async (req, res) => {
  try {
    const saved = await saveResult(req.body);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: 'result save failed' });
  }
});

export default router;
