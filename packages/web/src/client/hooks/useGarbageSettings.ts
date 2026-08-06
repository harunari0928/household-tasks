import { useState, useEffect, useCallback } from 'react';
import { useApi } from './useApi.js';

export type GarbageType = {
  id: string;
  label: string;
  scheduleLabel: string;
};

export type NextGarbageDay = {
  date: string;
  types: string[];
};

type GarbageResponse = {
  types: GarbageType[];
  hiddenTypes: string[];
  next: NextGarbageDay | null;
};

/**
 * ごみ収集設定の状態管理。
 * 種類ごとの表示/非表示を app_settings に保存し、次回の収集日を受け取る。
 */
export function useGarbageSettings() {
  const { request } = useApi();
  const [types, setTypes] = useState<GarbageType[]>([]);
  const [hiddenTypes, setHiddenTypes] = useState<string[]>([]);
  const [next, setNext] = useState<NextGarbageDay | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    const result = await request<GarbageResponse>('/api/garbage', undefined, { silent: true });
    if (result.ok) {
      setTypes(result.data.types);
      setHiddenTypes(result.data.hiddenTypes);
      setNext(result.data.next);
    }
    setLoading(false);
  }, [request]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const toggleType = useCallback(
    async (typeId: string) => {
      const nextHidden = hiddenTypes.includes(typeId)
        ? hiddenTypes.filter((t) => t !== typeId)
        : [...hiddenTypes, typeId];

      // 楽観的更新。失敗したら元に戻す
      const previous = hiddenTypes;
      setHiddenTypes(nextHidden);

      const result = await request<{ hiddenTypes: string[]; next: NextGarbageDay | null }>(
        '/api/garbage',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hiddenTypes: nextHidden }),
        },
        { errorMessage: 'ごみ収集設定の保存に失敗しました' },
      );

      if (result.ok) {
        setHiddenTypes(result.data.hiddenTypes);
        setNext(result.data.next);
      } else {
        setHiddenTypes(previous);
      }
    },
    [hiddenTypes, request],
  );

  return { types, hiddenTypes, next, loading, toggleType };
}
