import { create } from 'zustand';
import { api } from '../ipc';
import { DEFAULT_SETTINGS, type AppSettings } from '../types';

interface SettingsState extends AppSettings {
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const settings = await api.settings.get();
    set({ ...settings, loaded: true });
  },
  update: async (patch) => {
    const updated = await api.settings.set(patch);
    set({ ...updated });
  },
}));
