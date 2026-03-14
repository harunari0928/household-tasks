import { Router, type Request, type Response } from 'express';
import { getDb } from '../db.js';
import { getTodayJST } from '@household-tasks/shared';

const router: ReturnType<typeof Router> = Router();

const VALID_CATEGORIES = ['water', 'kitchen', 'floor', 'entrance', 'laundry', 'trash', 'childcare', 'cooking', 'lifestyle'];
const VALID_FREQUENCY_TYPES = ['daily', 'weekly', 'n_days', 'n_weeks', 'monthly', 'n_months', 'yearly'];
const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const VALID_ASSIGNEES = ['husband', 'wife', 'alternate'];

interface TaskInput {
  name: string;
  category: string;
  frequency_type: string;
  frequency_interval?: number;
  days_of_week?: string[];
  day_of_month?: number;
  assignee?: string | null;
  vikunja_project_id?: number;
  notes?: string;
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
  if (body.assignee && !VALID_ASSIGNEES.includes(body.assignee)) {
    return '無効な担当者です';
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

  if (ft === 'monthly' || ft === 'n_months') {
    if (body.day_of_month !== undefined && body.day_of_month !== null) {
      if (typeof body.day_of_month !== 'number' || body.day_of_month < 1 || body.day_of_month > 28) {
        return '日指定は1〜28の範囲で入力してください';
      }
    }
  }

  return null;
}

function calculateNextDueDate(ft: string, interval: number | null, today: string): string | null {
  if (['daily', 'weekly', 'monthly'].includes(ft)) {
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

  const daysOfWeek = body.days_of_week ? body.days_of_week.join(',') : null;
  const dayOfMonth = body.day_of_month ?? null;
  const interval = body.frequency_interval ?? null;
  const nextDueDate = calculateNextDueDate(body.frequency_type, interval, today);

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO task_definitions (name, category, frequency_type, frequency_interval, days_of_week, day_of_month, assignee, vikunja_project_id, next_due_date, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    body.name,
    body.category,
    body.frequency_type,
    interval,
    daysOfWeek,
    dayOfMonth,
    body.assignee || null,
    body.vikunja_project_id || null,
    nextDueDate,
    body.notes || null,
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

  const daysOfWeek = body.days_of_week ? body.days_of_week.join(',') : null;
  const dayOfMonth = body.day_of_month ?? null;
  const interval = body.frequency_interval ?? null;

  const frequencyChanged =
    existing.frequency_type !== body.frequency_type ||
    existing.frequency_interval !== interval;

  const nextDueDate = frequencyChanged
    ? calculateNextDueDate(body.frequency_type, interval, today)
    : existing.next_due_date;

  const stmt = db.prepare(`
    UPDATE task_definitions
    SET name = ?, category = ?, frequency_type = ?, frequency_interval = ?,
        days_of_week = ?, day_of_month = ?, assignee = ?, vikunja_project_id = ?,
        next_due_date = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `);

  stmt.run(
    body.name,
    body.category,
    body.frequency_type,
    interval,
    daysOfWeek,
    dayOfMonth,
    body.assignee || null,
    body.vikunja_project_id || null,
    nextDueDate,
    body.notes || null,
    new Date().toISOString(),
    req.params.id,
  );

  const task = db.prepare('SELECT * FROM task_definitions WHERE id = ?').get(req.params.id);
  res.json(task);
});

// DELETE /api/tasks/:id (論理削除)
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM task_definitions WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'タスクが見つかりません' });
    return;
  }

  db.prepare('UPDATE task_definitions SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
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
    INSERT INTO task_definitions (name, category, frequency_type, frequency_interval, days_of_week, day_of_month, assignee, vikunja_project_id, next_due_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        const nextDueDate = calculateNextDueDate(task.frequency_type, interval, today);
        db.prepare(`
          UPDATE task_definitions
          SET category = ?, frequency_type = ?, frequency_interval = ?,
              days_of_week = ?, day_of_month = ?, assignee = ?,
              next_due_date = ?, notes = ?, updated_at = created_at
          WHERE id = ?
        `).run(
          task.category, task.frequency_type, interval,
          daysOfWeek, task.day_of_month ?? null, task.assignee || null,
          nextDueDate, task.notes || null, existing.id,
        );
        inserted.push(existing.id);
      } else {
        const daysOfWeek = task.days_of_week ? task.days_of_week.join(',') : null;
        const interval = task.frequency_interval ?? null;
        const nextDueDate = calculateNextDueDate(task.frequency_type, interval, today);
        const result = insertStmt.run(
          task.name, task.category, task.frequency_type, interval,
          daysOfWeek, task.day_of_month ?? null, task.assignee || null,
          null, nextDueDate, task.notes || null,
        );
        inserted.push(Number(result.lastInsertRowid));
      }
    }
  });

  importAll();
  res.json({ imported: inserted.length, skipped: skipped.length, skipped_names: skipped });
});

export default router;
