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

async function createTaskViaUI(
  page: Page,
  options: { name: string; category?: string; points?: number },
) {
  await page.goto('/#/tasks');
  const category = options.category || 'water';
  const CATEGORY_MAP: Record<string, string> = {
    water: '水回り', kitchen: 'キッチン', floor: 'フロア・室内',
  };
  await page.getByRole('button', { name: new RegExp(CATEGORY_MAP[category]) }).click();
  await page.getByRole('button', { name: /タスクを追加/ }).click();
  await page.getByLabel('タスク名').fill(options.name);
  await page.getByLabel('カテゴリ').selectOption(category);
  await page.getByLabel('頻度').selectOption('daily');
  if (options.points != null) {
    await page.getByLabel('ポイント').fill(String(options.points));
  }
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByText(options.name).waitFor();
}

async function setupStatsWithTasks(page: Page, baseURL: string) {
  // Register assignees
  await page.request.put(`${baseURL}/api/kanban/assignees`, {
    data: { assignees: ['taro', 'hanako'] },
  });

  // Create task definitions via UI
  await createTaskViaUI(page, { name: '洗面台掃除', category: 'water', points: 3 });
  await createTaskViaUI(page, { name: 'キッチン掃除', category: 'kitchen', points: 2 });
  await createTaskViaUI(page, { name: '床拭き', category: 'floor', points: 5 });

  // Run scheduler to create task_instances
  await runScheduler('2026-03-10');

  // Get kanban tasks to find instance IDs
  const kanbanRes = await page.request.get(`${baseURL}/api/kanban`);
  const instances = await kanbanRes.json();

  const find = (title: string) => instances.find((t: any) => t.title === title);

  // Assign and complete tasks via kanban API
  // 洗面台掃除 → taro, done
  const senmen = find('洗面台掃除');
  await page.request.patch(`${baseURL}/api/kanban/${senmen.id}/status`, {
    data: { status: 'done', assignee: 'taro' },
  });

  // キッチン掃除 → hanako, done
  const kitchen = find('キッチン掃除');
  await page.request.patch(`${baseURL}/api/kanban/${kitchen.id}/status`, {
    data: { status: 'done', assignee: 'hanako' },
  });

  // 床拭き → taro, done (will count for taro)
  const yuka = find('床拭き');
  await page.request.patch(`${baseURL}/api/kanban/${yuka.id}/status`, {
    data: { status: 'done', assignee: 'taro' },
  });

  // Navigate to stats page and set date range
  await page.goto('/#/stats');
  await page.getByLabel('開始日').fill('2026-03-01');
  await page.getByLabel('終了日').fill('2026-03-31');
  await expect(page.getByText('完了タスク一覧')).toBeVisible({ timeout: 10000 });
}

test.describe('ポイントフィールド', () => {
  test('ポイントのデフォルト値は1', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await expect(page.getByLabel('ポイント')).toHaveValue('1');
  });

  test('ポイントは1〜10の範囲に制限される', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    const pointsInput = page.getByLabel('ポイント');

    await pointsInput.fill('11');
    await test.step('11を入力すると10に制限される', async () => {
      await expect(pointsInput).toHaveValue('10');
    });

    await pointsInput.fill('0');
    await test.step('0を入力すると1に制限される', async () => {
      await expect(pointsInput).toHaveValue('1');
    });
  });

  test('編集ダイアログで既存のポイント値が表示される', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('ポイント確認テスト');
    await page.getByLabel('ポイント').fill('7');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByText('ポイント確認テスト')).toBeVisible();

    // Open edit dialog
    await page.getByText('ポイント確認テスト').click();

    const pointsInput = page.getByLabel('ポイント');
    await expect(pointsInput).toHaveValue('7');
  });
});

test.describe('ポイント集計ページ', () => {
  test('ナビゲーションでポイント集計ページに遷移できる', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'ポイント集計' }).click();

    await expect(page.getByRole('heading', { name: '期間' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ポイント比較' })).toBeVisible();
  });

  test('期間を変更して保存するとリロード後も設定が維持される', async ({ page }) => {
    await page.goto('/#/stats');

    await page.getByLabel('開始日').fill('2026-01-01');
    await page.getByLabel('終了日').fill('2026-01-31');
    await page.getByRole('button', { name: 'みんなに保存' }).click();
    await page.getByText('保存しました').waitFor();

    await page.reload();

    await expect(page.getByLabel('開始日')).toHaveValue('2026-01-01');
    await expect(page.getByLabel('終了日')).toHaveValue('2026-01-31');
  });
});

