import { test, expect } from './fixtures/setup.js';

test.describe('実行期間設定', () => {
  test('初期状態は期間指定しないが選択されている', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await expect(page.getByRole('radio', { name: '期間指定しない' })).toBeChecked();
    await expect(page.getByLabel('開始月')).not.toBeVisible();
  });

  test('期間指定するを選ぶと開始・終了の月日セレクトが表示される', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await page.getByRole('radio', { name: '期間指定する' }).check();

    await expect(page.getByLabel('開始月')).toBeVisible();
    await expect(page.getByLabel('開始日')).toBeVisible();
    await expect(page.getByLabel('終了月')).toBeVisible();
    await expect(page.getByLabel('終了日')).toBeVisible();
  });

  test('指定した期間は保存後に再オープンしても復元される', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /水回り/ }).click();
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('期間タスク');
    await page.getByRole('radio', { name: '期間指定する' }).check();
    await page.getByLabel('開始月').selectOption('6');
    await page.getByLabel('開始日').selectOption('1');
    await page.getByLabel('終了月').selectOption('8');
    await page.getByLabel('終了日').selectOption('31');
    await page.getByRole('button', { name: '保存' }).click();
    await page.getByText('期間タスク').waitFor();

    await page.getByText('期間タスク').click();

    await expect(page.getByRole('radio', { name: '期間指定する' })).toBeChecked();
    await expect(page.getByLabel('開始月')).toHaveValue('6');
    await expect(page.getByLabel('開始日')).toHaveValue('1');
    await expect(page.getByLabel('終了月')).toHaveValue('8');
    await expect(page.getByLabel('終了日')).toHaveValue('31');
  });

  test('開始と終了が同じ月日でも保存できる', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /水回り/ }).click();
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('期間1日タスク');
    await page.getByRole('radio', { name: '期間指定する' }).check();
    await page.getByLabel('開始月').selectOption('6');
    await page.getByLabel('開始日').selectOption('1');
    await page.getByLabel('終了月').selectOption('6');
    await page.getByLabel('終了日').selectOption('1');
    await page.getByRole('button', { name: '保存' }).click();
    await page.getByText('期間1日タスク').waitFor();

    await page.getByText('期間1日タスク').click();

    await expect(page.getByLabel('開始月')).toHaveValue('6');
    await expect(page.getByLabel('開始日')).toHaveValue('1');
    await expect(page.getByLabel('終了月')).toHaveValue('6');
    await expect(page.getByLabel('終了日')).toHaveValue('1');
  });

  test('終了月を2月に切り替えると終了日は2月の最大日数までしか選べない', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByRole('radio', { name: '期間指定する' }).check();
    await page.getByLabel('終了月').selectOption('3');
    await page.getByLabel('終了日').selectOption('31');

    await page.getByLabel('終了月').selectOption('2');

    await expect(page.getByLabel('終了日')).toHaveValue('28');
    await expect(page.getByLabel('終了日').getByRole('option')).toHaveCount(28);
  });

  test('1年毎の頻度では実行期間のラジオが無効化される', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('頻度').selectOption('yearly');

    await expect(page.getByRole('radio', { name: '期間指定しない' })).toBeDisabled();
    await expect(page.getByRole('radio', { name: '期間指定する' })).toBeDisabled();
    await expect(page.getByText('1年毎の頻度では実行期間を指定できません')).toBeVisible();
  });

  test('1年毎に切り替えると以前設定していた期間入力が非表示になる', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByRole('radio', { name: '期間指定する' }).check();
    await expect(page.getByLabel('開始月')).toBeVisible();

    await page.getByLabel('頻度').selectOption('yearly');

    await expect(page.getByLabel('開始月')).not.toBeVisible();
  });

  test('期間指定しないに戻して保存すると次回オープン時も未設定になる', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /水回り/ }).click();
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('期間解除タスク');
    await page.getByRole('radio', { name: '期間指定する' }).check();
    await page.getByLabel('開始月').selectOption('3');
    await page.getByLabel('開始日').selectOption('15');
    await page.getByLabel('終了月').selectOption('5');
    await page.getByLabel('終了日').selectOption('20');
    await page.getByRole('button', { name: '保存' }).click();
    await page.getByText('期間解除タスク').waitFor();
    await page.getByText('期間解除タスク').click();
    await page.getByRole('radio', { name: '期間指定しない' }).check();
    await page.getByRole('button', { name: '保存' }).click();
    await page.getByText('期間解除タスク').waitFor();

    await page.getByText('期間解除タスク').click();

    await expect(page.getByRole('radio', { name: '期間指定しない' })).toBeChecked();
    await expect(page.getByLabel('開始月')).not.toBeVisible();
  });
});

