import { test, expect } from './fixtures/setup.js';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Page } from '@playwright/test';

const execAsync = promisify(exec);

let vikunjaStub: Server;
let vikunjaRequests: { method: string; url: string; body: any }[];
let stubPort: number;
let stubResponseOverride: ((req: IncomingMessage) => { status: number; body: any }) | null = null;

test.beforeAll(async () => {
  vikunjaStub = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      vikunjaRequests.push({
        method: req.method!,
        url: req.url!,
        body: body ? JSON.parse(body) : null,
      });
      const response = stubResponseOverride?.(req) || { status: 200, body: { id: Date.now() } };
      res.writeHead(response.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response.body));
    });
  });
  await new Promise<void>((resolve) => {
    vikunjaStub.listen(0, '127.0.0.1', () => {
      stubPort = (vikunjaStub.address() as any).port;
      resolve();
    });
  });
});

test.afterAll(async () => {
  vikunjaStub.close();
});

test.beforeEach(async () => {
  vikunjaRequests = [];
  stubResponseOverride = null;
});

async function runScheduler(testToday: string, projectId = '1'): Promise<string> {
  const { stdout, stderr } = await execAsync('node packages/scheduler/dist/index.js', {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_PATH: 'data/test_task_definitions.db',
      VIKUNJA_URL: `http://127.0.0.1:${stubPort}/api/v1`,
      VIKUNJA_API_TOKEN: 'test-token',
      DEFAULT_PROJECT_ID: projectId,
      TEST_TODAY: testToday,
    },
    encoding: 'utf-8',
    timeout: 15000,
  });
  if (stderr) console.error('Scheduler stderr:', stderr);
  return stdout;
}

function getCreateRequests() {
  return vikunjaRequests.filter((r) => r.method === 'PUT' && r.url.includes('/tasks'));
}

const DAY_MAP: Record<string, string> = {
  mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日',
};

const CATEGORY_MAP: Record<string, string> = {
  water: '水回り', kitchen: 'キッチン', floor: 'フロア・室内',
  entrance: '玄関・ベランダ・その他', laundry: '洗濯・布もの', trash: 'ごみ関連',
  childcare: '育児タスク', cooking: '料理・食事タスク', lifestyle: '生活・その他',
};

async function createTaskViaUI(
  page: Page,
  baseURL: string,
  options: {
    name: string;
    category?: string;
    frequency_type: string;
    days_of_week?: string[];
    frequency_interval?: number;
    day_of_month?: number;
  },
) {
  const category = options.category || 'water';
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(CATEGORY_MAP[category]) }).click();
  await page.getByRole('button', { name: /タスクを追加/ }).click();
  await page.getByLabel('タスク名').fill(options.name);
  await page.getByLabel('カテゴリ').selectOption(options.category || 'water');
  await page.getByLabel('頻度').selectOption(options.frequency_type);

  if (options.days_of_week) {
    for (const day of options.days_of_week) {
      await page.getByRole('group', { name: '曜日' }).getByText(DAY_MAP[day]).click();
    }
  }
  if (options.frequency_interval != null) {
    await page.getByLabel('間隔').fill(String(options.frequency_interval));
  }
  if (options.day_of_month != null) {
    await page.getByLabel(/日指定/).fill(String(options.day_of_month));
  }

  await page.getByRole('button', { name: '保存' }).click();
  await page.getByText(options.name).waitFor();

  const res = await page.request.get(`${baseURL}/api/tasks`);
  const tasks = await res.json();
  return tasks.find((t: any) => t.name === options.name);
}

// --- Fixed schedule tests ---

test('dailyタスクは毎日起票される', async ({ page, baseURL }) => {
  await createTaskViaUI(page, baseURL!, { name: 'daily-test', category: 'water', frequency_type: 'daily' });

  const output = await runScheduler('2026-03-14');

  expect(output).toContain('CREATED');
  expect(getCreateRequests()).toHaveLength(1);
  expect(getCreateRequests()[0].body.title).toBe('daily-test');
});

