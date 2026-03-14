# Web Package

React 19 + Vite SPA frontend with Express.js API backend, sharing a single package.

## Structure

- `src/client/` — React SPA (Vite builds to `dist/client/`)
  - `App.tsx` — Main app: category tabs, task list, modal form
  - `types.ts` — All type definitions, constants (CATEGORIES, FREQUENCY_TYPES, FIELD_VISIBILITY)
  - `components/` — CategoryTabs, TaskList, TaskForm, FrequencySelector
- `src/server/` — Express API (tsc builds to `dist/server/`)
  - `index.ts` — Server entry, config routes, test reset endpoint, static file serving
  - `db.ts` — SQLite connection (WAL mode), migrations (task_definitions, execution_log, scheduler_config)
  - `routes/tasks.ts` — CRUD API, toggle, import with upsert logic

## API Endpoints

- `GET/POST /api/tasks` — List / create task definitions
- `PUT/DELETE /api/tasks/:id` — Update / delete
- `POST /api/tasks/:id/toggle` — Toggle is_active
- `POST /api/tasks/import` — Bulk import (skips manually edited records where `updated_at !== created_at`)
- `GET/PUT /api/config` — Scheduler config (key-value store)
- `GET /api/logs` — Execution log with pagination
- `POST /api/test/reset` — Test-only DB cleanup

## Build

```bash
pnpm --filter shared build   # Dependency
pnpm --filter web build      # Runs: vite build && tsc -p tsconfig.server.json
```

## Key details

- `vite.config.ts` proxies `/api` to Express using `API_PORT` env var (default 3100).
- Production mode serves static files only if `dist/client/index.html` exists (prevents crash in dev).
- Frequency validation: `days_of_week` required for weekly/n_weeks; `day_of_month` required for monthly/n_months; `frequency_interval` required for n_days/n_weeks/n_months.
- `calculateNextDueDate()` returns null for fixed-schedule types (daily/weekly/monthly), computes from today for interval types.
