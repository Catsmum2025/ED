import { useEffect } from 'react';
import { api } from '../ipc';
import { useExtractionStore } from '../store/extraction';
import { useSettingsStore } from '../store/settings';

/** Invisible component that subscribes to dict install progress events
 *  and updates the global extraction store. Mount once at the app root. */
export function ExtractionWatcher() {
  const setProgress = useExtractionStore((s) => s.setProgress);
  const setDone = useExtractionStore((s) => s.setDone);
  const setError = useExtractionStore((s) => s.setError);

  useEffect(() => {
    const offP = api.dict.onInstallProgress((p) => setProgress(p));
    const offD = api.dict.onInstallDone((r) => {
      setDone(r.count);
      // Mirror the freshly installed path into the settings store. The backend
      // already persisted it; without this the UI keeps a stale path and any
      // later settings save would clobber the new one back to the old value.
      if (r.path) useSettingsStore.getState().update({ dictionaryPath: r.path });
    });
    const offE = api.dict.onInstallError((e) => {
      setError(e.message);
      // Errors must never be silent: if the user dismissed the progress dialog
      // to run in the background, bring it back and surface the main window.
      useExtractionStore.getState().showModal();
      api.window.showMain().catch(() => {});
    });
    return () => { offP(); offD(); offE(); };
  }, [setProgress, setDone, setError]);

  return null;
}
