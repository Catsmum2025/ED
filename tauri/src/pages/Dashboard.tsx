import { Boxes, LineChart, ArrowUpRight, Sparkles } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useT } from '../i18n';

/**
 * Global dashboard — the future hub that ties ED together with the
 * other apps in the suite. Intentionally a placeholder for now.
 */
export function DashboardPage() {
  const t = useT();

  const points = [
    { icon: Boxes, label: t('dashboard.point.interconnect') },
    { icon: LineChart, label: t('dashboard.point.overview') },
    { icon: ArrowUpRight, label: t('dashboard.point.entry') },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title={t('nav.dashboard')} subtitle={t('dashboard.subtitle')} />

      <section className="relative flex min-h-[calc(100vh_-_11rem)] items-center justify-center overflow-hidden rounded-3xl border border-white/70 bg-white/70 px-8 py-14 text-center shadow-card backdrop-blur-xl dark:border-white/5 dark:bg-slate-900/60 md:px-16 md:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-40 dark:opacity-25"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(100, 116, 139, 0.35) 1px, transparent 0)',
            backgroundSize: '20px 20px',
            WebkitMaskImage:
              'radial-gradient(ellipse at center, #000 0%, transparent 72%)',
            maskImage: 'radial-gradient(ellipse at center, #000 0%, transparent 72%)',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-28 left-1/2 h-64 w-[34rem] -translate-x-1/2 rounded-full blur-3xl"
          style={{ background: 'color-mix(in srgb, var(--accent) 22%, transparent)' }}
        />

        <div className="relative">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-white/70 bg-white/85 text-accent shadow-card dark:border-white/10 dark:bg-slate-800/80">
            <Sparkles className="h-7 w-7" strokeWidth={1.8} />
          </div>

          <p className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent-tint px-3 py-1 text-xs font-medium text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {t('dashboard.badge')}
          </p>

          <h2 className="mt-4 font-serif-display text-3xl tracking-tight text-slate-900 dark:text-slate-50 md:text-4xl">
            {t('dashboard.comingSoon')}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            {t('dashboard.desc')}
          </p>

          <ul className="mt-8 flex flex-wrap justify-center gap-2">
            {points.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/50 dark:text-slate-300"
              >
                <Icon className="h-3.5 w-3.5 text-accent" strokeWidth={2} />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
