import { useState, useCallback } from 'react';
import { useApi } from './useApi.js';
import { useToast } from '../contexts/ToastContext.js';

export function useAssignees() {
  const { request } = useApi();
  const { showError } = useToast();
  const [assignees, setAssignees] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchAssignees = useCallback(async () => {
    const result = await request<string[]>('/api/kanban/assignees', undefined, {
      errorMessage: '担当者の取得に失敗しました',
    });
    setLoaded(true);
    if (!result.ok) return [] as string[];
    setAssignees(result.data);
    return result.data;
  }, [request]);

  // Optimistically apply the new list, persist it, and roll back on failure.
  const applyAssignees = useCallback(
    async (updated: string[], snapshot: string[]) => {
      setAssignees(updated);
      const result = await request(
        '/api/kanban/assignees',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignees: updated }),
        },
        { silent: true },
      );
      if (result.ok) return;
      setAssignees(snapshot);
      // サーバが拒否した理由（個人タスクの所有者は消せない等）はそのまま見せる。
      // 再試行しても結果は変わらないので、再試行ボタンは通信断のときだけ付ける。
      if (result.status) {
        showError(result.error);
      } else {
        showError('担当者の保存に失敗しました', () => applyAssignees(updated, snapshot));
      }
    },
    [request, showError],
  );

  const addAssignee = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || assignees.includes(trimmed)) return;
      await applyAssignees([...assignees, trimmed], assignees);
    },
    [assignees, applyAssignees],
  );

  const removeAssignee = useCallback(
    async (name: string) => {
      await applyAssignees(
        assignees.filter((a) => a !== name),
        assignees,
      );
    },
    [assignees, applyAssignees],
  );

  return { assignees, setAssignees, loaded, fetchAssignees, addAssignee, removeAssignee };
}
