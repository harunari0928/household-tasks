# E2E Tests

Playwright tests with 73 total tests (30 task-crud + 20 stats-page + 11 points-chart + 12 scheduler).

## Setup

- `playwright.config.ts` starts two webServers: Express on `:3101`, Vite on `:5174`.
- `fixtures/setup.ts` overrides `baseURL` to call `POST /api/test/reset` before every test.
- Test DB: `data/test_task_definitions.db` (separate from production).

## task-crud.spec.ts (30 tests)

UI tests for task CRUD, validation, search, markdown notes, file attachments, delete, dialog, dark mode.
- `test.describe` で機能グループごとに分類。

## stats-page.spec.ts (20 tests)

Stats page period settings, save button visibility, 〜今日 mode, persistence.
- `test.describe` で保存ボタン表示制御・期間設定の保存・〜今日モード・〜今日モードの保存に分類。

## points-chart.spec.ts (11 tests)

Points field CRUD, stats page navigation, Vikunja stub integration for chart/search/skeleton.
- `test.describe` でポイントフィールド・ポイント集計ページ・Vikunjaスタブに分類。

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
- テスト項目はエンドユーザ視点で記述する。実装詳細（tagName, CSS class等）を直接検証せず「テキストが表示されている」「入力欄が存在しない」等のユーザが認識できる振る舞いで検証する。
- `test.step` は検証項目（assertion）のみに使用する。操作手順（クリック・入力等のセットアップ）は `test.step` の外に記述する。
- 1つのテストに複数の異なる機能・状態を詰め込まない。状態ごとにテストを分割する。
- テスト記述やテスト名で「他の」等の曖昧な表現を避け、具体的な操作対象（ボタン名等）を明記する。
- 同じ検証を複数パターンで行う場合は `for...of` 等で全パターンを網羅する。
- テストファイル内では `test.describe` で機能グループごとにテストをまとめること。観点の異なるテストをフラットに並べない。
- AAAパターン（Arrange-Act-Assert）を守ること。`test.step` はAssert（検証）にのみ使用する。Arrange（前提条件のセットアップ）やAct（テスト対象の操作）は `test.step` の外に記述する。
