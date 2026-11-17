/*
 * Tauri IPC adapter.
 *
 * Re-implements the exact same `api` surface the Electron version exposed
 * through its preload script, backed by Tauri's invoke/event system. Every
 * page/component imports { api } from here, so no UI code had to change when
 * migrating from Electron to Tauri.
 */
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openPath as shellOpenPath, openUrl as shellOpenUrl } from '@tauri-apps/plugin-opener';
import { open as dialogOpen, save as dialogSave } from '@tauri-apps/plugin-dialog';
import type {
  AppSettings,
  HeatmapData,
  StatsOverview,
  TopWord,
  WordBook,
  WordBookSummary,
  WordDefinition,
  WordEntry,
} from '../shared/types';

type Unsub = () => void;

/** Wrap a one-shot listen() into the Electron-style unsubscribe API. */
function subscribe<T>(event: string, cb: (payload: T) => void): Unsub {
  let off: UnlistenFn | null = null;
  let disposed = false;
  listen<T>(event, (e) => cb(e.payload)).then((u) => {
    if (disposed) u();
    else off = u;
  });
  return () => {
    disposed = true;
    if (off) off();
  };
}

const settingsApi = {
  get: (): Promise<AppSettings> => invoke<AppSettings>('settings_get'),
  set: async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    const updated = await invoke<AppSettings>('settings_set', { patch });
    // Mirror Electron's app.setLoginItemSettings(): toggle the OS autostart
    // entry whenever launchAtLogin changes.
    if (patch.system?.launchAtLogin !== undefined) {
      try {
        const { enable, disable } = await import('@tauri-apps/plugin-autostart');
        if (patch.system.launchAtLogin) await enable();
        else await disable();
      } catch {
        /* ignore */
      }
    }
    return updated;
  },
  pickDictionaryDir: (): Promise<string | null> =>
    dialogOpen({ directory: true, multiple: false, title: '选择词典目录' }).then(
      (v) => (typeof v === 'string' ? v : null),
    ),
  openUrl: async (url: string): Promise<void> => {
    await shellOpenUrl(url);
  },
  openPath: async (path: string): Promise<void> => {
    await shellOpenPath(path);
  },
};

const dictApi = {
  search: (query: string, lang: 'en' | 'zh', limit?: number): Promise<WordEntry[]> =>
    invoke<WordEntry[]>('dict_search', { query, lang, limit }),
  getWord: (word: string): Promise<WordDefinition | null> =>
    invoke<WordDefinition | null>('dict_get_word', { word }),
  getWords: (words: string[]): Promise<(WordDefinition | null)[]> =>
    invoke<(WordDefinition | null)[]>('dict_get_words', { words }),
  rebuildIndex: (): Promise<{ success: boolean; count: number }> =>
    invoke<{ success: boolean; count: number }>('dict_rebuild_index'),
  indexStatus: (): Promise<{ exists: boolean; count: number; lastUpdated: number }> =>
    invoke<{ exists: boolean; count: number; lastUpdated: number }>('dict_index_status'),
  canInstall: (): Promise<{ available: boolean; zipPath: string | null }> =>
    invoke<{ available: boolean; zipPath: string | null }>('dict_can_install'),
  install: (): Promise<{ started: boolean; message: string; path: string; count: number }> =>
    invoke<{ started: boolean; message: string; path: string; count: number }>('dict_install'),
  onInstallProgress: (cb: (p: { phase: 'extract' | 'move' | 'index'; count: number; total: number }) => void) =>
    subscribe('dict:installProgress', cb),
  onInstallDone: (cb: (r: { path: string; count: number }) => void) => subscribe('dict:installDone', cb),
  onInstallError: (cb: (e: { message: string }) => void) => subscribe('dict:installError', cb),
  uninstall: (): Promise<{ success: boolean; message: string; removed: number }> =>
    invoke<{ success: boolean; message: string; removed: number }>('dict_uninstall'),
  generateWord: (word: string): Promise<WordDefinition> =>
    invoke<WordDefinition>('dict_generate_word', { word }),
  addWord: (entry: WordDefinition): Promise<WordDefinition> =>
    invoke<WordDefinition>('dict_add_word', { entry }),
  deleteWord: (word: string): Promise<boolean> => invoke<boolean>('dict_delete_word', { word }),
  randomWord: (): Promise<WordDefinition | null> => invoke<WordDefinition | null>('dict_random_word'),
};

const statsApi = {
  record: (word: string, lang: 'en' | 'zh'): Promise<void> => invoke('stats_record', { word, lang }),
  overview: (): Promise<StatsOverview> => invoke<StatsOverview>('stats_overview'),
  heatmap: (range: string): Promise<HeatmapData[]> => invoke<HeatmapData[]>('stats_heatmap', { range }),
  topWords: (limit?: number): Promise<TopWord[]> => invoke<TopWord[]>('stats_top_words', { limit }),
  deleteWord: (word: string): Promise<void> => invoke('stats_delete_word', { word }),
  export: async (type: 'learned' | 'queries'): Promise<{ canceled: boolean; path?: string }> => {
    const defaultPath = type === 'learned' ? 'ed-learned.txt' : 'ed-queries.txt';
    const target = await dialogSave({
      defaultPath,
      filters: [{ name: '文本文件', extensions: ['txt'] }],
    });
    if (!target) return { canceled: true };
    await invoke('stats_write_export', { type, path: String(target) });
    return { canceled: false, path: String(target) };
  },
};

