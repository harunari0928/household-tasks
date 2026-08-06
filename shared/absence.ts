/**
 * 不在日（帰省・旅行など家を空ける日）の判定。
 *
 * 判定の入力は Home Assistant の家族カレンダーで、
 * `~/repos/homeassistant/config/scripts/absence_sync.py` が予定を読んで
 * このアプリの `POST /api/absence/days` に日付リストを送ってくる。
 * このモジュールはその「予定名 → 不在日か」の規則と、
 * 予定の期間を日付へ展開する処理だけを持つ（HTTP もDBも触らない）。
 *
 * キーワードは設定（app_settings の `absence_keywords`）で編集できる。
 * 既定値を変えても既存の設定は上書きしないので、初期値の変更は
 * 新規セットアップにしか効かない点に注意。
 */

/** 設定が空のときに使う既定キーワード */
export const DEFAULT_ABSENCE_KEYWORDS: readonly string[] = ['帰省', '旅行', '梶山', '大津'];

/** 不在日として保存する1日ぶん。`source` は「なぜ不在なのか」を UI に出すため */
export type AbsenceDay = {
  /** YYYY-MM-DD (JST) */
  date: string;
  /** 由来した予定名。手動追加なら null */
  summary: string | null;
};

/**
 * 予定名が不在キーワードを含むかの判定と、予定期間の日付への展開は
 * **Home Assistant 側（`absence_sync.py` の `expand_event`）が持つ**。
 * このアプリは展開済みの日付リストを `POST /api/absence/days` で受け取るだけなので、
 * 同じロジックをこちらに置くと二重実装になる（片方だけ直す事故のもと）。
 */

function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase();
}

/**
 * 設定に保存されたキーワードを読む。未設定・壊れている場合は既定値に倒す。
 *
 * 「空配列を保存して不在判定を止める」ことは意図的な設定なので尊重する
 * （キーが存在しないときだけ既定値を使う）。
 */
export function parseAbsenceKeywords(value: string | undefined | null): string[] {
  if (value === undefined || value === null) return [...DEFAULT_ABSENCE_KEYWORDS];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [...DEFAULT_ABSENCE_KEYWORDS];
    return normalizeKeywordList(parsed);
  } catch {
    return [...DEFAULT_ABSENCE_KEYWORDS];
  }
}

/** 空白除去・空要素と重複の排除。保存前後で同じ正規化を通す */
export function normalizeKeywordList(keywords: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const k of keywords) {
    if (typeof k !== 'string') continue;
    const trimmed = k.trim();
    if (!trimmed) continue;
    const key = normalize(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/**
 * 不在時のタスクの扱い。`hidden` = 不在日は起票しない。
 *
 * **起票を止めた結果は frequency_type によって変わる**（意図した挙動）:
 *
 * - `yearly` / `n_days` / `n_months` / `n_weeks`
 *   … `next_due_date <= today` の「期限到来」判定なので、不在日にスキップしても
 *   next_due_date を消費しない限り**帰宅日に繰り越して起票される**。
 *   （例: 年1で8/5起票のタスクが8/7まで帰省 → 8/8に起票され、次回は翌年8/5）
 * - `daily` / `weekly` / `monthly` / `nth_weekday_of_month`
 *   … 日付・曜日のマッチなので、**その日ぶんは消える**（旅行中の浴槽掃除が
 *   3日ぶん積み上がらない）。
 *
 * この非対称性が成り立つのは、スケジューラが不在判定を
 * `updateNextDueDate` より**手前**でスキップしているから。重複スキップの分岐は
 * 意図的に next_due_date を消費するので、そちらに相乗りさせてはいけない。
 */
export type AbsenceBehaviorKey = 'normal' | 'hidden';

export const ABSENCE_BEHAVIORS: readonly AbsenceBehaviorKey[] = ['normal', 'hidden'];

export function isValidAbsenceBehavior(value: unknown): value is AbsenceBehaviorKey {
  return typeof value === 'string' && (ABSENCE_BEHAVIORS as readonly string[]).includes(value);
}