test.describe('タスクCRUD', () => {
  test('タスクを新規作成できる', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /水回り/ }).click();

    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('テスト洗面台掃除');
    await page.getByLabel('頻度').selectOption('weekly');
    await page.getByRole('group', { name: '曜日' }).getByText('月').click();
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByText('テスト洗面台掃除')).toBeVisible();
    await expect(page.getByText('毎週(月)')).toBeVisible();
  });

  test('完了後N日タスクを作成できる', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /水回り/ }).click();

    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('テスト排水口掃除');
    await page.getByLabel('頻度').selectOption('days_after_completion');
    // 完了後は1日から指定できる（N日ごとの最小2とは異なる）
    await page.getByLabel('間隔').fill('1');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByText('テスト排水口掃除')).toBeVisible();
    await expect(page.getByText('完了後1日')).toBeVisible();
  });

});

test.describe('フォームバリデーション', () => {
  test('頻度タイプに応じてフォームのフィールドが動的に切り替わる', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    // weekly
    await page.getByLabel('頻度').selectOption('weekly');

    await test.step('毎週 → 曜日選択が表示される', async () => {
      await expect(page.getByRole('group', { name: '曜日' })).toBeVisible();
    });

    // n_days
    await page.getByLabel('頻度').selectOption('n_days');

    await test.step('N日ごと → 間隔が表示され曜日は非表示', async () => {
      await expect(page.getByLabel('間隔')).toBeVisible();
      await expect(page.getByRole('group', { name: '曜日' })).not.toBeVisible();
    });

    // monthly
    await page.getByLabel('頻度').selectOption('monthly');

    await test.step('毎月 → 日指定が表示され間隔は非表示', async () => {
      await expect(page.getByLabel(/日指定/)).toBeVisible();
      await expect(page.getByLabel('間隔')).not.toBeVisible();
    });

    // daily
    await page.getByLabel('頻度').selectOption('daily');

    await test.step('毎日 → すべて非表示', async () => {
      await expect(page.getByLabel('間隔')).not.toBeVisible();
      await expect(page.getByRole('group', { name: '曜日' })).not.toBeVisible();
      await expect(page.getByLabel(/日指定/)).not.toBeVisible();
    });

    // yearly
    await page.getByLabel('頻度').selectOption('yearly');

    await test.step('1年ごと → 月指定と日指定が表示される', async () => {
      await expect(page.getByLabel(/月指定/)).toBeVisible();
      await expect(page.getByLabel(/日指定/)).toBeVisible();
      await expect(page.getByLabel('間隔')).not.toBeVisible();
      await expect(page.getByRole('group', { name: '曜日' })).not.toBeVisible();
    });

    await page.getByLabel('頻度').selectOption('nth_weekday_of_month');

    await test.step('第N曜日(毎月) → 何週目と曜日が表示される', async () => {
      await expect(page.getByLabel('何週目')).toBeVisible();
      await expect(page.getByRole('group', { name: '曜日' })).toBeVisible();
      await expect(page.getByLabel('間隔')).not.toBeVisible();
      await expect(page.getByLabel(/日指定/)).not.toBeVisible();
      await expect(page.getByLabel(/月指定/)).not.toBeVisible();
    });

    await page.getByLabel('頻度').selectOption('days_after_completion');

    await test.step('完了後N日 → 間隔と完了駆動の説明が表示され、他は非表示', async () => {
      await expect(page.getByLabel('間隔')).toBeVisible();
      await expect(page.getByText('完了した日から指定日数が経過すると自動で再作成されます')).toBeVisible();
      await expect(page.getByRole('group', { name: '曜日' })).not.toBeVisible();
      await expect(page.getByLabel(/日指定/)).not.toBeVisible();
      await expect(page.getByLabel(/月指定/)).not.toBeVisible();
      await expect(page.getByLabel('何週目')).not.toBeVisible();
    });
  });

  test('バリデーション: 第N曜日(毎月)で何週目未選択だとエラー', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await page.getByLabel('タスク名').fill('第N曜日テスト');
    await page.getByLabel('頻度').selectOption('nth_weekday_of_month');
    await page.getByRole('group', { name: '曜日' }).getByText('月').click();

    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('何週目');
  });

  test('バリデーション: 第N曜日(毎月)で曜日未選択だとエラー', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await page.getByLabel('タスク名').fill('第N曜日テスト2');
    await page.getByLabel('頻度').selectOption('nth_weekday_of_month');
    await page.getByLabel('何週目').selectOption('2');

    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('曜日');
  });

  test('バリデーション: 毎週で曜日未選択だとエラー', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await page.getByLabel('タスク名').fill('バリデーションテスト');
    await page.getByLabel('頻度').selectOption('weekly');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('曜日を1つ以上選択');
  });

  test('備考が長くスクロールが下にある状態でバリデーションエラーが出ると、エラー表示位置までスクロールされる', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    const longText = Array(30).fill('これはテスト用の長い備考テキストです。').join('\n');
    await page.getByLabel('備考').fill(longText);

    const saveButton = page.getByRole('button', { name: '保存' });
    await saveButton.scrollIntoViewIfNeeded();
    await saveButton.click();

    const errorEl = page.getByRole('alert');
    await expect(errorEl).toBeVisible();
    await expect(errorEl).toContainText('タスク名を入力してください');

    // Wait for smooth scroll animation to complete
    await page.waitForTimeout(500);
    const errorBox = await errorEl.boundingBox();
    const dialogBox = await page.getByRole('dialog').boundingBox();
    expect(errorBox).toBeTruthy();
    expect(dialogBox).toBeTruthy();
    expect(errorBox!.y).toBeGreaterThanOrEqual(dialogBox!.y);
    expect(errorBox!.y + errorBox!.height).toBeLessThanOrEqual(dialogBox!.y + dialogBox!.height);
  });

  test('既にバリデーションエラーが表示された状態で再度保存しても、エラー位置までスクロールされる', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 400, height: 500 } });
    const page = await context.newPage();
    await fetch('http://localhost:5174/api/test/reset', { method: 'POST' });
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    const longText = Array(30).fill('これはテスト用の長い備考テキストです。').join('\n');
    await page.getByLabel('備考').fill(longText);

    const dialog = page.getByRole('dialog');
    const saveButton = page.getByRole('button', { name: '保存' });
    const errorEl = page.getByRole('alert');

    // 1回目のバリデーションエラー
    await saveButton.scrollIntoViewIfNeeded();
    await saveButton.click();
    await expect(errorEl).toBeVisible();
    await page.waitForTimeout(500);

    // 下にスクロールするとエラーが見えなくなる
    await dialog.evaluate((el) => {
      const scroller = el.querySelector<HTMLElement>('.overflow-y-auto') ?? (el as HTMLElement);
      scroller.scrollTop = scroller.scrollHeight;
    });
    await page.waitForTimeout(100);

    await test.step('下にスクロールするとエラーが見えなくなる', async () => {
      const box2 = await errorEl.boundingBox();
      const dBox2 = await dialog.boundingBox();
      expect(box2!.y + box2!.height).toBeLessThan(dBox2!.y + 1);
    });

    // 2回目の保存
    await saveButton.click();
    await page.waitForTimeout(500);

    await test.step('2回目の保存で再びエラー位置までスクロールされる', async () => {
      const box3 = await errorEl.boundingBox();
      const dBox3 = await dialog.boundingBox();
      expect(box3!.y).toBeGreaterThanOrEqual(dBox3!.y);
      expect(box3!.y + box3!.height).toBeLessThanOrEqual(dBox3!.y + dBox3!.height);
    });

    await context.close();
  });
});

