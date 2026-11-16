export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2.5">
        <span className="w-1 h-7 rounded-full bg-accent" />
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
      </div>
      {subtitle && <p className="mt-1.5 ml-3.5 text-slate-500 dark:text-slate-400">{subtitle}</p>}
    </div>
  );
}
