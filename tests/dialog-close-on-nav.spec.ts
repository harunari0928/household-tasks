import { test, expect } from './fixtures/setup.js';

test.describe('画面遷移時のダイアログ自動クローズ', () => {
  test('タスク追加ダイアログを開いた状態で別画面へ遷移するとダイアログが閉じる', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByRole('dialog').waitFor({ state: 'visible' });

    await page.evaluate(() => {
      window.location.hash = '#/';
    });

    await test.step('遷移先のカンバン画面でダイアログが表示されていない', async () => {
      await expect(page.getByRole('dialog')).not.toBeVisible();
    });
  });

  test('ダイアログを開いた状態で他画面に遷移し元画面に戻ってもダイアログが復活しない', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByRole('dialog').waitFor({ state: 'visible' });

    await page.evaluate(() => {
      window.location.hash = '#/';
    });
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      window.location.hash = '#/tasks';
    });

    await test.step('戻ってきたタスク管理画面でダイアログが表示されていない', async () => {
      await expect(page.getByRole('dialog')).not.toBeVisible();
    });

    await test.step('タスク追加ボタンが再び操作可能', async () => {
      await expect(page.getByRole('button', { name: /タスクを追加/ })).toBeVisible();
    });
  });

  test('編集ダイアログを開いた状態で別画面へ遷移するとダイアログが閉じる', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('編集テスト用タスク');
    await page.getByLabel('頻度').selectOption('daily');
    await page.getByRole('button', { name: '保存' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });

    await page.getByText('編集テスト用タスク').click();
    await page.getByRole('dialog').waitFor({ state: 'visible' });

    await page.evaluate(() => {
      window.location.hash = '#/';
    });

    await test.step('遷移先のカンバン画面で編集ダイアログが表示されていない', async () => {
      await expect(page.getByRole('dialog')).not.toBeVisible();
    });
  });
});
