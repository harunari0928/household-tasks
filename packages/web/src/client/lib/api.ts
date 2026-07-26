/**
 * Centralized fetch wrapper. Never throws — network failures and non-OK
 * responses are normalized into a discriminated result so every caller can
 * handle errors consistently (notify the user, roll back optimistic UI, etc.).
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status?: number; error: string };

const NETWORK_ERROR_MESSAGE = 'ネットワークに接続できませんでした';
const GENERIC_ERROR_MESSAGE = '通信に失敗しました';

export async function apiFetch<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    return { ok: false, error: NETWORK_ERROR_MESSAGE };
  }

  if (!res.ok) {
    let error = GENERIC_ERROR_MESSAGE;
    try {
      const body = await res.json();
      if (body && typeof body.error === 'string') error = body.error;
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    return { ok: false, status: res.status, error };
  }

  if (res.status === 204) {
    return { ok: true, data: undefined as T };
  }

  try {
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch {
    // Successful response without a JSON body.
    return { ok: true, data: undefined as T };
  }
}
