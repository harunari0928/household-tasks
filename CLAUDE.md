# Household Task Automation System

pnpm monorepo that manages ~77 household cleaning/childcare/lifestyle tasks with a Kanban board Web UI and automatic task scheduling.

## Architecture

- `shared/` — Shared utilities (date helpers). Published as `@household-tasks/shared`.
- `packages/web/` — React 19 + Vite frontend (Kanban board + task management), Express.js backend, SQLite (better-sqlite3).
- `packages/scheduler/` — Node.js cron job that creates task instances in SQLite daily at 06:00 JST.
- `tests/` — Playwright E2E tests covering kanban board, task CRUD, scheduler logic, and stats.
- **CLI はこのリポジトリに無い**（`packages/cli` は 2026-09-14 に削除）。`ht` コマンドの実体は
  `~/repos/homeassistant/config/scripts/ht_shim/ht`（Python 標準ライブラリのみ、Web API へ委譲）で、
  Home Assistant の音声アシスタントも `.claude/skills/*` もこれを使う。DB を直接触る消費者を増やさない。
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
- **HA の音声から不定期の家事を即時完了できる。** いつ発生するか分からない家事（ゴキブリ退治など）は
  頻度 `on_demand`（UI では「即時（都度）」）のタスク定義として登録しておき、「やっておいた」と言うと
  `POST /api/kanban/complete-from-definition/:id`（body に `assignee` 必須）で**起票と完了を一度に**記録する。
  HA 側は会話エージェントの `household_quick_done` ツール（発話名 → 定義の突き合わせは
  `custom_components/claude_code_conversation/household_tasks.py`）と `rest_command.household_task_quick_done`。
  - **`on_demand` 以外のタスク定義と、無効（`is_active = 0`）のタスク定義は 400 で拒否する。** 定期タスクに使えると、起票時刻より前に
    記録した日にスケジューラが当日ぶんを普通に起票して、誰もやらないカードが板と夜の未完了チェックに残る。
    定期タスクの完了は板のカードに対して行う（`PATCH /api/kanban/:id/status`）。
    無効化はタスクを止めるスイッチなので、止めたはずのものが音声から記録できると辻褄が合わない。
    **HA 側の突き合わせも同じ条件（`on_demand` かつ有効）で絞ること**（両方を絞らないと、
    音声からは候補に挙がるのに API に弾かれる、という分かりにくい失敗になる）。
  - `on_demand` はスケジューラが起票しない頻度。`shouldCreateToday()` が常に false を返し、
    `next_due_date` も持たない。起票時刻の設定も UI から消える（意味を持たないため）。
  - **起票のタイミングに関わる設定は UI で非活性にする。** 「風邪の日の扱い」「不在時の扱い」
    「実行期間」はどれも起票日を決めるための設定なので、`on_demand` では効かない。
    タスク編集フォームでは非活性にして理由を出し、一覧でも扱いのバッジを出さない。
    - **保存値は「常に見える」側（`always` / `normal`）に倒す。** カンバンの一覧は
      風邪の日モード中と不在日に `sick_day_behavior` / `absence_behavior` で絞り込むので、
      非活性の裏に `normal_only` や `hidden` が残っていると、**音声から記録したのに
      板に出てこない**（しかも UI からは直せない）という分かりにくい壊れ方になる。
      在宅前提カテゴリ（水回り等）の新規タスクは既定が `hidden` なので実際に踏みやすい。
    - 既存の `on_demand` タスクに残っている値は、フォームを開いて保存した時点で倒れる
      （マイグレーションはしていない）。
  - **冪等ではない。** 呼ぶたびに完了記録が増える（不定期の家事は1日に何度も起こりうるため）。
    ただし未完了カードが板に残っている場合だけは、新規に作らずそのカードを完了にする（ポイントの二重計上を防ぐ）。
  - **記録の取り消しは `DELETE /api/kanban/:id`**（専用エンドポイントは無い）。
    `PATCH /api/kanban/:id/status` で todo に戻すと、スケジューラが触らない即時タスクの
    カードが板に永久に残るので、**戻すのではなく消す**。
  - 一覧は `GET /api/tasks?frequency_type=on_demand&is_active=1`。HA がシステムプロンプトに
    毎ターン載せるので、**軽く保つこと**（フィルタ無しは81件・約51KB）。
    綴り間違いは 400 で落とす（空配列を返すと「1件も登録されていない」と案内されてしまう）。
    **`is_active` は明示的に付ける。** 頻度フィルタに有効/無効の意味は混ぜていない
    （一覧は止めたタスクを探して再開する場所でもあるため）。付け忘れると、
    止めてある家事が音声の「記録できる家事」一覧に出て、API には 400 で弾かれる。
  - **`execution_log` は書かない。** 書くとスケジューラの `isAlreadyCreatedToday()` が反応するが、
    その分岐は `next_due_date` を進めないので、N日ごとのタスクが翌日に前倒しで起票される。
