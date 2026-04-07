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

async function getTaskId(page: Page, taskName: string): Promise<number> {
  const res = await page.request.get('/api/kanban');
  const tasks = await res.json();
  const task = tasks.find((t: any) => t.title === taskName);
  if (!task) throw new Error(`Task "${taskName}" not found`);
  return task.id;
}

test.describe('ht list（タスクインスタンス一覧）', () => {
  test('起票されたタスクの名前・ステータスが一覧に表示される', async ({ page }) => {
    // Arrange
    await createTaskViaUI(page, { name: 'list-test-task', frequency_type: 'daily' });
    await runScheduler('2026-03-29');

    // Act
    const result = await runCli('list');

    // Assert
    await test.step('タスク名が出力に含まれる', async () => {
      expect(result.stdout).toContain('list-test-task');
    });
    await test.step('ステータスが出力に含まれる', async () => {
      expect(result.stdout).toContain('todo');
    });
  });

  test('--status で指定したステータスのタスクだけ表示される', async ({ page, baseURL }) => {
    // Arrange
    await createTaskViaUI(page, { name: 'list-status-filter', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    const taskId = await getTaskId(page, 'list-status-filter');
    await runCli(`move ${taskId} in_progress`);

    // Act
    const todoResult = await runCli('list --status todo');
    const inProgressResult = await runCli('list --status in_progress');

    // Assert
    await test.step('未着手一覧にはフィルタしたタスクが含まれない', async () => {
      expect(todoResult.stdout).not.toContain('list-status-filter');
    });
    await test.step('進行中一覧にフィルタしたタスクが含まれる', async () => {
      expect(inProgressResult.stdout).toContain('list-status-filter');
    });
  });

  test('--assignee で指定した担当者のタスクだけ表示される', async ({ page, baseURL }) => {
    // Arrange
    await createTaskViaUI(page, { name: 'list-assignee-a', frequency_type: 'daily' });
    await createTaskViaUI(page, { name: 'list-assignee-b', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    const idA = await getTaskId(page, 'list-assignee-a');
    await runCli(`assign ${idA} ALICE`);

    // Act
    const result = await runCli('list --assignee ALICE');

    // Assert
    await test.step('指定した担当者のタスクが表示される', async () => {
      expect(result.stdout).toContain('list-assignee-a');
    });
    await test.step('別の担当者のタスクは表示されない', async () => {
      expect(result.stdout).not.toContain('list-assignee-b');
    });
  });

  test('タスクが存在しない場合「No tasks found.」と表示される', async () => {
    // Act
    const result = await runCli('list');

    // Assert
    expect(result.stdout).toContain('No tasks found.');
  });
});
