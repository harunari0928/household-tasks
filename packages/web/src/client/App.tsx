import { useState, useEffect, useCallback } from 'react';
import { CATEGORIES, type CategoryKey, type TaskDefinition } from './types.js';
import CategoryTabs from './components/CategoryTabs.js';
import TaskList from './components/TaskList.js';
import TaskForm from './components/TaskForm.js';

export default function App() {
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>('water');
  const [tasks, setTasks] = useState<TaskDefinition[]>([]);
  const [allTasks, setAllTasks] = useState<TaskDefinition[]>([]);
  const [editingTask, setEditingTask] = useState<TaskDefinition | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchTasks = useCallback(async () => {
    const res = await fetch('/api/tasks');
    const data = await res.json();
    setAllTasks(data);
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (searchQuery) {
      setTasks(allTasks.filter((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase())));
    } else {
      setTasks(allTasks.filter((t) => t.category === selectedCategory));
    }
  }, [allTasks, selectedCategory, searchQuery]);

  const categoryCounts = Object.keys(CATEGORIES).reduce(
    (acc, key) => {
      acc[key as CategoryKey] = allTasks.filter((t) => t.category === key).length;
      return acc;
    },
    {} as Record<CategoryKey, number>,
  );

  const handleSaved = () => {
    setShowForm(false);
    setEditingTask(null);
    fetchTasks();
  };

  const handleToggle = async (task: TaskDefinition) => {
    const res = await fetch(`/api/tasks/${task.id}/toggle`, { method: 'POST' });
    if (res.ok) {
      await fetchTasks();
    }
  };

  const handleEdit = (task: TaskDefinition) => {
    setEditingTask(task);
    setShowForm(true);
  };

  const handleAdd = () => {
    setEditingTask(null);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingTask(null);
  };

  useEffect(() => {
    if (!showForm) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showForm]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-gray-900">家庭タスク管理</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4">
        <CategoryTabs
          selected={searchQuery ? null : selectedCategory}
          onSelect={(key) => {
            setSearchQuery('');
            setSelectedCategory(key);
          }}
          counts={categoryCounts}
        />

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="タスクを検索..."
          aria-label="タスクを検索"
          className="mt-3 w-full border border-gray-300 rounded-lg px-3 py-2 min-h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          data-testid="search-input"
        />

        <TaskList
          tasks={tasks}
          onEdit={handleEdit}
          onToggleActive={handleToggle}
        />

        <button
          onClick={handleAdd}
          className="mt-4 w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors text-base"
          data-testid="add-task-button"
        >
          ＋ タスクを追加
        </button>

        {showForm && (
          <div
            className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center"
            data-testid="dialog-overlay"
            onClick={handleCancel}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={editingTask ? 'タスクを編集' : 'タスクを追加'}
              className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-xl max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <TaskForm
                task={editingTask}
                defaultCategory={selectedCategory}
                onSaved={handleSaved}
                onCancel={handleCancel}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
