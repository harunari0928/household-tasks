import { test, expect } from './fixtures/setup.js';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let vikunjaStub: Server;
let vikunjaRequests: { method: string; url: string; body: any }[] = [];
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

async function runScheduler(testToday: string): Promise<string> {
  const { stdout, stderr } = await execAsync('node packages/scheduler/dist/index.js', {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_PATH: 'data/test_task_definitions.db',
      VIKUNJA_URL: `http://127.0.0.1:${stubPort}/api/v1`,
      VIKUNJA_API_TOKEN: 'test-token',
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

async function createTask(baseURL: string, input: any) {
  const res = await fetch(`${baseURL}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return res.json();
}

async function setConfig(baseURL: string, key: string, value: string) {
  await fetch(`${baseURL}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [key]: value }),
  });
}

// --- Fixed schedule tests ---

test('dailyタスクは毎日起票される', async ({ baseURL }) => {
  await createTask(baseURL!, { name: 'daily-test', category: 'water', frequency_type: 'daily' });
  await setConfig(baseURL!, 'default_project_id', '1');

  const output = await runScheduler('2026-03-14');
  expect(output).toContain('CREATED');
  expect(getCreateRequests()).toHaveLength(1);
  expect(getCreateRequests()[0].body.title).toBe('daily-test');
});

test('weeklyタスクは対象曜日にのみ起票される', async ({ baseURL }) => {
  // 2026-03-16 is Monday
  await createTask(baseURL!, { name: 'weekly-mon', category: 'water', frequency_type: 'weekly', days_of_week: ['mon'] });
  await setConfig(baseURL!, 'default_project_id', '1');

  await runScheduler('2026-03-16'); // Monday
  expect(getCreateRequests()).toHaveLength(1);

  vikunjaRequests = [];
  await runScheduler('2026-03-17'); // Tuesday
  expect(getCreateRequests()).toHaveLength(0);
});

test('monthlyタスクは指定日にのみ起票される', async ({ baseURL }) => {
  await createTask(baseURL!, { name: 'monthly-15', category: 'water', frequency_type: 'monthly', day_of_month: 15 });
  await setConfig(baseURL!, 'default_project_id', '1');

  await runScheduler('2026-03-15');
  expect(getCreateRequests()).toHaveLength(1);

  vikunjaRequests = [];
  await runScheduler('2026-03-16');
  expect(getCreateRequests()).toHaveLength(0);
});

// --- Interval-based tests ---

test('n_daysタスクはnext_due_date到達時に起票され、次回予定日が更新される', async ({ baseURL }) => {
  const task = await createTask(baseURL!, { name: 'n-days-3', category: 'water', frequency_type: 'n_days', frequency_interval: 3 });
  await setConfig(baseURL!, 'default_project_id', '1');

  const dueDate = task.next_due_date;
  await runScheduler(dueDate);
  expect(getCreateRequests()).toHaveLength(1);

  // Check next_due_date updated
  const res = await fetch(`${baseURL}/api/tasks/${task.id}`);
  const updated = await res.json();
  expect(updated.next_due_date).not.toBe(dueDate);
});

test('n_daysタスクはnext_due_date前は起票されない', async ({ baseURL }) => {
  const task = await createTask(baseURL!, { name: 'n-days-before', category: 'water', frequency_type: 'n_days', frequency_interval: 3 });
  await setConfig(baseURL!, 'default_project_id', '1');

  const dueDate = new Date(task.next_due_date + 'T00:00:00');
  dueDate.setDate(dueDate.getDate() - 1);
  const beforeDue = dueDate.toISOString().split('T')[0];

  await runScheduler(beforeDue);
  expect(getCreateRequests()).toHaveLength(0);
});

test('Cronスキップ後も元のリズムに復帰する', async ({ baseURL }) => {
  await setConfig(baseURL!, 'default_project_id', '1');

  const task = await createTask(baseURL!, { name: 'rhythm-test', category: 'water', frequency_type: 'n_days', frequency_interval: 3 });

  // Re-read current state
  const res1 = await fetch(`${baseURL}/api/tasks/${task.id}`);
  const current = await res1.json();
  const dueDate = current.next_due_date; // e.g. "2026-03-17"

  // Helper: add days to YYYY-MM-DD string
  function addDays(dateStr: string, n: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return dt.toISOString().split('T')[0];
  }

  // Run scheduler 1 day late from the due date
  const lateDate = addDays(dueDate, 1);
  await runScheduler(lateDate);
  expect(getCreateRequests()).toHaveLength(1);

  // Check: next_due_date should be original due + 3 (not late + 3)
  const res2 = await fetch(`${baseURL}/api/tasks/${task.id}`);
  const updated = await res2.json();
  const expectedNext = addDays(dueDate, 3);
  expect(updated.next_due_date).toBe(expectedNext);
});

