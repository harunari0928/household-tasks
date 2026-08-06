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
 * カレンダー予定1件ぶん。Home Assistant の `calendar.get_events` の応答と同じ形。
 *
 * 終日予定は `start`/`end` が `YYYY-MM-DD` で **end は排他的**（沼津旅行が
 * 9/19〜9/20 の2泊なら `start: 2026-09-19, end: 2026-09-21`）。
 * 時刻つき予定は ISO8601。
 */
export type CalendarEvent = {
  start: string;
  end: string;
  summary: string;
};

/**
 * 予定名が不在キーワードを含むか。
 *
 * 全角/半角・大文字小文字の揺れを吸収するため NFKC 正規化して小文字化してから見る
 * （「旅行」のような日本語には影響しないが、ローマ字の行き先を足したときに効く）。
 */
export function matchAbsenceKeyword(
  summary: string,
  keywords: readonly string[],
): string | null {
  const haystack = normalize(summary);
  for (const keyword of keywords) {
    const needle = normalize(keyword);
    if (needle && haystack.includes(needle)) return keyword;
  }
  return null;
}

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

/** JST の日付文字列に日数を足す。DST が無いので単純加算でよい */
function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 予定の start/end を JST の日付に落とす。
 *
 * 時刻つき予定は「その日は家に居ない」とまでは言えないが、
 * 帰省・旅行の予定は終日で入る運用なので、時刻つきでも日付だけ見て同じ扱いにする
 * （`ゆか会社飲み会` のような時刻つき予定はキーワードに掛からないので影響しない）。
 */
function toJSTDate(value: string): string {
  // 終日予定は既に YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 予定1件を不在日の配列に展開する。
 *
 * 終日予定の `end` は排他的なので最終日は `end - 1日`。時刻つき予定は
 * 同じ日に始まって終わることが多く、その場合 end == start で1日ぶんになる。
 * 壊れた（end < start）予定は start の1日だけにして落とさない。
 */
export function expandEventDates(event: CalendarEvent): string[] {
  const start = toJSTDate(event.start);
  const rawEnd = toJSTDate(event.end);

  const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(event.end);
  // 終日予定は end 排他 → 最終日は前日。時刻つきは終了時刻の当日が最終日
  const lastDay = isAllDay ? addDays(rawEnd, -1) : rawEnd;

  if (lastDay < start) return [start];

  const dates: string[] = [];
  // 予定の壊れ方（end が数年先など）で無限に膨らまないよう上限を設ける
  const MAX_DAYS = 60;
  for (let cursor = start, i = 0; cursor <= lastDay && i < MAX_DAYS; cursor = addDays(cursor, 1), i++) {
    dates.push(cursor);
  }
  return dates;
}

/**
 * カレンダー予定の一覧から不在日を作る。
 *
 * 同じ日に複数の予定が掛かったら最初の予定名を採る（日付の重複は作らない）。
 * 返り値は日付昇順。
 */
export function collectAbsenceDays(
  events: readonly CalendarEvent[],
  keywords: readonly string[],
): AbsenceDay[] {
  const byDate = new Map<string, string>();

  for (const event of events) {
    if (!event?.summary) continue;
    if (!matchAbsenceKeyword(event.summary, keywords)) continue;
    for (const date of expandEventDates(event)) {
      if (!byDate.has(date)) byDate.set(date, event.summary);
    }
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, summary]) => ({ date, summary }));
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
