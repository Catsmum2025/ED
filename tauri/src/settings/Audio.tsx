import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useT } from '../i18n';
import { useSettingsStore } from '../store/settings';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/Card';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Toggle } from '../components/Toggle';
import { api } from '../ipc';

interface Voice {
  id: string;
  name?: string;
  file_path?: string;
}

export function AudioSettings() {
  const t = useT();
  const { audio, update } = useSettingsStore();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [health, setHealth] = useState<{ reachable: boolean; modelLoaded: boolean; version?: string; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testText] = useState('Hello, this is a test of the speech engine.');

  const loadVoices = async () => {
    setLoadingVoices(true);
    try {
      const list = await api.tts.listVoices(audio.baseURL);
      setVoices(list);
    } catch (err: any) {
      setVoices([]);
      console.warn('加载音色失败:', err?.message);
    } finally {
      setLoadingVoices(false);
    }
  };

  const checkHealth = async () => {
    setTesting(true);
    try {
      const h = await api.tts.checkHealth(audio.baseURL);
      setHealth(h);
      if (h.reachable) await loadVoices();
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    if (audio.engine === 'indextts' && audio.baseURL) {
      checkHealth();
    }
    // Only on mount / when engine flips to indextts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.engine]);

  const handleTest = async () => {
    setTesting(true);
    try {
      // Trigger a real synthesis via the IPC, then play it through a hidden audio element.
      const { url } = await api.tts.synthesize(testText);
      const audioEl = new Audio(url);
      await audioEl.play();
    } catch (err: any) {
      alert(`测试失败: ${err?.message || err}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.audio.title')}</CardTitle>
        <CardDescription>{t('settings.audio.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('settings.audio.enable')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('settings.audio.enableDesc')}</p>
          </div>
          <Toggle
            checked={audio.enabled}
            onChange={(e) => update({ audio: { ...audio, enabled: e.target.checked } })}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">{t('settings.audio.engine')}</label>
          <div className="inline-flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/70 text-sm">
            <button
              onClick={() => update({ audio: { ...audio, engine: 'indextts' } })}
              className={`px-3 py-1 rounded-lg transition-colors ${audio.engine === 'indextts' ? 'bg-white dark:bg-slate-700 text-accent shadow-soft' : 'text-slate-500 dark:text-slate-400'}`}
            >
              IndexTTS
            </button>
            <button
              onClick={() => update({ audio: { ...audio, engine: 'browser' } })}
              className={`px-3 py-1 rounded-lg transition-colors ${audio.engine === 'browser' ? 'bg-white dark:bg-slate-700 text-accent shadow-soft' : 'text-slate-500 dark:text-slate-400'}`}
            >
              {t('settings.audio.browser')}
            </button>
          </div>
        </div>

        {audio.engine === 'indextts' && (
          <>
            <Input
              label={t('settings.audio.indexttsUrl')}
              value={audio.baseURL}
              onChange={(e) => update({ audio: { ...audio, baseURL: e.target.value } })}
              placeholder="http://127.0.0.1:7866"
            />

            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="secondary" onClick={checkHealth} disabled={testing}>
                {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                {t('settings.audio.testConn')}
              </Button>
              {health && (
                <span className={`text-xs px-2.5 py-1 rounded-md ${
                  health.reachable && health.modelLoaded
                    ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300'
                    : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                }`}>
                  {health.message}{health.version ? ` · ${health.version}` : ''}
                </span>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                {t('settings.audio.voice')} {loadingVoices && <span className="text-slate-400">{t('settings.audio.voiceLoading')}</span>}
              </label>
              <select
                value={audio.voice}
                onChange={(e) => update({ audio: { ...audio, voice: e.target.value } })}
                className="w-full max-w-md px-3.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200/60 dark:border-slate-700/60 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
              >
                {voices.length === 0 && <option value={audio.voice}>{audio.voice || t('settings.audio.voiceEmpty')}</option>}
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.id}{v.name && v.name !== v.id ? ` · ${v.name}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                {t('settings.audio.rate')} <span className="text-accent tabular-nums">{audio.rate.toFixed(1)}×</span>
              </label>
              <input
                type="range"
                min={0.5}
                max={2.0}
                step={0.1}
                value={audio.rate}
                onChange={(e) => update({ audio: { ...audio, rate: parseFloat(e.target.value) } })}
                className="w-full max-w-md accent-[var(--accent)]"
              />
            </div>

            <div className="pt-2">
              <Button onClick={handleTest} disabled={!audio.enabled || testing}>
                {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {t('settings.audio.preview')}
              </Button>
            </div>
          </>
        )}

        {audio.engine === 'browser' && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('settings.audio.browserNote')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}