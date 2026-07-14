import { test, expect } from './fixtures/setup.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Page } from '@playwright/test';

function getTodayJST(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

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
    month_of_year?: number;
    nth_weekday_position?: number;
    scheduled_hour?: number;
    period?: { start_mm: number; start_dd: number; end_mm: number; end_dd: number };
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
  if (options.month_of_year != null) {
    await page.getByLabel(/月指定/).fill(String(options.month_of_year));
  }
  if (options.day_of_month != null) {
    await page.getByLabel(/日指定/).fill(String(options.day_of_month));
  }
  if (options.nth_weekday_position != null) {
    await page.getByLabel('何週目').selectOption(String(options.nth_weekday_position));
  }
  if (options.scheduled_hour != null) {
    await page.getByLabel(/起票時刻/).fill(String(options.scheduled_hour));
  }
  if (options.period) {
    await page.getByRole('radio', { name: '期間指定する' }).check();
    await page.getByLabel('開始月').selectOption(String(options.period.start_mm));
    await page.getByLabel('開始日').selectOption(String(options.period.start_dd));
    await page.getByLabel('終了月').selectOption(String(options.period.end_mm));
    await page.getByLabel('終了日').selectOption(String(options.period.end_dd));
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

async function setServerTime(page: Page, baseURL: string, iso: string | null) {
  await page.request.post(`${baseURL}/api/test/set-time`, { data: { time: iso } });
}

async function goToKanban(page: Page) {
  // Force full page reload to get fresh data from the database
  await page.goto('about:blank');
  await page.goto('/#/');
  await page.getByText('未着手').waitFor();
}

async function dragCardToColumn(page: Page, cardName: string, columnTitle: string) {
  const card = page.getByText(cardName).first();
  const columnHeading = page.getByRole('heading', { name: columnTitle });

  const cardBox = await card.boundingBox();
  const headingBox = await columnHeading.boundingBox();
  if (!cardBox || !headingBox) throw new Error('Could not get bounding boxes');

  const startX = cardBox.x + 10;
  const startY = cardBox.y + cardBox.height / 2;
  const endX = headingBox.x + headingBox.width / 2;
  const endY = headingBox.y + headingBox.height + 40;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 10, startY, { steps: 2 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
}

async function registerUser(page: Page, name: string) {
  await page.goto('/#/settings');
  await page.getByLabel('新しいユーザー名').fill(name);
  await page.getByRole('button', { name: '追加' }).click();
  await page.getByText(name).waitFor();
}

// 対象タスクの未完了インスタンスを、指定日(JST正午)に完了にする。
// completed_at がその日で記録され、完了駆動スケジューラの判定基準日になる。
async function completeInstanceOn(
  page: Page,
  baseURL: string,
  title: string,
  dateJST: string,
  assignee = 'test',
) {
  await setServerTime(page, baseURL, `${dateJST}T03:00:00.000Z`); // UTC+9 → JST正午
  const res = await page.request.get(`${baseURL}/api/kanban`);
  const items = await res.json();
  const instance = items.find((i: any) => i.title === title && i.status !== 'done');
  if (!instance) throw new Error(`未完了の「${title}」が見つかりません`);
  await page.request.patch(`${baseURL}/api/kanban/${instance.id}/status`, {
    data: { status: 'done', assignee },
  });
  await setServerTime(page, baseURL, null);
}

async function completeTaskViaUI(page: Page, cardName: string, assignee: string) {
  const userSwitcher = page.getByLabel('ユーザー切替');
  if ((await userSwitcher.textContent())?.includes(assignee) === false) {
    await userSwitcher.click();
    await page.getByRole('button', { name: assignee, exact: true }).click();
  }
  await dragCardToColumn(page, cardName, '完了');
  await expect(
    page.getByRole('region', { name: '完了列' }).getByText(cardName),
  ).toBeVisible();
}

async function arrangeSkippedAndDeletedNDaysTask(
  page: Page,
  baseURL: string,
  name = 'skip-advance-same',
): Promise<string> {
  await page.goto('/#/settings');
  await page.getByLabel('新しいユーザー名').fill('test-user');
  await page.getByRole('button', { name: '追加' }).click();
  await page.getByText('test-user').waitFor();

  const task = await createTaskViaUI(page, baseURL, {
    name,
    category: 'water',
    frequency_type: 'n_days',
    frequency_interval: 3,
  });
  const cycle1 = task.next_due_date;

  await runScheduler(cycle1);
  await runScheduler(addDays(cycle1, 3));

  await goToKanban(page);
  await page.getByText(name).hover();
  await page.getByRole('button', { name: 'タスクを削除', exact: true }).click();
  const deleteResponse = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && /\/api\/kanban\/\d+$/.test(r.url()),
  );
  await page.getByRole('button', { name: '削除する' }).click();
  await deleteResponse;

  return cycle1;
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

  test('未完了のまま次の予定日に到達したタスクを削除しても、同じ予定日では再起票されない', async ({ page, baseURL }) => {
    const cycle1 = await arrangeSkippedAndDeletedNDaysTask(page, baseURL!);

    await runScheduler(addDays(cycle1, 3));

    await goToKanban(page);
    await expect(page.getByText('skip-advance-same')).toHaveCount(0);
  });

  test('未完了のまま次の予定日に到達したタスクを削除しても、その次の予定日には起票される', async ({ page, baseURL }) => {
    const cycle1 = await arrangeSkippedAndDeletedNDaysTask(page, baseURL!, 'skip-advance-next');

    await runScheduler(addDays(cycle1, 6));

    await goToKanban(page);
    await expect(page.getByText('skip-advance-next')).toHaveCount(1);
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

  test('前日分を起票時刻より後に完了すると、当日分は再起票されない', async ({ page, baseURL }) => {
    // Arrange: 起票時刻8時のタスク。前日分を未完了のまま持ち越し、当日9時（起票時刻より後）に完了する。
    const today = getTodayJST();
    await registerUser(page, 'test-user');
    await createTaskViaUI(page, baseURL!, { name: 'morning-task', category: 'water', frequency_type: 'daily', scheduled_hour: 8 });
    await runScheduler(addDays(today, -1), 8);
    await setServerTime(page, baseURL!, `${today}T00:00:00.000Z`); // JST 09:00 当日
    await goToKanban(page);
    await completeTaskViaUI(page, 'morning-task', 'test-user');
    await setServerTime(page, baseURL!, null);

    // Act
    await runScheduler(today, 10);

    // Assert
    await goToKanban(page);
    await test.step('完了列に1件残っている', async () => {
      await expect(
        page.getByRole('region', { name: '完了列' }).getByText('morning-task'),
      ).toHaveCount(1);
    });

    await test.step('未着手列に再起票されていない', async () => {
      await expect(
        page.getByRole('region', { name: '未着手列' }).getByText('morning-task'),
      ).toHaveCount(0);
    });
  });

  test('前日分を起票時刻より前に完了すると、当日分が起票される', async ({ page, baseURL }) => {
    // Arrange: 起票時刻19時のタスク。前日分を未完了のまま持ち越し、当日8時（起票時刻より前）に完了する。
    const today = getTodayJST();
    await registerUser(page, 'test-user');
    await createTaskViaUI(page, baseURL!, { name: 'evening-task', category: 'water', frequency_type: 'daily', scheduled_hour: 19 });
    await runScheduler(addDays(today, -1), 19);
    await setServerTime(page, baseURL!, `${addDays(today, -1)}T23:00:00.000Z`); // JST 08:00 当日
    await goToKanban(page);
    await completeTaskViaUI(page, 'evening-task', 'test-user');
    await setServerTime(page, baseURL!, null);

    // Act
    await runScheduler(today, 19);

    // Assert
    await goToKanban(page);
    await test.step('完了列に前日分が1件残っている', async () => {
      await expect(
        page.getByRole('region', { name: '完了列' }).getByText('evening-task'),
      ).toHaveCount(1);
    });

    await test.step('未着手列に当日分が起票されている', async () => {
      await expect(
        page.getByRole('region', { name: '未着手列' }).getByText('evening-task'),
      ).toHaveCount(1);
    });
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

test.describe('1年ごと（月日指定あり）', () => {
  test('指定月日に起票される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, {
      name: 'yearly-oct1',
      category: 'lifestyle',
      frequency_type: 'yearly',
      month_of_year: 10,
      day_of_month: 1,
    });

    await runScheduler('2026-10-01');

    await goToKanban(page);
    await expect(page.getByText('yearly-oct1')).toBeVisible();
  });

  test('指定月日以外には起票されない', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, {
      name: 'yearly-oct1-skip',
      category: 'lifestyle',
      frequency_type: 'yearly',
      month_of_year: 10,
      day_of_month: 1,
    });

    await runScheduler('2026-09-30');

    await goToKanban(page);
    await expect(page.getByText('yearly-oct1-skip')).not.toBeVisible();
  });

  test('翌年の指定月日に再び起票される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, {
      name: 'yearly-recur',
      category: 'lifestyle',
      frequency_type: 'yearly',
      month_of_year: 10,
      day_of_month: 1,
    });

    await runScheduler('2026-10-01');

    // 最初のインスタンスを完了にする
    const instances = await page.request.get(`${baseURL}/api/kanban`);
    const items = await instances.json();
    const instance = items.find((i: any) => i.title === 'yearly-recur');
    await page.request.patch(`${baseURL}/api/kanban/${instance.id}/status`, {
      data: { status: 'done', assignee: 'test' },
    });

    await runScheduler('2027-10-01');

    await goToKanban(page);
    await expect(page.getByText('yearly-recur')).toHaveCount(2);
  });
});

