import { useEffect, useState } from 'react';
import { FolderOpen, CheckCircle, PackageOpen, Trash2, Eye } from 'lucide-react';
import { useT } from '../i18n';
import { useSettingsStore } from '../store/settings';
import { useExtractionStore } from '../store/extraction';
import { useExtractionBlocked } from '../components/ExtractionOverlay';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/Card';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { api } from '../ipc';
import { WordManager } from './WordManager';

export function DictionaryCacheSettings() {
  const t = useT();
  const { dictionaryPath, update } = useSettingsStore();
  const [status, setStatus] = useState({ exists: false, count: 0, lastUpdated: 0 });
  const [canInstall, setCanInstall] = useState(false);
  const [busy, setBusy] = useState<null | 'uninstall'>(null);
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);

  // Extraction state — drives the progress modal and disables buttons while running.
  const extractionState = useExtractionStore((s) => s.state);
  const extractionCount = useExtractionStore((s) => s.entryCount);
  const setRunning = useExtractionStore((s) => s.setRunning);
  const showModal = useExtractionStore((s) => s.showModal);
  const modalDismissed = useExtractionStore((s) => s.modalDismissed);
  const blocked = useExtractionBlocked();

  // Reload dictionary status once the background extraction finishes.
  useEffect(() => {
    if (extractionState === 'done') {
      // Refresh both the input box and the entry-count display.
      api.dict.indexStatus().then((s) => {
        setStatus(s);
        if (s.exists) update({ dictionaryPath: useSettingsStore.getState().dictionaryPath });
      });
    }
  }, [extractionState, extractionCount, update]);

  const loadStatus = async () => {
    const [s, c] = await Promise.all([
      api.dict.indexStatus(),
      api.dict.canInstall(),
    ]);
    setStatus(s);
    setCanInstall(c.available);
  };

  useEffect(() => {
    loadStatus();
  }, [dictionaryPath]);

  const handlePick = async () => {
    const dir = await api.settings.pickDictionaryDir();
    if (dir) {
      await update({ dictionaryPath: dir });
    }
  };

  const handleOpen = () => {
    api.settings.openPath(dictionaryPath);
  };

  const handleInstall = async () => {
    if (!confirm(t('settings.dict.confirmInstall'))) return;
    setMessage(null);
    // Trigger the install — the main process streams progress back via events.
    // The extraction store flips to 'running' immediately so the overlay shows.
    setRunning();
    try {
      await api.dict.install();
    } catch (err: any) {
      setMessage({ text: err?.message || t('settings.dict.extractionFailed'), kind: 'err' });
    }
  };

  const handleUninstall = async () => {
    if (!confirm(t('settings.dict.confirmUninstall'))) return;
    setBusy('uninstall');
    setMessage(null);
    try {
      const res = await api.dict.uninstall();
      if (res.success) {
        await update({ dictionaryPath: '' });
        setMessage({ text: `${res.message} · ${t('settings.dict.removedFiles', { count: res.removed })}`, kind: 'ok' });
      } else {
        setMessage({ text: res.message, kind: 'err' });
      }
      await loadStatus();
    } catch (err: any) {
      setMessage({ text: err?.message || t('settings.dict.uninstallFailed'), kind: 'err' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.dict.cacheManagement')}</CardTitle>
          <CardDescription>{t('settings.dict.cacheDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label={t('settings.dict.cacheDir')}
            value={dictionaryPath || t('settings.dict.cacheDirEmpty')}
            readOnly
            onClick={handleOpen}
            className="cursor-pointer"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {`${t('settings.dict.entryCount')}:`} {status.count} · {`${t('settings.dict.lastUpdated')}:`} {status.lastUpdated ? new Date(status.lastUpdated).toLocaleString('zh-CN') : t('settings.dict.notIndexed')}
          </p>

          {message && (
            <p className={`text-xs px-3 py-2 rounded-lg ${
              message.kind === 'ok'
                ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300'
                : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
            }`}>
              {message.text}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button onClick={handleInstall} disabled={!canInstall || blocked || busy !== null}>
              <PackageOpen className="w-4 h-4 mr-2" />
              {t('settings.dict.extractDict')}
            </Button>
            <Button onClick={handleUninstall} disabled={blocked || busy !== null}>
              <Trash2 className={`w-4 h-4 mr-2 ${busy === 'uninstall' ? 'animate-pulse' : ''}`} />
              {busy === 'uninstall' ? t('settings.dict.uninstalling') : t('settings.dict.uninstallDict')}
            </Button>
            <Button variant="secondary" onClick={handleOpen} disabled={!dictionaryPath || blocked}>
              <FolderOpen className="w-4 h-4 mr-2" />
              {t('settings.dict.showInExplorer')}
            </Button>
            <Button variant="secondary" onClick={handlePick} disabled={blocked}>
              <CheckCircle className="w-4 h-4 mr-2" />
              {t('settings.dict.pickDir')}
            </Button>
            {/* Show "View progress" while extraction is running in background. */}
            {extractionState === 'running' && modalDismissed && (
              <Button variant="secondary" onClick={showModal}>
                <Eye className="w-4 h-4 mr-2" />
                {t('extraction.viewProgress')}
              </Button>
            )}
          </div>

          {!canInstall && (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {t('settings.dict.noBundledZip')}
            </p>
          )}
        </CardContent>
      </Card>

      <WordManager />
    </div>
  );
}
