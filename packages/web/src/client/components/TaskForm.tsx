import { useState, useCallback, useRef } from 'react';
import { CATEGORIES, type CategoryKey, type TaskDefinition, type FrequencyTypeKey } from '../types.js';
import FrequencySelector from './FrequencySelector.js';
import MarkdownEditor, { type PendingFile } from './MarkdownEditor.js';
import AttachmentsList from './AttachmentsList.js';
import { apiFetch, type ApiResult } from '../lib/api.js';
import { useToast } from '../contexts/ToastContext.js';

interface Props {
  task?: TaskDefinition | null;
  defaultCategory: CategoryKey;
  onSaved: () => void;
  onCancel: () => void;
  onDeleted?: () => void;
}

async function uploadFile(
  taskId: number,
  file: File,
): Promise<ApiResult<{ id: string; original_name: string }>> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch(`/api/tasks/${taskId}/attachments`, { method: 'POST', body: formData });
}

async function saveTaskToApi(input: any, id?: number): Promise<ApiResult<{ id: number }>> {
  const url = id ? `/api/tasks/${id}` : '/api/tasks';
  const method = id ? 'PUT' : 'POST';
  return apiFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

const inputBase =
  'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

export default function TaskForm({ task, defaultCategory, onSaved, onCancel, onDeleted }: Props) {
  const { showError } = useToast();
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
  const [submitting, setSubmitting] = useState(false);
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
    setNotes((prev) =>
      prev.replace(new RegExp(`!?\\[[^\\]]*\\]\\(pending:${placeholderIndex}\\)\\n?`, 'g'), ''),
    );
  }, []);

  const handleMarkForDelete = useCallback((id: string) => {
    setPendingDeleteIds((prev) => [...prev, id]);
    setNotes((prev) =>
      prev.replace(new RegExp(`!?\\[[^\\]]*\\]\\(/api/attachments/${id}\\)\\n?`, 'g'), ''),
    );
  }, []);

  const handleCreateInstance = async () => {
    if (!task?.id) return;
    setCreateInstanceStatus('loading');
    const result = await apiFetch(`/api/kanban/create-from-definition/${task.id}`, { method: 'POST' });
    if (result.ok) {
      setCreateInstanceStatus('success');
    } else if (result.status === 409) {
      setCreateInstanceStatus('conflict');
    } else if (result.status) {
      // Server responded with an error — show it inline.
      setError('起票に失敗しました');
      scrollToError(errorRef);
      setCreateInstanceStatus('idle');
    } else {
      // Network failure — notify with a toast.
      showError('起票に失敗しました。通信状況をご確認ください。', handleCreateInstance);
      setCreateInstanceStatus('idle');
    }
  };

  const handleDelete = async () => {
    if (!task || !onDeleted) return;
    const result = await apiFetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
    if (result.ok) {
      onDeleted();
    } else if (result.status) {
      setError(result.error || '削除に失敗しました');
      setShowDeleteConfirm(false);
      scrollToError(errorRef);
    } else {
      showError('削除に失敗しました。通信状況をご確認ください。', handleDelete);
      setShowDeleteConfirm(false);
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

    if (frequencyType === 'days_after_completion' && (!frequencyInterval || frequencyInterval < 1)) {
      setFrequencyError('完了後の日数は1以上の整数で入力してください');
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

    const parsedPoints = parseInt(points, 10);
    const pointsValue = Number.isNaN(parsedPoints) ? 1 : Math.max(0, Math.min(10, parsedPoints));

    const input: any = {
      name: name.trim(),
      category,
      frequency_type: frequencyType,
      points: pointsValue,
      scheduled_hour: scheduledHour,
    };

    if (['n_days', 'n_weeks', 'n_months', 'days_after_completion'].includes(frequencyType)) {
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

    setSubmitting(true);
    const saveResult = await saveTaskToApi(input, task?.id);
    if (!saveResult.ok) {
      if (saveResult.status) {
        // Server validation/conflict error — show inline next to the form.
        setError(saveResult.error || '保存に失敗しました');
        scrollToError(errorRef);
      } else {
        // Network failure — surface a prominent toast.
        showError('保存に失敗しました。通信状況をご確認ください。');
      }
      setSubmitting(false);
      return;
    }

    const taskId = saveResult.data.id;

    if (pendingFiles.length > 0) {
      let updatedNotes = currentNotes;
      let uploadFailed = false;
      for (const pf of pendingFiles) {
        const uploadResult = await uploadFile(taskId, pf.file);
        if (uploadResult.ok) {
          updatedNotes = updatedNotes.replace(
            `pending:${pf.placeholderIndex}`,
            `/api/attachments/${uploadResult.data.id}`,
          );
        } else {
          uploadFailed = true;
        }
      }
      if (uploadFailed) {
        showError('一部の添付ファイルのアップロードに失敗しました。');
      }
      if (updatedNotes !== currentNotes) {
        await saveTaskToApi({ ...input, notes: updatedNotes }, taskId);
      }
    }

    for (const id of pendingDeleteIds) {
      const deleteResult = await apiFetch(`/api/attachments/${id}`, { method: 'DELETE' });
      if (!deleteResult.ok) {
        showError('一部の添付ファイルの削除に失敗しました。');
      }
    }

    setSubmitting(false);
    onSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="relative flex flex-col flex-1 min-h-0">
      <div className="sm:hidden flex justify-center pt-2 pb-1 flex-shrink-0">
        <div className="w-10 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
      </div>

      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 sm:rounded-t-2xl flex-shrink-0">
        <button
          type="button"
          onClick={onCancel}
          className="p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center"
          aria-label="閉じる"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
          {task ? 'タスクを編集' : 'タスクを追加'}
        </h2>
        {task && onDeleted ? (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="p-2 -mr-2 rounded-lg text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30 transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center"
            aria-label="削除"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        ) : (
          <div className="w-10" />
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-3">
        {error && (
          <div ref={errorRef} className="bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 p-3 rounded-lg text-sm border border-red-200 dark:border-red-800" role="alert">
            {error}
          </div>
        )}

        <Section title="基本情報">
          <div>
            <label htmlFor="task-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">タスク名</label>
            <input
              id="task-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputBase}
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">カテゴリ</label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as CategoryKey)}
              className={inputBase}
            >
              {(Object.entries(CATEGORIES) as [CategoryKey, string][]).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="points" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              ポイント <span className="text-gray-400 font-normal">(0〜10)</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                id="points"
                type="number"
                min={0}
                max={10}
                step={1}
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                onBlur={() => {
                  const parsed = parseInt(points, 10);
                  setPoints(String(Number.isNaN(parsed) ? 1 : Math.max(0, Math.min(10, parsed))));
                }}
                className={`${inputBase} w-24`}
              />
              <span className="text-sm text-gray-600 dark:text-gray-400">pt</span>
            </div>
          </div>
        </Section>

        <div ref={frequencyErrorRef}>
          <Section title="スケジュール">
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

            <fieldset ref={periodErrorRef} className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-700" disabled={frequencyType === 'yearly'}>
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
          </Section>
        </div>

        <Section title="備考・添付">
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
        </Section>

        {task && (
          <Section title="アクション">
            <button
              type="button"
              onClick={handleCreateInstance}
              disabled={createInstanceStatus === 'loading'}
              className="w-full flex items-center justify-center gap-2 bg-green-50 hover:bg-green-100 dark:bg-green-900/30 dark:hover:bg-green-900/50 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800 py-2.5 rounded-lg font-medium transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              {createInstanceStatus === 'loading' ? '起票中...' : '今すぐカンバンに起票'}
            </button>
            {createInstanceStatus === 'success' && (
              <p className="text-sm text-green-600 dark:text-green-400 text-center">
                ✓ カンバンボードに追加しました
              </p>
            )}
            {createInstanceStatus === 'conflict' && (
              <p className="text-sm text-amber-600 dark:text-amber-400 text-center">
                すでにボード上に未完了のタスクがあります
              </p>
            )}
          </Section>
        )}
      </div>

      <footer className="flex gap-3 px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 sm:rounded-b-2xl flex-shrink-0">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-3 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors min-h-[44px]"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-[2] bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {submitting ? '保存中...' : '保存'}
        </button>
      </footer>

      {showDeleteConfirm && (
        <div
          className="absolute inset-0 bg-black/40 z-10 flex items-center justify-center p-4 sm:rounded-2xl"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            role="alertdialog"
            aria-label="削除の確認"
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-xs w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-600 dark:text-red-400"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-gray-100">タスクを削除しますか？</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  この操作は元に戻せません。関連する添付ファイルと実行ログも削除されます。
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-2.5 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors min-h-[44px]"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="flex-1 bg-red-600 text-white py-2.5 rounded-lg font-medium hover:bg-red-700 transition-colors min-h-[44px]"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
