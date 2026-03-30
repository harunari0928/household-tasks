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

## Key conventions

- All dates use JST (Asia/Tokyo). `getTodayJST()` in shared/ returns `YYYY-MM-DD`.
- `TEST_TODAY` env var overrides today's date for testing.
- Scheduler creates `task_instances` directly in SQLite (no external API dependency).
- SQLite timestamps use `new Date().toISOString()` (millisecond precision), not SQLite's `datetime('now')`.
- Express `app` and `router` require explicit type annotations to avoid TS2742 errors with pnpm's strict module resolution.
- `package.json` `pnpm.onlyBuiltDependencies` must include `better-sqlite3`, `esbuild`, `sqlite3` — otherwise Docker builds fail with missing native modules.
- Kanban board uses SSE (`/api/kanban/events`) for real-time updates between users.
- `@dnd-kit` for drag-and-drop on the Kanban board.
