import { useState, useEffect, useCallback } from 'react';
import type { Attachment } from '../types.js';

interface PendingFileDisplay {
  name: string;
  size: number;
  type: string;
  blobUrl: string;
  placeholderIndex: number;
}

interface Props {
  taskId?: number;
  refreshKey?: number;
  pendingFiles?: PendingFileDisplay[];
  pendingDeleteIds?: string[];
  onMarkForDelete?: (id: string) => void;
  onRemovePending?: (placeholderIndex: number) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentsList({ taskId, refreshKey, pendingFiles, pendingDeleteIds, onMarkForDelete, onRemovePending }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const fetchAttachments = useCallback(async () => {
    if (!taskId) return;
    const res = await fetch(`/api/tasks/${taskId}/attachments`);
    if (res.ok) {
      setAttachments(await res.json());
    }
  }, [taskId]);

  useEffect(() => {
    fetchAttachments();
  }, [fetchAttachments, refreshKey]);

  const visibleAttachments = attachments.filter((a) => !pendingDeleteIds?.includes(a.id));
  const hasPendingFiles = pendingFiles && pendingFiles.length > 0;
  const hasAttachments = visibleAttachments.length > 0;

  if (!hasAttachments && !hasPendingFiles) return null;

  return (
    <div className="space-y-1 mt-2" role="region" aria-label="添付ファイル">
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400">添付ファイル</div>
      <div className="space-y-1">
        {visibleAttachments.map((att) => (
          <div key={att.id} className="flex items-center gap-2 text-sm border border-gray-200 dark:border-gray-700 rounded px-2 py-1">
            {att.mime_type.startsWith('image/') ? (
              <a href={`/api/attachments/${att.id}`} target="_blank" rel="noopener noreferrer">
                <img
                  src={`/api/attachments/${att.id}`}
                  alt={att.original_name}
                  className="w-8 h-8 object-cover rounded"
                />
              </a>
            ) : (
              <span className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded text-xs">📄</span>
            )}
            <a
              href={`/api/attachments/${att.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 truncate text-blue-600 dark:text-blue-400 hover:underline"
            >
              {att.original_name}
            </a>
            <span className="text-xs text-gray-400 dark:text-gray-500">{formatFileSize(att.size)}</span>
            <button
              type="button"
              onClick={() => onMarkForDelete?.(att.id)}
              className="text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400 text-xs px-1"
              title="削除"

            >
              ✕
            </button>
          </div>
        ))}
        {pendingFiles?.map((pf, i) => (
          <div key={`pending-${i}`} className="flex items-center gap-2 text-sm border border-gray-200 dark:border-gray-700 border-dashed rounded px-2 py-1 opacity-70">
            {pf.type.startsWith('image/') ? (
              <img src={pf.blobUrl} alt={pf.name} className="w-8 h-8 object-cover rounded" />
            ) : (
              <span className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded text-xs">📄</span>
            )}
            <span className="flex-1 truncate text-gray-900 dark:text-gray-100">{pf.name}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">{formatFileSize(pf.size)}</span>
            <span className="text-xs text-blue-500 dark:text-blue-400">保存時にアップロード</span>
            <button
              type="button"
              onClick={() => onRemovePending?.(pf.placeholderIndex)}
              className="text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400 text-xs px-1"
              title="削除"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
