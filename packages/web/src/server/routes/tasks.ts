import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb, getUploadsDir } from '../db.js';
import { getTodayJST } from '@household-tasks/shared';

const router: ReturnType<typeof Router> = Router();

const VALID_CATEGORIES = ['water', 'kitchen', 'floor', 'entrance', 'laundry', 'trash', 'childcare', 'cooking', 'lifestyle'];
const VALID_FREQUENCY_TYPES = ['daily', 'weekly', 'n_days', 'n_weeks', 'monthly', 'n_months', 'yearly', 'nth_weekday_of_month', 'days_after_completion'];
const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
interface TaskInput {
  name: string;
  category: string;
  frequency_type: string;
  frequency_interval?: number;
  days_of_week?: string[];
  day_of_month?: number;
  month_of_year?: number;
  nth_weekday_position?: number;
  period_start_mm?: number | null;
  period_start_dd?: number | null;
  period_end_mm?: number | null;
  period_end_dd?: number | null;
  notes?: string;
  points?: number;
  scheduled_hour?: number;
}

function isValidMonthDay(mm: number, dd: number): boolean {
  if (!Number.isInteger(mm) || mm < 1 || mm > 12) return false;
  if (!Number.isInteger(dd) || dd < 1 || dd > 31) return false;
  const d = new Date(2001, mm - 1, dd);
  return d.getMonth() === mm - 1 && d.getDate() === dd;
}

function validateTaskInput(body: TaskInput): string | null {
  if (!body.name || typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 200) {
    return 'タスク名は1〜200文字で入力してください';
  }
  if (!VALID_CATEGORIES.includes(body.category)) {
    return '無効なカテゴリです';
  }
  if (!VALID_FREQUENCY_TYPES.includes(body.frequency_type)) {
    return '無効な頻度タイプです';
  }
  const ft = body.frequency_type;

  if (ft === 'weekly' || ft === 'n_weeks') {
    if (!body.days_of_week || !Array.isArray(body.days_of_week) || body.days_of_week.length === 0) {
      return '曜日を1つ以上選択してください';
    }
    if (!body.days_of_week.every((d: string) => VALID_DAYS.includes(d))) {
      return '無効な曜日が含まれています';
    }
  }

  if (ft === 'n_days' || ft === 'n_weeks' || ft === 'n_months') {
    if (!body.frequency_interval || typeof body.frequency_interval !== 'number' || body.frequency_interval < 2) {
      return '間隔は2以上の整数で入力してください';
    }
  }

  if (ft === 'days_after_completion') {
    if (
      !body.frequency_interval ||
      typeof body.frequency_interval !== 'number' ||
      !Number.isInteger(body.frequency_interval) ||
      body.frequency_interval < 1
    ) {
      return '完了後の日数は1以上の整数で入力してください';
    }
  }

  if (body.points !== undefined && body.points !== null) {
    if (typeof body.points !== 'number' || !Number.isInteger(body.points) || body.points < 0 || body.points > 10) {
      return 'ポイントは0〜10の整数で入力してください';
    }
  }

  if (ft === 'monthly' || ft === 'n_months' || ft === 'yearly') {
    if (body.day_of_month !== undefined && body.day_of_month !== null) {
      if (typeof body.day_of_month !== 'number' || body.day_of_month < 1 || body.day_of_month > 28) {
        return '日指定は1〜28の範囲で入力してください';
      }
    }
  }

  if (ft === 'yearly') {
    const hasMonth = body.month_of_year !== undefined && body.month_of_year !== null;
    const hasDay = body.day_of_month !== undefined && body.day_of_month !== null;
    if (hasMonth !== hasDay) {
      return '年次タスクの月日指定は、月と日の両方を入力してください';
    }
    if (hasMonth) {
      if (typeof body.month_of_year !== 'number' || body.month_of_year < 1 || body.month_of_year > 12) {
        return '月指定は1〜12の範囲で入力してください';
      }
    }
  }

  if (ft === 'nth_weekday_of_month') {
    if (!body.days_of_week || !Array.isArray(body.days_of_week) || body.days_of_week.length !== 1) {
      return '第N曜日タスクは曜日を1つだけ選択してください';
    }
    if (!VALID_DAYS.includes(body.days_of_week[0])) {
      return '無効な曜日が含まれています';
    }
    if (
      typeof body.nth_weekday_position !== 'number' ||
      !Number.isInteger(body.nth_weekday_position) ||
      body.nth_weekday_position < 1 ||
      body.nth_weekday_position > 5
    ) {
      return '第N曜日の番号は1〜5で指定してください';
    }
  }

  const periodValues = [body.period_start_mm, body.period_start_dd, body.period_end_mm, body.period_end_dd];
  const periodSet = periodValues.filter((v) => v !== undefined && v !== null);
  if (periodSet.length !== 0 && periodSet.length !== 4) {
    return '実行期間は開始・終了の月日4つすべてを指定してください';
  }
  if (periodSet.length === 4) {
    if (ft === 'yearly') {
      return '1年毎の頻度では実行期間を指定できません';
    }
    if (!isValidMonthDay(body.period_start_mm as number, body.period_start_dd as number)) {
      return '実行期間の開始月日が不正です';
    }
    if (!isValidMonthDay(body.period_end_mm as number, body.period_end_dd as number)) {
      return '実行期間の終了月日が不正です';
    }
  }

  if (body.scheduled_hour !== undefined && body.scheduled_hour !== null) {
    if (typeof body.scheduled_hour !== 'number' || !Number.isInteger(body.scheduled_hour) || body.scheduled_hour < 0 || body.scheduled_hour > 23) {
      return '起票時刻は0〜23の整数で入力してください';
    }
  }

  return null;
}