test('weeklyタスクは対象曜日にのみ起票される', async ({ page, baseURL }) => {
  await createTaskViaUI(page, baseURL!, { name: 'weekly-mon', category: 'water', frequency_type: 'weekly', days_of_week: ['mon'] });

  // 対象曜日(月曜)
  await runScheduler('2026-03-16'); // Monday

  await test.step('対象曜日(月曜)に起票される', async () => {
    expect(getCreateRequests()).toHaveLength(1);
  });

  // 対象外曜日(火曜)
  vikunjaRequests = [];
  await runScheduler('2026-03-17'); // Tuesday

  await test.step('対象外曜日(火曜)は起票されない', async () => {
    expect(getCreateRequests()).toHaveLength(0);
  });
});

test('monthlyタスクは指定日にのみ起票される', async ({ page, baseURL }) => {
  await createTaskViaUI(page, baseURL!, { name: 'monthly-15', category: 'water', frequency_type: 'monthly', day_of_month: 15 });

  // 指定日(15日)
  await runScheduler('2026-03-15');

  await test.step('指定日(15日)に起票される', async () => {
    expect(getCreateRequests()).toHaveLength(1);
  });

  // 指定日以外(16日)
  vikunjaRequests = [];
  await runScheduler('2026-03-16');

  await test.step('指定日以外(16日)は起票されない', async () => {
    expect(getCreateRequests()).toHaveLength(0);
  });
});

// --- Interval-based tests ---

test('n_daysタスクはnext_due_date到達時に起票され、次回予定日が更新される', async ({ page, baseURL }) => {
  const task = await createTaskViaUI(page, baseURL!, { name: 'n-days-3', category: 'water', frequency_type: 'n_days', frequency_interval: 3 });
  const dueDate = task.next_due_date;

  // next_due_date到達時に実行
  await runScheduler(dueDate);

  await test.step('起票される', async () => {
    expect(getCreateRequests()).toHaveLength(1);
  });

  await test.step('次回予定日が更新される', async () => {
    const res = await page.request.get(`${baseURL}/api/tasks/${task.id}`);
    const updated = await res.json();
    expect(updated.next_due_date).not.toBe(dueDate);
  });
});

test('n_daysタスクはnext_due_date前は起票されない', async ({ page, baseURL }) => {
  const task = await createTaskViaUI(page, baseURL!, { name: 'n-days-before', category: 'water', frequency_type: 'n_days', frequency_interval: 3 });
  const dueDate = new Date(task.next_due_date + 'T00:00:00');
  dueDate.setDate(dueDate.getDate() - 1);
  const beforeDue = dueDate.toISOString().split('T')[0];

  await runScheduler(beforeDue);

  expect(getCreateRequests()).toHaveLength(0);
});

test('Cronスキップ後も元のリズムに復帰する', async ({ page, baseURL }) => {
  const task = await createTaskViaUI(page, baseURL!, { name: 'rhythm-test', category: 'water', frequency_type: 'n_days', frequency_interval: 3 });
  const dueDate = task.next_due_date;

  function addDays(dateStr: string, n: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return dt.toISOString().split('T')[0];
  }

  const lateDate = addDays(dueDate, 1);

  // 遅延実行
  await runScheduler(lateDate);

  await test.step('遅延実行で起票される', async () => {
    expect(getCreateRequests()).toHaveLength(1);
  });

  await test.step('次回予定日が元のリズムで設定される', async () => {
    const res2 = await page.request.get(`${baseURL}/api/tasks/${task.id}`);
    const updated = await res2.json();
    const expectedNext = addDays(dueDate, 3);
    expect(updated.next_due_date).toBe(expectedNext);
  });
});

// --- Idempotency ---

