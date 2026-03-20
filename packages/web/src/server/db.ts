import Database from 'better-sqlite3';
import path from 'path';

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
          vikunja_project_id INTEGER DEFAULT NULL,
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
          vikunja_task_id INTEGER DEFAULT NULL,
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
