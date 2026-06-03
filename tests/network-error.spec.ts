import { test, expect } from './fixtures/setup.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Page, Route } from '@playwright/test';

const execAsync = promisify(exec);

// --- helpers -------------------------------------------------------------

async function createTaskViaUI(page: Page, name: string) {
  await page.goto('/#/tasks');
  await page.getByRole('button', { name: /水回り/ }).click();
  await page.getByRole('button', { name: /タスクを追加/ }).click();
  await page.getByLabel('タスク名').fill(name);
  await page.getByLabel('頻度').selectOption('daily');
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByText(name).waitFor();
}

async function runScheduler(testToday: string): Promise<void> {
  await execAsync('node packages/scheduler/dist/index.js', {
    cwd: process.cwd(),
    env: { ...process.env, DB_PATH: 'data/test_task_definitions.db', TEST_TODAY: testToday },
    encoding: 'utf-8',
    timeout: 15000,
  });
}

async function setupAssignees(page: Page, baseURL: string, assignees: string[]) {
  await page.request.put(`${baseURL}/api/kanban/assignees`, { data: { assignees } });
}

async function changeStatus(
  page: Page,
  baseURL: string,
  taskName: string,
  status: string,
  assignee?: string,
) {
  const res = await page.request.get(`${baseURL}/api/kanban`);
  const tasks = await res.json();
  const task = tasks.find((t: { title: string }) => t.title === taskName);
  if (!task) throw new Error(`Task "${taskName}" not found`);
  const body: Record<string, unknown> = { status };
  if (assignee) body.assignee = assignee;
  await page.request.patch(`${baseURL}/api/kanban/${task.id}/status`, { data: body });
}

async function goToKanban(page: Page) {
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

  await page.mouse.move(cardBox.x + 10, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + 20, cardBox.y + cardBox.height / 2, { steps: 2 });
  await page.mouse.move(headingBox.x + headingBox.width / 2, headingBox.y + headingBox.height + 40, {
    steps: 10,
  });
  await page.mouse.up();
}

async function dragCardWithinColumn(page: Page, cardName: string, targetCardName: string) {
  const card = page.getByText(cardName).first();
  const target = page.getByText(targetCardName).first();
  const cardBox = await card.boundingBox();
  const targetBox = await target.boundingBox();
  if (!cardBox || !targetBox) throw new Error('Could not get bounding boxes');

  await page.mouse.move(cardBox.x + 10, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + 20, cardBox.y + cardBox.height / 2, { steps: 2 });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y - 5, { steps: 10 });
  await page.mouse.up();
}

const todoColumn = (page: Page) => page.getByRole('region', { name: '未着手列' });
const doneColumn = (page: Page) => page.getByRole('region', { name: '完了列' });

/** A toast carrying the given text (the role="alert" notification). */
const toast = (page: Page, text: string) =>
  page.getByRole('alert').filter({ hasText: text }).first();

/** Abort only the requests matching `method` so other traffic still succeeds. */
function abortMethod(method: string) {
  return (route: Route) =>
    route.request().method() === method ? route.abort() : route.continue();
}

// --- Kanban board --------------------------------------------------------

