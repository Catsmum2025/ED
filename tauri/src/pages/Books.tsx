import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, ChevronRight, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { api } from '../ipc';
import { Button } from '../components/Button';
import { Card, CardContent } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { useT, t as tFn } from '../i18n';
import { useSettingsStore } from '../store/settings';
import { BOOK_COVER_COUNT, DEFAULT_BOOK_ID, type WordBook, type WordBookSummary } from '../types';

/** Cover image URL for a given cover index (0-based). */
function coverUrl(idx: number): string {
  const n = ((idx % BOOK_COVER_COUNT) + BOOK_COVER_COUNT) % BOOK_COVER_COUNT;
  return `./books/cover-${n + 1}.png`;
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86400000);
  if (days < 1) return tFn('books.today');
  if (days < 30) return tFn('stats.daysAgo', { n: days });
  return new Date(ts).toLocaleDateString(useSettingsStore.getState().language === 'en' ? 'en-US' : 'zh-CN');
}

/** ─────────────────── Book list page ─────────────────── */
export function BooksPage() {
  const t = useT();
  const navigate = useNavigate();
  const [books, setBooks] = useState<WordBookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCover, setNewCover] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCover, setEditCover] = useState(0);

  const load = async () => {
    setLoading(true);
    setBooks(await api.wordbooks.list());
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    await api.wordbooks.create(name, newCover);
    setNewName('');
    setNewCover(0);
    setCreating(false);
    await load();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(t('books.confirmDelete', { name }))) return;
    await api.wordbooks.delete(id);
    await load();
  };

  const startEdit = (b: WordBookSummary) => {
    setEditingId(b.id);
    setEditName(b.name);
    setEditCover(b.coverIndex);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const name = editName.trim();
    if (!name) return;
    await api.wordbooks.update(editingId, { name, coverIndex: editCover });
    setEditingId(null);
    await load();
  };

  const totalWords = useMemo(() => books.reduce((s, b) => s + b.wordCount, 0), [books]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-end justify-between gap-3">
        <PageHeader
          title={t('books.title')}
          subtitle={t('books.subtitle', { bookCount: books.length, wordCount: totalWords })}
        />
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="w-4 h-4 mr-1.5" />
          {t('books.newBook')}
        </Button>
      </div>

      {creating && (
        <Card>
          <CardContent className="space-y-4">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">{t('books.newBookTitle')}</h3>

            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">{t('books.newBookName')}</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') setCreating(false);
                }}
                autoFocus
                placeholder={t('books.newBookPlaceholder')}
                className="w-full max-w-md px-3.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200/60 dark:border-slate-700/60 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 transition-all"
              />
            </div>

            <CoverPicker value={newCover} onChange={setNewCover} />

            <div className="flex items-center gap-2">
              <Button onClick={handleCreate} disabled={!newName.trim()}>
                {t('books.create')}
              </Button>
              <Button variant="ghost" onClick={() => setCreating(false)}>
                {t('books.cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-12">{t('books.loading')}</p>
      ) : books.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <BookOpen className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
            <p className="text-slate-500 dark:text-slate-400">{t('books.noBooks')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {books.map((b, i) => {
            const isEditing = editingId === b.id;
            return (
              <Card
                key={b.id}
                style={{ ['--i' as string]: i }}
                className="group animate-list-item card-lift hover:shadow-hover"
              >
                <CardContent>
                  {isEditing ? (
                    <div className="space-y-3">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        disabled={b.id === DEFAULT_BOOK_ID}
                        placeholder={t('books.bookNamePlaceholder')}
                        className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200/60 dark:border-slate-700/60 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:opacity-60"
                      />
                      <CoverPicker value={editCover} onChange={setEditCover} />
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={saveEdit}>{t('books.save')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>{t('books.cancel')}</Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => navigate(`/books/${b.id}`)}
                      className="w-full text-left flex items-center gap-3.5"
                    >
                      <div className="relative w-16 h-20 shrink-0 rounded-md overflow-hidden shadow-soft ring-1 ring-black/5">
                        <img src={coverUrl(b.coverIndex)} alt="" className="w-full h-full object-cover" />
                        {b.isDefault && (
                          <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-accent text-accent-contrast">
                            {t('books.default')}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="font-semibold text-slate-900 dark:text-slate-100 truncate">{b.name}</h3>
                          <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0" />
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {t('books.wordsCount', { count: b.wordCount })} · {t('books.updatedAt', { time: formatTimeAgo(b.updatedAt) })}
                        </p>
                      </div>
                    </button>
                  )}
                </CardContent>
                {!isEditing && (
                  <div className="px-5 pb-4 pt-0 flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(b);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-400 hover:text-accent hover:bg-accent-tint transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                      {t('books.edit')}
                    </button>
                    {!b.isDefault && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(b.id, b.name);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        {t('books.delete')}
                      </button>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** ─────────────────── Cover picker ─────────────────── */
function CoverPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const t = useT();
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">{t('books.cover')}</label>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: BOOK_COVER_COUNT }, (_, i) => (
          <button
            key={i}
            onClick={() => onChange(i)}
            className={`relative w-12 h-15 rounded-md overflow-hidden ring-1 transition-all ${
              value === i ? 'ring-2 ring-accent scale-105' : 'ring-black/5 hover:scale-105'
            }`}
            style={{ height: '60px' }}
          >
            <img src={coverUrl(i)} alt="" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}

/** ─────────────────── Book detail page ─────────────────── */
export function BookDetailPage() {
  const t = useT();
  const navigate = useNavigate();
  const { language } = useSettingsStore();
  const [book, setBook] = useState<WordBook | null>(null);
  const [loading, setLoading] = useState(true);

  // Read book id from the URL via the parent prop would be cleaner, but we
  // are mounted as a top-level route, so parse from the path.
  const id = useMemo(() => {
    const m = window.location.hash.match(/\/books\/([^?/]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }, []);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setBook(await api.wordbooks.get(id));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [id]);

  const handleRemoveWord = async (word: string) => {
    if (!book) return;
    await api.wordbooks.removeWord(book.id, word);
    setBook(await api.wordbooks.get(book.id));
  };

  if (loading) {
    return <p className="text-sm text-slate-400 text-center py-12">{t('books.loading')}</p>;
  }
  if (!book) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500 dark:text-slate-400">{t('books.deletedOrGone')}</p>
        <Button className="mt-3" onClick={() => navigate('/books')}>{t('books.backToList')}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <button
        onClick={() => navigate('/books')}
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-accent transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {t('books.backToBook')}
      </button>

      <Card>
        <CardContent className="flex items-center gap-4">
          <div className="relative w-20 h-26 shrink-0 rounded-md overflow-hidden shadow-soft ring-1 ring-black/5" style={{ height: '104px' }}>
            <img src={coverUrl(book.coverIndex)} alt="" className="w-full h-full object-cover" />
            {book.isDefault && (
              <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent text-accent-contrast">
                {t('books.default')}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-serif-display text-slate-900 dark:text-slate-100">{book.name}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {t('books.wordsCount', { count: book.words.length })} · {t('books.createdAt', { date: new Date(book.createdAt).toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN') })}
            </p>
          </div>
          {book.words.length > 0 && (
            <Button onClick={() => navigate(`/books/${book.id}/flashcards`)}>
              <Sparkles className="w-4 h-4 mr-1.5" />
              {t('books.startFlashcards')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">{t('books.wordList')}</h3>
          {book.words.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 py-6 text-center">
              {t('books.emptyBook')}
              {book.isDefault
                ? t('books.addByFav')
                : t('books.addByMenu')}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {book.words.map((w, i) => (
                <div
                  key={w.word}
                  style={{ ['--i' as string]: Math.min(i, 10) }}
                  className="list-row animate-list-item group"
                >
                  <button
                    onClick={() => navigate(`/dictionary?word=${encodeURIComponent(w.word)}`)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <span className="list-row-primary font-medium text-slate-900 dark:text-slate-100">{w.word}</span>
                    <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                      {formatTimeAgo(w.addedAt)}{t('books.addedAt')}
                    </span>
                  </button>
                  <button
                    onClick={() => handleRemoveWord(w.word)}
                    className="p-1.5 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 dark:text-slate-600 dark:hover:bg-red-950/30 transition-colors opacity-0 group-hover:opacity-100"
                    title={t('books.removeFromBook')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
