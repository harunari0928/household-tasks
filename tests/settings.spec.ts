import { test, expect } from './fixtures/setup.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Page } from '@playwright/test';

const execAsync = promisify(exec);

async function createTaskViaUI(page: Page, options: { name: string; frequency_type: string }) {
  await page.goto('/#/tasks');
  await page.getByRole('button', { name: /水回り/ }).click();
  await page.getByRole('button', { name: /タスクを追加/ }).click();
  await page.getByLabel('タスク名').fill(options.name);
  await page.getByLabel('頻度').selectOption(options.frequency_type);
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByText(options.name).waitFor();
}

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

function assigneeDialog(page: Page) {
  return page.getByRole('dialog', { name: '担当者を選択' });
}

async function goToSettings(page: Page) {
  await page.goto('/#/settings');
  await page.getByText('登録ユーザー').waitFor();
}

async function goToKanban(page: Page) {
  await page.goto('about:blank');
  await page.goto('/#/');
  await page.getByText('未着手').waitFor();
}

test.describe('設定画面のユーザー管理', () => {
  test('ユーザーを追加すると、カンバンボードのヘッダーで選択可能になる', async ({ page }) => {
    // Arrange
    await goToSettings(page);

    // Act
    await page.getByLabel('新しいユーザー名').fill('テスト太郎');
    await page.getByRole('button', { name: '追加' }).click();
    await expect(page.getByText('テスト太郎')).toBeVisible();
    await goToKanban(page);
    await page.getByLabel('ユーザー切替').click();

    // Assert
    await test.step('追加したユーザーがヘッダーのユーザー切替に表示される', async () => {
      await expect(page.locator('.absolute').getByText('テスト太郎')).toBeVisible();
    });
  });

  test('ユーザーを追加すると、カンバンボードのタスク担当者選択で選択可能になる', async ({ page }) => {
    // Arrange
    await goToSettings(page);
    await page.getByLabel('新しいユーザー名').fill('テスト花子');
    await page.getByRole('button', { name: '追加' }).click();
    await expect(page.getByText('テスト花子')).toBeVisible();
    await createTaskViaUI(page, { name: 'settings-assign-test', frequency_type: 'daily' });
    await runScheduler('2026-03-29');

    // Act
    await goToKanban(page);
    await page.getByRole('button', { name: '未割当', exact: true }).click();

    // Assert
    await test.step('追加したユーザーが担当者選択ダイアログに表示される', async () => {
      await expect(assigneeDialog(page).getByRole('checkbox', { name: 'テスト花子' })).toBeVisible();
    });
  });

  test('ユーザーを削除すると、設定画面から消える', async ({ page }) => {
    // Arrange
    await goToSettings(page);
    await page.getByLabel('新しいユーザー名').fill('削除対象');
    await page.getByRole('button', { name: '追加' }).click();
    await expect(page.getByText('削除対象')).toBeVisible();

    // Act
    await page.getByLabel('削除対象を削除').click();

    // Assert
    await test.step('削除したユーザーが設定画面から消える', async () => {
      await expect(page.getByText('削除対象')).not.toBeVisible();
    });
  });
});
