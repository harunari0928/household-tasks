import { useState, useEffect, useCallback } from 'react';
import { CATEGORIES, type CategoryKey, type TaskDefinition } from './types.js';
import CategoryTabs from './components/CategoryTabs.js';
import TaskList from './components/TaskList.js';
import TaskForm from './components/TaskForm.js';
import StatsPage from './components/StatsPage.js';
import KanbanBoard from './components/KanbanBoard.js';
import SettingsPage from './components/SettingsPage.js';
import useTheme from './hooks/useTheme.js';
import { useAssignees } from './hooks/useAssignees.js';

type Page = 'kanban' | 'tasks' | 'stats' | 'settings';

function getPage(): Page {
  const hash = window.location.hash;
  if (hash === '#/tasks') return 'tasks';
  if (hash === '#/stats') return 'stats';
  if (hash === '#/settings') return 'settings';
  return 'kanban';
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [currentPage, setCurrentPage] = useState<Page>(getPage);
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>('water');
  const [tasks, setTasks] = useState<TaskDefinition[]>([]);
  const [allTasks, setAllTasks] = useState<TaskDefinition[]>([]);
  const [editingTask, setEditingTask] = useState<TaskDefinition | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Current user state
  const [currentUser, setCurrentUser] = useState<string | null>(() =>
    localStorage.getItem('current_user'),
  );
  const { assignees, fetchAssignees } = useAssignees();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showHamburger, setShowHamburger] = useState(false);

  useEffect(() => {
    const onHash = () => setCurrentPage(getPage());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Fetch assignees for user switcher (refetch on page change to stay in sync)
  useEffect(() => {
    fetchAssignees().then((data) => {
      if (!currentUser && data.length > 0) {
        setCurrentUser(data[0]);
        localStorage.setItem('current_user', data[0]);
      }
    });
  }, [currentPage]);

  const handleUserChange = (user: string) => {
    setCurrentUser(user);
    localStorage.setItem('current_user', user);
    setShowUserMenu(false);
  };

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

  const navItems: { page: Page; hash: string; label: string }[] = [
    { page: 'kanban', hash: '#/', label: 'カンバン' },
    { page: 'tasks', hash: '#/tasks', label: 'タスク管理' },
    { page: 'stats', hash: '#/stats', label: 'ポイント集計' },
    { page: 'settings', hash: '#/settings', label: '設定' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 sm:py-4 flex items-center justify-between">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100">家事</h1>
          <div className="flex items-center gap-1 sm:gap-2">
            {/* PC: inline nav */}
            <nav className="hidden sm:flex gap-2">
              {navItems.map((item) => (
                <a
                  key={item.page}
                  href={item.hash}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    currentPage === item.page
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {item.label}
                </a>
              ))}
            </nav>

            {/* User switcher */}
            {assignees.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => {
                    if (!showUserMenu) fetchAssignees();
                    setShowUserMenu(!showUserMenu);
                  }}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors min-h-[36px]"
                  aria-label="ユーザー切替"
                >
                  <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center font-bold">
                    {currentUser?.[0] ?? '?'}
                  </span>
                  <span className="hidden sm:inline">{currentUser ?? '未選択'}</span>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {showUserMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 min-w-[120px]">
                      {assignees.map((a) => (
                        <button
                          key={a}
                          onClick={() => handleUserChange(a)}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors first:rounded-t-lg last:rounded-b-lg ${
                            a === currentUser ? 'font-bold text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'
                          }`}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors"
              aria-label={theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
            >
              {theme === 'dark' ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              )}
            </button>

            {/* Mobile: hamburger menu */}
            <div className="relative sm:hidden">
              <button
                onClick={() => setShowHamburger(!showHamburger)}
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors"
                aria-label="メニュー"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              </button>
              {showHamburger && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowHamburger(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 min-w-[160px]">
                    {navItems.map((item) => (
                      <a
                        key={item.page}
                        href={item.hash}
                        onClick={() => setShowHamburger(false)}
                        className={`flex items-center gap-2 w-full px-4 py-3 text-sm transition-colors first:rounded-t-lg last:rounded-b-lg ${
                          currentPage === item.page
                            ? 'text-blue-600 dark:text-blue-400 font-bold bg-blue-50 dark:bg-blue-900/20'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                      >
                        {currentPage === item.page && (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
                        )}
                        {item.label}
                      </a>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className={`mx-auto px-3 sm:px-4 py-3 sm:py-4 ${currentPage === 'kanban' ? 'max-w-full' : 'max-w-5xl'}`}>
        {currentPage === 'kanban' ? (
          <KanbanBoard currentUser={currentUser} />
        ) : currentPage === 'stats' ? (
          <StatsPage />
        ) : currentPage === 'settings' ? (
          <SettingsPage />
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
          className="mt-3 w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 min-h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
        />

        <TaskList
          tasks={tasks}
          onEdit={handleEdit}
          onToggleActive={handleToggle}
        />

        <button
          onClick={handleAdd}
          className="mt-4 w-full py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 dark:hover:border-blue-500 dark:hover:text-blue-400 transition-colors text-base"
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
              className="bg-white dark:bg-gray-800 w-full sm:max-w-lg sm:rounded-xl rounded-t-xl max-h-[90vh] overflow-y-auto"
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
