import { useCallback } from 'react';
import { apiFetch, type ApiResult } from '../lib/api.js';
import { useToast } from '../contexts/ToastContext.js';

type RequestOptions = {
  /** Override the toast message shown on failure (defaults to the API error). */
  errorMessage?: string;
  /** When provided, the error toast shows a retry button wired to this callback. */
  onRetry?: () => void;
  /** Suppress the automatic error toast (caller handles notification itself). */
  silent?: boolean;
};

/**
 * Thin wrapper around {@link apiFetch} that surfaces failures as a prominent,
 * non-blocking toast. Returns the {@link ApiResult} so callers can roll back
 * optimistic UI when `ok` is false.
 */
export function useApi() {
  const { showError } = useToast();

  const request = useCallback(
    async <T = unknown>(
      input: RequestInfo | URL,
      init?: RequestInit,
      opts?: RequestOptions,
    ): Promise<ApiResult<T>> => {
      const result = await apiFetch<T>(input, init);
      if (!result.ok && !opts?.silent) {
        showError(opts?.errorMessage ?? result.error, opts?.onRetry);
      }
      return result;
    },
    [showError],
  );

  return { request };
}
