import { NavLink } from 'react-router-dom';
import {
  BookOpen,
  Languages,
  BookMarked,
  BarChart3,
  Settings,
  LayoutDashboard,
  type LucideIcon,
} from 'lucide-react';
import { useT } from '../i18n';

interface RailItem {
  to: string;
  icon: LucideIcon;
  label: string;
  /** Shows a small accent dot hinting the feature is still on its way. */
  upcoming?: boolean;
}

/** A single icon-only entry in the rail. The label is exposed as a native
 *  title plus a styled tooltip that slides out of the rail on hover/focus. */
function RailLink({ to, icon: Icon, label, upcoming }: RailItem) {
  return (
    <NavLink
      to={to}
      title={label}
      aria-label={label}
      className={({ isActive }) => `rail-btn${isActive ? ' is-active' : ''}`}
    >
      {({ isActive }) => (
        <>
          <span className="rail-indicator" aria-hidden="true" />
          <span className="rail-glyph">
            <Icon className="w-[1.15rem] h-[1.15rem]" strokeWidth={isActive ? 2.2 : 1.9} />
          </span>
          {upcoming && <span className="rail-dot" aria-hidden="true" />}
          <span className="rail-tip" role="tooltip">{label}</span>
        </>
      )}
    </NavLink>
  );
}

/**
 * Vertical, full-height navigation rail pinned to the left edge.
 * Rendered as a rounded floating card with equal top/right/bottom margins.
 * Primary destinations stack from the top; settings and the global dashboard
 * live below a divider at the bottom.
 */
export function Nav() {
  const t = useT();

  const primary: RailItem[] = [
    { to: '/dictionary', icon: BookOpen, label: t('nav.dictionary') },
    { to: '/translate', icon: Languages, label: t('nav.translate') },
    { to: '/books', icon: BookMarked, label: t('nav.books') },
    { to: '/stats', icon: BarChart3, label: t('nav.stats') },
  ];

  const secondary: RailItem[] = [
    { to: '/settings', icon: Settings, label: t('nav.settings') },
    { to: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard'), upcoming: true },
  ];

  return (
    <aside className="nav-rail" aria-label={t('nav.primary')}>
      <nav className="flex w-full flex-col items-center gap-1.5 px-2 pt-0.5">
        {primary.map((item) => (
          <RailLink key={item.to} {...item} />
        ))}
      </nav>

      <div className="mt-auto flex w-full flex-col items-center gap-1.5 px-2 pb-0.5">
        <div className="rail-divider" aria-hidden="true" />
        {secondary.map((item) => (
          <RailLink key={item.to} {...item} />
        ))}
      </div>
    </aside>
  );
}
