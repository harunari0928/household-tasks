import { test, expect } from './fixtures/setup.js';

test('タスクを新規作成できる', async ({ page }) => {
  await page.goto('/');

  // Click the water category tab (default)
  await page.getByTestId('category-tab-water').click();

  // Click add button
  await page.getByTestId('add-task-button').click();

  // Fill form
  await page.getByTestId('task-name-input').fill('テスト洗面台掃除');
  await page.getByTestId('frequency-type-select').selectOption('weekly');
  await page.getByTestId('day-checkbox-mon').click({ force: true });

  // Save
  await page.getByTestId('save-button').click();

  // Verify task appears in list
  await expect(page.getByText('テスト洗面台掃除')).toBeVisible();
  await expect(page.getByText('毎週(月)')).toBeVisible();
});

test('タスクの頻度を変更するとnext_due_dateが再計算される', async ({ page, baseURL }) => {
  await page.goto('/');

  // Create a 3-day interval task
  await page.getByTestId('add-task-button').click();
  await page.getByTestId('task-name-input').fill('頻度変更テスト');
  await page.getByTestId('category-select').selectOption('water');
  await page.getByTestId('frequency-type-select').selectOption('n_days');
  await page.getByTestId('frequency-interval-input').fill('3');
  await page.getByTestId('save-button').click();

  await expect(page.getByText('頻度変更テスト')).toBeVisible();

  // Get initial next_due_date via API
  const res1 = await page.request.get(`${baseURL}/api/tasks`);
  const tasks1 = await res1.json();
  const task = tasks1.find((t: any) => t.name === '頻度変更テスト');
  expect(task.next_due_date).toBeTruthy();
  const initialDate = task.next_due_date;

  // Edit to 5-day interval
  await page.getByText('頻度変更テスト').click();
  await page.getByTestId('frequency-interval-input').fill('5');
  await page.getByTestId('save-button').click();

  // Verify next_due_date changed
  const res2 = await page.request.get(`${baseURL}/api/tasks`);
  const tasks2 = await res2.json();
  const updated = tasks2.find((t: any) => t.name === '頻度変更テスト');
  expect(updated.next_due_date).toBeTruthy();
  expect(updated.next_due_date).not.toBe(initialDate);
});

test('頻度タイプに応じてフォームのフィールドが動的に切り替わる', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-task-button').click();

  // Weekly → days_of_week visible
  await page.getByTestId('frequency-type-select').selectOption('weekly');
  await expect(page.getByTestId('days-of-week-checkboxes')).toBeVisible();

  // N days → interval visible, days_of_week hidden
  await page.getByTestId('frequency-type-select').selectOption('n_days');
  await expect(page.getByTestId('frequency-interval-input')).toBeVisible();
  await expect(page.getByTestId('days-of-week-checkboxes')).not.toBeVisible();

  // Monthly → day_of_month visible
  await page.getByTestId('frequency-type-select').selectOption('monthly');
  await expect(page.getByTestId('day-of-month-input')).toBeVisible();
  await expect(page.getByTestId('frequency-interval-input')).not.toBeVisible();

  // Daily → no extra fields
  await page.getByTestId('frequency-type-select').selectOption('daily');
  await expect(page.getByTestId('frequency-interval-input')).not.toBeVisible();
  await expect(page.getByTestId('days-of-week-checkboxes')).not.toBeVisible();
  await expect(page.getByTestId('day-of-month-input')).not.toBeVisible();
});

test('バリデーション: 毎週で曜日未選択だとエラー', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-task-button').click();

  await page.getByTestId('task-name-input').fill('バリデーションテスト');
  await page.getByTestId('frequency-type-select').selectOption('weekly');
  // Don't select any day
  await page.getByTestId('save-button').click();

  await expect(page.getByTestId('frequency-error')).toBeVisible();
  await expect(page.getByTestId('frequency-error')).toContainText('曜日を1つ以上選択');
});

