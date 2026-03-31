import { useState, useCallback } from 'react';

export function useAssignees() {
  const [assignees, setAssignees] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchAssignees = useCallback(async () => {
    const res = await fetch('/api/kanban/assignees');
    if (res.ok) {
      const data = await res.json();
      setAssignees(data);
      setLoaded(true);
      return data as string[];
    }
    setLoaded(true);
    return [] as string[];
  }, []);

  const addAssignee = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || assignees.includes(trimmed)) return;
    const updated = [...assignees, trimmed];
    setAssignees(updated);
    await fetch('/api/kanban/assignees', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignees: updated }),
    });
  };

  const removeAssignee = async (name: string) => {
    const updated = assignees.filter((a) => a !== name);
    setAssignees(updated);
    await fetch('/api/kanban/assignees', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignees: updated }),
    });
  };

  return { assignees, setAssignees, loaded, fetchAssignees, addAssignee, removeAssignee };
}
