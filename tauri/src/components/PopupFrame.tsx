import { useEffect, useRef } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { api } from '../ipc';
import { useT } from '../i18n';

interface PopupFrameProps {
  /** Title shown on the left of the custom title bar. */
  title: string;
  /** Route + optional query params to send to the main window when the user
   *  clicks "switch to main". e.g. { route: '/dictionary', query: { word: 'foo' } } */
  onSwitch?: () => { route: string; query?: Record<string, string> };
  /** When false, the switch button is hidden (used before any result). */
  canSwitch?: boolean;
  children: React.ReactNode;
}

/**
 * Frameless popup shell. Renders a custom title bar (draggable region) with
 * two action buttons: close window, and switch to main window. The body is
 * provided by the caller.
 *
 * The popup window auto-resizes to fit its content via a ResizeObserver —
 * there is no internal scrollbar; the whole page is always visible.
 */
export function PopupFrame({ title, onSwitch, canSwitch = true, children }: PopupFrameProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);

  const handleClose = async () => {
    await api.window.hide();
  };
  const handleSwitch = async () => {
    if (!onSwitch) return;
    const { route, query } = onSwitch();
    await api.window.switchToMain(route, query);
  };

  // Resize the BrowserWindow whenever the content height changes so the popup
  // always shows the full page (no internal scrollbar).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = (h: number) => api.window.fitContent(Math.ceil(h));
    // Initial fit once laid out.
    requestAnimationFrame(() => measure(el.scrollHeight));
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Use scrollHeight so overflowing content is included.
        const h = (entry.target as HTMLElement).scrollHeight;
        measure(h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="flex flex-col bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 select-none">
      {/* Drag region / custom title bar — accent-tinted to tie popups to the theme. */}
      <div
        className="flex items-center justify-between px-3 h-9 border-b border-accent/20 bg-accent-tint"
        data-tauri-drag-region
      >
        <span className="text-xs font-medium text-accent truncate">{title}</span>
        <div className="flex items-center gap-1">
          {canSwitch && onSwitch && (
            <button
              onClick={handleSwitch}
              className="p-1 rounded-md text-accent/70 hover:text-accent hover:bg-accent/10 transition-colors"
              title={t('popup.switchToMain')}
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={handleClose}
            className="p-1 rounded-md text-accent/70 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
            title={t('popup.close')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}
