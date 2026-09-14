import { test, expect } from './fixtures/setup.js';
import type { Page } from '@playwright/test';

async function registerUsers(page: Page) {
  await page.goto('/#/settings');
  const nameInput = page.getByLabel('新しいユーザー名');
  const addButton = page.getByRole('button', { name: '追加', exact: true });

  await nameInput.fill('個人太郎');
  await addButton.click();
  await page.getByText('個人太郎', { exact: true }).waitFor();

  await nameInput.fill('個人花子');
  await addButton.click();
  await page.getByText('個人花子', { exact: true }).waitFor();
}

async function selectUser(page: Page, name: string) {
  await page.getByLabel('ユーザー切替').click();
  await page.getByRole('button', { name, exact: true }).click();
}

async function createPersonalTask(page: Page, title: string) {
  await page.getByLabel('個人タスク名').fill(title);
  await page.getByRole('button', { name: '個人タスクを追加', exact: true }).click();
  await page.getByText(title, { exact: true }).waitFor();
}

async function moveCardToDone(page: Page, title: string) {
  const card = page.getByText(title, { exact: true });
  const doneHeading = page.getByRole('heading', { name: '完了' });
  const cardBox = await card.boundingBox();
  const doneBox = await doneHeading.boundingBox();
  if (!cardBox || !doneBox) throw new Error('Could not position personal task card');

  await page.mouse.move(cardBox.x + 10, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + 18, cardBox.y + cardBox.height / 2, { steps: 2 });
  await page.mouse.move(doneBox.x + doneBox.width / 2, doneBox.y + doneBox.height + 40, { steps: 10 });
  await page.mouse.up();
}

test.describe('個人タスク', () => {
  test('選択中のユーザーだけが個人タスクを閲覧できる', async ({ page }) => {
    await registerUsers(page);
    await page.goto('/#/');
    await page.getByText('未着手').waitFor();

    await createPersonalTask(page, '太郎だけの買い物');

    await test.step('個人太郎のカンバンにだけ表示される', async () => {
      await expect(page.getByText('太郎だけの買い物', { exact: true })).toBeVisible();
      await expect(page.getByText('個人', { exact: true })).toBeVisible();
    });

    await selectUser(page, '個人花子');

    await test.step('個人花子のカンバンには表示されない', async () => {
      await expect(page.getByText('太郎だけの買い物', { exact: true })).toBeHidden();
    });
  });

  test('個人タスクの完了はポイント集計に加わらない', async ({ page }) => {
    await registerUsers(page);
    await page.goto('/#/');
    await page.getByText('未着手').waitFor();

    await createPersonalTask(page, '太郎の読書');
    await moveCardToDone(page, '太郎の読書');
    await page.getByRole('region', { name: '完了列' }).getByText('太郎の読書', { exact: true }).waitFor();

    await page.goto('/#/stats');

    await test.step('完了してもポイント比較に含まれない', async () => {
      await expect(page.getByText('この期間の完了タスクはありません')).toBeVisible();
    });
  });
});
