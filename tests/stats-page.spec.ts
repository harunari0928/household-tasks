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

test('「みんなに保存」を押すと保存されリロードしても値が維持される', async ({ page }) => {
  await page.goto('/#/stats');
  await page.getByRole('button', { name: '先月' }).click();
  const savedStart = await page.getByLabel('開始日').inputValue();
  const savedEnd = await page.getByLabel('終了日').inputValue();

  await page.getByRole('button', { name: 'みんなに保存' }).click();

  await test.step('ボタンが非表示になる', async () => {
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });

  await test.step('リロード後も保存した値が維持される', async () => {
    await page.reload();
    await expect(page.getByLabel('開始日')).toHaveValue(savedStart);
    await expect(page.getByLabel('終了日')).toHaveValue(savedEnd);
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });
});

test('保存せずにリロードすると保存済みの値に戻りボタンは非表示', async ({ page }) => {
  // まず先月の設定を保存
  await page.goto('/#/stats');
  await page.getByRole('button', { name: '先月' }).click();
  await page.getByRole('button', { name: 'みんなに保存' }).click();
  await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  const savedStart = await page.getByLabel('開始日').inputValue();

  // 今週に変更（保存しない）
  await page.getByRole('button', { name: '今週' }).click();
  await expect(page.getByRole('button', { name: 'みんなに保存' })).toBeVisible();

  await test.step('保存せずにリロード', async () => {
    await page.reload();
  });

  await test.step('保存済みの値（先月）に戻っている', async () => {
    await expect(page.getByLabel('開始日')).toHaveValue(savedStart);
  });

  await test.step('ボタンが非表示', async () => {
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });
});

test('「〜今日」を保存するとリロード後も当日日付が終了日に設定される', async ({ page }) => {
  await page.goto('/#/stats');

  await test.step('「〜今日」ボタンを押して保存', async () => {
    await page.getByRole('button', { name: '〜今日' }).click();
    await page.getByRole('button', { name: 'みんなに保存' }).click();
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });

  await test.step('リロード後に当日日付が表示される', async () => {
    await page.reload();
    const today = new Date().toISOString().split('T')[0];
    await expect(page.getByLabel('終了日')).toHaveValue(today);
  });

  await test.step('リロード後もボタンは非表示（変更なし）', async () => {
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });

  await test.step('〜今日ボタンがハイライトされている', async () => {
    await expect(page.getByRole('button', { name: '〜今日' })).toHaveClass(/bg-blue-50/);
  });
});

test('「〜今日」がアクティブ時にボタンがハイライトされる', async ({ page }) => {
  await page.goto('/#/stats');
  const todayBtn = page.getByRole('button', { name: '〜今日' });

  await test.step('初期状態ではハイライトなし', async () => {
    await expect(todayBtn).not.toHaveClass(/bg-blue-50/);
  });

  await test.step('クリック後にハイライトされる', async () => {
    await todayBtn.click();
    await expect(todayBtn).toHaveClass(/bg-blue-50/);
  });

  await test.step('他のプリセットを選ぶとハイライト解除', async () => {
    await page.getByRole('button', { name: '今月' }).click();
    await expect(todayBtn).not.toHaveClass(/bg-blue-50/);
  });
});

test('終了日を手動変更すると〜今日モードが解除される', async ({ page }) => {
  await page.goto('/#/stats');

  await test.step('〜今日を保存', async () => {
    await page.getByRole('button', { name: '〜今日' }).click();
    await page.getByRole('button', { name: 'みんなに保存' }).click();
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });

  await test.step('終了日を手動変更して保存', async () => {
    await page.getByLabel('終了日').fill('2025-12-31');
    await page.getByRole('button', { name: 'みんなに保存' }).click();
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });

  await test.step('リロード後にリテラル日付が表示され〜今日はハイライトなし', async () => {
    await page.reload();
    await expect(page.getByLabel('終了日')).toHaveValue('2025-12-31');
    await expect(page.getByRole('button', { name: '〜今日' })).not.toHaveClass(/bg-blue-50/);
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
