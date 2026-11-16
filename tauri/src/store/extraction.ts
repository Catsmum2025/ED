import { create } from 'zustand';

export type ExtractionPhase = 'extract' | 'move' | 'index';
export type ExtractionState = 'idle' | 'running' | 'done' | 'error';

export interface ExtractionProgress {
  phase: ExtractionPhase;
  count: number;
  total: number;
}

interface ExtractionStore {
  state: ExtractionState;
  progress: ExtractionProgress | null;
  error: string | null;
  /** Final entry count after successful installation. */
  entryCount: number;
  /** Whether the user dismissed the modal to run in background. */
  modalDismissed: boolean;
  setRunning: () => void;
  setProgress: (p: ExtractionProgress) => void;
  setDone: (count: number) => void;
  setError: (message: string) => void;
  dismissModal: () => void;
  showModal: () => void;
  reset: () => void;
}

export const useExtractionStore = create<ExtractionStore>((set) => ({
  state: 'idle',
  progress: null,
  error: null,
  entryCount: 0,
  modalDismissed: false,
  setRunning: () => set({ state: 'running', progress: null, error: null, entryCount: 0, modalDismissed: false }),
  setProgress: (p) => set({ progress: p }),
  setDone: (count) => set({ state: 'done', progress: null, entryCount: count }),
  setError: (message) => set({ state: 'error', error: message, progress: null }),
  dismissModal: () => set({ modalDismissed: true }),
  showModal: () => set({ modalDismissed: false }),
  reset: () => set({ state: 'idle', progress: null, error: null, entryCount: 0, modalDismissed: false }),
}));