// --- Idempotency ---

test('同日に2回実行しても重複起票しない', async ({ baseURL }) => {
  await createTask(baseURL!, { name: 'idempotent-test', category: 'water', frequency_type: 'daily' });
  await setConfig(baseURL!, 'default_project_id', '1');

  await runScheduler('2026-03-14');
  expect(getCreateRequests()).toHaveLength(1);

  vikunjaRequests = [];
  await runScheduler('2026-03-14');
  expect(getCreateRequests()).toHaveLength(0);
});

test('Vikunjaに未完了の同名タスクがあればスキップする', async ({ baseURL }) => {
  await createTask(baseURL!, { name: 'duplicate-check', category: 'water', frequency_type: 'daily' });
  await setConfig(baseURL!, 'default_project_id', '1');

  stubResponseOverride = (req) => {
    if (req.method === 'GET' && req.url!.includes('/tasks')) {
      return { status: 200, body: [{ title: 'duplicate-check', done: false }] };
    }
    return { status: 200, body: { id: 999 } };
  };

  const output = await runScheduler('2026-03-14');
  expect(output).toContain('SKIP (duplicate)');
  expect(getCreateRequests()).toHaveLength(0);

  const logsRes = await fetch(`${baseURL}/api/logs`);
  const logs = await logsRes.json();
  expect(logs.some((l: any) => l.status === 'skipped_duplicate')).toBe(true);
});

// --- Failure & retry ---

test('Vikunja APIエラー時にfailedが記録され、次回実行でリトライされる', async ({ baseURL }) => {
  await createTask(baseURL!, { name: 'retry-test', category: 'water', frequency_type: 'daily' });
  await setConfig(baseURL!, 'default_project_id', '1');

  stubResponseOverride = (req) => {
    if (req.method === 'PUT') {
      return { status: 500, body: { message: 'Internal error' } };
    }
    return { status: 200, body: [] };
  };

  await runScheduler('2026-03-14');
  const logsRes1 = await fetch(`${baseURL}/api/logs`);
  const logs1 = await logsRes1.json();
  expect(logs1.some((l: any) => l.status === 'failed')).toBe(true);

  vikunjaRequests = [];
  stubResponseOverride = null;

  await runScheduler('2026-03-15');
  const logsRes2 = await fetch(`${baseURL}/api/logs`);
  const logs2 = await logsRes2.json();
  expect(logs2.some((l: any) => l.status === 'created')).toBe(true);
});

// --- API request format ---

test('Vikunjaへのタスク作成リクエストが正しい形式で送信される', async ({ baseURL }) => {
  await createTask(baseURL!, { name: 'format-test', category: 'kitchen', frequency_type: 'daily' });
  await setConfig(baseURL!, 'default_project_id', '42');

  await runScheduler('2026-03-14');

  const createReqs = getCreateRequests();
  expect(createReqs).toHaveLength(1);
  expect(createReqs[0].method).toBe('PUT');
  expect(createReqs[0].url).toContain('/projects/42/tasks');
  expect(createReqs[0].body.title).toBe('format-test');
  expect(createReqs[0].body.description).toBeTruthy();
});

// --- Active/inactive ---

test('is_active=0のタスクは起票されない', async ({ baseURL }) => {
  const task = await createTask(baseURL!, { name: 'inactive-test', category: 'water', frequency_type: 'daily' });
  await setConfig(baseURL!, 'default_project_id', '1');

  await fetch(`${baseURL}/api/tasks/${task.id}/toggle`, { method: 'POST' });

  await runScheduler('2026-03-14');
  expect(getCreateRequests()).toHaveLength(0);
});

test('一時停止から再開時、next_due_dateが過去なら即座に起票される', async ({ baseURL }) => {
  const task = await createTask(baseURL!, { name: 'resume-test', category: 'water', frequency_type: 'n_days', frequency_interval: 3 });
  await setConfig(baseURL!, 'default_project_id', '1');

  await fetch(`${baseURL}/api/tasks/${task.id}/toggle`, { method: 'POST' });
  await fetch(`${baseURL}/api/tasks/${task.id}/toggle`, { method: 'POST' });

  await runScheduler('2026-12-01');
  expect(getCreateRequests()).toHaveLength(1);
});
