import { ChevronDown } from 'lucide-react';
import { forwardRef } from 'react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: Array<{ value: string; label: string }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ label, options, className, ...props }, ref) => {
  return (
    <div className={className}>
      {label && <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">{label}</label>}
      <div className="relative">
        <select
          ref={ref}
          className="w-full appearance-none rounded-xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-700/80 dark:text-slate-100 px-3.5 py-2.5 pr-10 text-sm focus:outline-none focus:border-accent focus:ring-4 ring-accent/15 transition-all hover:border-slate-300 dark:hover:border-slate-600"
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      </div>
    </div>
  );
});
Select.displayName = 'Select';
