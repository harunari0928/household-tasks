import { test, expect } from './fixtures/setup.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Page } from '@playwright/test';

const execAsync = promisify(exec);

async function runScheduler(testToday: string): Promise<string> {
  const { stdout, stderr } = await execAsync('node packages/scheduler/dist/index.js', {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_PATH: 'data/test_task_definitions.db',
      TEST_TODAY: testToday,
    },
    encoding: 'utf-8',
    timeout: 15000,
  });
  if (stderr) console.error('Scheduler stderr:', stderr);
  return stdout;
}

function getTodayJST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type AbsenceBehavior = 'normal' | 'hidden';

async function createTaskDef(
  page: Page,
  baseURL: string,
  options: {
    name: string;
    category?: string;
    absence_behavior?: AbsenceBehavior;
    frequency_type?: string;
    next_due_date?: string;
    withInstance?: boolean;
  },
) {
  const res = await page.request.post(`${baseURL}/api/tasks`, {
    data: {
      name: options.name,
      category: options.category ?? 'floor',
      frequency_type: options.frequency_type ?? 'daily',
      scheduled_hour: 0,
      absence_behavior: options.absence_behavior ?? 'hidden',
    },
  });
  const def = await res.json();
  if (options.withInstance) {
    await page.request.post(`${baseURL}/api/kanban/create-from-definition/${def.id}`);
  }
  return def;
}

async function setAbsenceDays(
  page: Page,
  baseURL: string,
  days: Array<{ date: string; summary?: string }>,
) {
  return page.request.post(`${baseURL}/api/absence/days`, {
    data: { days: days.map((d) => ({ date: d.date, summary: d.summary ?? '沼津旅行' })) },
  });
}

async function goToKanban(page: Page) {
  await page.goto('/#/');
  await page.getByText('未着手').waitFor();
}

