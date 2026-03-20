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
  const [points, setPoints] = useState<number>(task?.points ?? 1);
  const [notes, setNotes] = useState(task?.notes || '');
  const [error, setError] = useState('');
  const [frequencyError, setFrequencyError] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [attachmentRefreshKey, setAttachmentRefreshKey] = useState(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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

    let currentNotes = notes.trim();

    const input: any = {
      name: name.trim(),
      category,
      frequency_type: frequencyType,
      points,
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
      <h2 className="text-lg font-bold text-gray-900">
        {task ? 'タスクを編集' : 'タスクを追加'}
      </h2>

      {error && (
        <div ref={errorRef} className="bg-red-50 text-red-600 p-3 rounded-lg text-sm" role="alert">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="task-name" className="block text-sm font-medium text-gray-700 mb-1">タスク名</label>
        <input
          id="task-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base min-h-[44px]"

          autoFocus
        />
      </div>

      <div>
        <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">カテゴリ</label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as CategoryKey)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base min-h-[44px]"

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
        }}
        onChange={(val) => {
          setFrequencyType(val.frequency_type);
          setFrequencyInterval(val.frequency_interval);
          setDaysOfWeek(val.days_of_week || []);
          setDayOfMonth(val.day_of_month);
          setFrequencyError('');
        }}
        error={frequencyError}
      />
      </div>

      <div>
        <label htmlFor="points" className="block text-sm font-medium text-gray-700 mb-1">ポイント</label>
        <input
          id="points"
          type="number"
          min={1}
          max={10}
          step={1}
          value={points}
          onChange={(e) => setPoints(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base min-h-[44px]"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">備考</label>
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
          className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-200 transition-colors min-h-[44px]"

        >
          キャンセル
        </button>
      </div>

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
          <p className="text-sm text-red-600 font-medium text-center">本当に削除しますか？</p>
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
              className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-200 transition-colors min-h-[44px]"

            >
              やめる
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
