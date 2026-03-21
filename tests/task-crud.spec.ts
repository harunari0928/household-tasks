import { test, expect } from './fixtures/setup.js';

test.describe('タスクCRUD', () => {
  test('タスクを新規作成できる', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /水回り/ }).click();

    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('テスト洗面台掃除');
    await page.getByLabel('頻度').selectOption('weekly');
    await page.getByRole('group', { name: '曜日' }).getByText('月').click();
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByText('テスト洗面台掃除')).toBeVisible();
    await expect(page.getByText('毎週(月)')).toBeVisible();
  });

});

test.describe('フォームバリデーション', () => {
  test('頻度タイプに応じてフォームのフィールドが動的に切り替わる', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    // weekly
    await page.getByLabel('頻度').selectOption('weekly');

    await test.step('毎週 → 曜日選択が表示される', async () => {
      await expect(page.getByRole('group', { name: '曜日' })).toBeVisible();
    });

    // n_days
    await page.getByLabel('頻度').selectOption('n_days');

    await test.step('N日ごと → 間隔が表示され曜日は非表示', async () => {
      await expect(page.getByLabel('間隔')).toBeVisible();
      await expect(page.getByRole('group', { name: '曜日' })).not.toBeVisible();
    });

    // monthly
    await page.getByLabel('頻度').selectOption('monthly');

    await test.step('毎月 → 日指定が表示され間隔は非表示', async () => {
      await expect(page.getByLabel(/日指定/)).toBeVisible();
      await expect(page.getByLabel('間隔')).not.toBeVisible();
    });

    // daily
    await page.getByLabel('頻度').selectOption('daily');

    await test.step('毎日 → すべて非表示', async () => {
      await expect(page.getByLabel('間隔')).not.toBeVisible();
      await expect(page.getByRole('group', { name: '曜日' })).not.toBeVisible();
      await expect(page.getByLabel(/日指定/)).not.toBeVisible();
    });
  });

  test('バリデーション: 毎週で曜日未選択だとエラー', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await page.getByLabel('タスク名').fill('バリデーションテスト');
    await page.getByLabel('頻度').selectOption('weekly');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('曜日を1つ以上選択');
  });

  test('備考が長くスクロールが下にある状態でバリデーションエラーが出ると、エラー表示位置までスクロールされる', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    const longText = Array(30).fill('これはテスト用の長い備考テキストです。').join('\n');
    await page.getByLabel('備考').fill(longText);

    const saveButton = page.getByRole('button', { name: '保存' });
    await saveButton.scrollIntoViewIfNeeded();
    await saveButton.click();

    const errorEl = page.getByRole('alert');
    await expect(errorEl).toBeVisible();
    await expect(errorEl).toContainText('タスク名を入力してください');

    // Wait for smooth scroll animation to complete
    await page.waitForTimeout(500);
    const errorBox = await errorEl.boundingBox();
    const dialogBox = await page.getByRole('dialog').boundingBox();
    expect(errorBox).toBeTruthy();
    expect(dialogBox).toBeTruthy();
    expect(errorBox!.y).toBeGreaterThanOrEqual(dialogBox!.y);
    expect(errorBox!.y + errorBox!.height).toBeLessThanOrEqual(dialogBox!.y + dialogBox!.height);
  });

  test('既にバリデーションエラーが表示された状態で再度保存しても、エラー位置までスクロールされる', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 400, height: 500 } });
    const page = await context.newPage();
    await fetch('http://localhost:5174/api/test/reset', { method: 'POST' });
    await page.goto('/');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    const longText = Array(30).fill('これはテスト用の長い備考テキストです。').join('\n');
    await page.getByLabel('備考').fill(longText);

    const dialog = page.getByRole('dialog');
    const saveButton = page.getByRole('button', { name: '保存' });
    const errorEl = page.getByRole('alert');

    // 1回目のバリデーションエラー
    await saveButton.scrollIntoViewIfNeeded();
    await saveButton.click();
    await expect(errorEl).toBeVisible();
    await page.waitForTimeout(500);

    // 下にスクロールするとエラーが見えなくなる
    await dialog.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(100);

    await test.step('下にスクロールするとエラーが見えなくなる', async () => {
      const box2 = await errorEl.boundingBox();
      const dBox2 = await dialog.boundingBox();
      expect(box2!.y + box2!.height).toBeLessThan(dBox2!.y + 1);
    });

    // 2回目の保存
    await saveButton.click();
    await page.waitForTimeout(500);

    await test.step('2回目の保存で再びエラー位置までスクロールされる', async () => {
      const box3 = await errorEl.boundingBox();
      const dBox3 = await dialog.boundingBox();
      expect(box3!.y).toBeGreaterThanOrEqual(dBox3!.y);
      expect(box3!.y + box3!.height).toBeLessThanOrEqual(dBox3!.y + dBox3!.height);
    });

    await context.close();
  });
});

