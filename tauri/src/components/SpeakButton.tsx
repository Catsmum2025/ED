import { useEffect, useRef, useState } from 'react';
import { Loader2, Volume2, VolumeX } from 'lucide-react';
import { useSettingsStore } from '../store/settings';
import { api } from '../ipc';
import { useT } from '../i18n';

interface SpeakButtonProps {
  /** Text to be spoken. */
  text: string;
  /** Optional tooltip override; defaults to "朗读". */
  title?: string;
  /** Visual size variant. */
  size?: 'sm' | 'md';
  /** Extra tailwind classes for the button. */
  className?: string;
}

type Status = 'idle' | 'loading' | 'playing' | 'error';

/** A small speaker icon button that synthesizes text via the configured TTS
 *  engine (IndexTTS or browser SpeechSynthesis). Caches audio automatically
 *  on the IndexTTS path. Falls back to browser TTS if IndexTTS is disabled. */
export function SpeakButton({ text, title = '', size = 'sm', className = '' }: SpeakButtonProps) {
  const t = useT();
  const { audio } = useSettingsStore();
  const [status, setStatus] = useState<Status>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Stop any playback when the text changes.
  useEffect(() => {
    setStatus('idle');
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, [text]);

  if (!audio.enabled) return null;

  const sizeCls = size === 'sm' ? 'w-7 h-7' : 'w-9 h-9';
  const iconCls = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  const handleClick = async () => {
    if (status === 'loading') return;

    // If currently playing, stop.
    if (status === 'playing' && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setStatus('idle');
      return;
    }

    // Browser TTS path: no need to hit the IPC layer.
    if (audio.engine === 'browser') {
      try {
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(text);
          u.rate = audio.rate;
          u.onend = () => setStatus('idle');
          u.onerror = () => setStatus('error');
          setStatus('playing');
          window.speechSynthesis.speak(u);
          return;
        }
        setStatus('error');
      } catch {
        setStatus('error');
      }
      return;
    }

    // IndexTTS path.
    setStatus('loading');
    try {
      const { url } = await api.tts.synthesize(text);
      // Stop previous audio if any.
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      const el = new Audio(url);
      audioRef.current = el;
      el.onended = () => setStatus('idle');
      el.onerror = () => setStatus('error');
      await el.play();
      setStatus('playing');
    } catch (err: any) {
      console.warn('TTS failed:', err?.message);
      setStatus('error');
      // Auto-reset the error indicator after a moment.
      setTimeout(() => setStatus('idle'), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title || t('common.speak')}
      className={`inline-flex items-center justify-center rounded-full text-slate-400 hover:text-accent hover:bg-accent-tint transition-colors ${sizeCls} ${className}`}
    >
      {status === 'loading' && <Loader2 className={`${iconCls} animate-spin`} />}
      {status === 'playing' && <VolumeX className={iconCls} />}
      {(status === 'idle' || status === 'error') && <Volume2 className={iconCls} />}
    </button>
  );
}
