import { useEffect, useRef, useState } from 'react';
import { Search, Trash2, AlertTriangle } from 'lucide-react';
import { t } from '../i18n';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/Card';
import { api } from '../ipc';
import type { WordEntry } from '../types';

/**
 * Lets the user search the dictionary index and delete entries that were added
 * by mistake (e.g. AI-generated words with errors). Deletion is permanent —
 * it removes the .json data file and drops the entry from the search index.
 */
export function WordManager() {
  const [query, setQuery] = useState('');
  const [lang, setLang] = useState<'en' | 'zh'>('en');
  const [results, setResults] = useState<WordEntry[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-detect language from query content (Chinese chars → zh search).
  useEffect(() => {
    setLang(/[\u4e00-\u9fa5]/.test(query) ? 'zh' : 'en');
  }, [query]);

  // Debounced search against the dictionary index.
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!query.trim()) { setResults([]); return; }
      const r = await api.dict.search(query, lang, 30);
      setResults(r);
    }, 150);
    return () => clearTimeout(t);
  }, [query, lang]);

  const handleDelete = async (word: string) => {
    if (!confirm(t('settings.wordManager.confirmDelete', { word }))) return;
    setDeleting(word);
    setMessage(null);
    try {
      const ok = await api.dict.deleteWord(word);
      if (ok) {
        setResults((prev) => prev.filter((r) => r.word !== word));
        setMessage({ text: t('settings.wordManager.deleted', { word }), kind: 'ok' });
      } else {
        setMessage({ text: t('settings.wordManager.notFound', { word }), kind: 'err' });
      }
    } catch (err: any) {
      setMessage({ text: err?.message || t('settings.wordManager.deleteFailed'), kind: 'err' });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.wordManager.title')}</CardTitle>
        <CardDescription>{t('settings.wordManager.desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 rounded-xl border field-tint pl-3.5 pr-2 py-2 transition-all">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('settings.wordManager.searchPlaceholder')}
            className="flex-1 bg-transparent outline-none text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 px-1.5"
              title={t('settings.wordManager.clear')}
            >
              {t('settings.wordManager.clear')}
            </button>
          )}
        </div>

        {message && (
          <p className={`text-xs px-3 py-2 rounded-lg ${
            message.kind === 'ok'
              ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300'
              : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
          }`}>
            {message.text}
          </p>
        )}

        {results.length > 0 && (
          <div className="rounded-xl border border-slate-200/70 dark:border-slate-800 overflow-hidden max-h-80 overflow-y-auto scrollbar-hide p-1.5">
            {results.map((r, i) => (
              <div
                key={r.word}
                style={{ ['--i' as string]: Math.min(i, 10) }}
                className="list-row animate-list-item group"
              >
                <div className="min-w-0 flex-1">
                  <div className="list-row-primary text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{r.word}</div>
                  {r.concise && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{r.concise}</div>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(r.word)}
                  disabled={deleting !== null}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  title={t('settings.wordManager.deleteTitle')}
                >
                  {deleting === r.word ? (
                    <span className="text-xs">…</span>
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}

        {query.trim() && results.length === 0 && !deleting && (
          <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 py-3 px-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {t('settings.wordManager.noMatch')}
          </div>
        )}

        {!query.trim() && (
          <p className="text-xs text-slate-400 dark:text-slate-500 py-1">
            {t('settings.wordManager.searchHint')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
