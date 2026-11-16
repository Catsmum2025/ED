import { forwardRef } from 'react';

interface ToggleProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(({ label, className, ...props }, ref) => {
  return (
    <label className={`inline-flex items-center gap-3 cursor-pointer ${className || ''}`}>
      <div className="relative">
        <input type="checkbox" className="sr-only peer" ref={ref} {...props} />
        {/* Track: fills with accent color when on. Transition uses cubic-bezier
            for a snappier feel that still reads as smooth on low-end devices. */}
        <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-checked:bg-accent peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-offset-2 rounded-full ring-accent transition-colors duration-200" />
        {/* Thumb: slides + subtle scale on toggle. Shadow gives depth. */}
        <div className="absolute left-[2px] top-[2px] bg-white w-5 h-5 rounded-full shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] peer-checked:translate-x-full peer-active:scale-90" />
      </div>
      {label && <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>}
    </label>
  );
});
Toggle.displayName = 'Toggle';
