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

type SickDayBehavior = 'normal_only' | 'always' | 'sick_only';

async function createTaskDef(
  page: Page,
  baseURL: string,
  options: {
    name: string;
    category?: string;
    sick_day_behavior?: SickDayBehavior;
    scheduled_hour?: number;
    withInstance?: boolean;
  },
) {
  const res = await page.request.post(`${baseURL}/api/tasks`, {
    data: {
      name: options.name,
      category: options.category ?? 'floor',
      frequency_type: 'daily',
      scheduled_hour: options.scheduled_hour ?? 0,
      sick_day_behavior: options.sick_day_behavior ?? 'normal_only',
    },
  });
  const def = await res.json();
  if (options.withInstance) {
    await page.request.post(`${baseURL}/api/kanban/create-from-definition/${def.id}`);
  }
  return def;
}

async function setupAssignees(page: Page, baseURL: string) {
  await page.request.put(`${baseURL}/api/kanban/assignees`, {
    data: { assignees: ['テストユーザー'] },
  });
}

async function goToKanban(page: Page) {
  await page.goto('/#/');
  await page.getByText('未着手').waitFor();
}

function sickModeOnButton(page: Page) {
  return page.getByRole('button', { name: '子ども風邪の日モードにする' });
}

function sickModeOffButton(page: Page) {
  return page.getByRole('button', { name: '子ども風邪の日モードを解除' });
}

function sickModeBanner(page: Page) {
  return page.getByText('子ども風邪の日モード中');
}

