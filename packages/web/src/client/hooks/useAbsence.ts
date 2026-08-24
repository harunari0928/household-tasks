import { useState, useEffect, useCallback } from 'react';
import { useApi } from './useApi.js';
import { useRealtimeEvent } from './useRealtime.js';

export type AbsenceDay = {
  date: string;
  summary: string | null;
  source: string;
};

type AbsenceResponse = {
  keywords: string[];
  defaultKeywords: string[];
  today: AbsenceDay | null;
  days: AbsenceDay[];
  hiddenTaskCount: number;
};

/**
 * 不在日（帰省・旅行）設定の状態管理。
 *
 * 不在日そのものは Home Assistant の家族カレンダー同期が入れてくるので、
 * ここから作ることはしない（キーワード編集と、間違いの取り消しだけ）。
 *
 * リアルタイム更新はタブ内で1本の WebSocket を共有する（`lib/realtime.ts`）ため、
 * どの画面から使っても接続は増えない。
 */
export function useAbsence() {
  const { request } = useApi();
  const [keywords, setKeywords] = useState<string[]>([]);
  const [defaultKeywords, setDefaultKeywords] = useState<string[]>([]);
  const [today, setToday] = useState<AbsenceDay | null>(null);
  const [days, setDays] = useState<AbsenceDay[]>([]);
  const [hiddenTaskCount, setHiddenTaskCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchAbsence = useCallback(async () => {
    const result = await request<AbsenceResponse>('/api/absence', undefined, { silent: true });
    if (result.ok) {
      setKeywords(result.data.keywords);
      setDefaultKeywords(result.data.defaultKeywords);
      setToday(result.data.today);
      setDays(result.data.days);
      setHiddenTaskCount(result.data.hiddenTaskCount);
    }
    setLoading(false);
  }, [request]);

  useEffect(() => {
    fetchAbsence();
  }, [fetchAbsence]);

  // 同期で今日の不在状態が変わったら追随する。
  // 再接続時は切断中の同期を取りこぼしているので取り直す。
  useRealtimeEvent((event) => {
    if (event.type === 'absence_changed' || event.type === 'reconnected') fetchAbsence();
  });

  const saveKeywords = useCallback(
    async (next: string[]) => {
      const previous = keywords;
      setKeywords(next);

      const result = await request<{ keywords: string[] }>(
        '/api/absence/keywords',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keywords: next }),
        },
        { errorMessage: '不在キーワードの保存に失敗しました' },
      );

      if (result.ok) {
        setKeywords(result.data.keywords);
      } else {
        setKeywords(previous);
      }
      return result.ok;
    },
    [keywords, request],
  );

  const removeDay = useCallback(
    async (date: string) => {
      const result = await request<{ deleted: number; today: AbsenceDay | null }>(
        `/api/absence/days/${date}`,
        { method: 'DELETE' },
        { errorMessage: '不在日の取り消しに失敗しました' },
      );
      if (result.ok) {
        setDays((prev) => prev.filter((d) => d.date !== date));
        setToday(result.data.today);
      }
      return result.ok;
    },
    [request],
  );

  return {
    keywords,
    defaultKeywords,
    today,
    days,
    hiddenTaskCount,
    loading,
    saveKeywords,
    removeDay,
    refresh: fetchAbsence,
  };
}
