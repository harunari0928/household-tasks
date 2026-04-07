import { FREQUENCY_TYPES, DAYS_OF_WEEK, type TaskDefinition, type DayOfWeek, type FrequencyTypeKey } from '../types.js';

interface Props {
  tasks: TaskDefinition[];
  onEdit: (task: TaskDefinition) => void;
  onToggleActive: (task: TaskDefinition) => void;
}

function formatFrequency(task: TaskDefinition): string {
  const ft = task.frequency_type as FrequencyTypeKey;
  const label = FREQUENCY_TYPES[ft] || ft;

  switch (ft) {
    case 'daily':
      return '毎日';
    case 'weekly': {
      const days = task.days_of_week
        ?.split(',')
        .map((d) => DAYS_OF_WEEK[d.trim() as DayOfWeek] || d)
        .join(',');
      return `毎週(${days})`;
    }
    case 'n_days':
      return `${task.frequency_interval}日ごと`;
    case 'n_weeks': {
      const days = task.days_of_week
        ?.split(',')
        .map((d) => DAYS_OF_WEEK[d.trim() as DayOfWeek] || d)
        .join(',');
      return `${task.frequency_interval}週ごと(${days})`;
    }
    case 'monthly': {
      const day = task.day_of_month || 1;
      return `毎月(${day}日)`;
    }
    case 'n_months': {
      const suffix = task.day_of_month ? `(${task.day_of_month}日)` : '';
      return `${task.frequency_interval}ヶ月ごと${suffix}`;
    }
    case 'yearly': {
      if (task.month_of_year && task.day_of_month) {
        return `1年ごと(${task.month_of_year}月${task.day_of_month}日)`;
      }
      return '1年ごと';
    }
    default:
      return label;
  }
}

function formatScheduledHour(task: TaskDefinition): string {
  return `${task.scheduled_hour}時`;
}

export default function TaskList({ tasks, onEdit, onToggleActive }: Props) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 dark:text-gray-500">
        このカテゴリにはタスクがありません
      </div>
    );
  }

  return (
    <div className="space-y-1 mt-3">
      {tasks.map((task) => (
        <div
          key={task.id}
          className={`flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors cursor-pointer ${
            !task.is_active ? 'opacity-50' : ''
          }`}

        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleActive(task);
            }}
            className="flex-shrink-0 w-6 h-6 min-w-[44px] min-h-[44px] flex items-center justify-center"

            aria-label={task.is_active ? '無効にする' : '有効にする'}
          >
            {task.is_active ? '☑' : '☐'}
          </button>
          <span className="flex-shrink-0 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded-full px-2 py-0.5 min-w-[32px] text-center">
            {task.points}pt
          </span>
          <div
            className="flex-1 min-w-0"
            onClick={() => onEdit(task)}

          >
            <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{task.name}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400 flex gap-2">
              <span>{formatFrequency(task)} {formatScheduledHour(task)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
