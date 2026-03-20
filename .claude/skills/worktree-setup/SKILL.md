---
name: worktree-setup
description: Worktree作成後にDocker Compose用の.envポート設定・Vikunjaセットアップ・コンテナ起動を行う
user-invocable: false
---

# Worktree Docker環境セットアップ

EnterWorktreeでworktreeを作成した直後に自動実行する。メインのDocker Composeとポートが競合しないよう`.env`を配置し、Vikunjaの初期セットアップまで完了させる。

## Steps

1. `vikunja-data/` のパーミッションを修正（コンテナ内UID=1000で書き込めるようにする）:
   ```bash
   mkdir -p vikunja-data/files vikunja-data/db
   docker run --rm -v "$(pwd)/vikunja-data:/data" alpine chown -R 1000:0 /data
   ```
2. worktreeルートに`.env`を作成（ポートだけworktree用に設定。トークンは後で上書きされる）:
   ```
   WEB_PORT=3200
   VIKUNJA_PORT=3557
   ```
3. `docker compose up -d vikunja` でVikunjaを先に起動
4. `scripts/setup-vikunja.sh` を実行してユーザ作成・APIトークン発行・プロジェクト作成を行う。スクリプトが`.env`に`VIKUNJA_API_TOKEN`と`DEFAULT_PROJECT_ID`を書き込む:
   ```bash
   ./scripts/setup-vikunja.sh http://localhost:3557 .env
   ```
5. `.env`にポート設定を追記（setup-vikunja.shが上書きするため）:
   ```bash
   # .env の先頭にポート設定を追加
   sed -i '1i WEB_PORT=3200\nVIKUNJA_PORT=3557' .env
   ```
6. `docker compose up -d --build web` でwebコンテナをビルド＆起動（.envのトークンを読み込ませる）
7. 起動後、ユーザに開発URL `http://localhost:3200` を案内する

## Notes

- メインリポジトリはデフォルトポート（WEB_PORT=3100, VIKUNJA_PORT=3456）を使用
- worktreeのDocker Composeプロジェクト名はディレクトリ名で自動分離される
- `.env`は`.gitignore`済みなのでコミット不要
- worktreeのVikunjaは独立したDBのため、タスクデータも空の状態で始まる。必要なら `./scripts/seed.sh` でシードデータを投入する
