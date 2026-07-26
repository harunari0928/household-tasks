import Database from 'better-sqlite3';
import path from 'path';
import { getTodayJST, formatLocalDate, addMonths } from '@household-tasks/shared';

const DB_PATH = process.env.DB_PATH || './data/task_definitions.db';

let dbInstance: Database.Database | null = null;

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

type Migration = {
  version: number;
  up: (db: Database.Database) => void;
};

const migrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      // Initial schema — no-op if tables already exist
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_definitions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          frequency_type TEXT NOT NULL,
          frequency_interval INTEGER DEFAULT 1,
          days_of_week TEXT DEFAULT NULL,
          day_of_month INTEGER DEFAULT NULL,
          assignee TEXT DEFAULT NULL,
          next_due_date TEXT DEFAULT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          notes TEXT DEFAULT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS execution_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_definition_id INTEGER NOT NULL,
          executed_at TEXT NOT NULL DEFAULT (datetime('now')),
          task_instance_id INTEGER DEFAULT NULL,
          status TEXT NOT NULL DEFAULT 'created',
          error_message TEXT DEFAULT NULL,
          FOREIGN KEY (task_definition_id) REFERENCES task_definitions(id)
        );

`);
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS attachments (
          id TEXT PRIMARY KEY,
          task_id INTEGER NOT NULL,
          filename TEXT NOT NULL,
          original_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (task_id) REFERENCES task_definitions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_attachments_task_id ON attachments(task_id);
      `);
    },
  },
  {
    version: 3,
    up: (db) => {
      db.exec(`
        ALTER TABLE task_definitions ADD COLUMN points INTEGER NOT NULL DEFAULT 1;

        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 4,
    up: (db) => {
      db.exec('ALTER TABLE task_definitions DROP COLUMN assignee');
    },
  },
  {
    version: 5,
    up: (db) => {
      db.exec(`
        CREATE TABLE task_instances (
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
        CREATE INDEX idx_task_instances_status ON task_instances(status);
        CREATE INDEX idx_task_instances_task_def ON task_instances(task_definition_id);
        CREATE INDEX idx_task_instances_completed ON task_instances(completed_at);
      `);
    },
  },
  {
    version: 6,
    up: (db) => {
      db.exec('ALTER TABLE task_instances ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
      // Initialize sort_order for existing records (oldest first within each status)
      const rows = db.prepare(
        'SELECT id, status FROM task_instances ORDER BY status, created_at ASC, id ASC'
      ).all() as { id: number; status: string }[];
      const counters: Record<string, number> = {};
      const stmt = db.prepare('UPDATE task_instances SET sort_order = ? WHERE id = ?');
      for (const row of rows) {
        counters[row.status] = (counters[row.status] ?? 0);
        stmt.run(counters[row.status], row.id);
        counters[row.status]++;
      }
    },
  },
  {
    version: 7,
    up: (db) => {
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          display_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      // Migrate existing assignees from app_settings
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'kanban_assignees'").get() as { value: string } | undefined;
      if (row) {
        const assignees: string[] = JSON.parse(row.value);
        const insert = db.prepare('INSERT OR IGNORE INTO users (name, display_order) VALUES (?, ?)');
        assignees.forEach((name, i) => insert.run(name, i));
      }
      db.exec("DELETE FROM app_settings WHERE key = 'kanban_assignees'");
    },
  },
  {
    version: 8,
    up: (db) => {
      // Rename/drop only if columns exist (they won't on fresh DBs created after v1 cleanup)
      const elCols = db.pragma('table_info(execution_log)') as { name: string }[];
      if (elCols.some((c) => c.name === 'vikunja_task_id')) {
        db.exec('ALTER TABLE execution_log RENAME COLUMN vikunja_task_id TO task_instance_id');
      }
      const tdCols = db.pragma('table_info(task_definitions)') as { name: string }[];
      if (tdCols.some((c) => c.name === 'vikunja_project_id')) {
        db.exec('ALTER TABLE task_definitions DROP COLUMN vikunja_project_id');
      }
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
    // 稼働中DBの schema_version は（既に破棄されたマイグレーションにより）14まで進んでいるため15から採番する
    version: 15,
    up: (db) => {
      // Nヶ月ごとタスクの next_due_date が day_of_month を無視して算出されていたため、指定日に揃え直す
      const rows = db.prepare(`
        SELECT id, frequency_interval, day_of_month, next_due_date
        FROM task_definitions
        WHERE frequency_type = 'n_months' AND day_of_month IS NOT NULL AND next_due_date IS NOT NULL
      `).all() as { id: number; frequency_interval: number | null; day_of_month: number; next_due_date: string }[];

      const today = getTodayJST();
      const update = db.prepare('UPDATE task_definitions SET next_due_date = ? WHERE id = ?');

      for (const row of rows) {
        const due = new Date(row.next_due_date + 'T00:00:00');
        if (due.getDate() === row.day_of_month) continue;

        const interval = Math.max(1, row.frequency_interval ?? 1);
        // 同月の指定日に寄せる
        let fixed = addMonths(due, 0, row.day_of_month);
        // 未来の予定だったものが是正で過去日になる場合のみ、突然の起票を避けるため1周期進める
        // （もともと期限超過だったタスクは超過のまま残し、次回実行で起票させる）
        if (row.next_due_date > today) {
          while (formatLocalDate(fixed) < today) {
            fixed = addMonths(fixed, interval, row.day_of_month);
          }
        }
        update.run(formatLocalDate(fixed), row.id);
      }
    },
  },
];

export function runMigrations(db: Database.Database): void {
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

export function getUploadsDir(): string {
  return path.join(path.dirname(DB_PATH), 'uploads');
}
