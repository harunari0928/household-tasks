import { useState, useEffect, useCallback } from 'react';
import { useApi } from './useApi.js';

export type CalendarDay = {
  date: string;
  summary: string;
};

type CalendarDaysResponse = {
  days: CalendarDay[];
  lastSyncedAt: string | null;
};

/**
 * 家族カレンダーの予定（カレンダー連動タスクの判定材料）の読み取り。
 *
 * 予定そのものは Home Assistant の同期が入れてくるので、ここから作ることはしない。
 * 設定画面で「同期が最後に動いた時刻」を見せるためだけにある
 * （同期が止まると来客準備が黙って起票されなくなるので、止まっていることに気付く口）。
 */
export function useCalendarDays() {
  const { request } = useApi();
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDays = useCallback(async () => {
    const result = await request<CalendarDaysResponse>('/api/calendar-days', undefined, { silent: true });
    if (result.ok) {
      setDays(result.data.days);
      setLastSyncedAt(result.data.lastSyncedAt);
    }
    setLoading(false);
  }, [request]);

  useEffect(() => {
    fetchDays();
  }, [fetchDays]);

  return { days, lastSyncedAt, loading };
}