test.describe('カンバンボード操作の通信エラー', () => {
  test('ステータス変更が通信エラーになると、カードが元の未着手列に戻り、エラーが通知される', async ({
    page,
    baseURL,
  }) => {
    await setupAssignees(page, baseURL!, ['MTMR']);
    await createTaskViaUI(page, 'status-card');
    await runScheduler('2026-03-29');
    await changeStatus(page, baseURL!, 'status-card', 'todo', 'MTMR');
    await goToKanban(page);

    await page.route('**/api/kanban/*/status', (route) => route.abort());
    await dragCardToColumn(page, 'status-card', '完了');

    await test.step('エラーが目立つ形で通知される', async () => {
      await expect(toast(page, 'タスクのステータス変更に失敗しました')).toBeVisible();
    });
    await test.step('カードが元の未着手列に戻る', async () => {
      await expect(todoColumn(page).getByText('status-card')).toBeVisible();
      await expect(doneColumn(page).getByText('status-card')).toBeHidden();
    });
    await test.step('通知は操作を妨げず、ボードは引き続き操作できる', async () => {
      await expect(page.getByRole('heading', { name: '未着手' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '完了' })).toBeVisible();
    });
  });

  test('ステータス変更失敗の通知から「再試行」すると、移動が反映される', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR']);
    await createTaskViaUI(page, 'retry-card');
    await runScheduler('2026-03-29');
    await changeStatus(page, baseURL!, 'retry-card', 'todo', 'MTMR');
    await goToKanban(page);

    // 最初の1回だけ失敗させ、再試行（2回目）は成功させる
    let statusCalls = 0;
    await page.route('**/api/kanban/*/status', (route) => {
      statusCalls += 1;
      return statusCalls === 1 ? route.abort() : route.continue();
    });
    await dragCardToColumn(page, 'retry-card', '完了');
    await expect(toast(page, 'タスクのステータス変更に失敗しました')).toBeVisible();

    await page.getByRole('alert').getByRole('button', { name: '再試行' }).click();

    await expect(doneColumn(page).getByText('retry-card')).toBeVisible();
  });

  test('エラー通知は✕ボタンで手動で閉じられる', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR']);
    await createTaskViaUI(page, 'dismiss-card');
    await runScheduler('2026-03-29');
    await changeStatus(page, baseURL!, 'dismiss-card', 'todo', 'MTMR');
    await goToKanban(page);

    await page.route('**/api/kanban/*/status', (route) => route.abort());
    await dragCardToColumn(page, 'dismiss-card', '完了');
    const alert = toast(page, 'タスクのステータス変更に失敗しました');
    await expect(alert).toBeVisible();

    await alert.getByRole('button', { name: '閉じる' }).click();

    await expect(alert).toBeHidden();
  });

  test('並び順の変更が通信エラーになると、元の並び順に戻り、エラーが通知される', async ({
    page,
    baseURL,
  }) => {
    await setupAssignees(page, baseURL!, ['MTMR']);
    await createTaskViaUI(page, 'order-a');
    await createTaskViaUI(page, 'order-b');
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await page.route('**/api/kanban/reorder', (route) => route.abort());
    await dragCardWithinColumn(page, 'order-b', 'order-a');

    await test.step('エラーが通知される', async () => {
      await expect(toast(page, '並び順の変更に失敗しました')).toBeVisible();
    });
    await test.step('元の並び順（order-a が order-b より上）に戻る', async () => {
      const text = await todoColumn(page).innerText();
      expect(text.indexOf('order-a')).toBeLessThan(text.indexOf('order-b'));
    });
  });

  test('担当者変更が通信エラーになると、担当者が未割当のまま戻り、エラーが通知される', async ({
    page,
    baseURL,
  }) => {
    await setupAssignees(page, baseURL!, ['MTMR', 'こばゆか']);
    await createTaskViaUI(page, 'assignee-card');
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await page.route('**/api/kanban/*/assignee', (route) => route.abort());
    await page.getByRole('button', { name: '未割当', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '担当者を選択' });
    await dialog.getByRole('checkbox', { name: 'こばゆか' }).check();
    await dialog.getByRole('button', { name: '確定' }).click();

    await test.step('エラーが通知される', async () => {
      await expect(toast(page, '担当者の変更に失敗しました')).toBeVisible();
    });
    await test.step('カードは未割当のまま', async () => {
      await expect(page.getByRole('button', { name: '未割当', exact: true })).toBeVisible();
    });
  });

  test('カードの削除が通信エラーになると、カードが復活し、エラーが通知される', async ({
    page,
    baseURL,
  }) => {
    await setupAssignees(page, baseURL!, ['MTMR']);
    await createTaskViaUI(page, 'delete-card');
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await page.route('**/api/kanban/*', abortMethod('DELETE'));
    await page.getByText('delete-card').hover();
    await page.getByLabel('タスクを削除').click();
    await page.getByRole('button', { name: '削除する' }).click();

    await test.step('エラーが通知される', async () => {
      await expect(toast(page, 'タスクの削除に失敗しました')).toBeVisible();
    });
    await test.step('削除されたカードが復活する', async () => {
      await expect(todoColumn(page).getByText('delete-card')).toBeVisible();
    });
  });

  test('列の一括削除が通信エラーになると、カードが復活し、エラーが通知される', async ({
    page,
    baseURL,
  }) => {
    await setupAssignees(page, baseURL!, ['MTMR']);
    await createTaskViaUI(page, 'clear-card');
    await runScheduler('2026-03-29');
    await goToKanban(page);

    // DELETE /api/kanban?status=todo を失敗させる
    await page.route(/\/api\/kanban\?status=/, abortMethod('DELETE'));
    await page.getByRole('button', { name: '未着手メニュー' }).click();
    await page.getByRole('button', { name: 'すべて削除' }).click();
    await page.getByRole('button', { name: '削除する' }).click();

    await test.step('エラーが通知される', async () => {
      await expect(toast(page, 'タスクの一括削除に失敗しました')).toBeVisible();
    });
    await test.step('削除されたカードが復活する', async () => {
      await expect(todoColumn(page).getByText('clear-card')).toBeVisible();
    });
  });

  test('ボードの読み込みが通信エラーになると、エラーが通知される', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR']);
    await page.route('**/api/kanban', abortMethod('GET'));

    await goToKanban(page);

    await expect(toast(page, 'タスクの取得に失敗しました')).toBeVisible();
  });
});

