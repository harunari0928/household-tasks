import express, { type Express } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDb, getUploadsDir } from './db.js';
import { setTestNow } from './test-time.js';
import tasksRouter from './routes/tasks.js';
import attachmentsRouter from './routes/attachments.js';
import statsRouter from './routes/stats.js';
import settingsRouter from './routes/settings.js';
import kanbanRouter from './routes/kanban.js';
import sickModeRouter from './routes/sickMode.js';
import garbageRouter from './routes/garbage.js';
import absenceRouter from './routes/absence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();
const PORT = parseInt(process.env.PORT || '3100', 10);

app.use(cors());
app.use(express.json());

// Initialize DB
getDb();

// Ensure uploads directory exists
fs.mkdirSync(getUploadsDir(), { recursive: true });

// API routes
app.use('/api/tasks', tasksRouter);
app.use('/api', attachmentsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/kanban', kanbanRouter);
app.use('/api/sick-mode', sickModeRouter);
app.use('/api/garbage', garbageRouter);
app.use('/api/absence', absenceRouter);

// Test-only: reset DB
app.post('/api/test/reset', (_req, res) => {
  const db = getDb();
  db.exec('DELETE FROM task_instances');
  db.exec('DELETE FROM attachments');
  db.exec('DELETE FROM execution_log');
  db.exec('DELETE FROM task_definitions');
  db.exec('DELETE FROM app_settings');
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM absence_days');
  setTestNow(null);
  // Clean uploads directory
  const uploadsDir = getUploadsDir();
  if (fs.existsSync(uploadsDir)) {
    for (const file of fs.readdirSync(uploadsDir)) {
      fs.unlinkSync(path.join(uploadsDir, file));
    }
  }
  res.json({ success: true });
});

// Test-only: override server time
app.post('/api/test/set-time', (req, res) => {
  setTestNow(req.body.time || null);
  res.json({ success: true });
});

// Test-only: mark a task definition as a special (built-in) task.
// 通常のAPIからは設定できない（マイグレーションで付与される）ため、テスト用に用意する。
app.post('/api/test/special-kind', (req, res) => {
  const { id, specialKind } = req.body ?? {};
  const db = getDb();
  db.prepare('UPDATE task_definitions SET special_kind = ? WHERE id = ?').run(specialKind ?? null, id);
  res.json({ success: true });
});

// Test-only: set next_due_date directly.
// PUT /api/tasks recalculates it from the real today, so tests that need a
// specific due date (e.g. absence carry-over across a fixed date range)
// cannot go through the normal update path without becoming date-dependent.
app.post('/api/test/set-next-due-date', (req, res) => {
  const { id, next_due_date: nextDueDate } = req.body ?? {};
  if (typeof id !== 'number' || typeof nextDueDate !== 'string') {
    res.status(400).json({ error: 'id (number) and next_due_date (string) are required' });
    return;
  }
  const db = getDb();
  db.prepare('UPDATE task_definitions SET next_due_date = ? WHERE id = ?').run(nextDueDate, id);
  res.json({ success: true });
});

// Logs routes
app.get('/api/logs', (req, res) => {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
  const offset = parseInt(req.query.offset as string) || 0;
  const logs = db.prepare('SELECT * FROM execution_log ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
  res.json(logs);
});

// Serve static files in production
const clientDist = path.join(__dirname, '../client');
const indexHtml = path.join(clientDist, 'index.html');
if (fs.existsSync(indexHtml)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(indexHtml);
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
