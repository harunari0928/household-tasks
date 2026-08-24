---
name: task-list
description: タスク定義の一覧を取得する。カテゴリでフィルタ可能。タスクの追加・編集前の確認にも使う。
user-invokable: true
argument-hint: [--category CATEGORY] [--frequency-type TYPE] [--json] e.g. "--category floor", "--frequency-type on_demand"
allowed-tools: Bash
---

# タスク定義一覧

Web API 経由でタスク定義の一覧を取得する。

```bash
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task list
```

## オプション

- `--category <category>` — カテゴリでフィルタ
- `--frequency-type <type>` — 頻度でフィルタ（例: `on_demand` = 声で即時完了できるタスク）
  - 有効値: `water`, `kitchen`, `floor`, `entrance`, `laundry`, `trash`, `childcare`, `cooking`, `lifestyle`
- `--json` — JSON形式で出力（プログラムから解析する場合に使用）

## 使用例

```bash
# 全タスク定義を表示
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task list

# 床掃除カテゴリのみ
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task list --category floor
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task list --frequency-type on_demand

# JSON出力
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task list --json
```

$ARGUMENTS に基づいて適切なフラグを付与して実行する。結果を読みやすく整形して報告する。
