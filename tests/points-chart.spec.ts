import { test, expect } from './fixtures/setup.js';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';

// --- Points field tests (no Vikunja stub needed) ---

test('タスク作成時にポイントを設定できる', async ({ page, baseURL }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /タスクを追加/ }).click();
  await page.getByLabel('タスク名').fill('ポイントテスト');
  await page.getByLabel('ポイント').fill('5');
  await page.getByRole('button', { name: '保存' }).click();

  await expect(page.getByText('ポイントテスト')).toBeVisible();

  const res = await page.request.get(`${baseURL}/api/tasks`);
  const tasks = await res.json();
  const task = tasks.find((t: any) => t.name === 'ポイントテスト');
  expect(task.points).toBe(5);
});

test('ポイントのデフォルト値は1', async ({ page, baseURL }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /タスクを追加/ }).click();
  await page.getByLabel('タスク名').fill('デフォルトポイント');
  await page.getByRole('button', { name: '保存' }).click();

  await expect(page.getByText('デフォルトポイント')).toBeVisible();

  const res = await page.request.get(`${baseURL}/api/tasks`);
  const tasks = await res.json();
  const task = tasks.find((t: any) => t.name === 'デフォルトポイント');
  expect(task.points).toBe(1);
});

test('ポイント範囲外の値はバリデーションエラー', async ({ baseURL }) => {
  // Test via API directly for precision
  const res0 = await fetch(`${baseURL}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'ポイント0テスト',
      category: 'water',
      frequency_type: 'daily',
      points: 0,
    }),
  });
  expect(res0.status).toBe(400);
  const body0 = await res0.json();
  expect(body0.error).toContain('ポイント');

  const res11 = await fetch(`${baseURL}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'ポイント11テスト',
      category: 'water',
      frequency_type: 'daily',
      points: 11,
    }),
  });
  expect(res11.status).toBe(400);
  const body11 = await res11.json();
  expect(body11.error).toContain('ポイント');
});

test('編集ダイアログで既存のポイント値が表示される', async ({ page }) => {
  await page.goto('/');
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

// --- Stats page tests ---

test('ナビゲーションでポイント集計ページに遷移できる', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'ポイント集計' }).click();

  await expect(page.getByRole('heading', { name: '期間' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ポイント比較' })).toBeVisible();
});

test('期間設定がDBに永続化される', async ({ page }) => {
  await page.goto('/#/stats');

  // Set a custom date range
  await page.getByLabel('開始日').fill('2026-01-01');
  await page.getByLabel('終了日').fill('2026-01-31');

  // Wait for save to complete
  await page.waitForTimeout(500);

  // Reload and check persistence
  await page.reload();
  await page.goto('/#/stats');

  await expect(page.getByLabel('開始日')).toHaveValue('2026-01-01');
  await expect(page.getByLabel('終了日')).toHaveValue('2026-01-31');
});

// --- Stats page with Vikunja stub ---

let vikunjaStub: Server;
const STUB_PORT = 3199;

test.describe('ポイント集計（Vikunjaスタブ）', () => {
  test.beforeAll(async () => {
    vikunjaStub = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', (chunk: string) => (body += chunk));
      req.on('end', () => {
        // Return completed tasks for project tasks endpoint
        if (req.url?.includes('/projects/') && req.url?.includes('/tasks')) {
          const tasks = [
            {
              id: 1001,
              title: '洗面台掃除',
              done: true,
              done_at: '2026-03-10T10:00:00Z',
              assignees: [{ id: 1, username: 'taro' }],
            },
            {
              id: 1002,
              title: 'キッチン掃除',
              done: true,
              done_at: '2026-03-11T10:00:00Z',
              assignees: [{ id: 2, username: 'hanako' }],
            },
            {
              id: 1003,
              title: '床拭き',
              done: true,
              done_at: '2026-03-12T10:00:00Z',
              assignees: [{ id: 1, username: 'taro' }, { id: 2, username: 'hanako' }],
            },
            {
              id: 1004,
              title: '未完了タスク',
              done: false,
              done_at: null,
              assignees: [{ id: 1, username: 'taro' }],
            },
          ];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(tasks));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({}));
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      vikunjaStub.on('error', reject);
      vikunjaStub.listen(STUB_PORT, '127.0.0.1', () => resolve());
    });
  });

  test.afterAll(async () => {
    vikunjaStub.close();
  });

  // Helper: create task definitions and navigate to stats with date range
  async function setupStatsWithTasks(page: any, baseURL: string) {
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: '洗面台掃除', category: 'water', frequency_type: 'daily', points: 3, vikunja_project_id: 1 },
    });
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: 'キッチン掃除', category: 'kitchen', frequency_type: 'daily', points: 2, vikunja_project_id: 1 },
    });
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: '床拭き', category: 'floor', frequency_type: 'daily', points: 5, vikunja_project_id: 1 },
    });
    await page.goto('/#/stats');
    await page.getByLabel('開始日').fill('2026-03-01');
    await page.getByLabel('終了日').fill('2026-03-31');
    await expect(page.getByText('完了タスク一覧')).toBeVisible({ timeout: 10000 });
  }

  test('円グラフに正しいポイント集計が表示される', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);

    // Verify detail table has correct entries
    // taro: 洗面台掃除(3pt) + 床拭き(5pt) = 8pt
    // hanako: キッチン掃除(2pt) + 床拭き(5pt) = 7pt
    await expect(page.getByRole('cell', { name: '洗面台掃除' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'キッチン掃除' })).toBeVisible();
    // 床拭きは両方にアサインされているので2行ある
    await expect(page.getByRole('cell', { name: '床拭き' }).first()).toBeVisible();

    // Verify totals in chart labels
    await expect(page.getByText(/taro.*8pt|8pt.*taro/)).toBeVisible();
    await expect(page.getByText(/hanako.*7pt|7pt.*hanako/)).toBeVisible();

    // Verify total
    await expect(page.getByText('合計: 15pt')).toBeVisible();
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

    await test.step('検索でフィルタ', async () => {
      await page.getByLabel('完了タスクを検索').fill('掃除');
      await expect(page.getByRole('cell', { name: '床拭き' })).not.toBeVisible();
    });

    await test.step('クリアで全件表示', async () => {
      await page.getByLabel('完了タスクを検索').fill('');
      await expect(page.getByRole('cell', { name: '洗面台掃除' })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'キッチン掃除' })).toBeVisible();
      await expect(page.getByRole('cell', { name: '床拭き' }).first()).toBeVisible();
    });
  });

  test('該当なしの検索語で「該当するタスクがありません」が表示される', async ({ page, baseURL }) => {
    await setupStatsWithTasks(page, baseURL!);

    await page.getByLabel('完了タスクを検索').fill('zzz');

    await expect(page.getByText('該当するタスクがありません')).toBeVisible();
    await expect(page.locator('table')).not.toBeVisible();
  });

  test('ローディング中にスケルトンUIが表示される', async ({ page, baseURL }) => {
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: '洗面台掃除', category: 'water', frequency_type: 'daily', points: 3, vikunja_project_id: 1 },
    });

    // Delay stats API response so skeleton is visible
    await page.route('**/api/stats/points**', async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      await route.continue();
    });

    await page.goto('/#/stats');

    const skeleton = page.getByLabel('読み込み中');
    await expect(skeleton).toBeVisible();
    // Skeleton contains circle placeholder (pie chart area) and bar placeholders (table rows)
    await expect(skeleton.locator('.rounded-full')).toBeVisible();

    // After loading completes, skeleton disappears
    await expect(skeleton).not.toBeVisible({ timeout: 10000 });
  });
});