test.describe('ポイント集計の表示', () => {
  test('完了タスクのポイントが担当者別に集計される', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);

    await test.step('完了タスクが一覧に表示される', async () => {
      await expect(page.getByRole('cell', { name: '洗面台掃除' })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'キッチン掃除' })).toBeVisible();
      await expect(page.getByRole('cell', { name: '床拭き' })).toBeVisible();
    });

    // taro: 洗面台掃除(3pt) + 床拭き(5pt) = 8pt
    // hanako: キッチン掃除(2pt) = 2pt
    await test.step('担当者別の合計ポイントが表示される', async () => {
      await expect(page.getByText(/taro.*8pt|8pt.*taro/)).toBeVisible();
      await expect(page.getByText(/hanako.*2pt|2pt.*hanako/)).toBeVisible();
    });

    await test.step('全体の合計ポイントが表示される', async () => {
      await expect(page.getByText('合計: 10pt')).toBeVisible();
    });
  });

  test('検索欄にテキストを入力すると完了タスクがフィルタされる', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);

    await page.getByLabel('完了タスクを検索').fill('掃除');

    await expect(page.getByRole('cell', { name: '洗面台掃除' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'キッチン掃除' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '床拭き' })).not.toBeVisible();
  });

  test('検索をクリアすると全タスクが再表示される', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);

    await page.getByLabel('完了タスクを検索').fill('掃除');
    await expect(page.getByRole('cell', { name: '床拭き' })).not.toBeVisible();

    await page.getByLabel('完了タスクを検索').fill('');

    await test.step('全件表示される', async () => {
      await expect(page.getByRole('cell', { name: '洗面台掃除' })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'キッチン掃除' })).toBeVisible();
      await expect(page.getByRole('cell', { name: '床拭き' })).toBeVisible();
    });
  });

  test('該当なしの検索語で「該当するタスクがありません」が表示される', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);

    await page.getByLabel('完了タスクを検索').fill('zzz');

    await expect(page.getByText('該当するタスクがありません')).toBeVisible();
    await expect(page.locator('table')).not.toBeVisible();
  });

  test('ローディング中にスケルトンUIが表示される', async ({ page, baseURL }) => {
    await createTaskViaUI(page, { name: '洗面台掃除', category: 'water', points: 3 });

    // Delay stats API response so skeleton is visible
    await page.route('**/api/stats/points**', async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      await route.continue();
    });

    await page.goto('/#/stats');

    const skeleton = page.getByLabel('読み込み中');
    await expect(skeleton).toBeVisible();
    await expect(skeleton.locator('.rounded-full')).toBeVisible();
  });
});

test.describe('担当フィルタ', () => {
  test('担当を選択すると該当タスクのみ表示される', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);

    await page.getByLabel('担当フィルタ').selectOption('taro');

    await test.step('taroのタスクが表示される', async () => {
      await expect(page.getByRole('cell', { name: '洗面台掃除' })).toBeVisible();
      await expect(page.getByRole('cell', { name: '床拭き' })).toBeVisible();
    });

    await test.step('hanakoのタスクが非表示になる', async () => {
      await expect(page.getByRole('cell', { name: 'キッチン掃除' })).not.toBeVisible();
    });
  });

  test('「全担当者」に戻すと全タスクが再表示される', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);
    await page.getByLabel('担当フィルタ').selectOption('taro');
    await page.getByRole('cell', { name: 'キッチン掃除' }).waitFor({ state: 'hidden' });

    await page.getByLabel('担当フィルタ').selectOption('');

    await expect(page.getByRole('cell', { name: '洗面台掃除' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'キッチン掃除' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '床拭き' })).toBeVisible();
  });

  test('担当フィルタとタスク名検索を組み合わせると両条件に合うタスクのみ表示される', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);

    await page.getByLabel('担当フィルタ').selectOption('taro');
    await page.getByLabel('完了タスクを検索').fill('掃除');

    await test.step('taroかつ「掃除」を含むタスクのみ表示される', async () => {
      await expect(page.getByRole('cell', { name: '洗面台掃除' })).toBeVisible();
    });

    await test.step('条件に合わないタスクは非表示', async () => {
      await expect(page.getByRole('cell', { name: '床拭き' })).not.toBeVisible();
      await expect(page.getByRole('cell', { name: 'キッチン掃除' })).not.toBeVisible();
    });
  });
});

test.describe('完了日フィルタ', () => {
  test('開始日を指定すると完了日がそれ以降のタスクのみ表示される', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

    await page.getByLabel('完了日From').fill(tomorrowStr);

    await expect(page.getByText('該当するタスクがありません')).toBeVisible();
  });

  test('終了日を指定すると完了日がそれ以前のタスクのみ表示される', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

    await page.getByLabel('完了日To').fill(yesterdayStr);

    await expect(page.getByText('該当するタスクがありません')).toBeVisible();
  });

  test('該当なしの日付範囲で「該当するタスクがありません」が表示される', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);

    await page.getByLabel('完了日From').fill('2099-01-01');
    await page.getByLabel('完了日To').fill('2099-12-31');

    await expect(page.getByText('該当するタスクがありません')).toBeVisible();
  });
});

