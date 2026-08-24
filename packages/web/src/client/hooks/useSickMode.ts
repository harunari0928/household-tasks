import { useState, useEffect, useCallback } from 'react';
import { useApi } from './useApi.js';
import { useRealtimeEvent } from './useRealtime.js';

/**
 * 子ども風邪の日モードの状態管理。
 * サーバー（app_settings）に保存された共有フラグを取得し、
 * WebSocket経由で他の端末からの変更もリアルタイムに反映する。
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

  useRealtimeEvent((event) => {
    if (event.type === 'sick_mode_changed') setSickMode(event.enabled === true);
    // 切断中の変更を取りこぼしているので取り直す
    if (event.type === 'reconnected') fetchMode();
  });

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