test.describe('不在日（帰省・旅行）', () => {
  test('既定のキーワードが入っている', async ({ page, baseURL }) => {
    const res = await page.request.get(`${baseURL}/api/absence`);
    const data = await res.json();
    expect(data.keywords).toEqual(['帰省', '旅行', '梶山', '大津']);
    expect(data.today).toBeNull();
  });

  test('不在日は「不在中は非表示」のタスクだけがカンバンから消える', async ({ page, baseURL }) => {
    await createTaskDef(page, baseURL!, {
      name: '浴槽掃除',
      absence_behavior: 'hidden',
      withInstance: true,
    });
    await createTaskDef(page, baseURL!, {
      name: 'パル注文',
      category: 'cooking',
      absence_behavior: 'normal',
      withInstance: true,
    });

    await goToKanban(page);
    await expect(page.getByText('浴槽掃除')).toBeVisible();
    await expect(page.getByText('パル注文')).toBeVisible();

    await setAbsenceDays(page, baseURL!, [{ date: getTodayJST() }]);

    await page.reload();
    await page.getByText('未着手').waitFor();
    await expect(page.getByText('パル注文')).toBeVisible();
    await expect(page.getByText('浴槽掃除')).not.toBeVisible();
  });

  test('不在日はバナーが出る', async ({ page, baseURL }) => {
    await setAbsenceDays(page, baseURL!, [{ date: getTodayJST(), summary: '沼津旅行' }]);
    await goToKanban(page);
    await expect(page.getByText('不在日（沼津旅行）', { exact: false })).toBeVisible();
  });

  test('不在日を取り消すと再表示される', async ({ page, baseURL }) => {
    const today = getTodayJST();
    await createTaskDef(page, baseURL!, {
      name: '浴槽掃除',
      absence_behavior: 'hidden',
      withInstance: true,
    });
    await setAbsenceDays(page, baseURL!, [{ date: today }]);

    await goToKanban(page);
    await expect(page.getByText('浴槽掃除')).not.toBeVisible();

    await page.request.delete(`${baseURL}/api/absence/days/${today}`);
    await page.reload();
    await page.getByText('未着手').waitFor();
    await expect(page.getByText('浴槽掃除')).toBeVisible();
  });

  test('同期は source=calendar の不在日を置き換える（旅行が中止になったら消える）', async ({ page, baseURL }) => {
    const today = getTodayJST();
    await setAbsenceDays(page, baseURL!, [
      { date: today },
      { date: addDays(today, 1) },
    ]);

    let res = await page.request.get(`${baseURL}/api/absence`);
    expect((await res.json()).days).toHaveLength(2);

    // 予定が消えた状態で同期 → 不在日も消える
    await setAbsenceDays(page, baseURL!, []);
    res = await page.request.get(`${baseURL}/api/absence`);
    const data = await res.json();
    expect(data.days).toHaveLength(0);
    expect(data.today).toBeNull();
  });

  test('スケジューラは不在日に「不在中は非表示」のタスクを起票しない', async ({ page, baseURL }) => {
    const target = '2026-08-06';
    await createTaskDef(page, baseURL!, { name: '不在で休む掃除', absence_behavior: 'hidden' });
    await createTaskDef(page, baseURL!, {
      name: '不在でもやる注文',
      category: 'cooking',
      absence_behavior: 'normal',
    });
    await setAbsenceDays(page, baseURL!, [{ date: target, summary: '帰省' }]);

    const out = await runScheduler(target);
    expect(out).toContain('Absence day');
    expect(out).toContain('不在でもやる注文');
    expect(out).not.toContain('CREATED: "不在で休む掃除"');
  });

  /**
   * 年1タスクが不在で「1年後送り」にならないことの回帰テスト。
   *
   * yearly は `next_due_date <= today` の期限到来判定なので、不在日に
   * next_due_date を消費しなければ帰宅日に繰り越して起票される。
   * 重複スキップの分岐（あちらは意図的に next_due_date を進める）に
   * 相乗りさせると、この性質が壊れる。
   */
  test('年1タスクは不在中は起票されず、帰宅日に繰り越して起票される', async ({ page, baseURL }) => {
    const due = '2026-08-05';
    const def = await createTaskDef(page, baseURL!, {
      name: '防災用品棚卸し',
      category: 'lifestyle',
      absence_behavior: 'hidden',
      frequency_type: 'yearly',
    });

    // 期限を不在期間の初日に直接合わせる。
    // **PUT /api/tasks は next_due_date を「実際の今日」から再計算する**ので、
    // ここで PUT を使うとテストが実行日に依存して壊れる（8/5 を狙っても翌年に飛ぶ）。
    await page.request.post(`${baseURL}/api/test/set-next-due-date`, {
      data: { id: def.id, next_due_date: due },
    });

    // 8/5〜8/7 が不在
    await setAbsenceDays(page, baseURL!, [
      { date: '2026-08-05', summary: '帰省' },
      { date: '2026-08-06', summary: '帰省' },
      { date: '2026-08-07', summary: '帰省' },
    ]);

    for (const day of ['2026-08-05', '2026-08-06', '2026-08-07']) {
      const out = await runScheduler(day);
      expect(out).not.toContain('CREATED: "防災用品棚卸し"');
    }

    // 期限が消費されていない（繰り越されている）
    let res = await page.request.get(`${baseURL}/api/tasks/${def.id}`);
    expect((await res.json()).next_due_date).toBe(due);

    // 帰宅日に起票される
    const out = await runScheduler('2026-08-08');
    expect(out).toContain('CREATED: "防災用品棚卸し"');

    // 起票後は翌年へ進む
    res = await page.request.get(`${baseURL}/api/tasks/${def.id}`);
    expect((await res.json()).next_due_date).toBe('2027-08-05');
  });

  test('キーワードを編集できる', async ({ page, baseURL }) => {
    const res = await page.request.put(`${baseURL}/api/absence/keywords`, {
      data: { keywords: ['帰省', '  沼津  ', '沼津', ''] },
    });
    // 空白除去・重複排除される
    expect((await res.json()).keywords).toEqual(['帰省', '沼津']);
  });

  test('不正な不在時の扱いは拒否される', async ({ page, baseURL }) => {
    const res = await page.request.post(`${baseURL}/api/tasks`, {
      data: {
        name: 'だめなタスク',
        category: 'floor',
        frequency_type: 'daily',
        scheduled_hour: 0,
        absence_behavior: 'sometimes',
      },
    });
    expect(res.status()).toBe(400);
  });

  test('不正な日付は拒否される', async ({ page, baseURL }) => {
    const res = await page.request.post(`${baseURL}/api/absence/days`, {
      data: { days: [{ date: '2026/08/06' }] },
    });
    expect(res.status()).toBe(400);
  });
});
