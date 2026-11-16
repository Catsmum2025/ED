import { useEffect } from 'react';
import { Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { useExtractionStore } from '../store/extraction';
import { useT } from '../i18n';

/** Modal dialog that shows dictionary extraction progress. Mount once at the
 *  app root. The user can dismiss it to let the task run in the background;
 *  a small "view progress" button is shown in the Dictionary settings page
 *  while the task is still running.
 *
 *  Also exposes {@link useExtractionBlocked} for other components to check
 *  whether dictionary-related features should be disabled. */
export function ExtractionOverlay() {
  const t = useT();
  const state = useExtractionStore((s) => s.state);
  const progress = useExtractionStore((s) => s.progress);
  const error = useExtractionStore((s) => s.error);
  const entryCount = useExtractionStore((s) => s.entryCount);
  const modalDismissed = useExtractionStore((s) => s.modalDismissed);
  const dismissModal = useExtractionStore((s) => s.dismissModal);
  const reset = useExtractionStore((s) => s.reset);

  // Auto-dismiss the success modal after 3.5s.
  useEffect(() => {
    if (state !== 'done' || modalDismissed) return;
    const timer = setTimeout(() => { reset(); }, 3500);
    return () => clearTimeout(timer);
  }, [state, modalDismissed, reset]);

  if (state === 'idle' || modalDismissed) return null;

  const visible = state === 'running' || state === 'done' || state === 'error';
  if (!visible) return null;

  const phaseLabel = progress ? t(`extraction.phase.${progress.phase}`) : '';
  const percent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.count / progress.total) * 100))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div className="w-[420px] max-w-[92vw] rounded-2xl bg-white dark:bg-slate-900 shadow-hover border border-slate-200/60 dark:border-slate-800 p-5">
        <div className="flex items-start gap-3">
          {state === 'running' && (
            <Loader2 className="w-5 h-5 text-accent animate-spin shrink-0 mt-0.5" />
          )}
          {state === 'done' && (
            <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
          )}
          {state === 'error' && (
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {state === 'running' && t('extraction.title')}
              {state === 'done' && t('extraction.done')}
              {state === 'error' && t('extraction.error')}
            </h3>
            {state === 'running' && progress && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {phaseLabel} · {progress.count} / {progress.total}
              </p>
            )}
            {state === 'done' && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t('extraction.doneDesc', { count: entryCount })}
              </p>
            )}
            {state === 'error' && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 break-words">
                {error}
              </p>
            )}
          </div>
          {state === 'error' && (
            <button
              onClick={reset}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title={t('extraction.close')}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {state === 'running' && (
          <div className="mt-4">
            <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-200 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-slate-400">{percent}%</span>
              <button
                onClick={dismissModal}
                className="text-xs font-medium text-slate-500 hover:text-accent dark:text-slate-400 dark:hover:text-accent transition-colors"
              >
                {t('extraction.background')}
              </button>
            </div>
          </div>
        )}

        {state === 'done' && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={reset}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-accent-contrast hover:bg-accent-hover transition-colors"
            >
              {t('extraction.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Hook for other components to check if dictionary features should be
 *  disabled (while extraction is running). */
export function useExtractionBlocked(): boolean {
  return useExtractionStore((s) => s.state === 'running');
}
