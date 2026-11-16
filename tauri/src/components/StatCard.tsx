import { BookOpen, Hash, Clock } from 'lucide-react';
import { Card, CardContent } from './Card';
import type { StatsOverview } from '../types';
import { useT } from '../i18n';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  description: string;
}

function StatCard({ icon, label, value, description }: StatCardProps) {
  const t = useT();
  return (
    <Card className="card-lift hover:shadow-hover">
      <CardContent>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
            <p className="mt-1.5 text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">{value}</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{description}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-accent-tint text-accent">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function StatsOverviewCards({ overview }: { overview: StatsOverview }) {
  const t = useT();
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <StatCard
        icon={<BookOpen className="w-5 h-5" />}
        label={t('stat.learnedWords')}
        value={overview.learned}
        description={t('stat.learnedDesc', { count: overview.learned })}
      />
      <StatCard
        icon={<Hash className="w-5 h-5" />}
        label={t('stat.totalQueries')}
        value={overview.totalQueries}
        description={t('stat.totalQueriesDesc', { count: overview.totalQueries })}
      />
      <StatCard
        icon={<Clock className="w-5 h-5" />}
        label={t('stat.topWord')}
        value={overview.topWord}
        description={t('stat.topWordDesc')}
      />
    </div>
  );
}
