import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useT } from '../i18n';

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Themed replacement for window.confirm(): native browser dialogs look like
 *  OS chrome and block rendering, so the progress overlay used to appear only
 *  after the (modal) prompt was dismissed. A React dialog keeps ordering
 *  explicit and matches the app's design system. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useT();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => confirmRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', onKey); };
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/35 animate-fade-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-[400px] max-w-[92vw] rounded-2xl bg-white dark:bg-slate-900 shadow-hover border border-slate-200/60 dark:border-slate-800 p-5 animate-pop-in"
      >
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              danger
                ? 'bg-red-50 text-red-500 dark:bg-red-950/40'
                : 'bg-accent-tint text-accent'
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
            {body && (
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {body}
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium text-accent-contrast transition-colors ${
              danger ? 'bg-red-500 hover:bg-red-600' : 'bg-accent hover:bg-accent-hover'
            }`}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
