import { Router, type Request, type Response } from 'express';
import { getDb } from '../db.js';
import { getNowISO } from '../test-time.js';

const router: ReturnType<typeof Router> = Router();

// SSE clients
const sseClients = new Set<Response>();

function broadcast(event: object) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    client.write(data);
  }
}

// GET /api/kanban — list task instances
router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (req.query.status) {
    conditions.push('ti.status = ?');
    params.push(req.query.status);
  }
  if (req.query.assignee) {
    conditions.push('ti.assignee = ?');
    params.push(req.query.assignee);
  }
  if (req.query.category) {
    conditions.push('td.category = ?');
    params.push(req.query.category);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT ti.*, td.category
    FROM task_instances ti
    JOIN task_definitions td ON ti.task_definition_id = td.id
    ${where}
    ORDER BY ti.sort_order ASC, ti.created_at DESC
  `).all(...params);

  res.json(rows);
});

// PATCH /api/kanban/reorder — reorder tasks within a column
router.patch('/reorder', (req: Request, res: Response) => {
  const db = getDb();
  const { status, sortedIds } = req.body;
  const validStatuses = ['todo', 'in_progress', 'done'];

  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }
  if (!Array.isArray(sortedIds) || !sortedIds.every((id: unknown) => typeof id === 'number')) {
    res.status(400).json({ error: 'sortedIds must be a number array' });
    return;
  }

  const updateStmt = db.prepare('UPDATE task_instances SET sort_order = ? WHERE id = ? AND status = ?');
  const reorder = db.transaction(() => {
    for (let i = 0; i < sortedIds.length; i++) {
      updateStmt.run(i, sortedIds[i], status);
    }
  });
  reorder();

  broadcast({ type: 'tasks_reordered', status });
  res.json({ success: true });
});

// PATCH /api/kanban/:id/status — update status
router.patch('/:id/status', (req: Request, res: Response) => {
  const db = getDb();
  const { status, assignee } = req.body;
  const validStatuses = ['todo', 'in_progress', 'done'];

  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ error: 'status must be one of: todo, in_progress, done' });
    return;
  }

  const existing = db.prepare('SELECT * FROM task_instances WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Task instance not found' });
    return;
  }

  if (status === 'done') {
    const effectiveAssignee = assignee !== undefined ? assignee : existing.assignee;
    if (!effectiveAssignee) {
      res.status(400).json({ error: '担当者が未設定です。完了にするには担当者を設定してください' });
      return;
    }
  }

  const completedAt = status === 'done' ? getNowISO() : null;

  // Append to end of target column
  const maxRow = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) as max_order FROM task_instances WHERE status = ? AND id != ?'
  ).get(status, req.params.id) as { max_order: number };
  const sortOrder = maxRow.max_order + 1;

  if (assignee !== undefined) {
    db.prepare(
      'UPDATE task_instances SET status = ?, assignee = ?, completed_at = ?, sort_order = ? WHERE id = ?'
    ).run(status, assignee, completedAt, sortOrder, req.params.id);
  } else {
    db.prepare(
      'UPDATE task_instances SET status = ?, completed_at = ?, sort_order = ? WHERE id = ?'
    ).run(status, completedAt, sortOrder, req.params.id);
  }

  const updated = db.prepare(`
    SELECT ti.*, td.category
    FROM task_instances ti
    JOIN task_definitions td ON ti.task_definition_id = td.id
    WHERE ti.id = ?
  `).get(req.params.id);

  broadcast({ type: 'task_updated', task: updated });
  res.json(updated);
});

// PATCH /api/kanban/:id/assignee — update assignee
router.patch('/:id/assignee', (req: Request, res: Response) => {
  const db = getDb();
  const { assignee } = req.body;

  const existing = db.prepare('SELECT * FROM task_instances WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Task instance not found' });
    return;
  }

  db.prepare('UPDATE task_instances SET assignee = ? WHERE id = ?').run(assignee ?? null, req.params.id);

  const updated = db.prepare(`
    SELECT ti.*, td.category
    FROM task_instances ti
    JOIN task_definitions td ON ti.task_definition_id = td.id
    WHERE ti.id = ?
  `).get(req.params.id);

  broadcast({ type: 'task_updated', task: updated });
  res.json(updated);
});

// GET /api/kanban/assignees — list registered assignees
router.get('/assignees', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT name FROM users ORDER BY display_order ASC, id ASC').all() as { name: string }[];
  res.json(rows.map((r) => r.name));
});

// PUT /api/kanban/assignees — set assignees list
router.put('/assignees', (req: Request, res: Response) => {
  const db = getDb();
  const { assignees } = req.body;

  if (!Array.isArray(assignees) || !assignees.every((a: unknown) => typeof a === 'string')) {
    res.status(400).json({ error: 'assignees must be a string array' });
    return;
  }

  const syncAssignees = db.transaction(() => {
    if (assignees.length > 0) {
      const placeholders = assignees.map(() => '?').join(',');
      db.prepare(`DELETE FROM users WHERE name NOT IN (${placeholders})`).run(...assignees);
    } else {
      db.exec('DELETE FROM users');
    }
    const upsert = db.prepare(
      'INSERT INTO users (name, display_order) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET display_order = excluded.display_order'
    );
    assignees.forEach((name: string, i: number) => upsert.run(name, i));
  });
  syncAssignees();

  res.json({ success: true });
});

// POST /api/kanban/create-from-definition/:taskDefId — manually create a task instance
router.post('/create-from-definition/:taskDefId', (req: Request, res: Response) => {
  const db = getDb();
  const taskDefId = Number(req.params.taskDefId);

  const taskDef = db.prepare('SELECT * FROM task_definitions WHERE id = ?').get(taskDefId) as any;
  if (!taskDef) {
    res.status(404).json({ error: 'タスク定義が見つかりません' });
    return;
  }

  const existing = db.prepare(
    "SELECT 1 FROM task_instances WHERE task_definition_id = ? AND status != 'done' LIMIT 1"
  ).get(taskDefId);
  if (existing) {
    res.status(409).json({ error: 'すでに未完了のインスタンスが存在します' });
    return;
  }

  const maxRow = db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) as max_order FROM task_instances WHERE status = 'todo'"
  ).get() as { max_order: number };
  const sortOrder = maxRow.max_order + 1;

  const result = db.prepare(
    "INSERT INTO task_instances (task_definition_id, title, status, points, created_at, sort_order) VALUES (?, ?, 'todo', ?, ?, ?)"
  ).run(taskDefId, taskDef.name, taskDef.points, new Date().toISOString(), sortOrder);

  const created = db.prepare(`
    SELECT ti.*, td.category
    FROM task_instances ti
    JOIN task_definitions td ON ti.task_definition_id = td.id
    WHERE ti.id = ?
  `).get(result.lastInsertRowid);

  broadcast({ type: 'tasks_changed' });
  res.status(201).json(created);
});

// POST /api/kanban/notify — trigger SSE broadcast (called by scheduler)
router.post('/notify', (_req: Request, res: Response) => {
  broadcast({ type: 'tasks_changed' });
  res.json({ success: true });
});

// DELETE /api/kanban/:id — delete a task instance
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM task_instances WHERE id = ?').get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: 'Task instance not found' });
    return;
  }
  db.prepare('DELETE FROM task_instances WHERE id = ?').run(req.params.id);
  broadcast({ type: 'task_deleted', taskId: Number(req.params.id) });
  res.json({ success: true });
});

// DELETE /api/kanban — bulk delete by status
router.delete('/', (req: Request, res: Response) => {
  const db = getDb();
  const status = req.query.status as string;
  const validStatuses = ['todo', 'in_progress', 'done'];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ error: 'status query parameter required (todo, in_progress, done)' });
    return;
  }
  const result = db.prepare('DELETE FROM task_instances WHERE status = ?').run(status);
  broadcast({ type: 'tasks_changed' });
  res.json({ success: true, deleted: result.changes });
});

// GET /api/kanban/events — SSE endpoint
router.get('/events', (_req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  sseClients.add(res);

  res.on('close', () => {
    sseClients.delete(res);
  });
});

export default router;
