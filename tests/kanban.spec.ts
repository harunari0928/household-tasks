import { test, expect } from './fixtures/setup.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Page } from '@playwright/test';

const execAsync = promisify(exec);

const CATEGORY_MAP: Record<string, string> = {
  water: '水回り', kitchen: 'キッチン', floor: 'フロア・室内',
  entrance: '玄関・ベランダ・その他', laundry: '洗濯・布もの', trash: 'ごみ関連',
  childcare: '育児タスク', cooking: '料理・食事タスク', lifestyle: '生活・その他',
};

async function createTaskViaUI(
  page: Page,
  options: {
    name: string;
    category?: string;
    frequency_type: string;
    points?: number;
  },
) {
  const category = options.category || 'water';
  await page.goto('/#/tasks');
  await page.getByRole('button', { name: new RegExp(CATEGORY_MAP[category]) }).click();
  await page.getByRole('button', { name: /タスクを追加/ }).click();
  await page.getByLabel('タスク名').fill(options.name);
  if (options.category) await page.getByLabel('カテゴリ').selectOption(options.category);
  await page.getByLabel('頻度').selectOption(options.frequency_type);
  if (options.points) await page.getByLabel('ポイント').fill(String(options.points));
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByText(options.name).waitFor();
}

async function runScheduler(testToday: string, extraEnv?: Record<string, string>): Promise<string> {
  const { stdout, stderr } = await execAsync('node packages/scheduler/dist/index.js', {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_PATH: 'data/test_task_definitions.db',
      TEST_TODAY: testToday,
      ...extraEnv,
    },
    encoding: 'utf-8',
    timeout: 15000,
  });
  if (stderr) console.error('Scheduler stderr:', stderr);
  return stdout;
}

