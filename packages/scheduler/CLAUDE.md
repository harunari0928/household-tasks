# Scheduler Package

Node.js cron job that runs hourly (at :00). Reads task definitions from SQLite and creates matching task instances in the `task_instances` table.

## Structure

- `src/index.ts` — Main entry: iterates active tasks, checks matching, handles idempotency/duplicates/retries.
- `src/matcher.ts` — `shouldCreateToday()` frequency matching, `calculateNextDueDate()` for interval tasks.
- `src/db.ts` — SQLite queries: getActiveTasks, isAlreadyCreatedToday, logExecution, updateNextDueDate, getFailedTasks, hasUncompletedInstance, createTaskInstance.

## Execution flow

1. Get all active task definitions
2. For each task, check `shouldCreateToday(task, today)`
3. Check `isAlreadyCreatedToday` (execution_log idempotency)
4. Check `hasUncompletedInstance` in task_instances (duplicate prevention)
5. Create task instance in SQLite (`INSERT INTO task_instances`)
6. Update `next_due_date` for interval-based tasks
7. Retry any previously failed tasks

## Key details

- `--dry-run` flag skips actual task instance creation.
- `calculateNextDueDate()` computes from the current due date (not today) to preserve rhythm after cron skips.
- `next_due_date` is null for fixed-schedule tasks (daily/weekly/monthly) — matching is date-based only.
- No external API dependency — all operations are local SQLite.

## Docker

Runs via cron inside `node:20-slim`. The entrypoint passes env vars to cron via `/etc/environment`.