test.describe('タスク検索', () => {
  test('検索欄にテキストを入力するとカテゴリ横断でタスクがフィルタされる', async ({ page, baseURL }) => {
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: 'トイレ掃除', category: 'water', frequency_type: 'weekly', days_of_week: ['mon'] },
    });
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: 'リビング掃除', category: 'kitchen', frequency_type: 'daily' },
    });
    await page.goto('/#/tasks');
    await expect(page.getByText('トイレ掃除')).toBeVisible();

    await page.getByLabel('タスクを検索').fill('掃除');

    await expect(page.getByText('トイレ掃除')).toBeVisible();
    await expect(page.getByText('リビング掃除')).toBeVisible();
  });

  test('検索をクリアするとカテゴリフィルタに戻る', async ({ page, baseURL }) => {
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: 'トイレ掃除', category: 'water', frequency_type: 'weekly', days_of_week: ['mon'] },
    });
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: 'リビング掃除', category: 'kitchen', frequency_type: 'daily' },
    });
    await page.goto('/#/tasks');
    await expect(page.getByText('トイレ掃除')).toBeVisible();

    await page.getByLabel('タスクを検索').fill('掃除');
    await expect(page.getByText('リビング掃除')).toBeVisible();

    await page.getByLabel('タスクを検索').fill('');

    await expect(page.getByText('トイレ掃除')).toBeVisible();
    await expect(page.getByText('リビング掃除')).not.toBeVisible();
  });
});

