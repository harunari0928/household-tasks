---
name: task-toggle
description: タスク定義の有効/無効を切り替える。無効にするとスケジューラがタスクインスタンスを起票しなくなる。
user-invokable: true
argument-hint: <id> e.g. "42"
allowed-tools: Bash
---

# タスク定義の有効/無効切替

is_active フラグをトグルする。無効（inactive）にしたタスクはスケジューラがタスクインスタンスを作成しなくなる。

```bash
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task toggle <id>
```

## 手順

1. $ARGUMENTS から ID を取得する。引数なしならユーザーに聞く
2. 必要なら `task get <id>` で現在の状態を確認する
3. toggle コマンドを実行する
4. 結果（active/inactive）を報告する
