---
name: task-get
description: タスク定義の詳細を取得する。IDを指定して全フィールドを確認できる。
user-invokable: true
argument-hint: <id> [--json] e.g. "42", "42 --json"
allowed-tools: Bash
---

# タスク定義の詳細取得

指定IDのタスク定義の全フィールドを表示する。

```bash
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task get <id>
```

## オプション

- `--json` — JSON形式で出力

## フィールド説明

| フィールド | 説明 |
|-----------|------|
| id | タスク定義ID |
| name | タスク名（1〜200文字） |
| category | カテゴリ（water, kitchen, floor, entrance, laundry, trash, childcare, cooking, lifestyle） |
| frequency_type | 頻度タイプ（daily, weekly, n_days, n_weeks, monthly, n_months, yearly） |
| frequency_interval | 間隔（n_days/n_weeks/n_monthsの場合のみ、2以上） |
| days_of_week | 曜日（weekly/n_weeksの場合、カンマ区切り: mon,tue,wed,thu,fri,sat,sun） |
| day_of_month | 日指定（monthly/n_monthsの場合、1〜28） |
| points | ポイント（1〜10） |
| scheduled_hour | 起票時刻（0〜23、スケジューラがタスクインスタンスを作成する時刻） |
| is_active | 有効フラグ（1=有効, 0=無効。無効だとスケジューラが起票しない） |
| notes | メモ |

$ARGUMENTS から ID を取得して実行する。引数なしならユーザーに ID を聞く。
