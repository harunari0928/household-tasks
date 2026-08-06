/**
 * 小田原市（足柄地区）のごみ収集カレンダー。
 *
 * 収集日は「曜日」と「第何週か」だけで決まるため、外部データを持たずに計算できる。
 * ロジックは Home Assistant 側の会話コンポーネント
 * (`~/repos/homeassistant/config/custom_components/claude_code_conversation/conversation.py`
 * の `_execute_garbage_collection`) と同じ規則を移植したもの。
 * 収集ルールが変わったときは両方を直すこと。
 */

/** ごみの種類の識別子。app_settings に保存するので値を変えると設定が失効する。 */
export type GarbageTypeId =
  | 'burnable'
  | 'plastic'
  | 'can_bottle'
  | 'pet_bottle'
  | 'paper_cloth'
  | 'non_burnable'
  | 'special';

export type GarbageType = {
  id: GarbageTypeId;
  /** タスク名や設定画面に出す表示名 */
  label: string;
  /** 設定画面に添える収集日の説明 */
  scheduleLabel: string;
};

/** 表示順は設定画面の並び順を兼ねる（収集曜日順） */
export const GARBAGE_TYPES: GarbageType[] = [
  { id: 'burnable', label: '燃せるごみ', scheduleLabel: '月・木' },
  { id: 'plastic', label: 'トレー・プラスチック容器', scheduleLabel: '水' },
  { id: 'can_bottle', label: 'かん類・びん類', scheduleLabel: '第1・第3 火' },
  { id: 'pet_bottle', label: 'ペットボトル', scheduleLabel: '第2・第4 火' },
  { id: 'paper_cloth', label: '紙・布類', scheduleLabel: '第1・第3 金' },
  { id: 'non_burnable', label: '燃せないごみ', scheduleLabel: '第2 金' },
  { id: 'special', label: '特殊品（蛍光灯・スプレー缶・乾電池など）', scheduleLabel: '第4 金' },
];

const GARBAGE_TYPE_BY_ID = new Map(GARBAGE_TYPES.map((t) => [t.id, t]));

export function getGarbageTypeLabel(id: GarbageTypeId): string {
  return GARBAGE_TYPE_BY_ID.get(id)?.label ?? id;
}

/** 年末年始（12/31〜1/3）は収集なし */
const NEW_YEAR_HOLIDAYS: ReadonlySet<string> = new Set(['12-31', '01-01', '01-02', '01-03']);

/** 月内で第何X曜日かを返す (1-based) */
function nthWeekdayOfMonth(date: Date): number {
  return Math.floor((date.getDate() - 1) / 7) + 1;
}

function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

/**
 * 指定日に収集されるごみの種類を返す。収集が無い日は空配列。
 *
 * @param dateStr JST の YYYY-MM-DD
 */
export function getGarbageTypesForDate(dateStr: string): GarbageTypeId[] {
  const date = parseDate(dateStr);
  if (Number.isNaN(date.getTime())) return [];

  if (NEW_YEAR_HOLIDAYS.has(dateStr.slice(5))) return [];

  const weekday = date.getDay(); // 0=Sun ... 6=Sat
  const nth = nthWeekdayOfMonth(date);
  const types: GarbageTypeId[] = [];

  if (weekday === 1 || weekday === 4) types.push('burnable'); // 月・木
  if (weekday === 3) types.push('plastic'); // 水
  if (weekday === 2 && (nth === 1 || nth === 3)) types.push('can_bottle'); // 第1・第3 火
  if (weekday === 2 && (nth === 2 || nth === 4)) types.push('pet_bottle'); // 第2・第4 火
  if (weekday === 5 && (nth === 1 || nth === 3)) types.push('paper_cloth'); // 第1・第3 金
  if (weekday === 5 && nth === 2) types.push('non_burnable'); // 第2 金
  if (weekday === 5 && nth === 4) types.push('special'); // 第4 金

  return types;
}

/**
 * 設定で「出す」とされている種類だけに絞り込む。
 *
 * @param hiddenTypes 非表示にする種類（app_settings の garbage_hidden_types）
 */
export function getVisibleGarbageTypes(
  dateStr: string,
  hiddenTypes: readonly GarbageTypeId[],
): GarbageTypeId[] {
  const hidden = new Set(hiddenTypes);
  return getGarbageTypesForDate(dateStr).filter((t) => !hidden.has(t));
}

/**
 * ごみ捨てタスクのタイトルを組み立てる。
 * 例: `ゴミ捨て（燃せるごみ）` / `ゴミ捨て（かん類・びん類、ペットボトル）`
 */
export function buildGarbageTaskTitle(baseName: string, types: readonly GarbageTypeId[]): string {
  if (types.length === 0) return baseName;
  return `${baseName}（${types.map(getGarbageTypeLabel).join('、')}）`;
}

/** app_settings に入っている JSON 文字列を型安全に読む。壊れていれば空配列。 */
export function parseHiddenGarbageTypes(raw: string | null | undefined): GarbageTypeId[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is GarbageTypeId => typeof v === 'string' && GARBAGE_TYPE_BY_ID.has(v as GarbageTypeId));
  } catch {
    return [];
  }
}

/**
 * 指定日以降で、実際にごみ捨てタスクが起票される最初の日を探す。
 * 設定画面で「次回のごみ捨て」を出すために使う。見つからなければ null。
 *
 * @param taskDaysOfWeek タスク定義の days_of_week（例: ['mon','tue']）。省略時は曜日で絞らない
 */
export function findNextGarbageDay(
  fromDate: string,
  hiddenTypes: readonly GarbageTypeId[],
  taskDaysOfWeek?: readonly string[],
  lookaheadDays = 60,
): { date: string; types: GarbageTypeId[] } | null {
  const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const allowedDays = taskDaysOfWeek && taskDaysOfWeek.length > 0 ? new Set(taskDaysOfWeek) : null;

  const cursor = parseDate(fromDate);
  if (Number.isNaN(cursor.getTime())) return null;

  for (let i = 0; i < lookaheadDays; i++) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    if (!allowedDays || allowedDays.has(DAY_KEYS[cursor.getDay()])) {
      const types = getVisibleGarbageTypes(dateStr, hiddenTypes);
      if (types.length > 0) return { date: dateStr, types };
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}
