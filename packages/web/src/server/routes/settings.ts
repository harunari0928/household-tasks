import { Router, type Request, type Response } from 'express';
import { getDb } from '../db.js';

const router: ReturnType<typeof Router> = Router();

// GET /api/settings
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[];
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json(settings);
});

// PUT /api/settings
router.put('/', (req: Request, res: Response) => {
  const db = getDb();
  const body = req.body as Record<string, string>;

  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: '設定データが不正です' });
    return;
  }

  const upsert = db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  const now = new Date().toISOString();
  const saveAll = db.transaction(() => {
    for (const [key, value] of Object.entries(body)) {
      upsert.run(key, String(value), now);
    }
  });
  saveAll();

  res.json({ success: true });
});

export default router;
