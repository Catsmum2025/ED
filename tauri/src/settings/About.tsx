import { useT } from '../i18n';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/Card';

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
      </CardContent>
    </Card>
  );
}
