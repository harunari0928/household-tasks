#!/usr/bin/env node
import { Command } from 'commander';
import { getDb } from './db.js';

const program = new Command();

program
  .name('ht')
  .description('Household tasks CLI')
  .version('1.0.0');

// ht list
program
  .command('list')
  .description('List task instances')
  .option('--status <status>', 'Filter by status (todo, in_progress, done)')
  .option('--assignee <name>', 'Filter by assignee')
  .action((opts: { status?: string; assignee?: string }) => {
    const db = getDb();
    try {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (opts.status) {
        conditions.push('status = ?');
        params.push(opts.status);
      }
      if (opts.assignee) {
        conditions.push('assignee = ?');
        params.push(opts.assignee);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = db.prepare(
        `SELECT id, title, status, assignee, points, created_at FROM task_instances ${where} ORDER BY id`
      ).all(...params) as Array<{
        id: number;
        title: string;
        status: string;
        assignee: string | null;
        points: number;
        created_at: string;
      }>;

      if (rows.length === 0) {
        console.log('No tasks found.');
        return;
      }

      // Column headers
      const headers = ['ID', 'Title', 'Status', 'Assignee', 'Points', 'Created'];
      const colWidths = headers.map((h, i) => {
        const values = rows.map(r => {
          const vals = [String(r.id), r.title, r.status, r.assignee || '-', String(r.points), r.created_at.slice(0, 10)];
          return vals[i].length;
        });
        return Math.max(h.length, ...values);
      });

      const formatRow = (vals: string[]) =>
        vals.map((v, i) => v.padEnd(colWidths[i])).join('  ');

      console.log(formatRow(headers));
      console.log(colWidths.map(w => '-'.repeat(w)).join('  '));

      for (const r of rows) {
        console.log(formatRow([
          String(r.id),
          r.title,
          r.status,
          r.assignee || '-',
          String(r.points),
          r.created_at.slice(0, 10),
        ]));
      }
    } finally {
      db.close();
    }
  });

// ht move
program
  .command('move')
  .description('Move a task instance to a new status')
  .argument('<id>', 'Task instance ID')
  .argument('<status>', 'New status (todo, in_progress, done)')
  .action((idStr: string, status: string) => {
    const validStatuses = ['todo', 'in_progress', 'done'];
    if (!validStatuses.includes(status)) {
      console.error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
      process.exit(1);
    }

    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      console.error(`Invalid ID: ${idStr}`);
      process.exit(1);
    }

    const db = getDb();
    try {
      const completedAt = status === 'done' ? new Date().toISOString() : null;

      const result = db.prepare(
        'UPDATE task_instances SET status = ?, completed_at = ? WHERE id = ?'
      ).run(status, completedAt, id);

      if (result.changes === 0) {
        console.error(`Task instance ${id} not found.`);
        process.exit(1);
      }

      console.log(`Task ${id} moved to ${status}.`);
    } finally {
      db.close();
    }
  });

// ht assign
program
  .command('assign')
  .description('Assign a task instance to a person')
  .argument('<id>', 'Task instance ID')
  .argument('<assignee>', 'Assignee name')
  .action((idStr: string, assignee: string) => {
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      console.error(`Invalid ID: ${idStr}`);
      process.exit(1);
    }

    const db = getDb();
    try {
      const result = db.prepare(
        'UPDATE task_instances SET assignee = ? WHERE id = ?'
      ).run(assignee, id);

      if (result.changes === 0) {
        console.error(`Task instance ${id} not found.`);
        process.exit(1);
      }

      console.log(`Task ${id} assigned to ${assignee}.`);
    } finally {
      db.close();
    }
  });

// ht stats
program
  .command('stats')
  .description('Show points breakdown by assignee for completed tasks')
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--end <date>', 'End date (YYYY-MM-DD)')
  .action((opts: { start?: string; end?: string }) => {
    const now = new Date();
    const startDate = opts.start || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const endDate = opts.end || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

    const db = getDb();
    try {
      const rows = db.prepare(
        `SELECT assignee, SUM(points) as total_points, COUNT(*) as task_count
         FROM task_instances
         WHERE status = 'done'
           AND completed_at >= ?
           AND completed_at < date(?, '+1 day')
         GROUP BY assignee
         ORDER BY total_points DESC`
      ).all(startDate, endDate) as Array<{
        assignee: string | null;
        total_points: number;
        task_count: number;
      }>;

      if (rows.length === 0) {
        console.log(`No completed tasks found (${startDate} ~ ${endDate}).`);
        return;
      }

      console.log(`Completed tasks: ${startDate} ~ ${endDate}\n`);

      const headers = ['Assignee', 'Points', 'Tasks'];
      const colWidths = headers.map((h, i) => {
        const values = rows.map(r => {
          const vals = [r.assignee || '(unassigned)', String(r.total_points), String(r.task_count)];
          return vals[i].length;
        });
        return Math.max(h.length, ...values);
      });

      const formatRow = (vals: string[]) =>
        vals.map((v, i) => v.padEnd(colWidths[i])).join('  ');

      console.log(formatRow(headers));
      console.log(colWidths.map(w => '-'.repeat(w)).join('  '));

      let totalPoints = 0;
      let totalTasks = 0;
      for (const r of rows) {
        console.log(formatRow([
          r.assignee || '(unassigned)',
          String(r.total_points),
          String(r.task_count),
        ]));
        totalPoints += r.total_points;
        totalTasks += r.task_count;
      }

      console.log(colWidths.map(w => '-'.repeat(w)).join('  '));
      console.log(formatRow(['Total', String(totalPoints), String(totalTasks)]));
    } finally {
      db.close();
    }
  });

program.parse();
