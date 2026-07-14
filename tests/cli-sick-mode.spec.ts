import { test, expect } from './fixtures/setup.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Page } from '@playwright/test';

const execAsync = promisify(exec);

async function runCli(args: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execAsync(
      `node packages/cli/dist/index.js ${args}`,
      {
        cwd: process.cwd(),
        env: { ...process.env, DB_PATH: 'data/test_task_definitions.db', WEB_URL: `http://localhost:${process.env.TEST_API_PORT ?? '3101'}` },
        encoding: 'utf-8',
        timeout: 15000,
      },
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.code ?? 1 };
  }
}

async function createTaskDef(
  page: Page,
  baseURL: string,
  options: { name: string; sick_day_behavior: string; withInstance?: boolean },
) {
  const res = await page.request.post(`${baseURL}/api/tasks`, {
    data: {
      name: options.name,
      category: 'childcare',
      frequency_type: 'daily',
      scheduled_hour: 0,
      sick_day_behavior: options.sick_day_behavior,
    },
  });
  const def = await res.json();
  if (options.withInstance) {
    await page.request.post(`${baseURL}/api/kanban/create-from-definition/${def.id}`);
  }
  return def;
}

test.describe('ht sick-mode（子ども風邪の日モード）', () => {
  test('引数なしで現在の状態が表示される', async () => {
    // Act
    const result = await runCli('sick-mode');

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('OFF');
  });

  test('onで有効化すると病児タスクが起票され、状態確認でONになる', async ({ page, baseURL }) => {
    // Arrange
    await createTaskDef(page, baseURL!, { name: 'cli-薬を飲ませる', sick_day_behavior: 'sick_only' });

    // Act
    const onResult = await runCli('sick-mode on');

    // Assert
    await test.step('ONになり起票数が報告される', async () => {
      expect(onResult.exitCode).toBe(0);
      expect(onResult.stdout).toContain('ON');
      expect(onResult.stdout).toContain('Created 1 sick-day task instance(s).');
    });
    await test.step('状態確認でONと表示される', async () => {
      const status = await runCli('sick-mode');
      expect(status.stdout).toContain('ON');
    });
  });

  test('offで無効化すると状態確認でOFFになる', async () => {
    // Arrange
    await runCli('sick-mode on');

    // Act
    const offResult = await runCli('sick-mode off');

    // Assert
    expect(offResult.exitCode).toBe(0);
    expect(offResult.stdout).toContain('OFF');
  });

  test('on/off以外の引数を渡すとエラー終了する', async () => {
    // Act
    const result = await runCli('sick-mode maybe');

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('state must be "on" or "off"');
  });

  test('ht list はモードに応じてカンバンボードと同じタスクだけを表示する', async ({ page, baseURL }) => {
    // Arrange
    await createTaskDef(page, baseURL!, { name: 'cli-床掃除', sick_day_behavior: 'normal_only', withInstance: true });
    await createTaskDef(page, baseURL!, { name: 'cli-ゴミ捨て', sick_day_behavior: 'always', withInstance: true });
    await createTaskDef(page, baseURL!, { name: 'cli-病院の予約', sick_day_behavior: 'sick_only' });

    await test.step('モードOFF: 通常タスクのみ表示される', async () => {
      const result = await runCli('list');
      expect(result.stdout).toContain('cli-床掃除');
      expect(result.stdout).toContain('cli-ゴミ捨て');
      expect(result.stdout).not.toContain('cli-病院の予約');
    });

    await runCli('sick-mode on');

    await test.step('モードON: 病児タスクと常時タスクだけ表示される', async () => {
      const result = await runCli('list');
      expect(result.stdout).not.toContain('cli-床掃除');
      expect(result.stdout).toContain('cli-ゴミ捨て');
      expect(result.stdout).toContain('cli-病院の予約');
    });
  });

  test('ht task list に風邪の日の扱い（SickDay列）が表示される', async ({ page, baseURL }) => {
    // Arrange
    await createTaskDef(page, baseURL!, { name: 'cli-sickday-col', sick_day_behavior: 'sick_only' });

    // Act
    const result = await runCli('task list --category childcare');

    // Assert
    expect(result.stdout).toContain('SickDay');
    expect(result.stdout).toContain('sick_only');
  });
});
