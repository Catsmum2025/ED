import { useEffect, useState } from 'react';
import { FolderOpen, Play, RefreshCw, Server, Square, TestTube, X } from 'lucide-react';
import { useSettingsStore } from '../store/settings';
import { useT } from '../i18n';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/Card';
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { Select } from '../components/Select';
import { api } from '../ipc';

export function LLMSettings() {
  const t = useT();
  const { llm, update } = useSettingsStore();
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [testOk, setTestOk] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [localStatus, setLocalStatus] = useState<{ running: boolean; pid: number | null }>({ running: false, pid: null });
  const [localMsg, setLocalMsg] = useState('');
  const [toggling, setToggling] = useState(false);

  const refreshLocalStatus = async () => {
    setLocalStatus(await api.llm.localModelStatus());
  };

  const handlePickBat = async () => {
    const picked = await api.llm.pickBatFile();
    if (picked) await update({ llm: { ...llm, localModelBatPath: picked } });
  };

  useEffect(() => {
    refreshLocalStatus();
  }, []);

  const handleLoadModels = async () => {
    setLoadingModels(true);
    const models = await api.llm.listModels(llm.baseURL, llm.apiKey);
    await update({ llm: { ...llm, models, model: models.includes(llm.model) ? llm.model : models[0] || '' } });
    setLoadingModels(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestMsg('');
    setTestOk(false);
    const res = await api.llm.testConnection(llm.baseURL, llm.apiKey, llm.model);
    setTestMsg(res.message);
    setTestOk(res.ok);
    setTesting(false);
  };

  const handleStart = async () => {
    setToggling(true);
    setLocalMsg('');
    const res = await api.llm.startLocalModel(llm.localModelCommand);
    setLocalStatus({ running: res.running, pid: res.pid });
    setLocalMsg(res.message);
    setToggling(false);
  };

  const handleStop = async () => {
    setToggling(true);
    setLocalMsg('');
    const res = await api.llm.stopLocalModel();
    setLocalStatus(res);
    setLocalMsg(res.running ? t('settings.llm.stillRunning') : t('settings.llm.stopped'));
    setToggling(false);
  };

  const modelOptions = llm.models.length
    ? llm.models.map((m) => ({ value: m, label: m }))
    : llm.model
    ? [{ value: llm.model, label: llm.model }]
    : [{ value: '', label: t('settings.llm.loadModels') }];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.llm.connection')}</CardTitle>
          <CardDescription>{t('settings.llm.connectionDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label={t('settings.llm.baseUrl')}
            value={llm.baseURL}
            onChange={(e) => update({ llm: { ...llm, baseURL: e.target.value } })}
            placeholder="http://127.0.0.1:8080/v1"
          />
          <Input
            label={t('settings.llm.apiKey')}
            type="password"
            value={llm.apiKey}
            onChange={(e) => update({ llm: { ...llm, apiKey: e.target.value } })}
            placeholder={t('settings.llm.optional')}
          />
          <Select
            label={t('settings.llm.model')}
            value={llm.model}
            onChange={(e) => update({ llm: { ...llm, model: e.target.value } })}
            options={modelOptions}
          />
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">{t('settings.llm.prefixPrompt')}</label>
            <PrefixPromptEditor
              value={llm.prefixPrompt}
              onApply={(v) => update({ llm: { ...llm, prefixPrompt: v } })}
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t('settings.llm.prefixPromptNote')}</p>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('settings.llm.loadModelsHint')}</p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={handleLoadModels} disabled={loadingModels}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loadingModels ? 'animate-spin' : ''}`} />
              {t('settings.llm.loadModels')}
            </Button>
            <Button onClick={handleTest} disabled={testing || !llm.model}>
              <TestTube className="w-4 h-4 mr-2" />
              {testing ? t('settings.llm.testing') : t('settings.llm.testConn')}
            </Button>
          </div>
          {testMsg && (
            <p className={`text-sm ${testOk ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {testMsg}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.llm.localModel')}</CardTitle>
          <CardDescription>{t('settings.llm.localModelDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">{t('settings.llm.startupScript')}</label>
            <div className="flex gap-2">
              <input
                value={llm.localModelBatPath}
                onChange={(e) => update({ llm: { ...llm, localModelBatPath: e.target.value } })}
                placeholder={t('settings.llm.scriptPlaceholder')}
                className="flex-1 rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 dark:text-slate-100 px-3.5 py-2.5 text-sm focus:outline-none focus:border-accent focus:ring-4 ring-accent/15 transition-all placeholder:text-slate-400"
              />
              <Button variant="secondary" onClick={handlePickBat} disabled={toggling}>
                <FolderOpen className="w-4 h-4 mr-2" />
                {t('settings.llm.select')}
              </Button>
              {llm.localModelBatPath && (
                <Button variant="ghost" onClick={() => update({ llm: { ...llm, localModelBatPath: '' } })} title={t('settings.llm.clear')}>
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
          <Input
            label={t('settings.llm.startupCmd')}
            value={llm.localModelCommand}
            onChange={(e) => update({ llm: { ...llm, localModelCommand: e.target.value } })}
            placeholder={t('settings.llm.cmdPlaceholder')}
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('settings.llm.scriptNote')}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={handleStart} disabled={toggling || (!llm.localModelBatPath.trim() && !llm.localModelCommand.trim()) || localStatus.running}>
              <Play className="w-4 h-4 mr-2" />
              {t('settings.llm.start')}
            </Button>
            <Button variant="secondary" onClick={handleStop} disabled={toggling || !localStatus.running}>
              <Square className="w-4 h-4 mr-2" />
              {t('settings.llm.stop')}
            </Button>
            <Button variant="ghost" onClick={refreshLocalStatus} disabled={toggling}>
              <RefreshCw className="w-4 h-4 mr-2" />
              {t('settings.llm.refreshStatus')}
            </Button>
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${localStatus.running ? 'bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
              <Server className="w-3.5 h-3.5" />
              {localStatus.running ? `${t('settings.llm.running')} (PID ${localStatus.pid ?? '-'})` : t('settings.llm.stopped')}
            </span>
          </div>
          {localMsg && (
            <p className={`text-sm ${localStatus.running ? 'text-green-600 dark:text-green-400' : 'text-slate-500 dark:text-slate-400'}`}>
              {localMsg}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Local-state textarea for the prefix prompt. Editing does NOT immediately
 *  sync to the store — the user must click "Apply" to persist. This avoids the
 *  cursor-jump-to-end bug caused by the async store update overwriting the
 *  textarea mid-typing. */
function PrefixPromptEditor({ value, onApply }: { value: string; onApply: (v: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  const dirty = draft !== value;

  // Sync from store when the value changes externally (e.g. settings reload),
  // but only if the user hasn't got uncommitted edits.
  useEffect(() => {
    if (!dirty) setDraft(value);
  }, [value, dirty]);

  return (
    <div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        className="w-full rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 dark:text-slate-100 px-3.5 py-2.5 text-sm focus:outline-none focus:border-accent focus:ring-4 ring-accent/15 transition-all placeholder:text-slate-400 resize-none"
      />
      <div className="flex items-center gap-2 mt-2">
        <Button
          variant="primary"
          onClick={() => onApply(draft)}
          disabled={!dirty}
        >
          {t('settings.llm.apply')}
        </Button>
        {dirty && (
          <button
            onClick={() => setDraft(value)}
            className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            {t('settings.llm.reset')}
          </button>
        )}
      </div>
    </div>
  );
}
