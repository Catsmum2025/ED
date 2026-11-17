import { useEffect } from 'react';
import { useSettingsStore } from '../store/settings';
import { applyAccent, applyScrollbarHidden, applyTheme, applyUiScale } from '../lib/theme';

/** Ensures settings are loaded into the zustand store regardless of which
 *  route is rendered, and applies the global appearance tokens (theme class,
 *  accent CSS variables, UI scale, scrollbar) to <html>.
 *
 *  This runs for popup windows too: they bypass Layout, and previously ended up
 *  with the stock blue accent and no light/dark class at all. */
export function SettingsLoader() {
  const load = useSettingsStore((s) => s.load);
  const motion = useSettingsStore((s) => s.motion);
  const theme = useSettingsStore((s) => s.theme);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const customAccentColor = useSettingsStore((s) => s.customAccentColor);
  const uiScale = useSettingsStore((s) => s.uiScale);
  const hideScrollbar = useSettingsStore((s) => s.hideScrollbar);

  useEffect(() => {
    load();
  }, [load]);

  // Drive the global animation intensity from a single place so popup windows
  // (which bypass Layout) respect it too.
  useEffect(() => {
    document.documentElement.dataset.motion = motion || 'lively';
  }, [motion]);

  useEffect(() => {
    applyTheme(theme || 'system');
  }, [theme]);

  useEffect(() => {
    applyAccent(accentColor || 'custom', customAccentColor || '#5c5897');
  }, [accentColor, customAccentColor]);

  useEffect(() => {
    applyUiScale(uiScale);
  }, [uiScale]);

  useEffect(() => {
    applyScrollbarHidden(hideScrollbar);
  }, [hideScrollbar]);

  return null;
}
