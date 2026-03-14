# Scheduler Package

Node.js cron job that runs hourly (at :00). Reads task definitions from SQLite and creates matching tasks in Vikunja.

## Structure

- `src/index.ts` — Main entry: iterates active tasks, checks matching, handles idempotency/duplicates/retries.
- `src/matcher.ts` — `shouldCreateToday()` frequency matching, `calculateNextDueDate()` for interval tasks.
- `src/vikunja.ts` — Vikunja API client. `createTask()` (PUT method), `hasUncompletedTask()` duplicate check.
- `src/db.ts` — SQLite queries: getActiveTasks, isAlreadyCreatedToday, logExecution, updateNextDueDate, getFailedTasks, getConfigValue.

## Execution flow

1. Get all active task definitions
2. For each task, check `shouldCreateToday(task, today)`
3. Check `isAlreadyCreatedToday` (execution_log idempotency)
4. Check `hasUncompletedTask` in Vikunja (duplicate prevention)
5. Create task via Vikunja API (`PUT /api/v1/projects/:id/tasks`)
6. Update `next_due_date` for interval-based tasks
7. Retry any previously failed tasks

## Key details

- `--dry-run` flag skips actual Vikunja API calls.
- `calculateNextDueDate()` computes from the current due date (not today) to preserve rhythm after cron skips.
- `next_due_date` is null for fixed-schedule tasks (daily/weekly/monthly) — matching is date-based only.
- All fetch calls use `AbortSignal.timeout(10000)`.
- `default_project_id` comes from `scheduler_config` table.

## Docker

Runs via cron inside `node:20-slim`. The entrypoint passes env vars to cron via `/etc/environment`.
