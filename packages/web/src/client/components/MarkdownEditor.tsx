import { useState, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface PendingFile {
  file: File;
  placeholderIndex: number;
  blobUrl: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  taskId?: number;
  pendingFiles?: PendingFile[];
  onFileQueued?: (file: PendingFile) => void;
  onFileUploaded?: () => void;
}

async function uploadFile(taskId: number, file: File): Promise<{ id: string; original_name: string } | null> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`/api/tasks/${taskId}/attachments`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) return null;
  return res.json();
}

let placeholderCounter = 0;

export default function MarkdownEditor({ value, onChange, taskId, pendingFiles, onFileQueued, onFileUploaded }: Props) {
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertAtCursor = useCallback(
    (text: string) => {
      const ta = textareaRef.current;
      if (!ta) {
        onChange(value + text);
        return;
      }
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newValue = value.substring(0, start) + text + value.substring(end);
      onChange(newValue);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + text.length;
        ta.focus();
      });
    },
    [value, onChange],
  );

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (taskId) {
        // Existing task: upload immediately
        setUploading(true);
        try {
          const attachment = await uploadFile(taskId, file);
          if (!attachment) return;
          if (file.type.startsWith('image/')) {
            insertAtCursor(`![${attachment.original_name}](/api/attachments/${attachment.id})\n`);
          } else {
            insertAtCursor(`[${attachment.original_name}](/api/attachments/${attachment.id})\n`);
          }
          onFileUploaded?.();
        } finally {
          setUploading(false);
        }
      } else {
        // New task: queue file locally
        const idx = placeholderCounter++;
        const blobUrl = URL.createObjectURL(file);
        const pending: PendingFile = { file, placeholderIndex: idx, blobUrl };
        if (file.type.startsWith('image/')) {
          insertAtCursor(`![${file.name}](pending:${idx})\n`);
        } else {
          insertAtCursor(`[${file.name}](pending:${idx})\n`);
        }
        onFileQueued?.(pending);
      }
    },
    [taskId, insertAtCursor, onFileQueued, onFileUploaded],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files);
      if (files.length === 0) return;
      e.preventDefault();
      for (const file of files) {
        handleFileUpload(file);
      }
    },
    [handleFileUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        handleFileUpload(file);
      }
    },
    [handleFileUpload],
  );

  const wrapSelection = useCallback(
    (before: string, after: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = value.substring(start, end);
      const newText = before + (selected || 'テキスト') + after;
      const newValue = value.substring(0, start) + newText + value.substring(end);
      onChange(newValue);
      requestAnimationFrame(() => {
        if (selected) {
          ta.selectionStart = start;
          ta.selectionEnd = start + newText.length;
        } else {
          ta.selectionStart = start + before.length;
          ta.selectionEnd = start + before.length + 'テキスト'.length;
        }
        ta.focus();
      });
    },
    [value, onChange],
  );

  const toolbarButtons = [
    { label: 'B', title: '太字', action: () => wrapSelection('**', '**') },
    { label: 'I', title: 'イタリック', action: () => wrapSelection('*', '*') },
    { label: '~', title: '取り消し線', action: () => wrapSelection('~~', '~~') },
    {
      label: 'Link',
      title: 'リンク',
      action: () => {
        const ta = textareaRef.current;
        if (!ta) return;
        const selected = value.substring(ta.selectionStart, ta.selectionEnd);
        insertAtCursor(`[${selected || 'リンク'}](url)`);
      },
    },
    {
      label: '•',
      title: 'リスト',
      action: () => insertAtCursor('\n- '),
    },
  ];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {toolbarButtons.map((btn) => (
            <button
              key={btn.title}
              type="button"
              title={btn.title}
              onClick={btn.action}
              className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 min-w-[28px] text-gray-700 dark:text-gray-300"
            >
              {btn.label}
            </button>
          ))}
          <label className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer inline-flex items-center text-gray-700 dark:text-gray-300" title="ファイル添付">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            <input
              type="file"
              className="hidden"
              aria-label="ファイル添付"

              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <div className="flex text-xs">
          <button
            type="button"
            onClick={() => setPreview(false)}
            className={`px-2 py-1 rounded-l border ${!preview ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
          >
            編集
          </button>
          <button
            type="button"
            onClick={() => setPreview(true)}
            className={`px-2 py-1 rounded-r border-t border-r border-b ${preview ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
          >
            プレビュー
          </button>
        </div>
      </div>

      {uploading && (
        <div className="text-xs text-blue-600 dark:text-blue-400">アップロード中...</div>
      )}

      {preview ? (
        <div
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 min-h-[100px] prose prose-sm dark:prose-invert max-w-none bg-gray-50 dark:bg-gray-700"
          role="region"
          aria-label="プレビュー"

        >
          {value ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              urlTransform={(url) => url}
            >
              {pendingFiles?.length
                ? pendingFiles.reduce(
                    (text, pf) => text.replaceAll(`pending:${pf.placeholderIndex}`, pf.blobUrl),
                    value,
                  )
                : value}
            </ReactMarkdown>
          ) : (
            <span className="text-gray-400 dark:text-gray-500">プレビュー</span>
          )}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          rows={4}
          placeholder="マークダウンで記述できます"
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base min-h-[100px] resize-y bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
          aria-label="備考"

        />
      )}
    </div>
  );
}
