import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../ipc';
import { PopupFrame } from '../components/PopupFrame';
import { t } from '../i18n';
import type { WordDefinition, WordEntry } from '../types';

export function PopupDictPage() {
  const [query, setQuery] = useState('');
  const [lang, setLang] = useState<'en' | 'zh'>('en');
  const [candidates, setCandidates] = useState<WordEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selected, setSelected] = useState<WordDefinition | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus input + reset state each time the popup is shown (via hotkey).
    setTimeout(() => inputRef.current?.focus(), 50);
    const off = api.window.onShow(() => {
      setQuery('');
      setCandidates([]);
      setSelected(null);
      setActiveIndex(-1);
      setTimeout(() => inputRef.current?.focus(), 50);
    });
    return () => { off(); };
  }, []);

  useEffect(() => {
    setLang(/[\u4e00-\u9fa5]/.test(query) ? 'zh' : 'en');
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!query.trim()) { setCandidates([]); return; }
      const r = await api.dict.search(query, lang, 8);
      setCandidates(r);
      setActiveIndex(-1);
    }, 120);
    return () => clearTimeout(timer);
  }, [query, lang]);

  const handleSearch = async (word?: string) => {
    const target = (word || query).trim();
    if (!target) return;
    setLoading(true);
    const targetLang = /[\u4e00-\u9fa5]/.test(target) ? 'zh' : 'en';
    let detail = await api.dict.getWord(target);
    // Chinese query: resolve to the top-ranked English headword.
    if (!detail && targetLang === 'zh' && candidates.length > 0) {
      detail = await api.dict.getWord(candidates[0].word);
    }
    setLoading(false);
    if (detail) {
      setSelected(detail);
      setCandidates([]);
      await api.stats.record(detail.word, targetLang);
    } else {
      setSelected(null);
      setCandidates([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, candidates.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && candidates[activeIndex]) handleSearch(candidates[activeIndex].word);
      else if (lang === 'zh' && candidates.length > 0) handleSearch(candidates[0].word);
      else handleSearch();
    } else if (e.key === 'Escape') {
      api.window.hide();
    }
  };

  return (
    <PopupFrame
      title={t('popup.dict.title')}
      canSwitch={!!selected}
      onSwitch={() => selected ? { route: '/dictionary', query: { word: selected.word } } : { route: '/dictionary' }}
    >
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 focus-within:border-accent">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('popup.dict.placeholder')}
            className="flex-1 bg-transparent outline-none text-sm"
          />
          {loading && <span className="text-xs text-slate-400">…</span>}
        </div>

        {candidates.length > 0 && (
          <div className="rounded-xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden p-1">
            {candidates.map((c, i) => (
              <button
                key={c.word}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => handleSearch(c.word)}
                style={{ ['--i' as string]: i }}
                className={`list-row animate-list-item w-full text-left text-xs ${i === activeIndex ? 'list-row-active' : ''}`}
              >
                <span className={`list-row-primary font-medium shrink-0 ${i === activeIndex ? '' : 'text-slate-900 dark:text-slate-100'}`}>{c.word}</span>
                {c.concise && <span className="text-slate-500 dark:text-slate-400 truncate">{c.concise}</span>}
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="rounded-xl border border-accent/40 bg-white dark:bg-slate-900 p-3 space-y-1.5 animate-pop-in">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-lg font-serif-display text-accent">{selected.word}</span>
              {selected.pronunciation && (
                <span className="text-[11px] text-slate-500 dark:text-slate-400">/{selected.pronunciation}/</span>
              )}
            </div>
            {selected.concise_definition && (
              <p className="inline-block px-2 py-0.5 rounded bg-accent-tint text-accent text-xs font-medium">{selected.concise_definition}</p>
            )}
            {selected.definitions[0] && (
              <div className="mt-1.5 space-y-1">
                <span className="inline-block px-1.5 py-0.5 rounded bg-accent-tint text-accent text-[10px] font-semibold uppercase">{selected.definitions[0].pos}</span>
                <p className="whitespace-pre-line text-sm text-slate-700 dark:text-slate-300 leading-snug">{selected.definitions[0].explanation_cn || selected.definitions[0].explanation_en}</p>
                {selected.definitions[0].example_en && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 italic">{selected.definitions[0].example_en}</p>
                )}
              </div>
            )}
          </div>
        )}

        {!selected && !candidates.length && !query.trim() && (
          <p className="text-xs text-center text-slate-400 dark:text-slate-500 py-6">{t('popup.dict.emptyHint')}</p>
        )}
      </div>
    </PopupFrame>
  );
}
