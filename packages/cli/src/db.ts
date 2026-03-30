import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || './data/task_definitions.db';

export function getDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}
