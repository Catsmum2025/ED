import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { forwardRef } from 'react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-xl font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ring-accent disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]',
          variant === 'primary' && 'bg-accent text-accent-contrast shadow-soft hover:shadow-card hover:brightness-110',
          variant === 'secondary' && 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800',
          variant === 'ghost' && 'bg-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
          size === 'sm' && 'h-8 px-3 text-sm',
          size === 'md' && 'h-10 px-4',
          size === 'lg' && 'h-12 px-6 text-lg',
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
