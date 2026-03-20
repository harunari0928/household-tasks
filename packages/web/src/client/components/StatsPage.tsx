import { useState, useEffect, useCallback } from 'react';
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts';

interface PointDetail {
  task_name: string;
  points: number;
  done_at: string;
  assignee: string;
}

interface StatsData {
  totals: Record<string, number>;
  details: PointDetail[];
}

const COLORS = ['#3b82f6', '#ec4899', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444'];

function getMonthRange(offset: number): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + offset;
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  return {
    start: first.toISOString().split('T')[0],
    end: last.toISOString().split('T')[0],
  };
}

function getWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday start
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  };
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

export default function StatsPage() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endIsToday, setEndIsToday] = useState(false);
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [savedStart, setSavedStart] = useState('');
  const [savedEnd, setSavedEnd] = useState('');
  const [savedEndIsToday, setSavedEndIsToday] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // Load saved period settings
  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((settings: Record<string, string>) => {
        if (settings.chart_start_date && settings.chart_end_date) {
          const isToday = settings.chart_end_date === 'TODAY';
          const resolvedEnd = isToday ? todayStr() : settings.chart_end_date;
          setStartDate(settings.chart_start_date);
          setEndDate(resolvedEnd);
          setEndIsToday(isToday);
          setSavedStart(settings.chart_start_date);
          setSavedEnd(resolvedEnd);
          setSavedEndIsToday(isToday);
        } else {
          const range = getMonthRange(0);
          setStartDate(range.start);
          setEndDate(range.end);
          setSavedStart(range.start);
          setSavedEnd(range.end);
        }
        setSettingsLoaded(true);
      })
      .catch(() => {
        const range = getMonthRange(0);
        setStartDate(range.start);
        setEndDate(range.end);
        setSavedStart(range.start);
        setSavedEnd(range.end);
        setSettingsLoaded(true);
      });
  }, []);

  // Save period settings explicitly
  const savePeriod = useCallback(() => {
    if (!startDate || !endDate) return;
    const endValue = endIsToday ? 'TODAY' : endDate;
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chart_start_date: startDate, chart_end_date: endValue }),
    }).then((res) => {
      if (res.ok) {
        setSavedStart(startDate);
        setSavedEnd(endDate);
        setSavedEndIsToday(endIsToday);
        setSaveMessage('保存しました');
        setTimeout(() => setSaveMessage(''), 2000);
      }
    });
  }, [startDate, endDate, endIsToday]);

  // Fetch stats data
  useEffect(() => {
    if (!settingsLoaded || !startDate || !endDate) return;

    setLoading(true);
    setError('');
    fetch(`/api/stats/points?start=${startDate}&end=${endDate}`)
      .then((res) => {
        if (!res.ok) throw new Error('データの取得に失敗しました');
        return res.json();
      })
      .then((d: StatsData) => setData(d))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [startDate, endDate, settingsLoaded]);

  const handlePreset = (preset: 'thisMonth' | 'lastMonth' | 'thisWeek' | 'untilToday') => {
    if (preset === 'untilToday') {
      setEndDate(todayStr());
      setEndIsToday(true);
      return;
    }
    setEndIsToday(false);
    let range: { start: string; end: string };
    switch (preset) {
      case 'thisMonth':
        range = getMonthRange(0);
        break;
      case 'lastMonth':
        range = getMonthRange(-1);
        break;
      case 'thisWeek':
        range = getWeekRange();
        break;
    }
    setStartDate(range.start);
    setEndDate(range.end);
  };

  const handleDateChange = (field: 'start' | 'end', value: string) => {
    const newStart = field === 'start' ? value : startDate;
    const newEnd = field === 'end' ? value : endDate;
    if (field === 'end') setEndIsToday(false);
    setStartDate(newStart);
    setEndDate(newEnd);
  };

  const pieData = data
    ? Object.entries(data.totals).map(([name, value]) => ({ name, value }))
    : [];

  const totalPoints = pieData.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">期間</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handlePreset('thisWeek')}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
          >
            今週
          </button>
          <button
            type="button"
            onClick={() => handlePreset('thisMonth')}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
          >
            今月
          </button>
          <button
            type="button"
            onClick={() => handlePreset('lastMonth')}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
          >
            先月
          </button>
          <button
            type="button"
            onClick={() => handlePreset('untilToday')}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              endIsToday
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            〜今日
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            aria-label="開始日"
            value={startDate}
            onChange={(e) => handleDateChange('start', e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
          <span className="text-gray-500 dark:text-gray-400">〜</span>
          <input
            type="date"
            aria-label="終了日"
            value={endDate}
            onChange={(e) => handleDateChange('end', e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm min-h-[44px] bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
        </div>
        {(startDate !== savedStart || endDate !== savedEnd || endIsToday !== savedEndIsToday) && (
          <button
            type="button"
            onClick={savePeriod}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            みんなに保存
          </button>
        )}
        {saveMessage && (
          <p className="text-sm text-green-600 dark:text-green-400">{saveMessage}</p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-3 rounded-lg text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center text-gray-500 dark:text-gray-400 py-8">読み込み中...</div>
      )}

      {/* Pie chart */}
      {!loading && data && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-4">ポイント比較</h2>
          {pieData.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">この期間の完了タスクはありません</p>
          ) : (
            <>
              <div className="w-full" style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, value }) => `${name}: ${value}pt`}
                    >
                      {pieData.map((_entry, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => `${value}pt`} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-2">
                合計: {totalPoints}pt
              </p>
            </>
          )}
        </div>
      )}

      {/* Detail table */}
      {!loading && data && data.details.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 mb-4">完了タスク一覧</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-gray-900 dark:text-gray-100">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300">タスク</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300">担当</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-700 dark:text-gray-300">ポイント</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-700 dark:text-gray-300">完了日</th>
                </tr>
              </thead>
              <tbody>
                {data.details
                  .sort((a, b) => new Date(b.done_at).getTime() - new Date(a.done_at).getTime())
                  .map((d, i) => (
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
        </div>
      )}
    </div>
  );
}