test.describe('ダイアログ操作', () => {
  test('ダイアログ外をクリックするとダイアログが閉じる', async ({ page }) => {
    await page.goto('/#/tasks');

    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await expect(page.getByLabel('タスク名')).toBeVisible();

    await page.mouse.click(10, 10);

    await expect(page.getByLabel('タスク名')).not.toBeVisible();
  });

  test('ダイアログ内をクリックしてもダイアログは閉じない', async ({ page }) => {
    await page.goto('/#/tasks');

    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await expect(page.getByLabel('タスク名')).toBeVisible();

    await page.getByLabel('タスク名').click();

    await expect(page.getByLabel('タスク名')).toBeVisible();
  });
});

test.describe('マークダウン備考', () => {
  test('備考にマークダウンを書いて保存すると、再度開いたときに内容が残っている', async ({ page, baseURL }) => {
    await page.goto('/#/tasks');

    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('マークダウンテスト');
    await page.getByLabel('備考').fill('**太字** と *イタリック*');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('マークダウンテスト')).toBeVisible();

    await page.getByText('マークダウンテスト').click();

    await expect(page.getByLabel('備考')).toHaveValue('**太字** と *イタリック*');
  });

  test('備考のプレビューモードで見出しやリストが装飾表示される', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await page.getByLabel('備考').fill('# 見出し\n- リスト1\n- リスト2');

    await page.getByRole('button', { name: 'プレビュー' }).click();

    await expect(page.getByLabel('備考')).not.toBeVisible();
    await expect(page.getByRole('region', { name: 'プレビュー' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'プレビュー' }).locator('h1')).toHaveText('見出し');
    await expect(page.getByRole('region', { name: 'プレビュー' }).locator('li')).toHaveCount(2);

    await page.getByRole('button', { name: '編集' }).click();

    await expect(page.getByLabel('備考')).toBeVisible();
    await expect(page.getByLabel('備考')).toHaveValue('# 見出し\n- リスト1\n- リスト2');
  });

  test('備考のツールバーボタンで各マークダウン記法が挿入される', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    const notes = page.getByLabel('備考');

    // 太字
    await notes.fill('テスト');
    await notes.selectText();
    await page.getByTitle('太字').click();

    await test.step('太字', async () => {
      await expect(notes).toHaveValue('**テスト**');
    });

    // イタリック
    await notes.fill('テスト');
    await notes.selectText();
    await page.getByTitle('イタリック').click();

    await test.step('イタリック', async () => {
      await expect(notes).toHaveValue('*テスト*');
    });

    // 取り消し線
    await notes.fill('テスト');
    await notes.selectText();
    await page.getByTitle('取り消し線').click();

    await test.step('取り消し線', async () => {
      await expect(notes).toHaveValue('~~テスト~~');
    });

    // リンク
    await notes.selectText();
    await notes.press('Delete');
    await expect(notes).toHaveValue('');
    await page.getByTitle('リンク').click();

    await test.step('リンク', async () => {
      await expect(notes).toHaveValue('[リンク](url)');
    });

    // リスト
    await notes.selectText();
    await notes.press('Delete');
    await expect(notes).toHaveValue('');
    await page.getByTitle('リスト').click();

    await test.step('リスト', async () => {
      await expect(notes).toHaveValue('\n- ');
    });
  });
});

