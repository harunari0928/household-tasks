import type { Page } from '@playwright/test';

/**
 * ごみ捨てタスク定義を作る。
 * 毎日起票にして、収集日の判定だけが起票可否に効くようにしている。
 */
export async function createGarbageTaskDef(page: Page, baseURL: string) {
  const res = await page.request.post(`${baseURL}/api/tasks`, {
    data: {
      name: 'ゴミ捨て',
      category: 'trash',
      frequency_type: 'daily',
      scheduled_hour: 19,
    },
  });
  const def = await res.json();
  await page.request.post(`${baseURL}/api/test/special-kind`, {
    data: { id: def.id, specialKind: 'garbage' },
  });
  return def;
}
