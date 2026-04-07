---
name: task-delete
description: タスク定義を削除する。関連する添付ファイル・実行ログも一緒に削除される。元に戻せない操作。
user-invokable: true
argument-hint: <id> e.g. "42"
allowed-tools: Bash
---

# タスク定義の削除

タスク定義とその関連データ（添付ファイル、実行ログ）を物理削除する。この操作は元に戻せない。

```bash
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js task delete <id>
```

## 手順

1. $ARGUMENTS から ID を取得する。引数なしならユーザーに聞く
2. `task get <id>` で削除対象を確認し、ユーザーに確認を取る
3. **ユーザーの明示的な承認を得てから**削除を実行する
4. 削除完了を報告する

注意: 削除ではなく一時的に停止したいだけの場合は `task-toggle` を案内する。