// --- Assignee management (settings) --------------------------------------

test.describe('担当者管理の通信エラー', () => {
  test('担当者の追加が通信エラーになると、追加が取り消され、エラーが通知される', async ({
    page,
    baseURL,
  }) => {
    await setupAssignees(page, baseURL!, ['MTMR']);
    await page.goto('/#/settings');
    await expect(page.getByText('登録ユーザー')).toBeVisible();

    await page.route('**/api/kanban/assignees', abortMethod('PUT'));
    await page.getByLabel('新しいユーザー名').fill('新メンバー');
    await page.getByRole('button', { name: '追加' }).click();

    await test.step('エラーが通知される', async () => {
      await expect(toast(page, '担当者の保存に失敗しました')).toBeVisible();
    });
    await test.step('追加した担当者は残らない', async () => {
      await expect(page.getByText('新メンバー')).toBeHidden();
    });
  });

  test('担当者の削除が通信エラーになると、削除が取り消され、エラーが通知される', async ({
    page,
    baseURL,
  }) => {
    await setupAssignees(page, baseURL!, ['MTMR', 'こばゆか']);
    await page.goto('/#/settings');
    await expect(page.getByRole('button', { name: 'MTMRを削除' })).toBeVisible();

    await page.route('**/api/kanban/assignees', abortMethod('PUT'));
    await page.getByRole('button', { name: 'MTMRを削除' }).click();

    await test.step('エラーが通知される', async () => {
      await expect(toast(page, '担当者の保存に失敗しました')).toBeVisible();
    });
    await test.step('削除した担当者が残る', async () => {
      await expect(page.getByRole('button', { name: 'MTMRを削除' })).toBeVisible();
    });
  });

  test('担当者一覧の取得が通信エラーになると、エラーが通知される', async ({ page }) => {
    await page.route('**/api/kanban/assignees', abortMethod('GET'));

    await page.goto('/#/settings');

    await expect(toast(page, '担当者の取得に失敗しました')).toBeVisible();
  });
});

// --- Task definitions ----------------------------------------------------

