# Household Task Automation System

pnpm monorepo that manages ~77 household cleaning/childcare/lifestyle tasks with a Kanban board Web UI and automatic task scheduling.

## Architecture

- `shared/` — Shared utilities (date helpers). Published as `@household-tasks/shared`.
- `packages/web/` — React 19 + Vite frontend (Kanban board + task management), Express.js backend, SQLite (better-sqlite3).
- `packages/scheduler/` — Node.js cron job that creates task instances in SQLite daily at 06:00 JST.
- `packages/cli/` — CLI tool for AI-driven task management.
- `tests/` — Playwright E2E tests covering kanban board, task CRUD, scheduler logic, and stats.
- `scripts/` — Setup and seed scripts.

## Development

開発サーバーは Docker Compose で動かしている。コード変更を反映するにはコンテナのリビルド＆再起動が必要。

```bash
# コード変更後の反映
docker compose up -d --build web        # web のリビルド＆再起動
docker compose up -d --build scheduler  # scheduler のリビルド＆再起動

# 全サービス起動
docker compose up -d
```

ローカルビルド（テスト用）:
```bash
pnpm install
pnpm --filter shared build          # Must build shared first
pnpm --filter web build             # Vite (client) + tsc (server)
pnpm --filter scheduler build       # tsc
```

## Testing

```bash
npx playwright test                          # All tests
npx playwright test tests/kanban.spec.ts     # Kanban board tests
npx playwright test tests/task-crud.spec.ts  # Task CRUD UI tests
npx playwright test tests/scheduler.spec.ts  # Scheduler logic tests
```

- Playwright config runs two webServers: Express API on `:3101` and Vite on `:5174`.
- Tests use `DB_PATH=data/test_task_definitions.db` for isolation.
- Each test calls `POST /api/test/reset` to clean the DB before running.
- Scheduler tests run the scheduler as a child process and verify via Kanban board UI.

## Deployment

```bash
docker compose up -d
./scripts/seed.sh            # Import 77 task definitions
```

## Environment variables

- `.env` is NOT loaded by dotenv — variables are passed via `docker-compose.yml`'s `environment` section using `${VAR}` interpolation. For local dev without Docker, pass env vars manually.
- Required: `DB_PATH`, `PORT`, `TZ=Asia/Tokyo`.

## Worktree開発

git worktreeで並行作業する場合、Docker Compose環境のポート競合を避けるため:

1. worktreeの`.env`にメインと異なるポートを設定:
   ```
   WEB_PORT=3200
   ```
2. `docker compose up -d` で起動（プロジェクト名はディレクトリ名で自動分離）
3. ブラウザは `http://localhost:<WEB_PORT>` でアクセス
4. Playwrightテストも他の作業ツリーと並行実行するならポートを分ける:
   ```bash
   TEST_API_PORT=3102 TEST_WEB_PORT=5175 npx playwright test
   ```

## 外部からの連携

- **Home Assistant が電池交換タスクを起票する。** タスク定義 ID 108〜114 は SwitchBot 機器の電池切れ用で、
  `is_active = 0`（スケジューラは起票しない）にしたうえで HA の automation `battery_low_create_task` が
  `POST /api/kanban/create-from-definition/:id` で起票する。**この定義を削除すると自動起票が壊れる。**
  対応表は `~/repos/homeassistant/CLAUDE.md` を参照。
- **HA が家事レポートを議事録に埋め込む。** `~/repos/homeassistant/config/scripts/household_report.py` が
  `data/task_definitions.db` を読み取り専用で参照している。集計の意味論は `GET /api/stats/points` と
  同じ（共同タスク `ryo,yuka` は分割して両者に満額加算）。**`ht stats` は共同タスクを別枠で集計するため
  数字が一致しない**ので、変更するときは3か所の整合に注意。

## ごみ収集カレンダー連動

