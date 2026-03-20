import { test, expect } from './fixtures/setup.js';

test('画面表示時・画面更新時に「みんなに保存」ボタンが表示されない', async ({ page }) => {
  await test.step('初回表示時にボタンが非表示', async () => {
    await page.goto('/#/stats');
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });

  await test.step('リロード後もボタンが非表示', async () => {
    await page.reload();
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });
});

test('日付を変更すると「みんなに保存」ボタンが表示される', async ({ page }) => {
  await page.goto('/#/stats');
  await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();

  await page.getByRole('button', { name: '先月' }).click();

  await expect(page.getByRole('button', { name: 'みんなに保存' })).toBeVisible();
});

test('値を変更してから元に戻すと「みんなに保存」ボタンが非表示になる', async ({ page }) => {
  await page.goto('/#/stats');

  await test.step('日付変更でボタン表示', async () => {
    await page.getByRole('button', { name: '先月' }).click();
    await expect(page.getByRole('button', { name: 'みんなに保存' })).toBeVisible();
  });

  await test.step('元に戻すとボタン非表示', async () => {
    await page.getByRole('button', { name: '今月' }).click();
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });
});

test('「みんなに保存」を押すと設定がDBに保存されボタンが非表示になる', async ({ page, baseURL }) => {
  await page.goto('/#/stats');
  await page.getByRole('button', { name: '先月' }).click();
  await page.getByRole('button', { name: 'みんなに保存' }).click();

  await test.step('ボタンが非表示になる', async () => {
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });

  await test.step('DBに保存されている', async () => {
    const res = await page.request.get(`${baseURL}/api/settings`);
    const settings = await res.json();
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const expectedStart = lastMonth.toISOString().split('T')[0];
    expect(settings.chart_start_date).toBe(expectedStart);
    expect(settings.chart_end_date).toBeTruthy();
  });
});

test('保存せずにリロードするとDB値に戻りボタンは非表示', async ({ page, baseURL }) => {
  // まず今月の設定を保存
  await page.goto('/#/stats');
  await page.getByRole('button', { name: '先月' }).click();
  await page.getByRole('button', { name: 'みんなに保存' }).click();
  await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();

  // 今週に変更（保存しない）
  await page.getByRole('button', { name: '今週' }).click();
  await expect(page.getByRole('button', { name: 'みんなに保存' })).toBeVisible();

  await test.step('保存せずにリロード', async () => {
    await page.reload();
  });

  await test.step('DB値（先月）に戻っている', async () => {
    const res = await page.request.get(`${baseURL}/api/settings`);
    const settings = await res.json();
    const startInput = page.getByLabel('開始日');
    await expect(startInput).toHaveValue(settings.chart_start_date);
  });

  await test.step('ボタンが非表示', async () => {
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });
});

test('保存成功時にフィードバックメッセージが表示される', async ({ page }) => {
  await page.goto('/#/stats');
  await page.getByRole('button', { name: '先月' }).click();
  await page.getByRole('button', { name: 'みんなに保存' }).click();

  await test.step('メッセージ表示', async () => {
    await expect(page.getByText('保存しました')).toBeVisible();
  });

  await test.step('メッセージ消滅', async () => {
    await expect(page.getByText('保存しました')).not.toBeVisible({ timeout: 5000 });
  });
});
