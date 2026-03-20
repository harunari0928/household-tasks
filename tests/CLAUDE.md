# E2E Tests

Playwright tests with 18 total tests (6 UI + 12 scheduler).

## Setup

- `playwright.config.ts` starts two webServers: Express on `:3101`, Vite on `:5174`.
- `fixtures/setup.ts` overrides `baseURL` to call `POST /api/test/reset` before every test.
- Test DB: `data/test_task_definitions.db` (separate from production).

## task-crud.spec.ts (6 tests)

UI tests for task CRUD operations via the web interface.
- Uses `click({ force: true })` for sr-only checkbox inputs (hidden behind labels).

## scheduler.spec.ts (12 tests)

Scheduler logic tests using a Vikunja stub HTTP server.
- Stub listens on `127.0.0.1` with dynamic port.
- Scheduler runs as async child process via `promisify(exec)` — do NOT use `execSync` (causes event loop deadlock with the stub server).
- Uses `node packages/scheduler/dist/index.js` (requires `pnpm --filter scheduler build` first).
- `stubResponseOverride` allows per-test control of Vikunja responses (e.g., 500 errors, existing tasks).
- Date arithmetic must use `Date.UTC()` to avoid timezone issues.
- `TEST_TODAY` env var controls what date the scheduler sees.

## Test conventions

- 1つのテスト内で複数の観点（表示確認・データ確認・状態変化など）を検証する場合は `test.step` で分割すること。
- E2EテストではAPIやDBを直接確認しない。UIに表示される値（input値、ボタン状態、テキスト等）をユーザ視点で検証すること。保存の確認はリロード後のUI状態で行う。
