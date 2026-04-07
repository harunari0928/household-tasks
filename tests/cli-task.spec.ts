import { test, expect } from './fixtures/setup.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Page } from '@playwright/test';

const execAsync = promisify(exec);

const CATEGORY_MAP: Record<string, string> = {
  water: '水回り', kitchen: 'キッチン', floor: 'フロア・室内',
  entrance: '玄関・ベランダ・その他', laundry: '洗濯・布もの', trash: 'ごみ関連',
  childcare: '育児タスク', cooking: '料理・食事タスク', lifestyle: '生活・その他',
};

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

test.describe('ht task list（タスク定義一覧）', () => {
  test('追加したタスク定義が一覧に表示される', async () => {
    // Arrange
    await runCli('task add --name cli-task-list-test --category water --frequency-type daily');

    // Act
    const result = await runCli('task list');

    // Assert
    expect(result.stdout).toContain('cli-task-list-test');
  });

  test('--category で指定カテゴリのタスクだけ表示される', async () => {
    // Arrange
    await runCli('task add --name cli-cat-water --category water --frequency-type daily');
    await runCli('task add --name cli-cat-kitchen --category kitchen --frequency-type daily');

    // Act
    const result = await runCli('task list --category water');

    // Assert
    await test.step('指定カテゴリのタスクが表示される', async () => {
      expect(result.stdout).toContain('cli-cat-water');
    });
    await test.step('他カテゴリのタスクは表示されない', async () => {
      expect(result.stdout).not.toContain('cli-cat-kitchen');
    });
  });

  test('--json でJSON形式の配列が出力される', async () => {
    // Arrange
    await runCli('task add --name cli-json-test --category water --frequency-type daily');

    // Act
    const result = await runCli('task list --json');

    // Assert
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((t: any) => t.name === 'cli-json-test')).toBe(true);
  });

  test('タスク定義がない場合「No task definitions found.」と表示される', async () => {
    // Act
    const result = await runCli('task list');

    // Assert
    expect(result.stdout).toContain('No task definitions found.');
  });
});

test.describe('ht task get（タスク定義詳細）', () => {
  test('タスク定義の名前・カテゴリ・頻度が表示される', async () => {
    // Arrange
    const addResult = await runCli('task add --name cli-get-test --category kitchen --frequency-type weekly --days-of-week mon,fri --points 5');
    const task = JSON.parse(addResult.stdout);

    // Act
    const result = await runCli(`task get ${task.id}`);

    // Assert
    await test.step('タスク名が表示される', async () => {
      expect(result.stdout).toContain('cli-get-test');
    });
    await test.step('カテゴリが表示される', async () => {
      expect(result.stdout).toContain('kitchen');
    });
    await test.step('頻度タイプが表示される', async () => {
      expect(result.stdout).toContain('weekly');
    });
    await test.step('ポイントが表示される', async () => {
      expect(result.stdout).toContain('5');
    });
  });

  test('--json でJSON形式のオブジェクトが出力される', async () => {
    // Arrange
    const addResult = await runCli('task add --name cli-get-json --category water --frequency-type daily');
    const task = JSON.parse(addResult.stdout);

    // Act
    const result = await runCli(`task get ${task.id} --json`);

    // Assert
    const parsed = JSON.parse(result.stdout);
    expect(parsed.name).toBe('cli-get-json');
  });
});

test.describe('ht task add（タスク定義追加）', () => {
  test('追加したタスクがタスク管理UIに表示される', async ({ page }) => {
    // Act
    await runCli('task add --name cli-add-ui-check --category water --frequency-type daily --points 2');

    // Assert
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: new RegExp(CATEGORY_MAP.water) }).click();
    await expect(page.getByText('cli-add-ui-check')).toBeVisible();
  });

  test('CLIの出力に追加されたタスクのIDと名前が含まれる', async () => {
    // Act
    const result = await runCli('task add --name cli-add-output --category floor --frequency-type daily');

    // Assert
    const parsed = JSON.parse(result.stdout);
    expect(parsed.name).toBe('cli-add-output');
    expect(typeof parsed.id).toBe('number');
  });
});

test.describe('ht task edit（タスク定義編集）', () => {
  test('編集したタスク名がタスク管理UIに反映される', async ({ page }) => {
    // Arrange
    const addResult = await runCli('task add --name cli-edit-before --category water --frequency-type daily');
    const task = JSON.parse(addResult.stdout);

    // Act
    await runCli(`task edit ${task.id} --name cli-edit-after`);

    // Assert
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: new RegExp(CATEGORY_MAP.water) }).click();
    await expect(page.getByText('cli-edit-after')).toBeVisible();
  });

  test('ポイントの変更がCLI出力に反映される', async () => {
    // Arrange
    const addResult = await runCli('task add --name cli-edit-points --category water --frequency-type daily --points 1');
    const task = JSON.parse(addResult.stdout);

    // Act
    const result = await runCli(`task edit ${task.id} --points 8`);

    // Assert
    const updated = JSON.parse(result.stdout);
    expect(updated.points).toBe(8);
  });
});

test.describe('ht task toggle（有効/無効切替）', () => {
  test('有効なタスクを無効にするとCLIに「inactive」と表示される', async () => {
    // Arrange
    const addResult = await runCli('task add --name cli-toggle-test --category water --frequency-type daily');
    const task = JSON.parse(addResult.stdout);

    // Act
    const result = await runCli(`task toggle ${task.id}`);

    // Assert
    expect(result.stdout).toContain('inactive');
  });

  test('無効にしたタスクを再度切り替えると「active」と表示される', async () => {
    // Arrange
    const addResult = await runCli('task add --name cli-toggle-twice --category water --frequency-type daily');
    const task = JSON.parse(addResult.stdout);
    await runCli(`task toggle ${task.id}`);

    // Act
    const result = await runCli(`task toggle ${task.id}`);

    // Assert
    expect(result.stdout).toContain('active');
    expect(result.stdout).not.toContain('inactive');
  });
});

test.describe('ht task delete（タスク定義削除）', () => {
  test('削除したタスクがタスク管理UIから消える', async ({ page }) => {
    // Arrange
    const addResult = await runCli('task add --name cli-delete-ui --category water --frequency-type daily');
    const task = JSON.parse(addResult.stdout);

    // Act
    await runCli(`task delete ${task.id}`);

    // Assert
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: new RegExp(CATEGORY_MAP.water) }).click();
    await expect(page.getByText('cli-delete-ui')).not.toBeVisible();
  });

  test('CLIの出力に削除完了メッセージが表示される', async () => {
    // Arrange
    const addResult = await runCli('task add --name cli-delete-msg --category water --frequency-type daily');
    const task = JSON.parse(addResult.stdout);

    // Act
    const result = await runCli(`task delete ${task.id}`);

    // Assert
    expect(result.stdout).toContain('deleted');
  });
});
