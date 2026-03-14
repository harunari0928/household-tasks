import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || './data/task_definitions.db';

let dbInstance: Database.Database | null = null;

export interface TaskDefinitionRow {
  id: number;
  name: string;
  category: string;
  frequency_type: string;
  frequency_interval: number | null;
  days_of_week: string | null;
  day_of_month: number | null;
  assignee: string | null;
  vikunja_project_id: number | null;
  next_due_date: string | null;
  is_active: number;
  notes: string | null;
}

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
    dbInstance.pragma('busy_timeout = 5000');
  }
  return dbInstance;
}

export function getActiveTasks(db: Database.Database): TaskDefinitionRow[] {
  return db.prepare('SELECT * FROM task_definitions WHERE is_active = 1').all() as TaskDefinitionRow[];
}

export function isAlreadyCreatedToday(db: Database.Database, taskDefId: number, today: string): boolean {
  const row = db.prepare(`
    SELECT id FROM execution_log
    WHERE task_definition_id = ?
      AND date(executed_at) = ?
      AND status = 'created'
  `).get(taskDefId, today);
  return !!row;
}

export function logExecution(
  db: Database.Database,
  taskDefId: number,
  vikunjaTaskId: number | null,
  status: 'created' | 'failed' | 'skipped_duplicate',
  errorMessage?: string,
): void {
  db.prepare(`
    INSERT INTO execution_log (task_definition_id, vikunja_task_id, status, error_message)
    VALUES (?, ?, ?, ?)
  `).run(taskDefId, vikunjaTaskId, status, errorMessage || null);
}

export function updateNextDueDate(db: Database.Database, taskId: number, nextDate: string): void {
  db.prepare('UPDATE task_definitions SET next_due_date = ? WHERE id = ?').run(nextDate, taskId);
}

export function getFailedTasks(db: Database.Database): { task_definition_id: number; log_id: number }[] {
  return db.prepare(`
    SELECT el.task_definition_id, el.id as log_id
    FROM execution_log el
    INNER JOIN task_definitions td ON td.id = el.task_definition_id
    WHERE el.status = 'failed'
      AND el.id = (
        SELECT MAX(id) FROM execution_log
        WHERE task_definition_id = el.task_definition_id
      )
      AND td.is_active = 1
  `).all() as { task_definition_id: number; log_id: number }[];
}

export function getConfigValue(db: Database.Database, key: string): string {
  const row = db.prepare('SELECT value FROM scheduler_config WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || '';
}
