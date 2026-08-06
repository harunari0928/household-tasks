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
      // absence_behavior: 帰省・旅行などで家を空ける日の扱い。
      // 'hidden' なら不在日は起票せず、カンバンにも出さない。
      db.exec(`
        ALTER TABLE task_definitions ADD COLUMN absence_behavior TEXT NOT NULL DEFAULT 'normal';

        -- 不在日。Home Assistant の家族カレンダー同期が入れ替える。
        -- source='calendar' の行は同期のたびに全消し＆再投入するので、
        -- 手動で足した休みが消えないよう source='manual' と分けて持つ。
        CREATE TABLE IF NOT EXISTS absence_days (
          date TEXT PRIMARY KEY,
          summary TEXT DEFAULT NULL,
          source TEXT NOT NULL DEFAULT 'calendar',
          updated_at TEXT NOT NULL
        );
      `);

      // 既定値: 「家に居ないと物理的にできない家事」を hidden に倒す。
      // 不在中でもできる/やるべきもの（注文・家計・受診・子の世話）は normal のまま。
      // カテゴリで一括指定してから、下で例外を戻す。
      db.exec(`
        UPDATE task_definitions SET absence_behavior = 'hidden'
        WHERE category IN ('water', 'kitchen', 'floor', 'entrance', 'laundry', 'trash');
      `);

      // カテゴリ既定から外れるもの: 注文・在庫確認・電池交換は外出先や帰宅後でも支障なく、
      // 締切のある注文（パル・Oisix）を不在で飛ばすと1週間ぶん買い物が消えるので normal に戻す。
      db.exec(`
        UPDATE task_definitions SET absence_behavior = 'normal'
        WHERE name LIKE '%注文%'
           OR name LIKE '%在庫のチェック%'
           OR name LIKE '%電池交換%';
      `);

      // childcare は既定 normal（帰省先でも子の世話は要る）だが、
      // 保育園の送り迎え・家の設備に紐づくものは不在日には発生しないので hidden。
      db.exec(`
        UPDATE task_definitions SET absence_behavior = 'hidden'
        WHERE category = 'childcare'
          AND (name LIKE '%保育園%' OR name LIKE '%布団シーツ%' OR name LIKE '%植物水やり%'
               OR name LIKE '%チェーン%');
      `);

      // 自宅の炊事・自宅設備に紐づくものは、カテゴリ既定が normal でも不在日には発生しない。
      // （帰省先で「晩御飯つくる」「食後片付け」は出ても意味がない）
      db.exec(`
        UPDATE task_definitions SET absence_behavior = 'hidden'
        WHERE (category = 'cooking' AND (
                 name LIKE '%晩御飯%' OR name LIKE '%片付け%' OR name LIKE '%食器%'))
           OR (category = 'lifestyle' AND name LIKE '%サーキュレーター%');
      `);
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
