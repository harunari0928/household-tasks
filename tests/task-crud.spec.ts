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
