import { useState } from 'react';
import { CATEGORIES, type CategoryKey, type TaskDefinition, type FrequencyTypeKey } from '../types.js';
import FrequencySelector from './FrequencySelector.js';

interface Props {
  task?: TaskDefinition | null;
  defaultCategory: CategoryKey;
  onSave: (input: any, id?: number) => Promise<Response>;
  onCancel: () => void;
}

export default function TaskForm({ task, defaultCategory, onSave, onCancel }: Props) {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFrequencyError('');

    if (!name.trim()) {
      setError('タスク名を入力してください');
      return;
    }

    if ((frequencyType === 'weekly' || frequencyType === 'n_weeks') && daysOfWeek.length === 0) {
      setFrequencyError('曜日を1つ以上選択してください');
      return;
    }

    if (['n_days', 'n_weeks', 'n_months'].includes(frequencyType) && (!frequencyInterval || frequencyInterval < 2)) {
      setFrequencyError('間隔は2以上の整数で入力してください');
      return;
    }

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
    if (notes.trim()) {
      input.notes = notes.trim();
    }

    const res = await onSave(input, task?.id);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || '保存に失敗しました');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-4" data-testid="task-form">
      <h2 className="text-lg font-bold text-gray-900">
        {task ? 'タスクを編集' : 'タスクを追加'}
      </h2>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm" data-testid="form-error">
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
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base min-h-[44px]"
          data-testid="notes-input"
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
