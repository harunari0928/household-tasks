import Database from 'better-sqlite3';
import {
  parseHiddenGarbageTypes,
  type GarbageTypeId,
  type AbsenceBehaviorKey,
} from '@household-tasks/shared';

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
  nth_weekday_position: number | null;
  period_start_mm: number | null;
  period_start_dd: number | null;
  period_end_mm: number | null;
  period_end_dd: number | null;
  next_due_date: string | null;
  is_active: number;
  notes: string | null;
  points: number;
  scheduled_hour: number;
  sick_day_behavior: 'normal_only' | 'always' | 'sick_only';
  special_kind: string | null;
  absence_behavior: AbsenceBehaviorKey;
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
  {
    version: 12,
    up: (db) => {
      db.exec('ALTER TABLE task_definitions ADD COLUMN nth_weekday_position INTEGER DEFAULT NULL');
    },
  },
  {
    version: 13,
    up: (db) => {
      db.exec(`
        ALTER TABLE task_definitions ADD COLUMN period_start_mm INTEGER DEFAULT NULL;
        ALTER TABLE task_definitions ADD COLUMN period_start_dd INTEGER DEFAULT NULL;
        ALTER TABLE task_definitions ADD COLUMN period_end_mm INTEGER DEFAULT NULL;
        ALTER TABLE task_definitions ADD COLUMN period_end_dd INTEGER DEFAULT NULL;
      `);
    },
  },
  {
    version: 14,
    up: (db) => {
      db.exec(`
        ALTER TABLE task_definitions ADD COLUMN sick_day_behavior TEXT NOT NULL DEFAULT 'normal_only';

        UPDATE task_definitions SET sick_day_behavior = 'always'
        WHERE category IN ('trash', 'cooking', 'laundry');
      `);
    },
  },
  {
    version: 16,
    up: (db) => {
      // special_kind: アプリ組み込みの特別な扱いを持つタスクの識別子。
      // 'garbage' はごみ収集カレンダーと連動し、削除も禁止される（識別子が失われると
      // 設定画面だけが残って起票されない、という分かりにくい壊れ方をするため）。
      db.exec("ALTER TABLE task_definitions ADD COLUMN special_kind TEXT DEFAULT NULL");

      // 既存の「ゴミ捨て」定義を拾って紐付ける。ID決め打ちを避けるため名前とカテゴリで探す。
      db.prepare(`
        UPDATE task_definitions SET special_kind = 'garbage'
        WHERE category = 'trash'
          AND (name = 'ゴミ捨て' OR name = 'ごみ捨て')
      `).run();
    },
  },
  {
    version: 17,
    up: (db) => {
      // 不在日（帰省・旅行）の扱い。列と表の定義は web 側の v17 と必ず揃えること。
      // scheduler が web より先に起動した場合はこちらが先に作る。
      db.exec(`
        ALTER TABLE task_definitions ADD COLUMN absence_behavior TEXT NOT NULL DEFAULT 'normal';

        CREATE TABLE IF NOT EXISTS absence_days (
          date TEXT PRIMARY KEY,
          summary TEXT DEFAULT NULL,
          source TEXT NOT NULL DEFAULT 'calendar',
          updated_at TEXT NOT NULL
        );
      `);

      db.exec(`
        UPDATE task_definitions SET absence_behavior = 'hidden'
        WHERE category IN ('water', 'kitchen', 'floor', 'entrance', 'laundry', 'trash');
      `);

      db.exec(`
        UPDATE task_definitions SET absence_behavior = 'normal'
        WHERE name LIKE '%注文%'
           OR name LIKE '%在庫のチェック%'
           OR name LIKE '%電池交換%';
      `);

      db.exec(`
        UPDATE task_definitions SET absence_behavior = 'hidden'
        WHERE category = 'childcare'
          AND (name LIKE '%保育園%' OR name LIKE '%布団シーツ%' OR name LIKE '%植物水やり%'
               OR name LIKE '%チェーン%');
      `);

      db.exec(`
        UPDATE task_definitions SET absence_behavior = 'hidden'
        WHERE (category = 'cooking' AND (
                 name LIKE '%晩御飯%' OR name LIKE '%片付け%' OR name LIKE '%食器%'))
           OR (category = 'lifestyle' AND name LIKE '%サーキュレーター%');
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

export function isSickChildModeEnabled(db: Database.Database): boolean {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'sick_child_mode'").get() as
    | { value: string }
    | undefined;
  return row?.value === '1';
}

export function getHiddenGarbageTypes(db: Database.Database): GarbageTypeId[] {
  // app_settings は web 側のマイグレーションで作られるため、scheduler が先に起動した
  // 直後は存在しないことがある。設定が読めない場合は「何も隠さない」に倒す。
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'garbage_hidden_types'").get() as
      | { value: string }
      | undefined;
    return parseHiddenGarbageTypes(row?.value);
  } catch {
    return [];
  }
}

/**
 * 指定日が不在日か。不在なら由来の予定名（手動追加なら null）を添えて返す。
 *
 * absence_days は web 側のマイグレーションでも作られるため、scheduler が先に起動した
 * 直後は存在しないことがある。読めない場合は「不在ではない」に倒す
 * （＝通常どおり起票する。判定不能でタスクが黙って消えるより、余分に出る方が安全）。
 */
export function findAbsenceDay(
  db: Database.Database,
  date: string,
): { date: string; summary: string | null } | null {
  try {
    const row = db.prepare('SELECT date, summary FROM absence_days WHERE date = ?').get(date) as
      | { date: string; summary: string | null }
      | undefined;
    return row ?? null;
  } catch {
    return null;
  }
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

export function hasRecentInstance(
  db: Database.Database,
  taskDefId: number,
  todayJST: string,
  scheduledHour: number,
): boolean {
  // 再起票を抑止する条件:
  //   - 未完了インスタンスが残っている（バックログ）
  //   - 当日(JST)の起票時刻以降に完了済み = 今日の分は消化済み
  // 当日の起票時刻より前に完了した場合（前日以前のバックログを朝に片付けた等）は、
  // 今日の分が未消化なので再起票を許可する。
  const row = db.prepare(`
    SELECT 1 FROM task_instances
    WHERE task_definition_id = ?
      AND (
        status != 'done'
        OR (
          date(completed_at, '+9 hours') = ?
          AND CAST(strftime('%H', completed_at, '+9 hours') AS INTEGER) >= ?
        )
      )
    LIMIT 1
  `).get(taskDefId, todayJST, scheduledHour);
  return !!row;
}

export function getLastCompletedDateJST(db: Database.Database, taskDefId: number): string | null {
  const row = db.prepare(`
    SELECT date(completed_at, '+9 hours') as d
    FROM task_instances
    WHERE task_definition_id = ?
      AND status = 'done'
      AND completed_at IS NOT NULL
    ORDER BY completed_at DESC
    LIMIT 1
  `).get(taskDefId) as { d: string } | undefined;
  return row?.d ?? null;
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
