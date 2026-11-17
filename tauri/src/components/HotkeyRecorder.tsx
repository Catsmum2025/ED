import { useEffect, useRef, useState } from 'react';
import { Check, Keyboard, X } from 'lucide-react';
import { Button } from './Button';
import { useT } from '../i18n';

interface HotkeyRecorderProps {
  label: string;
  description?: string;
  value: string | null;
  onChange: (accelerator: string | null) => void;
}

/** Translate a browser KeyboardEvent into an accelerator string.
 *  Windows-only app, so the modifier is always spelled "Ctrl"
 *  (examples: "Ctrl+Shift+D", "Alt+T"). */
function toAccelerator(e: KeyboardEvent): string | null {
  // Ignore pure modifier presses (just Ctrl / Alt / Shift).
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  // Key must have at least one modifier — Electron rejects bare keys.
  if (parts.length === 0) return null;

  // Normalize the key name.
  let key = e.key;
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();
  // Function keys F1-F24 pass through; arrow keys are capitalized already.
  parts.push(key);
  return parts.join('+');
}

/** Older builds stored "CommandOrControl" (Electron style); show it as Ctrl. */
function displayAccelerator(value: string): string {
  return value.replace(/CommandOrControl/gi, 'Ctrl');
}

/** A button that, when focused/active, listens for the next key combo and
 *  records it as a global-hotkey accelerator. Includes a clear button. */
export function HotkeyRecorder({ label, description, value, onChange }: HotkeyRecorderProps) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(false);
        return;
      }
      const accel = toAccelerator(e);
      if (accel) {
        onChange(accel);
        setRecording(false);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recording, onChange]);

  // Click-outside cancels recording.
  useEffect(() => {
    if (!recording) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setRecording(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [recording]);

  return (
    <div ref={containerRef} className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</div>
        {description && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</div>}
      </div>
      <div className="flex items-center gap-2">
        {value && (
          <button
            onClick={() => onChange(null)}
            className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
            title={t('hotkey.clear')}
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <Button
          variant={recording ? 'primary' : 'secondary'}
          onClick={() => setRecording((r) => !r)}
        >
          {recording ? (
            <>
              <Check className="w-4 h-4 mr-1.5" />
              {t('hotkey.pressing')}
            </>
          ) : value ? (
            <>
              <Keyboard className="w-4 h-4 mr-1.5" />
              <kbd className="font-mono">{displayAccelerator(value)}</kbd>
            </>
          ) : (
            <>
              <Keyboard className="w-4 h-4 mr-1.5" />
              {t('hotkey.record')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
