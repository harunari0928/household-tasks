import { Router, type Request, type Response } from 'express';
import { getDb } from '../db.js';
import { fetchProjectTasks, type VikunjaTask } from '../vikunja.js';

const router: ReturnType<typeof Router> = Router();

interface PointDetail {
  task_name: string;
  points: number;
  done_at: string;
  assignee: string;
}

// GET /api/stats/points?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/points', async (req: Request, res: Response) => {
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

    // Get distinct vikunja_project_ids from active task definitions + default project
    const projects = db.prepare(
      'SELECT DISTINCT vikunja_project_id FROM task_definitions WHERE vikunja_project_id IS NOT NULL AND is_active = 1'
    ).all() as { vikunja_project_id: number }[];

    const defaultProjectId = process.env.DEFAULT_PROJECT_ID ? parseInt(process.env.DEFAULT_PROJECT_ID, 10) : null;
    const projectIds = new Set(projects.map((p) => p.vikunja_project_id));
    if (defaultProjectId) projectIds.add(defaultProjectId);

    if (projectIds.size === 0) {
      res.json({ totals: {}, details: [] });
      return;
    }

    // Build a map of task name -> points from local DB
    const taskDefs = db.prepare(
      'SELECT name, points FROM task_definitions'
    ).all() as { name: string; points: number }[];

    const pointsMap = new Map<string, number>();
    for (const td of taskDefs) {
      pointsMap.set(td.name, td.points);
    }

    // Fetch tasks from all Vikunja projects
    const allVikunja: VikunjaTask[] = [];
    for (const pid of projectIds) {
      const tasks = await fetchProjectTasks(pid);
      allVikunja.push(...tasks);
    }

    // Filter completed tasks in date range and aggregate
    const totals: Record<string, number> = {};
    const details: PointDetail[] = [];

    for (const vt of allVikunja) {
      if (!vt.done || !vt.done_at) continue;

      const doneAt = new Date(vt.done_at);
      if (doneAt < start || doneAt > end) continue;

      const points = pointsMap.get(vt.title) ?? 1;
      const assignees = vt.assignees ?? [];

      if (assignees.length === 0) {
        // No assignee — attribute to "未割当"
        totals['未割当'] = (totals['未割当'] ?? 0) + points;
        details.push({ task_name: vt.title, points, done_at: vt.done_at, assignee: '未割当' });
      } else {
        for (const a of assignees) {
          totals[a.username] = (totals[a.username] ?? 0) + points;
          details.push({ task_name: vt.title, points, done_at: vt.done_at, assignee: a.username });
        }
      }
    }

    res.json({ totals, details });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: `集計に失敗しました: ${message}` });
  }
});

export default router;
