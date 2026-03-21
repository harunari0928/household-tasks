import { test, expect } from './fixtures/setup.js';

test.describe('保存ボタンの表示制御', () => {
  test('初回表示時に「みんなに保存」ボタンが非表示', async ({ page }) => {
    await page.goto('/#/stats');

    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });

  test('リロード後も「みんなに保存」ボタンが非表示', async ({ page }) => {
    await page.goto('/#/stats');
    await page.reload();

    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });

  test('「先月」を選ぶと「みんなに保存」ボタンが表示される', async ({ page }) => {
    await page.goto('/#/stats');
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();

    await page.getByRole('button', { name: '先月' }).click();

    await expect(page.getByRole('button', { name: 'みんなに保存' })).toBeVisible();
  });

  test('「先月」→「今月」で元に戻すと「みんなに保存」ボタンが非表示になる', async ({ page }) => {
    await page.goto('/#/stats');
    await page.getByRole('button', { name: '先月' }).click();
    await expect(page.getByRole('button', { name: 'みんなに保存' })).toBeVisible();

    await page.getByRole('button', { name: '今月' }).click();

    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });
});

test.describe('期間設定の保存', () => {
  test('保存するとボタンが非表示になりリロード後も値が維持される', async ({ page }) => {
    await page.goto('/#/stats');
    await page.getByRole('button', { name: '先月' }).click();
    const savedStart = await page.getByLabel('開始日').inputValue();
    const savedEnd = await page.getByLabel('終了日').inputValue();

    await page.getByRole('button', { name: 'みんなに保存' }).click();

    await test.step('ボタンが非表示になる', async () => {
      await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
    });

    await page.reload();

    await test.step('リロード後も保存した値が維持される', async () => {
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

    // 保存せずにリロード
    await page.reload();

    await test.step('保存済みの値（先月）に戻っている', async () => {
      await expect(page.getByLabel('開始日')).toHaveValue(savedStart);
    });

    await test.step('ボタンが非表示', async () => {
      await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
    });
  });

  test('保存成功時にフィードバックメッセージが表示され自動で消える', async ({ page }) => {
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
});

test.describe('〜今日モード', () => {
  test('「〜今日」クリックでハイライトされる', async ({ page }) => {
    await page.goto('/#/stats');
    await expect(page.getByRole('button', { name: '〜今日' })).not.toHaveClass(/bg-blue-50/);

    await page.getByRole('button', { name: '〜今日' }).click();

    await expect(page.getByRole('button', { name: '〜今日' })).toHaveClass(/bg-blue-50/);
  });

  test('「今月」を選ぶと〜今日のハイライトが解除される', async ({ page }) => {
    await page.goto('/#/stats');
    await page.getByRole('button', { name: '〜今日' }).click();
    await expect(page.getByRole('button', { name: '〜今日' })).toHaveClass(/bg-blue-50/);

    await page.getByRole('button', { name: '今月' }).click();

    await expect(page.getByRole('button', { name: '〜今日' })).not.toHaveClass(/bg-blue-50/);
  });

  test('「〜今日」選択中は終了日に当日日付がテキスト表示され日付入力欄が存在しない', async ({ page }) => {
    await page.goto('/#/stats');

    await page.getByRole('button', { name: '〜今日' }).click();

    await test.step('終了日エリアに当日日付がテキストとして表示されている', async () => {
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      await expect(page.getByLabel('終了日')).toContainText(today);
    });

    await test.step('終了日の日付入力欄が存在しない', async () => {
      await expect(page.locator('input[aria-label="終了日"]')).not.toBeVisible();
    });
  });

  test('「〜今日」を各プリセット（今週・今月・先月）で解除すると終了日が日付入力欄に戻る', async ({ page }) => {
    await page.goto('/#/stats');

    for (const preset of ['今週', '今月', '先月']) {
      await page.getByRole('button', { name: '〜今日' }).click();
      await page.getByRole('button', { name: preset }).click();

      await test.step(`「${preset}」で解除すると終了日の日付入力欄が表示されている`, async () => {
        await expect(page.locator('input[aria-label="終了日"]')).toBeVisible();
      });
    }
  });

  test('JST 0:00に「〜今日」を使うとその日（2026-04-02）の日付が終了日に表示される', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-04-01T15:00:00Z') });
    await page.goto('/#/stats');

    await page.getByRole('button', { name: '〜今日' }).click();

    await expect(page.getByLabel('終了日')).toContainText('2026-04-02');
  });

  test('JST 23:59に「〜今日」を使うとその日（2026-04-02）の日付が終了日に表示される', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-04-02T14:59:00Z') });
    await page.goto('/#/stats');

    await page.getByRole('button', { name: '〜今日' }).click();

    await expect(page.getByLabel('終了日')).toContainText('2026-04-02');
  });
});

test.describe('〜今日モードの保存', () => {
  test('「〜今日」を保存するとリロード後も当日日付が終了日に設定される', async ({ page }) => {
    await page.goto('/#/stats');
    await page.getByRole('button', { name: '〜今日' }).click();
    await page.getByRole('button', { name: 'みんなに保存' }).click();
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();

    await page.reload();

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    await expect(page.getByLabel('終了日')).toContainText(today);
  });

  test('「〜今日」を保存するとリロード後もハイライトされている', async ({ page }) => {
    await page.goto('/#/stats');
    await page.getByRole('button', { name: '〜今日' }).click();
    await page.getByRole('button', { name: 'みんなに保存' }).click();
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();

    await page.reload();

    await expect(page.getByRole('button', { name: '〜今日' })).toHaveClass(/bg-blue-50/);
  });

  test('「〜今日」を保存するとリロード後も保存ボタンが非表示', async ({ page }) => {
    await page.goto('/#/stats');
    await page.getByRole('button', { name: '〜今日' }).click();
    await page.getByRole('button', { name: 'みんなに保存' }).click();
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();

    await page.reload();

    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });

  test('終了日を手動変更して保存するとリロード後にリテラル日付が表示される', async ({ page }) => {
    await page.goto('/#/stats');
    await page.getByRole('button', { name: '〜今日' }).click();
    await page.getByRole('button', { name: 'みんなに保存' }).click();
    await page.getByRole('button', { name: '今月' }).click();
    await page.getByLabel('終了日').fill('2025-12-31');
    await page.getByRole('button', { name: 'みんなに保存' }).click();

    await page.reload();

    await expect(page.getByLabel('終了日')).toHaveValue('2025-12-31');
  });

  test('終了日を手動変更して保存するとリロード後に〜今日のハイライトが解除される', async ({ page }) => {
    await page.goto('/#/stats');
    await page.getByRole('button', { name: '〜今日' }).click();
    await page.getByRole('button', { name: 'みんなに保存' }).click();
    await page.getByRole('button', { name: '今月' }).click();
    await page.getByLabel('終了日').fill('2025-12-31');
    await page.getByRole('button', { name: 'みんなに保存' }).click();

    await page.reload();

    await expect(page.getByRole('button', { name: '〜今日' })).not.toHaveClass(/bg-blue-50/);
  });

  test('「〜今日」保存後に日付が変わってリロードしても翌日の日付が終了日に表示される', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-04-01T15:00:00Z') });
    await page.goto('/#/stats');
    await page.getByRole('button', { name: '〜今日' }).click();
    await page.getByRole('button', { name: 'みんなに保存' }).click();
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();

    await page.clock.setFixedTime(new Date('2026-04-02T15:00:00Z'));
    await page.reload();

    await expect(page.getByLabel('終了日')).toContainText('2026-04-03');
  });

  test('「〜今日」保存後に日付が変わってリロードしても保存ボタンが表示されない', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-04-01T15:00:00Z') });
    await page.goto('/#/stats');
    await page.getByRole('button', { name: '〜今日' }).click();
    await page.getByRole('button', { name: 'みんなに保存' }).click();
    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();

    await page.clock.setFixedTime(new Date('2026-04-02T15:00:00Z'));
    await page.reload();

    await expect(page.getByRole('button', { name: 'みんなに保存' })).not.toBeVisible();
  });
});
