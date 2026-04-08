#!/usr/bin/env node
import { Command } from 'commander';
import { getDb } from './db.js';

const WEB_URL = process.env.WEB_URL || 'http://localhost:3100';

async function notifyWeb(): Promise<void> {
  try {
    await fetch(`${WEB_URL}/api/kanban/notify`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    console.warn('Could not notify web server (non-critical)');
  }
}

async function apiFetch(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${WEB_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = (data as { error?: string }).error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

interface TaskDef {
  id: number;
  name: string;
  category: string;
  frequency_type: string;
  frequency_interval: number | null;
  days_of_week: string | null;
  day_of_month: number | null;
  next_due_date: string | null;
  is_active: number;
  notes: string | null;
  points: number;
  scheduled_hour: number;
  created_at: string;
  updated_at: string;
}

function formatTable(headers: string[], rows: string[][]): void {
  const colWidths = headers.map((h, i) => {
    const max = rows.reduce((m, r) => Math.max(m, (r[i] || '').length), 0);
    return Math.max(h.length, max);
  });
  const formatRow = (vals: string[]) =>
    vals.map((v, i) => v.padEnd(colWidths[i])).join('  ');
  console.log(formatRow(headers));
  console.log(colWidths.map(w => '-'.repeat(w)).join('  '));
  for (const r of rows) {
    console.log(formatRow(r));
  }
}

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
  .action(async (idStr: string, status: string) => {
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
      await notifyWeb();
    } finally {
      db.close();
    }
  });

// ht assign
program
  .command('assign')
  .description('Assign a task instance to one or more people')
  .argument('<id>', 'Task instance ID')
  .argument('<assignees...>', 'Assignee name(s)')
  .action(async (idStr: string, assignees: string[]) => {
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      console.error(`Invalid ID: ${idStr}`);
      process.exit(1);
    }

    const assigneeStr = assignees.join(',');
    const db = getDb();
    try {
      const result = db.prepare(
        'UPDATE task_instances SET assignee = ? WHERE id = ?'
      ).run(assigneeStr, id);

      if (result.changes === 0) {
        console.error(`Task instance ${id} not found.`);
        process.exit(1);
      }

      console.log(`Task ${id} assigned to ${assignees.join(', ')}.`);
      await notifyWeb();
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

// ht task (task definition management via Web API)
const task = program
  .command('task')
  .description('Manage task definitions via Web API');

// ht task list
task
  .command('list')
  .description('List task definitions')
  .option('--category <category>', 'Filter by category')
  .option('--json', 'Output as JSON')
  .action(async (opts: { category?: string; json?: boolean }) => {
    try {
      const query = opts.category ? `?category=${encodeURIComponent(opts.category)}` : '';
      const tasks = await apiFetch('GET', `/api/tasks${query}`) as TaskDef[];

      if (opts.json) {
        console.log(JSON.stringify(tasks, null, 2));
        return;
      }

      if (tasks.length === 0) {
        console.log('No task definitions found.');
        return;
      }

      const headers = ['ID', 'Name', 'Category', 'Frequency', 'Points', 'Active'];
      const rows = tasks.map(t => [
        String(t.id),
        t.name,
        t.category,
        t.frequency_interval ? `${t.frequency_type}(${t.frequency_interval})` : t.frequency_type,
        String(t.points),
        t.is_active ? 'yes' : 'no',
      ]);
      formatTable(headers, rows);
    } catch (e: unknown) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

// ht task get
task
  .command('get')
  .description('Get a task definition by ID')
  .argument('<id>', 'Task definition ID')
  .option('--json', 'Output as JSON')
  .action(async (idStr: string, opts: { json?: boolean }) => {
    try {
      const t = await apiFetch('GET', `/api/tasks/${idStr}`) as TaskDef;

      if (opts.json) {
        console.log(JSON.stringify(t, null, 2));
        return;
      }

      const lines = [
        `ID:             ${t.id}`,
        `Name:           ${t.name}`,
        `Category:       ${t.category}`,
        `Frequency:      ${t.frequency_type}${t.frequency_interval ? ` (interval: ${t.frequency_interval})` : ''}`,
        `Days of week:   ${t.days_of_week || '-'}`,
        `Day of month:   ${t.day_of_month ?? '-'}`,
        `Next due date:  ${t.next_due_date || '-'}`,
        `Points:         ${t.points}`,
        `Scheduled hour: ${t.scheduled_hour}`,
        `Active:         ${t.is_active ? 'yes' : 'no'}`,
        `Notes:          ${t.notes || '-'}`,
      ];
      console.log(lines.join('\n'));
    } catch (e: unknown) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

// ht task add
task
  .command('add')
  .description('Add a new task definition')
  .requiredOption('--name <name>', 'Task name')
  .requiredOption('--category <category>', 'Category (water,kitchen,floor,entrance,laundry,trash,childcare,cooking,lifestyle)')
  .requiredOption('--frequency-type <type>', 'Frequency type (daily,weekly,n_days,n_weeks,monthly,n_months,yearly)')
  .option('--frequency-interval <n>', 'Interval for n_days/n_weeks/n_months', parseInt)
  .option('--days-of-week <days>', 'Days of week (comma-separated: mon,tue,...)')
  .option('--day-of-month <day>', 'Day of month (1-28)', parseInt)
  .option('--notes <text>', 'Notes')
  .option('--points <n>', 'Points (1-10)', parseInt)
  .option('--scheduled-hour <hour>', 'Scheduled hour (0-23)', parseInt)
  .action(async (opts: {
    name: string;
    category: string;
    frequencyType: string;
    frequencyInterval?: number;
    daysOfWeek?: string;
    dayOfMonth?: number;
    notes?: string;
    points?: number;
    scheduledHour?: number;
  }) => {
    try {
      const body: Record<string, unknown> = {
        name: opts.name,
        category: opts.category,
        frequency_type: opts.frequencyType,
      };
      if (opts.frequencyInterval !== undefined) body.frequency_interval = opts.frequencyInterval;
      if (opts.daysOfWeek) body.days_of_week = opts.daysOfWeek.split(',');
      if (opts.dayOfMonth !== undefined) body.day_of_month = opts.dayOfMonth;
      if (opts.notes !== undefined) body.notes = opts.notes;
      if (opts.points !== undefined) body.points = opts.points;
      if (opts.scheduledHour !== undefined) body.scheduled_hour = opts.scheduledHour;

      const task = await apiFetch('POST', '/api/tasks', body) as TaskDef;
      console.log(JSON.stringify(task, null, 2));
    } catch (e: unknown) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

// ht task edit
task
  .command('edit')
  .description('Edit a task definition (partial update)')
  .argument('<id>', 'Task definition ID')
  .option('--name <name>', 'Task name')
  .option('--category <category>', 'Category')
  .option('--frequency-type <type>', 'Frequency type')
  .option('--frequency-interval <n>', 'Interval', parseInt)
  .option('--days-of-week <days>', 'Days of week (comma-separated)')
  .option('--day-of-month <day>', 'Day of month (1-28)', parseInt)
  .option('--notes <text>', 'Notes')
  .option('--points <n>', 'Points (1-10)', parseInt)
  .option('--scheduled-hour <hour>', 'Scheduled hour (0-23)', parseInt)
  .action(async (idStr: string, opts: {
    name?: string;
    category?: string;
    frequencyType?: string;
    frequencyInterval?: number;
    daysOfWeek?: string;
    dayOfMonth?: number;
    notes?: string;
    points?: number;
    scheduledHour?: number;
  }) => {
    try {
      // Fetch current definition
      const current = await apiFetch('GET', `/api/tasks/${idStr}`) as TaskDef;

      // Build body: merge current values with provided overrides
      const body: Record<string, unknown> = {
        name: opts.name ?? current.name,
        category: opts.category ?? current.category,
        frequency_type: opts.frequencyType ?? current.frequency_type,
      };

      // frequency_interval
      if (opts.frequencyInterval !== undefined) {
        body.frequency_interval = opts.frequencyInterval;
      } else if (current.frequency_interval !== null) {
        body.frequency_interval = current.frequency_interval;
      }

      // days_of_week
      if (opts.daysOfWeek !== undefined) {
        body.days_of_week = opts.daysOfWeek.split(',');
      } else if (current.days_of_week) {
        body.days_of_week = current.days_of_week.split(',');
      }

      // day_of_month
      if (opts.dayOfMonth !== undefined) {
        body.day_of_month = opts.dayOfMonth;
      } else if (current.day_of_month !== null) {
        body.day_of_month = current.day_of_month;
      }

      body.notes = opts.notes ?? current.notes ?? undefined;
      body.points = opts.points ?? current.points;
      body.scheduled_hour = opts.scheduledHour ?? current.scheduled_hour;

      const updated = await apiFetch('PUT', `/api/tasks/${idStr}`, body) as TaskDef;
      console.log(JSON.stringify(updated, null, 2));
    } catch (e: unknown) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

// ht task toggle
task
  .command('toggle')
  .description('Toggle is_active for a task definition')
  .argument('<id>', 'Task definition ID')
  .action(async (idStr: string) => {
    try {
      const t = await apiFetch('POST', `/api/tasks/${idStr}/toggle`) as TaskDef;
      console.log(`Task ${t.id} is now ${t.is_active ? 'active' : 'inactive'}.`);
    } catch (e: unknown) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

// ht task delete
task
  .command('delete')
  .description('Delete a task definition')
  .argument('<id>', 'Task definition ID')
  .action(async (idStr: string) => {
    try {
      await apiFetch('DELETE', `/api/tasks/${idStr}`);
      console.log(`Task definition ${idStr} deleted.`);
    } catch (e: unknown) {
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
