import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import {
  KANBAN_COLUMNS,
  type TaskInstance,
  type TaskInstanceStatus,
  type CategoryKey,
} from '../types.js';
import KanbanColumn from './KanbanColumn.js';
import KanbanCard from './KanbanCard.js';
import KanbanFilters from './KanbanFilters.js';
import TaskDetailDialog from './TaskDetailDialog.js';
import { useAssignees } from '../hooks/useAssignees.js';
import { useApi } from '../hooks/useApi.js';
import { useToast } from '../contexts/ToastContext.js';

type KanbanBoardProps = {
  currentUser: string | null;
};

export default function KanbanBoard({ currentUser }: KanbanBoardProps) {
  const [tasks, setTasks] = useState<TaskInstance[]>([]);
  const { request } = useApi();
  const { showInfo } = useToast();
  const { assignees, loaded: assigneesLoaded, fetchAssignees, addAssignee: addRegisteredAssignee } = useAssignees();
  const [filterAssignee, setFilterAssignee] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<CategoryKey | null>(null);
  const [activeTask, setActiveTask] = useState<TaskInstance | null>(null);
  const [assigneeModal, setAssigneeModal] = useState<{ task: TaskInstance; targetStatus: TaskInstanceStatus } | null>(null);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [newAssigneeName, setNewAssigneeName] = useState('');
  const [selectedTask, setSelectedTask] = useState<TaskInstance | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<TaskInstance | null>(null);
  const prevTasksRef = useRef<TaskInstance[]>([]);
  const localMovedRef = useRef<Set<number>>(new Set());
  const sseDisconnectedRef = useRef(false);
  const [recentlyMovedIds, setRecentlyMovedIds] = useState<Set<number>>(new Set());

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 5 } }),
  );

  const fetchTasks = useCallback(async () => {
    const result = await request<TaskInstance[]>('/api/kanban', undefined, {
      errorMessage: 'タスクの取得に失敗しました',
      onRetry: () => fetchTasks(),
    });
    if (!result.ok) return;
    const data = result.data;

    // Detect tasks moved by other users (SSE) — exclude self-initiated moves
    if (prevTasksRef.current.length > 0) {
      const prevMap = new Map(prevTasksRef.current.map((t) => [t.id, t.status]));
      const movedIds = data
        .filter((t: TaskInstance) => {
          const prev = prevMap.get(t.id);
          return prev && prev !== t.status && !localMovedRef.current.has(t.id);
        })
        .map((t: TaskInstance) => t.id);
      if (movedIds.length > 0) {
        setRecentlyMovedIds(new Set(movedIds));
        setTimeout(() => setRecentlyMovedIds(new Set()), 1500);
      }
    }

    setTasks(data);
    prevTasksRef.current = data;
  }, [request]);


  useEffect(() => {
    fetchTasks();
    fetchAssignees();
  }, [fetchTasks, fetchAssignees]);

  // SSE for real-time updates
  useEffect(() => {
    const eventSource = new EventSource('/api/kanban/events');
    eventSource.onopen = () => {
      sseDisconnectedRef.current = false;
    };
    eventSource.onmessage = () => {
      fetchTasks();
    };
    eventSource.onerror = () => {
      // EventSource auto-reconnects; notify once per disconnection to avoid spam.
      if (!sseDisconnectedRef.current) {
        sseDisconnectedRef.current = true;
        showInfo('リアルタイム更新が一時的に切断されました。自動的に再接続します。');
      }
    };
    return () => eventSource.close();
  }, [fetchTasks, showInfo]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchTasks();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchTasks]);

  // Apply a status change with optimistic UI + rollback on failure.
  // `snapshot` is the full task list before the move; on a communication
  // error the card is restored to its original column/position/assignee.
  const performStatusChange = async (
    task: TaskInstance,
    targetStatus: TaskInstanceStatus,
    assignee: string | null | undefined,
    snapshot: TaskInstance[],
  ) => {
    // Mark as local so the SSE echo won't highlight our own move.
    localMovedRef.current.add(task.id);
    setTimeout(() => localMovedRef.current.delete(task.id), 3000);

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== task.id) return t;
        const updated = { ...t, status: targetStatus };
        if (assignee !== undefined) updated.assignee = assignee;
        updated.completed_at = targetStatus === 'done' ? new Date().toISOString() : null;
        return updated;
      }),
    );

    const body: Record<string, unknown> = { status: targetStatus };
    if (assignee !== undefined) body.assignee = assignee;

    const result = await request(
      `/api/kanban/${task.id}/status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      {
        errorMessage: 'タスクのステータス変更に失敗しました',
        onRetry: () => performStatusChange(task, targetStatus, assignee, snapshot),
      },
    );

    if (!result.ok) setTasks(snapshot);
  };

  const performAssigneeChange = async (
    task: TaskInstance,
    assignee: string | null,
    snapshot: TaskInstance[],
  ) => {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, assignee } : t)));
    const result = await request(
      `/api/kanban/${task.id}/assignee`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignee }),
      },
      {
        errorMessage: '担当者の変更に失敗しました',
        onRetry: () => performAssigneeChange(task, assignee, snapshot),
      },
    );
    if (!result.ok) setTasks(snapshot);
  };

  const deleteTask = async (task: TaskInstance) => {
    const snapshot = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    const result = await request(
      `/api/kanban/${task.id}`,
      { method: 'DELETE' },
      {
        errorMessage: 'タスクの削除に失敗しました',
        onRetry: () => deleteTask(task),
      },
    );
    if (!result.ok) setTasks(snapshot);
  };

  const clearColumn = async (status: TaskInstanceStatus) => {
    const snapshot = tasks;
    setTasks((prev) => prev.filter((t) => t.status !== status));
    const result = await request(
      `/api/kanban?status=${status}`,
      { method: 'DELETE' },
      {
        errorMessage: 'タスクの一括削除に失敗しました',
        onRetry: () => clearColumn(status),
      },
    );
    if (!result.ok) setTasks(snapshot);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task as TaskInstance | undefined;
    setActiveTask(task ?? null);
  };

  const performReorder = async (
    status: TaskInstanceStatus,
    reordered: TaskInstance[],
    snapshot: TaskInstance[],
  ) => {
    // Optimistic update
    setTasks((prev) => {
      const others = prev.filter((t) => t.status !== status);
      const updated = reordered.map((t, i) => ({ ...t, sort_order: i }));
      return [...others, ...updated];
    });

    const sortedIds = reordered.map((t) => t.id);
    const result = await request(
      '/api/kanban/reorder',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, sortedIds }),
      },
      {
        errorMessage: '並び順の変更に失敗しました',
        onRetry: () => performReorder(status, reordered, snapshot),
      },
    );
    if (!result.ok) setTasks(snapshot);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const task = active.data.current?.task as TaskInstance | undefined;
    if (!task) return;

    // Determine target: over.id can be a column status or a task id
    let targetStatus: TaskInstanceStatus;
    let overTaskId: number | null = null;

    if (Object.keys(KANBAN_COLUMNS).includes(String(over.id))) {
      targetStatus = over.id as TaskInstanceStatus;
    } else {
      const overTask = over.data.current?.task as TaskInstance | undefined;
      if (!overTask) return;
      targetStatus = overTask.status;
      overTaskId = overTask.id;
    }

    // Capture the pre-move state so we can roll back on a communication error.
    const snapshot = tasks;

    if (task.status === targetStatus) {
      // Same-column reorder
      if (overTaskId === null || task.id === overTaskId) return;

      const columnItems = tasks
        .filter((t) => t.status === targetStatus)
        .sort((a, b) => a.sort_order - b.sort_order);

      const oldIndex = columnItems.findIndex((t) => t.id === task.id);
      const newIndex = columnItems.findIndex((t) => t.id === overTaskId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const reordered = arrayMove(columnItems, oldIndex, newIndex);
      performReorder(targetStatus, reordered, snapshot);
      return;
    }

    // Cross-column move
    const autoAssign =
      targetStatus === 'done' && !task.assignee && currentUser ? currentUser : null;

    performStatusChange(task, targetStatus, autoAssign ?? undefined, snapshot);
  };

  const openAssigneeModal = (task: TaskInstance, targetStatus?: TaskInstanceStatus) => {
    const current = task.assignee ? task.assignee.split(',').map((a) => a.trim()).filter(Boolean) : [];
    setSelectedAssignees(current);
    setAssigneeModal({ task, targetStatus: targetStatus ?? task.status });
  };

  const handleAssigneeConfirm = () => {
    if (!assigneeModal) return;
    const { task, targetStatus } = assigneeModal;
    const assigneeStr = selectedAssignees.length > 0 ? selectedAssignees.join(',') : null;
    const snapshot = tasks;

    if (targetStatus !== task.status) {
      // Status change (e.g., moving to done) with assignee set in one request.
      performStatusChange(task, targetStatus, assigneeStr, snapshot);
    } else {
      // Just changing assignee
      performAssigneeChange(task, assigneeStr, snapshot);
    }
    setAssigneeModal(null);
  };

  const toggleAssignee = (name: string) => {
    setSelectedAssignees((prev) =>
      prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name],
    );
  };

  const addNewAssignee = async () => {
    const name = newAssigneeName.trim();
    if (!name || assignees.includes(name)) return;
    setNewAssigneeName('');
    await addRegisteredAssignee(name);
  };

  const handleDeleteClick = (task: TaskInstance) => {
    setDeleteConfirm(task);
  };

  // Filter tasks
  const filtered = tasks.filter((t) => {
    if (filterAssignee === '__unassigned') {
      if (t.assignee) return false;
    } else if (filterAssignee && (!t.assignee || !t.assignee.split(',').map((a) => a.trim()).includes(filterAssignee))) {
      return false;
    }
    if (filterCategory && t.category !== filterCategory) return false;
    // Show only tasks completed within the last 24 hours
    if (t.status === 'done') {
      if (!t.completed_at) return false;
      const completedAt = new Date(t.completed_at).getTime();
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      if (completedAt < oneDayAgo) return false;
    }
    return true;
  });

  const columns = (Object.keys(KANBAN_COLUMNS) as TaskInstanceStatus[]).map((status) => ({
    status,
    title: KANBAN_COLUMNS[status],
    items: filtered.filter((t) => t.status === status).sort((a, b) => a.sort_order - b.sort_order),
  }));

  const noUsersRegistered = assigneesLoaded && assignees.length === 0;

  return (
    <div className="select-none">
      {noUsersRegistered && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="ユーザー未登録"
            className="bg-white dark:bg-gray-800 rounded-xl p-6 w-80 shadow-xl text-center"
          >
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
              ユーザーが登録されていません。設定画面からユーザーを追加してください。
            </p>
            <a
              href="#/settings"
              className="inline-block px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              設定画面へ
            </a>
          </div>
        </div>
      )}
      <div className="mb-4">
        <KanbanFilters
          assignees={assignees}
          filterAssignee={filterAssignee}
          onFilterAssigneeChange={setFilterAssignee}
          filterCategory={filterCategory}
          onFilterCategoryChange={setFilterCategory}
        />
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-2 sm:gap-4 overflow-x-auto pb-4 h-[calc(100dvh-160px)] sm:h-[calc(100dvh-180px)] snap-x snap-proximity sm:snap-none">
          {columns.map((col) => (
            <KanbanColumn
              key={col.status}
              status={col.status}
              title={col.title}
              items={col.items}
              recentlyMovedIds={recentlyMovedIds}
              onAssigneeClick={(task) => openAssigneeModal(task)}
              onDelete={handleDeleteClick}
              onClearColumn={clearColumn}
              onCardClick={(task) => setSelectedTask(task)}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? <KanbanCard task={activeTask} /> : null}
        </DragOverlay>
      </DndContext>

      {/* Task detail dialog */}
      <TaskDetailDialog taskInstance={selectedTask} onClose={() => setSelectedTask(null)} />

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-80 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
              「{deleteConfirm.title}」を削除しますか？
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">
                キャンセル
              </button>
              <button
                onClick={() => {
                  deleteTask(deleteConfirm);
                  setDeleteConfirm(null);
                }}
                className="px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assignee selection modal (multi-select + management) */}
      {assigneeModal && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
          onClick={() => setAssigneeModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="担当者を選択"
            className="bg-white dark:bg-gray-800 rounded-xl p-6 w-80 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              担当者を選択
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              「{assigneeModal.task.title}」
            </p>
            <div className="flex flex-col gap-1 mb-4">
              {assignees.map((a) => (
                <label key={a} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={selectedAssignees.includes(a)}
                      onChange={() => toggleAssignee(a)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{a}</span>
                  </label>
              ))}
            </div>

            {/* Add new assignee */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newAssigneeName}
                onChange={(e) => setNewAssigneeName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addNewAssignee()}
                placeholder="担当者を追加..."
                className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400"
                aria-label="新しい担当者名"
              />
              <button
                onClick={addNewAssignee}
                disabled={!newAssigneeName.trim()}
                className="px-2 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg disabled:opacity-30 transition-colors"
              >
                追加
              </button>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setAssigneeModal(null)}
                className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                キャンセル
              </button>
              <button
                onClick={handleAssigneeConfirm}
                disabled={assigneeModal.targetStatus === 'done' && selectedAssignees.length === 0}
                className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                確定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