test.describe('タスク定義操作の通信エラー', () => {
  test('タスク一覧の取得が通信エラーになると、エラーが通知される', async ({ page }) => {
    await page.route('**/api/tasks', abortMethod('GET'));

    await page.goto('/#/tasks');

    await expect(toast(page, 'タスク一覧の取得に失敗しました')).toBeVisible();
  });

  test('有効/無効の切り替えが通信エラーになると、エラーが通知される', async ({ page }) => {
    await createTaskViaUI(page, 'toggle-task');

    await page.route('**/api/tasks/*/toggle', abortMethod('POST'));
    await page.getByRole('button', { name: '無効にする' }).first().click();

    await expect(toast(page, 'タスクの有効/無効の切り替えに失敗しました')).toBeVisible();
  });

  test('タスクの保存が通信エラーになると、エラーが通知される', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /水回り/ }).click();
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('save-fail-task');
    await page.getByLabel('頻度').selectOption('daily');

    await page.route('**/api/tasks', abortMethod('POST'));
    await page.getByRole('button', { name: '保存' }).click();

    await expect(toast(page, /保存に失敗しました/)).toBeVisible();
  });

  test('タスクの削除が通信エラーになると、エラーが通知される', async ({ page }) => {
    await createTaskViaUI(page, 'delete-def-task');
    await page.getByText('delete-def-task').click();

    await page.route('**/api/tasks/*', abortMethod('DELETE'));
    await page.getByRole('button', { name: '削除', exact: true }).click();
    await page.getByRole('button', { name: '削除する' }).click();

    await expect(toast(page, /削除に失敗しました/)).toBeVisible();
  });

  test('カンバンへの起票が通信エラーになると、エラーが通知される', async ({ page }) => {
    await createTaskViaUI(page, 'instance-task');
    await page.getByText('instance-task').click();

    await page.route('**/api/kanban/create-from-definition/*', abortMethod('POST'));
    await page.getByRole('button', { name: '今すぐカンバンに起票' }).click();

    await expect(toast(page, /起票に失敗しました/)).toBeVisible();
  });

  test('添付ファイルのアップロードが通信エラーになると、エラーが通知される', async ({ page }) => {
    await createTaskViaUI(page, 'upload-task');
    await page.getByText('upload-task').click();

    await page.route('**/api/tasks/*/attachments', abortMethod('POST'));
    await page.getByLabel('ファイル添付').setInputFiles({
      name: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    });

    await expect(toast(page, '添付ファイルのアップロードに失敗しました')).toBeVisible();
  });

  test('編集画面で添付一覧の取得が通信エラーになると、エラーが通知される', async ({ page }) => {
    await createTaskViaUI(page, 'attach-list-task');

    await page.route('**/api/tasks/*/attachments', abortMethod('GET'));
    await page.getByText('attach-list-task').click();

    await expect(toast(page, '添付ファイルの取得に失敗しました')).toBeVisible();
  });
});

// --- Task detail dialog --------------------------------------------------

test.describe('タスク詳細の通信エラー', () => {
  test('カード詳細の取得が通信エラーになると、エラーが通知される', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR']);
    await createTaskViaUI(page, 'detail-card');
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await page.route('**/api/tasks/*', abortMethod('GET'));
    await page.getByText('detail-card').click();

    await expect(toast(page, 'タスク詳細の取得に失敗しました')).toBeVisible();
  });
});

// --- Stats & settings ----------------------------------------------------

test.describe('ポイント集計・設定の通信エラー', () => {
  test('集計データの取得が通信エラーになると、画面内にエラーが表示される', async ({ page }) => {
    await page.route('**/api/stats/points**', abortMethod('GET'));

    await page.goto('/#/stats');

    await expect(page.getByText('データの取得に失敗しました')).toBeVisible();
  });

  test('期間設定の保存が通信エラーになると、エラーが通知される', async ({ page }) => {
    await page.goto('/#/stats');
    // 集計の読み込み完了を待ってから期間を変更する
    await page.getByLabel('開始日').waitFor();
    await page.getByLabel('開始日').fill('2026-01-01');

    await page.route('**/api/settings', abortMethod('PUT'));
    await page.getByRole('button', { name: 'みんなに保存' }).click();

    await expect(toast(page, '期間設定の保存に失敗しました')).toBeVisible();
  });
});
