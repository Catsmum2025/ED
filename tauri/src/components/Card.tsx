import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type CardProps = {
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
};

export function Card({ className, style, children }: CardProps) {
  return (
    <div style={style} className={cn('rounded-2xl border border-slate-200/70 bg-white dark:bg-slate-900 dark:border-slate-800/70 shadow-card transition-shadow duration-200', className)}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('px-6 py-4 border-b border-slate-100 dark:border-slate-800', className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h3 className={cn('text-base font-semibold text-slate-900 dark:text-slate-100 tracking-tight', className)}>{children}</h3>;
}

export function CardDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn('text-sm text-slate-500 dark:text-slate-400 mt-1', className)}>{children}</p>;
}

export function CardContent({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('p-6', className)}>{children}</div>;
}
