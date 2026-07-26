export function getTodayJST(): string {
  if (process.env.TEST_TODAY) return process.env.TEST_TODAY;
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

/** ローカルタイムの Date を YYYY-MM-DD に整形する（toISOString() はUTC基準のためJSTでは前日にずれる） */
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * months ヶ月後の日付を返す。
 * dayOfMonth 指定時はその日に合わせる（未指定なら元の日を維持）。
 * 加算先の月に存在しない日はその月の末日に丸める（1/31 + 1ヶ月 = 2/28 など）。
 */
export function addMonths(date: Date, months: number, dayOfMonth?: number | null): Date {
  const d = new Date(date);
  const targetDay = dayOfMonth ?? d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(targetDay, lastDay));
  return d;
}

export function getCurrentHourJST(): number {
  if (process.env.TEST_HOUR) return parseInt(process.env.TEST_HOUR, 10);
  return parseInt(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }),
    10,
  );
}
