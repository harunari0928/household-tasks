import { test, expect } from './fixtures/setup.js';
import { createGarbageTaskDef } from './fixtures/garbage.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Page } from '@playwright/test';

const execAsync = promisify(exec);

/**
 * ごみ収集カレンダー連動のテスト。
 *
 * 2026-08 の実際の収集日を基準にしている。
 * 第N週が絡む種類は「第1・第3」「第2・第4」の両方の週を確認する。
 *
 * ごみは収集日の当日朝に出すので、scheduler に渡す日付は収集日そのもの。
 * タスク名に出る種類は「その日に収集されるもの」になる。
 * 例: 8/3(月)の朝に起票されるタスクは、同日収集の燃せるごみ。
 */

async function runScheduler(testToday: string): Promise<void> {
  await execAsync('node packages/scheduler/dist/index.js', {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_PATH: 'data/test_task_definitions.db',
      TEST_TODAY: testToday,
      TEST_HOUR: '6',
    },
    encoding: 'utf-8',
    timeout: 15000,
  });
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
  // 収集日（＝起票日）と、その日に収集される種類＝タスク名に出る表記
  const COLLECTION_DAYS = [
    { date: '2026-08-03', collection: '月', label: '燃せるごみ' },
    { date: '2026-08-06', collection: '木', label: '燃せるごみ' },
    { date: '2026-08-05', collection: '水', label: 'トレー・プラスチック容器' },
    { date: '2026-08-04', collection: '第1火', label: 'かん類・びん類' },
    { date: '2026-08-18', collection: '第3火', label: 'かん類・びん類' },
    { date: '2026-08-11', collection: '第2火', label: 'ペットボトル' },
    { date: '2026-08-25', collection: '第4火', label: 'ペットボトル' },
    { date: '2026-08-07', collection: '第1金', label: '紙・布類' },
    { date: '2026-08-21', collection: '第3金', label: '紙・布類' },
    { date: '2026-08-14', collection: '第2金', label: '燃せないごみ' },
    { date: '2026-08-28', collection: '第4金', label: '特殊品（蛍光灯・スプレー缶・乾電池など）' },
  ];

  for (const { date, collection, label } of COLLECTION_DAYS) {
    test(`${collection}曜日(${date})の朝は当日収集の「${label}」のごみ捨てタスクが表示される`, async ({ page, baseURL }) => {
      // Arrange
      await createGarbageTaskDef(page, baseURL!);

      // Act
      await runScheduler(date);

      // Assert
      await goToKanban(page);
      await expect(page.getByText(`ゴミ捨て（${label}）`)).toBeVisible();
    });
  }

  // 収集が無い日は出す必要がない
  const NO_DISPOSAL_DAYS = [
    { date: '2026-08-08', reason: '土曜日' },
    { date: '2026-08-09', reason: '日曜日' },
    { date: '2026-01-01', reason: '年末年始' },
    { date: '2026-12-31', reason: '年末年始' },
  ];

  for (const { date, reason } of NO_DISPOSAL_DAYS) {
    test(`収集が無い${reason}(${date})はごみ捨てタスクが表示されない`, async ({ page, baseURL }) => {
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
  test('種類のチェックを外すと、その種類を出す日にごみ捨てタスクが表示されなくなる', async ({ page, baseURL }) => {
    // Arrange
    await createGarbageTaskDef(page, baseURL!);
    await goToGarbageSettings(page);

    // Act
    await garbageCheckbox(page, 'ペットボトル').uncheck();

    // Assert
    await runScheduler('2026-08-11'); // 8/11(第2火)がペットボトルの日
    await goToKanban(page);
    await expect(page.getByText(/^ゴミ捨て/)).not.toBeVisible();
  });

  test('チェックを付けている種類を出す日にはごみ捨てタスクが表示される', async ({ page, baseURL }) => {
    // Arrange
    await createGarbageTaskDef(page, baseURL!);
    await goToGarbageSettings(page);

    // Act
    await garbageCheckbox(page, 'ペットボトル').uncheck();

    // Assert
    await runScheduler('2026-08-04'); // 8/4(第1火)は同じ火曜でも、かん類・びん類の日
    await goToKanban(page);
    await expect(page.getByText('ゴミ捨て（かん類・びん類）')).toBeVisible();
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
    await expect(page.getByRole('region', { name: 'ごみ収集' }).getByText(/次にごみを出す日/)).toBeVisible();
  });
});
