import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  options: SelectOption[];
  value: string;
  /** Kept compatible with the previous native-select call sites. */
  onChange: (event: { target: { value: string } }) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
}

/**
 * Accessible custom select. Native <select> elements render sharp, OS-themed
 * popups that clash with the app; this one opens a rounded, filled listbox
 * that slides down, follows the design tokens and works from the keyboard.
 */
export function Select({
  label,
  options,
  value,
  onChange,
  className,
  disabled = false,
  id,
  placeholder,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // The menu prefers to expand downward; near the bottom edge it flips upward
  // and its height is capped to the available space so it is never clipped.
  const [placement, setPlacement] = useState<'down' | 'up'>('down');
  const [menuMaxHeight, setMenuMaxHeight] = useState(256);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const triggerId = id ?? `${listId}-trigger`;

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const display = selected?.label ?? (value || placeholder || '—');

  const close = useCallback((refocus = false) => {
    setOpen(false);
    setActiveIndex(-1);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom - 24;
      const spaceAbove = rect.top - 24;
      const fitsBelow = spaceBelow >= Math.min(200, Math.max(120, options.length * 36));
      const useUp = !fitsBelow && spaceAbove > spaceBelow;
      setPlacement(useUp ? 'up' : 'down');
      setMenuMaxHeight(Math.max(120, Math.min(256, useUp ? spaceAbove : spaceBelow)));
    }
    setOpen(true);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [disabled, options.length, selectedIndex]);

  const choose = useCallback(
    (option: SelectOption) => {
      onChange({ target: { value: option.value } });
      close(true);
    },
    [close, onChange],
  );

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, close]);

  // Keep the highlighted row visible inside the menu only — scrolling the
  // page here would move the trigger and break the open dropdown.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const list = listRef.current;
    const node = list?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (!list || !node) return;
    const listRect = list.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    if (nodeRect.bottom > listRect.bottom) {
      list.scrollTop += nodeRect.bottom - listRect.bottom;
    } else if (nodeRect.top < listRect.top) {
      list.scrollTop -= listRect.top - nodeRect.top;
    }
  }, [open, activeIndex]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        openMenu();
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (options[activeIndex]) choose(options[activeIndex]);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        close();
        break;
      default:
        break;
    }
  };

  return (
    <div className={className} ref={rootRef}>
      {label && (
        <label
          htmlFor={triggerId}
          className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          {label}
        </label>
      )}

      <div className="relative">
        <button
          ref={triggerRef}
          id={triggerId}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={
            open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
          }
          aria-label={label}
          disabled={disabled}
          onClick={() => (open ? close() : openMenu())}
          onKeyDown={handleKeyDown}
          className={cn(
            'group flex w-full items-center justify-between gap-2 rounded-xl border bg-white px-3.5 py-2.5 text-left text-sm text-slate-900 outline-none transition-colors duration-200 dark:bg-slate-900 dark:text-slate-100',
            'border-slate-200/80 dark:border-slate-700/80',
            'hover:border-slate-300 dark:hover:border-slate-600',
            'focus-visible:border-accent focus-visible:ring-4 ring-accent/15',
            open && 'border-accent ring-4 ring-accent/15',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <span className={cn('truncate', !selected && 'text-slate-400 dark:text-slate-500')}>
            {display}
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200',
              open && 'rotate-180 text-accent',
            )}
          />
        </button>

        {open && (
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            style={{ maxHeight: menuMaxHeight }}
            className={cn(
              'absolute left-0 right-0 z-50 overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-1.5 shadow-hover scrollbar-hide dark:border-slate-700/80 dark:bg-slate-900',
              placement === 'down' ? 'top-full mt-2 animate-dropdown-in' : 'bottom-full mb-2 animate-dropdown-up',
            )}
          >
            {options.length === 0 && (
              <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">—</p>
            )}
            {options.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <button
                  key={option.value}
                  type="button"
                  id={`${listId}-option-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors duration-150',
                    isActive || isSelected
                      ? 'bg-accent-tint text-accent'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {isSelected && <Check className="h-4 w-4 shrink-0 text-accent" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