- **HA が家事レポートを議事録に埋め込む。** `~/repos/homeassistant/config/scripts/household_report.py` が
  `data/task_definitions.db` を読み取り専用で参照している。集計の意味論は `GET /api/stats/points` と
  同じ（共同タスク `ryo,yuka` は分割して両者に満額加算）。**`ht stats` は共同タスクを別枠で集計するため
  数字が一致しない**ので、変更するときは3か所の整合に注意。

## ごみ収集カレンダー連動

- **ごみ捨てタスクは収集日の当日朝6時に起票される**（2026-08-12 に「前夜起票・翌日の収集で判定」
  から変更。タスク定義の `scheduled_hour=6` × 当日の収集で判定）。カレンダー（小田原・**芦子地区**）は
  `shared/garbage.ts` にあり、曜日と第何週かだけで計算する（外部データ・APIに依存しない）。
  - 収集が無い日（**土日**・年末年始 12/31〜1/3）は起票しない。
  - **タスク定義（ID 54）の `days_of_week` は mon〜fri のままでよい**（収集は月〜金しか無いため）。
    旧・前夜方式では月曜収集分に日曜起票が必要だったが `sun` が無く、**月曜の燃せるごみが
    黙って起票されていなかった**。当日方式はこの欠落も解消している。
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

## 個人タスク

家事ではない、ひとりだけの用事（自分の通院・ストレッチなど）をカンバンに載せるための仕組み。
**タスク定義に `personal_owner`（登録ユーザー名）を持たせる**（NULL なら共有）。タスク管理画面の
フォームで「種類 → 個人（名前）」を選ぶだけで、頻度や起票時刻は共有タスクと同じものが全部使える。

- 起票されるカードは `is_personal = 1` / `personal_owner` / `assignee = 所有者` / `points = 0` で入る。
  スケジューラ（`createTaskInstance`）と web の `create-from-definition` / `complete-from-definition`
  の3か所が同じ形で入れる。**列を足すときは3か所とも直す**（`task_instances` の CHECK 制約が
  `is_personal = 1 → personal_owner NOT NULL かつ points = 0` を要求するので、片方だけ直すと起票が失敗する）。
- **カンバンは選択中ユーザー（`GET /api/kanban?user=`）の個人タスクだけを返す。** `user` 無しなら
  共有タスクのみ（CLI・HA・外部連携が個人の用事を見ないため）。認証ではなく「選択中ユーザー」で
  分けているだけなので、同じ端末でユーザー切替すれば見える。
- **ポイントは常に 0 で、統計（`/api/stats/points`）に入らない。** 家事の分担ではないため。
  フォームではポイント欄を出さず、API 側でも所有者付きなら 0 に倒す（HA の `household_report.py`
  は `is_personal = 0` で絞ること）。
- 風邪の日モード・不在日の絞り込みは個人タスクには効かない（板の SQL が `is_personal = 1 OR ...`）。
  起票側のスキップはかかるので、不在日には起票されない。
- **所有者は登録ユーザーに限る**（未登録なら 400）。所有者になっているユーザーは設定画面から
  削除できない（409）。名前で照合しているので、消せると誰にも見えないカードが起票され続ける。
- 以前（PR #57）はカンバン上の入力欄から「定義を持たない単発カード」として作っていたが、
  定期で起票したい要望でこの形に変えた。`POST /api/kanban/personal-tasks` は撤去済み。
  `task_instances.task_definition_id` が NULL 許可のままなのはその名残（新規に NULL で入れる経路は無い）。

## 祝日の除外

