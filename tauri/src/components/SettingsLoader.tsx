import { useEffect } from 'react';
import { useSettingsStore } from '../store/settings';

/** Ensures settings are loaded into the zustand store regardless of which
 *  route is rendered. Previously only the main Layout loaded settings, which
 *  meant popup windows (whose routes bypass Layout) read default/empty LLM
 *  config — causing "请先在设置中配置大语言模型" even when the main window
 *  could translate fine. Mount once near the app root. */
export function SettingsLoader() {
  const load = useSettingsStore((s) => s.load);
  useEffect(() => {
    load();
  }, [load]);
  return null;
}
