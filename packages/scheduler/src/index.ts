import {
  getTodayJST,
  getCurrentHourJST,
  getVisibleGarbageTypes,
  buildGarbageTaskTitle,
  type GarbageTypeId,
} from '@household-tasks/shared';
import {
  getDb,
  getActiveTasks,
  isAlreadyCreatedToday,
  isSickChildModeEnabled,
  logExecution,
  updateNextDueDate,
  getFailedTasks,
  hasRecentInstance,
  createTaskInstance,
  getLastCompletedDateJST,
  getHiddenGarbageTypes,
  type TaskDefinitionRow,
} from './db.js';
import { shouldCreateToday, shouldCreateThisHour, isWithinActivePeriod, calculateNextDueDate } from './matcher.js';

const dryRun = process.argv.includes('--dry-run');

/**
 * ごみ捨てタスク（special_kind='garbage'）の起票可否とタイトルを決める。
 *
 * 収集が無い日（日曜・年末年始など）と、設定で非表示にした種類しか無い日は起票しない。
 * 起票する場合はタイトルに種類を添える（例: `ゴミ捨て（燃せるごみ）`）。
 * ごみ捨て以外のタスクは常にそのまま起票する。
 */
function resolveGarbageTask(
  task: TaskDefinitionRow,
  today: string,
  hiddenTypes: readonly GarbageTypeId[],
): { skip: boolean; title: string } {
  if (task.special_kind !== 'garbage') return { skip: false, title: task.name };

  const types = getVisibleGarbageTypes(today, hiddenTypes);
  if (types.length === 0) return { skip: true, title: task.name };
  return { skip: false, title: buildGarbageTaskTitle(task.name, types) };
}

async function main() {
  const today = getTodayJST();
  const currentHour = getCurrentHourJST();
  const db = getDb();

  console.log(`[${new Date().toISOString()}] Scheduler running for date: ${today}, hour: ${currentHour}${dryRun ? ' (DRY RUN)' : ''}`);

  const sickMode = isSickChildModeEnabled(db);
  if (sickMode) {
    console.log('Sick child mode is ON: skipping normal_only tasks, including sick_only tasks');
  }

  // 子ども風邪の日モード: ON中は通常時のみタスクを起票しない。OFF中は風邪の日専用タスクを起票しない
  const tasks = getActiveTasks(db).filter((task) =>
    sickMode ? task.sick_day_behavior !== 'normal_only' : task.sick_day_behavior !== 'sick_only'
  );
  const hiddenGarbageTypes = getHiddenGarbageTypes(db);
  let created = 0;
  let skipped = 0;
  let failed = 0;

  // Process scheduled tasks
  for (const task of tasks) {
    const lastCompletedDate =
      task.frequency_type === 'days_after_completion'
        ? getLastCompletedDateJST(db, task.id)
        : null;
    if (!shouldCreateToday(task, today, lastCompletedDate)) continue;
    if (!isWithinActivePeriod(task, today)) continue;
    if (!shouldCreateThisHour(task, currentHour)) continue;

    // 収集が無い日／設定で非表示にした種類だけの日はごみ捨てを起票しない
    const garbage = resolveGarbageTask(task, today, hiddenGarbageTypes);
    if (garbage.skip) {
      console.log(`  SKIP (no garbage collection today): "${task.name}"`);
      continue;
    }

    if (isAlreadyCreatedToday(db, task.id, today)) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  [DRY RUN] Would create: "${garbage.title}"`);
      created++;
      continue;
    }

    try {
      const hasDuplicate = hasRecentInstance(db, task.id, today, task.scheduled_hour);
      if (hasDuplicate) {
        logExecution(db, task.id, null, 'skipped_duplicate', undefined, today);
        skipped++;
        console.log(`  SKIP (duplicate): "${task.name}"`);
        // Consume this cycle so deleting the lingering instance doesn't trigger
        // immediate re-creation on the next cron run.
        if (task.next_due_date) {
          const nextDate = calculateNextDueDate(task, task.next_due_date);
          updateNextDueDate(db, task.id, nextDate);
        }
        continue;
      }

      const now = new Date().toISOString();
      const instanceId = createTaskInstance(db, task.id, garbage.title, task.points, now);
      logExecution(db, task.id, instanceId, 'created', undefined, today);
      created++;
      console.log(`  CREATED: "${garbage.title}" (instance_id=${instanceId})`);

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

      // 再試行でも同じ判定を通す（失敗を引きずって収集の無い日に起票しないため）
      const retryGarbage = resolveGarbageTask(task, today, hiddenGarbageTypes);
      if (retryGarbage.skip) {
        console.log(`  RETRY SKIP (no garbage collection today): "${task.name}"`);
        continue;
      }

      try {
        const hasDuplicate = hasRecentInstance(db, task.id, today, task.scheduled_hour);
        if (hasDuplicate) {
          logExecution(db, task.id, null, 'skipped_duplicate', undefined, today);
          skipped++;
          console.log(`  RETRY SKIP (duplicate): "${task.name}"`);
          if (task.next_due_date) {
            const nextDate = calculateNextDueDate(task, task.next_due_date);
            updateNextDueDate(db, task.id, nextDate);
          }
          continue;
        }

        const now = new Date().toISOString();
        const instanceId = createTaskInstance(db, task.id, retryGarbage.title, task.points, now);
        logExecution(db, task.id, instanceId, 'created', undefined, today);
        created++;
        console.log(`  RETRY OK: "${retryGarbage.title}" (instance_id=${instanceId})`);

        if (task.next_due_date) {
          const nextDate = calculateNextDueDate(task, task.next_due_date);
          updateNextDueDate(db, task.id, nextDate);
        }
      } catch (err: any) {
        logExecution(db, task.id, null, 'failed', err.message, today);
        failed++;
        console.error(`  RETRY FAILED: "${task.name}" - ${err.message}`);
      }
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
