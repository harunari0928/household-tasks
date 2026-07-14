import { useState, useEffect, useCallback } from 'react';
import { useApi } from './useApi.js';

/**
 * 子ども風邪の日モードの状態管理。
 * サーバー（app_settings）に保存された共有フラグを取得し、
 * SSE経由で他の端末からの変更もリアルタイムに反映する。
 */
export function useSickMode() {
  const { request } = useApi();
  const [sickMode, setSickMode] = useState(false);

  const fetchMode = useCallback(async () => {
    const result = await request<{ enabled: boolean }>('/api/sick-mode', undefined, { silent: true });
    if (result.ok) setSickMode(result.data.enabled);
  }, [request]);

  useEffect(() => {
    fetchMode();
  }, [fetchMode]);

  useEffect(() => {
    const eventSource = new EventSource('/api/kanban/events');
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'sick_mode_changed') setSickMode(data.enabled === true);
      } catch {
        // ignore malformed events
      }
    };
    return () => eventSource.close();
  }, []);

  const toggleSickMode = useCallback(async () => {
    const next = !sickMode;
    const result = await request<{ enabled: boolean }>(
      '/api/sick-mode',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      },
      {
        errorMessage: '風邪の日モードの切り替えに失敗しました',
        onRetry: () => toggleSickMode(),
      },
    );
    if (result.ok) setSickMode(result.data.enabled);
  }, [sickMode, request]);

  return { sickMode, toggleSickMode };
}
