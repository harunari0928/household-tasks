import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  CATEGORIES,
  FREQUENCY_TYPES,
  DAYS_OF_WEEK,
  type TaskInstance,
  type TaskDefinition,
  type CategoryKey,
  type FrequencyTypeKey,
  type DayOfWeek,
} from '../types.js';

interface Props {
  taskInstance: TaskInstance | null;
  onClose: () => void;
}

function formatFrequency(task: TaskDefinition): string {
  const type = FREQUENCY_TYPES[task.frequency_type as FrequencyTypeKey] || task.frequency_type;
  const parts = [type];

  if (task.days_of_week) {
    const days = task.days_of_week.split(',').map((d) => DAYS_OF_WEEK[d.trim() as DayOfWeek] || d).join(',');
    parts.push(`(${days})`);
  }
  if (task.frequency_interval && task.frequency_interval > 1) {
    parts[0] = `${task.frequency_interval}${type.replace('N', '')}`;
  }
  if (task.day_of_month) {
    parts.push(`${task.day_of_month}日`);
  }
  return parts.join(' ');
}

export default function TaskDetailDialog({ taskInstance, onClose }: Props) {
  const [taskDef, setTaskDef] = useState<TaskDefinition | null>(null);
  const [attachments, setAttachments] = useState<{ id: string; original_name: string; mime_type: string }[]>([]);

  useEffect(() => {
    if (!taskInstance) {
      setTaskDef(null);
      setAttachments([]);
      return;
    }
    fetch(`/api/tasks/${taskInstance.task_definition_id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setTaskDef(data))
      .catch(() => setTaskDef(null));

    fetch(`/api/tasks/${taskInstance.task_definition_id}/attachments`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setAttachments(data))
      .catch(() => setAttachments([]));
  }, [taskInstance]);

  if (!taskInstance) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="タスク詳細"
        className="bg-white dark:bg-gray-800 w-full sm:max-w-lg sm:rounded-xl rounded-t-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {taskInstance.title}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          {taskDef && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-16">カテゴリ</span>
                <span className="text-sm text-gray-900 dark:text-gray-100">
                  {CATEGORIES[taskDef.category as CategoryKey] || taskDef.category}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-16">頻度</span>
                <span className="text-sm text-gray-900 dark:text-gray-100">
                  {formatFrequency(taskDef)}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-16">ポイント</span>
                <span className="text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded">
                  {taskDef.points}pt
                </span>
              </div>

              {taskDef.next_due_date && (
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-16">次回予定</span>
                  <span className="text-sm text-gray-900 dark:text-gray-100">{taskDef.next_due_date}</span>
                </div>
              )}

              {taskDef.notes && (
                <div>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">備考</span>
                  <div className="prose prose-sm dark:prose-invert max-w-none bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{taskDef.notes}</ReactMarkdown>
                  </div>
                </div>
              )}

              {attachments.length > 0 && (
                <div>
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">添付ファイル</span>
                  <div className="space-y-1">
                    {attachments.map((a) => (
                      <a
                        key={a.id}
                        href={`/api/attachments/${a.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {a.original_name}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
