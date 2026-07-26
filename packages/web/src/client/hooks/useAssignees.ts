import { useState, useCallback } from 'react';
import { useApi } from './useApi.js';

export function useAssignees() {
  const { request } = useApi();
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
        {
          errorMessage: '担当者の保存に失敗しました',
          onRetry: () => applyAssignees(updated, snapshot),
        },
      );
      if (!result.ok) setAssignees(snapshot);
    },
    [request],
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
