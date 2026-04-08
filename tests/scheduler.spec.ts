import { test, expect } from './fixtures/setup.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Page } from '@playwright/test';

const execAsync = promisify(exec);

async function runScheduler(testToday: string, testHour?: number): Promise<string> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    DB_PATH: 'data/test_task_definitions.db',
    TEST_TODAY: testToday,
  };
  if (testHour !== undefined) {
    env.TEST_HOUR = String(testHour);
  }
  const { stdout, stderr } = await execAsync('node packages/scheduler/dist/index.js', {
    cwd: process.cwd(),
    env,
    encoding: 'utf-8',
    timeout: 15000,
  });
  if (stderr) console.error('Scheduler stderr:', stderr);
  return stdout;
}

const DAY_MAP: Record<string, string> = {
  mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日',
};

const CATEGORY_MAP: Record<string, string> = {
  water: '水回り', kitchen: 'キッチン', floor: 'フロア・室内',
  entrance: '玄関・ベランダ・その他', laundry: '洗濯・布もの', trash: 'ごみ関連',
  childcare: '育児タスク', cooking: '料理・食事タスク', lifestyle: '生活・その他',
};

async function createTaskViaUI(
  page: Page,
  baseURL: string,
  options: {
    name: string;
    category?: string;
    frequency_type: string;
    days_of_week?: string[];
    frequency_interval?: number;
    day_of_month?: number;
    scheduled_hour?: number;
  },
) {
  const category = options.category || 'water';
  await page.goto('/#/tasks');
  await page.getByRole('button', { name: new RegExp(CATEGORY_MAP[category]) }).click();
  await page.getByRole('button', { name: /タスクを追加/ }).click();
  await page.getByLabel('タスク名').fill(options.name);
  await page.getByLabel('カテゴリ').selectOption(options.category || 'water');
  await page.getByLabel('頻度').selectOption(options.frequency_type);

  if (options.days_of_week) {
    for (const day of options.days_of_week) {
      await page.getByRole('group', { name: '曜日' }).getByText(DAY_MAP[day]).click();
    }
  }
  if (options.frequency_interval != null) {
    await page.getByLabel('間隔').fill(String(options.frequency_interval));
  }
  if (options.day_of_month != null) {
    await page.getByLabel(/日指定/).fill(String(options.day_of_month));
  }
  if (options.scheduled_hour != null) {
    await page.getByLabel(/起票時刻/).fill(String(options.scheduled_hour));
  }

  await page.getByRole('button', { name: '保存' }).click();
  await page.getByText(options.name).waitFor();

  const res = await page.request.get(`${baseURL}/api/tasks`);
  const tasks = await res.json();
  return tasks.find((t: any) => t.name === options.name);
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().split('T')[0];
}

async function goToKanban(page: Page) {
  // Force full page reload to get fresh data from the database
  await page.goto('about:blank');
  await page.goto('/#/');
  await page.getByText('未着手').waitFor();
}

test.describe('固定スケジュール', () => {
  test('毎日タスクは毎日起票される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, { name: 'daily-test', category: 'water', frequency_type: 'daily' });

    await runScheduler('2026-03-14');

    await goToKanban(page);
    await expect(page.getByText('daily-test')).toBeVisible();
  });

  test('毎週タスクは対象曜日にのみ起票される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, { name: 'weekly-mon', category: 'water', frequency_type: 'weekly', days_of_week: ['mon'] });

    await runScheduler('2026-03-16'); // Monday

    await goToKanban(page);
    await test.step('対象曜日(月曜)に起票される', async () => {
      await expect(page.getByText('weekly-mon')).toBeVisible();
    });
  });

  test('毎週タスクは対象外曜日には起票されない', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, { name: 'weekly-mon-skip', category: 'water', frequency_type: 'weekly', days_of_week: ['mon'] });

    await runScheduler('2026-03-17'); // Tuesday

    await goToKanban(page);
    await expect(page.getByText('weekly-mon-skip')).not.toBeVisible();
  });

  test('毎月タスクは指定日にのみ起票される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, { name: 'monthly-15', category: 'water', frequency_type: 'monthly', day_of_month: 15 });

    await runScheduler('2026-03-15');

    await goToKanban(page);
    await test.step('指定日(15日)に起票される', async () => {
      await expect(page.getByText('monthly-15')).toBeVisible();
    });
  });

  test('毎月タスクは指定日以外には起票されない', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, { name: 'monthly-15-skip', category: 'water', frequency_type: 'monthly', day_of_month: 15 });

    await runScheduler('2026-03-16');

    await goToKanban(page);
    await expect(page.getByText('monthly-15-skip')).not.toBeVisible();
  });
});