test.describe('タスク検索', () => {
  test('検索欄にテキストを入力するとカテゴリ横断でタスクがフィルタされる', async ({ page, baseURL }) => {
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: 'トイレ掃除', category: 'water', frequency_type: 'weekly', days_of_week: ['mon'] },
    });
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: 'リビング掃除', category: 'kitchen', frequency_type: 'daily' },
    });
    await page.goto('/');
    await expect(page.getByText('トイレ掃除')).toBeVisible();

    await page.getByLabel('タスクを検索').fill('掃除');

    await expect(page.getByText('トイレ掃除')).toBeVisible();
    await expect(page.getByText('リビング掃除')).toBeVisible();
  });

  test('検索をクリアするとカテゴリフィルタに戻る', async ({ page, baseURL }) => {
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: 'トイレ掃除', category: 'water', frequency_type: 'weekly', days_of_week: ['mon'] },
    });
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: 'リビング掃除', category: 'kitchen', frequency_type: 'daily' },
    });
    await page.goto('/');
    await expect(page.getByText('トイレ掃除')).toBeVisible();

    await page.getByLabel('タスクを検索').fill('掃除');
    await expect(page.getByText('リビング掃除')).toBeVisible();

    await page.getByLabel('タスクを検索').fill('');

    await expect(page.getByText('トイレ掃除')).toBeVisible();
    await expect(page.getByText('リビング掃除')).not.toBeVisible();
  });
});

test.describe('ダイアログ操作', () => {
  test('ダイアログ外をクリックするとダイアログが閉じる', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await expect(page.getByLabel('タスク名')).toBeVisible();

    await page.mouse.click(10, 10);

    await expect(page.getByLabel('タスク名')).not.toBeVisible();
  });

  test('ダイアログ内をクリックしてもダイアログは閉じない', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await expect(page.getByLabel('タスク名')).toBeVisible();

    await page.getByLabel('タスク名').click();

    await expect(page.getByLabel('タスク名')).toBeVisible();
  });
});

test.describe('マークダウン備考', () => {
  test('備考にマークダウンを書いて保存すると、再度開いたときに内容が残っている', async ({ page, baseURL }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('マークダウンテスト');
    await page.getByLabel('備考').fill('**太字** と *イタリック*');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('マークダウンテスト')).toBeVisible();

    await page.getByText('マークダウンテスト').click();

    await expect(page.getByLabel('備考')).toHaveValue('**太字** と *イタリック*');
  });

  test('備考のプレビューモードで見出しやリストが装飾表示される', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await page.getByLabel('備考').fill('# 見出し\n- リスト1\n- リスト2');

    await page.getByRole('button', { name: 'プレビュー' }).click();

    await expect(page.getByLabel('備考')).not.toBeVisible();
    await expect(page.getByRole('region', { name: 'プレビュー' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'プレビュー' }).locator('h1')).toHaveText('見出し');
    await expect(page.getByRole('region', { name: 'プレビュー' }).locator('li')).toHaveCount(2);

    await page.getByRole('button', { name: '編集' }).click();

    await expect(page.getByLabel('備考')).toBeVisible();
    await expect(page.getByLabel('備考')).toHaveValue('# 見出し\n- リスト1\n- リスト2');
  });

  test('備考のツールバーボタンで各マークダウン記法が挿入される', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    const notes = page.getByLabel('備考');

    // 太字
    await notes.fill('テスト');
    await notes.selectText();
    await page.getByTitle('太字').click();

    await test.step('太字', async () => {
      await expect(notes).toHaveValue('**テスト**');
    });

    // イタリック
    await notes.fill('テスト');
    await notes.selectText();
    await page.getByTitle('イタリック').click();

    await test.step('イタリック', async () => {
      await expect(notes).toHaveValue('*テスト*');
    });

    // 取り消し線
    await notes.fill('テスト');
    await notes.selectText();
    await page.getByTitle('取り消し線').click();

    await test.step('取り消し線', async () => {
      await expect(notes).toHaveValue('~~テスト~~');
    });

    // リンク
    await notes.fill('');
    await page.getByTitle('リンク').click();

    await test.step('リンク', async () => {
      await expect(notes).toHaveValue('[リンク](url)');
    });

    // リスト
    await notes.fill('');
    await page.getByTitle('リスト').click();

    await test.step('リスト', async () => {
      await expect(notes).toHaveValue('\n- ');
    });
  });
});