test.describe('子ども風邪の日モード', () => {
  test('モードをONにすると風邪の日のみ表示タスクが起票され、通常時のみのタスクが非表示になる', async ({ page, baseURL }) => {
    // Arrange
    await setupAssignees(page, baseURL!);
    await createTaskDef(page, baseURL!, { name: '床のモップ掛け', sick_day_behavior: 'normal_only', withInstance: true });
    await createTaskDef(page, baseURL!, { name: 'ゴミ捨て', category: 'trash', sick_day_behavior: 'always', withInstance: true });
    await createTaskDef(page, baseURL!, { name: '薬を飲ませる', category: 'childcare', sick_day_behavior: 'sick_only' });
    await goToKanban(page);

    // Act
    await sickModeOnButton(page).click();

    // Assert
    await test.step('風邪の日のみ表示タスクが起票されて表示される', async () => {
      await expect(page.getByText('薬を飲ませる')).toBeVisible();
    });
    await test.step('通常時のみのタスクは非表示になる', async () => {
      await expect(page.getByText('床のモップ掛け')).not.toBeVisible();
    });
    await test.step('常に表示のタスクは表示されたまま', async () => {
      await expect(page.getByText('ゴミ捨て')).toBeVisible();
    });
  });

  test('モードをOFFに戻すと通常タスクが再表示され、風邪の日のみ表示タスクは非表示になる', async ({ page, baseURL }) => {
    // Arrange
    await setupAssignees(page, baseURL!);
    await createTaskDef(page, baseURL!, { name: '床のモップ掛け', sick_day_behavior: 'normal_only', withInstance: true });
    await createTaskDef(page, baseURL!, { name: 'ゴミ捨て', category: 'trash', sick_day_behavior: 'always', withInstance: true });
    await createTaskDef(page, baseURL!, { name: '薬を飲ませる', category: 'childcare', sick_day_behavior: 'sick_only' });
    await goToKanban(page);
    await sickModeOnButton(page).click();
    await page.getByText('薬を飲ませる').waitFor();

    // Act
    await sickModeOffButton(page).click();

    // Assert
    await test.step('通常タスクが再表示される', async () => {
      await expect(page.getByText('床のモップ掛け')).toBeVisible();
    });
    await test.step('風邪の日のみ表示タスクは非表示になる', async () => {
      await expect(page.getByText('薬を飲ませる')).not.toBeVisible();
    });
    await test.step('常に表示のタスクは表示されたまま', async () => {
      await expect(page.getByText('ゴミ捨て')).toBeVisible();
    });
  });

  test('モードON中はヘッダーに緊急バナーが表示され、OFFにすると消える', async ({ page, baseURL }) => {
    // Arrange
    await setupAssignees(page, baseURL!);
    await goToKanban(page);

    // Act
    await sickModeOnButton(page).click();

    // Assert
    await test.step('赤い緊急バナーが表示される', async () => {
      await expect(sickModeBanner(page)).toBeVisible();
    });

    // Act
    await sickModeOffButton(page).click();

    // Assert
    await test.step('バナーが消える', async () => {
      await expect(sickModeBanner(page)).not.toBeVisible();
    });
  });

  test('別のタブでモードをONにすると、開いているカンバン画面にも即時反映される', async ({ page, context, baseURL }) => {
    // Arrange
    await setupAssignees(page, baseURL!);
    await createTaskDef(page, baseURL!, { name: '薬を飲ませる', category: 'childcare', sick_day_behavior: 'sick_only' });
    await goToKanban(page);
    const otherPage = await context.newPage();
    await otherPage.goto('/#/');
    await otherPage.getByText('未着手').waitFor();

    // Act: 別タブでモードON
    await sickModeOnButton(otherPage).click();

    // Assert: 元のタブにSSEで反映される
    await test.step('元のタブにも緊急バナーが表示される', async () => {
      await expect(sickModeBanner(page)).toBeVisible();
    });
    await test.step('元のタブにも風邪の日のみ表示タスクが表示される', async () => {
      await expect(page.getByText('薬を飲ませる')).toBeVisible();
    });
  });

  test('タスク追加フォームで「風邪の日のみ表示」を選択して保存すると、一覧にバッジが表示される', async ({ page, baseURL }) => {
    // Arrange
    await setupAssignees(page, baseURL!);
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /育児タスク/ }).click();
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    // Act
    await page.getByLabel('タスク名').fill('病院の予約');
    await page.getByLabel('カテゴリ').selectOption('childcare');
    await page.getByLabel('風邪の日の扱い').selectOption('sick_only');
    await page.getByRole('button', { name: '保存' }).click();

    // Assert
    await test.step('タスク一覧に「風邪の日のみ」バッジが表示される', async () => {
      await expect(page.getByText('風邪の日のみ')).toBeVisible();
    });
  });

  test('タスク編集フォームで風邪の日の扱いを変更すると保存後に反映される', async ({ page, baseURL }) => {
    // Arrange
    await setupAssignees(page, baseURL!);
    await createTaskDef(page, baseURL!, { name: 'ゴミ捨て', category: 'trash', sick_day_behavior: 'normal_only' });
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /ごみ関連/ }).click();
    await page.getByText('ゴミ捨て').click();

    // Act
    await page.getByLabel('風邪の日の扱い').selectOption('always');
    await page.getByRole('button', { name: '保存' }).click();

    // Assert
    await test.step('タスク一覧に「常に表示」バッジが表示される', async () => {
      await expect(page.getByText('常に表示')).toBeVisible();
    });
  });

  test('モードON中にスケジューラを実行すると、風邪の日のみ表示タスクが起票される', async ({ page, baseURL }) => {
    // Arrange: 定義作成前にモードON（即時起票を発生させず、スケジューラによる起票だけを観察する）
    await setupAssignees(page, baseURL!);
    await page.request.put(`${baseURL}/api/sick-mode`, { data: { enabled: true } });
    await createTaskDef(page, baseURL!, { name: '薬を飲ませる', category: 'childcare', sick_day_behavior: 'sick_only' });

    // Act
    await runScheduler(getTodayJST());

    // Assert
    await goToKanban(page);
    await expect(page.getByText('薬を飲ませる')).toBeVisible();
  });

  test('モードON中にスケジューラを実行しても、通常時のみタスクは起票されない', async ({ page, baseURL }) => {
    // Arrange
    await setupAssignees(page, baseURL!);
    await page.request.put(`${baseURL}/api/sick-mode`, { data: { enabled: true } });
    await createTaskDef(page, baseURL!, { name: '床のモップ掛け', sick_day_behavior: 'normal_only' });

    // Act
    await runScheduler(getTodayJST());

    // Assert: モードを解除しても表示されない = スケジューラが起票していない
    await page.request.put(`${baseURL}/api/sick-mode`, { data: { enabled: false } });
    await goToKanban(page);
    await expect(page.getByText('床のモップ掛け')).not.toBeVisible();
  });

  test('モードON時、起票時刻がまだ来ていない風邪の日のみ表示タスクは起票されない', async ({ page, baseURL }) => {
    // Arrange: サーバー時刻を10:00 JSTに固定し、起票時刻が朝8時と夜19時のタスクを用意
    await setupAssignees(page, baseURL!);
    await page.request.post(`${baseURL}/api/test/set-time`, {
      data: { time: '2026-07-14T01:00:00.000Z' },
    });
    await createTaskDef(page, baseURL!, {
      name: '薬を飲ませる（朝）', category: 'childcare', sick_day_behavior: 'sick_only', scheduled_hour: 8,
    });
    await createTaskDef(page, baseURL!, {
      name: '薬を飲ませる（夜）', category: 'childcare', sick_day_behavior: 'sick_only', scheduled_hour: 19,
    });
    await goToKanban(page);

    // Act
    await sickModeOnButton(page).click();

    // Assert
    await test.step('起票時刻が到来している朝のタスクは起票される', async () => {
      await expect(page.getByText('薬を飲ませる（朝）')).toBeVisible();
    });
    await test.step('起票時刻が来ていない夜のタスクは起票されない', async () => {
      await expect(page.getByText('薬を飲ませる（夜）')).not.toBeVisible();
    });
  });

  test('モード切替APIが失敗した場合はエラーが表示され、モードは切り替わらない', async ({ page, baseURL }) => {
    // Arrange
    await setupAssignees(page, baseURL!);
    await goToKanban(page);
    await page.route('**/api/sick-mode', (route) =>
      route.request().method() === 'PUT' ? route.abort() : route.continue(),
    );

    // Act
    await sickModeOnButton(page).click();

    // Assert
    await test.step('エラートーストが表示される', async () => {
      await expect(page.getByRole('alert').getByText('風邪の日モードの切り替えに失敗しました')).toBeVisible();
    });
    await test.step('モードはOFFのまま（バナーが表示されない）', async () => {
      await expect(sickModeBanner(page)).not.toBeVisible();
    });
  });
});
