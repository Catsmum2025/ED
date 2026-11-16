import { useEffect } from 'react';
import { api } from '../ipc';
import { useExtractionStore } from '../store/extraction';

/** Invisible component that subscribes to dict install progress events
 *  and updates the global extraction store. Mount once at the app root. */
export function ExtractionWatcher() {
  const setProgress = useExtractionStore((s) => s.setProgress);
  const setDone = useExtractionStore((s) => s.setDone);
  const setError = useExtractionStore((s) => s.setError);

  useEffect(() => {
    const offP = api.dict.onInstallProgress((p) => setProgress(p));
    const offD = api.dict.onInstallDone((r) => setDone(r.count));
    const offE = api.dict.onInstallError((e) => setError(e.message));
    return () => { offP(); offD(); offE(); };
  }, [setProgress, setDone, setError]);

  return null;
}