test.describe('ファイル添付（新規タスク）', () => {
  test('新規タスク作成時にファイルを添付して保存すると、再度開いても添付が残っている', async ({ page, baseURL }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('添付テスト新規');

    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.getByLabel('ファイル添付').setInputFiles({
      name: 'test-image.png',
      mimeType: 'image/png',
      buffer: pngBytes,
    });

    await expect(page.getByRole('region', { name: '添付ファイル' }).getByText('test-image.png')).toBeVisible();

    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('添付テスト新規')).toBeVisible();

    await page.getByText('添付テスト新規').click();

    await expect(page.getByRole('region', { name: '添付ファイル' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('region', { name: '添付ファイル' }).getByText('test-image.png')).toBeVisible();

    await page.getByRole('button', { name: 'プレビュー' }).click();
    const img = page.getByRole('region', { name: 'プレビュー' }).locator('img');
    await expect(img).toBeVisible();
    const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);
  });

  test('新規タスクで画像を添付するとプレビューに実際の画像が表示される', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.getByLabel('ファイル添付').setInputFiles({
      name: 'preview-test.png',
      mimeType: 'image/png',
      buffer: pngBytes,
    });

    await page.getByRole('button', { name: 'プレビュー' }).click();

    const img = page.getByRole('region', { name: 'プレビュー' }).locator('img');
    await expect(img).toBeVisible();
    const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);
  });

  test('新規タスクで添付した画像を削除すると備考からも参照が消える', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('新規削除テスト');
    await page.getByLabel('備考').fill('テスト文章');

    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.getByLabel('ファイル添付').setInputFiles({
      name: 'remove-me.png',
      mimeType: 'image/png',
      buffer: pngBytes,
    });

    await expect(page.getByRole('region', { name: '添付ファイル' }).getByText('remove-me.png')).toBeVisible();
    await expect(page.getByLabel('備考')).toContainText('remove-me.png');

    await page.getByRole('region', { name: '添付ファイル' }).getByTitle('削除').click();

    await expect(page.getByRole('region', { name: '添付ファイル' })).not.toBeVisible();
    await expect(page.getByLabel('備考')).not.toContainText('remove-me.png');
    await expect(page.getByLabel('備考')).toContainText('テスト文章');

    await page.getByRole('button', { name: 'プレビュー' }).click();

    await expect(page.getByRole('region', { name: 'プレビュー' }).locator('img')).not.toBeVisible();
  });

  test('新規タスクでファイルを添付してからキャンセルすると、タスクもファイルも残らない', async ({ page, baseURL }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('キャンセルテスト');

    await page.getByLabel('ファイル添付').setInputFiles({
      name: 'cancel-file.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('キャンセルされるファイル'),
    });
    await expect(page.getByRole('region', { name: '添付ファイル' }).getByText('cancel-file.txt')).toBeVisible();

    await page.getByRole('button', { name: 'キャンセル' }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible();

    const res = await page.request.get(`${baseURL}/api/tasks`);
    const tasks = await res.json();
    expect(tasks.find((t: any) => t.name === 'キャンセルテスト')).toBeUndefined();
  });
});

