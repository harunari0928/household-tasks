import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { getDb } from '../db.js';
import { getNowISO } from '../test-time.js';
import { broadcast } from './kanban.js';

const router: ReturnType<typeof Router> = Router();

const SETTING_KEY = 'sick_child_mode';

export function isSickModeEnabled(db: Database.Database): boolean {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SETTING_KEY) as
    | { value: string }
    | undefined;
  return row?.value === '1';
}

function toJSTDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// モードON時に風邪の日専用タスクを当日分として即時起票する。
// 起票時刻（scheduled_hour）が到来しているタスクのみ対象（残りは毎時のスケジューラが時刻到来後に起票）。
// 未完了インスタンスが残っている、または当日(JST)に完了済みのタスクは二重起票しない
function createSickDayInstances(db: Database.Database): number {
  const now = getNowISO();
  const todayJST = toJSTDate(now);
  const currentHourJST = new Date(new Date(now).getTime() + 9 * 60 * 60 * 1000).getUTCHours();

  const defs = db.prepare(
    "SELECT * FROM task_definitions WHERE is_active = 1 AND sick_day_behavior = 'sick_only' AND scheduled_hour <= ?"
  ).all(currentHourJST) as { id: number; name: string; points: number }[];

  let created = 0;
  const createAll = db.transaction(() => {
    for (const def of defs) {
      const existing = db.prepare(`
        SELECT 1 FROM task_instances
        WHERE task_definition_id = ?
          AND (status != 'done' OR date(completed_at, '+9 hours') = ?)
        LIMIT 1
      `).get(def.id, todayJST);
      if (existing) continue;

      const maxRow = db.prepare(
        "SELECT COALESCE(MAX(sort_order), -1) as max_order FROM task_instances WHERE status = 'todo'"
      ).get() as { max_order: number };

      const result = db.prepare(
        "INSERT INTO task_instances (task_definition_id, title, status, points, created_at, sort_order) VALUES (?, ?, 'todo', ?, ?, ?)"
      ).run(def.id, def.name, def.points, now, maxRow.max_order + 1);

      db.prepare(
        "INSERT INTO execution_log (task_definition_id, task_instance_id, status, executed_at) VALUES (?, ?, 'created', ?)"
      ).run(def.id, result.lastInsertRowid, todayJST);

      created++;
    }
  });
  createAll();

  return created;
}

// GET /api/sick-mode — current mode state
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  res.json({ enabled: isSickModeEnabled(db) });
});

// PUT /api/sick-mode — toggle mode; creates sick-day task instances when enabling
router.put('/', (req: Request, res: Response) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }

  const db = getDb();
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(SETTING_KEY, enabled ? '1' : '0', getNowISO());

  const created = enabled ? createSickDayInstances(db) : 0;

  broadcast({ type: 'sick_mode_changed', enabled });
  res.json({ enabled, created });
});

export default router;
