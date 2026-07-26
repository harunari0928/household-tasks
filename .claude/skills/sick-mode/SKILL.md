---
name: sick-mode
description: 子ども風邪の日モードのON/OFF切替・状態確認。ONにすると病児タスク（薬・欠席連絡・病児保育準備・病院予約）が即時起票され、不要不急タスクがカンバンから非表示になる。
user-invokable: true
argument-hint: "[on|off] 引数なしで現在の状態を表示"
allowed-tools: Bash
---

# 子ども風邪の日モード切替

モードはサーバー（app_settings）に保存され、全端末にSSEでリアルタイム反映される。

```bash
# 状態確認
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js sick-mode

# ON（sick_only タスクのうち起票時刻が到来しているものを当日分として即時起票。
#     起票時刻前のタスクは毎時のスケジューラが時刻到来後に起票する。二重起票はされない）
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js sick-mode on

# OFF（通常タスクが再表示され、病児タスクは非表示になる。データは消えない）
WEB_URL=http://localhost:3100 node packages/cli/dist/index.js sick-mode off
```

## 手順

1. $ARGUMENTS が `on` / `off` ならそのまま切り替える。引数なしなら状態確認だけ行う
2. 結果（ON/OFF、起票されたタスク数）を報告する

## 補足

- タスクごとの扱いは task_definitions の `sick_day_behavior`（`normal_only`=通常時のみ / `always`=常に表示 / `sick_only`=風邪の日のみ）で決まる。変更は task-edit スキルの `--sick-day-behavior` を使う
- モードON中はスケジューラも normal_only を起票せず、sick_only を毎朝起票する
