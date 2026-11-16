import { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ label, className, ...props }, ref) => {
  return (
    <div className={className}>
      {label && <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">{label}</label>}
      <input
        ref={ref}
        className="w-full rounded-xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-700/80 dark:text-slate-100 px-3.5 py-2.5 text-sm focus:outline-none focus:border-accent focus:ring-4 ring-accent/15 transition-all hover:border-slate-300 dark:hover:border-slate-600 placeholder:text-slate-400"
        {...props}
      />
    </div>
  );
});
Input.displayName = 'Input';