test.describe('ソート', () => {
  test('「タスク」ヘッダをクリックするとタスク名の昇順に並ぶ', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);

    await page.getByRole('columnheader', { name: /タスク/ }).click();

    // ヘッダ行の次の最初のデータ行
    const firstDataRow = page.getByRole('row').nth(1);
    await expect(firstDataRow.getByRole('cell').first()).toHaveText('キッチン掃除');
  });

  test('「タスク」ヘッダを再クリックするとタスク名の降順に切り替わる', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);

    await page.getByRole('columnheader', { name: /タスク/ }).click();
    await page.getByRole('columnheader', { name: /タスク/ }).click();

    const firstDataRow = page.getByRole('row').nth(1);
    await expect(firstDataRow.getByRole('cell').first()).toHaveText('洗面台掃除');
  });

  test('「担当」ヘッダをクリックすると担当名の昇順に並ぶ', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);

    await page.getByRole('columnheader', { name: /担当/ }).click();

    const firstDataRow = page.getByRole('row').nth(1);
    await expect(firstDataRow.getByRole('cell').nth(1)).toHaveText('hanako');
  });

  test('「完了日」ヘッダをクリックすると完了日の昇順に切り替わる', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);

    // Default is done_at DESC, clicking toggles to ASC
    await page.getByRole('columnheader', { name: /完了日/ }).click();

    await expect(page.getByRole('columnheader', { name: /完了日/ })).toContainText('▲');
  });

  test('ソート中のヘッダに方向インジケータが表示される', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);

    await test.step('デフォルトで完了日に▼が表示される', async () => {
      await expect(page.getByRole('columnheader', { name: /完了日/ })).toContainText('▼');
    });

    await page.getByRole('columnheader', { name: /タスク/ }).click();

    await test.step('タスクに▲が表示され完了日のインジケータが消える', async () => {
      await expect(page.getByRole('columnheader', { name: /タスク/ })).toContainText('▲');
      await expect(page.getByRole('columnheader', { name: /完了日/ })).not.toContainText('▼');
      await expect(page.getByRole('columnheader', { name: /完了日/ })).not.toContainText('▲');
    });
  });
});

test.describe('無限スクロール', () => {
  async function setupManyTasks(page: Page, baseURL: string, count: number) {
    // Register assignee
    await page.request.put(`${baseURL}/api/kanban/assignees`, {
      data: { assignees: ['taro'] },
    });

    // Create task definitions via API (much faster than UI)
    for (let i = 1; i <= count; i++) {
      await page.request.post(`${baseURL}/api/tasks`, {
        data: {
          name: `タスク${String(i).padStart(3, '0')}`,
          category: 'water',
          frequency_type: 'daily',
          points: 1,
        },
      });
    }

    // Run scheduler to create task_instances
    await runScheduler('2026-03-10');

    // Get kanban tasks and complete all
    const kanbanRes = await page.request.get(`${baseURL}/api/kanban`);
    const instances = await kanbanRes.json();

    for (const instance of instances) {
      await page.request.patch(`${baseURL}/api/kanban/${instance.id}/status`, {
        data: { status: 'done', assignee: 'taro' },
      });
    }

    // Navigate to stats page with wide date range
    await page.goto('/#/stats');
    await page.getByLabel('開始日').fill('2026-01-01');
    await page.getByLabel('終了日').fill('2026-12-31');
    await page.getByText('完了タスク一覧').waitFor({ timeout: 30000 });
  }

  test('初期表示では最初の30件のみ表示される', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    await setupManyTasks(page, baseURL!, 35);

    // 30データ行 + 1ヘッダ行 = 31行
    await expect(page.getByRole('row')).toHaveCount(31);
    await expect(page.getByText('残り5件')).toBeVisible();
  });

  test('下にスクロールすると追加のタスクが読み込まれる', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    await setupManyTasks(page, baseURL!, 35);
    await page.getByText('残り5件').waitFor();

    await page.getByText('残り5件').scrollIntoViewIfNeeded();

    // 35データ行 + 1ヘッダ行 = 36行
    await expect(page.getByRole('row')).toHaveCount(36, { timeout: 5000 });
  });

  test('全件表示後に「全N件を表示」が表示される', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    await setupManyTasks(page, baseURL!, 35);
    await page.getByText('残り5件').waitFor();

    await page.getByText('残り5件').scrollIntoViewIfNeeded();

    await expect(page.getByText('全35件を表示')).toBeVisible({ timeout: 5000 });
  });
});
