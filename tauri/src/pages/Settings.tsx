import { NavLink, useLocation, Navigate } from 'react-router-dom';
import {
  Palette,
  Sparkles,
  BookOpen,
  Keyboard,
  Volume2,
  FlaskConical,
  Info,
  type LucideIcon,
} from 'lucide-react';
import { AppearanceSettings } from '../settings/Appearance';
import { LLMSettings } from '../settings/LLM';
import { DictionaryCacheSettings } from '../settings/DictionaryCache';
import { HotkeysSettings } from '../settings/Hotkeys';
import { AudioSettings } from '../settings/Audio';
import { ExperimentalSettings } from '../settings/Experimental';
import { AboutSettings } from '../settings/About';
import { PageHeader } from '../components/PageHeader';
import { useT } from '../i18n';

interface SettingsTab {
  to: string;
  label: string;
  icon: LucideIcon;
}

export function SettingsPage() {
  const t = useT();
  const { pathname } = useLocation();

  const tabs: SettingsTab[] = [
    { to: '/settings/appearance', label: t('settings.tabs.general'), icon: Palette },
    { to: '/settings/llm', label: t('settings.tabs.llm'), icon: Sparkles },
    { to: '/settings/dictionary', label: t('settings.tabs.dictionary'), icon: BookOpen },
    { to: '/settings/hotkeys', label: t('settings.tabs.hotkeys'), icon: Keyboard },
    { to: '/settings/audio', label: t('settings.tabs.audio'), icon: Volume2 },
    { to: '/settings/experimental', label: t('settings.tabs.experimental'), icon: FlaskConical },
    { to: '/settings/about', label: t('settings.tabs.about'), icon: Info },
  ];

  if (pathname === '/settings' || pathname === '/settings/') {
    return <Navigate to="/settings/appearance" replace />;
  }

  const activeTab = tabs.find((tab) => pathname.startsWith(tab.to));
  const section = activeTab?.to.replace('/settings/', '') || 'appearance';

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title={t('nav.settings')} subtitle={t('settings.subtitle')} />

      <div className="grid items-start gap-6 md:grid-cols-[11.5rem_minmax(0,1fr)]">
        {/* Secondary navigation: vertical on desktop, scrollable row on narrow windows. */}
        <aside className="rounded-2xl border border-slate-200/70 bg-white/75 p-1.5 shadow-card backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-900/65 md:sticky md:top-6">
          <nav className="flex gap-0.5 overflow-x-auto scrollbar-hide md:flex-col">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  className={({ isActive }) => `side-link${isActive ? ' is-active' : ''}`}
                >
                  {({ isActive }) => (
                    <>
                      <span className="side-glyph">
                        <Icon className="h-4 w-4" strokeWidth={isActive ? 2.2 : 1.9} />
                      </span>
                      <span className="whitespace-nowrap">{tab.label}</span>
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </aside>

        {/* Keyed so switching sections replays the entrance animation. */}
        <div key={section} className="page-enter min-w-0 space-y-4">
          {section === 'appearance' && <AppearanceSettings />}
          {section === 'llm' && <LLMSettings />}
          {section === 'dictionary' && <DictionaryCacheSettings />}
          {section === 'hotkeys' && <HotkeysSettings />}
          {section === 'audio' && <AudioSettings />}
          {section === 'experimental' && <ExperimentalSettings />}
          {section === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
  );
}
