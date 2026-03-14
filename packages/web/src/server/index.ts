import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';
import tasksRouter from './routes/tasks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = parseInt(process.env.PORT || '3100', 10);

app.use(cors());
app.use(express.json());

// Initialize DB
getDb();

// API routes
app.use('/api/tasks', tasksRouter);

// Config routes
app.get('/api/config', (_req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM scheduler_config').all() as { key: string; value: string }[];
  const config: Record<string, string> = {};
  for (const row of rows) {
    config[row.key] = row.value;
  }
  res.json(config);
});

app.put('/api/config', (req, res) => {
  const db = getDb();
  const entries = Object.entries(req.body) as [string, string][];
  const stmt = db.prepare('INSERT OR REPLACE INTO scheduler_config (key, value) VALUES (?, ?)');
  const updateAll = db.transaction(() => {
    for (const [key, value] of entries) {
      stmt.run(key, String(value));
    }
  });
  updateAll();
  res.json({ success: true });
});

// Test-only: reset DB
app.post('/api/test/reset', (_req, res) => {
  const db = getDb();
  db.exec('DELETE FROM execution_log');
  db.exec('DELETE FROM task_definitions');
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
