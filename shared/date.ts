export function getTodayJST(): string {
  if (process.env.TEST_TODAY) return process.env.TEST_TODAY;
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}