曜日指定（毎週・N週ごと）のタスクに限り、「祝日は起票しない」「祝日の前日は起票しない」を設定できる（`task_definitions.exclude_holiday` / `exclude_day_before_holiday`）。他の頻度では設定できず、APIも 400 で拒否する。

- 祝日データは内閣府の公開CSV由来で `shared/holidays.ts` に静的に持ち、マイグレーションで `holidays` テーブルへ投入する。スケジューラはオフラインのまま動く。
- **祝日は毎年2月頃に翌年分が公開される**ため、年1回 `./scripts/update-holidays.sh` を実行して `shared/holidays.ts` を再生成し、再ビルド・再デプロイする。データが尽きると除外が効かなくなる（起票され続ける）。
- 除外で起票をスキップした日も `next_due_date` は進める。N週ごとのタスクが翌日に前倒しで起票されるのを防ぐため。

## 優先タスク

「今日必ずやる」タスク（保育園に行く前の日焼け止め・保湿・虫よけ・保育園準備、寝かしつけの必須作業など）を
`task_definitions.is_priority` で印付けする。カンバンでは**未着手列の先頭にまとまり、カードに「優先」バッジと左端の紫ストライプ**が付く。

- **定義の性質なので `task_instances` にはコピーせず、カンバン取得時に `task_definitions` を join して読む**（`category` と同じ）。
  フラグを切り替えると起票済みのカードにも即反映される。`GET /api/kanban` の `ORDER BY` も優先を先にしている。
- **即時（都度・`on_demand`）には設定できない**（カンバンに起票されないので先頭に並べる意味がない）。
  フォームは非活性にして理由を出し、保存値も false に倒す。API は `on_demand` で `is_priority=true` なら 400。
- 未着手列の並びは `(is_priority desc, sort_order asc)`（`KanbanBoard.tsx` の `compareTodoOrder`）。
  ドラッグ並び替えは各グループ内でだけ効き、**境界をまたぐドロップは自分のグループの端に寄せる**
  （通常カードを優先の上へ → 通常グループの先頭、優先カードを通常の下へ → 優先グループの末尾）。
  完了列のように無効化すると「一番上まで動かす」操作が空振りになるため。完了列の並び（完了日時順）には影響しない。
- マイグレーション v19 は **web と scheduler に同一定義**で持つ（先に起動した側が適用する）。名前による初期付与はしていない。
- `ht`（HA 側の REST シム `~/repos/homeassistant/config/scripts/ht_shim/ht`）は `ht task add --priority` / `ht task edit --priority | --no-priority`。
  `ht task edit` は **GET した行を丸ごと土台にして PUT する**（PUT が全置換のため。以前は書き忘れた列——実行期間・祝日除外など——が編集のたびに消えていた）。

## カレンダー連動（来客・シッターの受け入れ準備）

- **頻度 `calendar`（UI では「カレンダー連動」）は、家族カレンダーの予定名にキーワードが含まれる日に起票する**
  （2026-09-14 導入）。定義が `calendar_keywords`（CSV、例 `来客,シッター`）と
  `calendar_offset_days`（0=当日 / 1=前日 / …最大7）を持つ。「前日に準備できるもの」は offset=1 の別定義にする
  （1つの定義は1つの起票日しか持たない）。
- **予定は `calendar_days` テーブル**（`date, summary`）。Home Assistant の `absence_sync.py`（05:50/12:50/21:50 JST）が
  家族カレンダーの**全予定**を日付に展開して `POST /api/calendar-days` で**全置換**する（不在日と同じ冪等方式。
  予定が消えれば行も消える）。**キーワードで絞るのはアプリ側**（定義ごと）なので、HA にはキーワードが無い。
  キーワードを足した瞬間から次のスケジューラ実行で効く。
  - 期間の日付展開（終日予定の end 排他など）は不在日と同じく HA 側だけが持つ。こちらに書かない。
  - 判定は NFKC 正規化 + 小文字化の部分一致（`matcher.ts` の `matchesCalendarSummary`。HA の
    `match_keyword` と同じ規則）。「ｼｯﾀｰ」と「シッター」は同一視する。
  - `shouldCreateToday()` は `calendar` で常に false。DB 参照が要るので `scheduler/src/index.ts` の
    main ループが `getCalendarSummaries(today + offset)` を見て呼び分ける（再試行ループも同じ判定を通す）。
  - **表が読めないときは「予定なし」に倒す**（起票しない）。不在日・祝日の「読めなければ通常どおり起票」とは
    向きが逆。カレンダー連動は予定がある日だけの頻度なので、判定不能なら出さない方が安全。
