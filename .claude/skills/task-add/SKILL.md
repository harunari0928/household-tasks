---
name: task-add
description: 新しいタスク定義を追加する。頻度タイプに応じた必須オプションの組み合わせルールあり。
user-invokable: true
argument-hint: --name NAME --category CAT --frequency-type TYPE [options] e.g. "--name 掃除機がけ --category floor --frequency-type weekly --days-of-week mon,fri --points 3"
allowed-tools: Bash
---

# タスク定義の追加

Web API 経由で新しいタスク定義を作成する。結果はJSON形式で出力される。

```bash
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task add \
  --name <name> --category <category> --frequency-type <type> [options]
```

## 必須オプション

| オプション | 説明 | 有効値 |
|-----------|------|--------|
| `--name` | タスク名 | 1〜200文字 |
| `--category` | カテゴリ | water, kitchen, floor, entrance, laundry, trash, childcare, cooking, lifestyle |
| `--frequency-type` | 頻度タイプ | daily, weekly, n_days, n_weeks, monthly, n_months, yearly |

## 任意オプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--frequency-interval <n>` | 間隔（n_days/n_weeks/n_months時は必須、2以上） | - |
| `--days-of-week <days>` | 曜日（カンマ区切り。weekly/n_weeks時は必須） | - |
| `--day-of-month <day>` | 日指定（1〜28。monthly/n_months時に任意） | - |
| `--notes <text>` | メモ | - |
| `--points <n>` | ポイント（1〜10） | 1 |
| `--scheduled-hour <hour>` | 起票時刻（0〜23） | 0 |

## 頻度タイプ別の必須オプション（重要）

| frequency-type | 追加で必須 | 任意 |
|---------------|-----------|------|
| daily | なし | - |
| weekly | `--days-of-week` | - |
| n_days | `--frequency-interval`（2以上） | - |
| n_weeks | `--frequency-interval`（2以上）＋ `--days-of-week` | - |
| monthly | なし | `--day-of-month` |
| n_months | `--frequency-interval`（2以上） | `--day-of-month` |
| yearly | なし | - |

## 手順

1. $ARGUMENTS またはユーザーの指示から必要な情報を取得する
2. 不足している必須情報があればユーザーに確認する
3. frequency-type に応じた追加必須オプションを忘れずに指定する
4. 重複防止のため、まず `task list` で既存タスクを確認することを推奨する

## 使用例

```bash
# 毎日のタスク
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task add \
  --name "食器洗い" --category kitchen --frequency-type daily --points 2

# 週次（月・金）のタスク
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task add \
  --name "掃除機がけ" --category floor --frequency-type weekly \
  --days-of-week mon,fri --points 3

# 3日ごとのタスク
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task add \
  --name "排水口掃除" --category water --frequency-type n_days \
  --frequency-interval 3 --points 5

# 毎月15日のタスク
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task add \
  --name "エアコンフィルター" --category lifestyle --frequency-type monthly \
  --day-of-month 15 --points 4
```
