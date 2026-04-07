---
name: task-edit
description: タスク定義を編集する。指定したオプションのみ部分更新される。頻度タイプ変更時は必須オプションに注意。
user-invokable: true
argument-hint: <id> [options] e.g. "42 --points 5", "42 --frequency-type weekly --days-of-week mon,wed,fri"
allowed-tools: Bash
---

# タスク定義の編集（部分更新）

指定したオプションのみ更新し、未指定のフィールドは現在の値を維持する。
内部的に現在値を GET してからマージして PUT するため、変更したいフィールドだけ指定すればよい。

```bash
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task edit <id> [options]
```

## オプション（すべて任意、指定したもののみ更新）

| オプション | 説明 |
|-----------|------|
| `--name <name>` | タスク名（1〜200文字） |
| `--category <category>` | カテゴリ（water, kitchen, floor, entrance, laundry, trash, childcare, cooking, lifestyle） |
| `--frequency-type <type>` | 頻度タイプ（daily, weekly, n_days, n_weeks, monthly, n_months, yearly） |
| `--frequency-interval <n>` | 間隔（2以上） |
| `--days-of-week <days>` | 曜日（カンマ区切り: mon,tue,wed,thu,fri,sat,sun） |
| `--day-of-month <day>` | 日指定（1〜28） |
| `--notes <text>` | メモ |
| `--points <n>` | ポイント（1〜10） |
| `--scheduled-hour <hour>` | 起票時刻（0〜23） |

## 頻度タイプ変更時の注意（重要）

frequency-type を変更する場合、新しいタイプに必要なオプションも同時に指定すること：

| 変更先 | 同時に必須 |
|--------|-----------|
| weekly / n_weeks | `--days-of-week` |
| n_days / n_weeks / n_months | `--frequency-interval`（2以上） |

## 手順

1. $ARGUMENTS から ID と変更内容を取得する
2. 引数不足ならユーザーに確認する
3. 現在の値を確認したい場合は `task get <id>` を先に実行する
4. frequency-type を変更する場合は、必要な関連オプションも忘れず指定する

## 使用例

```bash
# ポイントだけ変更
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task edit 42 --points 5

# メモを追加
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task edit 42 --notes "ルンバ起動後に確認"

# 頻度を毎日から週次に変更（days-of-weekも必須）
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task edit 42 \
  --frequency-type weekly --days-of-week mon,wed,fri
```
