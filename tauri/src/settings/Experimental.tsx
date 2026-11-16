import { Beaker, Sparkles } from 'lucide-react';
import { useT } from '../i18n';
import { useSettingsStore } from '../store/settings';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/Card';
import { Toggle } from '../components/Toggle';

export function ExperimentalSettings() {
  const t = useT();
  const { experimental, update } = useSettingsStore();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Beaker className="w-4 h-4 text-accent" />
          {t('settings.experimental.title')}
        </CardTitle>
        <CardDescription>{t('settings.experimental.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-slate-100 dark:divide-slate-800/60">
        <div className="flex items-start justify-between gap-4 py-4">
          <div className="flex gap-3">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-accent-tint text-accent shrink-0">
              <Sparkles className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('settings.experimental.aiWordGen')}</div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-md leading-relaxed">
                {t('settings.experimental.aiWordGenDesc')}
              </p>
            </div>
          </div>
          <Toggle
            checked={experimental.aiWordGeneration}
            onChange={(e) => update({ experimental: { ...experimental, aiWordGeneration: e.target.checked } })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