test.describe('第N曜日(毎月)', () => {
  test('第1月曜日のタスクは該当日に起票される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, {
      name: 'nth-1st-mon',
      category: 'water',
      frequency_type: 'nth_weekday_of_month',
      days_of_week: ['mon'],
      nth_weekday_position: 1,
    });

    await runScheduler('2026-03-02');

    await goToKanban(page);
    await expect(page.getByText('nth-1st-mon')).toBeVisible();
  });

  test('第1月曜日のタスクは該当月の他の日には起票されない', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, {
      name: 'nth-1st-mon-skip',
      category: 'water',
      frequency_type: 'nth_weekday_of_month',
      days_of_week: ['mon'],
      nth_weekday_position: 1,
    });

    await runScheduler('2026-03-09');

    await goToKanban(page);
    await expect(page.getByText('nth-1st-mon-skip')).not.toBeVisible();
  });

  test('第5月曜日のタスクは月内に第5週目がなければ起票されない', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, {
      name: 'nth-5th-mon',
      category: 'water',
      frequency_type: 'nth_weekday_of_month',
      days_of_week: ['mon'],
      nth_weekday_position: 5,
    });

    await runScheduler('2026-09-28');

    await goToKanban(page);
    await expect(page.getByText('nth-5th-mon')).not.toBeVisible();
  });

  test('第5月曜日のタスクは該当日が存在する月の該当日に起票される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, {
      name: 'nth-5th-mon-create',
      category: 'water',
      frequency_type: 'nth_weekday_of_month',
      days_of_week: ['mon'],
      nth_weekday_position: 5,
    });

    await runScheduler('2026-08-31');

    await goToKanban(page);
    await expect(page.getByText('nth-5th-mon-create')).toBeVisible();
  });
});

