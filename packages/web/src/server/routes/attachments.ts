import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { getDb, getUploadsDir } from '../db.js';

const router: ReturnType<typeof Router> = Router();

const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf', 'text/'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = getUploadsDir();
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (isAllowedMime(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('許可されていないファイル形式です'));
    }
  },
});

// GET /api/tasks/:taskId/attachments
router.get('/tasks/:taskId/attachments', (req: Request, res: Response) => {
  const db = getDb();
  const attachments = db
    .prepare('SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at')
    .all(req.params.taskId);
  res.json(attachments);
});

// POST /api/tasks/:taskId/attachments
router.post('/tasks/:taskId/attachments', (req: Request, res: Response) => {
  const db = getDb();
  const task = db.prepare('SELECT id FROM task_definitions WHERE id = ?').get(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'タスクが見つかりません' });
    return;
  }

  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'ファイルサイズが上限(10MB)を超えています' });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'ファイルが指定されていません' });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO attachments (id, task_id, filename, original_name, mime_type, size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.params.taskId, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, now);

    const attachment = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
    res.status(201).json(attachment);
  });
});

// GET /api/attachments/:id
router.get('/attachments/:id', (req: Request, res: Response) => {
  const db = getDb();
  const attachment = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id) as any;
  if (!attachment) {
    res.status(404).json({ error: '添付ファイルが見つかりません' });
    return;
  }

  const filePath = path.join(getUploadsDir(), attachment.filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'ファイルが見つかりません' });
    return;
  }

  res.setHeader('Content-Type', attachment.mime_type);
  const disposition = attachment.mime_type.startsWith('image/') ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(attachment.original_name)}"`);
  res.sendFile(path.resolve(filePath));
});

// DELETE /api/attachments/:id
router.delete('/attachments/:id', (req: Request, res: Response) => {
  const db = getDb();
  const attachment = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id) as any;
  if (!attachment) {
    res.status(404).json({ error: '添付ファイルが見つかりません' });
    return;
  }

  const filePath = path.join(getUploadsDir(), attachment.filename);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File already missing — still delete DB record
  }

  db.prepare('DELETE FROM attachments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