test.describe('ファイル添付（新規タスク）', () => {
  test('新規タスク作成時にファイルを添付して保存すると、再度開いても添付が残っている', async ({ page, baseURL }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('添付テスト新規');

    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.getByLabel('ファイル添付').setInputFiles({
      name: 'test-image.png',
      mimeType: 'image/png',
      buffer: pngBytes,
    });

    await expect(page.getByRole('region', { name: '添付ファイル' }).getByText('test-image.png')).toBeVisible();

    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('添付テスト新規')).toBeVisible();

    await page.getByText('添付テスト新規').click();

    await expect(page.getByRole('region', { name: '添付ファイル' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('region', { name: '添付ファイル' }).getByText('test-image.png')).toBeVisible();

    await page.getByRole('button', { name: 'プレビュー' }).click();
    const img = page.getByRole('region', { name: 'プレビュー' }).locator('img');
    await expect(img).toBeVisible();
    const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);
  });

  test('新規タスクで画像を添付するとプレビューに実際の画像が表示される', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.getByLabel('ファイル添付').setInputFiles({
      name: 'preview-test.png',
      mimeType: 'image/png',
      buffer: pngBytes,
    });

    await page.getByRole('button', { name: 'プレビュー' }).click();

    const img = page.getByRole('region', { name: 'プレビュー' }).locator('img');
    await expect(img).toBeVisible();
    const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);
  });

  test('新規タスクで添付した画像を削除すると備考からも参照が消える', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('新規削除テスト');
    await page.getByLabel('備考').fill('テスト文章');

    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.getByLabel('ファイル添付').setInputFiles({
      name: 'remove-me.png',
      mimeType: 'image/png',
      buffer: pngBytes,
    });

    await expect(page.getByRole('region', { name: '添付ファイル' }).getByText('remove-me.png')).toBeVisible();
    await expect(page.getByLabel('備考')).toContainText('remove-me.png');

    await page.getByRole('region', { name: '添付ファイル' }).getByTitle('削除').click();

    await expect(page.getByRole('region', { name: '添付ファイル' })).not.toBeVisible();
    await expect(page.getByLabel('備考')).not.toContainText('remove-me.png');
    await expect(page.getByLabel('備考')).toContainText('テスト文章');

    await page.getByRole('button', { name: 'プレビュー' }).click();

    await expect(page.getByRole('region', { name: 'プレビュー' }).locator('img')).not.toBeVisible();
  });

  test('新規タスクでファイルを添付してからキャンセルすると、タスクもファイルも残らない', async ({ page, baseURL }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('キャンセルテスト');

    await page.getByLabel('ファイル添付').setInputFiles({
      name: 'cancel-file.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('キャンセルされるファイル'),
    });
    await expect(page.getByRole('region', { name: '添付ファイル' }).getByText('cancel-file.txt')).toBeVisible();

    await page.getByRole('button', { name: 'キャンセル' }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible();

    const res = await page.request.get(`${baseURL}/api/tasks`);
    const tasks = await res.json();
    expect(tasks.find((t: any) => t.name === 'キャンセルテスト')).toBeUndefined();
  });
});