test('備考が長くスクロールが下にある状態でバリデーションエラーが出ると、エラー表示位置までスクロールされる', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-task-button').click();

  // Leave task name empty (will trigger validation error)
  // Fill notes with long content to push save button below viewport
  const longText = Array(30).fill('これはテスト用の長い備考テキストです。').join('\n');
  await page.getByTestId('notes-input').fill(longText);

  // Scroll dialog to the bottom (to the save button)
  const saveButton = page.getByTestId('save-button');
  await saveButton.scrollIntoViewIfNeeded();
  await saveButton.click();

  // Error message should be visible in viewport (scrolled into view automatically)
  const errorEl = page.getByTestId('form-error');
  await expect(errorEl).toBeVisible();
  await expect(errorEl).toContainText('タスク名を入力してください');

  // Verify the error is actually within the visible area of the dialog
  const errorBox = await errorEl.boundingBox();
  const dialogBox = await page.locator('[role="dialog"]').boundingBox();
  expect(errorBox).toBeTruthy();
  expect(dialogBox).toBeTruthy();
  expect(errorBox!.y).toBeGreaterThanOrEqual(dialogBox!.y);
  expect(errorBox!.y + errorBox!.height).toBeLessThanOrEqual(dialogBox!.y + dialogBox!.height);
});

test('既にバリデーションエラーが表示された状態で再度保存しても、エラー位置までスクロールされる', async ({ browser }) => {
  // Use a small viewport to ensure the form content overflows the dialog
  const context = await browser.newContext({ viewport: { width: 400, height: 500 } });
  const page = await context.newPage();
  // Reset DB
  await fetch('http://localhost:5174/api/test/reset', { method: 'POST' });

  await page.goto('/');
  await page.getByTestId('add-task-button').click();

  const longText = Array(30).fill('これはテスト用の長い備考テキストです。').join('\n');
  await page.getByTestId('notes-input').fill(longText);

  const dialog = page.locator('[role="dialog"]');
  const saveButton = page.getByTestId('save-button');
  const errorEl = page.getByTestId('form-error');

  // 1回目: スクロールしてエラーを出す
  await saveButton.scrollIntoViewIfNeeded();
  await saveButton.click();
  await expect(errorEl).toBeVisible();
  await page.waitForTimeout(500);

  // ユーザーが再び下にスクロール
  await dialog.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(100);

  // エラーが見えなくなっていることを確認
  const box2 = await errorEl.boundingBox();
  const dBox2 = await dialog.boundingBox();
  expect(box2!.y + box2!.height).toBeLessThan(dBox2!.y + 1);

  // 2回目: 同じエラーで再度保存
  await saveButton.click();
  await page.waitForTimeout(500);

  // エラーが再びビューポート内にスクロールされている
  const box3 = await errorEl.boundingBox();
  const dBox3 = await dialog.boundingBox();
  expect(box3!.y).toBeGreaterThanOrEqual(dBox3!.y);
  expect(box3!.y + box3!.height).toBeLessThanOrEqual(dBox3!.y + dBox3!.height);

  await context.close();
});

test('タスクの有効/無効をトグルできる', async ({ page, baseURL }) => {
  await page.goto('/');

  // Create a task
  await page.getByTestId('add-task-button').click();
  await page.getByTestId('task-name-input').fill('トグルテスト');
  await page.getByTestId('save-button').click();

  await expect(page.getByText('トグルテスト')).toBeVisible();

  // Get task id
  const res = await page.request.get(`${baseURL}/api/tasks`);
  const tasks = await res.json();
  const task = tasks.find((t: any) => t.name === 'トグルテスト');

  // Toggle off
  await page.getByTestId(`toggle-task-${task.id}`).click();

  // Verify via API
  const res2 = await page.request.get(`${baseURL}/api/tasks/${task.id}`);
  const updated = await res2.json();
  expect(updated.is_active).toBe(0);

  // Toggle back on
  await page.getByTestId(`toggle-task-${task.id}`).click();

  const res3 = await page.request.get(`${baseURL}/api/tasks/${task.id}`);
  const restored = await res3.json();
  expect(restored.is_active).toBe(1);
});

test('Seedデータのインポートで既存の手動編集済みタスクが上書きされない', async ({ page, baseURL }) => {
  await page.goto('/');

  // Create task via import
  await page.request.post(`${baseURL}/api/tasks/import`, {
    data: [{ name: 'Seedテスト', category: 'water', frequency_type: 'daily' }],
  });

  // Edit via UI
  await page.reload();
  await page.getByText('Seedテスト').click();
  await page.getByTestId('task-name-input').fill('Seedテスト');
  await page.getByTestId('notes-input').fill('手動編集しました');
  await page.getByTestId('save-button').click();

  // Re-import
  const importRes = await page.request.post(`${baseURL}/api/tasks/import`, {
    data: [{ name: 'Seedテスト', category: 'water', frequency_type: 'weekly', days_of_week: ['mon'] }],
  });
  const importResult = await importRes.json();
  expect(importResult.skipped).toBe(1);

  // Verify original edit is preserved
  const res = await page.request.get(`${baseURL}/api/tasks`);
  const tasks = await res.json();
  const task = tasks.find((t: any) => t.name === 'Seedテスト');
  expect(task.notes).toBe('手動編集しました');
  expect(task.frequency_type).toBe('daily'); // Not overwritten to weekly
});

