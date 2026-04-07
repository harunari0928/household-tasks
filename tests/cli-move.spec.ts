import { test, expect } from './fixtures/setup.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Page } from '@playwright/test';

const execAsync = promisify(exec);

async function createTaskViaUI(page: Page, options: { name: string; frequency_type: string }) {
  await page.goto('/#/tasks');
  await page.getByRole('button', { name: /水回り/ }).click();
  await page.getByRole('button', { name: /タスクを追加/ }).click();
  await page.getByLabel('タスク名').fill(options.name);
  await page.getByLabel('頻度').selectOption(options.frequency_type);
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByText(options.name).waitFor();
}

async function runScheduler(testToday: string): Promise<string> {
  const { stdout } = await execAsync('node packages/scheduler/dist/index.js', {
    cwd: process.cwd(),
    env: { ...process.env, DB_PATH: 'data/test_task_definitions.db', TEST_TODAY: testToday },
    encoding: 'utf-8',
    timeout: 15000,
  });
  return stdout;
}

async function runCli(args: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execAsync(
      `node packages/cli/dist/index.js ${args}`,
      {
        cwd: process.cwd(),
        env: { ...process.env, DB_PATH: 'data/test_task_definitions.db', WEB_URL: 'http://localhost:3101' },
        encoding: 'utf-8',
        timeout: 15000,
      },
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.code ?? 1 };
  }
}

async function setupAssignees(page: Page, baseURL: string, assignees: string[]) {
  await page.request.put(`${baseURL}/api/kanban/assignees`, { data: { assignees } });
}

async function goToKanban(page: Page) {
  const res = await page.request.get('/api/kanban/assignees');
  const assignees = await res.json();
  if (assignees.length === 0) {
    await page.request.put('/api/kanban/assignees', { data: { assignees: ['デフォルト'] } });
  }
  await page.goto('about:blank');
  await page.goto('/#/');
  await page.getByText('未着手').waitFor();
}

async function getTaskId(page: Page, taskName: string): Promise<number> {
  const res = await page.request.get('/api/kanban');
  const tasks = await res.json();
  const task = tasks.find((t: any) => t.title === taskName);
  if (!task) throw new Error(`Task "${taskName}" not found`);
  return task.id;
}

test.describe('ht move（ステータス変更）', () => {
  test('進行中に変更するとカンバンの進行中列に表示される', async ({ page, baseURL }) => {
    // Arrange
    await setupAssignees(page, baseURL!, ['MTMR']);
    await createTaskViaUI(page, { name: 'move-to-progress', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    const taskId = await getTaskId(page, 'move-to-progress');

    // Act
    await runCli(`move ${taskId} in_progress`);
    await goToKanban(page);

    // Assert
    const progressColumn = page.locator('[data-column-status="in_progress"]');
    await expect(progressColumn.getByText('move-to-progress')).toBeVisible();
  });

  test('完了に変更するとカンバンの完了列に表示される', async ({ page, baseURL }) => {
    // Arrange
    await setupAssignees(page, baseURL!, ['MTMR']);
    await createTaskViaUI(page, { name: 'move-to-done', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    const taskId = await getTaskId(page, 'move-to-done');

    // Act
    await runCli(`move ${taskId} done`);
    await goToKanban(page);

    // Assert
    const doneColumn = page.locator('[data-column-status="done"]');
    await expect(doneColumn.getByText('move-to-done')).toBeVisible();
  });

  test('CLIの出力に変更後のステータスが表示される', async ({ page, baseURL }) => {
    // Arrange
    await setupAssignees(page, baseURL!, ['MTMR']);
    await createTaskViaUI(page, { name: 'move-output', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    const taskId = await getTaskId(page, 'move-output');

    // Act
    const result = await runCli(`move ${taskId} in_progress`);

    // Assert
    expect(result.stdout).toContain(`Task ${taskId} moved to in_progress.`);
  });
});

test.describe('ht move のエラーハンドリング', () => {
  test('無効なステータスを指定するとエラーメッセージが出力される', async () => {
    // Act
    const result = await runCli('move 1 invalid_status');

    // Assert
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Invalid status');
  });

  test('存在しないタスクIDを指定するとエラーメッセージが出力される', async () => {
    // Act
    const result = await runCli('move 99999 todo');

    // Assert
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('not found');
  });

  test('不正なIDを指定するとエラーメッセージが出力される', async () => {
    // Act
    const result = await runCli('move abc todo');

    // Assert
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Invalid ID');
  });
});