const llmApi = {
  listModels: (baseURL: string, apiKey: string): Promise<string[]> =>
    invoke<string[]>('llm_list_models', { baseUrl: baseURL, apiKey }),
  testConnection: (baseURL: string, apiKey: string, model: string): Promise<{ ok: boolean; message: string }> =>
    invoke<{ ok: boolean; message: string }>('llm_test_connection', { baseUrl: baseURL, apiKey, model }),
  startLocalModel: (command?: string): Promise<{ running: boolean; pid: number | null; message: string }> =>
    invoke<{ running: boolean; pid: number | null; message: string }>('llm_start_local_model', { command }),
  stopLocalModel: (): Promise<{ running: boolean; pid: number | null }> =>
    invoke<{ running: boolean; pid: number | null }>('llm_stop_local_model'),
  localModelStatus: (): Promise<{ running: boolean; pid: number | null }> =>
    invoke<{ running: boolean; pid: number | null }>('llm_local_model_status'),
  pickBatFile: (): Promise<string | null> =>
    dialogOpen({
      multiple: false,
      title: '选择本地模型启动脚本',
      filters: [
        { name: '批处理脚本', extensions: ['bat', 'cmd'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    }).then((v) => (typeof v === 'string' ? v : null)),
};

const wordbooksApi = {
  list: (): Promise<WordBookSummary[]> => invoke<WordBookSummary[]>('wordbooks_list'),
  get: (id: string): Promise<WordBook | null> => invoke<WordBook | null>('wordbooks_get', { id }),
  create: (name: string, coverIndex: number): Promise<WordBookSummary> =>
    invoke<WordBookSummary>('wordbooks_create', { name, coverIndex }),
  update: (id: string, patch: { name?: string; coverIndex?: number }): Promise<WordBookSummary | null> =>
    invoke<WordBookSummary | null>('wordbooks_update', { id, patch }),
  delete: (id: string): Promise<boolean> => invoke<boolean>('wordbooks_delete', { id }),
  addWord: (id: string, word: string): Promise<boolean> => invoke<boolean>('wordbooks_add_word', { id, word }),
  removeWord: (id: string, word: string): Promise<boolean> =>
    invoke<boolean>('wordbooks_remove_word', { id, word }),
  toggleFavorite: (word: string): Promise<boolean> => invoke<boolean>('wordbooks_toggle_favorite', { word }),
  isFavorited: (word: string): Promise<boolean> => invoke<boolean>('wordbooks_is_favorited', { word }),
  containingWord: (word: string): Promise<string[]> => invoke<string[]>('wordbooks_containing_word', { word }),
};

interface TtsSynthResult {
  url: string;
  cached: boolean;
}

const ttsApi = {
  /** Rust returns the absolute path of the cached wav; convertFileSrc turns it
   *  into an asset-protocol URL that <audio> can stream (replaces Electron's
   *  custom tts:// scheme). */
  synthesize: async (text: string): Promise<TtsSynthResult> => {
    const r = await invoke<{ path: string; cached: boolean }>('tts_synthesize', { text });
    return { url: convertFileSrc(r.path), cached: r.cached };
  },
  listVoices: (baseURL?: string): Promise<Array<{ id: string; name?: string; file_path?: string }>> =>
    invoke<Array<{ id: string; name?: string; file_path?: string }>>('tts_list_voices', { baseUrl: baseURL }),
  checkHealth: (baseURL?: string): Promise<{
    reachable: boolean;
    modelLoaded: boolean;
    version?: string;
    message: string;
  }> => invoke('tts_check_health', { baseUrl: baseURL }),
};

// ── Streaming translation events (Electron used ipcRenderer.on directly) ────
const translateUnlistens: Promise<UnlistenFn>[] = [];

const translateApi = {
  stream: (payload: { text: string; model: string; baseURL: string; apiKey: string; prefixPrompt?: string }) => {
    // Fire-and-forget; chunks arrive as translate:chunk events emitted to this
    // window by the Rust command.
    invoke('translate_stream', { payload }).catch(() => {
      /* errors surface via translate:error */
    });
  },
  onChunk: (cb: (chunk: string) => void) => {
    translateUnlistens.push(listen<string>('translate:chunk', (e) => cb(e.payload)));
  },
  onDone: (cb: () => void) => {
    translateUnlistens.push(listen('translate:done', () => cb()));
  },
  onError: (cb: (message: string) => void) => {
    translateUnlistens.push(listen<string>('translate:error', (e) => cb(e.payload)));
  },
  removeAllListeners: () => {
    const pending = translateUnlistens.splice(0, translateUnlistens.length);
    for (const p of pending) p.then((off) => off());
  },
};

const windowApi = {
  hide: (): Promise<void> => invoke('window_hide'),
  close: (): Promise<void> => invoke('window_close'),
  switchToMain: (route: string, query?: Record<string, string>): Promise<void> =>
    invoke('window_switch_to_main', { route, query }),
  fitContent: (height: number): Promise<void> => invoke('window_fit_content', { height }),
  onShow: (cb: () => void): Unsub => subscribe('popup:show', cb),
  onNavigate: (cb: (payload: { route: string; query?: Record<string, string> }) => void): Unsub =>
    subscribe<{ route: string; query?: Record<string, string> }>('main:navigate', cb),
};

export const api = {
  settings: settingsApi,
  dict: dictApi,
  stats: statsApi,
  llm: llmApi,
  wordbooks: wordbooksApi,
  tts: ttsApi,
  translate: translateApi,
  window: windowApi,
};

export type RendererAPI = typeof api;
