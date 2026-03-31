import { useState, useEffect } from 'react';
import { useAssignees } from '../hooks/useAssignees.js';

export default function SettingsPage() {
  const { assignees, fetchAssignees, addAssignee, removeAssignee } = useAssignees();
  const [newName, setNewName] = useState('');

  useEffect(() => {
    fetchAssignees();
  }, [fetchAssignees]);

  const handleAdd = async () => {
    await addAssignee(newName);
    setNewName('');
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-6">設定</h2>

      <section>
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-4">登録ユーザー</h3>

        <div className="flex flex-col gap-2 mb-4">
          {assignees.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500">ユーザーが登録されていません</p>
          )}
          {assignees.map((name) => (
            <div
              key={name}
              className="flex items-center justify-between bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3"
            >
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{name}</span>
              <button
                onClick={() => removeAssignee(name)}
                className="p-1 text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                aria-label={`${name}を削除`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="新しいユーザー名"
            className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="新しいユーザー名"
          />
          <button
            onClick={handleAdd}
            disabled={!newName.trim()}
            className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-30 transition-colors cursor-pointer"
          >
            追加
          </button>
        </div>
      </section>
    </div>
  );
}
