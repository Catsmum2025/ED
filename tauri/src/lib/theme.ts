import { ACCENT_COLORS } from '../types';

/** Fallback accent used before settings load and for malformed values. */
export const DEFAULT_ACCENT = '#5c5897';

function sanitizeHex(hex: string): string {
  const value = (hex || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_ACCENT;
}

function channels(hex: string): [number, number, number] {
  const num = parseInt(sanitizeHex(hex).slice(1), 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function resolveAccent(accentColor: string, customAccentColor: string): string {
  if (accentColor === 'custom') return sanitizeHex(customAccentColor);
  return ACCENT_COLORS[accentColor as keyof typeof ACCENT_COLORS] || sanitizeHex(customAccentColor);
}

export function darken(hex: string, amount = 0.12): string {
  const [r, g, b] = channels(hex).map((v) => Math.max(0, Math.floor(v * (1 - amount))));
  const value = (r << 16) + (g << 8) + b;
  return '#' + value.toString(16).padStart(6, '0');
}

/** Pick black or white text for maximum contrast (W3C relative luminance). */
export function contrastTextColor(hex: string): string {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = channels(hex);
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.55 ? '#000000' : '#ffffff';
}

/** Publish the accent color to CSS. Both forms are needed: --accent for the
 *  hand-written tokens (heatmap, nav rail, color-mix) and --accent-rgb for the
 *  Tailwind utilities that apply opacity modifiers. */
export function applyAccent(accentColor: string, customAccentColor: string): void {
  const accent = resolveAccent(accentColor, customAccentColor);
  const [r, g, b] = channels(accent);
  const root = document.documentElement;
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-rgb', `${r} ${g} ${b}`);
  root.style.setProperty('--accent-hover', darken(accent));
  root.style.setProperty('--accent-contrast', contrastTextColor(accent));
}

export function applyTheme(theme: 'light' | 'dark' | 'system'): void {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.add(prefersDark ? 'dark' : 'light');
  } else {
    root.classList.add(theme);
  }
}

export function applyUiScale(scale: number): void {
  document.documentElement.style.fontSize = `${Number.isFinite(scale) && scale > 0 ? scale : 100}%`;
}

export function applyScrollbarHidden(hide: boolean): void {
  document.documentElement.classList.toggle('scrollbar-hide', !!hide);
}