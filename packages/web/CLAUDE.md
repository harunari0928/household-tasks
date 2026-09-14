# Web Package

React 19 + Vite SPA frontend with Express.js API backend, sharing a single package.

## Structure

- `src/client/` — React SPA (Vite builds to `dist/client/`)
  - `App.tsx` — Main app: kanban board (default), task management, stats pages. User switcher in header.
  - `types.ts` — All type definitions, constants (CATEGORIES, FREQUENCY_TYPES, KANBAN_COLUMNS, TaskInstance)
  - `components/` — KanbanBoard, KanbanColumn, KanbanCard, KanbanFilters, CategoryTabs, TaskList, TaskForm, FrequencySelector, StatsPage
- `src/server/` — Express API (tsc builds to `dist/server/`)
  - `index.ts` — Server entry, config routes, test reset endpoint, static file serving
  - `db.ts` — SQLite connection (WAL mode), migrations (task_definitions, execution_log, task_instances, attachments, app_settings)
  - `routes/kanban.ts` — Kanban API: list/status/assignee CRUD
  - `realtime.ts` — WebSocket server (`/api/kanban/ws`) と `broadcast()`。ルータから呼ばれる
  - `routes/tasks.ts` — Task definition CRUD, toggle, import with upsert logic
  - `routes/stats.ts` — Points aggregation from task_instances

## API Endpoints

- `GET/POST /api/tasks` — List / create task definitions
- `PUT/DELETE /api/tasks/:id` — Update / delete
- `POST /api/tasks/:id/toggle` — Toggle is_active
- `POST /api/tasks/import` — Bulk import (skips manually edited records where `updated_at !== created_at`)
- `GET /api/kanban` — List shared task instances (filter: status, assignee, category). Pass `user=<name>` to include that user's personal tasks; omit it to never return personal tasks.
- `POST /api/kanban/personal-tasks` — Create a one-off personal task (`title`, `user`); it is not scheduled and never earns points
- `PATCH /api/kanban/:id/status` — Change status (with optional assignee)
- `PATCH /api/kanban/:id/assignee` — Change assignee
- `GET/PUT /api/kanban/assignees` — Manage registered assignees
- `GET /api/kanban/ws` — WebSocket endpoint for real-time updates (upgrade only)
- `GET /api/stats/points` — Points aggregation from completed task_instances
- `GET/PUT /api/settings` — App settings (key-value store)
- `GET /api/logs` — Execution log with pagination
- `POST /api/test/reset` — Test-only DB cleanup

## Build

```bash
pnpm --filter shared build   # Dependency
pnpm --filter web build      # Runs: vite build && tsc -p tsconfig.server.json
```

## Key details

- `vite.config.ts` proxies `/api` to Express using `API_PORT` env var (default 3100)。WebSocket も通すため `ws: true` が必要。
- Production mode serves static files only if `dist/client/index.html` exists (prevents crash in dev).
- Frequency validation: `days_of_week` required for weekly/n_weeks; `day_of_month` required for monthly/n_months; `frequency_interval` required for n_days/n_weeks/n_months.
- `calculateNextDueDate()` returns null for fixed-schedule types (daily/weekly/monthly), computes from today for interval types.
- Kanban board uses @dnd-kit for drag-and-drop. Requires assignee selection for done when unassigned.
- `broadcast()` (`src/server/realtime.ts`) pushes task updates to all connected WebSocket clients for real-time sync.
  クライアントは `src/client/lib/realtime.ts` の共有接続（タブ内1本）で受け取る。
