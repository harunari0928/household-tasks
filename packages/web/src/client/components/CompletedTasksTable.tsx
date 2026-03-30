import { useState, useMemo, useEffect, useRef, useCallback } from 'react';

interface PointDetail {
  task_name: string;
  points: number;
  done_at: string;
  assignee: string;
}

type SortKey = 'task_name' | 'assignee' | 'done_at';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 30;

export default function CompletedTasksTable({ details }: { details: PointDetail[] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('done_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const uniqueAssignees = useMemo(
    () => [...new Set(details.map((d) => d.assignee))].sort(),
    [details],
  );

  const processedDetails = useMemo(() => {
    let result = details;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((d) => d.task_name.toLowerCase().includes(q));
    }

    if (filterAssignee) {
      result = result.filter((d) => d.assignee === filterAssignee);
    }

    if (filterDateFrom) {
      result = result.filter((d) => d.done_at.slice(0, 10) >= filterDateFrom);
    }
    if (filterDateTo) {
      result = result.filter((d) => d.done_at.slice(0, 10) <= filterDateTo);
    }

    result = [...result].sort((a, b) => {
      let cmp: number;
      if (sortKey === 'done_at') {
        cmp = new Date(a.done_at).getTime() - new Date(b.done_at).getTime();
      } else {
        cmp = String(a[sortKey]).localeCompare(String(b[sortKey]), 'ja');
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [details, searchQuery, filterAssignee, filterDateFrom, filterDateTo, sortKey, sortDir]);

  // Reset display count when filters/sort change
  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
  }, [searchQuery, filterAssignee, filterDateFrom, filterDateTo, sortKey, sortDir]);

  // Infinite scroll with IntersectionObserver
  const loadMore = useCallback(() => {
    setDisplayCount((prev) => prev + PAGE_SIZE);
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, processedDetails.length]);

  const visibleDetails = processedDetails.slice(0, displayCount);
  const hasMore = displayCount < processedDetails.length;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'done_at' ? 'desc' : 'asc');
    }
  };

  const sortIndicator = (key: SortKey): string => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
      <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-4">完了タスク一覧</h2>

      {/* Filters */}
      <div className="space-y-2 mb-4">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            aria-label="完了タスクを検索"
            placeholder="タスク名で検索"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 min-w-[160px] border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
          <select
            value={filterAssignee}
            onChange={(e) => setFilterAssignee(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            aria-label="担当フィルタ"
          >
            <option value="">全担当者</option>
            {uniqueAssignees.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm text-gray-500 dark:text-gray-400">完了日:</span>
          <input
            type="date"
            aria-label="完了日From"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
          <span className="text-gray-500 dark:text-gray-400">〜</span>
          <input
            type="date"
            aria-label="完了日To"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
        </div>
      </div>

      {processedDetails.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-center py-4">該当するタスクがありません</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-gray-900 dark:text-gray-100">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th
                    className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400"
                    onClick={() => handleSort('task_name')}
                    aria-label="タスクでソート"
                  >
                    タスク{sortIndicator('task_name')}
                  </th>
                  <th
                    className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400"
                    onClick={() => handleSort('assignee')}
                    aria-label="担当でソート"
                  >
                    担当{sortIndicator('assignee')}
                  </th>
                  <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">
                    ポイント
                  </th>
                  <th
                    className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300 cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400"
                    onClick={() => handleSort('done_at')}
                    aria-label="完了日でソート"
                  >
                    完了日{sortIndicator('done_at')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleDetails.map((d, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-gray-700/50">
                    <td className="py-2 px-2">{d.task_name}</td>
                    <td className="py-2 px-2">{d.assignee}</td>
                    <td className="py-2 px-2 text-right">{d.points}</td>
                    <td className="py-2 px-2 text-gray-500 dark:text-gray-400">
                      {new Date(d.done_at).toLocaleDateString('ja-JP')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              <span className="text-sm text-gray-400 dark:text-gray-500">
                残り{processedDetails.length - displayCount}件
              </span>
            </div>
          )}
          {!hasMore && processedDetails.length > PAGE_SIZE && (
            <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-2">
              全{processedDetails.length}件を表示
            </p>
          )}
        </>
      )}
    </div>
  );
}
