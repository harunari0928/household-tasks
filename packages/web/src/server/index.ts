import express, { type Express } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDb, getUploadsDir } from './db.js';
import tasksRouter from './routes/tasks.js';
import attachmentsRouter from './routes/attachments.js';
import statsRouter from './routes/stats.js';
import settingsRouter from './routes/settings.js';
import kanbanRouter from './routes/kanban.js';

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

// Test-only: reset DB
app.post('/api/test/reset', (_req, res) => {
  const db = getDb();
  db.exec('DELETE FROM task_instances');
  db.exec('DELETE FROM attachments');
  db.exec('DELETE FROM execution_log');
  db.exec('DELETE FROM task_definitions');
  db.exec('DELETE FROM app_settings');
  // Clean uploads directory
  const uploadsDir = getUploadsDir();
  if (fs.existsSync(uploadsDir)) {
    for (const file of fs.readdirSync(uploadsDir)) {
      fs.unlinkSync(path.join(uploadsDir, file));
    }
  }
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
