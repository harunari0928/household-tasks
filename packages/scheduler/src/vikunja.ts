const VIKUNJA_URL = process.env.VIKUNJA_URL || 'http://localhost:3456/api/v1';
const VIKUNJA_TOKEN = process.env.VIKUNJA_API_TOKEN || '';

async function vikunjaFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${VIKUNJA_URL}${path}`, {
    ...options,
    signal: AbortSignal.timeout(10000),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${VIKUNJA_TOKEN}`,
      ...options.headers,
    },
  });
}

export async function createTask(
  projectId: number,
  title: string,
  description?: string,
): Promise<number> {
  const body: Record<string, string> = { title };
  if (description) body.description = description;

  const res = await vikunjaFetch(`/projects/${projectId}/tasks`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vikunja API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.id;
}

export async function hasUncompletedTask(
  projectId: number,
  title: string,
): Promise<boolean> {
  const res = await vikunjaFetch(`/projects/${projectId}/tasks?filter=title%3D${encodeURIComponent(title)}&filter_include_nulls=false`);

  if (!res.ok) {
    // If can't check, assume no duplicate to avoid blocking
    return false;
  }

  const tasks = await res.json();
  if (!Array.isArray(tasks)) return false;

  return tasks.some((t: any) => t.title === title && !t.done);
}
