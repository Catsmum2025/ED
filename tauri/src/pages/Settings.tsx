import { NavLink, useLocation, Navigate } from 'react-router-dom';
import { AppearanceSettings } from '../settings/Appearance';
import { LLMSettings } from '../settings/LLM';
import { DictionaryCacheSettings } from '../settings/DictionaryCache';
import { HotkeysSettings } from '../settings/Hotkeys';
import { AudioSettings } from '../settings/Audio';
import { ExperimentalSettings } from '../settings/Experimental';
import { AboutSettings } from '../settings/About';
import { PageHeader } from '../components/PageHeader';
import { useT } from '../i18n';

export function SettingsPage() {
  const t = useT();
  const { pathname } = useLocation();

  const tabs = [
    { to: '/settings/appearance', label: t('settings.tabs.general') },
    { to: '/settings/llm', label: t('settings.tabs.llm') },
    { to: '/settings/dictionary', label: t('settings.tabs.dictionary') },
    { to: '/settings/hotkeys', label: t('settings.tabs.hotkeys') },
    { to: '/settings/audio', label: t('settings.tabs.audio') },
    { to: '/settings/experimental', label: t('settings.tabs.experimental') },
    { to: '/settings/about', label: t('settings.tabs.about') },
  ];

  if (pathname === '/settings' || pathname === '/settings/') {
    return <Navigate to="/settings/appearance" replace />;
  }

  const activeTab = tabs.find((tab) => pathname.startsWith(tab.to));
  const section = activeTab?.to.replace('/settings/', '') || 'appearance';

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title={t('nav.settings')} />

      <nav className="inline-flex gap-1 p-1 rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-soft overflow-x-auto scrollbar-hide max-w-full">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.to);
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={`shrink-0 px-4 py-1.5 rounded-xl text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                isActive
                  ? 'bg-accent text-accent-contrast shadow-soft'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/60'
              }`}
            >
              {tab.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="animate-fade-in">
        {section === 'appearance' && <AppearanceSettings />}
        {section === 'llm' && <LLMSettings />}
        {section === 'dictionary' && <DictionaryCacheSettings />}
        {section === 'hotkeys' && <HotkeysSettings />}
        {section === 'audio' && <AudioSettings />}
        {section === 'experimental' && <ExperimentalSettings />}
        {section === 'about' && <AboutSettings />}
      </div>
    </div>
  );
}
