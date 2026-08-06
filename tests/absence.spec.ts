import { test, expect } from './fixtures/setup.js';
import type { Page } from '@playwright/test';

function getTodayJST(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().split('T')[0];
}

/** 不在日一覧の表示書式（例: 9/19(土)）に合わせる */
function formatDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}(${weekday})`;
}

const CATEGORY_MAP: Record<string, string> = {
  water: '水回り', kitchen: 'キッチン', floor: 'フロア・室内',
  entrance: '玄関・ベランダ・その他', laundry: '洗濯・布もの', trash: 'ごみ関連',
  childcare: '育児タスク', cooking: '料理・食事タスク', lifestyle: '生活・その他',
};

/**
 * タスクをフォームから作り、起票済みのカードをカンバンに置く。
 * 「不在時の扱い」はフォームのセレクトで選ぶ。
 */
async function createTaskWithAbsenceBehavior(
  page: Page,
  baseURL: string,
  options: { name: string; category: string; behaviorLabel: '不在でも表示' | '不在中は非表示' },
) {
  await page.goto('/#/tasks');
  await page.getByRole('button', { name: new RegExp(CATEGORY_MAP[options.category]) }).click();
  await page.getByRole('button', { name: /タスクを追加/ }).click();
  await page.getByLabel('タスク名').fill(options.name);
  await page.getByLabel('カテゴリ').selectOption(options.category);
  await page.getByLabel('頻度').selectOption('daily');
  await page.getByLabel('不在時の扱い').selectOption({ label: options.behaviorLabel });
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByText(options.name).waitFor();

  const res = await page.request.get(`${baseURL}/api/tasks`);
  const def = (await res.json()).find((t: { name: string }) => t.name === options.name);
  await page.request.post(`${baseURL}/api/kanban/create-from-definition/${def.id}`);
  return def;
}

/**
 * 家族カレンダーの不在日が同期されてきた状態にする。
 *
 * 予定名の判定と期間の日付への展開は Home Assistant 側が済ませてから
 * 日付リストを送ってくるので、テストも展開後の日付を渡す。
 */
async function setAbsenceDays(
  page: Page,
  baseURL: string,
  days: Array<{ date: string; summary?: string }>,
) {
  await page.request.post(`${baseURL}/api/absence/days`, {
    data: { days: days.map((d) => ({ date: d.date, summary: d.summary ?? '沼津旅行' })) },
  });
}

async function goToKanban(page: Page) {
  await page.goto('about:blank');
  await page.goto('/#/');
  await page.getByText('未着手').waitFor();
}

async function goToSettings(page: Page) {
  await page.goto('/#/settings');
  await page.getByRole('heading', { name: '不在日（帰省・旅行）' }).waitFor();
}

function absenceBanner(page: Page) {
  return page.getByText('在宅が前提のタスクはお休みしています');
}

test.describe('不在日のカンバン表示', () => {
  test('不在日は「不在中は非表示」のタスクがカンバンから消える', async ({ page, baseURL }) => {
    await createTaskWithAbsenceBehavior(page, baseURL!, {
      name: '浴槽掃除', category: 'water', behaviorLabel: '不在中は非表示',
    });

    await setAbsenceDays(page, baseURL!, [{ date: getTodayJST() }]);

    await goToKanban(page);
    await expect(page.getByText('浴槽掃除')).not.toBeVisible();
  });

  test('不在日でも「不在でも表示」のタスクはカンバンに残る', async ({ page, baseURL }) => {
    await createTaskWithAbsenceBehavior(page, baseURL!, {
      name: 'パル注文', category: 'cooking', behaviorLabel: '不在でも表示',
    });

    await setAbsenceDays(page, baseURL!, [{ date: getTodayJST() }]);

    await goToKanban(page);
    await expect(page.getByText('パル注文')).toBeVisible();
  });

  test('不在日ではない日は「不在中は非表示」のタスクもカンバンに表示される', async ({ page, baseURL }) => {
    await createTaskWithAbsenceBehavior(page, baseURL!, {
      name: '浴槽掃除', category: 'water', behaviorLabel: '不在中は非表示',
    });

    await setAbsenceDays(page, baseURL!, [{ date: addDays(getTodayJST(), 3) }]);

    await goToKanban(page);
    await expect(page.getByText('浴槽掃除')).toBeVisible();
  });

  test('不在日は予定名つきのお知らせが表示される', async ({ page, baseURL }) => {
    await setAbsenceDays(page, baseURL!, [{ date: getTodayJST(), summary: '沼津旅行' }]);

    await goToKanban(page);
    await test.step('お休みしていることが表示される', async () => {
      await expect(absenceBanner(page)).toBeVisible();
    });
    await test.step('予定名が表示される', async () => {
      await expect(page.getByText('沼津旅行')).toBeVisible();
    });
  });

  test('不在日ではない日はお知らせが表示されない', async ({ page, baseURL }) => {
    await setAbsenceDays(page, baseURL!, [{ date: addDays(getTodayJST(), 3) }]);

    await goToKanban(page);
    await expect(absenceBanner(page)).not.toBeVisible();
  });
});

test.describe('不在日のキーワード設定', () => {
  test('既定のキーワードが表示される', async ({ page }) => {
    await goToSettings(page);

    for (const keyword of ['帰省', '旅行', '梶山', '大津']) {
      await expect(page.getByText(keyword, { exact: true })).toBeVisible();
    }
  });

  test('キーワードを追加すると一覧に表示される', async ({ page }) => {
    await goToSettings(page);

    await page.getByLabel('不在キーワードを追加').fill('沼津');
    await page.getByRole('button', { name: 'キーワードを登録' }).click();

    await expect(page.getByText('沼津', { exact: true })).toBeVisible();
  });

  test('キーワードを削除すると一覧から消える', async ({ page }) => {
    await goToSettings(page);

    await page.getByRole('button', { name: 'キーワード旅行を削除' }).click();

    await expect(page.getByText('旅行', { exact: true })).not.toBeVisible();
  });

  test('追加したキーワードはページを開き直しても残っている', async ({ page }) => {
    await goToSettings(page);
    await page.getByLabel('不在キーワードを追加').fill('沼津');
    await page.getByRole('button', { name: 'キーワードを登録' }).click();
    await page.getByText('沼津', { exact: true }).waitFor();

    await goToSettings(page);

    await expect(page.getByText('沼津', { exact: true })).toBeVisible();
  });

  test('前後の空白を含めて入力したキーワードは空白を除いて登録される', async ({ page }) => {
    await goToSettings(page);

    await page.getByLabel('不在キーワードを追加').fill('  沼津  ');
    await page.getByRole('button', { name: 'キーワードを登録' }).click();

    await expect(page.getByText('沼津', { exact: true })).toBeVisible();
  });

  test('すでに登録済みのキーワードを追加しても重複して表示されない', async ({ page }) => {
    await goToSettings(page);

    await page.getByLabel('不在キーワードを追加').fill('旅行');
    await page.getByRole('button', { name: 'キーワードを登録' }).click();

    await expect(page.getByText('旅行', { exact: true })).toHaveCount(1);
  });
});

test.describe('不在日の一覧と取り消し', () => {
  test('同期された不在日が予定名つきで一覧に表示される', async ({ page, baseURL }) => {
    await setAbsenceDays(page, baseURL!, [{ date: addDays(getTodayJST(), 1), summary: '沼津旅行' }]);

    await goToSettings(page);

    await expect(page.getByText('沼津旅行')).toBeVisible();
  });

  test('不在日を取り消すと一覧から消える', async ({ page, baseURL }) => {
    const tomorrow = addDays(getTodayJST(), 1);
    await setAbsenceDays(page, baseURL!, [{ date: tomorrow, summary: '沼津旅行' }]);
    await goToSettings(page);

    await page.getByRole('button', { name: `${tomorrow}の不在を取り消す` }).click();

    await expect(page.getByText('沼津旅行')).not.toBeVisible();
  });

  test('不在日を取り消すと「不在中は非表示」のタスクがカンバンに戻る', async ({ page, baseURL }) => {
    const today = getTodayJST();
    await createTaskWithAbsenceBehavior(page, baseURL!, {
      name: '浴槽掃除', category: 'water', behaviorLabel: '不在中は非表示',
    });
    await setAbsenceDays(page, baseURL!, [{ date: today, summary: '沼津旅行' }]);
    await goToSettings(page);

    await page.getByRole('button', { name: `${today}の不在を取り消す` }).click();

    await goToKanban(page);
    await expect(page.getByText('浴槽掃除')).toBeVisible();
  });

  test('不在日が無いときは予定されていないことが表示される', async ({ page }) => {
    await goToSettings(page);

    await expect(page.getByText('予定されている不在日はありません')).toBeVisible();
  });
});

test.describe('家族カレンダーからの不在日の同期', () => {
  test('連泊の旅行は日数ぶんの不在日が一覧に表示される', async ({ page, baseURL }) => {
    await setAbsenceDays(page, baseURL!, [
      { date: '2026-09-19', summary: '沼津旅行' },
      { date: '2026-09-20', summary: '沼津旅行' },
    ]);

    await goToSettings(page);

    for (const date of ['2026-09-19', '2026-09-20']) {
      await expect(page.getByText(formatDayLabel(date))).toBeVisible();
    }
  });

  test('旅行が中止になって予定が消えると不在日も消える', async ({ page, baseURL }) => {
    const today = getTodayJST();
    await setAbsenceDays(page, baseURL!, [{ date: today, summary: '沼津旅行' }]);
    await goToKanban(page);
    await absenceBanner(page).waitFor();

    await setAbsenceDays(page, baseURL!, []);

    await goToKanban(page);
    await expect(absenceBanner(page)).not.toBeVisible();
  });

  test('手で取り消した不在日は次の同期で予定が残っていれば戻る', async ({ page, baseURL }) => {
    const today = getTodayJST();
    await setAbsenceDays(page, baseURL!, [{ date: today, summary: '沼津旅行' }]);
    await goToSettings(page);
    await page.getByRole('button', { name: `${today}の不在を取り消す` }).click();
    await page.getByText('予定されている不在日はありません').waitFor();

    await setAbsenceDays(page, baseURL!, [{ date: today, summary: '沼津旅行' }]);

    await goToKanban(page);
    await expect(absenceBanner(page)).toBeVisible();
  });

  test('手で追加した不在日はカレンダーの同期では消えない', async ({ page, baseURL }) => {
    const manualDay = addDays(getTodayJST(), 5);
    await page.request.post(`${baseURL}/api/absence/days`, {
      data: { days: [{ date: manualDay }], source: 'manual' },
    });

    await setAbsenceDays(page, baseURL!, [{ date: getTodayJST(), summary: '沼津旅行' }]);

    await goToSettings(page);
    await expect(page.getByText(formatDayLabel(manualDay))).toBeVisible();
  });
});
