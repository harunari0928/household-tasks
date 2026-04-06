import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { TaskInstance, TaskInstanceStatus } from '../types.js';
import KanbanCard from './KanbanCard.js';

const STATUS_COLORS: Record<TaskInstanceStatus, string> = {
  todo: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  done: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
};

interface Props {
  status: TaskInstanceStatus;
  title: string;
  items: TaskInstance[];
  recentlyMovedIds?: Set<number>;
  onAssigneeClick?: (task: TaskInstance) => void;
  onDelete?: (task: TaskInstance) => void;
  onClearColumn?: (status: TaskInstanceStatus) => void;
  onCardClick?: (task: TaskInstance) => void;
}

export default function KanbanColumn({ status, title, items, recentlyMovedIds, onAssigneeClick, onDelete, onClearColumn, onCardClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const [showMenu, setShowMenu] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div
      ref={setNodeRef}
      data-column-status={status}
      className={`flex-1 min-w-[200px] sm:min-w-[280px] max-w-[400px] rounded-lg p-2 flex flex-col h-full transition-colors snap-start ${
        isOver ? 'bg-blue-50 dark:bg-blue-800/40' : 'bg-gray-50 dark:bg-gray-900/50'
      }`}
    >
      <div className="group/header flex items-center gap-2 px-2 py-2 mb-2 relative">
        <span className={`w-2 h-2 rounded-full ${status === 'todo' ? 'bg-gray-400' : status === 'in_progress' ? 'bg-blue-500' : 'bg-green-500'}`} />
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h3>
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLORS[status]}`}>
          {items.length}
        </span>
        <div className="ml-auto">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="opacity-0 group-hover/header:opacity-100 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-all"
            aria-label={`${title}メニュー`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 min-w-[140px]">
                <button
                  onClick={() => {
                    setShowMenu(false);
                    setShowConfirm(true);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  すべて削除
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Confirm dialog */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setShowConfirm(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-80 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
              「{title}」の{items.length}件のタスクをすべて削除しますか？
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowConfirm(false)} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                キャンセル
              </button>
              <button
                onClick={() => {
                  setShowConfirm(false);
                  onClearColumn?.(status);
                }}
                className="px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 flex-1 min-h-[60px] overflow-y-auto overscroll-y-contain pr-1">
          {items.map((task) => (
            <KanbanCard key={task.id} task={task} isRecentlyMoved={recentlyMovedIds?.has(task.id)} onAssigneeClick={onAssigneeClick} onDelete={onDelete} onCardClick={onCardClick} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
