import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
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

interface Props {
  currentUser: string | null;
}

export default function KanbanBoard({ currentUser }: Props) {
  const [tasks, setTasks] = useState<TaskInstance[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [filterAssignee, setFilterAssignee] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<CategoryKey | null>(null);
  const [activeTask, setActiveTask] = useState<TaskInstance | null>(null);
  const [assigneeModal, setAssigneeModal] = useState<{ task: TaskInstance; targetStatus: TaskInstanceStatus } | null>(null);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [newAssigneeName, setNewAssigneeName] = useState('');
  const [selectedTask, setSelectedTask] = useState<TaskInstance | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<TaskInstance | null>(null);
  const prevTasksRef = useRef<TaskInstance[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const fetchTasks = useCallback(async () => {
    const res = await fetch('/api/kanban');
    if (res.ok) {
      const data = await res.json();
      setTasks(data);
      prevTasksRef.current = data;
    }
  }, []);

  const fetchAssignees = useCallback(async () => {
    const res = await fetch('/api/kanban/assignees');
    if (res.ok) {
      setAssignees(await res.json());
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchAssignees();
  }, [fetchTasks, fetchAssignees]);

  // SSE for real-time updates
  useEffect(() => {
    const eventSource = new EventSource('/api/kanban/events');
    eventSource.onmessage = () => {
      fetchTasks();
    };
    return () => eventSource.close();
  }, [fetchTasks]);

  const updateStatus = async (
    taskId: number,
    status: TaskInstanceStatus,
    assignee?: string | null,
  ) => {
    const body: Record<string, unknown> = { status };
    if (assignee !== undefined) body.assignee = assignee;

    const res = await fetch(`/api/kanban/${taskId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      setTasks(prevTasksRef.current);
    } else {
      prevTasksRef.current = tasks;
    }
  };

  const updateAssignee = async (taskId: number, assignee: string | null) => {
    await fetch(`/api/kanban/${taskId}/assignee`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee }),
    });
  };

  const deleteTask = async (task: TaskInstance) => {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    await fetch(`/api/kanban/${task.id}`, { method: 'DELETE' });
  };

  const clearColumn = async (status: TaskInstanceStatus) => {
    setTasks((prev) => prev.filter((t) => t.status !== status));
    await fetch(`/api/kanban?status=${status}`, { method: 'DELETE' });
  };

  const handleDragStart = (event: DragStartEvent) => {
    const task = event.active.data.current?.task as TaskInstance | undefined;
    setActiveTask(task ?? null);
  };

  const reorderTasks = async (status: TaskInstanceStatus, sortedIds: number[]) => {
    const res = await fetch('/api/kanban/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, sortedIds }),
    });
    if (!res.ok) {
      setTasks(prevTasksRef.current);
    } else {
      prevTasksRef.current = tasks;
    }
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
      const sortedIds = reordered.map((t) => t.id);

      // Optimistic update
      setTasks((prev) => {
        const others = prev.filter((t) => t.status !== targetStatus);
        const updated = reordered.map((t, i) => ({ ...t, sort_order: i }));
        return [...others, ...updated];
      });

      reorderTasks(targetStatus, sortedIds);
      return;
    }

    // Cross-column move
    if (targetStatus === 'done' && !task.assignee) {
      setAssigneeModal({ task, targetStatus });
      setSelectedAssignees([]);
      return;
    }

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== task.id) return t;
        const updated = { ...t, status: targetStatus };
        if (targetStatus === 'in_progress' && !t.assignee && currentUser) {
          updated.assignee = currentUser;
        }
        if (targetStatus === 'done') {
          updated.completed_at = new Date().toISOString();
        } else {
          updated.completed_at = null;
        }
        return updated;
      }),
    );

    if (targetStatus === 'in_progress' && !task.assignee && currentUser) {
      updateStatus(task.id, targetStatus, currentUser);
    } else {
      updateStatus(task.id, targetStatus);
    }
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

    if (targetStatus !== task.status) {
      // Status change (e.g., moving to done)
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? { ...t, status: targetStatus, assignee: assigneeStr, completed_at: targetStatus === 'done' ? new Date().toISOString() : null }
            : t,
        ),
      );
      updateStatus(task.id, targetStatus, assigneeStr);
    } else {
      // Just changing assignee
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, assignee: assigneeStr } : t)),
      );
      updateAssignee(task.id, assigneeStr);
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
    const updated = [...assignees, name];
    setAssignees(updated);
    setNewAssigneeName('');
    await fetch('/api/kanban/assignees', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignees: updated }),
    });
  };

  const removeRegisteredAssignee = async (name: string) => {
    const updated = assignees.filter((a) => a !== name);
    setAssignees(updated);
    setSelectedAssignees((prev) => prev.filter((a) => a !== name));
    await fetch('/api/kanban/assignees', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignees: updated }),
    });
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
    return true;
  });

  const columns = (Object.keys(KANBAN_COLUMNS) as TaskInstanceStatus[]).map((status) => ({
    status,
    title: KANBAN_COLUMNS[status],
    items: filtered.filter((t) => t.status === status).sort((a, b) => a.sort_order - b.sort_order),
  }));

  return (
    <div>
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
        <div className="flex gap-2 sm:gap-4 overflow-x-auto pb-4 h-[calc(100vh-160px)] sm:h-[calc(100vh-180px)] snap-x snap-mandatory sm:snap-none">
          {columns.map((col) => (
            <KanbanColumn
              key={col.status}
              status={col.status}
              title={col.title}
              items={col.items}
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
                <div key={a} className="flex items-center justify-between">
                  <label className="flex items-center gap-2 flex-1 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={selectedAssignees.includes(a)}
                      onChange={() => toggleAssignee(a)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{a}</span>
                  </label>
                  <button
                    onClick={() => removeRegisteredAssignee(a)}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    aria-label={`${a}を削除`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
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
                className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
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
