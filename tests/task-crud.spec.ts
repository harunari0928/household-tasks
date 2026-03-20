import { test, expect } from './fixtures/setup.js';

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

test('タスクの頻度を変更するとnext_due_dateが再計算される', async ({ page, baseURL }) => {
  await page.goto('/');
  let initialDate: string;

  await test.step('n_days/間隔3で作成するとnext_due_dateが設定される', async () => {
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('頻度変更テスト');
    await page.getByLabel('カテゴリ').selectOption('water');
    await page.getByLabel('頻度').selectOption('n_days');
    await page.getByLabel('間隔').fill('3');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByText('頻度変更テスト')).toBeVisible();

    const res1 = await page.request.get(`${baseURL}/api/tasks`);
    const tasks1 = await res1.json();
    const task = tasks1.find((t: any) => t.name === '頻度変更テスト');
    expect(task.next_due_date).toBeTruthy();
    initialDate = task.next_due_date;
  });

  await test.step('間隔を5に変更するとnext_due_dateが再計算される', async () => {
    await page.getByText('頻度変更テスト').click();
    await page.getByLabel('間隔').fill('5');
    await page.getByRole('button', { name: '保存' }).click();

    const res2 = await page.request.get(`${baseURL}/api/tasks`);
    const tasks2 = await res2.json();
    const updated = tasks2.find((t: any) => t.name === '頻度変更テスト');
    expect(updated.next_due_date).toBeTruthy();
    expect(updated.next_due_date).not.toBe(initialDate);
  });
});

test('頻度タイプに応じてフォームのフィールドが動的に切り替わる', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /タスクを追加/ }).click();

  await test.step('weekly → 曜日選択が表示される', async () => {
    await page.getByLabel('頻度').selectOption('weekly');
    await expect(page.getByRole('group', { name: '曜日' })).toBeVisible();
  });

  await test.step('n_days → 間隔が表示され曜日は非表示', async () => {
    await page.getByLabel('頻度').selectOption('n_days');
    await expect(page.getByLabel('間隔')).toBeVisible();
    await expect(page.getByRole('group', { name: '曜日' })).not.toBeVisible();
  });

  await test.step('monthly → 日指定が表示され間隔は非表示', async () => {
    await page.getByLabel('頻度').selectOption('monthly');
    await expect(page.getByLabel(/日指定/)).toBeVisible();
    await expect(page.getByLabel('間隔')).not.toBeVisible();
  });

  await test.step('daily → すべて非表示', async () => {
    await page.getByLabel('頻度').selectOption('daily');
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

  await test.step('1回目のバリデーションエラーでスクロールされる', async () => {
    await saveButton.scrollIntoViewIfNeeded();
    await saveButton.click();
    await expect(errorEl).toBeVisible();
    await page.waitForTimeout(500);
  });

  await test.step('下にスクロールするとエラーが見えなくなる', async () => {
    await dialog.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(100);

    const box2 = await errorEl.boundingBox();
    const dBox2 = await dialog.boundingBox();
    expect(box2!.y + box2!.height).toBeLessThan(dBox2!.y + 1);
  });

  await test.step('2回目の保存で再びエラー位置までスクロールされる', async () => {
    await saveButton.click();
    await page.waitForTimeout(500);

    const box3 = await errorEl.boundingBox();
    const dBox3 = await dialog.boundingBox();
    expect(box3!.y).toBeGreaterThanOrEqual(dBox3!.y);
    expect(box3!.y + box3!.height).toBeLessThanOrEqual(dBox3!.y + dBox3!.height);
  });

  await context.close();
});

test('タスクの有効/無効をトグルできる', async ({ page, baseURL }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /タスクを追加/ }).click();
  await page.getByLabel('タスク名').fill('トグルテスト');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('トグルテスト')).toBeVisible();

  const res = await page.request.get(`${baseURL}/api/tasks`);
  const tasks = await res.json();
  const task = tasks.find((t: any) => t.name === 'トグルテスト');

  await test.step('無効にするとis_activeが0になる', async () => {
    await page.getByRole('button', { name: '無効にする' }).click();

    const res2 = await page.request.get(`${baseURL}/api/tasks/${task.id}`);
    const updated = await res2.json();
    expect(updated.is_active).toBe(0);
  });

  await test.step('有効にするとis_activeが1に戻る', async () => {
    await page.getByRole('button', { name: '有効にする' }).click();

    const res3 = await page.request.get(`${baseURL}/api/tasks/${task.id}`);
    const restored = await res3.json();
    expect(restored.is_active).toBe(1);
  });
});

