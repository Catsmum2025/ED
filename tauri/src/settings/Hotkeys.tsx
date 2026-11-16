import { useT } from '../i18n';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/Card';
import { HotkeyRecorder } from '../components/HotkeyRecorder';
import { useSettingsStore } from '../store/settings';

export function HotkeysSettings() {
  const t = useT();
  const { keyboard, update } = useSettingsStore();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.hotkeys.title')}</CardTitle>
        <CardDescription>{t('settings.hotkeys.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-slate-100 dark:divide-slate-800/60">
        <HotkeyRecorder
          label={t('settings.hotkeys.dictLabel')}
          description={t('settings.hotkeys.dictDesc')}
          value={keyboard.dictHotkey}
          onChange={(accel) => update({ keyboard: { ...keyboard, dictHotkey: accel } })}
        />
        <HotkeyRecorder
          label={t('settings.hotkeys.translateLabel')}
          description={t('settings.hotkeys.translateDesc')}
          value={keyboard.translateHotkey}
          onChange={(accel) => update({ keyboard: { ...keyboard, translateHotkey: accel } })}
        />
      </CardContent>
    </Card>
  );
}
