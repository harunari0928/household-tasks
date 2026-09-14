import { Router, type Request, type Response } from 'express';
import { getTodayJST } from '@household-tasks/shared';
import { getDb } from '../db.js';
import { getNowISO } from '../test-time.js';

/**
 * 家族カレンダーの予定（日付に展開済み）。カレンダー連動タスクの判定材料。
 *
 * 行を入れるのは Home Assistant の同期（`absence_sync.py`）だけで、このアプリは
 * 「予定名 → 起票するか」の判定（タスク定義の calendar_keywords）だけを持つ。
 * 予定の期間を日付に展開する処理（終日予定の end 排他など）は HA 側にしか無い。
 */
const router: ReturnType<typeof Router> = Router();

/**
 * 最終同期時刻は行ではなく app_settings に持つ。全置換の同期は「予定が1件も無い」ときに
 * 表を空にするので、行の updated_at から取ると正常な同期を「まだ同期されていない」と誤表示する。
 */
const SYNCED_AT_KEY = 'calendar_days_synced_at';

function readLastSyncedAt(db: ReturnType<typeof getDb>): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SYNCED_AT_KEY) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export type CalendarDayRow = {
  date: string;
  summary: string;
};

// GET /api/calendar-days — 今日以降の予定と最終同期時刻（同期が止まっていないか見るため）
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const today = getTodayJST();

  const days = db.prepare(
    'SELECT date, summary FROM calendar_days WHERE date >= ? ORDER BY date ASC, summary ASC'
  ).all(today) as CalendarDayRow[];

  res.json({ days, lastSyncedAt: readLastSyncedAt(db) });
});

/**
 * POST /api/calendar-days — 予定を入れ替える（Home Assistant の同期用）。
 *
 * `source='calendar'` の行を**全て置き換える**冪等な操作（不在日の同期と同じ方式）。
 * 差分更新にしないのは、カレンダーから予定が消えた（来客が中止になった）ときに
 * 古い予定が残って起票され続けるのを防ぐため。
 */
router.post('/', (req: Request, res: Response) => {
  const { days } = req.body ?? {};

  if (!Array.isArray(days)) {
    res.status(400).json({ error: 'days must be an array' });
    return;
  }

  const parsed: CalendarDayRow[] = [];
  for (const entry of days) {
    const date = entry?.date;
    const summary = entry?.summary;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: `invalid date: ${JSON.stringify(entry)}` });
      return;
    }
    if (typeof summary !== 'string' || summary.trim().length === 0) {
      res.status(400).json({ error: `invalid summary: ${JSON.stringify(entry)}` });
      return;
    }
    parsed.push({ date, summary: summary.trim() });
  }

  const db = getDb();
  const now = getNowISO();

  const replace = db.transaction(() => {
    db.prepare("DELETE FROM calendar_days WHERE source = 'calendar'").run();
    const insert = db.prepare(`
      INSERT INTO calendar_days (date, summary, source, updated_at)
      VALUES (?, ?, 'calendar', ?)
      ON CONFLICT(date, summary) DO UPDATE SET updated_at = excluded.updated_at
    `);
    for (const day of parsed) {
      insert.run(day.date, day.summary, now);
    }
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(SYNCED_AT_KEY, now, now);
  });
  replace();

  res.json({ count: parsed.length, lastSyncedAt: now });
});

export default router;