test.describe('ファイル添付（既存タスク）', () => {
  test('既存タスク編集時にファイルを添付して保存すると、再度開いても添付が残っている', async ({ page, baseURL }) => {
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: '既存添付テスト', category: 'water', frequency_type: 'daily' },
    });
    await page.goto('/');
    await expect(page.getByText('既存添付テスト')).toBeVisible();

    await page.getByText('既存添付テスト').click();
    await page.getByLabel('ファイル添付').setInputFiles({
      name: 'existing-task-file.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('既存タスクのファイル'),
    });

    await expect(page.getByRole('region', { name: '添付ファイル' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('region', { name: '添付ファイル' }).getByText('existing-task-file.txt')).toBeVisible();

    await page.getByRole('button', { name: '保存' }).click();

    await page.getByText('既存添付テスト').click();

    await expect(page.getByRole('region', { name: '添付ファイル' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('region', { name: '添付ファイル' }).getByText('existing-task-file.txt')).toBeVisible();
  });

  test('添付ファイルを削除すると備考からも参照が消え、保存後も消えたままになっている', async ({ page, baseURL }) => {
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64',
    );
    const taskRes = await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: '削除テスト', category: 'water', frequency_type: 'daily' },
    });
    const task = await taskRes.json();
    const uploadRes = await page.request.post(`${baseURL}/api/tasks/${task.id}/attachments`, {
      multipart: {
        file: { name: 'delete-me.png', mimeType: 'image/png', buffer: pngBytes },
      },
    });
    const attachment = await uploadRes.json();
    await page.request.put(`${baseURL}/api/tasks/${task.id}`, {
      data: { ...task, notes: `テスト文章\n![delete-me.png](/api/attachments/${attachment.id})\nその他` },
    });

    await page.goto('/');
    await page.getByText('削除テスト').click();
    await expect(page.getByRole('region', { name: '添付ファイル' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel('備考')).toContainText('delete-me.png');

    // 削除する
    await page.getByRole('region', { name: '添付ファイル' }).getByTitle('削除').click();

    await test.step('備考からも参照が消える', async () => {
      await expect(page.getByText('delete-me.png')).not.toBeVisible();
      await expect(page.getByLabel('備考')).not.toContainText('delete-me.png');
      await expect(page.getByLabel('備考')).toContainText('テスト文章');
      await expect(page.getByLabel('備考')).toContainText('その他');
    });

    await test.step('プレビューでも画像が表示されない', async () => {
      await page.getByRole('button', { name: 'プレビュー' }).click();
      await expect(page.getByRole('region', { name: 'プレビュー' }).locator('img')).not.toBeVisible();
    });

    // 保存後に再度開く
    await page.getByRole('button', { name: '編集' }).click();
    await page.getByRole('button', { name: '保存' }).click();
    await page.getByText('削除テスト').click();

    await test.step('保存後に再度開いても消えたまま', async () => {
      await expect(page.getByRole('region', { name: '添付ファイル' })).not.toBeVisible({ timeout: 3000 });
      await expect(page.getByLabel('備考')).not.toContainText('delete-me.png');
    });
  });

  test('添付ファイルを削除してキャンセルすると、再度開いたときにファイルが残っている', async ({ page, baseURL }) => {
    const taskRes = await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: '削除キャンセルテスト', category: 'water', frequency_type: 'daily' },
    });
    const task = await taskRes.json();
    await page.request.post(`${baseURL}/api/tasks/${task.id}/attachments`, {
      multipart: {
        file: { name: 'keep-me.txt', mimeType: 'text/plain', buffer: Buffer.from('残るファイル') },
      },
    });

    await page.goto('/');
    await page.getByText('削除キャンセルテスト').click();
    await expect(page.getByRole('region', { name: '添付ファイル' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('keep-me.txt')).toBeVisible();

    // 削除してキャンセル
    await page.getByRole('region', { name: '添付ファイル' }).getByTitle('削除').click();
    await expect(page.getByText('keep-me.txt')).not.toBeVisible();
    await page.getByRole('button', { name: 'キャンセル' }).click();

    // 再度開く
    await page.getByText('削除キャンセルテスト').click();

    await test.step('再度開くとファイルが残っている', async () => {
      await expect(page.getByRole('region', { name: '添付ファイル' })).toBeVisible({ timeout: 5000 });
      await expect(page.getByText('keep-me.txt')).toBeVisible();
    });
  });

  test('添付した画像がプレビューモードで画像として表示される', async ({ page, baseURL }) => {
    const taskRes = await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: '画像プレビューテスト', category: 'water', frequency_type: 'daily' },
    });
    const task = await taskRes.json();
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const uploadRes = await page.request.post(`${baseURL}/api/tasks/${task.id}/attachments`, {
      multipart: {
        file: { name: 'test-image.png', mimeType: 'image/png', buffer: pngBytes },
      },
    });
    const attachment = await uploadRes.json();
    await page.request.put(`${baseURL}/api/tasks/${task.id}`, {
      data: { ...task, notes: `![テスト画像](/api/attachments/${attachment.id})` },
    });

    await page.goto('/');
    await page.getByText('画像プレビューテスト').click();
    await page.getByRole('button', { name: 'プレビュー' }).click();

    await expect(page.getByRole('region', { name: 'プレビュー' }).locator('img')).toBeVisible();
  });
});

