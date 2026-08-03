import { Router } from 'express';

const router = Router();

// 최소 인증: ADMIN_PASSWORD + 세션 쿠키. docs/초안.md 6-7 참고.
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'invalid password' });
  }
  res.json({ ok: true });
});

export default router;
