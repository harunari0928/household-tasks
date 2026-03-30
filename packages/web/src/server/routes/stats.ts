import { Router, type Request, type Response } from 'express';
import { getDb } from '../db.js';

const router: ReturnType<typeof Router> = Router();

interface PointDetail {
  task_name: string;
  points: number;
  done_at: string;
  assignee: string;
}

// GET /api/stats/points?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/points', (req: Request, res: Response) => {
  const startStr = req.query.start as string;
  const endStr = req.query.end as string;

  if (!startStr || !endStr) {
    res.status(400).json({ error: 'start と end パラメータが必要です' });
    return;
  }

  const start = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T23:59:59.999Z');

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    res.status(400).json({ error: '日付形式が不正です (YYYY-MM-DD)' });
    return;
  }

  try {
    const db = getDb();

    const rows = db.prepare(`
      SELECT ti.title AS task_name, ti.points, ti.completed_at AS done_at, ti.assignee
      FROM task_instances ti
      WHERE ti.status = 'done'
        AND ti.completed_at >= ?
        AND ti.completed_at <= ?
    `).all(start.toISOString(), end.toISOString()) as PointDetail[];

    const totals: Record<string, number> = {};
    const details: PointDetail[] = [];

    for (const row of rows) {
      const assigneeStr = row.assignee || '未割当';
      const assigneeList = assigneeStr.includes(',')
        ? assigneeStr.split(',').map((a: string) => a.trim())
        : [assigneeStr];

      for (const assignee of assigneeList) {
        totals[assignee] = (totals[assignee] ?? 0) + row.points;
        details.push({ ...row, assignee });
      }
    }

    res.json({ totals, details });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: `集計に失敗しました: ${message}` });
  }
});

export default router;
