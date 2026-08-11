#!/bin/bash
# 内閣府の公開CSVから祝日データ（shared/holidays.ts）を再生成する。
# 祝日は毎年2月頃に翌年分が公開されるため、年1回程度の実行を想定。
# 実行後は `pnpm --filter shared build` と各パッケージの再ビルドが必要。
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${SCRIPT_DIR}/../shared/holidays.ts"
FROM_YEAR="${1:-2024}"
CSV_URL="https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "Downloading ${CSV_URL}..."
curl -sSf --max-time 60 -o "$TMP" "$CSV_URL"

{
  cat <<'HEADER'
// 内閣府「国民の祝日について」の公開CSVから生成した祝日データ。
// 出典: https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv
// 更新方法: scripts/update-holidays.sh を実行して本ファイルを再生成する。
export const HOLIDAYS: [date: string, name: string][] = [
HEADER
  iconv -f SHIFT_JIS -t UTF-8 "$TMP" \
    | tail -n +2 \
    | tr -d '\r' \
    | awk -F, -v from="$FROM_YEAR" '
        NF >= 2 {
          split($1, d, "/")
          if (d[1] >= from) printf "  [\x27%04d-%02d-%02d\x27, \x27%s\x27],\n", d[1], d[2], d[3], $2
        }'
  echo "];"
} > "$OUT"

COUNT=$(grep -c '^  \[' "$OUT")
echo "Wrote ${COUNT} holidays (${FROM_YEAR}〜) to ${OUT}"