- **連日の来客で前日のカードが未完了だと、2日目ぶんは起票されない**（`hasRecentInstance` の既存挙動。
  定期タスクと同じ）。予定名が「シッター(お泊り)」なら `来客,シッター` と `お泊り,泊` の両方の定義が起票される。
  **泊を含まない複数日の予定はお泊り扱いにならない**（キーワード判定のみ。日数は見ていない）。
- `next_due_date` は持たない（`on_demand` と同じ）。風邪の日・不在時の扱い・実行期間・起票時刻は**効く**
  （起票日が決まる頻度なので `on_demand` のように非活性にはしない）。`complete-from-definition` は
  `on_demand` 以外なので 400（板のカードを完了にする）。
- 設定画面の「カレンダー同期」は最終同期時刻と今日以降の予定件数を出す**だけ**（`GET /api/calendar-days`）。
  同期が止まると来客準備が黙って起票されなくなるので、止まっていることに気付く口として置いてある。
- HA 側の `ht`（REST シム）は `ht task add/edit --calendar-keywords 来客,シッター --calendar-offset-days 1`。
  対応表と運用は `~/repos/homeassistant/CLAUDE.md` の「来客・シッター」節を参照。

## Key conventions

- All dates use JST (Asia/Tokyo). `getTodayJST()` in shared/ returns `YYYY-MM-DD`.
- `TEST_TODAY` env var overrides today's date for testing.
- Scheduler creates `task_instances` directly in SQLite (no external API dependency).
- SQLite timestamps use `new Date().toISOString()` (millisecond precision), not SQLite's `datetime('now')`.
- Express `app` and `router` require explicit type annotations to avoid TS2742 errors with pnpm's strict module resolution.
- `package.json` `pnpm.onlyBuiltDependencies` must include `better-sqlite3`, `esbuild`, `sqlite3` — otherwise Docker builds fail with missing native modules.
- Kanban board uses WebSocket (`/api/kanban/ws`) for real-time updates between users
  （2026-08-24 に SSE から移行）。サーバ側は `packages/web/src/server/realtime.ts` の
  `broadcast()`、クライアント側は `packages/web/src/client/lib/realtime.ts`。
  更新は従来どおり REST で行い、WebSocket は再描画のきっかけを配る一方向の通知だけに使う。
  - **クライアントの接続はタブ内で1本に共有する。** 画面ごとに接続を張らず
    `useRealtimeEvent()` / `useRealtimeStatus()` で購読する（`lib/realtime.ts` のモジュール状態）。
    SSE時代は KanbanBoard・useSickMode・useAbsence が各自 EventSource を張り、
    **ブラウザの同時接続上限（HTTP/1.1 で 1オリジン約6本）に達して2タブ目が繋がらない**
    バグを踏んだ（風邪の日モードの別タブ即時反映が壊れた）。接続を共有していれば
    購読を増やしても接続は増えないので、画面ごとの opt-in は不要。
  - **再接続時は `{ type: 'reconnected' }` を配る。** 切断中の変更は届いていないので、
    購読側はこれを見て取り直す（KanbanBoard はタスク一覧、useSickMode / useAbsence は自分の状態）。
  - サーバは 30 秒ごとの ping/pong で死んだ接続を切る（スマホのスリープや NAT で
    close が飛んでこない接続が溜まるため）。
  - Vite dev の proxy は `/api` に `ws: true` が必要（無いと開発時だけ繋がらない）。
- `@dnd-kit` for drag-and-drop on the Kanban board.
  - **ドラッグ終了から 50ms は @dnd-kit が document の capture で click を止める。**
    実ユーザは影響しないが、テストはその間にボタンを押せてしまい**クリックが黙って消える**
    （エラー通知の「再試行」「✕」が反応せずflakyになった）。ドラッグ後にクリックする
    テストは `waitForClicksAfterDrag()`（`tests/kanban.spec.ts`）で抑制が解けるのを待つ。
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