test.describe('ファイル添付（既存タスク）', () => {
  test('既存タスク編集時にファイルを添付して保存すると、再度開いても添付が残っている', async ({ page, baseURL }) => {
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: '既存添付テスト', category: 'water', frequency_type: 'daily' },
    });
    await page.goto('/#/tasks');
    await expect(page.getByText('既存添付テスト')).toBeVisible();

    await page.getByText('既存添付テスト').click();
    await page.getByLabel('ファイル添付').setInputFiles({
      name: 'existing-task-file.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('既存タスクのファイル'),
    });

    await expect(page.getByRole('region', { name: '添付ファイル' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('region', { name: '添付ファイル' }).getByText('existing-task-file.txt')).toBeVisible();

    await page.getByRole('button', { name: '保存' }).click();

    await page.getByText('既存添付テスト').click();

    await expect(page.getByRole('region', { name: '添付ファイル' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('region', { name: '添付ファイル' }).getByText('existing-task-file.txt')).toBeVisible();
  });

  test('添付ファイルを削除すると備考からも参照が消え、保存後も消えたままになっている', async ({ page, baseURL }) => {
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64',
    );
    const taskRes = await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: '削除テスト', category: 'water', frequency_type: 'daily' },
    });
    const task = await taskRes.json();
    const uploadRes = await page.request.post(`${baseURL}/api/tasks/${task.id}/attachments`, {
      multipart: {
        file: { name: 'delete-me.png', mimeType: 'image/png', buffer: pngBytes },
      },
    });
    const attachment = await uploadRes.json();
    await page.request.put(`${baseURL}/api/tasks/${task.id}`, {
      data: { ...task, notes: `テスト文章\n![delete-me.png](/api/attachments/${attachment.id})\nその他` },
    });

    await page.goto('/#/tasks');
    await page.getByText('削除テスト').click();
    await expect(page.getByRole('region', { name: '添付ファイル' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel('備考')).toContainText('delete-me.png');

    // 削除する
    await page.getByRole('region', { name: '添付ファイル' }).getByTitle('削除').click();

    await test.step('備考からも参照が消える', async () => {
      await expect(page.getByText('delete-me.png')).not.toBeVisible();
      await expect(page.getByLabel('備考')).not.toContainText('delete-me.png');
      await expect(page.getByLabel('備考')).toContainText('テスト文章');
      await expect(page.getByLabel('備考')).toContainText('その他');
    });

    await test.step('プレビューでも画像が表示されない', async () => {
      await page.getByRole('button', { name: 'プレビュー' }).click();
      await expect(page.getByRole('region', { name: 'プレビュー' }).locator('img')).not.toBeVisible();
    });

    // 保存後に再度開く
    await page.getByRole('button', { name: '編集' }).click();
    await page.getByRole('button', { name: '保存' }).click();
    await page.getByText('削除テスト').click();

    await test.step('保存後に再度開いても消えたまま', async () => {
      await expect(page.getByRole('region', { name: '添付ファイル' })).not.toBeVisible({ timeout: 3000 });
      await expect(page.getByLabel('備考')).not.toContainText('delete-me.png');
    });
  });

  test('添付ファイルを削除してキャンセルすると、再度開いたときにファイルが残っている', async ({ page, baseURL }) => {
    const taskRes = await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: '削除キャンセルテスト', category: 'water', frequency_type: 'daily' },
    });
    const task = await taskRes.json();
    await page.request.post(`${baseURL}/api/tasks/${task.id}/attachments`, {
      multipart: {
        file: { name: 'keep-me.txt', mimeType: 'text/plain', buffer: Buffer.from('残るファイル') },
      },
    });

    await page.goto('/#/tasks');
    await page.getByText('削除キャンセルテスト').click();
    await expect(page.getByRole('region', { name: '添付ファイル' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('keep-me.txt')).toBeVisible();

    // 削除してキャンセル
    await page.getByRole('region', { name: '添付ファイル' }).getByTitle('削除').click();
    await expect(page.getByText('keep-me.txt')).not.toBeVisible();
    await page.getByRole('button', { name: 'キャンセル' }).click();

    // 再度開く
    await page.getByText('削除キャンセルテスト').click();

    await test.step('再度開くとファイルが残っている', async () => {
      await expect(page.getByRole('region', { name: '添付ファイル' })).toBeVisible({ timeout: 5000 });
      await expect(page.getByText('keep-me.txt')).toBeVisible();
    });
  });

  test('添付した画像がプレビューモードで画像として表示される', async ({ page, baseURL }) => {
    const taskRes = await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: '画像プレビューテスト', category: 'water', frequency_type: 'daily' },
    });
    const task = await taskRes.json();
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const uploadRes = await page.request.post(`${baseURL}/api/tasks/${task.id}/attachments`, {
      multipart: {
        file: { name: 'test-image.png', mimeType: 'image/png', buffer: pngBytes },
      },
    });
    const attachment = await uploadRes.json();
    await page.request.put(`${baseURL}/api/tasks/${task.id}`, {
      data: { ...task, notes: `![テスト画像](/api/attachments/${attachment.id})` },
    });

    await page.goto('/#/tasks');
    await page.getByText('画像プレビューテスト').click();
    await page.getByRole('button', { name: 'プレビュー' }).click();

    await expect(page.getByRole('region', { name: 'プレビュー' }).locator('img')).toBeVisible();
  });
});

