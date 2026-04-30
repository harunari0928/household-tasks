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
  month_of_year: number | null;
  next_due_date: string | null;
  is_active: number;
  notes: string | null;
  points: number;
  scheduled_hour: number;
}

type Migration = {
  version: number;
  up: (db: Database.Database) => void;
};

const migrations: Migration[] = [
  {
    version: 5,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_instances (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_definition_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done')),
          assignee TEXT DEFAULT NULL,
          points INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          completed_at TEXT DEFAULT NULL,
          FOREIGN KEY (task_definition_id) REFERENCES task_definitions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_task_instances_status ON task_instances(status);
        CREATE INDEX IF NOT EXISTS idx_task_instances_task_def ON task_instances(task_definition_id);
        CREATE INDEX IF NOT EXISTS idx_task_instances_completed ON task_instances(completed_at);
      `);
    },
  },
  {
    version: 6,
    up: (db) => {
      db.exec('ALTER TABLE task_instances ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 9,
    up: (db) => {
      db.exec('ALTER TABLE task_definitions ADD COLUMN scheduled_hour INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 10,
    up: (db) => {
      db.exec('ALTER TABLE task_definitions ADD COLUMN month_of_year INTEGER DEFAULT NULL');
    },
  },
  {
    version: 11,
    up: (db) => {
      db.exec(`
        UPDATE task_instances SET status = 'todo' WHERE status = 'in_progress';

        CREATE TABLE task_instances_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_definition_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'done')),
          assignee TEXT DEFAULT NULL,
          points INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          completed_at TEXT DEFAULT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (task_definition_id) REFERENCES task_definitions(id)
        );
        INSERT INTO task_instances_new
          SELECT id, task_definition_id, title, status, assignee, points, created_at, completed_at, sort_order
          FROM task_instances;
        DROP TABLE task_instances;
        ALTER TABLE task_instances_new RENAME TO task_instances;
        CREATE INDEX idx_task_instances_status ON task_instances(status);
        CREATE INDEX idx_task_instances_task_def ON task_instances(task_definition_id);
        CREATE INDEX idx_task_instances_completed ON task_instances(completed_at);
      `);
    },
  },
];

function runMigrations(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');

  const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null };
  const currentVersion = row?.v ?? 0;

  const applyMigration = db.transaction((migration: Migration) => {
    migration.up(db);
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version);
  });

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      applyMigration(migration);
    }
  }
}

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
    dbInstance.pragma('busy_timeout = 5000');
    runMigrations(dbInstance);
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
  taskInstanceId: number | null,
  status: 'created' | 'failed' | 'skipped_duplicate',
  errorMessage?: string,
  executedAt?: string,
): void {
  if (executedAt) {
    db.prepare(`
      INSERT INTO execution_log (task_definition_id, task_instance_id, status, error_message, executed_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(taskDefId, taskInstanceId, status, errorMessage || null, executedAt);
  } else {
    db.prepare(`
      INSERT INTO execution_log (task_definition_id, task_instance_id, status, error_message)
      VALUES (?, ?, ?, ?)
    `).run(taskDefId, taskInstanceId, status, errorMessage || null);
  }
}

export function hasUncompletedInstance(db: Database.Database, taskDefId: number): boolean {
  const row = db.prepare(`
    SELECT 1 FROM task_instances WHERE task_definition_id = ? AND status != 'done' LIMIT 1
  `).get(taskDefId);
  return !!row;
}

export function createTaskInstance(
  db: Database.Database,
  taskDefId: number,
  title: string,
  points: number,
  createdAt: string,
): number {
  const maxRow = db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) as max_order FROM task_instances WHERE status = 'todo'"
  ).get() as { max_order: number };
  const sortOrder = maxRow.max_order + 1;

  const result = db.prepare(`
    INSERT INTO task_instances (task_definition_id, title, status, points, created_at, sort_order)
    VALUES (?, ?, 'todo', ?, ?, ?)
  `).run(taskDefId, title, points, createdAt, sortOrder);
  return Number(result.lastInsertRowid);
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
