import { useEffect, useRef, useState } from 'react';
import { Copy, Languages } from 'lucide-react';
import { api } from '../ipc';
import { PopupFrame } from '../components/PopupFrame';
import { useSettingsStore } from '../store/settings';
import { useT } from '../i18n';

export function PopupTranslatePage() {
  const t = useT();
  const { llm } = useSettingsStore();
  const [text, setText] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
    const off = api.window.onShow(() => {
      setText('');
      setResult('');
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    });
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
      off();
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') api.window.hide();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <PopupFrame
      title={t('popup.translate.title')}
      canSwitch={!!result}
      onSwitch={() => ({ route: '/translate', query: { text } })}
    >
      <div className="p-3 space-y-2">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('popup.translate.placeholder')}
          rows={3}
          className="w-full resize-none rounded-xl border field-tint px-3 py-2 text-sm outline-none"
        />
        <div className="flex justify-end">
          <button
            onClick={handleTranslate}
            disabled={loading || !text.trim() || !llm.model}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-accent text-accent-contrast text-xs font-medium disabled:opacity-50"
          >
            <Languages className="w-3.5 h-3.5" />
            {loading ? t('popup.translate.translating') : t('popup.translate.translate')}
          </button>
        </div>

        {result && (
          <div className="rounded-xl border border-accent/40 bg-white dark:bg-slate-900 p-3 animate-fade-in select-text">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-accent font-medium">{t('popup.translate.result')}</span>
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-accent transition-colors"
                title={t('popup.translate.copy')}
              >
                <Copy className="w-3 h-3" />
                {copied ? t('popup.translate.copied') : t('popup.translate.copy')}
              </button>
            </div>
            <div className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
              {result}
              <div ref={resultRef} />
            </div>
          </div>
        )}

        {!result && (
          <p className="text-xs text-center text-slate-400 dark:text-slate-500 py-2">
            {!llm.model ? t('popup.translate.noModel') : t('popup.translate.hint')}
          </p>
        )}
      </div>
    </PopupFrame>
  );
}
