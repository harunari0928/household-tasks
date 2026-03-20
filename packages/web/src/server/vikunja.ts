const VIKUNJA_URL = process.env.VIKUNJA_URL || 'http://localhost:3456/api/v1';
const VIKUNJA_TOKEN = process.env.VIKUNJA_API_TOKEN || '';

export interface VikunjaAssignee {
  id: number;
  username: string;
}

export interface VikunjaTask {
  id: number;
  title: string;
  done: boolean;
  done_at: string | null;
  assignees: VikunjaAssignee[] | null;
}

async function vikunjaFetch(path: string): Promise<Response> {
  return fetch(`${VIKUNJA_URL}${path}`, {
    signal: AbortSignal.timeout(10000),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${VIKUNJA_TOKEN}`,
    },
  });
}

export async function fetchProjectTasks(projectId: number): Promise<VikunjaTask[]> {
  const allTasks: VikunjaTask[] = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const res = await vikunjaFetch(`/projects/${projectId}/tasks?page=${page}&per_page=${perPage}`);
    if (!res.ok) {
      throw new Error(`Vikunja API error ${res.status}: ${await res.text()}`);
    }
    const tasks: VikunjaTask[] = await res.json();
    if (!Array.isArray(tasks) || tasks.length === 0) break;
    allTasks.push(...tasks);
    if (tasks.length < perPage) break;
    page++;
  }

  return allTasks;
}