test('同日に2回実行しても重複起票しない', async ({ page, baseURL }) => {
  await createTaskViaUI(page, baseURL!, { name: 'idempotent-test', category: 'water', frequency_type: 'daily' });

  // 1回目
  await runScheduler('2026-03-14');

  await test.step('1回目は起票される', async () => {
    expect(getCreateRequests()).toHaveLength(1);
  });

  // 2回目
  vikunjaRequests = [];
  await runScheduler('2026-03-14');

  await test.step('2回目は重複起票しない', async () => {
    expect(getCreateRequests()).toHaveLength(0);
  });
});

test('Vikunjaに未完了の同名タスクがあればスキップする', async ({ page, baseURL }) => {
  await createTaskViaUI(page, baseURL!, { name: 'duplicate-check', category: 'water', frequency_type: 'daily' });
  stubResponseOverride = (req) => {
    if (req.method === 'GET' && req.url!.includes('/tasks')) {
      return { status: 200, body: [{ title: 'duplicate-check', done: false }] };
    }
    return { status: 200, body: { id: 999 } };
  };

  const output = await runScheduler('2026-03-14');

  await test.step('スキップされる', async () => {
    expect(output).toContain('SKIP (duplicate)');
    expect(getCreateRequests()).toHaveLength(0);
  });

  await test.step('execution_logにskipped_duplicateが記録される', async () => {
    const logsRes = await page.request.get(`${baseURL}/api/logs`);
    const logs = await logsRes.json();
    expect(logs.some((l: any) => l.status === 'skipped_duplicate')).toBe(true);
  });
});

// --- Failure & retry ---

test('Vikunja APIエラー時にfailedが記録され、次回実行でリトライされる', async ({ page, baseURL }) => {
  await createTaskViaUI(page, baseURL!, { name: 'retry-test', category: 'water', frequency_type: 'daily' });
  stubResponseOverride = (req) => {
    if (req.method === 'PUT') {
      return { status: 500, body: { message: 'Internal error' } };
    }
    return { status: 200, body: [] };
  };

  // エラー発生
  await runScheduler('2026-03-14');

  await test.step('failedが記録される', async () => {
    const logsRes1 = await page.request.get(`${baseURL}/api/logs`);
    const logs1 = await logsRes1.json();
    expect(logs1.some((l: any) => l.status === 'failed')).toBe(true);
  });

  // リトライ
  vikunjaRequests = [];
  stubResponseOverride = null;
  await runScheduler('2026-03-15');

  await test.step('次回実行でリトライされ成功する', async () => {
    const logsRes2 = await page.request.get(`${baseURL}/api/logs`);
    const logs2 = await logsRes2.json();
    expect(logs2.some((l: any) => l.status === 'created')).toBe(true);
  });
});

// --- API request format ---

test('Vikunjaへのタスク作成リクエストが正しい形式で送信される', async ({ page, baseURL }) => {
  await createTaskViaUI(page, baseURL!, { name: 'format-test', category: 'kitchen', frequency_type: 'daily' });

  await runScheduler('2026-03-14', '42');

  const createReqs = getCreateRequests();
  expect(createReqs).toHaveLength(1);
  expect(createReqs[0].method).toBe('PUT');
  expect(createReqs[0].url).toContain('/projects/42/tasks');
  expect(createReqs[0].body.title).toBe('format-test');
  expect(createReqs[0].body.description).toBeTruthy();
});

// --- Active/inactive ---

test('is_active=0のタスクは起票されない', async ({ page, baseURL }) => {
  await createTaskViaUI(page, baseURL!, { name: 'inactive-test', category: 'water', frequency_type: 'daily' });
  await page.getByRole('button', { name: '無効にする' }).click();

  await runScheduler('2026-03-14');

  expect(getCreateRequests()).toHaveLength(0);
});

test('一時停止から再開時、next_due_dateが過去なら即座に起票される', async ({ page, baseURL }) => {
  await createTaskViaUI(page, baseURL!, { name: 'resume-test', category: 'water', frequency_type: 'n_days', frequency_interval: 3 });
  await page.getByRole('button', { name: '無効にする' }).click();
  await page.getByRole('button', { name: '有効にする' }).click();

  await runScheduler('2026-12-01');

  expect(getCreateRequests()).toHaveLength(1);
});
