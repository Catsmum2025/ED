import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, Check, Copy, Heart, Plus, RefreshCw, Search, Sparkles, Loader2 } from 'lucide-react';
import { api } from '../ipc';
import { Button } from '../components/Button';
import { Card, CardContent } from '../components/Card';
import { SpeakButton } from '../components/SpeakButton';
import { useSettingsStore } from '../store/settings';
import { useT } from '../i18n';
import { useExtractionBlocked } from '../components/ExtractionOverlay';
import type { WordBookSummary, WordDefinition, WordEntry } from '../types';

export function DictionaryPage() {
  const t = useT();
  const blocked = useExtractionBlocked();
  const [query, setQuery] = useState('');
  const [lang, setLang] = useState<'en' | 'zh'>('en');
  const [candidates, setCandidates] = useState<WordEntry[]>([]);
  const [selected, setSelected] = useState<WordDefinition | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [notFoundWord, setNotFoundWord] = useState<string | null>(null);
  const [zhNoResult, setZhNoResult] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [randomWord, setRandomWord] = useState<WordDefinition | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { llm, experimental } = useSettingsStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const aiGenEnabled = experimental.aiWordGeneration;

  // ── Word book state ──
  const [favorited, setFavorited] = useState(false);
  const [books, setBooks] = useState<WordBookSummary[]>([]);
  const [containingBookIds, setContainingBookIds] = useState<string[]>([]);
  const [bookMenuOpen, setBookMenuOpen] = useState(false);
  const [newBookName, setNewBookName] = useState('');
  const [newBookCreating, setNewBookCreating] = useState(false);
  const bookMenuRef = useRef<HTMLDivElement>(null);

  const loadBookState = async (word: string) => {
    const [fav, list, containing] = await Promise.all([
      api.wordbooks.isFavorited(word),
      api.wordbooks.list(),
      api.wordbooks.containingWord(word),
    ]);
    setFavorited(fav);
    setBooks(list);
    setContainingBookIds(containing);
  };

  // Close the "add to book" dropdown on outside click.
  useEffect(() => {
    if (!bookMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (bookMenuRef.current && !bookMenuRef.current.contains(e.target as Node)) {
        setBookMenuOpen(false);
        setNewBookName('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bookMenuOpen]);

  useEffect(() => {
    if (selected) loadBookState(selected.word);
  }, [selected?.word]);

  const handleToggleFavorite = async () => {
    if (!selected) return;
    const nowFav = await api.wordbooks.toggleFavorite(selected.word);
    setFavorited(nowFav);
    const list = await api.wordbooks.list();
    setBooks(list);
  };

  const handleAddToBook = async (bookId: string) => {
    if (!selected) return;
    await api.wordbooks.addWord(bookId, selected.word);
    const containing = await api.wordbooks.containingWord(selected.word);
    setContainingBookIds(containing);
  };

  const handleCreateBook = async () => {
    const name = newBookName.trim();
    if (!name || !selected) return;
    setNewBookCreating(true);
    try {
      const created = await api.wordbooks.create(name, Math.floor(Math.random() * 8));
      await api.wordbooks.addWord(created.id, selected.word);
      const list = await api.wordbooks.list();
      setBooks(list);
      const containing = await api.wordbooks.containingWord(selected.word);
      setContainingBookIds(containing);
      setNewBookName('');
    } finally {
      setNewBookCreating(false);
    }
  };

  const loadRandom = async () => {
    const w = await api.dict.randomWord();
    setRandomWord(w);
  };

  useEffect(() => {
    loadRandom();
  }, []);

  // Handle "switch to main" requests from the dict popup: a `?word=` query param
  // is set, we look it up and then clear the param so a manual refresh doesn't
  // re-trigger the lookup.
  useEffect(() => {
    const word = searchParams.get('word');
    if (word) {
      setQuery(word);
      handleSearch(word);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]);

  useEffect(() => {
    setLang(/[\u4e00-\u9fa5]/.test(query) ? 'zh' : 'en');
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      setZhNoResult(null);
      if (!query.trim()) {
        setCandidates([]);
        return;
      }
      const results = await api.dict.search(query, lang, 12);
      setCandidates(results);
      setActiveIndex(-1);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, lang]);

  const handleSearch = async (word?: string) => {
    const target = (word || query).trim();
    if (!target) return;
    const targetLang = /[\u4e00-\u9fa5]/.test(target) ? 'zh' : 'en';
    let detail = await api.dict.getWord(target);
    // A Chinese query is not an English headword, so fall back to the
    // best-ranked candidate — Enter and the search button then always work.
    if (!detail && targetLang === 'zh' && candidates.length > 0) {
      detail = await api.dict.getWord(candidates[0].word);
    }
    if (detail) {
      setSelected(detail);
      setNotFoundWord(null);
      setZhNoResult(null);
      setGenError(null);
      await api.stats.record(detail.word, targetLang);
      setCandidates([]);
    } else {
      // Not found: offer AI generation for English words only.
      setSelected(null);
      setNotFoundWord(targetLang === 'en' ? target : null);
      setZhNoResult(targetLang === 'zh' ? target : null);
      setGenError(null);
      setCandidates([]);
    }
  };

  const handleGenerate = async () => {
    if (!notFoundWord) return;
    setGenerating(true);
    setGenError(null);
    try {
      const entry = await api.dict.generateWord(notFoundWord);
      const saved = await api.dict.addWord(entry);
      setSelected(saved);
      setNotFoundWord(null);
      await api.stats.record(saved.word, 'en');
    } catch (e: any) {
      setGenError(e?.message || String(e));
    } finally {
      setGenerating(false);
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
      if (activeIndex >= 0 && candidates[activeIndex]) {
        handleSearch(candidates[activeIndex].word);
      } else if (lang === 'zh' && candidates.length > 0) {
        // Chinese lookup: confirming the query means "take the best match".
        handleSearch(candidates[0].word);
      } else {
        handleSearch();
      }
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="relative max-w-2xl mx-auto">
        {blocked && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/70 dark:bg-slate-950/70 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm text-accent">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t('extraction.blockedTip')}</span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2.5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 pl-5 pr-2 py-2 shadow-card focus-within:border-accent focus-within:ring-4 ring-accent/15 transition-all">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('dict.searchPlaceholder')}
            className="flex-1 bg-transparent outline-none text-base text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
          />
          <Button size="sm" onClick={() => handleSearch()}>
            {t('dict.search')}
          </Button>
        </div>

        {candidates.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-hover z-30 animate-dropdown-in max-h-[55vh] overflow-y-auto scrollbar-hide p-1.5">
            {candidates.map((c, i) => (
              <button
                key={c.word}
                onClick={() => handleSearch(c.word)}
                style={{ ['--i' as string]: i }}
                className={`list-row animate-list-item w-full text-left ${i === activeIndex ? 'list-row-active' : ''}`}
              >
                <span className={`list-row-primary font-medium shrink-0 ${i === activeIndex ? '' : 'text-slate-900 dark:text-slate-100'}`}>{c.word}</span>
                {c.concise && <span className="text-slate-500 dark:text-slate-400 truncate min-w-0">{c.concise}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {!selected && !notFoundWord && zhNoResult && candidates.length === 0 && (
        <div className="max-w-2xl mx-auto animate-fade-in">
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-slate-700 dark:text-slate-300">{t('dict.zhNoResult', { word: zhNoResult })}</p>
              <p className="mt-1.5 text-sm text-slate-400 dark:text-slate-500">{t('dict.zhNoResultHint')}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {!selected && notFoundWord && (
        <div className="max-w-2xl mx-auto animate-fade-in">
          <Card>
            <CardContent className="text-center py-10">
              <p className="text-slate-700 dark:text-slate-300">
                {t('dict.notFoundPrefix')}<span className="font-semibold text-slate-900 dark:text-slate-100">{notFoundWord}</span>{t('dict.notFoundSuffix')}
              </p>

              {aiGenEnabled ? (
                <>
                  <div className="flex justify-center mt-4 mb-3">
                    <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent-tint text-accent">
                      <Sparkles className="w-6 h-6" />
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {llm.model && llm.baseURL
                      ? t('dict.aiGenOffer')
                      : t('dict.aiGenNeedConfig')}
                  </p>
                  <div className="mt-5">
                    <Button onClick={handleGenerate} disabled={generating || !llm.model || !llm.baseURL}>
                      <Sparkles className="w-4 h-4 mr-2" />
                      {generating ? t('dict.aiGenGenerating') : t('dict.aiGenButton')}
                    </Button>
                  </div>
                  {genError && (
                    <p className="mt-4 text-sm text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-lg py-2 px-3 break-words">
                      {genError}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">
                  {t('dict.aiGenEnableHint')}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {!selected && !notFoundWord && !query.trim() && randomWord && (
        <div className="max-w-2xl mx-auto animate-fade-in">
          <div className="flex items-center justify-between mb-2.5 px-1">
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500 tracking-wide">{t('dict.randomTitle')}</span>
            <button
              onClick={loadRandom}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-accent transition-colors"
              title={t('dict.nextRandomAlt')}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t('dict.nextRandom')}
            </button>
          </div>

          <button
            onClick={() => handleSearch(randomWord.word)}
            className="block w-full text-left group"
          >
            <div className="flex rounded-2xl overflow-hidden shadow-card border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 card-lift group-hover:shadow-hover">
              {/* Left stub — width adapts to the word so it stays on one line. */}
              <div className="relative min-w-[11rem] shrink-0 bg-accent text-accent-contrast p-5 flex flex-col justify-center min-h-[128px]">
                <div className="font-serif-display text-3xl leading-tight whitespace-nowrap">{randomWord.word}</div>
                {randomWord.pronunciation && (
                  <div className="mt-1 text-[11px] text-accent-contrast-muted">/{randomWord.pronunciation}/</div>
                )}
                {randomWord.concise_definition && (
                  <div className="mt-2 text-xs text-accent-contrast leading-snug line-clamp-3 opacity-85">{randomWord.concise_definition}</div>
                )}
              </div>

              {/* Right main */}
              <div className="flex-1 p-5 min-w-0 flex flex-col justify-center">
                {randomWord.definitions[0] && (
                  <>
                    <span className="inline-block self-start px-2 py-0.5 rounded-md bg-accent-tint text-accent text-[10px] font-semibold uppercase tracking-wide mb-2">
                      {randomWord.definitions[0].pos}
                    </span>
                    <p className="text-slate-800 dark:text-slate-200 italic leading-relaxed line-clamp-2">
                      {randomWord.definitions[0].example_en}
                    </p>
                    {randomWord.definitions[0].example_cn && (
                      <p className="mt-1.5 text-slate-500 dark:text-slate-400 text-sm line-clamp-2">
                        {randomWord.definitions[0].example_cn}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </button>
        </div>
      )}

      {!selected && !notFoundWord && !query.trim() && !randomWord && (
        <div className="text-center py-24 animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent-tint text-accent mb-4">
            <BookOpen className="w-8 h-8" />
          </div>
          <p className="text-slate-500 dark:text-slate-400">{t('dict.emptyTitle')}</p>
          <p className="mt-1 text-sm text-slate-400 dark:text-slate-500">{t('dict.emptySubtitle')}</p>
        </div>
      )}

      {selected && (
        <div className="max-w-2xl mx-auto space-y-4 animate-fade-in">
          {!query.trim() && (
            <button
              onClick={() => { setSelected(null); loadRandom(); }}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-accent transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t('dict.nextRandomAlt')}
            </button>
          )}
          <Card>
            <CardContent>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-baseline gap-3 flex-wrap min-w-0">
                  <h1 className="text-4xl font-serif-display text-slate-900 dark:text-slate-100">{selected.word}</h1>
                  {selected.pronunciation && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-sm text-slate-500 dark:text-slate-400">
                      /{selected.pronunciation}/
                    </span>
                  )}
                </div>

                {/* Action buttons: speak + favorite + add-to-book */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <SpeakButton text={selected.word} title={t('dict.speakWord')} size="md" />

                  <button
                    onClick={() => { navigator.clipboard.writeText(selected.word); }}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-slate-100 text-slate-400 hover:text-accent dark:bg-slate-800 dark:text-slate-500 dark:hover:text-accent transition-all"
                    title={t('dict.copyWord')}
                  >
                    <Copy className="w-4 h-4" />
                  </button>

                  <button
                    onClick={handleToggleFavorite}
                    className={`inline-flex items-center justify-center w-9 h-9 rounded-xl transition-all ${
                      favorited
                        ? 'bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-400'
                        : 'bg-slate-100 text-slate-400 hover:text-red-500 dark:bg-slate-800 dark:text-slate-500 dark:hover:text-red-400'
                    }`}
                    title={favorited ? t('dict.favorited') : t('dict.notFavorited')}
                  >
                    <Heart className={`w-4 h-4 ${favorited ? 'fill-current' : ''}`} />
                  </button>

                  <div className="relative" ref={bookMenuRef}>
                    <button
                      onClick={() => setBookMenuOpen((v) => !v)}
                      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-slate-100 text-slate-600 hover:text-accent dark:bg-slate-800 dark:text-slate-300 dark:hover:text-accent transition-all text-sm font-medium"
                      title={t('dict.addToBook')}
                    >
                      <Plus className="w-4 h-4" />
                      <span className="hidden sm:inline">{t('dict.addToBook')}</span>
                    </button>
                    {bookMenuOpen && (
                      <div className="absolute right-0 top-full mt-1.5 w-64 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-hover z-40 animate-dropdown-in overflow-hidden">
                        <div className="max-h-72 overflow-y-auto scrollbar-hide p-1.5">
                          {books.filter((b) => !b.isDefault).length === 0 && (
                            <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">
                              {t('dict.noCustomBooks')}
                            </p>
                          )}
                          {books.filter((b) => !b.isDefault).map((b, i) => {
                            const inBook = containingBookIds.includes(b.id);
                            return (
                              <button
                                key={b.id}
                                onClick={() => handleAddToBook(b.id)}
                                style={{ ['--i' as string]: i }}
                                className="list-row animate-list-item w-full text-left"
                              >
                                <span className="list-row-primary truncate min-w-0 text-slate-700 dark:text-slate-200 flex-1">{b.name}</span>
                                <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0 flex items-center gap-1">
                                  {b.wordCount} {t('dict.words')}
                                  {inBook && <Check className="w-3.5 h-3.5 text-accent" />}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="border-t border-slate-100 dark:border-slate-800 p-2 flex items-center gap-1.5">
                          <input
                            value={newBookName}
                            onChange={(e) => setNewBookName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !newBookCreating) handleCreateBook();
                            }}
                            placeholder={t('dict.newBookPlaceholder')}
                            className="flex-1 min-w-0 text-sm bg-transparent outline-none text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
                          />
                          <button
                            onClick={handleCreateBook}
                            disabled={!newBookName.trim() || newBookCreating}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-accent text-accent-contrast disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-all"
                            title={t('dict.newBookCreate')}
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {selected.concise_definition && (
                <p className="mt-3 inline-block px-3.5 py-1.5 rounded-lg bg-accent-tint text-accent font-medium">
                  {selected.concise_definition}
                </p>
              )}
              {selected.forms && Object.keys(selected.forms).length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {Object.entries(selected.forms).map(([key, value]) => (
                    <span key={key} className="px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/70 text-xs text-slate-600 dark:text-slate-300 ring-1 ring-slate-200/60 dark:ring-slate-700/60">
                      <span className="text-slate-400 dark:text-slate-500">{key}:</span> {value}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {selected.definitions.map((def, i) => (
            <Card key={i} style={{ ['--i' as string]: i }} className="animate-list-item">
              <CardContent>
                <span className="inline-block px-2.5 py-0.5 rounded-md bg-accent-tint text-accent text-xs font-semibold uppercase tracking-wide mb-2.5">
                  {def.pos}
                </span>
                <p className="text-slate-800 dark:text-slate-200 leading-relaxed">{def.explanation_en}</p>
                <p className="mt-1 text-slate-500 dark:text-slate-400 text-sm">{def.explanation_cn}</p>
                {def.example_en && (
                  <div className="mt-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border-l-2 border-accent/40 pl-4 pr-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-slate-700 dark:text-slate-300 italic">{def.example_en}</p>
                      <SpeakButton text={def.example_en} title={t('dict.speakExample')} size="sm" />
                    </div>
                    {def.example_cn && <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{def.example_cn}</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          {selected.comparison && selected.comparison.length > 0 && (
            <Card>
              <CardContent>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
                  <span className="w-1 h-4 rounded-full bg-accent" />
                  {t('dict.synonyms')}
                </h3>
                <div className="space-y-2.5">
                  {selected.comparison.map((item, i) => (
                    <div
                      key={i}
                      style={{ ['--i' as string]: i }}
                      className="animate-list-item pl-3.5 py-1 border-l-2 border-accent/25 hover:border-accent/60 transition-colors"
                    >
                      <span className="font-medium text-accent">{item.word_to_compare}</span>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">{item.analysis}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
