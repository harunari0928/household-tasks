import { test, expect } from './fixtures/setup.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// API を直接叩く（Vite の proxy を介さない）。webServer の API ポートに合わせる。
const API_BASE = `http://localhost:${process.env.TEST_API_PORT || '3101'}`;

/**
 * ごみ収集カレンダー連動のテスト。
 *
 * 2026-08 の実際の収集日を基準にしている:
 *   8/3(月) 燃せるごみ / 8/4(火・第1) かん類・びん類 / 8/5(水) トレー・プラ
 *   8/6(木) 燃せるごみ / 8/7(金・第1) 紙・布類 / 8/9(日) 収集なし
 *   8/11(火・第2) ペットボトル / 8/14(金・第2) 燃せないごみ / 8/28(金・第4) 特殊品
 */

async function runScheduler(testToday: string, testHour = 19): Promise<string> {
  const { stdout } = await execAsync('node packages/scheduler/dist/index.js', {
    cwd: process.cwd(),
    env: {
      ...(process.env as Record<string, string>),
      DB_PATH: 'data/test_task_definitions.db',
      TEST_TODAY: testToday,
      TEST_HOUR: String(testHour),
    },
    encoding: 'utf-8',
    timeout: 15000,
  });
  return stdout;
}

/** ごみ捨てタスク定義を作り、special_kind='garbage' を付けて返す */
async function createGarbageTask(page: any) {
  const createRes = await page.request.post(`${API_BASE}/api/tasks`, {
    data: {
      name: 'ゴミ捨て',
      category: 'trash',
      frequency_type: 'weekly',
      days_of_week: ['mon', 'tue', 'wed', 'thu', 'fri', 'sun'],
      scheduled_hour: 19,
    },
  });
  const task = await createRes.json();

  await page.request.post(`${API_BASE}/api/test/special-kind`, {
    data: { id: task.id, specialKind: 'garbage' },
  });
  return task;
}

async function getTodoTitles(page: any): Promise<string[]> {
  const res = await page.request.get(`${API_BASE}/api/kanban?status=todo`);
  const items = await res.json();
  return items.map((t: any) => t.title);
}

test.describe('ごみ収集カレンダー連動', () => {
  test('収集がある日は種類をタイトルに付けて起票する', async ({ page }) => {
    await createGarbageTask(page);

    await runScheduler('2026-08-06'); // 木 = 燃せるごみ

    const titles = await getTodoTitles(page);
    expect(titles).toContain('ゴミ捨て（燃せるごみ）');
  });

  test('収集が無い日（日曜）は起票しない', async ({ page }) => {
    await createGarbageTask(page);

    const output = await runScheduler('2026-08-09'); // 日 = 収集なし

    expect(output).toContain('SKIP (no garbage collection today)');
    const titles = await getTodoTitles(page);
    expect(titles.filter((t) => t.startsWith('ゴミ捨て'))).toHaveLength(0);
  });

  test('年末年始は収集なしとして起票しない', async ({ page }) => {
    await createGarbageTask(page);

    await runScheduler('2026-01-01'); // 木だが年末年始

    const titles = await getTodoTitles(page);
    expect(titles.filter((t) => t.startsWith('ゴミ捨て'))).toHaveLength(0);
  });

  test('非表示にした種類の日は起票せず、同じ曜日の別の種類は起票する', async ({ page }) => {
    await createGarbageTask(page);

    // ペットボトル（第2・第4 火）を非表示にする
    await page.request.put(`${API_BASE}/api/garbage`, {
      data: { hiddenTypes: ['pet_bottle'] },
    });

    // 8/11 は第2火曜 = ペットボトル → 起票されない
    await runScheduler('2026-08-11');
    let titles = await getTodoTitles(page);
    expect(titles.filter((t) => t.startsWith('ゴミ捨て'))).toHaveLength(0);

    // 8/4 は第1火曜 = かん類・びん類 → 起票される（同じ火曜でも種類が違う）
    await runScheduler('2026-08-04');
    titles = await getTodoTitles(page);
    expect(titles).toContain('ゴミ捨て（かん類・びん類）');
  });

  test('GET /api/garbage は種類一覧と次回の収集日を返す', async ({ page }) => {
    await createGarbageTask(page);

    const res = await page.request.get(`${API_BASE}/api/garbage`);
    const body = await res.json();

    expect(body.types).toHaveLength(7);
    expect(body.types[0]).toMatchObject({ id: 'burnable', label: '燃せるごみ' });
    expect(body.hiddenTypes).toEqual([]);
    expect(body.next).not.toBeNull();
  });

  test('不正な種類IDは保存できない', async ({ page }) => {
    const res = await page.request.put(`${API_BASE}/api/garbage`, {
      data: { hiddenTypes: ['not_a_real_type'] },
    });

    expect(res.status()).toBe(400);
  });
});

test.describe('ごみ捨てタスクの削除保護', () => {
  test('special_kind 付きのタスク定義は削除できない', async ({ page }) => {
    const task = await createGarbageTask(page);

    const res = await page.request.delete(`${API_BASE}/api/tasks/${task.id}`);

    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('削除できません');

    // 定義が残っていることを確認
    const check = await page.request.get(`${API_BASE}/api/tasks/${task.id}`);
    expect(check.ok()).toBeTruthy();
  });

  test('通常のタスク定義は削除できる', async ({ page }) => {
    const createRes = await page.request.post(`${API_BASE}/api/tasks`, {
      data: { name: '普通のタスク', category: 'water', frequency_type: 'daily' },
    });
    const task = await createRes.json();

    const res = await page.request.delete(`${API_BASE}/api/tasks/${task.id}`);

    expect(res.ok()).toBeTruthy();
  });

  test('無効化（is_active トグル）は special_kind 付きでもできる', async ({ page }) => {
    const task = await createGarbageTask(page);

    const res = await page.request.post(`${API_BASE}/api/tasks/${task.id}/toggle`);

    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    expect(updated.is_active).toBe(0);
  });
});
