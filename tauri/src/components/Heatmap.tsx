import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useT } from '../i18n';
import { useSettingsStore } from '../store/settings';

interface HeatmapProps {
  data: { date: string; count: number }[];
}

/** Parse a YYYY-MM-DD key as a local date (avoids UTC off-by-one). */
function parseLocal(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function dateKey(y: number, m: number, day: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const DEFAULT_MONTHS = 4;

export function Heatmap({ data }: HeatmapProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  const { rows, total, hasMore } = useMemo(() => {
    const countMap = new Map<string, number>();
    let earliest: Date | null = null;
    let total = 0;
    for (const d of data) {
      countMap.set(d.date, d.count);
      total += d.count;
      const dt = parseLocal(d.date);
      if (!earliest || dt < earliest) earliest = dt;
    }

    const today = new Date();
    const curYear = today.getFullYear();
    const curMonth = today.getMonth();
    const todayDate = today.getDate();

    // Start month: earliest record month (or current month if no data).
    const start = earliest ? new Date(earliest.getFullYear(), earliest.getMonth(), 1) : new Date(curYear, curMonth, 1);

    const rows: { year: number; month: number; label: string; cells: { day: number; count: number; key: string }[]; isCurrent: boolean }[] = [];

    let y = start.getFullYear();
    let m = start.getMonth();
    while (y < curYear || (y === curYear && m <= curMonth)) {
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const isCurrent = y === curYear && m === curMonth;
      const lastDay = isCurrent ? todayDate : daysInMonth;
      const cells: { day: number; count: number; key: string }[] = [];
      for (let day = 1; day <= lastDay; day++) {
        const key = dateKey(y, m, day);
        cells.push({ day, count: countMap.get(key) || 0, key });
      }
      const lang = useSettingsStore.getState().language;
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const label = lang === 'en'
        ? (y === curYear ? monthNames[m] : `${monthNames[m]} ${y}`)
        : (y === curYear ? `${m + 1}月` : `${y}年${m + 1}月`);
      rows.push({ year: y, month: m, label, cells, isCurrent });
      m++;
      if (m > 11) {
        m = 0;
        y++;
      }
    }

    return { rows, total, hasMore: rows.length > DEFAULT_MONTHS };
  }, [data]);

  const visibleRows = expanded ? rows : rows.slice(-DEFAULT_MONTHS);

  // Fixed 10-word intervals so the categories are visually distinct regardless of the max.
  const levelClass = (count: number) => {
    if (count === 0) return 'hm-cell-empty';
    if (count <= 10) return 'hm-l1';
    if (count <= 20) return 'hm-l2';
    if (count <= 30) return 'hm-l3';
    return 'hm-l4';
  };

  if (rows.length === 0) {
    return <p className="text-sm text-slate-400 dark:text-slate-500 py-6 text-center">{t('heatmap.noRecords')}</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-400 dark:text-slate-500">{t('heatmap.totalQueries', { count: total })} · {t('heatmap.showUntil', { date: new Date().toLocaleDateString(useSettingsStore.getState().language === 'en' ? 'en-US' : 'zh-CN') })}</span>
        {hasMore && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:brightness-110 transition-all"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {expanded ? t('heatmap.collapse') : t('heatmap.expandAll')}
          </button>
        )}
      </div>

      <div className="space-y-2.5 overflow-x-auto scrollbar-hide">
        {visibleRows.map((row) => (
          <div key={`${row.year}-${row.month}`} className="flex items-center gap-3">
            <span className="w-12 shrink-0 text-xs font-medium text-slate-500 dark:text-slate-400 text-right">{row.label}</span>
            <div className="flex gap-[3px]">
              {row.cells.map((c) => (
                <div
                  key={c.key}
                  title={`${c.key}: ${t('heatmap.countLabel', { count: c.count })}`}
                  className={`w-3.5 h-3.5 rounded-sm ${levelClass(c.count)} transition-transform hover:scale-125`}
                />
              ))}
            </div>
            {row.isCurrent && (
              <span className="ml-1 text-[10px] text-accent font-medium">{t('heatmap.thisMonth')}</span>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-400 dark:text-slate-500">
        <span>{t('heatmap.legend')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm hm-cell-empty" />0</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm hm-l1" />1–10</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm hm-l2" />11–20</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm hm-l3" />21–30</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm hm-l4" />30+</span>
      </div>
    </div>
  );
}