test.describe('実行期間', () => {
  test('実行期間の開始日に起票される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, {
      name: 'period-start-boundary',
      category: 'water',
      frequency_type: 'daily',
      period: { start_mm: 6, start_dd: 1, end_mm: 8, end_dd: 31 },
    });

    await runScheduler('2026-06-01');

    await goToKanban(page);
    await expect(page.getByText('period-start-boundary')).toBeVisible();
  });

  test('実行期間の終了日に起票される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, {
      name: 'period-end-boundary',
      category: 'water',
      frequency_type: 'daily',
      period: { start_mm: 6, start_dd: 1, end_mm: 8, end_dd: 31 },
    });

    await runScheduler('2026-08-31');

    await goToKanban(page);
    await expect(page.getByText('period-end-boundary')).toBeVisible();
  });

  test('実行期間の開始日の前日には起票されない', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, {
      name: 'period-before-start',
      category: 'water',
      frequency_type: 'daily',
      period: { start_mm: 6, start_dd: 1, end_mm: 8, end_dd: 31 },
    });

    await runScheduler('2026-05-31');

    await goToKanban(page);
    await expect(page.getByText('period-before-start')).not.toBeVisible();
  });

  test('実行期間の終了日の翌日には起票されない', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, {
      name: 'period-after-end',
      category: 'water',
      frequency_type: 'daily',
      period: { start_mm: 6, start_dd: 1, end_mm: 8, end_dd: 31 },
    });

    await runScheduler('2026-09-01');

    await goToKanban(page);
    await expect(page.getByText('period-after-end')).not.toBeVisible();
  });

  test('年跨ぎ期間は開始日に起票される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, {
      name: 'period-wrap-start',
      category: 'water',
      frequency_type: 'daily',
      period: { start_mm: 12, start_dd: 1, end_mm: 2, end_dd: 28 },
    });

    await runScheduler('2026-12-01');

    await goToKanban(page);
    await expect(page.getByText('period-wrap-start')).toBeVisible();
  });

  test('年跨ぎ期間は年明け後の期間内日にも起票される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, {
      name: 'period-wrap-after-newyear',
      category: 'water',
      frequency_type: 'daily',
      period: { start_mm: 12, start_dd: 1, end_mm: 2, end_dd: 28 },
    });

    await runScheduler('2026-01-15');

    await goToKanban(page);
    await expect(page.getByText('period-wrap-after-newyear')).toBeVisible();
  });

  test('年跨ぎ期間は終了日に起票される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, {
      name: 'period-wrap-end',
      category: 'water',
      frequency_type: 'daily',
      period: { start_mm: 12, start_dd: 1, end_mm: 2, end_dd: 28 },
    });

    await runScheduler('2026-02-28');

    await goToKanban(page);
    await expect(page.getByText('period-wrap-end')).toBeVisible();
  });

  test('年跨ぎ期間外（終了の翌日）には起票されない', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, {
      name: 'period-wrap-outside-after',
      category: 'water',
      frequency_type: 'daily',
      period: { start_mm: 12, start_dd: 1, end_mm: 2, end_dd: 28 },
    });

    await runScheduler('2026-03-01');

    await goToKanban(page);
    await expect(page.getByText('period-wrap-outside-after')).not.toBeVisible();
  });

  test('年跨ぎ期間外（開始の前日）には起票されない', async ({ page, baseURL }) => {
    await createTaskViaUI(page, baseURL!, {
      name: 'period-wrap-outside-before',
      category: 'water',
      frequency_type: 'daily',
      period: { start_mm: 12, start_dd: 1, end_mm: 2, end_dd: 28 },
    });

    await runScheduler('2026-11-30');

    await goToKanban(page);
    await expect(page.getByText('period-wrap-outside-before')).not.toBeVisible();
  });
});

