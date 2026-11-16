import { useEffect, useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { api } from '../ipc';
import { Button } from '../components/Button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/Card';
import { StatsOverviewCards } from '../components/StatCard';
import { Heatmap } from '../components/Heatmap';
import { PageHeader } from '../components/PageHeader';
import { t } from '../i18n';
import type { HeatmapData, StatsOverview, TopWord } from '../types';

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t('stats.justNow');
  if (minutes < 60) return t('stats.minutesAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('stats.hoursAgo', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('stats.daysAgo', { n: days });
  return new Date(ts).toLocaleDateString('zh-CN');
}

export function StatsPage() {
  const [overview, setOverview] = useState<StatsOverview>({ learned: 0, totalQueries: 0, topWord: '-' });
  const [heatmap, setHeatmap] = useState<HeatmapData[]>([]);
  const [topWords, setTopWords] = useState<TopWord[]>([]);

  const load = async () => {
    const [ov, hm, tw] = await Promise.all([
      api.stats.overview(),
      api.stats.heatmap('daily'),
      api.stats.topWords(50),
    ]);
    setOverview(ov);
    setHeatmap(hm);
    setTopWords(tw);
  };

  useEffect(() => {
    load();
  }, []);

  const handleExport = async (type: 'learned' | 'queries') => {
    await api.stats.export(type);
  };

  const handleDelete = async (word: string) => {
    await api.stats.deleteWord(word);
    await load();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title={t('stats.title')} subtitle={t('stats.subtitle')} />

      <StatsOverviewCards overview={overview} />

      <Card>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={() => handleExport('learned')} variant="primary">
            <Download className="w-4 h-4 mr-2" />
            {t('stats.exportLearned')}
          </Button>
          <Button onClick={() => handleExport('queries')} variant="secondary">
            <Download className="w-4 h-4 mr-2" />
            {t('stats.exportQueries')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('stats.heatmap')}</CardTitle>
          <CardDescription>{t('stats.heatmapDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Heatmap data={heatmap} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('stats.topWords')}</CardTitle>
          <CardDescription>{t('stats.topWordsDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {topWords.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 py-6 text-center">{t('stats.noRecords')}</p>
          ) : (
            <div className="overflow-x-auto scrollbar-hide -mx-1 px-1">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400 w-12">#</th>
                    <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('stats.word')}</th>
                    <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400 w-40">{t('stats.queryCount')}</th>
                    <th className="text-left py-2.5 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400 w-36">{t('stats.lastQuery')}</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {topWords.map((w, i) => {
                    const maxCount = topWords[0]?.queryCount || 1;
                    return (
                      <tr
                        key={w.word}
                        style={{ ['--i' as string]: Math.min(i, 12) }}
                        className="animate-list-item border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-accent-tint/50 transition-colors group"
                      >
                        <td className="py-3 px-3">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-accent-tint text-accent text-xs font-semibold">
                            {i + 1}
                          </span>
                        </td>
                        <td className="py-3 px-3 list-row-primary font-medium text-slate-900 dark:text-slate-100">{w.word}</td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-600 dark:text-slate-300 tabular-nums w-6 shrink-0">{w.queryCount}</span>
                            <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div
                                className="h-full bg-accent rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                                style={{ width: `${(w.queryCount / maxCount) * 100}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">{formatTimeAgo(w.lastQueriedAt)}</td>
                        <td className="py-3 px-3 text-right">
                          <button
                            onClick={() => handleDelete(w.word)}
                            className="p-1.5 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 dark:text-slate-600 dark:hover:bg-red-950/30 transition-colors"
                            title={t('stats.deleteRecord')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}