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
 * ごみは前夜に出すので、scheduler に渡す日付は「出す日」であり、
 * タスク名に出る種類は「その翌日に収集されるもの」になる。
 * 例: 8/9(日)に起票されるタスクは、8/10(月)収集の燃せるごみ。
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
  // 出す日（前夜）と、その翌日に収集される種類＝タスク名に出る表記
  const DISPOSAL_DAYS = [
    { date: '2026-08-02', weekday: '日', collection: '月', label: '燃せるごみ' },
    { date: '2026-08-05', weekday: '水', collection: '木', label: '燃せるごみ' },
    { date: '2026-08-04', weekday: '火', collection: '水', label: 'トレー・プラスチック容器' },
    { date: '2026-08-03', weekday: '月', collection: '第1火', label: 'かん類・びん類' },
    { date: '2026-08-17', weekday: '月', collection: '第3火', label: 'かん類・びん類' },
    { date: '2026-08-10', weekday: '月', collection: '第2火', label: 'ペットボトル' },
    { date: '2026-08-24', weekday: '月', collection: '第4火', label: 'ペットボトル' },
    { date: '2026-08-06', weekday: '木', collection: '第1金', label: '紙・布類' },
    { date: '2026-08-20', weekday: '木', collection: '第3金', label: '紙・布類' },
    { date: '2026-08-13', weekday: '木', collection: '第2金', label: '燃せないごみ' },
    { date: '2026-08-27', weekday: '木', collection: '第4金', label: '特殊品（蛍光灯・スプレー缶・乾電池など）' },
  ];

  for (const { date, weekday, collection, label } of DISPOSAL_DAYS) {
    test(`${weekday}曜日(${date})の夜は翌${collection}曜日収集の「${label}」のごみ捨てタスクが表示される`, async ({ page, baseURL }) => {
      // Arrange
      await createGarbageTaskDef(page, baseURL!);

      // Act
      await runScheduler(date);

      // Assert
      await goToKanban(page);
      await expect(page.getByText(`ゴミ捨て（${label}）`)).toBeVisible();
    });
  }

  // 翌日に収集が無い日は出す必要がない
  const NO_DISPOSAL_DAYS = [
    { date: '2026-08-07', reason: '翌日が土曜日' },
    { date: '2026-08-08', reason: '翌日が日曜日' },
    { date: '2025-12-31', reason: '翌日が年末年始' },
    { date: '2026-12-30', reason: '翌日が年末年始' },
  ];

  for (const { date, reason } of NO_DISPOSAL_DAYS) {
    test(`${reason}の日(${date})はごみ捨てタスクが表示されない`, async ({ page, baseURL }) => {
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
    await runScheduler('2026-08-10'); // 翌8/11(火)がペットボトルの日
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
    await runScheduler('2026-08-03'); // 翌8/4(火)は同じ火曜でも、かん類・びん類の日
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
