import { Router, type Request, type Response } from 'express';
import {
  GARBAGE_TYPES,
  parseHiddenGarbageTypes,
  findNextGarbageDay,
  getTodayJST,
  type GarbageTypeId,
} from '@household-tasks/shared';
import { getDb } from '../db.js';
import { getNowISO } from '../test-time.js';

const router: ReturnType<typeof Router> = Router();

const SETTING_KEY = 'garbage_hidden_types';

const VALID_TYPE_IDS = new Set<string>(GARBAGE_TYPES.map((t) => t.id));

function readHiddenTypes(db: ReturnType<typeof getDb>): GarbageTypeId[] {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SETTING_KEY) as
    | { value: string }
    | undefined;
  return parseHiddenGarbageTypes(row?.value);
}

/** ごみ捨てタスク定義（special_kind='garbage'）の起票曜日を返す。無ければ null */
function readGarbageTaskDays(db: ReturnType<typeof getDb>): string[] | null {
  const row = db.prepare(
    "SELECT days_of_week FROM task_definitions WHERE special_kind = 'garbage' AND is_active = 1 LIMIT 1"
  ).get() as { days_of_week: string | null } | undefined;
  if (!row?.days_of_week) return null;
  return row.days_of_week.split(',').map((d) => d.trim()).filter(Boolean);
}

// GET /api/garbage — 種類一覧・非表示設定・次回の収集日
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const hiddenTypes = readHiddenTypes(db);
  const taskDays = readGarbageTaskDays(db);
  const next = findNextGarbageDay(getTodayJST(), hiddenTypes, taskDays ?? undefined);

  res.json({
    types: GARBAGE_TYPES,
    hiddenTypes,
    next,
  });
});

// PUT /api/garbage — 非表示にする種類を保存
router.put('/', (req: Request, res: Response) => {
  const { hiddenTypes } = req.body ?? {};

  if (!Array.isArray(hiddenTypes) || hiddenTypes.some((t) => typeof t !== 'string' || !VALID_TYPE_IDS.has(t))) {
    res.status(400).json({ error: 'hiddenTypes must be an array of valid garbage type ids' });
    return;
  }

  // 重複を除いて保存順を安定させる（設定の差分が見やすくなる）
  const normalized = GARBAGE_TYPES.filter((t) => hiddenTypes.includes(t.id)).map((t) => t.id);

  const db = getDb();
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(SETTING_KEY, JSON.stringify(normalized), getNowISO());

  const taskDays = readGarbageTaskDays(db);
  const next = findNextGarbageDay(getTodayJST(), normalized, taskDays ?? undefined);

  res.json({ hiddenTypes: normalized, next });
});

export default router;