test.describe('タスク削除', () => {
  test('タスクを削除できる', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('削除テスト用タスク');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('削除テスト用タスク')).toBeVisible();

    await page.getByText('削除テスト用タスク').click();
    await page.getByRole('button', { name: '削除' }).click();

    await expect(page.getByText('本当に削除しますか？')).toBeVisible();

    await page.getByRole('button', { name: '削除する' }).click();

    await expect(page.getByText('削除テスト用タスク')).not.toBeVisible();
  });

  test('削除の確認でキャンセルするとタスクが残る', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('削除キャンセルテスト');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('削除キャンセルテスト')).toBeVisible();

    await page.getByText('削除キャンセルテスト').click();
    await page.getByRole('button', { name: '削除' }).click();
    await expect(page.getByText('本当に削除しますか？')).toBeVisible();

    await page.getByRole('button', { name: 'やめる' }).click();

    await expect(page.getByText('本当に削除しますか？')).not.toBeVisible();

    await page.getByRole('button', { name: 'キャンセル' }).click();

    await expect(page.getByText('削除キャンセルテスト')).toBeVisible();
  });

  test('新規作成フォームに削除ボタンが表示されない', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await expect(page.getByRole('button', { name: '削除' })).not.toBeVisible();
  });

  test('添付ファイル付きタスクを削除すると添付URLにアクセスできなくなる', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('添付削除テスト');
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.getByLabel('ファイル添付').setInputFiles({
      name: 'delete-attach.png',
      mimeType: 'image/png',
      buffer: pngBytes,
    });
    await expect(page.getByRole('region', { name: '添付ファイル' }).getByText('delete-attach.png')).toBeVisible();

    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('添付削除テスト')).toBeVisible();

    await page.getByText('添付削除テスト').click();
    await expect(page.getByRole('region', { name: '添付ファイル' })).toBeVisible({ timeout: 5000 });

    const notesValue = await page.getByLabel('備考').inputValue();
    const urlMatch = notesValue.match(/\/api\/attachments\/[a-f0-9-]+/);
    expect(urlMatch).toBeTruthy();
    const attachmentUrl = urlMatch![0];

    // タスクを削除する
    await page.getByRole('button', { name: '削除' }).click();
    await page.getByRole('button', { name: '削除する' }).click();
    await expect(page.getByText('添付削除テスト')).not.toBeVisible();

    await test.step('添付URLが404を返す', async () => {
      const res = await page.request.get(attachmentUrl);
      expect(res.status()).toBe(404);
    });
  });
});

test.describe('ダークモード', () => {
  test('ダークモードに切り替えるとdarkクラスが付与される', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'ダークモードに切り替え' })).toBeVisible();

    await page.getByRole('button', { name: 'ダークモードに切り替え' }).click();

    await expect(page.getByRole('button', { name: 'ライトモードに切り替え' })).toBeVisible();
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(true);
  });

  test('ダークモードからライトモードに戻せる', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'ダークモードに切り替え' }).click();
    await expect(page.getByRole('button', { name: 'ライトモードに切り替え' })).toBeVisible();

    await page.getByRole('button', { name: 'ライトモードに切り替え' }).click();

    await expect(page.getByRole('button', { name: 'ダークモードに切り替え' })).toBeVisible();
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(false);
  });

  test('ダークモードの設定がページリロード後も維持される', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'ダークモードに切り替え' }).click();
    await expect(page.getByRole('button', { name: 'ライトモードに切り替え' })).toBeVisible();

    await page.reload();

    await expect(page.getByRole('button', { name: 'ライトモードに切り替え' })).toBeVisible();
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(true);
  });
});
