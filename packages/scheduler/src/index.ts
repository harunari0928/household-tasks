import { getTodayJST } from '@household-tasks/shared';
import {
  getDb,
  getActiveTasks,
  isAlreadyCreatedToday,
  logExecution,
  updateNextDueDate,
  getFailedTasks,
} from './db.js';
import { shouldCreateToday, calculateNextDueDate } from './matcher.js';
import { createTask, hasUncompletedTask } from './vikunja.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const today = getTodayJST();
  const db = getDb();

  const defaultProjectId = parseInt(process.env.DEFAULT_PROJECT_ID || '1', 10);

  console.log(`[${new Date().toISOString()}] Scheduler running for date: ${today}${dryRun ? ' (DRY RUN)' : ''}`);

  const tasks = getActiveTasks(db);
  let created = 0;
  let skipped = 0;
  let failed = 0;

  // Process scheduled tasks
  for (const task of tasks) {
    if (!shouldCreateToday(task, today)) continue;

    if (isAlreadyCreatedToday(db, task.id, today)) {
      skipped++;
      continue;
    }

    const projectId = task.vikunja_project_id || defaultProjectId;

    if (dryRun) {
      console.log(`  [DRY RUN] Would create: "${task.name}" in project ${projectId}`);
      created++;
      continue;
    }

    try {
      const hasDuplicate = await hasUncompletedTask(projectId, task.name);
      if (hasDuplicate) {
        logExecution(db, task.id, null, 'skipped_duplicate', undefined, today);
        skipped++;
        console.log(`  SKIP (duplicate): "${task.name}"`);
        continue;
      }

      const description = `カテゴリ: ${task.category} | 頻度: ${task.frequency_type}`;
      const vikunjaTaskId = await createTask(projectId, task.name, description);
      logExecution(db, task.id, vikunjaTaskId, 'created', undefined, today);
      created++;
      console.log(`  CREATED: "${task.name}" (vikunja_id=${vikunjaTaskId})`);

      // Update next_due_date for interval-based tasks
      if (task.next_due_date) {
        const nextDate = calculateNextDueDate(task, task.next_due_date);
        updateNextDueDate(db, task.id, nextDate);
      }
    } catch (err: any) {
      logExecution(db, task.id, null, 'failed', err.message, today);
      failed++;
      console.error(`  FAILED: "${task.name}" - ${err.message}`);
    }
  }

  // Retry previously failed tasks
  const failedTasks = getFailedTasks(db);
  if (failedTasks.length > 0 && !dryRun) {
    console.log(`\nRetrying ${failedTasks.length} previously failed task(s)...`);
    for (const { task_definition_id } of failedTasks) {
      const task = tasks.find((t) => t.id === task_definition_id);
      if (!task) continue;

      const projectId = task.vikunja_project_id || defaultProjectId;
      try {
        const hasDuplicate = await hasUncompletedTask(projectId, task.name);
        if (hasDuplicate) {
          logExecution(db, task.id, null, 'skipped_duplicate', undefined, today);
          skipped++;
          console.log(`  RETRY SKIP (duplicate): "${task.name}"`);
          continue;
        }

        const description = `カテゴリ: ${task.category} | 頻度: ${task.frequency_type}`;
        const vikunjaTaskId = await createTask(projectId, task.name, description);
        logExecution(db, task.id, vikunjaTaskId, 'created', undefined, today);
        created++;
        console.log(`  RETRY OK: "${task.name}" (vikunja_id=${vikunjaTaskId})`);
      } catch (err: any) {
        logExecution(db, task.id, null, 'failed', err.message, today);
        failed++;
        console.error(`  RETRY FAILED: "${task.name}" - ${err.message}`);
      }
    }
  }

  console.log(`\nSummary: created=${created}, skipped=${skipped}, failed=${failed}`);
}

main().catch((err) => {
  console.error('Scheduler error:', err);
  process.exit(1);
});