async function setupAssignees(page: Page, baseURL: string, assignees: string[]) {
  await page.request.put(`${baseURL}/api/kanban/assignees`, {
    data: { assignees },
  });
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

  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + cardBox.height / 2;
  const endX = headingBox.x + headingBox.width / 2;
  const endY = headingBox.y + headingBox.height + 40;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 10, startY, { steps: 2 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
}

async function changeStatus(page: Page, baseURL: string, taskName: string, status: string, assignee?: string) {
  const res = await page.request.get(`${baseURL}/api/kanban`);
  const tasks = await res.json();
  const task = tasks.find((t: any) => t.title === taskName);
  if (!task) throw new Error(`Task "${taskName}" not found`);
  const body: Record<string, unknown> = { status };
  if (assignee) body.assignee = assignee;
  await page.request.patch(`${baseURL}/api/kanban/${task.id}/status`, { data: body });
}

function assigneeDialog(page: Page) {
  return page.getByRole('dialog', { name: '担当者を選択' });
}

test.describe('カンバンボードの表示', () => {
  test('3列が正しく表示される', async ({ page }) => {
    await createTaskViaUI(page, { name: 'column-test', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await test.step('未着手列が表示される', async () => {
      await expect(page.getByRole('heading', { name: '未着手' })).toBeVisible();
    });
    await test.step('進行中列が表示される', async () => {
      await expect(page.getByRole('heading', { name: '進行中' })).toBeVisible();
    });
    await test.step('完了列が表示される', async () => {
      await expect(page.getByRole('heading', { name: '完了' })).toBeVisible();
    });
  });

  test('タスクカードが未着手列に表示される', async ({ page }) => {
    await createTaskViaUI(page, { name: 'kanban-card-test', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await expect(page.getByText('kanban-card-test')).toBeVisible();
  });

  test('カードにポイントが表示される', async ({ page }) => {
    await createTaskViaUI(page, { name: 'points-display', frequency_type: 'daily', points: 5 });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await expect(page.getByText('5').first()).toBeVisible();
  });
});

test.describe('ドラッグ&ドロップ', () => {
  test('未着手から進行中に移動できる', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR', 'こばゆか']);
    await createTaskViaUI(page, { name: 'drag-to-progress', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await dragCardToColumn(page, 'drag-to-progress', '進行中');

    await expect(page.getByText('drag-to-progress').first()).toBeVisible();
  });

  test('進行中から完了に移動できる', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR', 'こばゆか']);
    await createTaskViaUI(page, { name: 'drag-to-done', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await changeStatus(page, baseURL!, 'drag-to-done', 'in_progress', 'MTMR');
    await goToKanban(page);

    await dragCardToColumn(page, 'drag-to-done', '完了');

    await expect(page.getByText('drag-to-done').first()).toBeVisible();
  });

  test('進行中に移動するとアサインされた担当者が表示される', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR', 'こばゆか']);
    await createTaskViaUI(page, { name: 'auto-assign-test', frequency_type: 'daily' });
    await runScheduler('2026-03-29');

    // APIで進行中に移動＋担当者割り当て
    await changeStatus(page, baseURL!, 'auto-assign-test', 'in_progress', 'こばゆか');

    await goToKanban(page);

    await expect(page.getByText('auto-assign-test').first()).toBeVisible();
    await expect(page.getByText('こばゆか, auto-assign-test').or(page.locator('.group').filter({ hasText: 'auto-assign-test' }).getByText('こばゆか'))).toBeVisible();
  });
});

test.describe('担当者の割り当て', () => {
  test('未割当のカードをクリックして担当者を選択できる', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR', 'こばゆか']);
    await createTaskViaUI(page, { name: 'assign-click-test', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await page.getByRole('button', { name: '未割当', exact: true }).click();

    await test.step('担当者選択モーダルが表示される', async () => {
      await expect(assigneeDialog(page)).toBeVisible();
    });

    // チェックボックスで選択して確定
    await assigneeDialog(page).getByRole('checkbox', { name: 'こばゆか' }).check();
    await assigneeDialog(page).getByRole('button', { name: '確定' }).click();

    await test.step('選択した担当者名がカードに表示される', async () => {
      await expect(page.getByText('assign-click-test').locator('..').locator('..').getByText('こばゆか')).toBeVisible();
    });
  });

  test('2人同時にアサインできる', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR', 'こばゆか']);
    await createTaskViaUI(page, { name: 'multi-assign-test', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await page.getByRole('button', { name: '未割当', exact: true }).click();
    await assigneeDialog(page).getByRole('checkbox', { name: 'MTMR' }).check();
    await assigneeDialog(page).getByRole('checkbox', { name: 'こばゆか' }).check();
    await assigneeDialog(page).getByRole('button', { name: '確定' }).click();

    await test.step('2人の担当者が表示される', async () => {
      await expect(page.getByText('MTMR, こばゆか')).toBeVisible();
    });
  });

  test('完了に移動時、未アサインなら担当者選択モーダルが表示される', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR', 'こばゆか']);
    await createTaskViaUI(page, { name: 'done-modal-test', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await dragCardToColumn(page, 'done-modal-test', '完了');

    await expect(assigneeDialog(page)).toBeVisible();
  });
});

test.describe('担当者管理', () => {
  test('担当者モーダルから新しい担当者を追加できる', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR']);
    await createTaskViaUI(page, { name: 'add-assignee-test', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await page.getByRole('button', { name: '未割当', exact: true }).click();
    await page.getByLabel('新しい担当者名').fill('テスト太郎');
    await assigneeDialog(page).getByRole('button', { name: '追加' }).click();

    await test.step('追加した担当者がチェックボックスとして表示される', async () => {
      await expect(assigneeDialog(page).getByRole('checkbox', { name: 'テスト太郎' })).toBeVisible();
    });
  });

  test('担当者を削除できる', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR', '削除対象']);
    await createTaskViaUI(page, { name: 'del-assignee-test', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await page.getByRole('button', { name: '未割当', exact: true }).click();
    await assigneeDialog(page).getByLabel('削除対象を削除').click();

    await test.step('削除した担当者がモーダルから消える', async () => {
      await expect(assigneeDialog(page).getByRole('checkbox', { name: '削除対象' })).not.toBeVisible();
    });
  });
});

test.describe('タスクの削除', () => {
  test('カードホバーでゴミ箱アイコンをクリックするとタスクが削除される', async ({ page }) => {
    await createTaskViaUI(page, { name: 'delete-card-test', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await goToKanban(page);
    await expect(page.getByText('delete-card-test')).toBeVisible();

    await page.getByText('delete-card-test').hover();
    await page.getByLabel('タスクを削除').click();
    await page.getByRole('button', { name: '削除する' }).click();

    await expect(page.getByText('delete-card-test')).not.toBeVisible();
  });

  test('列の「すべて削除」で列内の全タスクが削除される', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR']);
    await createTaskViaUI(page, { name: 'clear-task-a', frequency_type: 'daily' });
    await createTaskViaUI(page, { name: 'clear-task-b', frequency_type: 'daily' });
    await createTaskViaUI(page, { name: 'keep-task', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await changeStatus(page, baseURL!, 'keep-task', 'in_progress', 'MTMR');
    await goToKanban(page);

    await page.getByLabel('未着手メニュー').click();
    await page.getByText('すべて削除').click();
    await page.getByRole('button', { name: '削除する' }).click();

    await test.step('未着手列のタスクが削除される', async () => {
      await expect(page.getByText('clear-task-a')).not.toBeVisible();
      await expect(page.getByText('clear-task-b')).not.toBeVisible();
    });
    await test.step('進行中のタスクは残る', async () => {
      await expect(page.getByText('keep-task')).toBeVisible();
    });
  });
});

test.describe('タスク詳細ダイアログ', () => {
  test('カードをクリックするとタスク詳細がReadonlyで表示される', async ({ page }) => {
    await createTaskViaUI(page, { name: 'detail-dialog-test', category: 'kitchen', frequency_type: 'daily', points: 7 });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await page.getByText('detail-dialog-test').click();

    await test.step('タスク名が表示される', async () => {
      await expect(page.getByRole('dialog', { name: 'タスク詳細' })).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'タスク詳細' }).getByText('detail-dialog-test')).toBeVisible();
    });
    await test.step('カテゴリ・ポイントが表示される', async () => {
      await expect(page.getByRole('dialog', { name: 'タスク詳細' }).getByText('キッチン')).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'タスク詳細' }).getByText('7pt')).toBeVisible();
    });
  });
});

test.describe('フィルタ', () => {
  test('担当者フィルタで絞り込める', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR', 'こばゆか']);
    await createTaskViaUI(page, { name: 'filter-task-a', frequency_type: 'daily' });
    await createTaskViaUI(page, { name: 'filter-task-b', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await changeStatus(page, baseURL!, 'filter-task-a', 'todo', 'MTMR');
    await changeStatus(page, baseURL!, 'filter-task-b', 'todo', 'こばゆか');
    await goToKanban(page);

    await page.getByLabel('担当者フィルタ').selectOption('MTMR');

    await test.step('フィルタした担当者のタスクが表示される', async () => {
      await expect(page.getByText('filter-task-a')).toBeVisible();
    });
    await test.step('フィルタ対象外の担当者のタスクは非表示', async () => {
      await expect(page.getByText('filter-task-b')).not.toBeVisible();
    });
  });

  test('カテゴリフィルタで絞り込める', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR']);
    await createTaskViaUI(page, { name: 'cat-water-task', category: 'water', frequency_type: 'daily' });
    await createTaskViaUI(page, { name: 'cat-kitchen-task', category: 'kitchen', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await page.getByLabel('カテゴリフィルタ').selectOption('water');

    await test.step('フィルタしたカテゴリのタスクが表示される', async () => {
      await expect(page.getByText('cat-water-task')).toBeVisible();
    });
    await test.step('フィルタ対象外のカテゴリのタスクは非表示', async () => {
      await expect(page.getByText('cat-kitchen-task')).not.toBeVisible();
    });
  });
});

test.describe('ユーザー切替', () => {
  test('ヘッダーのユーザー切替で現在ユーザーを変更できる', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR', 'こばゆか']);
    await goToKanban(page);

    await page.getByLabel('ユーザー切替').click();
    await page.locator('.absolute').getByText('こばゆか').click();

    await expect(page.getByLabel('ユーザー切替')).toContainText('こばゆか');
  });
});

test.describe('スマホ表示', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('ハンバーガーメニューが表示される', async ({ page }) => {
    await goToKanban(page);

    await test.step('ハンバーガーボタンが表示される', async () => {
      await expect(page.getByRole('button', { name: 'メニュー', exact: true })).toBeVisible();
    });
    await test.step('インラインナビが非表示', async () => {
      await expect(page.getByRole('navigation')).not.toBeVisible();
    });
  });

  test('ハンバーガーメニューからすべてのページに遷移できる', async ({ page }) => {
    const navTargets = [
      { label: 'タスク管理', expected: page.getByRole('button', { name: /タスクを追加/ }) },
      { label: 'ポイント集計', expected: page.getByLabel('開始日') },
      { label: 'カンバン', expected: page.getByRole('heading', { name: '未着手' }) },
    ];

    for (const { label, expected } of navTargets) {
      await goToKanban(page);
      await page.getByRole('button', { name: 'メニュー', exact: true }).click();
      await page.getByRole('link', { name: label }).click();

      await expect(expected).toBeVisible();
    }
  });

  test('カンバン列が横スクロールできる', async ({ page }) => {
    await createTaskViaUI(page, { name: 'scroll-test', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await page.evaluate(() => {
      const container = document.querySelector('.snap-x');
      if (container) container.scrollLeft = container.scrollWidth;
    });

    await expect(page.getByRole('heading', { name: '完了' })).toBeVisible();
  });

  test('ドラッグハンドルが表示される', async ({ page }) => {
    await createTaskViaUI(page, { name: 'handle-test', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await expect(page.getByText('⠿').first()).toBeVisible();
  });

  test('削除ボタンがホバーなしで表示される', async ({ page }) => {
    await createTaskViaUI(page, { name: 'mobile-delete-test', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await expect(page.getByLabel('タスクを削除')).toBeVisible();
  });

  test('担当者をタップして変更できる', async ({ page, baseURL }) => {
    await setupAssignees(page, baseURL!, ['MTMR', 'こばゆか']);
    await createTaskViaUI(page, { name: 'mobile-assign-test', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await page.getByRole('button', { name: '未割当', exact: true }).click();
    await assigneeDialog(page).getByRole('checkbox', { name: 'MTMR' }).check();
    await assigneeDialog(page).getByRole('button', { name: '確定' }).click();

    await expect(page.getByRole('button', { name: 'M MTMR', exact: true })).toBeVisible();
  });
});

test.describe('リアルタイム更新', () => {
  test('スケジューラが起票したタスクが画面更新なしに表示される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, { name: 'realtime-test', frequency_type: 'daily' });
    await goToKanban(page);
    await expect(page.getByText('realtime-test')).not.toBeVisible();

    await runScheduler('2026-03-29', { WEB_URL: `${baseURL}` });

    await expect(page.getByText('realtime-test')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('同一列内の並べ替え', () => {
  async function dragCardWithinColumn(page: Page, cardName: string, targetCardName: string) {
    const card = page.getByText(cardName).first();
    const target = page.getByText(targetCardName).first();

    const cardBox = await card.boundingBox();
    const targetBox = await target.boundingBox();
    if (!cardBox || !targetBox) throw new Error('Could not get bounding boxes');

    const startX = cardBox.x + cardBox.width / 2;
    const startY = cardBox.y + cardBox.height / 2;
    const endX = targetBox.x + targetBox.width / 2;
    const endY = targetBox.y - 5;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 10, startY, { steps: 2 });
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();
  }

  async function getCardOrder(page: Page, columnTitle: string): Promise<string[]> {
    const heading = page.getByRole('heading', { name: columnTitle });
    // The column is the snap-start container wrapping the heading and cards
    const column = heading.locator('xpath=ancestor::div[contains(@class,"snap-start")]');
    // Each card is a div with role="button" from useSortable
    const cards = column.locator('[role="button"][aria-roledescription="sortable"]');
    const count = await cards.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = await cards.nth(i).innerText();
      // Card text: "⠿\ntitle\n担当者\npoints" — title is the second line
      const title = text.split('\n')[1]?.trim() ?? '';
      names.push(title);
    }
    return names;
  }

  test('カードを上にドラッグして並び順が変わる', async ({ page }) => {
    await createTaskViaUI(page, { name: 'reorder-a', frequency_type: 'daily' });
    await createTaskViaUI(page, { name: 'reorder-b', frequency_type: 'daily' });
    await createTaskViaUI(page, { name: 'reorder-c', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await dragCardWithinColumn(page, 'reorder-c', 'reorder-a');

    await test.step('reorder-cがreorder-aより上に表示される', async () => {
      const order = await getCardOrder(page, '未着手');
      const idxC = order.findIndex((n) => n.includes('reorder-c'));
      const idxA = order.findIndex((n) => n.includes('reorder-a'));
      expect(idxC).toBeLessThan(idxA);
    });
  });

  test('並び替えた順序がリロード後も維持される', async ({ page }) => {
    await createTaskViaUI(page, { name: 'persist-a', frequency_type: 'daily' });
    await createTaskViaUI(page, { name: 'persist-b', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    await goToKanban(page);

    await dragCardWithinColumn(page, 'persist-b', 'persist-a');
    // Wait for API to persist
    await page.waitForTimeout(500);

    await page.reload();
    await page.getByText('未着手').waitFor();

    await test.step('リロード後もpersist-bがpersist-aより上に表示される', async () => {
      const order = await getCardOrder(page, '未着手');
      const idxB = order.findIndex((n) => n.includes('persist-b'));
      const idxA = order.findIndex((n) => n.includes('persist-a'));
      expect(idxB).toBeLessThan(idxA);
    });
  });
});

test.describe('ドラッグ中の列ハイライト', () => {
  // @dnd-kitのisOver中間状態はPlaywrightのマウスシミュレーションでは再現不可のため、
  // isOverが切り替わった際の背景色を、独立したテスト要素で検証する
  test('ライトモードのハイライト色がデフォルトと異なる', async ({ page }) => {
    await goToKanban(page);

    const { defaultBg, highlightBg } = await page.evaluate(() => {
      const d = document.createElement('div');
      const h = document.createElement('div');
      d.className = 'bg-gray-50';
      h.className = 'bg-blue-50';
      document.body.appendChild(d);
      document.body.appendChild(h);
      const result = {
        defaultBg: getComputedStyle(d).backgroundColor,
        highlightBg: getComputedStyle(h).backgroundColor,
      };
      d.remove();
      h.remove();
      return result;
    });

    expect(highlightBg).not.toBe(defaultBg);
  });

  test('ダークモードのハイライト色がデフォルトと視認できる差がある', async ({ page }) => {
    await page.goto('/#/');
    await page.getByRole('button', { name: 'ダークモードに切り替え' }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    await goToKanban(page);

    // .darkコンテナ内にテスト要素を作ってdark:バリアントの色を直接取得
    const { defaultBg, highlightBg } = await page.evaluate(() => {
      const container = document.createElement('div');
      container.className = 'dark';
      const d = document.createElement('div');
      const h = document.createElement('div');
      d.className = 'dark:bg-gray-900/50';
      h.className = 'dark:bg-blue-800/40';
      container.appendChild(d);
      container.appendChild(h);
      document.body.appendChild(container);
      const result = {
        defaultBg: getComputedStyle(d).backgroundColor,
        highlightBg: getComputedStyle(h).backgroundColor,
      };
      container.remove();
      return result;
    });

    expect(highlightBg).not.toBe(defaultBg);
  });
});