- **ごみ捨てタスクは収集日に合わせて起票される。** カレンダー（小田原・足柄地区）は
  `shared/garbage.ts` にあり、曜日と第何週かだけで計算する（外部データ・APIに依存しない）。
  - 収集が無い日（**日曜**・年末年始 12/31〜1/3）は起票しない。
  - タイトルに種類を出す（例:「ゴミ捨て（燃せるごみ）」）。`task_instances.title` に
    可変文字列が入るので、**タスク名の完全一致で照合するコードを書かないこと**。
  - 設定画面（`#/settings` → ごみ収集）で種類ごとに表示/非表示を切り替えられる。
    保存先は `app_settings` の `garbage_hidden_types`（JSON配列）。
    **設定変更は起票済みのタスクには遡及しない**（当日分は残る）。
- **同じ収集ルールが Home Assistant 側にもある。**
  `~/repos/homeassistant/config/custom_components/claude_code_conversation/conversation.py`
  の `_execute_garbage_collection`（音声で「今日のごみは何？」に答えるもの）。
  **収集ルールが変わったら両方を直す。** 共有していないのは、HA の音声応答を
  このアプリの死活に依存させないため。
- **`special_kind` 付きのタスク定義は物理削除できない**（API が 409 を返し、UI は削除ボタンを出さない）。
  ごみ捨ては `special_kind = 'garbage'`。識別子が失われると設定画面だけが残って起票されない、という
  分かりにくい壊れ方をするため。**止めたいときは `is_active` のトグル（無効化）を使う。**
  マイグレーション v16 が名前（`ゴミ捨て`/`ごみ捨て`）とカテゴリで既存定義に付与する（ID決め打ちではない）。

## Key conventions

- All dates use JST (Asia/Tokyo). `getTodayJST()` in shared/ returns `YYYY-MM-DD`.
- `TEST_TODAY` env var overrides today's date for testing.
- Scheduler creates `task_instances` directly in SQLite (no external API dependency).
- SQLite timestamps use `new Date().toISOString()` (millisecond precision), not SQLite's `datetime('now')`.
- Express `app` and `router` require explicit type annotations to avoid TS2742 errors with pnpm's strict module resolution.
- `package.json` `pnpm.onlyBuiltDependencies` must include `better-sqlite3`, `esbuild`, `sqlite3` — otherwise Docker builds fail with missing native modules.
- Kanban board uses SSE (`/api/kanban/events`) for real-time updates between users.
  - **ブラウザの同時接続上限（HTTP/1.1 で 1オリジン約6本）に注意。** 1タブで
    KanbanBoard と useSickMode が常時 EventSource を張っているので、
    新しいフックが無条件に SSE を開くと**2タブ目の SSE が繋がらなくなる**
    （風邪の日モードの別タブ即時反映が壊れる形で実際に踏んだ）。
    購読は `useAbsence({ subscribe: true })` のように**必要な画面だけ opt-in** にする。
- `@dnd-kit` for drag-and-drop on the Kanban board.
- **不在日（帰省・旅行）**: `absence_days` テーブルの日付は
  Home Assistant の `config/scripts/absence_sync.py` が家族カレンダーから同期する
  （判定キーワードはアプリ側 `app_settings.absence_keywords`、設定画面で編集可）。
  タスクごとの扱いは `task_definitions.absence_behavior`（`normal` / `hidden`）。
  - **不在判定のスキップは `updateNextDueDate` より手前で行う**（scheduler の
    トップレベル filter）。これにより `yearly` などの期限到来型は
    next_due_date を消費せず**帰宅日に繰り越して起票**される。
    重複スキップの分岐は意図的に next_due_date を進めるので、
    **そちらに相乗りさせると年1タスクが「不在で1年後送り」になる**。
  - `daily`/`weekly`/`monthly` は日付マッチなので不在日ぶんは単に消える
    （旅行中の浴槽掃除が積み上がらない、が意図）。
  - **予定名のキーワード判定と期間の日付への展開は HA 側が持つ**
    （`absence_sync.py` の `expand_event`）。このアプリは展開済みの日付を
    `POST /api/absence/days` で受けるだけなので、**同じロジックをこちらに書かない**
    （終日予定の `end` は排他的、という罠を二重に抱えて片方だけ直す事故になる）。
  - Playwright の `getByRole('button', {name})` は**部分一致**。設定画面に
    「追加」ボタンを増やすときは aria-label に「追加」を**含めない**
    （含めると既存テストが strict mode violation で落ちる）。