test('ダイアログ外をクリックするとダイアログが閉じる', async ({ page }) => {
  await page.goto('/');

  // ダイアログを開く
  await page.getByTestId('add-task-button').click();
  await expect(page.getByTestId('task-name-input')).toBeVisible();

  // オーバーレイ部分（ダイアログ外）をクリック
  await page.getByTestId('dialog-overlay').click({ position: { x: 10, y: 10 } });

  // ダイアログが閉じたことを確認
  await expect(page.getByTestId('task-name-input')).not.toBeVisible();
});

test('ダイアログ内をクリックしてもダイアログは閉じない', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-task-button').click();
  await expect(page.getByTestId('task-name-input')).toBeVisible();

  // フォーム内の入力欄をクリック
  await page.getByTestId('task-name-input').click();

  // ダイアログはまだ表示されている
  await expect(page.getByTestId('task-name-input')).toBeVisible();
});

test('検索欄にテキストを入力するとカテゴリ横断でタスクがフィルタされる', async ({ page, baseURL }) => {
  // 異なるカテゴリにタスクを作成
  await page.request.post(`${baseURL}/api/tasks`, {
    data: { name: 'トイレ掃除', category: 'water', frequency_type: 'weekly', days_of_week: ['mon'] },
  });
  await page.request.post(`${baseURL}/api/tasks`, {
    data: { name: 'リビング掃除', category: 'kitchen', frequency_type: 'daily' },
  });
  await page.goto('/');

  // データ読み込み完了を待つ（waterカテゴリのタスクが表示されるまで）
  await expect(page.getByText('トイレ掃除')).toBeVisible();

  // 検索欄に入力
  await page.getByTestId('search-input').fill('掃除');

  // 両方のカテゴリのタスクが表示される（カテゴリ横断）
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

  // データ読み込み完了を待つ
  await expect(page.getByText('トイレ掃除')).toBeVisible();

  // 検索 → クリア
  await page.getByTestId('search-input').fill('掃除');
  await expect(page.getByText('リビング掃除')).toBeVisible();
  await page.getByTestId('search-input').fill('');

  // デフォルトカテゴリ(water)のタスクのみ表示
  await expect(page.getByText('トイレ掃除')).toBeVisible();
  await expect(page.getByText('リビング掃除')).not.toBeVisible();
});

// --- マークダウン備考欄 ---

test('備考にマークダウンを書いて保存すると、再度開いたときに内容が残っている', async ({ page, baseURL }) => {
  await page.goto('/');
  await page.getByTestId('add-task-button').click();
  await page.getByTestId('task-name-input').fill('マークダウンテスト');
  await page.getByTestId('notes-input').fill('**太字** と *イタリック*');
  await page.getByTestId('save-button').click();

  await expect(page.getByText('マークダウンテスト')).toBeVisible();

  // Reopen task
  await page.getByText('マークダウンテスト').click();
  await expect(page.getByTestId('notes-input')).toHaveValue('**太字** と *イタリック*');
});

test('備考のプレビューモードで見出しやリストが装飾表示される', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-task-button').click();
  await page.getByTestId('notes-input').fill('# 見出し\n- リスト1\n- リスト2');

  // Switch to preview
  await page.getByRole('button', { name: 'プレビュー' }).click();
  await expect(page.getByTestId('notes-input')).not.toBeVisible();
  await expect(page.getByTestId('notes-preview')).toBeVisible();
  await expect(page.getByTestId('notes-preview').locator('h1')).toHaveText('見出し');
  await expect(page.getByTestId('notes-preview').locator('li')).toHaveCount(2);

  // Switch back to edit — content preserved
  await page.getByRole('button', { name: '編集' }).click();
  await expect(page.getByTestId('notes-input')).toBeVisible();
  await expect(page.getByTestId('notes-input')).toHaveValue('# 見出し\n- リスト1\n- リスト2');
});

