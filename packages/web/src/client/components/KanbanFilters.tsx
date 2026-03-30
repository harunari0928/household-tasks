import { CATEGORIES, type CategoryKey } from '../types.js';

interface Props {
  assignees: string[];
  filterAssignee: string | null;
  onFilterAssigneeChange: (assignee: string | null) => void;
  filterCategory: CategoryKey | null;
  onFilterCategoryChange: (category: CategoryKey | null) => void;
}

export default function KanbanFilters({
  assignees,
  filterAssignee,
  onFilterAssigneeChange,
  filterCategory,
  onFilterCategoryChange,
}: Props) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <select
        value={filterAssignee ?? ''}
        onChange={(e) => onFilterAssigneeChange(e.target.value || null)}
        className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 min-h-[36px] bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="担当者フィルタ"
      >
        <option value="">全担当者</option>
        {assignees.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
        <option value="__unassigned">未割当</option>
      </select>

      <select
        value={filterCategory ?? ''}
        onChange={(e) => onFilterCategoryChange((e.target.value as CategoryKey) || null)}
        className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 min-h-[36px] bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="カテゴリフィルタ"
      >
        <option value="">全カテゴリ</option>
        {(Object.entries(CATEGORIES) as [CategoryKey, string][]).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>
    </div>
  );
}
