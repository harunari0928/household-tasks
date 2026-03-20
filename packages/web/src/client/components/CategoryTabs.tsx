import { CATEGORIES, type CategoryKey } from '../types.js';

interface Props {
  selected: CategoryKey | null;
  onSelect: (key: CategoryKey) => void;
  counts: Record<CategoryKey, number>;
}

export default function CategoryTabs({ selected, onSelect, counts }: Props) {
  return (
    <div className="flex overflow-x-auto gap-1 pb-2 -mx-4 px-4 scrollbar-hide">
      {(Object.entries(CATEGORIES) as [CategoryKey, string][]).map(([key, label]) => (
        <button
          key={key}
          onClick={() => onSelect(key)}
          className={`flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap min-h-[44px] ${
            selected === key
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'
          }`}

        >
          {label}
          {counts[key] > 0 && (
            <span
              className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                selected === key ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}
            >
              {counts[key]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