test('備考のツールバーボタンで各マークダウン記法が挿入される', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-task-button').click();

  const notes = page.getByTestId('notes-input');

  // Bold
  await notes.fill('テスト');
  await notes.selectText();
  await page.getByTitle('太字').click();
  await expect(notes).toHaveValue('**テスト**');

  // Italic
  await notes.fill('テスト');
  await notes.selectText();
  await page.getByTitle('イタリック').click();
  await expect(notes).toHaveValue('*テスト*');

  // Strikethrough
  await notes.fill('テスト');
  await notes.selectText();
  await page.getByTitle('取り消し線').click();
  await expect(notes).toHaveValue('~~テスト~~');

  // Link
  await notes.fill('');
  await page.getByTitle('リンク').click();
  await expect(notes).toHaveValue('[リンク](url)');

  // List
  await notes.fill('');
  await page.getByTitle('リスト').click();
  await expect(notes).toHaveValue('\n- ');
});

// --- ファイル添付 — 新規タスク ---

test('新規タスク作成時にファイルを添付して保存すると、再度開いても添付が残っている', async ({ page, baseURL }) => {
  await page.goto('/');
  await page.getByTestId('add-task-button').click();
  await page.getByTestId('task-name-input').fill('添付テスト新規');

  // Attach an image file
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.getByTestId('file-input').setInputFiles({
    name: 'test-image.png',
    mimeType: 'image/png',
    buffer: pngBytes,
  });

  // Pending file shown in attachments list
  await expect(page.getByTestId('attachments-list').getByText('test-image.png')).toBeVisible();

  // Save
  await page.getByTestId('save-button').click();
  await expect(page.getByText('添付テスト新規')).toBeVisible();

  // Reopen and verify attachment persists
  await page.getByText('添付テスト新規').click();
  await expect(page.getByTestId('attachments-list')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('attachments-list').getByText('test-image.png')).toBeVisible();

  // Verify notes contain real URL (not pending:N) by checking image loads in preview
  await page.getByRole('button', { name: 'プレビュー' }).click();
  const img = page.getByTestId('notes-preview').locator('img');
  await expect(img).toBeVisible();
  const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
  expect(naturalWidth).toBeGreaterThan(0);
});

test('新規タスクで画像を添付するとプレビューに実際の画像が表示される', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-task-button').click();

  // Attach a 1x1 PNG image
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.getByTestId('file-input').setInputFiles({
    name: 'preview-test.png',
    mimeType: 'image/png',
    buffer: pngBytes,
  });

  // Switch to preview
  await page.getByRole('button', { name: 'プレビュー' }).click();

  // Verify the img element loaded successfully (naturalWidth > 0 means the image data was read)
  const img = page.getByTestId('notes-preview').locator('img');
  await expect(img).toBeVisible();
  const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
  expect(naturalWidth).toBeGreaterThan(0);
});

test('新規タスクで添付した画像を削除すると備考からも参照が消える', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-task-button').click();
  await page.getByTestId('task-name-input').fill('新規削除テスト');

  // Type some text first
  await page.getByTestId('notes-input').fill('テスト文章');

  // Attach image
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.getByTestId('file-input').setInputFiles({
    name: 'remove-me.png',
    mimeType: 'image/png',
    buffer: pngBytes,
  });

  // Verify file is shown
  await expect(page.getByTestId('attachments-list').getByText('remove-me.png')).toBeVisible();
  await expect(page.getByTestId('notes-input')).toContainText('remove-me.png');

  // Delete it
  const deleteBtn = page.getByTestId('attachments-list').getByTitle('削除');
  await deleteBtn.click();

  // File gone from list and notes, but other text remains
  await expect(page.getByTestId('attachments-list')).not.toBeVisible();
  await expect(page.getByTestId('notes-input')).not.toContainText('remove-me.png');
  await expect(page.getByTestId('notes-input')).toContainText('テスト文章');

  // Preview should not show the image
  await page.getByRole('button', { name: 'プレビュー' }).click();
  await expect(page.getByTestId('notes-preview').locator('img')).not.toBeVisible();
});

test('新規タスクでファイルを添付してからキャンセルすると、タスクもファイルも残らない', async ({ page, baseURL }) => {
  await page.goto('/');
  await page.getByTestId('add-task-button').click();
  await page.getByTestId('task-name-input').fill('キャンセルテスト');

  // Attach file
  const fileInput = page.getByTestId('file-input');
  await fileInput.setInputFiles({
    name: 'cancel-file.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('キャンセルされるファイル'),
  });

  await expect(page.getByTestId('attachments-list').getByText('cancel-file.txt')).toBeVisible();

  // Cancel
  await page.getByTestId('cancel-button').click();
  await expect(page.getByTestId('task-form')).not.toBeVisible();

  // Task should not exist
  const res = await page.request.get(`${baseURL}/api/tasks`);
  const tasks = await res.json();
  expect(tasks.find((t: any) => t.name === 'キャンセルテスト')).toBeUndefined();
});

