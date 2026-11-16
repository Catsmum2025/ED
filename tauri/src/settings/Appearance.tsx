import { useSettingsStore } from '../store/settings';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/Card';
import { Select } from '../components/Select';
import { Toggle } from '../components/Toggle';
import { ACCENT_COLORS, type AccentColor, type AppSettings } from '../types';
import { useT } from '../i18n';

export function AppearanceSettings() {
  const t = useT();
  const { theme, accentColor, customAccentColor, language, uiScale, hideScrollbar, system, update } = useSettingsStore();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.general.theme')}</CardTitle>
          <CardDescription>{t('settings.general.themeDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{t('settings.general.mode')}</label>
            <div className="flex gap-2">
              {[
                { value: 'light', label: t('settings.general.light') },
                { value: 'dark', label: t('settings.general.dark') },
                { value: 'system', label: t('settings.general.system') },
              ].map((m) => (
                <button
                  key={m.value}
                  onClick={() => update({ theme: m.value as any })}
                  className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                    theme === m.value
                      ? 'border-accent text-accent bg-accent-tint shadow-soft'
                      : 'border-slate-200/80 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">{t('settings.general.accentColor')}</label>
            <div className="flex flex-wrap items-center gap-3">
              {(Object.keys(ACCENT_COLORS) as AccentColor[]).map((color) => (
                <button
                  key={color}
                  onClick={() => update({ accentColor: color })}
                  className={`w-8 h-8 rounded-full transition-transform hover:scale-110 ${
                    accentColor === color ? 'ring-2 ring-offset-2 ring-accent dark:ring-offset-slate-900' : ''
                  }`}
                  style={{ backgroundColor: ACCENT_COLORS[color] }}
                  title={color}
                />
              ))}
              <label className={`relative w-8 h-8 rounded-full overflow-hidden cursor-pointer transition-transform hover:scale-110 ${accentColor === 'custom' ? 'ring-2 ring-offset-2 ring-accent dark:ring-offset-slate-900' : 'ring-2 ring-offset-2 ring-slate-200 dark:ring-offset-slate-900'}`}>
                <input
                  type="color"
                  value={customAccentColor}
                  onChange={(e) => update({ accentColor: 'custom', customAccentColor: e.target.value })}
                  className="absolute -top-2 -left-2 w-16 h-16 p-0 border-0 cursor-pointer"
                />
                <span
                  className="absolute inset-0 pointer-events-none"
                  style={{ backgroundColor: customAccentColor }}
                />
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.general.language')}</CardTitle>
          <CardDescription>{t('settings.general.languageDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            label={t('settings.general.displayLanguage')}
            value={language}
            onChange={(e) => update({ language: e.target.value as AppSettings['language'] })}
            options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.general.display')}</CardTitle>
          <CardDescription>{t('settings.general.displayDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            label={t('settings.general.uiScale')}
            value={String(uiScale)}
            onChange={(e) => update({ uiScale: Number(e.target.value) })}
            options={[
              { value: '80', label: '80%' },
              { value: '90', label: '90%' },
              { value: '100', label: '100%' },
              { value: '110', label: '110%' },
              { value: '125', label: '125%' },
              { value: '150', label: '150%' },
            ]}
          />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('settings.general.hideScrollbar')}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('settings.general.hideScrollbarDesc')}</p>
            </div>
            <Toggle
              checked={hideScrollbar}
              onChange={(e) => update({ hideScrollbar: e.target.checked })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.general.systemSection')}</CardTitle>
          <CardDescription>{t('settings.general.systemDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('settings.general.launchAtLogin')}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('settings.general.launchAtLoginDesc')}</p>
            </div>
            <Toggle
              checked={system.launchAtLogin}
              onChange={(e) => update({ system: { ...system, launchAtLogin: e.target.checked } })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
