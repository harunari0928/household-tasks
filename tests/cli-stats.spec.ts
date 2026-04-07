import { test, expect } from './fixtures/setup.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Page } from '@playwright/test';

const execAsync = promisify(exec);

async function createTaskViaUI(page: Page, options: { name: string; frequency_type: string; points?: number }) {
  await page.goto('/#/tasks');
  await page.getByRole('button', { name: /水回り/ }).click();
  await page.getByRole('button', { name: /タスクを追加/ }).click();
  await page.getByLabel('タスク名').fill(options.name);
  await page.getByLabel('頻度').selectOption(options.frequency_type);
  if (options.points) await page.getByLabel('ポイント').fill(String(options.points));
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

test.describe('ht stats（ポイント集計）', () => {
  test('完了タスクの担当者別ポイントが表示される', async ({ page }) => {
    // Arrange
    await createTaskViaUI(page, { name: 'stats-task', frequency_type: 'daily', points: 3 });
    await runScheduler('2026-04-07');
    const taskId = await getTaskId(page, 'stats-task');
    await runCli(`assign ${taskId} MTMR`);
    await runCli(`move ${taskId} done`);

    // Act
    const result = await runCli('stats --start 2026-04-01 --end 2026-04-30');

    // Assert
    await test.step('担当者名が出力に含まれる', async () => {
      expect(result.stdout).toContain('MTMR');
    });
    await test.step('ポイント数が出力に含まれる', async () => {
      expect(result.stdout).toContain('3');
    });
  });

  test('完了タスクがない期間では「No completed tasks found」と表示される', async () => {
    // Act
    const result = await runCli('stats --start 2020-01-01 --end 2020-01-31');

    // Assert
    expect(result.stdout).toContain('No completed tasks found');
  });
});
