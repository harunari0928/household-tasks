import { test, expect } from './fixtures/setup.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Page } from '@playwright/test';

const execAsync = promisify(exec);

function getTodayJST(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

async function runScheduler(testToday: string): Promise<string> {
  const { stdout, stderr } = await execAsync('node packages/scheduler/dist/index.js', {
    cwd: process.cwd(),
    env: {
      ...(process.env as Record<string, string>),
      DB_PATH: 'data/test_task_definitions.db',
      TEST_TODAY: testToday,
    },
    encoding: 'utf-8',
    timeout: 15000,
  });
  if (stderr) console.error('Scheduler stderr:', stderr);
  return stdout;
}

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

/** タスク管理画面を開いて「タスクを追加」フォームまで進める */
async function openNewTaskForm(page: Page) {
  await page.goto('/#/tasks');
  await page.getByRole('button', { name: /生活・その他/ }).click();
  await page.getByRole('button', { name: /タスクを追加/ }).click();
  await page.getByLabel('カテゴリ').selectOption('lifestyle');
}

/** 毎日の個人タスクをタスク管理画面から登録する */
async function createDailyPersonalTask(page: Page, name: string, owner: string) {
  await openNewTaskForm(page);
  await page.getByLabel('タスク名').fill(name);
  await page.getByLabel('種類').selectOption({ label: `個人（${owner}）` });
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByText(name, { exact: true }).waitFor();
}

async function goToKanban(page: Page) {
  await page.goto('/#/');
  await page.getByText('未着手').waitFor();
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
  test('タスク管理画面で登録した個人タスクは所有者のカンバンにだけ起票される', async ({ page }) => {
    await registerUsers(page);
    await createDailyPersonalTask(page, '太郎の通院', '個人太郎');

    await test.step('タスク一覧に所有者のバッジが出る', async () => {
      await expect(page.getByText('👤 個人（個人太郎）')).toBeVisible();
    });

    await runScheduler(getTodayJST());

    await goToKanban(page);
    await selectUser(page, '個人太郎');

    await test.step('個人太郎のカンバンに個人タスクとして表示される', async () => {
      await expect(page.getByText('太郎の通院', { exact: true })).toBeVisible();
      await expect(page.getByLabel('個人タスク')).toBeVisible();
    });

    await selectUser(page, '個人花子');

    await test.step('個人花子のカンバンには表示されない', async () => {
      await expect(page.getByText('太郎の通院', { exact: true })).toBeHidden();
    });
  });

  test('個人タスクを完了してもポイント集計に加わらない', async ({ page }) => {
    await registerUsers(page);
    await createDailyPersonalTask(page, '太郎の読書', '個人太郎');
    await runScheduler(getTodayJST());

    await goToKanban(page);
    await selectUser(page, '個人太郎');
    await moveCardToDone(page, '太郎の読書');
    await page.getByRole('region', { name: '完了列' }).getByText('太郎の読書', { exact: true }).waitFor();

    await page.goto('/#/stats');

    await test.step('完了してもポイント比較に含まれない', async () => {
      await expect(page.getByText('この期間の完了タスクはありません')).toBeVisible();
    });
  });

  test('種類を個人にするとポイント欄が消え、共有に戻すと再び出る', async ({ page }) => {
    await registerUsers(page);
    await openNewTaskForm(page);

    await expect(page.getByLabel('ポイント')).toBeVisible();

    await page.getByLabel('種類').selectOption({ label: '個人（個人花子）' });
    await expect(page.getByLabel('ポイント')).toBeHidden();

    await page.getByLabel('種類').selectOption({ label: '共有（家族みんなのタスク）' });
    await expect(page.getByLabel('ポイント')).toBeVisible();
  });

  test('編集フォームを開き直しても個人の所有者が保持される', async ({ page }) => {
    await registerUsers(page);
    await createDailyPersonalTask(page, '花子のストレッチ', '個人花子');

    await page.getByText('花子のストレッチ', { exact: true }).click();

    await expect(page.getByLabel('種類')).toHaveValue('個人花子');
    await expect(page.getByLabel('ポイント')).toBeHidden();
  });

  test('個人タスクの所有者になっているユーザーは削除できない', async ({ page }) => {
    await registerUsers(page);
    await createDailyPersonalTask(page, '太郎の筋トレ', '個人太郎');

    await page.goto('/#/settings');
    await page.getByRole('button', { name: '個人太郎を削除' }).click();

    await test.step('エラーが表示され、ユーザーは残る', async () => {
      await expect(page.getByText(/個人タスクが残っているため「個人太郎」は削除できません/)).toBeVisible();
      await expect(page.getByRole('button', { name: '個人太郎を削除' })).toBeVisible();
    });
  });
});
