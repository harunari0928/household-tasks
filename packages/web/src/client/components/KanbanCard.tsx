import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TaskInstance } from '../types.js';

function hashColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    'bg-blue-500', 'bg-pink-500', 'bg-purple-500', 'bg-green-500',
    'bg-orange-500', 'bg-teal-500', 'bg-red-500', 'bg-indigo-500',
  ];
  return colors[Math.abs(hash) % colors.length];
}

function parseAssignees(assignee: string | null): string[] {
  if (!assignee) return [];
  return assignee.split(',').map((a) => a.trim()).filter(Boolean);
}

interface Props {
  task: TaskInstance;
  isRecentlyMoved?: boolean;
  onAssigneeClick?: (task: TaskInstance) => void;
  onDelete?: (task: TaskInstance) => void;
  onCardClick?: (task: TaskInstance) => void;
}

export default function KanbanCard({ task, isRecentlyMoved, onAssigneeClick, onDelete, onCardClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { task },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const assignees = parseAssignees(task.assignee);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 shadow-sm hover:shadow-md transition-shadow${isRecentlyMoved ? ' kanban-card-moved' : ''}`}
      onClick={() => onCardClick?.(task)}
    >
      {/* Drag handle — touch target for drag-and-drop */}
      <button
        {...attributes}
        {...listeners}
        className="absolute left-0 top-0 bottom-0 w-7 flex items-center justify-center text-gray-300 dark:text-gray-600 text-[10px] leading-none select-none cursor-grab active:cursor-grabbing rounded-l-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        style={{ touchAction: 'none' }}
        aria-label="ドラッグして移動"
      >⠿</button>

      {/* Delete button — always visible on mobile, hover on desktop */}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(task);
          }}
          className="absolute top-2 right-2 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500 transition-all sm:opacity-0 sm:group-hover:opacity-100 cursor-pointer"
          aria-label="タスクを削除"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      )}

      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2 pr-6 pl-3">
        {task.title}
      </div>
      <div className="flex items-center justify-between pl-3">
        <div className="flex items-center gap-2">
          {assignees.length > 0 ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAssigneeClick?.(task);
              }}
              className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 cursor-pointer"
            >
              <div className="flex -space-x-1">
                {assignees.map((a) => (
                  <span key={a} className={`w-5 h-5 rounded-full ${hashColor(a)} text-white text-[10px] flex items-center justify-center font-bold ring-1 ring-white dark:ring-gray-800`}>
                    {a[0]}
                  </span>
                ))}
              </div>
              {assignees.join(', ')}
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAssigneeClick?.(task);
              }}
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
            >
              未割当
            </button>
          )}
        </div>
        <span className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">
          {task.points}
        </span>
      </div>
    </div>
  );
}
