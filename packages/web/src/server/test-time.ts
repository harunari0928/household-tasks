let testNow: string | null = null;

export function setTestNow(iso: string | null): void {
  testNow = iso;
}

export function getNowISO(): string {
  return testNow || new Date().toISOString();
}