test.describe('タスク削除', () => {
  test('タスクを削除できる', async ({ page }) => {
    await page.goto('/#/tasks');

    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('削除テスト用タスク');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('削除テスト用タスク')).toBeVisible();

    await page.getByText('削除テスト用タスク').click();
    await page.getByRole('button', { name: '削除' }).click();

    await expect(page.getByText('タスクを削除しますか？')).toBeVisible();

    await page.getByRole('button', { name: '削除する' }).click();

    await expect(page.getByText('削除テスト用タスク')).not.toBeVisible();
  });

  test('削除の確認でキャンセルするとタスクが残る', async ({ page }) => {
    await page.goto('/#/tasks');

    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('削除キャンセルテスト');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('削除キャンセルテスト')).toBeVisible();

    await page.getByText('削除キャンセルテスト').click();
    await page.getByRole('button', { name: '削除' }).click();
    const confirmDialog = page.getByRole('alertdialog', { name: '削除の確認' });
    await expect(confirmDialog).toBeVisible();

    await confirmDialog.getByRole('button', { name: 'キャンセル' }).click();

    await expect(confirmDialog).not.toBeVisible();

    await page.getByRole('button', { name: '閉じる' }).click();

    await expect(page.getByText('削除キャンセルテスト')).toBeVisible();
  });

  test('カンバンに起票済みのタスクも削除でき、カンバンからもカードが消える', async ({ page, baseURL }) => {
    const taskRes = await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: '起票後削除テスト', category: 'water', frequency_type: 'daily' },
    });
    const task = await taskRes.json();
    await page.request.post(`${baseURL}/api/kanban/create-from-definition/${task.id}`);
    await page.goto('/#/tasks');
    await page.getByText('起票後削除テスト').waitFor();

    await page.getByText('起票後削除テスト').click();
    await page.getByRole('button', { name: '削除' }).click();
    await page.getByRole('button', { name: '削除する' }).click();

    await test.step('タスク管理画面から消える', async () => {
      await expect(page.getByText('起票後削除テスト')).not.toBeVisible();
    });

    await test.step('カンバンボードからもカードが消える', async () => {
      await page.goto('/#/');
      await expect(page.getByText('起票後削除テスト')).not.toBeVisible();
    });
  });

  test('新規作成フォームに削除ボタンが表示されない', async ({ page }) => {
    await page.goto('/#/tasks');

    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await expect(page.getByRole('button', { name: '削除' })).not.toBeVisible();
  });

  test('添付ファイル付きタスクを削除すると添付URLにアクセスできなくなる', async ({ page }) => {
    await page.goto('/#/tasks');

    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('添付削除テスト');
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.getByLabel('ファイル添付').setInputFiles({
      name: 'delete-attach.png',
      mimeType: 'image/png',
      buffer: pngBytes,
    });
    await expect(page.getByRole('region', { name: '添付ファイル' }).getByText('delete-attach.png')).toBeVisible();

    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('添付削除テスト')).toBeVisible();

    await page.getByText('添付削除テスト').click();
    await expect(page.getByRole('region', { name: '添付ファイル' })).toBeVisible({ timeout: 5000 });

    const notesValue = await page.getByLabel('備考').inputValue();
    const urlMatch = notesValue.match(/\/api\/attachments\/[a-f0-9-]+/);
    expect(urlMatch).toBeTruthy();
    const attachmentUrl = urlMatch![0];

    // タスクを削除する
    await page.getByRole('button', { name: '削除' }).click();
    await page.getByRole('button', { name: '削除する' }).click();
    await expect(page.getByText('添付削除テスト')).not.toBeVisible();

    await test.step('添付URLが404を返す', async () => {
      const res = await page.request.get(attachmentUrl);
      expect(res.status()).toBe(404);
    });
  });
});

test.describe('重複名チェック', () => {
  test('既存タスクと同じ名前で新規作成するとエラーが表示される', async ({ page, baseURL }) => {
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: '重複チェック用', category: 'water', frequency_type: 'daily' },
    });
    await page.goto('/#/tasks');

    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('重複チェック用');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('同じ名前のタスクが既に存在します');
  });

  test('編集時に他タスクと同じ名前に変更するとエラーが表示される', async ({ page, baseURL }) => {
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: 'タスクA', category: 'water', frequency_type: 'daily' },
    });
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: 'タスクB', category: 'water', frequency_type: 'daily' },
    });
    await page.goto('/#/tasks');

    await page.getByText('タスクB').click();
    await page.getByLabel('タスク名').fill('タスクA');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('同じ名前のタスクが既に存在します');
  });

  test('編集時に自分と同じ名前のまま保存できる', async ({ page, baseURL }) => {
    await page.request.post(`${baseURL}/api/tasks`, {
      data: { name: '自分の名前のまま', category: 'water', frequency_type: 'daily' },
    });
    await page.goto('/#/tasks');

    await page.getByText('自分の名前のまま').click();
    await page.getByLabel('備考').fill('編集メモ');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByText('自分の名前のまま')).toBeVisible();
  });
});