test.describe('N日ごと', () => {
  test('次回予定日に起票される', async ({ page, baseURL }) => {
    const task = await createTaskViaUI(page, baseURL!, { name: 'n-days-3', category: 'water', frequency_type: 'n_days', frequency_interval: 3 });
    const dueDate = task.next_due_date;

    await runScheduler(dueDate);

    await goToKanban(page);
    await expect(page.getByText('n-days-3')).toBeVisible();
  });

  test('間隔変更後、変更前の予定日では起票されない', async ({ page, baseURL }) => {
    const task = await createTaskViaUI(page, baseURL!, { name: 'interval-old', category: 'water', frequency_type: 'n_days', frequency_interval: 3 });
    const originalDueDate = task.next_due_date;

    // 間隔を5に変更
    await page.getByText('interval-old').click();
    await page.getByLabel('間隔').fill('5');
    await page.getByRole('button', { name: '保存' }).click();

    await runScheduler(originalDueDate);

    await goToKanban(page);
    await expect(page.getByText('interval-old')).not.toBeVisible();
  });

  test('間隔変更後、変更後の予定日で起票される', async ({ page, baseURL }) => {
    const task = await createTaskViaUI(page, baseURL!, { name: 'interval-new', category: 'water', frequency_type: 'n_days', frequency_interval: 3 });
    const originalDueDate = task.next_due_date;

    // 間隔を5に変更
    await page.getByText('interval-new').click();
    await page.getByLabel('間隔').fill('5');
    await page.getByRole('button', { name: '保存' }).click();

    const today = addDays(originalDueDate, -3);
    const newDueDate = addDays(today, 5);

    await runScheduler(newDueDate);

    await goToKanban(page);
    await expect(page.getByText('interval-new')).toBeVisible();
  });

  test('次回予定日より前は起票されない', async ({ page, baseURL }) => {
    const task = await createTaskViaUI(page, baseURL!, { name: 'n-days-before', category: 'water', frequency_type: 'n_days', frequency_interval: 3 });
    const beforeDue = addDays(task.next_due_date, -1);

    await runScheduler(beforeDue);

    await goToKanban(page);
    await expect(page.getByText('n-days-before')).not.toBeVisible();
  });

  test('実行が遅延しても元のリズムで起票される', async ({ page, baseURL }) => {
    const task = await createTaskViaUI(page, baseURL!, { name: 'rhythm-test', category: 'water', frequency_type: 'n_days', frequency_interval: 3 });
    const dueDate = task.next_due_date;

    // D+1で遅延実行
    await runScheduler(addDays(dueDate, 1));

    // D+2ではまだ起票されない（元のリズムより前）
    await runScheduler(addDays(dueDate, 2));

    await goToKanban(page);
    await test.step('元のリズムより前は起票されない', async () => {
      await expect(page.getByText('rhythm-test')).toHaveCount(1);
    });

    // 最初のインスタンスを完了にする（重複チェック回避のため）
    const instances = await page.request.get(`${baseURL}/api/kanban`);
    const items = await instances.json();
    const instance = items.find((i: any) => i.title === 'rhythm-test');
    await page.request.patch(`${baseURL}/api/kanban/${instance.id}/status`, {
      data: { status: 'done', assignee: 'test' },
    });

    // D+3で起票される（元のリズム通り）
    await runScheduler(addDays(dueDate, 3));

    await goToKanban(page);
    await test.step('元のリズム通りに起票される', async () => {
      await expect(page.getByText('rhythm-test')).toHaveCount(2);
    });
  });
});

test.describe('重複起票の防止', () => {
  test('同日に2回実行しても重複起票しない', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, { name: 'idempotent-test', category: 'water', frequency_type: 'daily' });

    await runScheduler('2026-03-14');
    await runScheduler('2026-03-14');

    await goToKanban(page);
    await expect(page.getByText('idempotent-test')).toHaveCount(1);
  });

  test('前日に起票した未完了タスクは翌日に重複起票しない', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, { name: 'cross-day-dup', category: 'water', frequency_type: 'daily' });

    await runScheduler('2026-03-14');
    await runScheduler('2026-03-15');

    await goToKanban(page);
    await expect(page.getByText('cross-day-dup')).toHaveCount(1);
  });
});

test.describe('活性・非活性', () => {
  test('非活性タスクは起票されない', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, { name: 'inactive-test', category: 'water', frequency_type: 'daily' });
    await page.getByRole('button', { name: '無効にする' }).click();

    await runScheduler('2026-03-14');

    await goToKanban(page);
    await expect(page.getByText('inactive-test')).not.toBeVisible();
  });

  test('一時停止から再開時、次回予定日が過去なら即座に起票される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, { name: 'resume-test', category: 'water', frequency_type: 'n_days', frequency_interval: 3 });
    await page.getByRole('button', { name: '無効にする' }).click();
    await page.getByRole('button', { name: '有効にする' }).click();

    await runScheduler('2026-12-01');

    await goToKanban(page);
    await expect(page.getByText('resume-test')).toBeVisible();
  });
});