test.describe('完了後N日', () => {
  test('完了履歴がなければ初回に起票される', async ({ page, baseURL }) => {
    // Arrange: 完了後3日の完了駆動タスクを作成（完了履歴なし）
    await createTaskViaUI(page, baseURL!, {
      name: 'after-first',
      category: 'water',
      frequency_type: 'days_after_completion',
      frequency_interval: 3,
    });

    // Act: スケジューラを実行する
    await runScheduler('2026-03-14');

    // Assert: 未着手列に起票される
    await goToKanban(page);
    await expect(
      page.getByRole('region', { name: '未着手列' }).getByText('after-first'),
    ).toHaveCount(1);
  });

  test('完了日から指定日数が経過するまでは再起票されない', async ({ page, baseURL }) => {
    // Arrange: 完了後3日のタスクを起票し、基準日に完了させる
    const base = '2026-03-14';
    await createTaskViaUI(page, baseURL!, {
      name: 'after-wait',
      category: 'water',
      frequency_type: 'days_after_completion',
      frequency_interval: 3,
    });
    await runScheduler(base);
    await completeInstanceOn(page, baseURL!, 'after-wait', base);

    // Act: 完了日から2日後（3日未満）にスケジューラを実行する
    await runScheduler(addDays(base, 2));

    // Assert: 未着手列に再起票されない
    await goToKanban(page);
    await expect(
      page.getByRole('region', { name: '未着手列' }).getByText('after-wait'),
    ).toHaveCount(0);
  });

  test('完了日から指定日数が経過すると再起票される', async ({ page, baseURL }) => {
    // Arrange: 完了後3日のタスクを起票し、基準日に完了させる
    const base = '2026-03-14';
    await createTaskViaUI(page, baseURL!, {
      name: 'after-recur',
      category: 'water',
      frequency_type: 'days_after_completion',
      frequency_interval: 3,
    });
    await runScheduler(base);
    await completeInstanceOn(page, baseURL!, 'after-recur', base);

    // Act: 完了日からちょうど3日後にスケジューラを実行する
    await runScheduler(addDays(base, 3));

    // Assert: 未着手列に再起票される
    await goToKanban(page);
    await expect(
      page.getByRole('region', { name: '未着手列' }).getByText('after-recur'),
    ).toHaveCount(1);
  });

  test('未完了のまま指定日数が経過しても重複起票されない', async ({ page, baseURL }) => {
    // Arrange: 完了後3日のタスクを起票する（完了させない）
    const base = '2026-03-14';
    await createTaskViaUI(page, baseURL!, {
      name: 'after-open',
      category: 'water',
      frequency_type: 'days_after_completion',
      frequency_interval: 3,
    });
    await runScheduler(base);

    // Act: 完了させないまま日数が経過した状態でスケジューラを実行する
    await runScheduler(addDays(base, 5));

    // Assert: 重複起票されず1件のまま
    await goToKanban(page);
    await expect(page.getByText('after-open')).toHaveCount(1);
  });
});