function calculateNextDueDate(ft: string, interval: number | null, today: string, monthOfYear?: number | null, dayOfMonth?: number | null): string | null {
  if (['daily', 'weekly', 'monthly', 'nth_weekday_of_month', 'days_after_completion'].includes(ft)) {
    return null;
  }

  const d = new Date(today + 'T00:00:00');

  switch (ft) {
    case 'n_days':
      d.setDate(d.getDate() + (interval || 1));
      break;
    case 'n_weeks':
      d.setDate(d.getDate() + (interval || 1) * 7);
      break;
    case 'n_months':
      d.setMonth(d.getMonth() + (interval || 1));
      break;
    case 'yearly':
      if (monthOfYear && dayOfMonth) {
        const year = d.getFullYear();
        const mm = String(monthOfYear).padStart(2, '0');
        const dd = String(dayOfMonth).padStart(2, '0');
        const targetStr = `${year}-${mm}-${dd}`;
        if (targetStr <= today) {
          return `${year + 1}-${mm}-${dd}`;
        }
        return targetStr;
      }
      d.setFullYear(d.getFullYear() + 1);
      break;
  }

  return d.toISOString().split('T')[0];
}

// GET /api/tasks
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const category = _req.query.category as string | undefined;
  let tasks;
  if (category) {
    tasks = db.prepare('SELECT * FROM task_definitions WHERE category = ? ORDER BY id').all(category);
  } else {
    tasks = db.prepare('SELECT * FROM task_definitions ORDER BY id').all();
  }
  res.json(tasks);
});

// GET /api/tasks/:id
router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM task_definitions WHERE id = ?').get(req.params.id);
  if (!task) {
    res.status(404).json({ error: 'タスクが見つかりません' });
    return;
  }
  res.json(task);
});

