# Household Task Automation System

pnpm monorepo that manages ~77 household cleaning/childcare/lifestyle tasks with a Web UI and automatic task creation in Vikunja.

## Architecture

- `shared/` — Shared utilities (date helpers). Published as `@household-tasks/shared`.
- `packages/web/` — React 19 + Vite frontend, Express.js backend, SQLite (better-sqlite3).
- `packages/scheduler/` — Node.js cron job that creates tasks in Vikunja API daily at 06:00 JST.
- `tests/` — Playwright E2E tests covering both web UI and scheduler logic.
- `scripts/` — Setup and seed scripts for Vikunja and task data.

## Development

```bash
pnpm install
pnpm --filter shared build          # Must build shared first
pnpm --filter web build             # Vite (client) + tsc (server)
pnpm --filter scheduler build       # tsc

# Dev mode (web)
cd packages/web && npx vite         # Frontend dev server on :5173
DB_PATH=data/task_definitions.db npx tsx src/server/index.ts  # API on :3100
```

## Testing

```bash
npx playwright test                          # All 18 tests
npx playwright test tests/task-crud.spec.ts  # 6 UI tests
npx playwright test tests/scheduler.spec.ts  # 12 scheduler tests
```

- Playwright config runs two webServers: Express API on `:3101` and Vite on `:5174`.
- Tests use `DB_PATH=data/test_task_definitions.db` for isolation.
- Each test calls `POST /api/test/reset` to clean the DB before running.
- Scheduler tests spawn a stub HTTP server for Vikunja and run the scheduler as a child process.

## Deployment

```bash
docker compose up -d
./scripts/setup-vikunja.sh   # Create user, API token, project
./scripts/seed.sh            # Import 77 task definitions
```

## Key conventions

- All dates use JST (Asia/Tokyo). `getTodayJST()` in shared/ returns `YYYY-MM-DD`.
- `TEST_TODAY` env var overrides today's date for testing.
- Vikunja task creation uses `PUT /api/v1/projects/:id/tasks` (not POST).
- SQLite timestamps use `new Date().toISOString()` (millisecond precision), not SQLite's `datetime('now')`.
- Express `app` and `router` require explicit type annotations to avoid TS2742 errors with pnpm's strict module resolution.
