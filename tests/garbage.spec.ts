import { test, expect } from './fixtures/setup.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Page } from '@playwright/test';

const execAsync = promisify(exec);

/**
 * ごみ収集カレンダー連動のテスト。
 *
 * 2026-08 の実際の収集日を基準にしている。
 * 第N週が絡む種類は「第1・第3」「第2・第4」の両方の週を確認する。
 */

async function runScheduler(testToday: string): Promise<void> {
  await execAsync('node packages/scheduler/dist/index.js', {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_PATH: 'data/test_task_definitions.db',
      TEST_TODAY: testToday,
      TEST_HOUR: '19',
    },
    encoding: 'utf-8',
    timeout: 15000,
  });
}

/** ごみ捨てタスク定義を作る（毎日起票にして、収集日の判定だけが効くようにする） */
async function createGarbageTaskDef(page: Page, baseURL: string) {
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

async function goToKanban(page: Page) {
  await page.goto('/#/');
  await page.getByText('未着手').waitFor();
}

async function goToGarbageSettings(page: Page) {
  await page.goto('/#/settings');
  await page.getByRole('region', { name: 'ごみ収集' }).waitFor();
}

function garbageCheckbox(page: Page, label: string) {
  return page.getByRole('region', { name: 'ごみ収集' }).getByRole('checkbox', { name: label });
}

test.describe('ごみ収集日ごとのごみ捨てタスク', () => {
  // 種類ごとに、その種類が収集される日と、タスク名に出る表記
  const COLLECTION_DAYS = [
    { date: '2026-08-03', weekday: '月', label: '燃せるごみ' },
    { date: '2026-08-06', weekday: '木', label: '燃せるごみ' },
    { date: '2026-08-05', weekday: '水', label: 'トレー・プラスチック容器' },
    { date: '2026-08-04', weekday: '第1火', label: 'かん類・びん類' },
    { date: '2026-08-18', weekday: '第3火', label: 'かん類・びん類' },
    { date: '2026-08-11', weekday: '第2火', label: 'ペットボトル' },
    { date: '2026-08-25', weekday: '第4火', label: 'ペットボトル' },
    { date: '2026-08-07', weekday: '第1金', label: '紙・布類' },
    { date: '2026-08-21', weekday: '第3金', label: '紙・布類' },
    { date: '2026-08-14', weekday: '第2金', label: '燃せないごみ' },
    { date: '2026-08-28', weekday: '第4金', label: '特殊品（蛍光灯・スプレー缶・乾電池など）' },
  ];

  for (const { date, weekday, label } of COLLECTION_DAYS) {
    test(`${weekday}曜日(${date})は「${label}」のごみ捨てタスクが表示される`, async ({ page, baseURL }) => {
      // Arrange
      await createGarbageTaskDef(page, baseURL!);

      // Act
      await runScheduler(date);

      // Assert
      await goToKanban(page);
      await expect(page.getByText(`ゴミ捨て（${label}）`)).toBeVisible();
    });
  }

  // 収集が無い日
  const NO_COLLECTION_DAYS = [
    { date: '2026-08-08', reason: '土曜日' },
    { date: '2026-08-09', reason: '日曜日' },
    { date: '2026-01-01', reason: '年末年始' },
    { date: '2026-12-31', reason: '年末年始' },
  ];

  for (const { date, reason } of NO_COLLECTION_DAYS) {
    test(`${reason}(${date})はごみ捨てタスクが表示されない`, async ({ page, baseURL }) => {
      // Arrange
      await createGarbageTaskDef(page, baseURL!);

      // Act
      await runScheduler(date);

      // Assert
      await goToKanban(page);
      await expect(page.getByText(/^ゴミ捨て/)).not.toBeVisible();
    });
  }
});

test.describe('出すごみの種類の設定', () => {
  test('種類のチェックを外すと、その種類の収集日にごみ捨てタスクが表示されなくなる', async ({ page, baseURL }) => {
    // Arrange
    await createGarbageTaskDef(page, baseURL!);
    await goToGarbageSettings(page);

    // Act
    await garbageCheckbox(page, 'ペットボトル').uncheck();

    // Assert
    await runScheduler('2026-08-11'); // ペットボトルの日
    await goToKanban(page);
    await expect(page.getByText(/^ゴミ捨て/)).not.toBeVisible();
  });

  test('チェックを外していない種類の収集日にはごみ捨てタスクが表示される', async ({ page, baseURL }) => {
    // Arrange
    await createGarbageTaskDef(page, baseURL!);
    await goToGarbageSettings(page);

    // Act
    await garbageCheckbox(page, 'ペットボトル').uncheck();

    // Assert
    await runScheduler('2026-08-04'); // 同じ火曜でも、かん類・びん類の日
    await goToKanban(page);
    await expect(page.getByText('ゴミ捨て（かん類・びん類）')).toBeVisible();
  });

  test('外したチェックを戻すと、その種類の収集日にごみ捨てタスクが再び表示される', async ({ page, baseURL }) => {
    // Arrange
    await createGarbageTaskDef(page, baseURL!);
    await goToGarbageSettings(page);
    await garbageCheckbox(page, 'ペットボトル').uncheck();

    // Act
    await garbageCheckbox(page, 'ペットボトル').check();

    // Assert
    await runScheduler('2026-08-11');
    await goToKanban(page);
    await expect(page.getByText('ゴミ捨て（ペットボトル）')).toBeVisible();
  });

  test('設定した内容はページを開き直しても保持される', async ({ page, baseURL }) => {
    // Arrange
    await createGarbageTaskDef(page, baseURL!);
    await goToGarbageSettings(page);
    await garbageCheckbox(page, 'ペットボトル').uncheck();

    // Act
    await page.reload();
    await page.getByRole('region', { name: 'ごみ収集' }).waitFor();

    // Assert
    await expect(garbageCheckbox(page, 'ペットボトル')).not.toBeChecked();
  });

  test('次に出すごみの日と種類が表示される', async ({ page, baseURL }) => {
    // Arrange
    await createGarbageTaskDef(page, baseURL!);

    // Act
    await goToGarbageSettings(page);

    // Assert
    await expect(page.getByRole('region', { name: 'ごみ収集' }).getByText(/次回のごみ捨て/)).toBeVisible();
  });
});