// POST /api/tasks
router.post('/', (req: Request, res: Response) => {
  const error = validateTaskInput(req.body);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  const db = getDb();
  const body = req.body as TaskInput;
  const today = getTodayJST();

  const dup = db.prepare('SELECT id FROM task_definitions WHERE name = ?').get(body.name);
  if (dup) {
    res.status(409).json({ error: '同じ名前のタスクが既に存在します' });
    return;
  }

  const daysOfWeek = body.days_of_week ? body.days_of_week.join(',') : null;
  const dayOfMonth = body.day_of_month ?? null;
  const monthOfYear = body.month_of_year ?? null;
  const nthWeekdayPosition = body.nth_weekday_position ?? null;
  const interval = body.frequency_interval ?? null;
  const nextDueDate = calculateNextDueDate(body.frequency_type, interval, today, monthOfYear, dayOfMonth);

  const points = body.points ?? 1;
  const scheduledHour = body.scheduled_hour ?? 0;
  const periodStartMm = body.period_start_mm ?? null;
  const periodStartDd = body.period_start_dd ?? null;
  const periodEndMm = body.period_end_mm ?? null;
  const periodEndDd = body.period_end_dd ?? null;
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO task_definitions (name, category, frequency_type, frequency_interval, days_of_week, day_of_month, month_of_year, nth_weekday_position, period_start_mm, period_start_dd, period_end_mm, period_end_dd, next_due_date, notes, points, scheduled_hour, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    body.name,
    body.category,
    body.frequency_type,
    interval,
    daysOfWeek,
    dayOfMonth,
    monthOfYear,
    nthWeekdayPosition,
    periodStartMm,
    periodStartDd,
    periodEndMm,
    periodEndDd,
    nextDueDate,
    body.notes || null,
    points,
    scheduledHour,
    now,
    now,
  );

  const task = db.prepare('SELECT * FROM task_definitions WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(task);
});

// PUT /api/tasks/:id
router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM task_definitions WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'タスクが見つかりません' });
    return;
  }

  const error = validateTaskInput(req.body);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  const body = req.body as TaskInput;
  const today = getTodayJST();

  const dup = db.prepare('SELECT id FROM task_definitions WHERE name = ? AND id != ?').get(body.name, req.params.id);
  if (dup) {
    res.status(409).json({ error: '同じ名前のタスクが既に存在します' });
    return;
  }

  const daysOfWeek = body.days_of_week ? body.days_of_week.join(',') : null;
  const dayOfMonth = body.day_of_month ?? null;
  const monthOfYear = body.month_of_year ?? null;
  const nthWeekdayPosition = body.nth_weekday_position ?? null;
  const interval = body.frequency_interval ?? null;

  const frequencyChanged =
    existing.frequency_type !== body.frequency_type ||
    existing.frequency_interval !== interval ||
    existing.month_of_year !== monthOfYear ||
    existing.day_of_month !== dayOfMonth ||
    existing.nth_weekday_position !== nthWeekdayPosition;

  const nextDueDate = frequencyChanged
    ? calculateNextDueDate(body.frequency_type, interval, today, monthOfYear, dayOfMonth)
    : existing.next_due_date;

  const points = body.points ?? 1;
  const scheduledHour = body.scheduled_hour ?? 0;
  const periodStartMm = body.period_start_mm ?? null;
  const periodStartDd = body.period_start_dd ?? null;
  const periodEndMm = body.period_end_mm ?? null;
  const periodEndDd = body.period_end_dd ?? null;
  const stmt = db.prepare(`
    UPDATE task_definitions
    SET name = ?, category = ?, frequency_type = ?, frequency_interval = ?,
        days_of_week = ?, day_of_month = ?, month_of_year = ?, nth_weekday_position = ?,
        period_start_mm = ?, period_start_dd = ?, period_end_mm = ?, period_end_dd = ?,
        next_due_date = ?, notes = ?, points = ?, scheduled_hour = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    body.name,
    body.category,
    body.frequency_type,
    interval,
    daysOfWeek,
    dayOfMonth,
    monthOfYear,
    nthWeekdayPosition,
    periodStartMm,
    periodStartDd,
    periodEndMm,
    periodEndDd,
    nextDueDate,
    body.notes || null,
    points,
    scheduledHour,
    new Date().toISOString(),
    req.params.id,
  );

  const task = db.prepare('SELECT * FROM task_definitions WHERE id = ?').get(req.params.id);
  res.json(task);
});

// DELETE /api/tasks/:id (物理削除)
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM task_definitions WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'タスクが見つかりません' });
    return;
  }

  // 添付ファイルを物理削除
  const attachments = db.prepare('SELECT * FROM attachments WHERE task_id = ?').all(req.params.id) as any[];
  for (const att of attachments) {
    try { fs.unlinkSync(path.join(getUploadsDir(), att.filename)); }
    catch (_) { /* ファイルが無くても続行 */ }
  }

  // FK制約があるため子テーブルから先に削除
  const deleteAll = db.transaction(() => {
    db.prepare('DELETE FROM attachments WHERE task_id = ?').run(req.params.id);
    db.prepare('DELETE FROM execution_log WHERE task_definition_id = ?').run(req.params.id);
    db.prepare('DELETE FROM task_instances WHERE task_definition_id = ?').run(req.params.id);
    db.prepare('DELETE FROM task_definitions WHERE id = ?').run(req.params.id);
  });
  deleteAll();

  res.json({ success: true });
});

// POST /api/tasks/:id/toggle
router.post('/:id/toggle', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM task_definitions WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'タスクが見つかりません' });
    return;
  }

  const newActive = existing.is_active ? 0 : 1;
  db.prepare('UPDATE task_definitions SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newActive, req.params.id);

  const task = db.prepare('SELECT * FROM task_definitions WHERE id = ?').get(req.params.id);
  res.json(task);
});

// POST /api/tasks/import
router.post('/import', (req: Request, res: Response) => {
  const db = getDb();
  const tasks = req.body as TaskInput[];

  if (!Array.isArray(tasks)) {
    res.status(400).json({ error: 'タスクの配列を送信してください' });
    return;
  }

  const today = getTodayJST();
  const inserted: number[] = [];
  const skipped: string[] = [];

  const insertStmt = db.prepare(`
    INSERT INTO task_definitions (name, category, frequency_type, frequency_interval, days_of_week, day_of_month, month_of_year, nth_weekday_position, period_start_mm, period_start_dd, period_end_mm, period_end_dd, next_due_date, notes, points, scheduled_hour)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const findStmt = db.prepare('SELECT id, created_at, updated_at FROM task_definitions WHERE name = ?');

  const importAll = db.transaction(() => {
    for (const task of tasks) {
      const existing = findStmt.get(task.name) as any;
      if (existing) {
        if (existing.updated_at !== existing.created_at) {
          skipped.push(task.name);
          continue;
        }
        // Update existing (not manually edited)
        const daysOfWeek = task.days_of_week ? task.days_of_week.join(',') : null;
        const interval = task.frequency_interval ?? null;
        const monthOfYear = task.month_of_year ?? null;
        const nextDueDate = calculateNextDueDate(task.frequency_type, interval, today, monthOfYear, task.day_of_month);
        db.prepare(`
          UPDATE task_definitions
          SET category = ?, frequency_type = ?, frequency_interval = ?,
              days_of_week = ?, day_of_month = ?, month_of_year = ?, nth_weekday_position = ?,
              period_start_mm = ?, period_start_dd = ?, period_end_mm = ?, period_end_dd = ?,
              next_due_date = ?, notes = ?, points = ?, scheduled_hour = ?, updated_at = created_at
          WHERE id = ?
        `).run(
          task.category, task.frequency_type, interval,
          daysOfWeek, task.day_of_month ?? null, monthOfYear, task.nth_weekday_position ?? null,
          task.period_start_mm ?? null, task.period_start_dd ?? null, task.period_end_mm ?? null, task.period_end_dd ?? null,
          nextDueDate, task.notes || null, task.points ?? 1, task.scheduled_hour ?? 0, existing.id,
        );
        inserted.push(existing.id);
      } else {
        const daysOfWeek = task.days_of_week ? task.days_of_week.join(',') : null;
        const interval = task.frequency_interval ?? null;
        const monthOfYear = task.month_of_year ?? null;
        const nextDueDate = calculateNextDueDate(task.frequency_type, interval, today, monthOfYear, task.day_of_month);
        const result = insertStmt.run(
          task.name, task.category, task.frequency_type, interval,
          daysOfWeek, task.day_of_month ?? null, monthOfYear, task.nth_weekday_position ?? null,
          task.period_start_mm ?? null, task.period_start_dd ?? null, task.period_end_mm ?? null, task.period_end_dd ?? null,
          nextDueDate, task.notes || null, task.points ?? 1, task.scheduled_hour ?? 0,
        );
        inserted.push(Number(result.lastInsertRowid));
      }
    }
  });

  importAll();
  res.json({ imported: inserted.length, skipped: skipped.length, skipped_names: skipped });
});

export default router;
