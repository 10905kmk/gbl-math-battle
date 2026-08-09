import { Router } from 'express';
import {
  addApiKey,
  detectApiKeyProvider,
  getAllApiCredentials,
  getAllApiKeyStatus,
} from '../lib/apiKeys.js';
import { getAiSlotStatus } from '../lib/aiSlotManager.js';
import { logError } from '../lib/errorLog.js';

const router = Router();

// 최소 인증: ADMIN_PASSWORD + 세션 쿠키. docs/초안.md 6-7 참고.
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'invalid password' });
  }
  res.json({ ok: true });
});

router.get('/api-keys', (req, res) => {
  res.json(getAllApiKeyStatus());
});

router.get('/ai-slots', (req, res) => {
  res.json(getAiSlotStatus(getAllApiCredentials()));
});

router.post('/api-keys', (req, res) => {
  const { password, apiKey } = req.body ?? {};
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: '관리자 비밀번호가 올바르지 않습니다.' });
  }
  try {
    const provider = detectApiKeyProvider(apiKey);
    if (!provider) throw new Error('지원하는 Gemini, GitHub Models 또는 OpenRouter 키 형식이 아닙니다.');
    const result = addApiKey(provider, apiKey);
    return res.status(result.added ? 201 : 200).json({
      ...getAllApiKeyStatus(),
      added: result.added,
      addedProvider: provider,
    });
  } catch (err) {
    logError('adminApiKey', err);
    return res.status(400).json({ error: err instanceof Error ? err.message : 'API 키를 저장하지 못했습니다.' });
  }
});

export default router;
