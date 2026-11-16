import { NavLink } from 'react-router-dom';
import { BookOpen, Languages, BookMarked, BarChart3, Settings } from 'lucide-react';
import { useT } from '../i18n';

export function Nav() {
  const t = useT();

  const items = [
    { to: '/dictionary', icon: BookOpen, label: t('nav.dictionary') },
    { to: '/translate', icon: Languages, label: t('nav.translate') },
    { to: '/books', icon: BookMarked, label: t('nav.books') },
    { to: '/stats', icon: BarChart3, label: t('nav.stats') },
    { to: '/settings', icon: Settings, label: t('nav.settings') },
  ];
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/60 dark:border-slate-800/60 bg-white/70 dark:bg-slate-950/60 backdrop-blur-xl">
      <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5 select-none">
          <img src="./icon.png" alt="CDictionary" className="w-8 h-8" />
          <span className="font-serif-display text-lg text-slate-900 dark:text-slate-100">CDictionary</span>
        </div>

        <nav className="flex items-center gap-1 p-1 rounded-2xl bg-slate-100/80 dark:bg-slate-900/70 ring-1 ring-slate-200/60 dark:ring-slate-800/60">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `nav-item flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium ${
                    isActive
                      ? 'bg-white dark:bg-slate-800 text-accent shadow-soft'
                      : 'text-slate-500 dark:text-slate-400'
                  }`
                }
              >
                <span className="nav-icon inline-flex"><Icon className="w-4 h-4" /></span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
