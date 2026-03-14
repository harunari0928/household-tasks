import Database from 'better-sqlite3';

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

export function runMigrations(db: Database.Database): void {
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

    CREATE TABLE IF NOT EXISTS scheduler_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO scheduler_config (key, value) VALUES ('vikunja_url', 'http://vikunja:3456/api/v1');
    INSERT OR IGNORE INTO scheduler_config (key, value) VALUES ('vikunja_api_token', '');
    INSERT OR IGNORE INTO scheduler_config (key, value) VALUES ('default_project_id', '');
  `);
}
