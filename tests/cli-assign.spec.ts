import { test, expect } from './fixtures/setup.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Page } from '@playwright/test';

const execAsync = promisify(exec);

async function createTaskViaUI(
  page: Page,
  options: { name: string; frequency_type: string },
) {
  await page.goto('/#/tasks');
  await page.getByRole('button', { name: /水回り/ }).click();
  await page.getByRole('button', { name: /タスクを追加/ }).click();
  await page.getByLabel('タスク名').fill(options.name);
  await page.getByLabel('頻度').selectOption(options.frequency_type);
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByText(options.name).waitFor();
}

async function runScheduler(testToday: string): Promise<string> {
  const { stdout, stderr } = await execAsync('node packages/scheduler/dist/index.js', {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_PATH: 'data/test_task_definitions.db',
      TEST_TODAY: testToday,
    },
    encoding: 'utf-8',
    timeout: 15000,
  });
  if (stderr) console.error('Scheduler stderr:', stderr);
  return stdout;
}

async function runCliAssign(args: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execAsync(
      `node packages/cli/dist/index.js assign ${args}`,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DB_PATH: 'data/test_task_definitions.db',
          WEB_URL: 'http://localhost:3101',
        },
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
  await page.request.put(`${baseURL}/api/kanban/assignees`, {
    data: { assignees },
  });
}

async function goToKanban(page: Page) {
  const res = await page.request.get('/api/kanban/assignees');
  const assignees = await res.json();
  if (assignees.length === 0) {
    await page.request.put('/api/kanban/assignees', {
      data: { assignees: ['デフォルト'] },
    });
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

test.describe('CLIで1人を担当者にアサインする', () => {
  test('担当者がカンバンカードに表示される', async ({ page, baseURL }) => {
    // Arrange
    await setupAssignees(page, baseURL!, ['MTMR']);
    await createTaskViaUI(page, { name: 'cli-single-assign', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    const taskId = await getTaskId(page, 'cli-single-assign');

    // Act
    await runCliAssign(`${taskId} MTMR`);
    await goToKanban(page);

    // Assert
    await expect(page.getByRole('button', { name: 'M MTMR', exact: true })).toBeVisible();
  });

  test('CLIの出力に担当者名が表示される', async ({ page, baseURL }) => {
    // Arrange
    await setupAssignees(page, baseURL!, ['MTMR']);
    await createTaskViaUI(page, { name: 'cli-output-single', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    const taskId = await getTaskId(page, 'cli-output-single');

    // Act
    const result = await runCliAssign(`${taskId} MTMR`);

    // Assert
    await expect(result.stdout).toContain(`Task ${taskId} assigned to MTMR.`);
  });
});

test.describe('CLIで複数人を担当者にアサインする', () => {
  test('複数の担当者がカンバンカードに表示される', async ({ page, baseURL }) => {
    // Arrange
    await setupAssignees(page, baseURL!, ['MTMR', 'こばゆか']);
    await createTaskViaUI(page, { name: 'cli-multi-assign', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    const taskId = await getTaskId(page, 'cli-multi-assign');

    // Act
    await runCliAssign(`${taskId} MTMR こばゆか`);
    await goToKanban(page);

    // Assert
    await expect(page.getByText('MTMR, こばゆか')).toBeVisible();
  });

  test('CLIの出力にカンマ区切りの担当者名が表示される', async ({ page, baseURL }) => {
    // Arrange
    await setupAssignees(page, baseURL!, ['MTMR', 'こばゆか']);
    await createTaskViaUI(page, { name: 'cli-output-multi', frequency_type: 'daily' });
    await runScheduler('2026-03-29');
    const taskId = await getTaskId(page, 'cli-output-multi');

    // Act
    const result = await runCliAssign(`${taskId} MTMR こばゆか`);

    // Assert
    await expect(result.stdout).toContain(`Task ${taskId} assigned to MTMR, こばゆか.`);
  });
});

test.describe('CLIアサインのエラーハンドリング', () => {
  test('存在しないタスクIDを指定するとエラーメッセージが出力される', async () => {
    // Act
    const result = await runCliAssign('99999 MTMR');

    // Assert
    await expect(result.exitCode).not.toBe(0);
    await expect(result.stderr).toContain('not found');
  });

  test('不正なIDを指定するとエラーメッセージが出力される', async () => {
    // Act
    const result = await runCliAssign('abc MTMR');

    // Assert
    await expect(result.exitCode).not.toBe(0);
    await expect(result.stderr).toContain('Invalid ID');
  });
});
