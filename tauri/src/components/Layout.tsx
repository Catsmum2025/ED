import { Nav } from './Nav';
import { ExtractionWatcher } from './ExtractionWatcher';
import { ExtractionOverlay } from './ExtractionOverlay';
import { useSettingsStore } from '../store/settings';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ACCENT_COLORS } from '../types';

function darken(hex: string, amount = 0.15) {
  const sanitized = hex.replace('#', '');
  const num = parseInt(sanitized, 16);
  let r = (num >> 16) & 255;
  let g = (num >> 8) & 255;
  let b = num & 255;
  r = Math.max(0, Math.floor(r * (1 - amount)));
  g = Math.max(0, Math.floor(g * (1 - amount)));
  b = Math.max(0, Math.floor(b * (1 - amount)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function resolveAccent(accentColor: string, customAccentColor: string) {
  if (accentColor === 'custom') return customAccentColor;
  return ACCENT_COLORS[accentColor as keyof typeof ACCENT_COLORS] || customAccentColor;
}

/** Pick black or white text for maximum contrast against the given hex
 *  background. Uses the W3C relative-luminance formula. Threshold 0.55 leans
 *  toward white for medium tones, which looks better with accent fills. */
function contrastTextColor(hex: string): string {
  const sanitized = hex.replace('#', '');
  const num = parseInt(sanitized, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  // Normalize to 0..1 with sRGB gamma correction.
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return L > 0.55 ? '#000000' : '#ffffff';
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { theme, accentColor, customAccentColor, uiScale, hideScrollbar, load } = useSettingsStore();
  const { pathname } = useLocation();

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.add(prefersDark ? 'dark' : 'light');
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    const accent = resolveAccent(accentColor, customAccentColor);
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-hover', darken(accent, 0.12));
    // Compute the contrasting foreground color once and expose it as a CSS
    // variable so any element using bg-accent can pick up the right text color
    // without per-component JS. Falls back to white if parsing fails.
    root.style.setProperty('--accent-contrast', contrastTextColor(accent));
  }, [accentColor, customAccentColor]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${uiScale}%`;
  }, [uiScale]);

  useEffect(() => {
    const root = document.documentElement;
    if (hideScrollbar) root.classList.add('scrollbar-hide');
    else root.classList.remove('scrollbar-hide');
  }, [hideScrollbar]);

  return (
    <div className="app-bg min-h-screen text-slate-900 dark:text-slate-100">
      <ExtractionWatcher />
      <Nav />
      <main className="app-main min-h-screen">
        {/* Keying on the pathname replays the entrance animation on every
            route change (including settings sub-tabs). */}
        <div key={pathname} className="page-enter mx-auto w-full max-w-5xl">
          {children}
        </div>
      </main>
      <ExtractionOverlay />
    </div>
  );
}
