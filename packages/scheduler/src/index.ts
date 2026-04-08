import Database from 'better-sqlite3';
import { getTodayJST, getCurrentHourJST } from '@household-tasks/shared';
import {
  getDb,
  getActiveTasks,
  isAlreadyCreatedToday,
  logExecution,
  updateNextDueDate,
  getFailedTasks,
  hasUncompletedInstance,
  createTaskInstance,
  type TaskDefinitionRow,
} from './db.js';
import { shouldCreateToday, shouldCreateThisHour, calculateNextDueDate } from './matcher.js';

const dryRun = process.argv.includes('--dry-run');

type CreateResult = 'created' | 'skipped_hour' | 'skipped_already_created' | 'skipped_duplicate' | 'failed';

function tryCreateInstance(
  db: Database.Database,
  task: TaskDefinitionRow,
  today: string,
  currentHour: number,
  context: 'scheduled' | 'retry',
): CreateResult {
  const prefix = context === 'retry' ? 'RETRY ' : '';

  if (!shouldCreateThisHour(task, currentHour)) {
    return 'skipped_hour';
  }

  if (isAlreadyCreatedToday(db, task.id, today)) {
    return 'skipped_already_created';
  }

  if (hasUncompletedInstance(db, task.id)) {
    logExecution(db, task.id, null, 'skipped_duplicate', undefined, today);
    console.log(`  ${prefix}SKIP (duplicate): "${task.name}"`);
    return 'skipped_duplicate';
  }

  try {
    const now = new Date().toISOString();
    const instanceId = createTaskInstance(db, task.id, task.name, task.points, now);
    logExecution(db, task.id, instanceId, 'created', undefined, today);
    console.log(`  ${prefix}CREATED: "${task.name}" (instance_id=${instanceId})`);

    if (task.next_due_date) {
      const nextDate = calculateNextDueDate(task, task.next_due_date);
      updateNextDueDate(db, task.id, nextDate);
    }

    return 'created';
  } catch (err: any) {
    logExecution(db, task.id, null, 'failed', err.message, today);
    console.error(`  ${prefix}FAILED: "${task.name}" - ${err.message}`);
    return 'failed';
  }
}

async function main() {
  const today = getTodayJST();
  const currentHour = getCurrentHourJST();
  const db = getDb();

  console.log(`[${new Date().toISOString()}] Scheduler running for date: ${today}, hour: ${currentHour}${dryRun ? ' (DRY RUN)' : ''}`);

  const tasks = getActiveTasks(db);
  let created = 0;
  let skipped = 0;
  let failed = 0;

  // Process scheduled tasks
  for (const task of tasks) {
    if (!shouldCreateToday(task, today)) continue;

    if (dryRun) {
      if (shouldCreateThisHour(task, currentHour)) {
        console.log(`  [DRY RUN] Would create: "${task.name}"`);
        created++;
      }
      continue;
    }

    const result = tryCreateInstance(db, task, today, currentHour, 'scheduled');
    if (result === 'created') created++;
    else if (result === 'failed') failed++;
    else skipped++;
  }

  // Retry previously failed tasks
  const failedTasks = getFailedTasks(db);
  if (failedTasks.length > 0 && !dryRun) {
    console.log(`\nRetrying ${failedTasks.length} previously failed task(s)...`);
    for (const { task_definition_id } of failedTasks) {
      const task = tasks.find((t) => t.id === task_definition_id);
      if (!task) continue;

      const result = tryCreateInstance(db, task, today, currentHour, 'retry');
      if (result === 'created') created++;
      else if (result === 'failed') failed++;
      else skipped++;
    }
  }

  console.log(`\nSummary: created=${created}, skipped=${skipped}, failed=${failed}`);

  // Notify web server to broadcast SSE update
  if (created > 0 && !dryRun) {
    const webUrl = process.env.WEB_URL || 'http://localhost:3100';
    try {
      await fetch(`${webUrl}/api/kanban/notify`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });
      console.log('Notified web server of new tasks');
    } catch {
      console.log('Could not notify web server (non-critical)');
    }
  }
}

main().catch((err) => {
  console.error('Scheduler error:', err);
  process.exit(1);
});