// --- ファイル添付 — 既存タスク ---

test('既存タスク編集時にファイルを添付して保存すると、再度開いても添付が残っている', async ({ page, baseURL }) => {
  // Create task via API
  await page.request.post(`${baseURL}/api/tasks`, {
    data: { name: '既存添付テスト', category: 'water', frequency_type: 'daily' },
  });
  await page.goto('/');
  await expect(page.getByText('既存添付テスト')).toBeVisible();

  // Open edit
  await page.getByText('既存添付テスト').click();

  // Attach file
  const fileInput = page.getByTestId('file-input');
  await fileInput.setInputFiles({
    name: 'existing-task-file.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('既存タスクのファイル'),
  });

  // Wait for upload to complete and appear in list
  await expect(page.getByTestId('attachments-list')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('attachments-list').getByText('existing-task-file.txt')).toBeVisible();

  // Save
  await page.getByTestId('save-button').click();

  // Reopen and verify
  await page.getByText('既存添付テスト').click();
  await expect(page.getByTestId('attachments-list')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('attachments-list').getByText('existing-task-file.txt')).toBeVisible();
});

test('添付ファイルを削除すると備考からも参照が消え、保存後も消えたままになっている', async ({ page, baseURL }) => {
  // Create task with image attachment and markdown reference
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

  // Set notes with image markdown reference
  await page.request.put(`${baseURL}/api/tasks/${task.id}`, {
    data: { ...task, notes: `テスト文章\n![delete-me.png](/api/attachments/${attachment.id})\nその他` },
  });

  await page.goto('/');
  await page.getByText('削除テスト').click();
  await expect(page.getByTestId('attachments-list')).toBeVisible({ timeout: 5000 });

  // Verify image reference is in notes
  await expect(page.getByTestId('notes-input')).toContainText('delete-me.png');

  // Delete attachment
  const deleteBtn = page.getByTestId('attachments-list').getByTitle('削除');
  await deleteBtn.click();

  // Attachment gone from list
  await expect(page.getByText('delete-me.png')).not.toBeVisible();

  // Image reference removed from notes, but other text remains
  await expect(page.getByTestId('notes-input')).not.toContainText('delete-me.png');
  await expect(page.getByTestId('notes-input')).toContainText('テスト文章');
  await expect(page.getByTestId('notes-input')).toContainText('その他');

  // Preview should also not show the image
  await page.getByRole('button', { name: 'プレビュー' }).click();
  await expect(page.getByTestId('notes-preview').locator('img')).not.toBeVisible();

  // Save and reopen — still gone
  await page.getByRole('button', { name: '編集' }).click();
  await page.getByTestId('save-button').click();
  await page.getByText('削除テスト').click();
  await expect(page.getByTestId('attachments-list')).not.toBeVisible({ timeout: 3000 });
  await expect(page.getByTestId('notes-input')).not.toContainText('delete-me.png');
});

test('添付ファイルを削除してキャンセルすると、再度開いたときにファイルが残っている', async ({ page, baseURL }) => {
  // Create task and upload file via API
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
  await expect(page.getByTestId('attachments-list')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('keep-me.txt')).toBeVisible();

  // Click delete — file disappears from UI
  const deleteBtn = page.getByTestId('attachments-list').getByTitle('削除');
  await deleteBtn.click();
  await expect(page.getByText('keep-me.txt')).not.toBeVisible();

  // Cancel — discard changes
  await page.getByTestId('cancel-button').click();

  // Reopen — file should still be there
  await page.getByText('削除キャンセルテスト').click();
  await expect(page.getByTestId('attachments-list')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('keep-me.txt')).toBeVisible();
});

// --- マークダウン × 添付ファイル統合 ---

test('添付した画像がプレビューモードで画像として表示される', async ({ page, baseURL }) => {
  // Create task and upload a 1x1 PNG image via API
  const taskRes = await page.request.post(`${baseURL}/api/tasks`, {
    data: { name: '画像プレビューテスト', category: 'water', frequency_type: 'daily' },
  });
  const task = await taskRes.json();

  // Minimal valid 1x1 PNG
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

  // Update notes with markdown image
  await page.request.put(`${baseURL}/api/tasks/${task.id}`, {
    data: { ...task, notes: `![テスト画像](/api/attachments/${attachment.id})` },
  });

  await page.goto('/');
  await page.getByText('画像プレビューテスト').click();

  // Switch to preview
  await page.getByRole('button', { name: 'プレビュー' }).click();
  await expect(page.getByTestId('notes-preview').locator('img')).toBeVisible();
});
