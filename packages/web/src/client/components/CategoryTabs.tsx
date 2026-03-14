import { CATEGORIES, type CategoryKey } from '../types.js';

interface Props {
  selected: CategoryKey;
  onSelect: (key: CategoryKey) => void;
  counts: Record<CategoryKey, number>;
}

export default function CategoryTabs({ selected, onSelect, counts }: Props) {
  return (
    <div className="flex overflow-x-auto gap-1 pb-2 -mx-4 px-4 scrollbar-hide" data-testid="category-tabs">
      {(Object.entries(CATEGORIES) as [CategoryKey, string][]).map(([key, label]) => (
        <button
          key={key}
          onClick={() => onSelect(key)}
          className={`flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap min-h-[44px] ${
            selected === key
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
          data-testid={`category-tab-${key}`}
        >
          {label}
          {counts[key] > 0 && (
            <span
              className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                selected === key ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'
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
