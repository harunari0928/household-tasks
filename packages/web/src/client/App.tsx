import { useState, useEffect, useCallback } from 'react';
import { CATEGORIES, type CategoryKey, type TaskDefinition } from './types.js';
import CategoryTabs from './components/CategoryTabs.js';
import TaskList from './components/TaskList.js';
import TaskForm from './components/TaskForm.js';
import StatsPage from './components/StatsPage.js';

function getPage(): 'tasks' | 'stats' {
  return window.location.hash === '#/stats' ? 'stats' : 'tasks';
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<'tasks' | 'stats'>(getPage);
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>('water');
  const [tasks, setTasks] = useState<TaskDefinition[]>([]);
  const [allTasks, setAllTasks] = useState<TaskDefinition[]>([]);
  const [editingTask, setEditingTask] = useState<TaskDefinition | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const onHash = () => setCurrentPage(getPage());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

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

  const handleDeleted = () => {
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
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">家庭タスク管理</h1>
          <nav className="flex gap-2">
            <a
              href="#/"
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                currentPage === 'tasks'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              タスク管理
            </a>
            <a
              href="#/stats"
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                currentPage === 'stats'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              ポイント集計
            </a>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4">
        {currentPage === 'stats' ? (
          <StatsPage />
        ) : (
          <>
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

        />

        <TaskList
          tasks={tasks}
          onEdit={handleEdit}
          onToggleActive={handleToggle}
        />

        <button
          onClick={handleAdd}
          className="mt-4 w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors text-base"

        >
          ＋ タスクを追加
        </button>

        {showForm && (
          <div
            className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center"

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
                onDeleted={handleDeleted}
              />
            </div>
          </div>
        )}
          </>
        )}
      </main>
    </div>
  );
}
