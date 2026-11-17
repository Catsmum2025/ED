export interface WordDefinition {
  word: string;
  pronunciation: string;
  concise_definition: string;
  /** ECDICT fields (present for dict_json sources). */
  phonetic?: string;
  translation?: string;
  definition?: string;
  tags?: string[];
  exchange?: string;
  isnormal?: number;
  forms?: Record<string, string>;
  definitions: Array<{
    pos: string;
    explanation_en: string;
    explanation_cn: string;
    example_en: string;
    example_cn: string;
  }>;
  comparison?: Array<{
    word_to_compare: string;
    analysis: string;
  }>;
}

export interface WordEntry {
  word: string;
  fileName: string;
  concise?: string;
}

export interface DictionaryIndex {
  version: number;
  dictionaryPath: string;
  updatedAt: number;
  entries: Array<{
    word: string;
    fileName: string;
    concise: string;
    chineseTokens: string[];
  }>;
}

export type AccentColor = 'brick' | 'orange' | 'pink' | 'purple' | 'indigo' | 'blue' | 'teal' | 'cyan' | 'aqua' | 'green' | 'lime';

/** Intensity of the global UI motion system.
 *  - lively: springy, layered entrances (default)
 *  - calm: short, quiet fades and small shifts
 *  - performance: every animation/transition disabled */
export type MotionLevel = 'lively' | 'calm' | 'performance';

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  accentColor: AccentColor | 'custom';
  customAccentColor: string;
  language: 'zh-CN' | 'en';
  uiScale: number;
  /** Global animation intensity (lively / calm / performance). */
  motion: MotionLevel;
  /** Whether to hide scrollbars on all pages (still scrollable via mouse/trackpad/keyboard). */
  hideScrollbar: boolean;
  dictionaryPath: string;
  llm: {
    baseURL: string;
    apiKey: string;
    model: string;
    models: string[];
    prefixPrompt: string;
    localModelCommand: string;
    localModelBatPath: string;
  };
  audio: {
    /** Whether the speak button is shown at all. */
    enabled: boolean;
    /** Which TTS engine to use: 'browser' uses the Web Speech API (no setup,
     *  robotic quality), 'indextts' calls a local IndexTTS OpenAI-compatible
     *  server for natural cloned speech. */
    engine: 'browser' | 'indextts';
    /** Base URL of the IndexTTS-compatible API (no trailing slash). */
    baseURL: string;
    /** Voice id, e.g. "voice_28" — must match an id returned by /v1/audio/voices. */
    voice: string;
    /** Speech speed multiplier (0.5–2.0). */
    rate: number;
  };
  anki: {
    enabled: boolean;
    deck: string;
  };
  keyboard: {
    globalShortcut: string | null;
    dictHotkey: string | null;
    translateHotkey: string | null;
  };
  system: {
    /** Launch the app automatically when the user logs in. */
    launchAtLogin: boolean;
  };
  experimental: {
    /** AI-generated word entries: when the user looks up a word missing from
     *  the dictionary, offer to generate a structured entry via the LLM and
     *  save it. Off by default since quality depends on the model. */
    aiWordGeneration: boolean;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  accentColor: 'teal',
  customAccentColor: '#30524E',
  language: 'zh-CN',
  uiScale: 100,
  motion: 'lively',
  hideScrollbar: true,
  dictionaryPath: '',
  llm: {
    baseURL: 'http://127.0.0.1:8080/v1',
    apiKey: '',
    model: '',
    models: [],
    prefixPrompt: '请将以下内容翻译为{dir}，仅输出译文，不要任何修饰或补充：',
    localModelCommand: '',
    localModelBatPath: '',
  },
  audio: {
    enabled: false,
    engine: 'indextts',
    baseURL: 'http://127.0.0.1:7866',
    voice: 'voice_28',
    rate: 1,
  },
  anki: {
    enabled: false,
    deck: 'Default',
  },
  keyboard: {
    globalShortcut: null,
    dictHotkey: null,
    translateHotkey: null,
  },
  system: {
    launchAtLogin: false,
  },
  experimental: {
    aiWordGeneration: false,
  },
};

export const ACCENT_COLORS: Record<AccentColor, string> = {
  brick: '#B84242',
  orange: '#F49D4D',
  pink: '#D95986',
  purple: '#794BBE',
  indigo: '#4958D0',
  blue: '#4971D0',
  teal: '#30524E',
  cyan: '#2D8E8F',
  aqua: '#41BEBC',
  green: '#41BE84',
  lime: '#97CE46',
};

export interface QueryRecord {
  word: string;
  lang: 'en' | 'zh';
  queryCount: number;
  firstQueriedAt: number;
  lastQueriedAt: number;
}

export interface StatsOverview {
  learned: number;
  totalQueries: number;
  topWord: string;
}

export interface HeatmapData {
  date: string;
  count: number;
}

export interface TopWord {
  word: string;
  queryCount: number;
  lastQueriedAt: number;
}

// ── Word books ───────────────────────────────────────────────────────
export const DEFAULT_BOOK_ID = 'favorites';
export const DEFAULT_BOOK_NAME = '我的关注';
export const BOOK_COVER_COUNT = 8;

export interface BookWord {
  word: string;
  addedAt: number;
}

export interface WordBook {
  id: string;
  name: string;
  coverIndex: number;   // 0-based index into /books/cover-*.png
  isDefault: boolean;   // true for "我的关注" — cannot be deleted
  createdAt: number;
  updatedAt: number;
  words: BookWord[];
}

/** Compact view used when listing books (omits the word array). */
export interface WordBookSummary {
  id: string;
  name: string;
  coverIndex: number;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  wordCount: number;
}
