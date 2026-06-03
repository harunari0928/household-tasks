import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type ToastType = 'error' | 'info';

type Toast = {
  id: number;
  type: ToastType;
  message: string;
  onRetry?: () => void;
};

type ToastContextValue = {
  /** Show a prominent error toast. Pass `onRetry` to render a retry button. */
  showError: (message: string, onRetry?: () => void) => void;
  /** Show a low-key informational toast. */
  showInfo: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 6000;
const AUTO_DISMISS_WITH_RETRY_MS = 10000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (type: ToastType, message: string, onRetry?: () => void) => {
      const id = idRef.current++;
      setToasts((prev) => [...prev, { id, type, message, onRetry }]);
      const ttl = onRetry ? AUTO_DISMISS_WITH_RETRY_MS : AUTO_DISMISS_MS;
      const timer = setTimeout(() => dismiss(id), ttl);
      timersRef.current.set(id, timer);
      return id;
    },
    [dismiss],
  );

  const showError = useCallback(
    (message: string, onRetry?: () => void) => push('error', message, onRetry),
    [push],
  );
  const showInfo = useCallback((message: string) => push('info', message), [push]);

  const handleRetry = useCallback(
    (toast: Toast) => {
      dismiss(toast.id);
      toast.onRetry?.();
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ showError, showInfo }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} onRetry={handleRetry} />
    </ToastContext.Provider>
  );
}

function ToastContainer({
  toasts,
  onDismiss,
  onRetry,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  onRetry: (toast: Toast) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-md pointer-events-none"
      aria-live="assertive"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          className={`pointer-events-auto flex items-start gap-3 p-3 rounded-lg text-sm border shadow-lg ${
            toast.type === 'error'
              ? 'bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
              : 'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
          }`}
        >
          <span className="flex-1 break-words">{toast.message}</span>
          {toast.onRetry && (
            <button
              onClick={() => onRetry(toast)}
              className="shrink-0 font-medium underline underline-offset-2 hover:no-underline"
            >
              再試行
            </button>
          )}
          <button
            onClick={() => onDismiss(toast.id)}
            aria-label="閉じる"
            className="shrink-0 text-base leading-none opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
