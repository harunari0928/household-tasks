export function getTodayJST(): string {
  if (process.env.TEST_TODAY) return process.env.TEST_TODAY;
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

export function getCurrentHourJST(): number {
  if (process.env.TEST_HOUR) return parseInt(process.env.TEST_HOUR, 10);
  return parseInt(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }),
    10,
  );
}
