import { useT } from '../i18n';
import { api } from '../ipc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/Card';

const UPSTREAM_URL = 'https://github.com/ahpxex/open-dictionary';

export function AboutSettings() {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.about.title')}</CardTitle>
        <CardDescription>{t('settings.about.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
        <p>{`${t('settings.about.version')}: 0.1.0`}</p>
        <p>{t('settings.about.offline')}</p>
        <p>{t('settings.about.translateNote')}</p>

        <div className="pt-3 space-y-2">
          <p className="font-medium text-slate-800 dark:text-slate-200">{t('settings.about.dataTitle')}</p>
          <p>{t('settings.about.dataSource')}</p>
          <p>{t('settings.about.dataLicense')}</p>
          <button
            type="button"
            className="underline decoration-dotted underline-offset-4 text-primary hover:opacity-80"
            onClick={() => { void api.settings.openUrl(UPSTREAM_URL); }}
          >
            {t('settings.about.upstream')}
          </button>
        </div>

        <div className="pt-3 space-y-1">
          <p className="font-medium text-slate-800 dark:text-slate-200">{t('settings.about.ackTitle')}</p>
          <p>{t('settings.about.ackBody')}</p>
        </div>
      </CardContent>
    </Card>
  );
}
