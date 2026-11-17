import { create } from 'zustand';
import { api } from '../ipc';
import { DEFAULT_SETTINGS, type AppSettings } from '../types';

interface SettingsState extends AppSettings {
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}

/** Monotonic token for in-flight saves. Two fast keystrokes issue two
 *  settings_set calls; the backend may finish them out of order, and applying
 *  the older reply would revert the input value and bounce the caret to the
 *  end. Only the newest reply is ever applied. */
let saveSeq = 0;

export const useSettingsStore = create<SettingsState>((set) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const settings = await api.settings.get();
    set({ ...settings, loaded: true });
  },
  update: async (patch) => {
    const mine = ++saveSeq;
    // Optimistic merge first: the UI (and any input the user is typing in)
    // never waits for the round trip, and stale replies are ignored below.
    set((state) => ({ ...state, ...patch }));
    const updated = await api.settings.set(patch);
    if (mine === saveSeq) set({ ...updated });
  },
}));
