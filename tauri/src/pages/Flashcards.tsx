import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, RotateCcw, Shuffle, Sparkles, X } from 'lucide-react';
import { api } from '../ipc';
import { Button } from '../components/Button';
import { Card, CardContent } from '../components/Card';
import { SpeakButton } from '../components/SpeakButton';
import { useT } from '../i18n';
import type { WordDefinition } from '../types';

/** A flashcard derived from a WordDefinition, in the compact shape the
 *  flashcard UI needs (mirrors the original flashcards.html data model). */
interface Flashcard {
  word: string;
  pronunciation: string;
  meaning: string;       // concise_definition
  pos: string;           // definitions[0].pos
  example_en: string;
  example_cn: string;
}

type Mode = 'card' | 'quiz';

function toFlashcard(d: WordDefinition): Flashcard {
  const def0 = d.definitions?.[0];
  return {
    word: d.word,
    pronunciation: d.pronunciation || '',
    meaning: d.concise_definition || '',
    pos: def0?.pos || '',
    example_en: def0?.example_en || '',
    example_cn: def0?.example_cn || '',
  };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Pick `n` random meanings from `pool` (excluding the correct one) for the
 *  quiz distractors. Returns at most `n` items. */
function pickDistractors(pool: Flashcard[], correct: Flashcard, n: number): string[] {
  const others = pool.filter((f) => f.meaning && f.meaning !== correct.meaning);
  return shuffle(others).slice(0, n).map((f) => f.meaning);
}

export function FlashcardsPage() {
  const t = useT();
  const navigate = useNavigate();
  const [bookName, setBookName] = useState('');
  const [bookId, setBookId] = useState('');
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>('card');
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [completed, setCompleted] = useState(false);

  // Quiz state
  const [options, setOptions] = useState<string[]>([]);
  const [answered, setAnswered] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongWords, setWrongWords] = useState<string[]>([]);

  // Parse book id from hash URL (hash router): #/books/<id>/flashcards
  const id = useMemo(() => {
    const m = window.location.hash.match(/\/books\/([^/]+)\/flashcards/);
    return m ? decodeURIComponent(m[1]) : '';
  }, []);

  const load = useCallback(async () => {
    if (!id) {
      setError(t('flash.noBook'));
      setLoading(false);
      return;
    }
    setLoading(true);
    const book = await api.wordbooks.get(id);
    if (!book) {
      setError(t('flash.bookGone'));
      setLoading(false);
      return;
    }
    setBookId(book.id);
    setBookName(book.name);
    if (book.words.length === 0) {
      setError(t('flash.emptyBook'));
      setLoading(false);
      return;
    }
    const defs = await api.dict.getWords(book.words.map((w) => w.word));
    const valid = defs
      .filter((d): d is WordDefinition => d !== null)
      .map(toFlashcard)
      .filter((c) => c.word && c.meaning);
    if (valid.length === 0) {
      setError(t('flash.noDefinitions'));
      setLoading(false);
      return;
    }
    setCards(valid);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const current = cards[index];

  // Generate quiz options whenever the card or mode changes.
  useEffect(() => {
    if (mode !== 'quiz' || !current) return;
    const distractors = pickDistractors(cards, current, 3);
    const opts = shuffle([current.meaning, ...distractors]);
    setOptions(opts);
    setAnswered(false);
    setSelectedOption(null);
  }, [mode, index, current, cards]);
  const goNext = useCallback(() => {
    if (index >= cards.length - 1) {
      setCompleted(true);
      return;
    }
    setIndex((i) => i + 1);
    setFlipped(false);
  }, [index, cards.length]);

  const goPrev = useCallback(() => {
    if (index <= 0) return;
    setIndex((i) => i - 1);
    setFlipped(false);
  }, [index]);

  const handleFlip = useCallback(() => {
    if (mode === 'quiz' && answered) return;
    if (flipped) {
      // 已翻转，点击后切换到下一张
      goNext();
    } else {
      // 未翻转，翻转卡片
      setFlipped(true);
    }
  }, [mode, answered, flipped, goNext]);

  const handleQuizAnswer = (option: string) => {
    if (answered || !current) return;
    setSelectedOption(option);
    setAnswered(true);
    const correct = option === current.meaning;
    if (correct) {
      setCorrectCount((c) => c + 1);
    } else {
      setWrongWords((w) => (w.includes(current.word) ? w : [...w, current.word]));
    }
    // Flip to reveal the back automatically after a short delay.
    setTimeout(() => {
      setFlipped(true);
      // Auto-advance on correct; on wrong, let the user read the back then
      // click "下一个" themselves.
      if (correct) {
        setTimeout(() => {
          goNext();
        }, 1800);
      }
    }, 500);
  };

  // Keyboard shortcuts (card mode only — quiz mode uses mouse).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (mode === 'quiz') return;
      if (completed) return;
      switch (e.key) {
        case ' ':
        case 'Enter':
          e.preventDefault();
          handleFlip();
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          goPrev();
          break;
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          goNext();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, completed, handleFlip, goNext, goPrev]);

  const restart = () => {
    setIndex(0);
    setFlipped(false);
    setCompleted(false);
    setCorrectCount(0);
    setWrongWords([]);
    setMode('card');
  };

  const reshuffle = () => {
    setCards((c) => shuffle(c));
    setIndex(0);
    setFlipped(false);
    setCompleted(false);
    setCorrectCount(0);
    setWrongWords([]);
  };

  if (loading) {
    return (
      <div className="text-center py-24">
        <p className="text-slate-500 dark:text-slate-400">{t('flash.loadingWords')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 animate-fade-in">
        <button
          onClick={() => navigate(bookId ? `/books/${bookId}` : '/books')}
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-accent transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('flash.backToBook')}
        </button>
        <Card>
          <CardContent className="text-center py-12">
            <p className="text-slate-600 dark:text-slate-300">{error}</p>
            <Button className="mt-4" onClick={() => navigate('/books')}>{t('flash.backToList')}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (completed) {
    const accuracy = cards.length > 0 ? Math.round((correctCount / cards.length) * 100) : 0;
    return (
      <div className="max-w-lg mx-auto space-y-4 animate-fade-in">
        <Card>
          <CardContent className="text-center py-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent-tint text-accent mb-4">
              <Sparkles className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-serif-display text-slate-900 dark:text-slate-100">{t('flash.complete')}</h2>
            <p className="mt-2 text-slate-500 dark:text-slate-400">
              {t('flash.completeDesc', { name: bookName, count: cards.length })}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-4">
                <div className="text-2xl font-bold text-accent">{correctCount}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('flash.correct')}</div>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-4">
                <div className="text-2xl font-bold text-slate-700 dark:text-slate-200">{accuracy}%</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('flash.accuracy')}</div>
              </div>
            </div>
            {wrongWords.length > 0 && (
              <div className="mt-5 text-left">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                  {t('flash.wrongWords', { count: wrongWords.length })}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {wrongWords.map((w) => (
                    <span key={w} className="px-2 py-1 rounded-md bg-red-50 dark:bg-red-950/30 text-xs text-red-600 dark:text-red-400">
                      {w}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-6 flex items-center justify-center gap-2">
              <Button onClick={restart}>
                <RotateCcw className="w-4 h-4 mr-1.5" />
                {t('flash.restart')}
              </Button>
              <Button variant="ghost" onClick={() => navigate(`/books/${bookId}`)}>
                {t('flash.backToBook')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!current) return null;

  const isCorrect = answered && selectedOption === current.meaning;
  const isWrong = answered && selectedOption !== current.meaning;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top bar: back + book name + mode toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => navigate(`/books/${bookId}`)}
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-accent transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {bookName}
        </button>

        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/70 text-sm">
          <button
            onClick={() => { setMode('card'); setFlipped(false); }}
            className={`px-3 py-1 rounded-lg transition-colors ${
              mode === 'card' ? 'bg-white dark:bg-slate-700 text-accent shadow-soft' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {t('flash.cardMode')}
          </button>
          <button
            onClick={() => {
              if (cards.length < 4) return;
              setMode('quiz');
              setFlipped(false);
              setAnswered(false);
              setSelectedOption(null);
            }}
            disabled={cards.length < 4}
            className={`px-3 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              mode === 'quiz' ? 'bg-white dark:bg-slate-700 text-accent shadow-soft' : 'text-slate-500 dark:text-slate-400'
            }`}
            title={cards.length < 4 ? t('flash.needMore') : ''}
          >
            {t('flash.quizMode')}
          </button>
        </div>
      </div>

      {/* Progress */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {index + 1} / {cards.length}
          {mode === 'quiz' && ` · ${t('flash.correctCount', { count: correctCount })}`}
        </span>
        <div className="flex-1 h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden max-w-md">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${((index + 1) / cards.length) * 100}%` }}
          />
        </div>
        <button
          onClick={reshuffle}
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-accent transition-colors"
          title={t('flash.shuffleTitle')}
        >
          <Shuffle className="w-3.5 h-3.5" />
          {t('flash.shuffle')}
        </button>
      </div>

      {/* Card */}
      <div className="flex flex-col items-center">
        <div
          className="relative w-full max-w-md h-72 cursor-pointer"
          style={{ perspective: '1000px' }}
          onClick={handleFlip}
        >
          <div
            className="absolute inset-0 transition-transform duration-500"
            style={{
              transformStyle: 'preserve-3d',
              transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            }}
          >
            {/* Front */}
            <div
              className="absolute inset-0 rounded-2xl shadow-card border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col items-center justify-center p-8"
              style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
            >
              <span className="inline-block px-2.5 py-0.5 rounded-md bg-accent-tint text-accent text-xs font-semibold uppercase tracking-wide mb-4">
                {current.pos || 'word'}
              </span>
              <div className="flex items-center gap-2">
                <h2 className="text-4xl font-serif-display text-slate-900 dark:text-slate-100 text-center break-words">
                  {current.word}
                </h2>
                <SpeakButton text={current.word} title={t('flash.speakWord')} size="md" />
              </div>
              {mode === 'card' && (
                <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">{t('flash.tapToFlip')}</p>
              )}
            </div>
            {/* Back */}
            <div
              className="absolute inset-0 rounded-2xl shadow-card border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col items-center justify-center p-6 overflow-y-auto scrollbar-hide"
              style={{
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
              }}
            >
              <div className="flex items-baseline gap-2 flex-wrap justify-center">
                <span className="text-2xl font-serif-display text-slate-900 dark:text-slate-100">{current.word}</span>
                {current.pronunciation && (
                  <span className="text-sm text-accent">/{current.pronunciation}/</span>
                )}
              </div>
              <p className="mt-3 px-3 py-1.5 rounded-lg bg-accent-tint text-accent font-medium text-center">
                {current.meaning}
              </p>
              {current.example_en && (
                <div className="mt-4 w-full rounded-xl bg-slate-50 dark:bg-slate-800/40 border-l-2 border-accent/40 pl-3 pr-2 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-slate-700 dark:text-slate-300 italic">{current.example_en}</p>
                    <SpeakButton text={current.example_en} title={t('dict.speakExample')} size="sm" />
                  </div>
                  {current.example_cn && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{current.example_cn}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Card mode navigation */}
        {mode === 'card' && (
          <div className="mt-6 flex items-center gap-2">
            <Button variant="ghost" onClick={goPrev} disabled={index === 0}>
              <ChevronLeft className="w-4 h-4 mr-1" />
              {t('flash.prev')}
            </Button>
            <Button variant="secondary" onClick={handleFlip}>
              {flipped ? t('flipBack') : t('flip')}
            </Button>
            <Button onClick={goNext}>
              {index === cards.length - 1 ? t('flash.done') : t('flash.next')}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </div>

      {/* Quiz mode options */}
      {mode === 'quiz' && (
        <div className="max-w-md mx-auto space-y-2.5">
          {options.map((opt) => {
            const isThisCorrect = answered && opt === current.meaning;
            const isThisSelected = selectedOption === opt;
            const cls = !answered
              ? 'border-transparent hover:border-accent hover:-translate-y-0.5'
              : isThisCorrect
                ? 'border-green-400 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300'
                : isThisSelected
                  ? 'border-red-400 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                  : 'opacity-60';
            return (
              <button
                key={opt}
                disabled={answered}
                onClick={() => handleQuizAnswer(opt)}
                className={`w-full text-left px-4 py-3 rounded-xl border-2 bg-white dark:bg-slate-900 shadow-soft transition-all flex items-center justify-between gap-2 ${cls}`}
              >
                <span className="text-slate-700 dark:text-slate-200">{opt}</span>
                {isThisCorrect && <Check className="w-4 h-4 text-green-500 shrink-0" />}
                {isThisSelected && !isThisCorrect && <X className="w-4 h-4 text-red-500 shrink-0" />}
              </button>
            );
          })}
          {answered && isWrong && (
            <div className="pt-1">
              <Button onClick={goNext} className="w-full">
                {index === cards.length - 1 ? t('flash.done') : t('flash.next')}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
          {answered && isCorrect && (
            <p className="text-center text-xs text-slate-400 dark:text-slate-500 pt-1">
              {t('flash.correctWait')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
