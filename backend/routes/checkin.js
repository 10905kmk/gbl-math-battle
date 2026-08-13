import { Router } from 'express';
import { fetchUser } from '../lib/boothApi.js';
import { consumeCheckinList } from '../socket/checkin.js';

const router = Router();

router.get('/user/:uid', async (req, res) => {
  const result = await fetchUser(req.params.uid);
  if (!result.ok) {
    return res.status(result.status ?? 502).json({ error: result.message });
  }
  res.json({ name: result.name, profile_image: result.profile_image });
});

router.post('/consume', async (req, res) => {
  const results = await consumeCheckinList();
  res.json({ results });
});

export default router;
