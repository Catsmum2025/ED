import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Copy, Languages } from 'lucide-react';
import { api } from '../ipc';
import { Button } from '../components/Button';
import { Card, CardContent } from '../components/Card';
import { Select } from '../components/Select';
import { SpeakButton } from '../components/SpeakButton';
import { PageHeader } from '../components/PageHeader';
import { useSettingsStore } from '../store/settings';
import { useT } from '../i18n';

export function TranslatePage() {
  const t = useT();
  const { llm, update } = useSettingsStore();
  const [searchParams] = useSearchParams();
  const [text, setText] = useState(() => searchParams.get('text') ?? '');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.translate.onChunk((chunk) => {
      setResult((prev) => prev + chunk);
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
    api.translate.onDone(() => setLoading(false));
    api.translate.onError((message) => {
      setResult((prev) => prev + '\n' + t('popup.translate.error') + ' ' + message);
      setLoading(false);
    });
    return () => {
      api.translate.removeAllListeners();
    };
  }, []);

  const handleTranslate = () => {
    if (!text.trim() || !llm.model) return;
    setResult('');
    setLoading(true);
    api.translate.stream({
      text,
      model: llm.model,
      baseURL: llm.baseURL,
      apiKey: llm.apiKey,
      prefixPrompt: llm.prefixPrompt,
    });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(result);
  };

  const modelOptions = llm.models.length
    ? llm.models.map((m) => ({ value: m, label: m }))
    : llm.model
    ? [{ value: llm.model, label: llm.model }]
    : [];

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      <PageHeader title={t('translate.title')} subtitle={t('translate.subtitle')} />

      <Card>
        <CardContent>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('translate.inputLabel')}</label>
            <Select
              className="w-64"
              options={modelOptions.length ? modelOptions : [{ value: '', label: t('translate.noModel') }]}
              value={llm.model}
              onChange={(e) => update({ llm: { ...llm, model: e.target.value } })}
            />
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('translate.placeholder')}
            rows={6}
            className="w-full rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/40 dark:text-slate-100 p-3.5 text-sm focus:outline-none focus:border-accent focus:ring-4 ring-accent/15 transition-all resize-none placeholder:text-slate-400"
          />
          <div className="mt-3 flex justify-end">
            <Button onClick={handleTranslate} disabled={loading || !llm.model}>
              <Languages className="w-4 h-4 mr-2" />
              {loading ? t('translate.translating') : t('translate.button')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card className="animate-fade-in">
          <CardContent>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('translate.resultLabel')}</label>
              <div className="flex items-center gap-2">
                <SpeakButton text={result} title={t('translate.speakResult')} size="sm" />
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-accent transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {t('translate.copy')}
                </button>
              </div>
            </div>
            <div className="whitespace-pre-wrap text-slate-800 dark:text-slate-200 leading-relaxed min-h-[80px]">
              {result}
              <div ref={resultRef} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
