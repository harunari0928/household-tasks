import { useState, useEffect } from 'react';
import { useAssignees } from '../hooks/useAssignees.js';
import { useGarbageSettings } from '../hooks/useGarbageSettings.js';
import { useAbsence } from '../hooks/useAbsence.js';

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

function formatNextDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_JA[d.getDay()]})`;
}

// ごみ収集の次回日と同じ書式。不在日の一覧でも使う。
const formatAbsenceDate = formatNextDate;

function GarbageSection() {
  const { types, hiddenTypes, next, loading, toggleType } = useGarbageSettings();

  if (loading) return null;

  return (
    <section className="mt-10" aria-label="ごみ収集">
      <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-2">ごみ収集</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        出すごみの種類を選びます。チェックを外した種類の日と、収集が無い日は
        ごみ捨てタスクを起票しません（すでに起票済みのタスクは残ります）。
      </p>

      <div className="flex flex-col gap-2 mb-4">
        {types.map((type) => {
          const checked = !hiddenTypes.includes(type.id);
          return (
            <label
              key={type.id}
              className="flex items-center justify-between bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 cursor-pointer"
            >
              <span className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleType(type.id)}
                  aria-label={type.label}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                />
                <span
                  className={`text-sm font-medium ${
                    checked
                      ? 'text-gray-700 dark:text-gray-300'
                      : 'text-gray-400 dark:text-gray-500 line-through'
                  }`}
                >
                  {type.label}
                </span>
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 ml-3">
                {type.scheduleLabel}
              </span>
            </label>
          );
        })}
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400">
        次回のごみ捨て:{' '}
        {next ? (
          <span className="font-medium text-gray-800 dark:text-gray-200">
            {formatNextDate(next.date)}{' '}
            {next.types.map((t) => types.find((x) => x.id === t)?.label ?? t).join('、')}
          </span>
        ) : (
          <span className="text-gray-400 dark:text-gray-500">当分ありません</span>
        )}
      </p>
    </section>
  );
}

/**
 * 不在日（帰省・旅行）の設定。
 *
 * 不在日そのものは Home Assistant の家族カレンダー同期が入れるので、
 * ここでは判定キーワードの編集と、誤検知の取り消しだけを提供する。
 */
function AbsenceSection() {
  // 設定画面は開いたまま同期が走ることがあるので購読する
  // （カンバン側は App のバナーが読み込み時に取得するだけで足りる）
  const { keywords, today, days, hiddenTaskCount, loading, saveKeywords, removeDay } = useAbsence({
    subscribe: true,
  });
  const [newKeyword, setNewKeyword] = useState('');

  if (loading) return null;

  const handleAdd = async () => {
    const trimmed = newKeyword.trim();
    if (!trimmed) return;
    if (keywords.some((k) => k === trimmed)) {
      setNewKeyword('');
      return;
    }
    const ok = await saveKeywords([...keywords, trimmed]);
    if (ok) setNewKeyword('');
  };

  return (
    <section className="mt-10">
      <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-2">不在日（帰省・旅行）</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        家族カレンダーの予定名に下のキーワードが含まれる日を「不在」とみなし、
        「不在中は非表示」に設定したタスク（現在 {hiddenTaskCount} 件）を起票しません。
      </p>

      {today && (
        <div
          className="mb-4 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-4 py-3"
          data-testid="absence-today"
        >
          <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
            今日は不在日です
            {today.summary ? `（${today.summary}）` : '（手動設定）'}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        {keywords.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500">
            キーワードが空です（不在判定は行われません）
          </p>
        )}
        {keywords.map((keyword) => (
          <span
            key={keyword}
            className="inline-flex items-center gap-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full pl-3 pr-1.5 py-1 text-sm text-gray-700 dark:text-gray-300"
          >
            {keyword}
            <button
              onClick={() => saveKeywords(keywords.filter((k) => k !== keyword))}
              className="p-0.5 text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
              aria-label={`キーワード${keyword}を削除`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </span>
        ))}
      </div>

      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="キーワードを追加（例: 沼津）"
          className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="不在キーワードを追加"
        />
        {/* aria-label で「登録ユーザー」側の追加ボタンと区別する。
            **「追加」を含まない名前にする**: Playwright の getByRole の name は
            部分一致なので、「〜を追加する」だと既存テストの
            getByRole('button', {name:'追加'}) と依然として二重に当たる。 */}
        <button
          onClick={handleAdd}
          disabled={!newKeyword.trim()}
          aria-label="キーワードを登録"
          className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-30 transition-colors cursor-pointer"
        >
          追加
        </button>
      </div>

      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">今後の不在日</h4>
      {days.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">
          予定されている不在日はありません
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {days.map((day) => (
            <div
              key={day.date}
              className="flex items-center justify-between bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5"
            >
              <span className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">{formatAbsenceDate(day.date)}</span>
                {day.summary && (
                  <span className="text-gray-400 dark:text-gray-500 ml-2">{day.summary}</span>
                )}
              </span>
              <button
                onClick={() => removeDay(day.date)}
                className="p-1 text-gray-400 hover:text-red-500 transition-colors cursor-pointer shrink-0 ml-3"
                aria-label={`${day.date}の不在を取り消す`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
        取り消しても、次回のカレンダー同期で予定が残っていれば再度登録されます
      </p>
    </section>
  );
}

export default function SettingsPage() {
  const { assignees, fetchAssignees, addAssignee, removeAssignee } = useAssignees();
  const [newName, setNewName] = useState('');

  useEffect(() => {
    fetchAssignees();
  }, [fetchAssignees]);

  const handleAdd = async () => {
    await addAssignee(newName);
    setNewName('');
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-6">設定</h2>

      <section>
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-4">登録ユーザー</h3>

        <div className="flex flex-col gap-2 mb-4">
          {assignees.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500">ユーザーが登録されていません</p>
          )}
          {assignees.map((name) => (
            <div
              key={name}
              className="flex items-center justify-between bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3"
            >
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{name}</span>
              <button
                onClick={() => removeAssignee(name)}
                className="p-1 text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                aria-label={`${name}を削除`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="新しいユーザー名"
            className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="新しいユーザー名"
          />
          <button
            onClick={handleAdd}
            disabled={!newName.trim()}
            className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-30 transition-colors cursor-pointer"
          >
            追加
          </button>
        </div>
      </section>

      <GarbageSection />
      <AbsenceSection />
    </div>
  );
}
