# E2E Tests

Playwright E2E tests.

## Setup

- `playwright.config.ts` starts two webServers: Express on `:3101`, Vite on `:5174`.
- `fixtures/setup.ts` overrides `baseURL` to call `POST /api/test/reset` before every test.
- Test DB: `data/test_task_definitions.db` (separate from production).

## task-crud.spec.ts

UI tests for task CRUD, validation, search, markdown notes, file attachments, delete, dialog, dark mode.
- `test.describe` で機能グループごとに分類。

## stats-page.spec.ts

Stats page period settings, save button visibility, 〜今日 mode, persistence.
- `test.describe` で保存ボタン表示制御・期間設定の保存・〜今日モード・〜今日モードの保存に分類。

## points-chart.spec.ts

Points field CRUD, stats page navigation, stats display with task_instances data.
- `test.describe` でポイントフィールド・ポイント集計ページ・ポイント集計の表示に分類。
- Stats tests create task definitions via UI, run scheduler to create task_instances, then assign/complete via kanban API.
- Stats reads from `task_instances` SQLite table.

## scheduler.spec.ts

Scheduler logic tests verified via Kanban board UI.
- Scheduler inserts `task_instances` directly into SQLite.
- Scheduler runs as async child process via `promisify(exec)` — do NOT use `execSync`.
- Uses `node packages/scheduler/dist/index.js` (requires `pnpm --filter scheduler build` first).
- Only `DB_PATH` and `TEST_TODAY` env vars needed.
- After running the scheduler, navigate to `/#/` (Kanban board) to verify task cards appear.
- Date arithmetic must use `Date.UTC()` to avoid timezone issues.
- `TEST_TODAY` env var controls what date the scheduler sees.

## Test conventions

**原則: 「このテストはユーザの何を守っているのか？」を常に問うこと。** テストはエンドユーザの仕様を表現するドキュメントであり、実装の正しさを確認するためのものではない。この問いなしにテストを書くと、自然とAPI/DBの値を直接確認する実装の鏡になってしまう。

- 1つのテスト内で複数の観点（表示確認・データ確認・状態変化など）を検証する場合は `test.step` で分割すること。
- E2EテストではAPIやDBを直接確認しない。UIに表示される値（input値、ボタン状態、テキスト等）をユーザ視点で検証すること。保存の確認はリロード後のUI状態で行う。
- テスト項目はエンドユーザ視点で記述する。実装詳細（tagName, CSS class等）を直接検証せず「テキストが表示されている」「入力欄が存在しない」等のユーザが認識できる振る舞いで検証する。
- テストケース名・step名にはDBカラム名やコード内部の識別子（`is_active`, `next_due_date`, `n_days`等）を使わず、UI上の表示やドメイン用語（非活性、次回予定日、N日ごと等）を使うこと。
- `test.step` は検証項目（assertion）のみに使用する。操作手順（クリック・入力等のセットアップ）は `test.step` の外に記述する。
- 1つのテストに複数の異なる機能・状態を詰め込まない。状態ごとにテストを分割する。
- テスト記述やテスト名で「他の」等の曖昧な表現を避け、具体的な操作対象（ボタン名等）を明記する。
- 同じ検証を複数パターンで行う場合は `for...of` 等で全パターンを網羅する。
- テストファイル内では `test.describe` で機能グループごとにテストをまとめること。観点の異なるテストをフラットに並べない。
- AAAパターン（Arrange-Act-Assert）を守ること。`test.step` はAssert（検証）にのみ使用する。Arrange（前提条件のセットアップ）やAct（テスト対象の操作）は `test.step` の外に記述する。
- テスト名・step名は仕様（ユーザにとっての振る舞い）を表現する。実装の動作（「スキップする」「成功する」「次回予定日が設定される」等）ではなく、ユーザ視点の結果（「起票しない」「起票される」「元のリズムで起票される」等）で書く。
- `test.step` は検証が1つだけのテストでは不要。複数の観点がある場合にのみ使う。
- セクション区切りに `// ---` コメントを使わず、`test.describe` でグループ化する。
- テストはそのテストが検証する機能の責務を持つファイルに配置する。例：スケジューラの起票ロジックに関するテストは scheduler.spec.ts に、UIのCRUDに関するテストは task-crud.spec.ts に置く。
- アプリのエンドユーザ仕様でないもの（seed importの冪等性、デプロイ運用等）はE2Eテストに含めない。
- 頻度タイプ名はコード内部の識別子（`daily`, `n_days`等）ではなくドメイン用語（`毎日`, `N日ごと`等）をテスト名に使う。
