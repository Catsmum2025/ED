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
        className="w-full rounded-xl border border-accent/25 bg-accent/10 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 hover:border-accent/40 focus:border-accent focus:ring-4 ring-accent/15 dark:border-accent/30 dark:bg-accent/20 dark:text-slate-100"
        {...props}
      />
    </div>
  );
});
Input.displayName = 'Input';
