import { useState, useCallback, useRef } from 'react';
import { CATEGORIES, type CategoryKey, type TaskDefinition, type FrequencyTypeKey } from '../types.js';
import FrequencySelector from './FrequencySelector.js';
import MarkdownEditor, { type PendingFile } from './MarkdownEditor.js';
import AttachmentsList from './AttachmentsList.js';

interface Props {
  task?: TaskDefinition | null;
  defaultCategory: CategoryKey;
  onSaved: () => void;
  onCancel: () => void;
  onDeleted?: () => void;
}

async function uploadFile(taskId: number, file: File): Promise<{ id: string; original_name: string } | null> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: 'POST', body: formData });
  if (!res.ok) return null;
  return res.json();
}

async function saveTaskToApi(input: any, id?: number): Promise<Response> {
  const url = id ? `/api/tasks/${id}` : '/api/tasks';
  const method = id ? 'PUT' : 'POST';
  return fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export default function TaskForm({ task, defaultCategory, onSaved, onCancel, onDeleted }: Props) {
  const [name, setName] = useState(task?.name || '');
  const [category, setCategory] = useState<CategoryKey>(task?.category || defaultCategory);
  const [frequencyType, setFrequencyType] = useState<FrequencyTypeKey>(
    (task?.frequency_type as FrequencyTypeKey) || 'daily',
  );
  const [frequencyInterval, setFrequencyInterval] = useState<number | undefined>(
    task?.frequency_interval ?? undefined,
  );
  const [daysOfWeek, setDaysOfWeek] = useState<string[]>(
    task?.days_of_week ? task.days_of_week.split(',') : [],
  );
  const [dayOfMonth, setDayOfMonth] = useState<number | undefined>(
    task?.day_of_month ?? undefined,
  );
  const [monthOfYear, setMonthOfYear] = useState<number | undefined>(
    task?.month_of_year ?? undefined,
  );
  const [nthWeekdayPosition, setNthWeekdayPosition] = useState<number | undefined>(
    task?.nth_weekday_position ?? undefined,
  );
  const [scheduledHour, setScheduledHour] = useState<number>(task?.scheduled_hour ?? 0);
  const [points, setPoints] = useState<string>(String(task?.points ?? 1));
  const initialPeriodEnabled =
    task?.period_start_mm != null &&
    task?.period_start_dd != null &&
    task?.period_end_mm != null &&
    task?.period_end_dd != null;
  const [periodEnabled, setPeriodEnabled] = useState<boolean>(initialPeriodEnabled);
  const [periodStartMm, setPeriodStartMm] = useState<number>(task?.period_start_mm ?? 1);
  const [periodStartDd, setPeriodStartDd] = useState<number>(task?.period_start_dd ?? 1);
  const [periodEndMm, setPeriodEndMm] = useState<number>(task?.period_end_mm ?? 12);
  const [periodEndDd, setPeriodEndDd] = useState<number>(task?.period_end_dd ?? 31);
  const [periodError, setPeriodError] = useState('');
  const periodErrorRef = useRef<HTMLDivElement>(null);

  function daysInMonth(mm: number): number {
    return new Date(2001, mm, 0).getDate();
  }
  function clampDay(mm: number, dd: number): number {
    const max = daysInMonth(mm);
    return Math.min(dd, max);
  }
  const [notes, setNotes] = useState(task?.notes || '');
  const [error, setError] = useState('');
  const [frequencyError, setFrequencyError] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [attachmentRefreshKey, setAttachmentRefreshKey] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [createInstanceStatus, setCreateInstanceStatus] = useState<'idle' | 'loading' | 'success' | 'conflict'>('idle');
  const errorRef = useRef<HTMLDivElement>(null);
  const frequencyErrorRef = useRef<HTMLDivElement>(null);

  const scrollToError = useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, []);

  const handleFileQueued = useCallback((pf: PendingFile) => {
    setPendingFiles((prev) => [...prev, pf]);
  }, []);

  const handleFileUploaded = useCallback(() => {
    setAttachmentRefreshKey((k) => k + 1);
  }, []);

  const handleRemovePending = useCallback((placeholderIndex: number) => {
    setPendingFiles((prev) => prev.filter((pf) => pf.placeholderIndex !== placeholderIndex));
    // Remove markdown reference from notes
    setNotes((prev) =>
      prev.replace(new RegExp(`!?\\[[^\\]]*\\]\\(pending:${placeholderIndex}\\)\\n?`, 'g'), ''),
    );
  }, []);

  const handleMarkForDelete = useCallback((id: string) => {
    setPendingDeleteIds((prev) => [...prev, id]);
    // Remove markdown references to this attachment from notes
    setNotes((prev) =>
      prev.replace(new RegExp(`!?\\[[^\\]]*\\]\\(/api/attachments/${id}\\)\\n?`, 'g'), ''),
    );
  }, []);

  const handleCreateInstance = async () => {
    if (!task?.id) return;
    setCreateInstanceStatus('loading');
    try {
      const res = await fetch(`/api/kanban/create-from-definition/${task.id}`, { method: 'POST' });
      if (res.status === 201) {
        setCreateInstanceStatus('success');
      } else if (res.status === 409) {
        setCreateInstanceStatus('conflict');
      } else {
        setError('起票に失敗しました');
        scrollToError(errorRef);
        setCreateInstanceStatus('idle');
      }
    } catch {
      setError('起票に失敗しました');
      scrollToError(errorRef);
      setCreateInstanceStatus('idle');
    }
  };

  const handleDelete = async () => {
    if (!task || !onDeleted) return;
    const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
    if (res.ok) {
      onDeleted();
    } else {
      const data = await res.json();
      setError(data.error || '削除に失敗しました');
      scrollToError(errorRef);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFrequencyError('');

    if (!name.trim()) {
      setError('タスク名を入力してください');
      scrollToError(errorRef);
      return;
    }

    if ((frequencyType === 'weekly' || frequencyType === 'n_weeks') && daysOfWeek.length === 0) {
      setFrequencyError('曜日を1つ以上選択してください');
      scrollToError(frequencyErrorRef);
      return;
    }

    if (['n_days', 'n_weeks', 'n_months'].includes(frequencyType) && (!frequencyInterval || frequencyInterval < 2)) {
      setFrequencyError('間隔は2以上の整数で入力してください');
      scrollToError(frequencyErrorRef);
      return;
    }

    if (frequencyType === 'yearly') {
      const hasMonth = !!monthOfYear;
      const hasDay = !!dayOfMonth;
      if (hasMonth !== hasDay) {
        setFrequencyError('月日指定は月と日の両方を入力してください');
        scrollToError(frequencyErrorRef);
        return;
      }
    }

    setPeriodError('');
    if (periodEnabled && frequencyType !== 'yearly') {
      const startDays = daysInMonth(periodStartMm);
      const endDays = daysInMonth(periodEndMm);
      if (periodStartDd < 1 || periodStartDd > startDays || periodEndDd < 1 || periodEndDd > endDays) {
        setPeriodError('実行期間の日付が不正です');
        scrollToError(periodErrorRef);
        return;
      }
    }

    if (frequencyType === 'nth_weekday_of_month') {
      if (!nthWeekdayPosition || nthWeekdayPosition < 1 || nthWeekdayPosition > 5) {
        setFrequencyError('何週目（1〜5）を選択してください');
        scrollToError(frequencyErrorRef);
        return;
      }
      if (daysOfWeek.length !== 1) {
        setFrequencyError('曜日を1つだけ選択してください');
        scrollToError(frequencyErrorRef);
        return;
      }
    }

    let currentNotes = notes.trim();

    const pointsValue = Math.max(1, Math.min(10, parseInt(points, 10) || 1));

    const input: any = {
      name: name.trim(),
      category,
      frequency_type: frequencyType,
      points: pointsValue,
      scheduled_hour: scheduledHour,
    };

    if (['n_days', 'n_weeks', 'n_months'].includes(frequencyType)) {
      input.frequency_interval = frequencyInterval;
    }
    if (['weekly', 'n_weeks'].includes(frequencyType)) {
      input.days_of_week = daysOfWeek;
    }
    if (['monthly', 'n_months'].includes(frequencyType) && dayOfMonth) {
      input.day_of_month = dayOfMonth;
    }
    if (frequencyType === 'yearly' && monthOfYear && dayOfMonth) {
      input.month_of_year = monthOfYear;
      input.day_of_month = dayOfMonth;
    }
    if (frequencyType === 'nth_weekday_of_month') {
      input.days_of_week = daysOfWeek;
      input.nth_weekday_position = nthWeekdayPosition;
    }
    if (periodEnabled && frequencyType !== 'yearly') {
      input.period_start_mm = periodStartMm;
      input.period_start_dd = periodStartDd;
      input.period_end_mm = periodEndMm;
      input.period_end_dd = periodEndDd;
    } else {
      input.period_start_mm = null;
      input.period_start_dd = null;
      input.period_end_mm = null;
      input.period_end_dd = null;
    }
    if (currentNotes) {
      input.notes = currentNotes;
    }

    // Save task (create or update)
    const res = await saveTaskToApi(input, task?.id);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || '保存に失敗しました');
      scrollToError(errorRef);
      return;
    }

    const saved = await res.json();
    const taskId = saved.id;

    // Upload queued files and replace placeholders
    if (pendingFiles.length > 0) {
      let updatedNotes = currentNotes;
      for (const pf of pendingFiles) {
        const attachment = await uploadFile(taskId, pf.file);
        if (attachment) {
          updatedNotes = updatedNotes.replace(
            `pending:${pf.placeholderIndex}`,
            `/api/attachments/${attachment.id}`,
          );
        }
      }
      // Re-save notes with real URLs
      if (updatedNotes !== currentNotes) {
        await saveTaskToApi({ ...input, notes: updatedNotes }, taskId);
      }
    }

    // Execute pending deletions
    for (const id of pendingDeleteIds) {
      await fetch(`/api/attachments/${id}`, { method: 'DELETE' });
    }

    onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-4">
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
        {task ? 'タスクを編集' : 'タスクを追加'}
      </h2>

      {error && (
        <div ref={errorRef} className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-3 rounded-lg text-sm" role="alert">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="task-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">タスク名</label>
        <input
          id="task-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"

          autoFocus
        />
      </div>

      <div>
        <label htmlFor="category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">カテゴリ</label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as CategoryKey)}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"

        >
          {(Object.entries(CATEGORIES) as [CategoryKey, string][]).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div ref={frequencyErrorRef}>
      <FrequencySelector
        value={{
          frequency_type: frequencyType,
          frequency_interval: frequencyInterval,
          days_of_week: daysOfWeek,
          day_of_month: dayOfMonth,
          month_of_year: monthOfYear,
          nth_weekday_position: nthWeekdayPosition,
          scheduled_hour: scheduledHour,
        }}
        onChange={(val) => {
          setFrequencyType(val.frequency_type);
          setFrequencyInterval(val.frequency_interval);
          setDaysOfWeek(val.days_of_week || []);
          setDayOfMonth(val.day_of_month);
          setMonthOfYear(val.month_of_year);
          setNthWeekdayPosition(val.nth_weekday_position);
          setScheduledHour(val.scheduled_hour);
          setFrequencyError('');
        }}
        error={frequencyError}
      />
      </div>

      <fieldset ref={periodErrorRef} className="space-y-2" disabled={frequencyType === 'yearly'}>
        <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">実行期間</legend>
        <div className="flex flex-wrap gap-4" role="radiogroup" aria-label="実行期間">
          <label className={`inline-flex items-center gap-2 text-sm ${frequencyType === 'yearly' ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
            <input
              type="radio"
              name="period-enabled"
              checked={!periodEnabled || frequencyType === 'yearly'}
              onChange={() => { setPeriodEnabled(false); setPeriodError(''); }}
              className="w-4 h-4"
            />
            期間指定しない
          </label>
          <label className={`inline-flex items-center gap-2 text-sm ${frequencyType === 'yearly' ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
            <input
              type="radio"
              name="period-enabled"
              checked={periodEnabled && frequencyType !== 'yearly'}
              onChange={() => setPeriodEnabled(true)}
              className="w-4 h-4"
            />
            期間指定する
          </label>
        </div>
        {frequencyType === 'yearly' && (
          <p className="text-xs text-gray-500 dark:text-gray-400">1年毎の頻度では実行期間を指定できません</p>
        )}

        {periodEnabled && frequencyType !== 'yearly' && (
          <div className="space-y-2 pl-1">
            <div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">開始</div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="開始月"
                  value={periodStartMm}
                  onChange={(e) => {
                    const mm = parseInt(e.target.value, 10);
                    setPeriodStartMm(mm);
                    setPeriodStartDd((dd) => clampDay(mm, dd));
                  }}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <span className="text-sm text-gray-600 dark:text-gray-400">月</span>
                <select
                  aria-label="開始日"
                  value={periodStartDd}
                  onChange={(e) => setPeriodStartDd(parseInt(e.target.value, 10))}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  {Array.from({ length: daysInMonth(periodStartMm) }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <span className="text-sm text-gray-600 dark:text-gray-400">日</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">終了</div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="終了月"
                  value={periodEndMm}
                  onChange={(e) => {
                    const mm = parseInt(e.target.value, 10);
                    setPeriodEndMm(mm);
                    setPeriodEndDd((dd) => clampDay(mm, dd));
                  }}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <span className="text-sm text-gray-600 dark:text-gray-400">月</span>
                <select
                  aria-label="終了日"
                  value={periodEndDd}
                  onChange={(e) => setPeriodEndDd(parseInt(e.target.value, 10))}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  {Array.from({ length: daysInMonth(periodEndMm) }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <span className="text-sm text-gray-600 dark:text-gray-400">日</span>
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              終了が開始より前のときは年をまたぐ期間として扱います（例: 12/1〜2/28）
            </p>
          </div>
        )}
        {periodError && <p className="text-red-500 dark:text-red-400 text-sm" role="alert">{periodError}</p>}
      </fieldset>

      <div>
        <label htmlFor="points" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ポイント</label>
        <input
          id="points"
          type="number"
          min={1}
          max={10}
          step={1}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          onBlur={() => setPoints(String(Math.max(1, Math.min(10, parseInt(points, 10) || 1))))}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">備考</label>
        <MarkdownEditor
          value={notes}
          onChange={setNotes}
          taskId={task?.id}
          pendingFiles={pendingFiles}
          onFileQueued={handleFileQueued}
          onFileUploaded={handleFileUploaded}
        />
        <AttachmentsList
          taskId={task?.id}
          refreshKey={attachmentRefreshKey}
          pendingFiles={pendingFiles.map((pf) => ({ name: pf.file.name, size: pf.file.size, type: pf.file.type, blobUrl: pf.blobUrl, placeholderIndex: pf.placeholderIndex }))}
          pendingDeleteIds={pendingDeleteIds}
          onMarkForDelete={handleMarkForDelete}
          onRemovePending={handleRemovePending}
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors min-h-[44px]"

        >
          保存
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-3 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors min-h-[44px]"

        >
          キャンセル
        </button>
      </div>

      {task && (
        <div className="pt-2">
          <button
            type="button"
            onClick={handleCreateInstance}
            disabled={createInstanceStatus === 'loading'}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createInstanceStatus === 'loading' ? '起票中...' : '今すぐ起票する'}
          </button>
          {createInstanceStatus === 'success' && (
            <p className="text-sm text-green-600 dark:text-green-400 mt-1 text-center">
              カンバンボードに追加しました
            </p>
          )}
          {createInstanceStatus === 'conflict' && (
            <p className="text-sm text-amber-600 dark:text-amber-400 mt-1 text-center">
              すでにボード上に未完了のタスクがあります
            </p>
          )}
        </div>
      )}

      {task && onDeleted && !showDeleteConfirm && (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full bg-red-600 text-white py-3 rounded-lg font-medium hover:bg-red-700 transition-colors min-h-[44px]"

          >
            削除
          </button>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="pt-2 space-y-2">
          <p className="text-sm text-red-600 dark:text-red-400 font-medium text-center">本当に削除しますか？</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleDelete}
              className="flex-1 bg-red-600 text-white py-3 rounded-lg font-medium hover:bg-red-700 transition-colors min-h-[44px]"

            >
              削除する
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-3 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors min-h-[44px]"

            >
              やめる
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