test.describe('今すぐ起票', () => {
  test('新規作成フォームに起票ボタンが表示されない', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await expect(page.getByRole('button', { name: '今すぐカンバンに起票' })).not.toBeVisible();
  });

  test('編集フォームで起票するとカンバンに未着手タスクが追加される', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('起票テスト');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('起票テスト')).toBeVisible();

    await page.getByText('起票テスト').click();
    await page.getByRole('button', { name: '今すぐカンバンに起票' }).click();

    await expect(page.getByText('カンバンボードに追加しました')).toBeVisible();

    await page.getByRole('button', { name: 'キャンセル' }).click();
    await page.goto('/#/');

    await expect(page.getByText('起票テスト')).toBeVisible();
  });

  test('既に未完了タスクがある場合は空振りになる', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();
    await page.getByLabel('タスク名').fill('重複テスト');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('重複テスト')).toBeVisible();

    await page.getByText('重複テスト').click();
    await page.getByRole('button', { name: '今すぐカンバンに起票' }).click();
    await expect(page.getByText('カンバンボードに追加しました')).toBeVisible();

    await page.getByRole('button', { name: '今すぐカンバンに起票' }).click();

    await expect(page.getByText('すでにボード上に未完了のタスクがあります')).toBeVisible();
  });
});

test.describe('ダークモード', () => {
  test('ダークモードに切り替えるとdarkクラスが付与される', async ({ page }) => {
    await page.goto('/#/tasks');
    await expect(page.getByRole('button', { name: 'ダークモードに切り替え' })).toBeVisible();

    await page.getByRole('button', { name: 'ダークモードに切り替え' }).click();

    await expect(page.getByRole('button', { name: 'ライトモードに切り替え' })).toBeVisible();
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(true);
  });

  test('ダークモードからライトモードに戻せる', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: 'ダークモードに切り替え' }).click();
    await expect(page.getByRole('button', { name: 'ライトモードに切り替え' })).toBeVisible();

    await page.getByRole('button', { name: 'ライトモードに切り替え' }).click();

    await expect(page.getByRole('button', { name: 'ダークモードに切り替え' })).toBeVisible();
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(false);
  });

  test('ダークモードの設定がページリロード後も維持される', async ({ page }) => {
    await page.goto('/#/tasks');

    await page.getByRole('button', { name: 'ダークモードに切り替え' }).click();
    await expect(page.getByRole('button', { name: 'ライトモードに切り替え' })).toBeVisible();

    await page.reload();

    await expect(page.getByRole('button', { name: 'ライトモードに切り替え' })).toBeVisible();
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(true);
  });
});

test.describe('1年ごとタスクの月日指定', () => {
  test('月日指定ありで作成すると一覧に月日が表示される', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /生活/ }).click();
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await page.getByLabel('タスク名').fill('テスト予防接種');
    await page.getByLabel('カテゴリ').selectOption('lifestyle');
    await page.getByLabel('頻度').selectOption('yearly');
    await page.getByLabel(/月指定/).fill('10');
    await page.getByLabel(/日指定/).fill('1');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByText('テスト予防接種')).toBeVisible();
    await expect(page.getByText('1年ごと(10月1日)')).toBeVisible();
  });

  test('月日指定なしで作成すると一覧に月日なしで表示される', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /生活/ }).click();
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await page.getByLabel('タスク名').fill('テスト年次タスク');
    await page.getByLabel('カテゴリ').selectOption('lifestyle');
    await page.getByLabel('頻度').selectOption('yearly');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByText('テスト年次タスク')).toBeVisible();
    await expect(page.getByText('1年ごと')).toBeVisible();
  });

  test('編集時に月日の値が保持される', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /生活/ }).click();
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await page.getByLabel('タスク名').fill('テスト月日保持');
    await page.getByLabel('カテゴリ').selectOption('lifestyle');
    await page.getByLabel('頻度').selectOption('yearly');
    await page.getByLabel(/月指定/).fill('12');
    await page.getByLabel(/日指定/).fill('25');
    await page.getByRole('button', { name: '保存' }).click();

    await page.getByText('テスト月日保持').click();

    await test.step('月と日の値が保持されている', async () => {
      await expect(page.getByLabel(/月指定/)).toHaveValue('12');
      await expect(page.getByLabel(/日指定/)).toHaveValue('25');
    });
  });

  test('バリデーション: 月のみ指定で日が未入力だとエラー', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await page.getByLabel('タスク名').fill('バリデーションテスト');
    await page.getByLabel('頻度').selectOption('yearly');
    await page.getByLabel(/月指定/).fill('10');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('月と日の両方');
  });

  test('バリデーション: 日のみ指定で月が未入力だとエラー', async ({ page }) => {
    await page.goto('/#/tasks');
    await page.getByRole('button', { name: /タスクを追加/ }).click();

    await page.getByLabel('タスク名').fill('バリデーションテスト2');
    await page.getByLabel('頻度').selectOption('yearly');
    await page.getByLabel(/日指定/).fill('15');
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('月と日の両方');
  });
});
