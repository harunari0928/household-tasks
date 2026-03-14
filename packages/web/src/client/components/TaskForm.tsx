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

export default function TaskForm({ task, defaultCategory, onSaved, onCancel }: Props) {
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
  const [assignee, setAssignee] = useState<string>(task?.assignee || '');
  const [notes, setNotes] = useState(task?.notes || '');
  const [error, setError] = useState('');
  const [frequencyError, setFrequencyError] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [attachmentRefreshKey, setAttachmentRefreshKey] = useState(0);
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
    if (assignee) {
      input.assignee = assignee;
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
    <form onSubmit={handleSubmit} className="p-4 space-y-4" data-testid="task-form">
      <h2 className="text-lg font-bold text-gray-900">
        {task ? 'タスクを編集' : 'タスクを追加'}
      </h2>

      {error && (
        <div ref={errorRef} className="bg-red-50 text-red-600 p-3 rounded-lg text-sm" data-testid="form-error">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">タスク名</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base min-h-[44px]"
          data-testid="task-name-input"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">カテゴリ</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as CategoryKey)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base min-h-[44px]"
          data-testid="category-select"
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
        <label className="block text-sm font-medium text-gray-700 mb-1">担当</label>
        <select
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base min-h-[44px]"
          data-testid="assignee-select"
        >
          <option value="">指定なし</option>
          <option value="husband">夫</option>
          <option value="wife">妻</option>
          <option value="alternate">交互</option>
        </select>
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
          data-testid="save-button"
        >
          保存
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-200 transition-colors min-h-[44px]"
          data-testid="cancel-button"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
