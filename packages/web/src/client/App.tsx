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

  const fetchTasks = useCallback(async () => {
    const res = await fetch('/api/tasks');
    const data = await res.json();
    setAllTasks(data);
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    setTasks(allTasks.filter((t) => t.category === selectedCategory));
  }, [allTasks, selectedCategory]);

  const categoryCounts = Object.keys(CATEGORIES).reduce(
    (acc, key) => {
      acc[key as CategoryKey] = allTasks.filter((t) => t.category === key).length;
      return acc;
    },
    {} as Record<CategoryKey, number>,
  );

  const handleSave = async (input: any, id?: number) => {
    const url = id ? `/api/tasks/${id}` : '/api/tasks';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (res.ok) {
      setShowForm(false);
      setEditingTask(null);
      await fetchTasks();
    }
    return res;
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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-gray-900">家庭タスク管理</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4">
        <CategoryTabs
          selected={selectedCategory}
          onSelect={setSelectedCategory}
          counts={categoryCounts}
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
          <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center">
            <div className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-xl max-h-[90vh] overflow-y-auto">
              <TaskForm
                task={editingTask}
                defaultCategory={selectedCategory}
                onSave={handleSave}
                onCancel={handleCancel}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