test('Seedデータのインポートで既存の手動編集済みタスクが上書きされない', async ({ page, baseURL }) => {
  await page.request.post(`${baseURL}/api/tasks/import`, {
    data: [{ name: 'Seedテスト', category: 'water', frequency_type: 'daily' }],
  });
  await page.goto('/');

  await page.getByText('Seedテスト').click();
  await page.getByLabel('タスク名').fill('Seedテスト');
  await page.getByLabel('備考').fill('手動編集しました');
  await page.getByRole('button', { name: '保存' }).click();

  const importRes = await page.request.post(`${baseURL}/api/tasks/import`, {
    data: [{ name: 'Seedテスト', category: 'water', frequency_type: 'weekly', days_of_week: ['mon'] }],
  });
  const importResult = await importRes.json();
  expect(importResult.skipped).toBe(1);

  const res = await page.request.get(`${baseURL}/api/tasks`);
  const tasks = await res.json();
  const task = tasks.find((t: any) => t.name === 'Seedテスト');
  expect(task.notes).toBe('手動編集しました');
  expect(task.frequency_type).toBe('daily');
});

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

// --- マークダウン備考欄 ---

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

  await test.step('太字', async () => {
    await notes.fill('テスト');
    await notes.selectText();
    await page.getByTitle('太字').click();
    await expect(notes).toHaveValue('**テスト**');
  });

  await test.step('イタリック', async () => {
    await notes.fill('テスト');
    await notes.selectText();
    await page.getByTitle('イタリック').click();
    await expect(notes).toHaveValue('*テスト*');
  });

  await test.step('取り消し線', async () => {
    await notes.fill('テスト');
    await notes.selectText();
    await page.getByTitle('取り消し線').click();
    await expect(notes).toHaveValue('~~テスト~~');
  });

  await test.step('リンク', async () => {
    await notes.fill('');
    await page.getByTitle('リンク').click();
    await expect(notes).toHaveValue('[リンク](url)');
  });

  await test.step('リスト', async () => {
    await notes.fill('');
    await page.getByTitle('リスト').click();
    await expect(notes).toHaveValue('\n- ');
  });
});

// --- ファイル添付 — 新規タスク ---

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

// --- ファイル添付 — 既存タスク ---

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

  await test.step('削除すると備考からも参照が消える', async () => {
    await page.getByRole('region', { name: '添付ファイル' }).getByTitle('削除').click();

    await expect(page.getByText('delete-me.png')).not.toBeVisible();
    await expect(page.getByLabel('備考')).not.toContainText('delete-me.png');
    await expect(page.getByLabel('備考')).toContainText('テスト文章');
    await expect(page.getByLabel('備考')).toContainText('その他');
  });

  await test.step('プレビューでも画像が表示されない', async () => {
    await page.getByRole('button', { name: 'プレビュー' }).click();
    await expect(page.getByRole('region', { name: 'プレビュー' }).locator('img')).not.toBeVisible();
  });

  await test.step('保存後に再度開いても消えたまま', async () => {
    await page.getByRole('button', { name: '編集' }).click();
    await page.getByRole('button', { name: '保存' }).click();
    await page.getByText('削除テスト').click();

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

  await test.step('削除してキャンセルする', async () => {
    await page.getByRole('region', { name: '添付ファイル' }).getByTitle('削除').click();
    await expect(page.getByText('keep-me.txt')).not.toBeVisible();
    await page.getByRole('button', { name: 'キャンセル' }).click();
  });

  await test.step('再度開くとファイルが残っている', async () => {
    await page.getByText('削除キャンセルテスト').click();
    await expect(page.getByRole('region', { name: '添付ファイル' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('keep-me.txt')).toBeVisible();
  });
});

// --- マークダウン × 添付ファイル統合 ---

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

// --- タスク削除 ---

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

  await test.step('タスクを削除する', async () => {
    await page.getByRole('button', { name: '削除' }).click();
    await page.getByRole('button', { name: '削除する' }).click();
    await expect(page.getByText('添付削除テスト')).not.toBeVisible();
  });

  await test.step('添付URLが404を返す', async () => {
    const res = await page.request.get(attachmentUrl);
    expect(res.status()).toBe(404);
  });
});