test.describe('起票時刻', () => {
  test('指定時刻以降にスケジューラが実行されると起票される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, { name: 'hour-6-ok', category: 'water', frequency_type: 'daily', scheduled_hour: 6 });

    await runScheduler('2026-03-14', 6);

    await goToKanban(page);
    await expect(page.getByText('hour-6-ok')).toBeVisible();
  });

  test('指定時刻より前にスケジューラが実行されると起票されない', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, { name: 'hour-18-skip', category: 'water', frequency_type: 'daily', scheduled_hour: 18 });

    await runScheduler('2026-03-14', 6);

    await goToKanban(page);
    await expect(page.getByText('hour-18-skip')).not.toBeVisible();
  });

  test('スケジューラが指定時刻を過ぎて実行されても起票される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, { name: 'hour-6-late', category: 'water', frequency_type: 'daily', scheduled_hour: 6 });

    await runScheduler('2026-03-14', 8);

    await goToKanban(page);
    await expect(page.getByText('hour-6-late')).toBeVisible();
  });

  test('起票時刻が設定されたタスクも1日1回しか起票されない', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, { name: 'hour-idempotent', category: 'water', frequency_type: 'daily', scheduled_hour: 6 });

    await runScheduler('2026-03-14', 6);
    await runScheduler('2026-03-14', 7);

    await goToKanban(page);
    await expect(page.getByText('hour-idempotent')).toHaveCount(1);
  });
});

async function insertFailedLog(page: Page, baseURL: string, taskDefId: number, executedAt: string) {
  await page.request.post(`${baseURL}/api/test/insert-execution-log`, {
    data: { task_definition_id: taskDefId, status: 'failed', executed_at: executedAt },
  });
}

test.describe('リトライ', () => {
  test('失敗したタスクがリトライで起票される', async ({ page, baseURL }) => {
    const task = await createTaskViaUI(page, baseURL!, { name: 'retry-ok', category: 'water', frequency_type: 'daily' });
    await insertFailedLog(page, baseURL!, task.id, '2026-03-13');

    await runScheduler('2026-03-14', 0);

    await goToKanban(page);
    await expect(page.getByText('retry-ok')).toBeVisible();
  });

  test('リトライでも起票時刻が尊重される', async ({ page, baseURL }) => {
    const task = await createTaskViaUI(page, baseURL!, { name: 'retry-hour-skip', category: 'water', frequency_type: 'daily', scheduled_hour: 22 });
    await insertFailedLog(page, baseURL!, task.id, '2026-03-13');

    await runScheduler('2026-03-14', 6);

    await goToKanban(page);
    await expect(page.getByText('retry-hour-skip')).not.toBeVisible();
  });

  test('リトライで起票時刻到達後に起票される', async ({ page, baseURL }) => {
    const task = await createTaskViaUI(page, baseURL!, { name: 'retry-hour-ok', category: 'water', frequency_type: 'daily', scheduled_hour: 22 });
    await insertFailedLog(page, baseURL!, task.id, '2026-03-13');

    await runScheduler('2026-03-14', 22);

    await goToKanban(page);
    await expect(page.getByText('retry-hour-ok')).toBeVisible();
  });

  test('リトライで未完了インスタンスがある場合は重複起票しない', async ({ page, baseURL }) => {
    const task = await createTaskViaUI(page, baseURL!, { name: 'retry-dup', category: 'water', frequency_type: 'daily' });
    await runScheduler('2026-03-14', 0);
    await insertFailedLog(page, baseURL!, task.id, '2026-03-13');

    await runScheduler('2026-03-14', 0);

    await goToKanban(page);
    await expect(page.getByText('retry-dup')).toHaveCount(1);
  });

  test('リトライでN日ごとタスクの次回予定日が更新される', async ({ page, baseURL }) => {
    const task = await createTaskViaUI(page, baseURL!, { name: 'retry-ndays', category: 'water', frequency_type: 'n_days', frequency_interval: 3 });
    const dueDate = task.next_due_date;
    await insertFailedLog(page, baseURL!, task.id, addDays(dueDate, -1));

    await runScheduler(dueDate, 0);

    await goToKanban(page);
    await test.step('リトライで起票される', async () => {
      await expect(page.getByText('retry-ndays')).toBeVisible();
    });

    const instances = await page.request.get(`${baseURL}/api/kanban`);
    const items = await instances.json();
    const instance = items.find((i: any) => i.title === 'retry-ndays');
    await page.request.patch(`${baseURL}/api/kanban/${instance.id}/status`, {
      data: { status: 'done', assignee: 'test' },
    });

    await runScheduler(addDays(dueDate, 3), 0);

    await goToKanban(page);
    await test.step('次回予定日が更新され次のサイクルで起票される', async () => {
      await expect(page.getByText('retry-ndays')).toHaveCount(2);
    });
  });
});
